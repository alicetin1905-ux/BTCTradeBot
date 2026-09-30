#!/usr/bin/env node
// Backtest of the live rules: replays src/signal.js (the same code the bot
// runs) hour by hour on OKX BTC-USDT-SWAP 1H history and compares variants.
//
//   node scripts/backtest.js                 2021 → now, all variants
//   node scripts/backtest.js --from 2023-01-01
//
// 4H candles are built from the 1H history (UTC-aligned). Entry at market at
// the breakout candle's close; initial stop STOP_ATR x ATR away; after every
// 4H close the stop trails to the best close since entry -/+ TRAIL_ATR x ATR
// (never loosens); a 4H close through the exit channel closes at market.
// The stop is checked on 1H candles (a gap through it fills at the open).
// Costs: Bybit taker fee 0.055% per side, and funding approximated at
// 0.01% per 8h of position value (longs pay, shorts receive — BTC's usual
// rate; the real one varies). No slippage unless a variant adds it.
//
// Output: a table on stdout and backtest/REPORT.md + backtest/results.json.
'use strict';

const fs = require('fs');
const path = require('path');
process.env.TRADEBOT_SETTINGS = 'off'; // config.js defaults, not the live control/settings.json
const config = require('../config');
const signal = require('../src/signal');

const ROOT = path.join(__dirname, '..');
const CACHE = path.join(ROOT, 'backtest', 'cache');
const OUT = path.join(ROOT, 'backtest');
const HOUR = 3600000, DAY = 24 * HOUR, TF = 4 * HOUR;
const TAKER = 0.00055;
const FUNDING_8H = 0.0001;

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const FROM = Date.parse(opt('--from', '2021-01-01') + 'T00:00:00Z');
const SPLIT = Date.UTC(2024, 0, 1); // "picked on" before, "checked on" from

/* ---------------- data ---------------- */

async function fetchHistory(fromMs) {
  const file = path.join(CACHE, 'BTCUSDT-1H.json');
  let rows = [];
  try { rows = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { /* no cache yet */ }
  const have = new Set(rows.map(r => r.t));
  const oldest = () => (rows.length ? rows.reduce((m, r) => Math.min(m, r.t), Infinity) : Infinity);
  // Newest first, paging back with `after`; once a page adds nothing new,
  // jump straight past what the cache already holds.
  let after = '';
  for (let page = 0; page < 1500; page++) {
    const url = `https://www.okx.com/api/v5/market/history-candles?instId=BTC-USDT-SWAP&bar=1H&limit=100${after ? '&after=' + after : ''}`;
    const d = await (await fetch(url)).json();
    if (d.code !== '0') throw new Error(`OKX: ${d.msg}`);
    if (!d.data.length) break;
    let fresh = 0;
    for (const k of d.data) {
      const t = +k[0];
      if (k[8] !== '1') continue; // still-forming candle
      if (!have.has(t)) { rows.push({ t, o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[6] }); have.add(t); fresh++; }
    }
    after = d.data[d.data.length - 1][0];
    if (+after <= fromMs) break;
    if (!fresh) {
      if (oldest() <= fromMs) break;
      after = String(oldest());
    }
    await new Promise(r => setTimeout(r, 120)); // stay under OKX's rate limit
  }
  rows.sort((a, b) => a.t - b.t);
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(rows));
  return rows;
}

// UTC-aligned candles of `hours` length from 1H candles; incomplete buckets are dropped.
function bucket(h1, hours) {
  const out = [];
  const ms = hours * HOUR;
  for (let i = 0; i + hours - 1 < h1.length; i++) {
    const c = h1[i];
    if (c.t % ms !== 0 || h1[i + hours - 1].t !== c.t + (hours - 1) * HOUR) continue;
    const g = h1.slice(i, i + hours);
    out.push({ t: c.t, o: g[0].o, h: Math.max(...g.map(x => x.h)), l: Math.min(...g.map(x => x.l)), c: g[hours - 1].c, v: g.reduce((a, x) => a + x.v, 0) });
    i += hours - 1;
  }
  return out;
}

/* ---------------- simulation ---------------- */

