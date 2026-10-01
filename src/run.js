#!/usr/bin/env node
// BTCTradeBot — trades BTC and ETH (config.COINS), one process per coin
// (COIN=ETH node src/run.js), on a demo account: OKX Demo Trading
// (x-simulated-trading) or Bybit Demo Trading (api-demo.bybit.com) — mainnet
// prices, demo funds — via src/exchange.js. config.EXCHANGE / EXCHANGE in .env.
// Signal: 4H Donchian breakout with an ATR trailing stop (src/signal.js).
//
// State lives in state/demo/*.json. Keys come from .env. (Bybit geo-blocks
// many cloud regions, GitHub Actions included; OKX is less strict — README.)
//
//   node src/run.js              one full run: sync with the exchange, read the 4H
//                                candles, exit / trail / enter
//   node src/run.js --sync       sync the position and fills only — no market
//                                data, no new entries; state is written only
//                                if something changed
//   node src/run.js --close-all  cancel orders + close this coin's position on the exchange
//   node src/run.js --reset      back to the starting balance (tracking only,
//                                doesn't touch the exchange; scripts/reset.sh does both)
'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const market = require('./market');
const signal = require('./signal');
const flip = require('./flip');
const exchange = require('./exchange');
const notify = require('./notify');
const summary = require('./summary');
const { loadEnv } = require('./env');

loadEnv();
// TRADEBOT_MODE is optional; 'demo' is the only mode.
const MODE = (process.env.TRADEBOT_MODE || 'demo').toLowerCase();
if (MODE !== 'demo') {
  console.error(`Unknown TRADEBOT_MODE "${MODE}" — BTCTradeBot only trades demo accounts (TRADEBOT_MODE=demo).`);
  process.exit(1);
}
if (process.env.EXCHANGE) config.EXCHANGE = process.env.EXCHANGE.trim().toLowerCase();
if (process.env.OKX_INSTRUMENT && process.env.OKX_INSTRUMENT.trim()) config.OKX_INSTRUMENT = process.env.OKX_INSTRUMENT.trim().toUpperCase();
// What the position lives on, e.g. "okx:BTC-USDC" — switching it with a position open is refused.
config.MARKET_ID = config.EXCHANGE === 'okx' ? `okx:${config.OKX_INSTRUMENT}` : 'bybit';
const COIN = config.COIN;
const COINS = config.COINS.includes(COIN) ? config.COINS : [...config.COINS, COIN];
// The coin that runs last sends the combined daily / status pushes and is the only one that resets the shared balance.
const LEAD = COIN === COINS[COINS.length - 1];
// Spot: long-only, never more than the cash at hand.
if (config.EXCHANGE === 'okx' && require('./okx').isSpot(config.OKX_INSTRUMENT)) {
  if (config.DIRECTION !== 'long') console.log(`${config.OKX_INSTRUMENT} is spot: trading long-only (DIRECTION "${config.DIRECTION}" ignored)`);
  config.DIRECTION = 'long';
  config.PORTFOLIO.LEVERAGE = 1;
  config.PORTFOLIO.MAX_POSITION_X = Math.min(config.PORTFOLIO.MAX_POSITION_X, 1);
}
if (!['okx', 'bybit'].includes(config.EXCHANGE)) {
  console.error(`Unknown EXCHANGE "${config.EXCHANGE}" — use okx or bybit.`);
  process.exit(1);
}

const P = config.PORTFOLIO;
// A coin with its own risk per trade (config.COIN_RISK_PCT, e.g. NEAR 1%).
if (config.COIN_RISK_PCT && config.COIN_RISK_PCT[COIN] != null) P.RISK_PCT = config.COIN_RISK_PCT[COIN];
const ROOT = path.join(__dirname, '..', 'state', 'demo');
// BTC keeps state/demo/ (the dashboard and history started there); the other coins use state/demo/<coin>/.
const dirOf = (coin) => (coin === 'BTC' ? ROOT : path.join(ROOT, coin.toLowerCase()));
const DIR = dirOf(COIN);
// One balance for all coins (account, daily summary); everything else is per coin.
const SHARED = ['account', 'summary'];
const OWN = ['position', 'trades', 'closing', 'signal', 'seenOrderIds', 'commandsDone', 'meta'];
const FILES = [...SHARED, ...OWN];
if (Object.keys(config.SETTINGS_APPLIED).length) console.log('settings.json:', JSON.stringify(config.SETTINGS_APPLIED));
for (const e of config.SETTINGS_ERRORS) console.log('settings.json ignored —', e);

/* ---------------- persistence ---------------- */

