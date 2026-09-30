#!/usr/bin/env node
// Strategy research for BTC: which kind of signal actually makes money on
// BTC? The ATLAS score + fixed targets that TradeBot uses on altcoins loses
// on BTC (scripts/backtest.js, backtest/REPORT.md), so this compares
// trend-following families with trailing stops on the same OKX BTC 1H
// history (backtest/cache, filled by scripts/backtest.js).
//
//   node scripts/research.js          writes backtest/RESEARCH.md
//
// Every variant: entry at the signal candle's close (taker), initial stop
// k x ATR away, sized so the stop loses risk% of the balance (position at
// most 2x the balance), the stop trails at each signal close (highest /
// lowest close since entry -/+ m x ATR, never loosens) and is checked on 1H
// candles (stop first). Signal exits close at the signal candle's close.
// Parameters are chosen on 2021-2023 only and then checked on 2024-2026.
'use strict';

const fs = require('fs');
const path = require('path');
const I = require('../src/indicators');
const { bucket } = require('./backtest');

const HOUR = 3600000, DAY = 24 * HOUR;
const FEE = 0.00055;
const FEE_BOX = { v: FEE }; // fee per side used by simulate() (--focus adds slippage)
const START = 2000;
const SPLIT = Date.UTC(2024, 0, 1);
const FIRST = Date.UTC(2021, 0, 1);

const h1 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'backtest', 'cache', 'BTCUSDT-1H.json'), 'utf8'));
const TF = { '4H': bucket(h1, 4), '1D': bucket(h1, 24) };
const TF_H = { '4H': 4, '1D': 24 };

// Per signal candle: { closeT, c, atr, enter: +1/-1/0, exitLong, exitShort }.
function signals(tf, kind, p) {
  const c = TF[tf], cl = c.map(x => x.c), atr = I.atr(c, 14);
  const out = [];
  let dir = null;
  if (kind === 'donchian') {
    const hh = I.highest(c.map(x => x.h), p.n), ll = I.lowest(c.map(x => x.l), p.n);
    const xh = I.highest(c.map(x => x.h), p.x), xl = I.lowest(c.map(x => x.l), p.x);
    for (let i = p.n + 1; i < c.length; i++) {
      const enter = cl[i] > hh[i - 1] ? 1 : cl[i] < ll[i - 1] ? -1 : 0;
      out.push({ i, enter, exitLong: cl[i] < xl[i - 1], exitShort: cl[i] > xh[i - 1] });
    }
  } else if (kind === 'ema') {
    const f = I.ema(cl, p.f), s = I.ema(cl, p.s);
    for (let i = p.s + 1; i < c.length; i++) {
      const d = f[i] > s[i] ? 1 : -1, pd = f[i - 1] > s[i - 1] ? 1 : -1;
      out.push({ i, enter: d !== pd ? d : 0, exitLong: d === -1, exitShort: d === 1 });
    }
  } else if (kind === 'supertrend') {
    dir = I.supertrend(c, p.len, p.mult).dir;
    for (let i = p.len + 2; i < c.length; i++) {
      const flip = dir[i] !== dir[i - 1];
      out.push({ i, enter: flip ? dir[i] : 0, exitLong: dir[i] === -1, exitShort: dir[i] === 1 });
    }
  }
  // Optional regime filter: trade only with the daily EMA(len) slope/side.
  const dEma = p.regime ? I.ema(TF['1D'].map(x => x.c), p.regime) : null;
  const dIdx = p.regime ? new Map(TF['1D'].map((x, j) => [x.t, j])) : null;
  return out.map(o => {
    const closeT = c[o.i].t + TF_H[tf] * HOUR;
    let enter = o.enter;
    if (p.longOnly && enter === -1) enter = 0;
    if (dEma && enter) {
      const j = dIdx.get(Math.floor(closeT / DAY) * DAY - DAY); // last closed day
      const e = j != null ? dEma[j] : null;
      if (e == null || (enter === 1 ? cl[o.i] < e : cl[o.i] > e)) enter = 0;
    }
    return { closeT, c: cl[o.i], atr: atr[o.i], enter, exitLong: o.exitLong, exitShort: o.exitShort };
  }).filter(o => o.atr);
}