const LIVE = {
  channelN: config.CHANNEL_N, exitN: config.EXIT_N, atrLen: config.ATR_LEN, direction: config.DIRECTION,
  stopAtr: config.STOP_ATR, trailAtr: config.TRAIL_ATR,
  start: config.PORTFOLIO.STARTING_BALANCE, riskPct: config.PORTFOLIO.RISK_PCT, maxX: config.PORTFOLIO.MAX_POSITION_X,
  dailyLossPct: config.EXECUTION.DAILY_LOSS_LIMIT_PCT, slippage: 0, funding: true, riskUsd: null,
};

// from / to (ms): which breakout candles may open trades (open ones run on).
function simulate(h1, h4, rules, from = -Infinity, to = Infinity) {
  const R = { ...LIVE, ...rules };
  const sig = signal.series(h4, { channelN: R.channelN, exitN: R.exitN, atrLen: R.atrLen });
  const at = new Map(); // 1H candle open time whose close is the 4H close -> signal
  for (const s of sig) if (s) at.set(s.t + TF - HOUR, s);
  const cost = TAKER + R.slippage;
  let bal = R.start, peak = R.start, maxDD = 0, pos = null, exposedH = 0;
  const trades = [];
  const dayPnl = {};

  function close(price, t, reason) {
    const pnl = (price - pos.entry) * pos.bias * pos.qty - price * pos.qty * cost;
    bal += pnl; pos.pnl += pnl;
    const d = Math.floor(t / DAY);
    dayPnl[d] = (dayPnl[d] || 0) + pos.pnl;
    trades.push({ bias: pos.bias, entry: pos.entry, exit: price, openedAt: pos.openedAt, closedAt: t, pnl: pos.pnl, reason, trailed: pos.trailed });
    pos = null;
  }

  for (const c of h1) {
    if (c.t < from - 30 * DAY) continue;
    if (!pos && c.t >= to) break;
    if (pos && c.t > pos.openedAt) {
      exposedH++;
      if (R.funding && c.t % (8 * HOUR) === 0) { const f = pos.qty * c.o * FUNDING_8H * pos.bias; bal -= f; pos.pnl -= f; }
      if (pos.bias === 1 ? c.l <= pos.stop : c.h >= pos.stop) {
        close(pos.bias === 1 ? Math.min(pos.stop, c.o) : Math.max(pos.stop, c.o), c.t, pos.trailed ? 'trailing stop' : 'stop');
      }
    }
    const s = at.get(c.t);
    if (s) {
      if (pos) {
        if (pos.bias === 1 ? s.exitLong : s.exitShort) close(s.close, c.t, 'exit signal');
        else {
          const t = signal.trail({ bias: pos.bias, stop: pos.stop, ext: pos.ext, sig: [s], fromT: -Infinity, trailAtr: R.trailAtr });
          if (t.stop !== pos.stop) pos.trailed = true;
          pos.stop = t.stop; pos.ext = t.ext;
        }
      }
      const today = dayPnl[Math.floor(c.t / DAY)] || 0;
      const lossHit = today < 0 && -today >= (bal - today) * R.dailyLossPct / 100;
      if (!pos && s.enter && signal.allowed(s.enter, R.direction) && c.t >= from && c.t < to && !lossHit) {
        const dist = (R.stopAtr * s.atr) / s.close;
        const risk = R.riskUsd != null ? R.riskUsd : bal * R.riskPct / 100;
        const notional = Math.min(risk / dist, bal * R.maxX);
        if (notional > 0) {
          const qty = notional / s.close;
          bal -= notional * cost;
          pos = { bias: s.enter, entry: s.close, qty, stop: s.close * (1 - s.enter * dist), ext: s.close, openedAt: c.t, pnl: -notional * cost, trailed: false };
        }
      }
    }
    const eq = bal + (pos ? (c.c - pos.entry) * pos.bias * pos.qty : 0);
    if (eq > peak) peak = eq;
    maxDD = Math.max(maxDD, (peak - eq) / peak);
  }
  const wins = trades.filter(x => x.pnl > 0), losses = trades.filter(x => x.pnl <= 0);
  const gw = wins.reduce((a, x) => a + x.pnl, 0), gl = -losses.reduce((a, x) => a + x.pnl, 0);
  const span = Math.max(1, (Math.min(to, h1[h1.length - 1].t) - Math.max(from, h1[0].t)) / HOUR);
  return {
    trades: trades.length, winRate: trades.length ? wins.length / trades.length : 0,
    net: bal - R.start, returnPct: (bal / R.start - 1) * 100, maxDDPct: maxDD * 100,
    profitFactor: gl ? gw / gl : null, avgWin: wins.length ? gw / wins.length : 0, avgLoss: losses.length ? -gl / losses.length : 0,
    exposure: exposedH / span, tradeList: trades,
  };
}