const homeOf = (name) => (SHARED.includes(name) ? ROOT : DIR);
function readJson(name, fallback, dir = homeOf(name)) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, name + '.json'), 'utf8')); } catch (e) { return fallback; }
}
function writeJson(name, data) {
  const dir = homeOf(name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify(data, null, 2) + '\n');
}
function freshAccount() {
  return { balance: P.STARTING_BALANCE, startingBalance: P.STARTING_BALANCE, fundingSince: Date.now(), funding: { total: 0 }, startedAt: Date.now() };
}
// The other coins' last state, read-only: their trades count toward the
// shared daily loss limit, and their positions / signals go in the pushes.
function loadPeers() {
  const out = {};
  for (const c of COINS) {
    if (c === COIN) continue;
    const d = dirOf(c);
    out[c] = { position: readJson('position', null, d), trades: readJson('trades', [], d), signal: readJson('signal', null, d) };
  }
  return out;
}
function loadState() {
  return {
    coin: COIN,
    peers: loadPeers(),
    account: readJson('account', null) || freshAccount(),
    position: readJson('position', null),
    trades: readJson('trades', []),
    closing: readJson('closing', []),           // closed positions awaiting their final P&L record
    signal: readJson('signal', null),           // last 4H read, for the dashboard
    seenOrderIds: readJson('seenOrderIds', []), // closed-pnl records / funding rows already booked
    summary: readJson('summary', null),         // last daily summary { date, balance }
    commandsDone: readJson('commandsDone', []), // ids of control/commands.json entries already carried out
    meta: readJson('meta', {}),                 // { lastEntryCandle }
  };
}
function saveState(st, { fullRun = false } = {}) {
  // Settings are re-stamped every run so the dashboard always shows the live rules.
  st.account.settings = require('./settings').current(config);
  st.account.settingsDefaults = config.SETTINGS_DEFAULTS;
  st.account.settingsErrors = config.SETTINGS_ERRORS;
  st.account.mode = MODE;
  st.account.exchange = config.EXCHANGE;
  const inst = config.EXCHANGE === 'okx' ? config.OKX_INSTRUMENT : config.SYMBOL;
  if (COIN === 'BTC') st.account.instrument = inst; // the dashboard's header
  st.account.instruments = { ...(st.account.instruments || {}), [COIN]: inst };
  st.account.coins = COINS;
  st.account.updatedAt = Date.now();
  if (fullRun) st.account.lastRunAt = Date.now(); // the watchdog checks full runs, not syncs
  for (const k of FILES) writeJson(k, st[k]);
}

/* ---------------- one run ---------------- */

function exchangeClient() {
  if (config.EXCHANGE === 'okx') {
    return require('./okx').createClient({
      apiKey: process.env.OKX_API_KEY, apiSecret: process.env.OKX_API_SECRET,
      passphrase: process.env.OKX_API_PASSPHRASE, base: process.env.OKX_API_BASE,
      instrument: config.OKX_INSTRUMENT, symbol: config.SYMBOL, marginCcy: process.env.OKX_MARGIN_CCY, marginMode: process.env.OKX_MARGIN_MODE,
    });
  }
  return require('./bybit').createClient({ env: MODE, apiKey: process.env.BYBIT_API_KEY, apiSecret: process.env.BYBIT_API_SECRET });
}

// The tracked position lives on one exchange: switching EXCHANGE while it's
// open would lose track of it (and its stop), so that's refused.
function checkExchange(st) {
  const on = st.position && st.position.exchange;
  if (on && on !== config.MARKET_ID && on !== config.EXCHANGE) {
    throw new Error(`the open position is on ${on}, but the bot is set to ${config.MARKET_ID} — close it there first, or switch back`);
  }
}

// Remote commands: control/commands.json (committed to the repo, pulled by the
// Mac before every run and sync) lists one-off actions, e.g.
//   [{ "id": "2026-10-01-close", "action": "close-all" }]
//   [{ "id": "2026-10-01-reset", "action": "reset", "clearHistory": true }]
// Each id is carried out once and remembered in commandsDone. A command that
// hits an error isn't marked done, so the next sync retries it. Returns true
// if anything was carried out.
async function runCommands(client, st, events) {
  let cmds = [];
  try { cmds = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'control', 'commands.json'), 'utf8')); } catch (e) { return false; }
  let ran = false;
  for (const c of Array.isArray(cmds) ? cmds : []) {
    if (!c || !c.id || st.commandsDone.includes(c.id)) continue;
    if (c.action === 'close-all' || c.action === 'reset') {
      const evs = [];
      await exchange.closeAll({ client, st, events: evs });
      events.push(...evs);
      const failed = evs.filter(e => e.type === 'error');
      if (failed.length) {
        await notify.push([{ title: `${COIN} ${c.action} failed — retrying`, message: failed.map(e => e.reason).join('\n'), tags: ['warning'] }]);
        continue; // retried next sync
      }
      if (c.action === 'reset') {
        st.account = freshAccount();
        st.position = null; st.closing = []; st.summary = null; st.meta = {};
        if (c.clearHistory) st.trades = [];
        await notify.push([{
          title: `${COIN} reset (balance back to ${P.STARTING_BALANCE} USDT)`,
          message: `Position closed, tracking restarted${c.clearHistory ? ', trade history cleared' : ''}. Trading continues from the next 4H close.`,
          tags: ['arrows_counterclockwise'],
        }]);
      } else {
        await notify.push([{
          title: `${COIN} position closed`,
          message: `${evs.some(e => e.type === 'info') ? 'Closed at market' : 'Nothing was open'}; orders cancelled. The bot keeps running and can enter again on the next breakout.`,
          tags: ['octagonal_sign'],
        }]);
      }
    } else {
      events.push({ type: 'error', reason: `unknown command ${c.action} (${c.id})` });
    }
    st.commandsDone.push(c.id);
    ran = true;
  }
  return ran;
}