function simulate(sigs, r, from, to, fixedRisk) {
  const byT = new Map(sigs.map(s => [s.closeT - HOUR, s]));
  let bal = START, peak = START, maxDD = 0, pos = null;
  const trades = [];
  const close = (price, t, why) => {
    const pnl = (price - pos.entry) * pos.bias * pos.qty - price * pos.qty * FEE_BOX.v;
    bal += pnl; pos.pnl += pnl;
    trades.push({ openedAt: pos.t, closedAt: t, pnl: pos.pnl, why, bias: pos.bias });
    pos = null;
  };
  for (const c of h1) {
    if (c.t < from - 60 * DAY) continue;
    if (c.t >= to + 60 * DAY && !pos) break;
    if (pos && c.t > pos.t && (pos.bias === 1 ? c.l <= pos.stop : c.h >= pos.stop)) {
      close(pos.bias === 1 ? Math.min(pos.stop, c.o) : Math.max(pos.stop, c.o), c.t, 'stop'); // gaps fill at the open
    }
    const s = byT.get(c.t);
    if (s) {
      if (pos) {
        pos.ext = pos.bias === 1 ? Math.max(pos.ext, s.c) : Math.min(pos.ext, s.c);
        const trail = pos.ext - pos.bias * r.trail * s.atr;
        if ((trail - pos.stop) * pos.bias > 0) pos.stop = trail;
        if (r.sigExit && (pos.bias === 1 ? s.exitLong : s.exitShort)) close(s.c, c.t, 'signal');
        else if (s.enter === -pos.bias) close(s.c, c.t, 'reverse');
      }
      if (!pos && s.enter && c.t >= from && c.t < to) {
        const dist = r.stop * s.atr;
        const risk = fixedRisk ? START * r.risk / 100 : bal * r.risk / 100;
        const notional = Math.min(risk / (dist / s.c), bal * 2);
        const qty = notional / s.c;
        bal -= notional * FEE_BOX.v;
        pos = { bias: s.enter, entry: s.c, qty, stop: s.c - s.enter * dist, ext: s.c, t: c.t, pnl: -notional * FEE_BOX.v };
      }
    }
    let eq = bal + (pos ? (c.c - pos.entry) * pos.bias * pos.qty : 0);
    if (eq > peak) peak = eq;
    maxDD = Math.max(maxDD, (peak - eq) / peak);
  }
  const gw = trades.filter(x => x.pnl > 0).reduce((a, x) => a + x.pnl, 0);
  const gl = -trades.filter(x => x.pnl <= 0).reduce((a, x) => a + x.pnl, 0);
  return { n: trades.length, win: trades.length ? trades.filter(x => x.pnl > 0).length / trades.length : 0, net: bal - START, ret: (bal / START - 1) * 100, dd: maxDD * 100, pf: gl ? gw / gl : null, trades };
}

// Grid
const grid = [];
for (const tf of ['4H', '1D']) {
  for (const longOnly of [false, true]) {
    for (const regime of [null, 200]) {
      for (const n of [20, 55]) for (const x of [10, 20]) grid.push({ tf, kind: 'donchian', p: { n, x, longOnly, regime } });
      for (const [f, s] of [[20, 50], [50, 200], [9, 21]]) grid.push({ tf, kind: 'ema', p: { f, s, longOnly, regime } });
      for (const [len, mult] of [[10, 3], [14, 4]]) grid.push({ tf, kind: 'supertrend', p: { len, mult, longOnly, regime } });
    }
  }
}
const exits = [];
for (const stop of [2, 3]) for (const trail of [3, 4, 5]) for (const sigExit of [true, false]) exits.push({ stop, trail, sigExit, risk: 2 });

const years = [2021, 2022, 2023, 2024, 2025, 2026];
const rows = [];
for (const g of grid) {
  const sigs = signals(g.tf, g.kind, g.p);
  for (const r of exits) {
    const pre = simulate(sigs, r, FIRST, SPLIT, true);
    rows.push({ g, r, sigs, pre });
  }
}
const label = (x) => `${x.g.tf} ${x.g.kind}(${Object.entries(x.g.p).filter(([, v]) => v !== null && v !== false).map(([k, v]) => k === 'longOnly' ? 'long-only' : k === 'regime' ? 'D-EMA' + v : k + v).join(' ')}) stop${x.r.stop} trail${x.r.trail}${x.r.sigExit ? ' sigExit' : ''}`;