/* ---------------- variants ---------------- */

const VARIANTS = [
  ['A  live: long-only, 20/20, stop 2 ATR, trail 3 ATR, 2% risk', {}],
  ['-- direction --', null],
  ['long + short', { direction: 'both' }],
  ['-- costs --', null],
  ['+ 0.05% slippage per side', { slippage: 0.0005 }],
  ['no funding (fees only)', { funding: false }],
  ['-- breakout channel --', null],
  ['channel 15', { channelN: 15 }],
  ['channel 30', { channelN: 30 }],
  ['channel 40', { channelN: 40 }],
  ['exit channel 10', { exitN: 10 }],
  ['exit channel 30', { exitN: 30 }],
  ['-- stops --', null],
  ['initial stop 1.5 ATR', { stopAtr: 1.5 }],
  ['initial stop 2.5 ATR', { stopAtr: 2.5 }],
  ['trail 2.5 ATR', { trailAtr: 2.5 }],
  ['trail 4 ATR', { trailAtr: 4 }],
  ['-- risk per trade --', null],
  ['risk 1%', { riskPct: 1 }],
  ['risk 1.5%', { riskPct: 1.5 }],
  ['risk 3%', { riskPct: 3 }],
];

async function main() {
  process.stderr.write('BTC 1H history from OKX… ');
  const h1all = await fetchHistory(FROM - 90 * DAY);
  const h1 = h1all.filter(c => c.t >= FROM - 90 * DAY);
  const h4 = bucket(h1, 4);
  const last = h1[h1.length - 1].t;
  process.stderr.write(`${h1.length} candles to ${new Date(last).toISOString().slice(0, 16)}\n`);

  const years = [];
  for (let y = new Date(FROM).getUTCFullYear(); y <= new Date(last).getUTCFullYear(); y++) years.push(y);
  const fixed = (r) => ({ ...r, riskUsd: LIVE.start * (r.riskPct ?? LIVE.riskPct) / 100 });
  const rows = [];
  for (const [name, rules] of VARIANTS) {
    if (!rules) { rows.push({ name, header: true }); continue; }
    rows.push({
      name, rules,
      all: simulate(h1, h4, rules, FROM),
      perYear: years.map(y => simulate(h1, h4, fixed(rules), Date.UTC(y, 0, 1), Date.UTC(y + 1, 0, 1))),
      before: simulate(h1, h4, fixed(rules), FROM, SPLIT),
      after: simulate(h1, h4, fixed(rules), SPLIT),
    });
  }
  const bh = years.map(y => {
    const a = h1.find(c => c.t >= Date.UTC(y, 0, 1)), b = [...h1].reverse().find(c => c.t < Date.UTC(y + 1, 0, 1));
    return LIVE.start * (b.c / a.o - 1);
  });

  const pad = (x, n) => String(x).padStart(n);
  const pf = (x) => (x == null ? '—' : x.toFixed(2));
  const lines = [];
  lines.push('variant'.padEnd(62) + pad('trades', 7) + pad('win%', 5) + pad('ret%', 7) + pad('maxDD%', 7) + pad('PF', 6) + pad('in mkt', 7) + ' |' +
    years.map(y => pad(y, 7)).join('') + ' |' + pad('<2024', 7) + pad('PF', 5) + pad('2024+', 7) + pad('PF', 5));
  for (const r of rows) {
    if (r.header) { lines.push(r.name); continue; }
    const a = r.all;
    lines.push(r.name.padEnd(62) + pad(a.trades, 7) + pad((a.winRate * 100).toFixed(0), 5) + pad(a.returnPct.toFixed(0), 7) + pad(a.maxDDPct.toFixed(1), 7) +
      pad(pf(a.profitFactor), 6) + pad((a.exposure * 100).toFixed(0) + '%', 7) + ' |' + r.perYear.map(y => pad(y.net.toFixed(0), 7)).join('') +
      ' |' + pad(r.before.net.toFixed(0), 7) + pad(pf(r.before.profitFactor), 5) + pad(r.after.net.toFixed(0), 7) + pad(pf(r.after.profitFactor), 5));
  }
  lines.push('buy & hold 2000 USDT, 1x'.padEnd(62) + ' '.repeat(39) + ' |' + bh.map(v => pad(v.toFixed(0), 7)).join(''));
  const table = lines.join('\n');
  const period = `${new Date(Math.max(FROM, h1[0].t)).toISOString().slice(0, 10)} → ${new Date(last).toISOString().slice(0, 10)}`;
  console.log(`\nBTC backtest ${period}\n\n${table}\n`);

  const live = rows.find(r => r.rules && !Object.keys(r.rules).length);
  const byReason = {};
  for (const t of live.all.tradeList) { byReason[t.reason] = byReason[t.reason] || { n: 0, pnl: 0 }; byReason[t.reason].n++; byReason[t.reason].pnl += t.pnl; }
  const months = {};
  for (const t of live.all.tradeList) { const m = new Date(t.closedAt).toISOString().slice(0, 7); months[m] = (months[m] || 0) + t.pnl; }
  const mv = Object.values(months);
  let streak = 0, worst = 0;
  for (const t of live.all.tradeList) { streak = t.pnl <= 0 ? streak + 1 : 0; worst = Math.max(worst, streak); }

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ period, generatedAt: new Date().toISOString(), live: LIVE, rows, liveTrades: live.all.tradeList },
    (k, v) => (k === 'tradeList' ? undefined : v), 2) + '\n');
  fs.writeFileSync(path.join(OUT, 'REPORT.md'), [
    `# BTC backtest ${period}`, '',
    `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC by \`node scripts/backtest.js\` — the live signal code (\`src/signal.js\`) replayed on OKX BTC-USDT-SWAP 1H candles.`, '',
    `- **trades … in mkt**: the whole period, compounding from ${LIVE.start} USDT with the variant's % risk; *in mkt* = share of the time a position is open.`,
    `- **year columns**: net USDT for that calendar year alone, fresh ${LIVE.start} USDT each year and a fixed $ risk (the variant's % of ${LIVE.start}), so years compare fairly.`,
    '- **<2024 / 2024+**: same fixed $ risk, net USDT and profit factor before and from 2024. The settings were picked on the years before 2024 only (`RESEARCH.md`, `DONCHIAN.md`), so 2024+ is the out-of-sample check.', '',
    'Costs: Bybit taker fee 0.055% per side; funding approximated at 0.01% per 8h of position value (longs pay, shorts receive); no slippage unless a variant adds it. Stop checked on 1H candles, a gap through it fills at the open.', '',
    '```', table, '```', '',
    `## Live variant in detail`, '',
    `- ${live.all.trades} trades, ${(live.all.winRate * 100).toFixed(0)}% winners; average win $${live.all.avgWin.toFixed(0)}, average loss $${live.all.avgLoss.toFixed(0)} (compounding, so later trades are bigger)`,
    `- ${mv.length} months with a closed trade, ${mv.filter(x => x < 0).length} of them losing; longest losing streak ${worst} trades`,
    `- worst drop from a peak ${live.all.maxDDPct.toFixed(1)}%`, '',
    '| Exit | Trades | Net $ |', '|---|---:|---:|',
    ...Object.entries(byReason).map(([k, v]) => `| ${k} | ${v.n} | ${v.pnl.toFixed(0)} |`), '',
    'Most trades lose a little (false breakouts); a few long trends pay for them. Expect long flat or losing stretches.', '',
  ].join('\n'));
  process.stderr.write('wrote backtest/REPORT.md and backtest/results.json\n');
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { simulate, bucket, LIVE };