const sigParams = () => ({ channelN: config.CHANNEL_N, exitN: config.EXIT_N, atrLen: config.ATR_LEN });

// The signal series for the closed 4H candles: ATLAS flip (scored for the
// last 60 candles — the exit / trailing checks and the dashboard chart) or
// the breakout channel.
async function buildSignal(candles, now) {
  if (config.STRATEGY === 'atlas-flip') {
    const daily = await market.closedCandles(config.SYMBOL, 'D', 400, now);
    if (daily.note) console.log(`daily candles from ${daily.source} (${market.primary()} failed: ${daily.note})`);
    return flip.series(candles, daily.candles, { threshold: config.FLIP_SCORE, window: config.FLIP_WINDOW, trendBandPct: config.TREND_BAND_PCT, extremeScore: config.EXTREME_SCORE }, Math.max(0, candles.length - 60));
  }
  return signal.series(candles, sigParams());
}

async function run() {
  const client = exchangeClient(); // fail fast on missing keys
  const st = loadState();
  checkExchange(st);
  const events = [];
  await runCommands(client, st, events);

  const now = Date.now();
  const { candles, source, note } = await market.closedCandles(config.SYMBOL, config.ENTRY_TF, 500, now);
  if (note) console.log(`candles from ${source} (${market.primary()} failed: ${note})`);
  const sig = await buildSignal(candles, now);
  const halt = /^(1|true|yes)$/i.test(process.env.TRADEBOT_HALT || '');
  await exchange.runExchange({ client, st, sig, events, halt, now });

  const last = sig[sig.length - 1];
  st.signal = last && {
    ...last, closeT: last.t + market.TF_MS[config.ENTRY_TF], source, at: now,
    wait: exchange.entryBlock(st, last, now, { halt }),
    strategy: config.STRATEGY,
    // The last 60 closed candles + their channel (breakout) or ATLAS score (flip), for the dashboard chart.
    chart: candles.slice(-60).map((k, i, a) => {
      const s = sig[sig.length - a.length + i];
      const r = (x) => (x == null ? null : +x.toFixed(1));
      return [k.t, k.o, k.h, k.l, k.c, s ? r(s.upper) : null, s ? r(s.exitLower) : null, s && s.score != null ? s.score : null];
    }),
  };
  // Combined daily / status pushes come from the lead coin only (it runs last, so the others' state is fresh).
  const daily = LEAD ? summary.due(st) : null;
  // Status push once per due hour, however many runs that hour has.
  const hour = Math.floor(now / 3600000);
  const status = LEAD && !daily && config.NOTIFY.HOURLY_STATUS && summary.statusDue(now) && st.meta.lastStatusHour !== hour;
  if (status) st.meta = { ...st.meta, lastStatusHour: hour };
  saveState(st, { fullRun: true });
  printSummary(events, st);
  await notify.send(events, st);
  if (daily) await notify.push([daily]);
  else if (status) await notify.push([summary.status(st)]);
}

// Quick reconcile between hourly runs: books fills and notices a stop-out.
// No candles are passed, so it never opens, exits or trails anything.
async function syncOnExchange() {
  const client = exchangeClient();
  const st = loadState();
  checkExchange(st);
  // Live mark/P&L fields change constantly; only real changes (fills,
  // closes, stop moves) trigger a save and upload.
  const snapshot = () => JSON.stringify([st.position, st.trades, st.closing, st.account.balance],
    (k, v) => (k === 'markPrice' || k === 'unrealisedPnl' ? undefined : v));
  const before = snapshot();
  const events = [];
  const ranCommand = await runCommands(client, st, events);
  await exchange.runExchange({ client, st, events });
  const settingsChanged = JSON.stringify(require('./settings').current(config)) !== JSON.stringify(st.account.settings)
    || JSON.stringify(config.SETTINGS_ERRORS) !== JSON.stringify(st.account.settingsErrors || []);
  if (!ranCommand && !settingsChanged && snapshot() === before) { console.log(`[${MODE}] sync: no changes`); return; }
  // A stop-out since the last full run changes what the dashboard says it's waiting for.
  if (st.signal) st.signal.wait = exchange.entryBlock(st, st.signal, Date.now(), { halt: /^(1|true|yes)$/i.test(process.env.TRADEBOT_HALT || '') });
  saveState(st);
  printSummary(events, st);
  await notify.send(events, st);
}