// Pick on 2021-2023 (fixed $ risk): best by net with PF >= 1.2 and >= 20 trades.
const ranked = rows.filter(x => x.pre.n >= 20 && x.pre.pf >= 1.2).sort((a, b) => b.pre.net - a.pre.net);
const fmt = (x) => x.toFixed(0);
const pad = (x, n) => String(x).padStart(n);
const lines = [];
lines.push('variant'.padEnd(84) + pad('<2024', 7) + pad('PF', 6) + ' |' + pad('2024+', 7) + pad('PF', 6) + ' |' + years.map(y => pad(y, 7)).join('') + ' |' + pad('cmp%', 8) + pad('DD%', 6) + pad('n', 5));
const detail = (x) => {
  const post = simulate(x.sigs, x.r, SPLIT, Infinity, true);
  const per = years.map(y => simulate(x.sigs, x.r, Date.UTC(y, 0, 1), Date.UTC(y + 1, 0, 1), true).net);
  const all = simulate(x.sigs, x.r, FIRST, Infinity, false);
  return { post, per, all };
};
const top = ranked.slice(0, 25).map(x => ({ ...x, ...detail(x) }));
for (const x of top) {
  lines.push(label(x).padEnd(84) + pad(fmt(x.pre.net), 7) + pad(x.pre.pf.toFixed(2), 6) + ' |' + pad(fmt(x.post.net), 7) + pad(x.post.pf == null ? '—' : x.post.pf.toFixed(2), 6) +
    ' |' + x.per.map(v => pad(fmt(v), 7)).join('') + ' |' + pad(fmt(x.all.ret), 8) + pad(x.all.dd.toFixed(0), 6) + pad(x.all.n, 5));
}
// How robust is each family? Share of its parameter sets profitable in both halves.
const fam = {};
for (const x of rows) {
  const k = `${x.g.tf} ${x.g.kind}${x.g.p.longOnly ? ' long-only' : ''}${x.g.p.regime ? ' +D-EMA200' : ''}`;
  const post = simulate(x.sigs, x.r, SPLIT, Infinity, true);
  fam[k] = fam[k] || { n: 0, both: 0, pre: 0, post: 0 };
  fam[k].n++; fam[k].pre += x.pre.net; fam[k].post += post.net;
  if (x.pre.net > 0 && post.net > 0) fam[k].both++;
}
const famLines = ['family'.padEnd(40) + pad('sets', 6) + pad('both>0', 8) + pad('avg<2024', 10) + pad('avg2024+', 10)];
for (const [k, v] of Object.entries(fam).sort((a, b) => b[1].both / b[1].n - a[1].both / a[1].n)) {
  famLines.push(k.padEnd(40) + pad(v.n, 6) + pad(Math.round(v.both / v.n * 100) + '%', 8) + pad(fmt(v.pre / v.n), 10) + pad(fmt(v.post / v.n), 10));
}
// Buy and hold reference per year (2000 USDT, 1x).
const bh = years.map(y => {
  const a = h1.find(c => c.t >= Date.UTC(y, 0, 1)), b = [...h1].reverse().find(c => c.t < Date.UTC(y + 1, 0, 1));
  return START * (b.c / a.o - 1);
});
const out = [
  'Top 25 by 2021-2023 net (fixed $40 risk = 2% of 2000; PF >= 1.2, >= 20 trades), then checked on 2024+:', '',
  lines.join('\n'), '',
  'buy & hold 1x, per year: ' + years.map((y, j) => `${y} ${fmt(bh[j])}`).join(' · '), '',
  'Robustness per family (every parameter set: stop 2/3 ATR x trail 3/4/5 ATR x signal exit on/off x its own params):', '',
  famLines.join('\n'),
].join('\n');
console.log(out);
fs.writeFileSync(path.join(__dirname, '..', 'backtest', 'RESEARCH.md'), '# BTC strategy research\n\n' +
  'Generated by `node scripts/research.js`. OKX BTC-USDT-SWAP 1H candles; taker fee 0.055% per side, no slippage, no funding. ' +
  'Per-year and before/after-2024 columns: fixed $40 risk per trade (2% of 2000) so periods compare fairly; cmp% / DD%: compounding 2% of the balance from 2021, position at most 2x the balance.\n\n```\n' + out + '\n```\n');

/* ---------------- focus: 4H Donchian breakout ---------------- */
// Sensitivity of the pick to its neighbours, extra slippage and risk. (The
// first run also tried "only when the ATLAS score agrees" — it changed next to
// nothing, see DONCHIAN.md; the ATLAS code is not part of this repo.)
if (process.argv.includes('--focus')) {
  const cells = [];
  const hdr = 'dir   n  stop trail'.padEnd(22) + pad('<2024', 7) + pad('PF', 6) + pad('2024+', 7) + pad('PF', 6) + pad('cmp%', 8) + pad('DD%', 5) + pad('n', 5);
  const fl = [hdr];
  for (const longOnly of [true, false]) {
    for (const n of [10, 15, 20, 30, 40, 55]) {
      const sigs = signals('4H', 'donchian', { n, x: 20, longOnly, regime: null });
      for (const stop of [1.5, 2, 2.5, 3]) for (const trail of [2, 2.5, 3, 4]) {
        const r = { stop, trail, sigExit: true, risk: 2 };
        const pre = simulate(sigs, r, FIRST, SPLIT, true), post = simulate(sigs, r, SPLIT, Infinity, true), all = simulate(sigs, r, FIRST, Infinity, false);
        cells.push({ longOnly, n, stop, trail, pre, post, all });
        fl.push(`${longOnly ? 'long' : 'both'} ${pad(n, 3)} ${pad(stop, 5)} ${pad(trail, 5)}`.padEnd(22) + pad(fmt(pre.net), 7) + pad(pre.pf ? pre.pf.toFixed(2) : '—', 6) +
          pad(fmt(post.net), 7) + pad(post.pf ? post.pf.toFixed(2) : '—', 6) + pad(fmt(all.ret), 8) + pad(all.dd.toFixed(0), 5) + pad(all.n, 5));
      }
    }
  }
  const pos = cells.filter(x => x.pre.net > 0 && x.post.net > 0).length;
  fl.push(`\n${pos}/${cells.length} cells profitable in both halves`);

  // Pick + variations: slippage, risk.
  const pick = (longOnly, n = 20) => signals('4H', 'donchian', { n, x: 20, longOnly, regime: null });
  const vr = [];
  const line = (name, sigs, r, fee) => {
    const saved = FEE_BOX.v; FEE_BOX.v = fee;
    const pre = simulate(sigs, r, FIRST, SPLIT, true), post = simulate(sigs, r, SPLIT, Infinity, true), all = simulate(sigs, r, FIRST, Infinity, false);
    const per = years.map(y => simulate(sigs, r, Date.UTC(y, 0, 1), Date.UTC(y + 1, 0, 1), true).net);
    FEE_BOX.v = saved;
    vr.push(name.padEnd(52) + pad(fmt(pre.net), 7) + pad(pre.pf.toFixed(2), 6) + pad(fmt(post.net), 7) + pad(post.pf.toFixed(2), 6) + ' |' + per.map(v => pad(fmt(v), 7)).join('') + ' |' + pad(fmt(all.ret), 8) + pad(all.dd.toFixed(0), 5) + pad(all.n, 5) + pad((all.win * 100).toFixed(0), 5));
  };
  vr.push('variant'.padEnd(52) + pad('<2024', 7) + pad('PF', 6) + pad('2024+', 7) + pad('PF', 6) + ' |' + years.map(y => pad(y, 7)).join('') + ' |' + pad('cmp%', 8) + pad('DD%', 5) + pad('n', 5) + pad('win%', 5));
  for (const longOnly of [true, false]) {
    const s = pick(longOnly), tag = longOnly ? 'long-only' : 'long+short';
    const r = { stop: 2, trail: 3, sigExit: true, risk: 2 };
    line(`${tag} n20 stop2 trail3`, s, r, FEE);
    line(`${tag} + 0.05% slippage per side`, s, r, FEE + 0.0005);
    line(`${tag} risk 1%`, s, { ...r, risk: 1 }, FEE);
    line(`${tag} risk 3%`, s, { ...r, risk: 3 }, FEE);
  }
  const txt = '4H Donchian breakout (exit channel 20, signal exit on), stop x trail grid — fixed $40 risk halves, cmp% = compounding 2%:\n\n' + fl.join('\n') +
    '\n\nThe pick and variations:\n\n' + vr.join('\n');
  console.log(txt);
  fs.writeFileSync(path.join(__dirname, '..', 'backtest', 'DONCHIAN.md'), '# 4H Donchian breakout on BTC\n\nGenerated by `node scripts/research.js --focus` (same conventions as RESEARCH.md).\n\n```\n' + txt + '\n```\n');
}