async function closeAllOnExchange() {
  const st = loadState();
  checkExchange(st);
  const events = [];
  await exchange.closeAll({ client: exchangeClient(), st, events });
  saveState(st);
  printSummary(events, st);
  // Non-zero exit if it failed, so scripts/reset.sh stops before wiping the
  // bot's tracking of a position that's still open.
  if (events.some(e => e.type === 'error')) process.exitCode = 1;
}

function reset() {
  const st = loadState();
  st.account = freshAccount();
  st.position = null;
  st.closing = [];
  st.meta = {};
  saveState(st); // trade history is kept
  console.log(`Tracking reset to ${P.STARTING_BALANCE} USDT (this step alone doesn't touch the exchange; scripts/reset.sh also closes the position there).`);
}

/* ---------------- output ---------------- */

function printSummary(events, st) {
  const quote = config.EXCHANGE !== 'okx' ? 'USDT' : require('./okx').isSpot(config.OKX_INSTRUMENT) ? config.OKX_INSTRUMENT.split('-')[1]
    : /-USD_/.test(config.OKX_INSTRUMENT) ? 'USDC' : 'USDT';
  console.log(`\n=== BTCTradeBot ${COIN} [${config.EXCHANGE} ${MODE}${config.EXCHANGE === 'okx' ? ' ' + config.OKX_INSTRUMENT : ''}] (${config.STRATEGY}, ${P.STARTING_BALANCE} ${quote}, ${P.RISK_PCT}% risk, ${config.DIRECTION === 'both' ? 'long+short' : 'long-only'}) @ ${new Date().toISOString()} ===\n`);
  for (const ev of events) {
    if (ev.type === 'enter') {
      const why = ev.breakout != null ? `breakout ${px(ev.breakout)}` : (ev.flipFrom == null ? `ATLAS extreme ${ev.score}` : `ATLAS ${ev.flipFrom} → ${ev.score}`);
      console.log(`ENTER ${ev.bias === 1 ? 'LONG' : 'SHORT'} ${ev.qty} ${COIN} @ ${px(ev.entry)} | ${why} | SL ${px(ev.stop)} | value $${fmt(ev.notional)} risk $${fmt(ev.riskAmt)}`);
    } else if (ev.type === 'exit') {
      console.log(`EXIT — ${ev.reason} | pnl ${money(ev.pnl)}${ev.price ? ' @ ' + px(ev.price) : ''}`);
    } else {
      console.log(`${ev.type} — ${ev.reason}`);
    }
  }
  const s = st.signal;
  if (s && s.upper == null) console.log(`\n4H close ${px(s.close)} · ATLAS score ${s.score} (swing ±${config.FLIP_SCORE} within ${config.FLIP_WINDOW} candles) · ATR ${px(s.atr)}${s.wait ? ' · ' + s.wait : ''}`);
  else if (s) console.log(`\n4H close ${px(s.close)} · breakout above ${px(s.upper)}${config.DIRECTION === 'both' ? ` / below ${px(s.lower)}` : ''} · ATR ${px(s.atr)}${s.wait ? ' · ' + s.wait : ''}`);
  const p = st.position;
  console.log(`balance $${fmt(st.account.balance)} (started $${fmt(st.account.startingBalance)})` +
    (p ? ` · ${p.bias === 1 ? 'long' : 'short'} ${p.qty} ${COIN} @ ${px(p.entry)}, stop ${px(p.stop)}` : ' · flat'));
}
function fmt(x) { return (Math.round(x * 100) / 100).toLocaleString('en-US'); }
function px(x) { return require('./format').price(x, 1); }
function money(x) { return `${x < 0 ? '-' : '+'}$${fmt(Math.abs(x))}`; }

if (process.argv.includes('--reset')) {
  reset();
} else if (process.argv.includes('--sync')) {
  syncOnExchange().catch((err) => { console.error(err); process.exit(1); });
} else if (process.argv.includes('--close-all')) {
  closeAllOnExchange().catch((err) => { console.error(err); process.exit(1); });
} else {
  run().catch((err) => { console.error(err); process.exit(1); });
}
