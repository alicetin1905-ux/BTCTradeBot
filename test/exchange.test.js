// Exercises the signal and src/exchange.js against an in-memory stand-in for
// Bybit, so the order flow can be checked without network access or API keys.
'use strict';

// Tests run on config.js defaults, never on the live control/settings.json.
process.env.TRADEBOT_SETTINGS = 'off';
process.env.NTFY_TOPIC = 'off';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const config = require('../config');
// These tests were written for long-only 20/20 channels; pin that so changing
// the live defaults in config.js doesn't change what's tested.
config.STRATEGY = 'breakout';
config.DIRECTION = 'long';
config.PORTFOLIO.RISK_PCT = 2;
config.TRADE_MODE = 'atr'; // these tests are about the ATR rules; fixed mode has its own tests at the end
config.CHANNEL_N = 20;
config.EXIT_N = 20;
const signal = require('../src/signal');
const exchange = require('../src/exchange');
const { sign, createClient } = require('../src/bybit');

const H = 3600000, TF = 4 * H;
const INST = { qtyStep: 0.001, minOrderQty: 0.001, minNotional: 5, tickSize: 0.1 };

function fakeBybit({ equity = 10000, mark = 100000 } = {}) {
  let seq = 0;
  const ex = {
    equity, marks: { BTCUSDT: mark, SOLUSDT: 200 }, positions: {}, closedPnl: [], funding: [], calls: [],
    id: () => 'o' + (++seq),
    // Test helper: the exchange stop triggers at its price.
    hitStop(symbol = 'BTCUSDT', at = Date.now()) {
      const p = ex.positions[symbol];
      ex.closedPnl.push({ symbol, orderId: ex.id(), qty: p.size, exit: p.stopLoss, pnl: (p.stopLoss - p.avgPrice) * p.bias * p.size, at });
      delete ex.positions[symbol];
    },
  };
  const client = {
    async getWallet() {
      const im = Object.values(ex.positions).reduce((s, p) => s + p.size * p.avgPrice / 5, 0);
      return { equity: ex.equity, available: ex.equity - im };
    },
    async getPositions() {
      const out = JSON.parse(JSON.stringify(ex.positions));
      for (const p of Object.values(out)) p.markPrice = ex.marks[p.symbol];
      return out;
    },
    async getInstrument() { return INST; },
    async getMarkPrice(s) { return ex.marks[s]; },
    async setLeverage(s, l) { ex.calls.push(['setLeverage', s, l]); },
    async openMarket({ symbol, bias, qty, stopLoss, takeProfit }) {
      ex.calls.push(['openMarket', symbol, bias, qty, stopLoss]);
      const m = ex.marks[symbol];
      ex.positions[symbol] = { symbol, bias, size: qty, avgPrice: m, stopLoss, takeProfit, markPrice: m, unrealisedPnl: 0 };
      return ex.id();
    },
    async setStopLoss(symbol, sl) {
      const p = ex.positions[symbol];
      if ((ex.marks[symbol] - sl) * p.bias <= 0) throw new Error('SL on wrong side of mark');
      p.stopLoss = sl;
      ex.calls.push(['setStopLoss', symbol, sl]);
    },
    async closeMarket({ symbol, qty }) {
      const p = ex.positions[symbol];
      const id = ex.id();
      const m = ex.marks[symbol];
      ex.closedPnl.push({ symbol, orderId: id, qty, exit: m, pnl: (m - p.avgPrice) * p.bias * qty, at: Date.now() });
      delete ex.positions[symbol];
      ex.calls.push(['closeMarket', symbol, qty]);
      return id;
    },
    async cancelAll(symbol) { ex.calls.push(['cancelAll', symbol]); },
    async getClosedPnl(symbol, since) { return ex.closedPnl.filter(r => r.symbol === symbol && r.at >= since); },
    async getFundingFees() { return ex.funding; },
  };
  return { ex, client };
}

function freshState() {
  return { account: { balance: 2000, startingBalance: 2000 }, position: null, trades: [], closing: [], seenOrderIds: [], meta: {} };
}

// A signal candle as signal.series() returns it. t = its open time.
function S(t, close, o = {}) {
  return {
    t, close, atr: 1000, upper: close - 500, lower: close - 5000, exitUpper: close + 5000, exitLower: close - 5000,
    enter: 0, exitLong: false, exitShort: false, ...o,
  };
}
// A run 2 minutes after the candle opened at t closed.
const after = (t) => t + TF + 2 * 60000;
const T0 = Date.UTC(2026, 8, 30, 8); // a 4H candle open time

async function enterLong(client, st, { t = T0, close = 100000 } = {}) {
  const events = [];
  await exchange.runExchange({ client, st, sig: [S(t, close, { enter: 1 })], events, now: after(t) });
  return events;
}

/* ---------------- signal ---------------- */

test('signal: a 4H close above the previous 20-candle high enters long; a close below the exit channel exits', () => {
  const flat = Array.from({ length: 30 }, (_, i) => ({ t: i * TF, o: 100, h: 101, l: 99, c: 100 }));
  const up = [...flat, { t: 30 * TF, o: 100, h: 105.5, l: 100, c: 105 }];
  const s = signal.latest(up, { channelN: 20, exitN: 20, atrLen: 14 });
  assert.equal(s.enter, 1);
  assert.equal(s.upper, 101);
  assert.equal(s.exitLong, false);
  // A close exactly at the channel is not a breakout.
  assert.equal(signal.latest([...flat, { t: 30 * TF, o: 100, h: 101, l: 100, c: 101 }], { channelN: 20, exitN: 20, atrLen: 14 }).enter, 0);
  const down = [...up, { t: 31 * TF, o: 105, h: 105, l: 94, c: 95 }];
  const d = signal.latest(down, { channelN: 20, exitN: 20, atrLen: 14 });
  assert.equal(d.exitLong, true);
  assert.equal(d.enter, -1);
  assert.equal(signal.allowed(-1, 'long'), false);
  assert.equal(signal.allowed(-1, 'both'), true);
  assert.equal(signal.allowed(1, 'long'), true);
  // Not enough history -> null.
  assert.equal(signal.latest(flat.slice(0, 10), { channelN: 20, exitN: 20, atrLen: 14 }), null);
});

test('trail: best close since entry minus 3 ATR, never loosens', () => {
  const sig = [S(0, 100000), S(TF, 104000), S(2 * TF, 103000), S(3 * TF, 102000, { atr: 500 })];
  const r = signal.trail({ bias: 1, stop: 98000, ext: 100000, sig, fromT: TF, trailAtr: 3 });
  assert.equal(r.ext, 104000);
  assert.equal(r.stop, 104000 - 3 * 500); // tighter ATR on the last candle tightens it further
  const s = signal.trail({ bias: -1, stop: 102000, ext: 100000, sig: [S(TF, 97000)], fromT: TF, trailAtr: 3 });
  assert.deepEqual(s, { stop: 100000, ext: 97000 });
  // Earlier candles (before fromT) don't count.
  assert.equal(signal.trail({ bias: 1, stop: 98000, ext: 100000, sig: [S(0, 110000)], fromT: TF, trailAtr: 3 }).stop, 98000);
});

/* ---------------- entries ---------------- */

test('entry: market buy with the stop attached, sized so the stop loses 2% of the 2000 allocation', async () => {
  const { ex, client } = fakeBybit({ equity: 50000 }); // a big demo wallet still trades like 2000 USDT
  const st = freshState();
  const events = await enterLong(client, st);
  // stop 2 ATR = 2000 = 2% away; risk $40 -> $2000 position -> 0.02 BTC
  assert.deepEqual(ex.calls.find(c => c[0] === 'openMarket'), ['openMarket', 'BTCUSDT', 1, 0.02, 98000]);
  assert.deepEqual(ex.calls.find(c => c[0] === 'setLeverage'), ['setLeverage', 'BTCUSDT', 10]);
  const p = st.position;
  assert.equal(p.bias, 1);
  assert.equal(p.entry, 100000);
  assert.equal(p.stop, 98000);
  assert.equal(p.riskAmt, 40);
  assert.equal(p.entryCandleT, T0);
  assert.equal(events.find(e => e.type === 'enter').qty, 0.02);
  assert.equal(st.meta.lastEntryCandle, T0);
});

test('sizing: a tight stop is capped at 2x the balance; the smaller of allocation and equity is used', async () => {
  assert.equal(exchange.notionalFor(2000, 0.02), 2000);
  assert.equal(exchange.notionalFor(2000, 0.005), 4000); // would be 8000 -> capped
  assert.equal(exchange.sizingBase({ account: { balance: 2000 } }, { equity: 1500 }), 1500);
  const { ex, client } = fakeBybit({ equity: 1000 });
  const st = freshState();
  await enterLong(client, st);
  assert.equal(ex.calls.find(c => c[0] === 'openMarket')[3], 0.01); // 2% of 1000 equity
});

test('no entry: stale breakout, short in long-only mode, the same candle twice, halted, untracked BTC position', async () => {
  const cases = [
    ['stale', (st, c) => exchange.runExchange({ client: c, st, sig: [S(T0, 100000, { enter: 1 })], events: [], now: T0 + TF + 181 * 60000 }), /min ago/],
    ['short', (st, c) => exchange.runExchange({ client: c, st, sig: [S(T0, 100000, { enter: -1 })], events: [], now: after(T0) }), /long-only/],
    ['same candle', (st, c) => { st.meta.lastEntryCandle = T0; return enterLong(c, st); }, /already entered/],
    ['halt', (st, c) => exchange.runExchange({ client: c, st, sig: [S(T0, 100000, { enter: 1 })], events: [], now: after(T0), halt: true }), /halted/],
  ];
  for (const [name, fn, why] of cases) {
    const { ex, client } = fakeBybit();
    const st = freshState();
    await fn(st, client);
    assert.equal(ex.calls.filter(c => c[0] === 'openMarket').length, 0, name);
    assert.match(exchange.entryBlock(st, S(T0, 100000, { enter: name === 'short' ? -1 : 1 }), name === 'stale' ? T0 + TF + 181 * 60000 : after(T0), { halt: name === 'halt' }), why, name);
  }
  // A BTCUSDT position the bot didn't open: left alone, no entry on top of it.
  const { ex, client } = fakeBybit();
  ex.positions.BTCUSDT = { symbol: 'BTCUSDT', bias: 1, size: 0.5, avgPrice: 90000, stopLoss: 0, markPrice: 100000 };
  const st = freshState();
  const events = await enterLong(client, st);
  assert.equal(ex.calls.filter(c => c[0] === 'openMarket' || c[0] === 'closeMarket').length, 0);
  assert.match(events.find(e => e.type === 'hold').reason, /didn't open/);
});

test('positions on other coins (e.g. TradeBot\'s) are ignored', async () => {
  const { ex, client } = fakeBybit();
  ex.positions.SOLUSDT = { symbol: 'SOLUSDT', bias: -1, size: 10, avgPrice: 200, stopLoss: 210, markPrice: 200 };
  const st = freshState();
  await enterLong(client, st);
  assert.ok(st.position);
  assert.ok(ex.positions.SOLUSDT);
  assert.equal(ex.calls.filter(c => c[1] === 'SOLUSDT').length, 0);
});

test('daily loss limit (10%) blocks new entries for the rest of the UTC day', async () => {
  const { ex, client } = fakeBybit();
  const st = freshState();
  st.account.balance = 1790;
  st.trades.push({ pnl: -210, closedAt: after(T0) - 60000, openedAt: T0 - TF });
  const events = await enterLong(client, st);
  assert.equal(ex.calls.filter(c => c[0] === 'openMarket').length, 0);
  assert.match(events.find(e => e.type === 'hold').reason, /daily loss limit/);
});

/* ---------------- managing the position ---------------- */

test('the stop trails on Bybit after 4H closes, only when it tightens; a stop-out is booked as "trailing stop"', async () => {
  const { ex, client } = fakeBybit();
  const st = freshState();
  await enterLong(client, st);
  const t1 = T0 + TF, t2 = T0 + 2 * TF;
  ex.marks.BTCUSDT = 106000;
  let events = [];
  await exchange.runExchange({ client, st, sig: [S(T0, 100000, { enter: 1 }), S(t1, 106000)], events, now: after(t1) });
  assert.deepEqual(ex.calls.filter(c => c[0] === 'setStopLoss'), [['setStopLoss', 'BTCUSDT', 103000]]);
  assert.equal(st.position.stop, 103000);
  // A lower close doesn't loosen it (and nothing is sent to Bybit).
  ex.marks.BTCUSDT = 104000;
  await exchange.runExchange({ client, st, sig: [S(t1, 106000), S(t2, 104000)], events: [], now: after(t2) });
  assert.equal(ex.calls.filter(c => c[0] === 'setStopLoss').length, 1);
  // Syncs (no candles) never trail.
  await exchange.runExchange({ client, st, events: [], now: after(t2) + 5 * 60000 });
  assert.equal(ex.calls.filter(c => c[0] === 'setStopLoss').length, 1);
  // Bybit's stop fires; the next sync books it.
  ex.hitStop('BTCUSDT', after(t2) + 6 * 60000);
  events = [];
  await exchange.runExchange({ client, st, events, now: after(t2) + 10 * 60000 });
  assert.equal(st.position, null);
  assert.equal(st.trades.length, 1);
  assert.equal(st.trades[0].reason, 'trailing stop');
  assert.equal(st.trades[0].pnl, 60); // (103000 - 100000) x 0.02
  assert.equal(st.account.balance, 2060);
  assert.equal(events.find(e => e.type === 'exit').pnl, 60);
});

test('exit signal: a 4H close through the exit channel closes at market and books the P&L', async () => {
  const { ex, client } = fakeBybit();
  const st = freshState();
  await enterLong(client, st);
  const t1 = T0 + TF;
  ex.marks.BTCUSDT = 97500;
  const events = [];
  await exchange.runExchange({ client, st, sig: [S(t1, 97500, { exitLong: true, exitLower: 97800 })], events, now: after(t1) });
  assert.ok(ex.calls.some(c => c[0] === 'closeMarket'));
  assert.equal(st.position, null);
  assert.match(st.trades[0].reason, /^exit signal/);
  assert.equal(st.trades[0].pnl, -50);
  assert.equal(st.account.balance, 1950);
  // The late closed-pnl record isn't booked twice.
  await exchange.runExchange({ client, st, events: [], now: after(t1) + 5 * 60000 });
  assert.equal(st.trades.length, 1);
});

test('a missed run still exits: any exit signal since the last check counts', async () => {
  const { ex, client } = fakeBybit();
  const st = freshState();
  await enterLong(client, st);
  const t1 = T0 + TF, t2 = T0 + 2 * TF;
  ex.marks.BTCUSDT = 99000;
  await exchange.runExchange({ client, st, sig: [S(t1, 97500, { exitLong: true }), S(t2, 99000)], events: [], now: after(t2) });
  assert.equal(st.position, null);
});

test('trailing stop already passed by the price: closes at market instead', async () => {
  const { ex, client } = fakeBybit();
  const st = freshState();
  await enterLong(client, st);
  const t1 = T0 + TF;
  ex.marks.BTCUSDT = 102500; // the 4H closed at 106000, price has fallen since
  await exchange.runExchange({ client, st, sig: [S(t1, 106000)], events: [], now: after(t1) });
  assert.equal(ex.calls.filter(c => c[0] === 'setStopLoss').length, 0);
  assert.ok(ex.calls.some(c => c[0] === 'closeMarket'));
  assert.match(st.trades[0].reason, /trailing stop .* already passed/);
});

test('long + short: the exit signal closes the long and the short breakout opens in the same run', async () => {
  const saved = config.DIRECTION;
  config.DIRECTION = 'both';
  try {
    const { ex, client } = fakeBybit();
    const st = freshState();
    await enterLong(client, st);
    const t1 = T0 + TF;
    ex.marks.BTCUSDT = 95000; // long closes at -$100 -> balance 1900 -> 2% = $38 at a 2000 stop
    await exchange.runExchange({ client, st, sig: [S(t1, 95000, { exitLong: true, enter: -1 })], events: [], now: after(t1) });
    assert.equal(st.trades.length, 1);
    assert.equal(st.position.bias, -1);
    assert.deepEqual(ex.calls.filter(c => c[0] === 'openMarket').pop(), ['openMarket', 'BTCUSDT', -1, 0.019, 97000]);
  } finally { config.DIRECTION = saved; }
});

test('funding fees: BTCUSDT payments booked once into the balance; other coins ignored', async () => {
  const { ex, client } = fakeBybit();
  const st = freshState();
  st.account.fundingSince = T0;
  await enterLong(client, st);
  ex.funding = [
    { id: 'f1', symbol: 'BTCUSDT', amount: -0.4, at: after(T0) + H },
    { id: 'f2', symbol: 'SOLUSDT', amount: -5, at: after(T0) + H },
  ];
  await exchange.runExchange({ client, st, events: [], now: after(T0) + 2 * H });
  await exchange.runExchange({ client, st, events: [], now: after(T0) + 3 * H });
  assert.equal(st.account.funding.total, -0.4);
  assert.equal(st.account.balance, 1999.6);
  assert.equal(st.position.funding, -0.4);
});

test('close-all: cancels orders, closes the BTC position, leaves other coins', async () => {
  const { ex, client } = fakeBybit();
  const st = freshState();
  await enterLong(client, st);
  ex.positions.SOLUSDT = { symbol: 'SOLUSDT', bias: 1, size: 1, avgPrice: 200, markPrice: 200 };
  const events = [];
  const now = Date.now(); // the fake exchange stamps the close record with the real clock
  await exchange.closeAll({ client, st, events, now });
  assert.equal(ex.positions.BTCUSDT, undefined);
  assert.ok(ex.positions.SOLUSDT);
  assert.equal(st.position, null);
  await exchange.runExchange({ client, st, events: [], now: now + 60000 });
  assert.equal(st.trades[0].reason, 'closed by close-all');
});

test('stops round away from the price on Bybit\'s tick', () => {
  assert.equal(exchange.stopRound(98000.07, 0.1, 1), 98000);
  assert.equal(exchange.stopRound(101999.93, 0.1, -1), 102000);
});

/* ---------------- settings, clients, alerts ---------------- */

test('settings.json: valid overrides apply, bad ones keep the default and are reported', () => {
  const { apply } = require('../src/settings');
  const cfg = JSON.parse(JSON.stringify({ ...config, SETTINGS_APPLIED: undefined }));
  const r = apply(cfg, { RISK_PCT: 1.5, DIRECTION: 'both', TRAIL_ATR: 99, SYMBOL: 'ETHUSDT', CHANNEL_N: 30, _note: 'x' });
  assert.deepEqual(r.applied, { RISK_PCT: 1.5, DIRECTION: 'both', CHANNEL_N: 30 });
  assert.equal(cfg.PORTFOLIO.RISK_PCT, 1.5);
  assert.equal(cfg.TRAIL_ATR, 3);
  assert.equal(r.errors.length, 2);
  assert.match(r.errors.join('\n'), /TRAIL_ATR: must be between/);
  assert.match(r.errors.join('\n'), /SYMBOL: unknown setting/);
  assert.match(apply(cfg, { DIRECTION: 'short' }).errors[0], /must be one of "long", "both"/);
});

test('request signing matches Bybit v5; the client only knows Demo Trading', async () => {
  const expected = crypto.createHmac('sha256', 'sec').update('1700000000000' + 'key' + '10000' + 'category=linear').digest('hex');
  assert.equal(sign('sec', '1700000000000', 'key', 'category=linear'), expected);
  let seen;
  const fetchImpl = async (url, opts) => { seen = { url, opts }; return { status: 200, text: async () => JSON.stringify({ retCode: 0, result: { orderId: 'x1' } }) }; };
  const c = createClient({ env: 'demo', apiKey: 'key', apiSecret: 'sec', fetchImpl });
  await c.openMarket({ symbol: 'BTCUSDT', bias: 1, qty: 0.02, stopLoss: 98000 });
  assert.equal(seen.url, 'https://api-demo.bybit.com/v5/order/create');
  const body = JSON.parse(seen.opts.body);
  assert.deepEqual([body.side, body.orderType, body.qty, body.stopLoss, body.category], ['Buy', 'Market', '0.02', '98000', 'linear']);
  assert.equal(seen.opts.headers['X-BAPI-SIGN'], sign('sec', seen.opts.headers['X-BAPI-TIMESTAMP'], 'key', seen.opts.body));
  assert.throws(() => createClient({ apiKey: 'k', apiSecret: 's', env: 'live' }), /only supports demo/);
});

test('market data: closed candles only, from the trading exchange first, the other when it fails', async () => {
  const market = require('../src/market');
  const savedEx = config.EXCHANGE;
  config.EXCHANGE = 'bybit';
  const now = Date.UTC(2026, 8, 30, 9, 1);
  const open = Date.UTC(2026, 8, 30, 8); // the forming 08:00 candle
  const bybitRows = [open, open - TF, open - 2 * TF].map((t, i) => [String(t), '1', '2', '0.5', String(100 + i), '10', '0']);
  market.setFetch(async (url) => ({ status: 200, text: async () => JSON.stringify({ retCode: 0, result: { list: bybitRows } }) }));
  let r = await market.closedCandles('BTCUSDT', '240', 2, now);
  assert.equal(r.source, 'bybit');
  assert.deepEqual(r.candles.map(c => c.t), [open - 2 * TF, open - TF]);
  market.setFetch(async (url) => {
    if (url.includes('bybit')) return { status: 403, text: async () => 'blocked' };
    return { status: 200, text: async () => JSON.stringify({ code: '0', data: [open, open - TF].map(t => [String(t), '1', '2', '0.5', '1.5', '0', '10']) }) };
  });
  r = await market.closedCandles('BTCUSDT', '240', 2, now);
  assert.equal(r.source, 'okx');
  assert.match(r.note, /HTTP 403/);
  assert.deepEqual(r.candles.map(c => c.t), [open - TF]);
  // Trading on OKX: OKX candles first, no Bybit call at all.
  config.EXCHANGE = 'okx';
  const urls = [];
  market.setFetch(async (url) => { urls.push(url); return { status: 200, text: async () => JSON.stringify({ code: '0', data: [open, open - TF].map(t => [String(t), '1', '2', '0.5', '1.5', '0', '10']) }) }; });
  r = await market.closedCandles('BTCUSDT', '240', 2, now);
  assert.equal(r.source, 'okx');
  assert.ok(urls.every(u => u.startsWith('https://www.okx.com/api/v5/market/candles?instId=BTC-USDT-SWAP&bar=4H')));
  config.EXCHANGE = savedEx;
});

test('ntfy alerts: entry, exit and a quiet trailed-stop note; holds and placeholders are left out', () => {
  const notify = require('../src/notify');
  const st = { account: { balance: 2060 } };
  const m = notify.messagesFor([
    { type: 'enter', bias: 1, entry: 100000, stop: 98000, qty: 0.02, notional: 2000, riskAmt: 40, breakout: 99500, close: 100000 },
    { type: 'hold', reason: 'x' },
    { type: 'info', reason: 'stop trailed 98,000.0 → 103,000.0' },
    { type: 'exit', reason: 'closed on exchange (P&L record pending)', pnl: 0 },
    { type: 'exit', reason: 'trailing stop', pnl: 60, price: 103000 },
  ], st);
  assert.deepEqual(m.map(x => x.title), ['BTC LONG opened @ 100,000.0', 'BTC stop trailed', 'BTC closed +$60.00']);
  assert.equal(m[1].priority, 2);
  assert.match(m[0].message, /broke the 20-candle high 99,500.0/);
  assert.match(m[2].message, /Balance \$2060.00$/);
});

test('status push: flat shows the next breakout level; a position shows its live P&L and stop', () => {
  const summary = require('../src/summary');
  const flat = summary.status({ account: { balance: 2000, startingBalance: 2000 }, position: null, signal: { close: 100000, upper: 103000, lower: 95000 } });
  assert.match(flat.message, /BTC flat · 4H close 100,000 · long above 103,000/);
  const open = summary.status({ account: { balance: 2000, startingBalance: 2000 }, position: { bias: 1, qty: 0.02, entry: 100000, stop: 103000, trailed: true, unrealisedPnl: 100 } });
  assert.equal(open.title, 'Bot $2100.00 (+5.0%)');
  assert.match(open.message, /BTC long 0.02 @ 100,000 · \+\$100.00 · stop 103,000 \(trailed\)/);
  // Two coins: the peer's position and the combined equity.
  const both = summary.status({ account: { balance: 2000, startingBalance: 2000 }, position: { bias: 1, qty: 0.02, entry: 100000, stop: 98000, unrealisedPnl: 100 },
    peers: { ETH: { position: { bias: -1, qty: 1, entry: 4000, stop: 4200, unrealisedPnl: -30 }, trades: [], signal: null } } });
  assert.equal(both.title, 'Bot $2070.00 (+3.5%)');
  assert.match(both.message, /BTC long 0.02 @ 100,000/);
  assert.match(both.message, /ETH short 1 @ 4,000 · -\$30.00 · stop 4,200/);
  const at = (h) => Date.UTC(2026, 8, 24, h, 1);
  assert.deepEqual([0, 1, 4, 11, 12, 20, 23].map(h => summary.statusDue(at(h))), [true, false, true, false, true, true, false]);
});

test('watchdog: alert when the bot stops, repeat every 6h, all-clear when back', () => {
  const { check } = require('../scripts/watchdog');
  const t0 = Date.UTC(2026, 8, 23, 0, 1);
  let wd = { down: false };
  let r = check({ lastRun: t0, wd, now: t0 + 1.5 * H });
  assert.equal(r.message, null);
  r = check({ lastRun: t0, wd, now: t0 + 2.5 * H });
  assert.equal(r.message.title, 'BTC bot is not running'); wd = r.wd;
  r = check({ lastRun: t0, wd, now: t0 + 4 * H });
  assert.equal(r.message, null); wd = r.wd;
  r = check({ lastRun: t0, wd, now: t0 + 8.6 * H });
  assert.equal(r.message.title, 'BTC bot is not running'); wd = r.wd;
  r = check({ lastRun: t0 + 9 * H, wd, now: t0 + 9.2 * H });
  assert.equal(r.message.title, 'BTC bot is running again');
});

test('backtest replays the live signal: a breakout, a trailed stop, fees and funding', () => {
  const { simulate, bucket } = require('../scripts/backtest');
  // 1H candles: flat, then a steady climb, then a sharp drop.
  const h1 = [];
  let p = 100000;
  for (let i = 0; i < 24 * 40; i++) {
    const t = Date.UTC(2026, 0, 1) + i * H;
    const drift = i < 24 * 20 ? 0 : i < 24 * 30 ? 40 : -300;
    const o = p; p += drift + (i % 2 ? 30 : -30);
    h1.push({ t, o, h: Math.max(o, p) + 20, l: Math.min(o, p) - 20, c: p, v: 1 });
  }
  const r = simulate(h1, bucket(h1, 4), {});
  assert.ok(r.trades >= 1);
  const tr = r.tradeList[0];
  assert.equal(tr.bias, 1);
  assert.ok(['trailing stop', 'exit signal'].includes(tr.reason), tr.reason);
});

test('back-to-back trades keep their own fills: a quick second close is not claimed by the first', async () => {
  const saved = config.DIRECTION;
  config.DIRECTION = 'both';
  try {
    const { ex, client } = fakeBybit();
    const st = freshState();
    // The fake stamps market closes with the real clock, so run near it.
    const Tn = Math.floor(Date.now() / TF) * TF - TF, now0 = Tn + TF + 60000, t1 = now0 + 1000;
    await exchange.runExchange({ client, st, sig: [S(Tn - TF, 100000, { enter: 1 })], events: [], now: now0 - TF });
    // Exit signal + short breakout in one run: the long closes, the short opens.
    ex.marks.BTCUSDT = 99000;
    await exchange.runExchange({ client, st, sig: [S(Tn, 99000, { exitLong: true, enter: -1 })], events: [], now: t1 });
    assert.equal(st.position.bias, -1);
    // The short's stop fires within a minute; the sync books it to the short.
    ex.hitStop('BTCUSDT', t1 + 20000);
    await exchange.runExchange({ client, st, events: [], now: t1 + 30000 });
    assert.deepEqual(st.trades.map(t => [t.bias, t.reason.split(':')[0]]), [[1, 'exit signal'], [-1, 'stop']]);
  } finally { config.DIRECTION = saved; }
});

/* ---------------- OKX demo client ---------------- */

// A minimal stand-in for OKX's v5 REST API: records every request and
// answers by path. state.posMode switches net / long-short mode.
function fakeOkx(state = {}) {
  const S = { posMode: 'net_mode', positions: [], algos: [], fills: [], bills: [], calls: [], seq: 0, ...state };
  const ok = (data) => ({ status: 200, text: async () => JSON.stringify({ code: '0', msg: '', data }) });
  const fetchImpl = async (url, opts = {}) => {
    const u = new URL(url), path = u.pathname, body = opts.body ? JSON.parse(opts.body) : null;
    S.calls.push({ method: opts.method, path, query: Object.fromEntries(u.searchParams), body, headers: opts.headers || {} });
    switch (path) {
      case '/api/v5/public/instruments': return ok([{ instId: 'BTC-USDT-SWAP', ctVal: '0.01', lotSz: '0.01', minSz: '0.01', tickSz: '0.1' }]);
      case '/api/v5/public/mark-price': return ok([{ markPx: String(S.mark || 100000) }]);
      case '/api/v5/account/config': return ok([{ posMode: S.posMode, acctLv: S.acctLv || '2' }]);
      case '/api/v5/account/balance': return ok(S.balance || [{ totalEq: '5000', details: [{ ccy: 'USDT', eq: '5000.5', availEq: '4800' }] }]);
      case '/api/v5/account/positions': return ok(S.positions);
      case '/api/v5/account/set-leverage': return ok([{}]);
      case '/api/v5/trade/order': return ok([{ ordId: 'ord' + (++S.seq), sCode: '0' }]);
      case '/api/v5/trade/orders-algo-pending': return ok(S.algos.filter(a => a.ordType === u.searchParams.get('ordType')));
      case '/api/v5/trade/amend-algos':
        if (S.amendFails) return { status: 200, text: async () => JSON.stringify({ code: '1', msg: '', data: [{ sCode: '51000', sMsg: 'cannot amend' }] }) };
        return ok([{ algoId: body.algoId, sCode: '0' }]);
      case '/api/v5/trade/order-algo':
        if (S.oneTpSl && S.algos.length) return { status: 200, text: async () => JSON.stringify({ code: '1', msg: '', data: [{ sCode: '51088', sMsg: 'You can only place 1 TP/SL order to close an entire position' }] }) };
        return ok([{ algoId: 'alg' + (++S.seq), sCode: '0' }]);
      case '/api/v5/trade/cancel-algos': S.algos = []; return ok(body.map(x => ({ algoId: x.algoId, sCode: '0' })));
      case '/api/v5/trade/orders-pending': return ok([]);
      case '/api/v5/trade/fills-history': return ok(S.fills.slice().reverse());
      case '/api/v5/account/bills': return ok(S.bills);
      default: return { status: 404, text: async () => 'not found' };
    }
  };
  return { S, fetchImpl };
}
const okxClient = (f) => require('../src/okx').createClient({ apiKey: 'k', apiSecret: 's', passphrase: 'p', fetchImpl: f.fetchImpl });

test('OKX: signed like v5 (base64 HMAC of ts+method+path+body), always demo, keys required', async () => {
  const { sign } = require('../src/okx');
  assert.equal(sign('s', '2026-10-01T00:00:00.000Z', 'GET', '/api/v5/account/balance?ccy=USDT', ''),
    crypto.createHmac('sha256', 's').update('2026-10-01T00:00:00.000ZGET/api/v5/account/balance?ccy=USDT').digest('base64'));
  const f = fakeOkx();
  assert.deepEqual(await okxClient(f).getWallet(), { equity: 5000.5, available: 4800 });
  const h = f.S.calls.find(x => x.path === '/api/v5/account/balance').headers;
  assert.equal(h['x-simulated-trading'], '1');
  assert.equal(h['OK-ACCESS-PASSPHRASE'], 'p');
  assert.equal(h['OK-ACCESS-SIGN'], sign('s', h['OK-ACCESS-TIMESTAMP'], 'GET', '/api/v5/account/balance', ''));
  // Futures mode with no USDT: nothing to trade with (never the other coins' USD value).
  const g = fakeOkx({ balance: [{ totalEq: '480000', details: [{ ccy: 'BTC', eq: '5', eqUsd: '420000' }] }] });
  assert.deepEqual(await okxClient(g).getWallet(), { equity: 0, available: 0 });
  // Multi-currency margin: every coin counts, minus margin in use.
  const m = fakeOkx({ acctLv: '3', balance: [{ totalEq: '480000', adjEq: '470000', imr: '1000', details: [] }] });
  assert.deepEqual(await okxClient(m).getWallet(), { equity: 470000, available: 469000 });
  assert.throws(() => require('../src/okx').createClient({ apiKey: 'k', apiSecret: 's' }), /OKX_API_PASSPHRASE/);
});

test('OKX: sizes in BTC become contracts; the entry carries its stop-loss; long/short mode adds posSide', async () => {
  const f = fakeOkx();
  const c = okxClient(f);
  assert.deepEqual(await c.getInstrument('BTCUSDT'), { qtyStep: 0.0001, minOrderQty: 0.0001, minNotional: 0, tickSize: 0.1 });
  await c.setLeverage('BTCUSDT', 5);
  await c.openMarket({ symbol: 'BTCUSDT', bias: 1, qty: 0.0234, stopLoss: 98000 });
  const order = f.S.calls.find(x => x.path === '/api/v5/trade/order').body;
  assert.deepEqual(order, { instId: 'BTC-USDT-SWAP', tdMode: 'cross', side: 'buy', ordType: 'market', sz: '2.34',
    attachAlgoOrds: [{ slTriggerPx: '98000', slOrdPx: '-1', slTriggerPxType: 'mark' }] });
  assert.deepEqual(f.S.calls.find(x => x.path === '/api/v5/account/set-leverage').body, { instId: 'BTC-USDT-SWAP', lever: '5', mgnMode: 'cross' });

  // With a take-profit it rides on the same attached algo order (one OCO pair on OKX).
  const h = fakeOkx();
  await okxClient(h).openMarket({ symbol: 'BTCUSDT', bias: -1, qty: 0.05, stopLoss: 102000, takeProfit: 96000 });
  assert.deepEqual(h.S.calls.find(x => x.path === '/api/v5/trade/order').body.attachAlgoOrds,
    [{ slTriggerPx: '102000', slOrdPx: '-1', slTriggerPxType: 'mark', tpTriggerPx: '96000', tpOrdPx: '-1', tpTriggerPxType: 'mark' }]);

  const g = fakeOkx({ posMode: 'long_short_mode' });
  await okxClient(g).closeMarket({ symbol: 'BTCUSDT', bias: -1, qty: 0.03 });
  const close = g.S.calls.find(x => x.path === '/api/v5/trade/order').body;
  assert.deepEqual([close.side, close.posSide, close.sz, close.reduceOnly], ['buy', 'short', '3', true]);
  await assert.rejects(okxClient(fakeOkx({ acctLv: '1' })).setLeverage('BTCUSDT', 5), /Spot mode/);
});

test('OKX: positions keyed like Bybit, size in BTC, stop read from the stop-loss algo', async () => {
  const f = fakeOkx({
    positions: [
      { instId: 'BTC-USDT-SWAP', pos: '-3', posSide: 'net', avgPx: '100000', markPx: '99000', upl: '30' },
      { instId: 'SOL-USDT-SWAP', pos: '5', posSide: 'net', avgPx: '200', markPx: '201', upl: '5' },
    ],
    algos: [{ ordType: 'conditional', algoId: 'a1', instId: 'BTC-USDT-SWAP', slTriggerPx: '102000' }],
  });
  const p = await okxClient(f).getPositions();
  assert.deepEqual(p.BTCUSDT, { symbol: 'BTCUSDT', bias: -1, size: 0.03, avgPrice: 100000, markPrice: 99000, unrealisedPnl: 30, stopLoss: 102000, takeProfit: null });
  assert.equal(p.SOLUSDT.bias, 1);
});

test('OKX: moving the stop amends the stop-loss algo; wrong side of the mark is refused', async () => {
  const f = fakeOkx({
    mark: 106000,
    positions: [{ instId: 'BTC-USDT-SWAP', pos: '2', posSide: 'net', avgPx: '100000', markPx: '106000', upl: '120' }],
    algos: [{ ordType: 'conditional', algoId: 'a1', instId: 'BTC-USDT-SWAP', slTriggerPx: '98000' }],
  });
  const c = okxClient(f);
  await c.setStopLoss('BTCUSDT', 103000);
  assert.deepEqual(f.S.calls.find(x => x.path === '/api/v5/trade/amend-algos').body,
    { instId: 'BTC-USDT-SWAP', algoId: 'a1', newSlTriggerPx: '103000', newSlOrdPx: '-1', newSlTriggerPxType: 'mark' });
  await assert.rejects(c.setStopLoss('BTCUSDT', 107000), /wrong side/);
  // No stop algo at all: a whole-position stop is placed.
  f.S.algos = [];
  await c.setStopLoss('BTCUSDT', 103500);
  const placed = f.S.calls.find(x => x.path === '/api/v5/trade/order-algo').body;
  assert.deepEqual([placed.side, placed.ordType, placed.slTriggerPx, placed.closeFraction, placed.reduceOnly], ['sell', 'conditional', '103500', '1', true]);
});

test('OKX: realized P&L per closing order from fills, net of its fee and its share of the entry fee', async () => {
  const f = fakeOkx({
    fills: [
      { billId: '1', ordId: 'open', side: 'buy', fillSz: '2', fillPx: '100000', fee: '-1.1', fillPnl: '0', ts: '1000' },
      { billId: '2', ordId: 'tp', side: 'sell', fillSz: '1', fillPx: '101000', fee: '-0.5', fillPnl: '10', ts: '2000' },
      { billId: '3', ordId: 'sl', side: 'sell', fillSz: '1', fillPx: '102000', fee: '-0.6', fillPnl: '20', ts: '3000' },
    ],
    bills: [{ billId: 'b1', instId: 'BTC-USDT-SWAP', balChg: '-0.35', ts: '2500' }],
  });
  const c = okxClient(f);
  const r = await c.getClosedPnl('BTCUSDT', 0);
  assert.deepEqual(r.map(x => [x.orderId, x.qty, x.exit, +x.pnl.toFixed(2), x.at]), [['tp', 0.01, 101000, 8.95, 2000], ['sl', 0.01, 102000, 18.85, 3000]]);
  assert.deepEqual(await c.getFundingFees(0), [{ id: 'b1', symbol: 'BTCUSDT', amount: -0.35, at: 2500 }]);
});

test('Actions failure alerts: on the first failure, every 6h while failing, all-clear once', () => {
  const { decide } = require('../scripts/actions-alert');
  const t0 = Date.UTC(2026, 9, 1);
  let r = decide({ ok: true, prev: { failing: false }, now: t0 });
  assert.equal(r.message, null);
  r = decide({ ok: false, prev: r.state, now: t0, lastLines: 'OKX 50110: IP' });
  assert.equal(r.message.title, 'BTC bot run failed');
  assert.match(r.message.message, /50110/);
  r = decide({ ok: false, prev: r.state, now: t0 + 30 * 60000 });
  assert.equal(r.message, null);
  r = decide({ ok: false, prev: r.state, now: t0 + 6 * H + 60000 });
  assert.equal(r.message.title, 'BTC bot run failed');
  assert.equal(r.state.since, t0);
  r = decide({ ok: true, prev: r.state, now: t0 + 7 * H });
  assert.equal(r.message.title, 'BTC bot runs work again');
  assert.deepEqual(r.state, { failing: false });
});

/* ---------------- OKX spot (BTC-USDC) ---------------- */

// A stateful stand-in for OKX spot: market orders fill at S.mark (buy fee in
// BTC, sell fee in USDC, 0.1%), stop-loss algo orders live in S.algos,
// S.triggerStop() fires the bot's stop.
function fakeOkxSpot(state = {}) {
  const S = { mark: 100000, usdc: 5000, algos: [], orders: {}, fills: [], calls: [], seq: 0, failStop: false, ...state };
  const ok = (data) => ({ status: 200, text: async () => JSON.stringify({ code: '0', msg: '', data }) });
  const fail = (code, msg) => ({ status: 200, text: async () => JSON.stringify({ code: '1', msg: '', data: [{ sCode: code, sMsg: msg }] }) });
  const fill = (ordId, side, sz, px, t) => {
    const fee = side === 'buy' ? -sz * 0.001 : -sz * px * 0.001;
    S.fills.push({ billId: String(++S.seq), ordId, side, fillSz: String(sz), fillPx: String(px), fee: String(fee), feeCcy: side === 'buy' ? 'BTC' : 'USDC', ts: String(t || Date.now()) });
    return fee;
  };
  S.triggerStop = (t) => {
    const a = S.algos.find(x => String(x.algoClOrdId).startsWith('btcbot'));
    S.algos = S.algos.filter(x => x !== a);
    fill('stop' + (++S.seq), 'sell', +a.sz, +a.slTriggerPx, t);
  };
  const fetchImpl = async (url, opts = {}) => {
    const u = new URL(url), path = u.pathname, q = Object.fromEntries(u.searchParams), body = opts.body ? JSON.parse(opts.body) : null;
    S.calls.push({ method: opts.method, path, query: q, body });
    switch (path) {
      case '/api/v5/public/instruments': return ok([{ instId: 'BTC-USDC', lotSz: '0.00000001', minSz: '0.0001', tickSz: '0.1' }]);
      case '/api/v5/market/ticker': return ok([{ instId: 'BTC-USDC', last: String(S.mark) }]);
      case '/api/v5/account/balance': return ok([{ details: [{ ccy: 'USDC', eq: String(S.usdc), availBal: String(S.usdc) }] }]);
      case '/api/v5/trade/order':
        if (opts.method === 'GET') return ok([S.orders[q.ordId]]);
        {
          const id = 'ord' + (++S.seq), sz = +body.sz;
          const fee = fill(id, body.side, sz, S.mark);
          S.orders[id] = { ordId: id, state: 'filled', accFillSz: String(sz), avgPx: String(S.mark), fee: String(fee), feeCcy: body.side === 'buy' ? 'BTC' : 'USDC' };
          return ok([{ ordId: id, sCode: '0' }]);
        }
      case '/api/v5/trade/order-algo':
        if (S.failStop) return fail('51000', 'stop rejected');
        S.algos.push({ algoId: 'alg' + (++S.seq), instId: 'BTC-USDC', side: body.side, sz: body.sz, slTriggerPx: body.slTriggerPx, algoClOrdId: body.algoClOrdId });
        return ok([{ algoId: 'alg' + S.seq, sCode: '0' }]);
      case '/api/v5/trade/orders-algo-pending': return ok(S.algos);
      case '/api/v5/trade/amend-algos': S.algos.find(a => a.algoId === body.algoId).slTriggerPx = body.newSlTriggerPx; return ok([{ algoId: body.algoId, sCode: '0' }]);
      case '/api/v5/trade/cancel-algos': S.algos = S.algos.filter(a => !body.some(b => b.algoId === a.algoId)); return ok(body.map(b => ({ algoId: b.algoId, sCode: '0' })));
      case '/api/v5/trade/orders-pending': return ok([]);
      case '/api/v5/trade/fills-history': return ok(S.fills.filter(f => +f.ts >= +(q.begin || 0)).slice().reverse());
      default: return { status: 404, text: async () => 'not found' };
    }
  };
  return { S, fetchImpl };
}
const spotClient = (f) => require('../src/okx').createClient({ apiKey: 'k', apiSecret: 's', passphrase: 'p', fetchImpl: f.fetchImpl, instrument: 'btc-usdc' });

test('OKX spot: buys BTC, then a stop for exactly what arrived; only the bot\'s own stop counts as its position', async () => {
  const f = fakeOkxSpot({ algos: [{ algoId: 'mine', instId: 'BTC-USDC', side: 'sell', sz: '1', slTriggerPx: '50000', algoClOrdId: 'manual1' }] });
  const c = spotClient(f);
  assert.equal(c.spot, true);
  assert.deepEqual(await c.getWallet(), { equity: 5000, available: 5000 });
  assert.deepEqual(await c.getPositions(), {}); // someone else's stop isn't the bot's position
  await c.openMarket({ symbol: 'BTCUSDT', bias: 1, qty: 0.02, stopLoss: 98000 });
  const buy = f.S.calls.find(x => x.path === '/api/v5/trade/order' && x.method === 'POST').body;
  assert.deepEqual([buy.side, buy.ordType, buy.tgtCcy, buy.sz, buy.tdMode], ['buy', 'market', 'base_ccy', '0.02', 'cash']);
  const stop = f.S.calls.find(x => x.path === '/api/v5/trade/order-algo').body;
  assert.deepEqual([stop.side, stop.ordType, stop.sz, stop.slTriggerPx, stop.slOrdPx, stop.slTriggerPxType], ['sell', 'conditional', '0.01998', '98000', '-1', 'last']);
  assert.match(stop.algoClOrdId, /^btcbot/);
  const p = (await c.getPositions()).BTCUSDT;
  assert.deepEqual([p.bias, p.size, p.avgPrice, p.stopLoss], [1, 0.01998, 100000, 98000]);
  await assert.rejects(c.openMarket({ symbol: 'BTCUSDT', bias: -1, qty: 0.01, stopLoss: 102000 }), /long-only/);
});

test('OKX spot: if the stop can\'t be placed, the bought BTC is sold again', async () => {
  const f = fakeOkxSpot({ failStop: true });
  await assert.rejects(spotClient(f).openMarket({ symbol: 'BTCUSDT', bias: 1, qty: 0.02, stopLoss: 98000 }), /sold again/);
  const orders = f.S.calls.filter(x => x.path === '/api/v5/trade/order' && x.method === 'POST').map(x => [x.body.side, x.body.sz]);
  assert.deepEqual(orders, [['buy', '0.02'], ['sell', '0.01998']]);
});

test('OKX spot through the bot: entry, trailed stop, stop hit booked with fees on both sides', async () => {
  const f = fakeOkxSpot();
  const client = spotClient(f);
  const st = freshState();
  const savedLev = config.PORTFOLIO.LEVERAGE, savedX = config.PORTFOLIO.MAX_POSITION_X;
  Object.assign(config.PORTFOLIO, { LEVERAGE: 1, MAX_POSITION_X: 1 }); // as run.js sets them for spot
  try {
    // A run 1 minute after the last 4H close (the fake stamps fills with the real clock, so stay before it).
    const Tn = Math.floor(Date.now() / TF) * TF - TF;
    const now0 = Tn + TF + 60000;
    await exchange.runExchange({ client, st, sig: [S(Tn, 100000, { enter: 1 })], events: [], now: now0 });
    const pos = st.position;
    assert.equal(pos.entry, 100000);
    assert.equal(pos.qty, 0.01998); // 0.02 bought, 0.1% fee taken in BTC
    assert.equal(pos.stop, 98000);
    // Next 4H close at 106000: the stop trails to 103000 on OKX.
    f.S.mark = 106000;
    await exchange.runExchange({ client, st, sig: [S(Tn + TF, 106000)], events: [], now: now0 + 1000 });
    assert.equal(f.S.algos[0].slTriggerPx, '103000');
    assert.ok(Math.abs(st.position.unrealisedPnl - 0.01998 * 6000) < 1e-6);
    // The stop fires; the next sync books it.
    f.S.triggerStop(Date.now());
    await exchange.runExchange({ client, st, events: [], now: now0 + 2000 });
    assert.equal(st.position, null);
    const t = st.trades[0];
    assert.equal(t.reason, 'trailing stop');
    // proceeds 0.01998 x 103000 minus 0.1% fee, minus the 2000 USDC the 0.02 BTC cost
    const expected = 0.01998 * 103000 * 0.999 - 2000;
    assert.ok(Math.abs(t.pnl - expected) < 1e-6, `${t.pnl} vs ${expected}`);
    assert.ok(Math.abs(st.account.balance - (2000 + expected)) < 1e-6);
  } finally { Object.assign(config.PORTFOLIO, { LEVERAGE: savedLev, MAX_POSITION_X: savedX }); }
});

/* ---------------- OKX USD-settled future (EEA): BTC-USD_UM_XPERP ---------------- */

test('OKX XPERP future: 1 BTC contracts, USDC margin, 10x, FUTURES endpoints, its funding only', async () => {
  const XP = 'BTC-USD_UM_XPERP-310328';
  const f = fakeOkx({
    positions: [{ instId: XP, pos: '0.0234', posSide: 'net', avgPx: '100000', markPx: '101000', upl: '23.4' }],
    algos: [{ ordType: 'conditional', algoId: 'a1', instId: XP, slTriggerPx: '98000' }],
    bills: [
      { billId: 'b1', instId: XP, balChg: '-0.2', ts: '1000' },
      { billId: 'b2', instId: 'ETH-USD_UM_XPERP-310328', balChg: '-9', ts: '1000' },
    ],
    balance: [{ totalEq: '483000', details: [{ ccy: 'USD', eq: '100000', availEq: '' }, { ccy: 'USDC', eq: '1999.94', availEq: '1999.94' }] }],
  });
  // The fake's instrument row for this future.
  const orig = f.fetchImpl;
  f.fetchImpl = async (url, opts) => (url.includes('/public/instruments')
    ? { status: 200, text: async () => JSON.stringify({ code: '0', data: [{ instId: XP, ctVal: '1', lotSz: '0.0001', minSz: '0.0001', tickSz: '0.1', settleCcy: 'USD' }] }) }
    : orig(url, opts));
  const c = require('../src/okx').createClient({ apiKey: 'k', apiSecret: 's', passphrase: 'p', fetchImpl: f.fetchImpl, instrument: XP, symbol: 'BTCUSDT' });
  assert.equal(c.spot, undefined);
  assert.equal(await c.marginCcy(), 'USDC');
  assert.deepEqual(await c.getWallet(), { equity: 1999.94, available: 1999.94 });
  assert.deepEqual(await c.getInstrument('BTCUSDT'), { qtyStep: 0.0001, minOrderQty: 0.0001, minNotional: 0, tickSize: 0.1 });
  const p = await c.getPositions();
  assert.deepEqual(p.BTCUSDT, { symbol: 'BTCUSDT', bias: 1, size: 0.0234, avgPrice: 100000, markPrice: 101000, unrealisedPnl: 23.4, stopLoss: 98000, takeProfit: null });
  await c.setLeverage('BTCUSDT', 10);
  await c.openMarket({ symbol: 'BTCUSDT', bias: 1, qty: 0.0234, stopLoss: 98000 });
  assert.deepEqual(f.S.calls.find(x => x.path === '/api/v5/account/set-leverage').body, { instId: XP, lever: '10', mgnMode: 'cross' });
  const order = f.S.calls.find(x => x.path === '/api/v5/trade/order').body;
  assert.deepEqual([order.instId, order.side, order.sz, order.attachAlgoOrds[0].slTriggerPx], [XP, 'buy', '0.0234', '98000']);
  assert.ok(f.S.calls.filter(x => x.path === '/api/v5/trade/orders-algo-pending' || x.path === '/api/v5/account/positions').every(x => x.query.instType === 'FUTURES'));
  assert.deepEqual(await c.getFundingFees(0), [{ id: 'b1', symbol: 'BTCUSDT', amount: -0.2, at: 1000 }]);
  assert.equal(require('../src/okx').isSpot(XP), false);
  assert.equal(require('../src/okx').isSpot('BTC-USDC'), true);
  assert.equal(require('../src/okx').isSpot('BTC-USDT-SWAP'), false);
});

test('signal candles: live market data — a demo-only future reads the live BTC-USDT perpetual', () => {
  const market = require('../src/market');
  const saved = [config.EXCHANGE, config.OKX_INSTRUMENT];
  try {
    config.EXCHANGE = 'okx';
    for (const [inst, want] of [['BTC-USD_UM_XPERP-310328', 'BTC-USDT-SWAP'], ['BTC-USDT-SWAP', 'BTC-USDT-SWAP'], ['BTC-USDC', 'BTC-USDC']]) {
      config.OKX_INSTRUMENT = inst;
      assert.equal(market.okxSignalInstrument('BTCUSDT'), want, inst);
    }
  } finally { [config.EXCHANGE, config.OKX_INSTRUMENT] = saved; }
});

test('OKX isolated margin: orders, stop and leverage use mgnMode/tdMode isolated', async () => {
  const f = fakeOkx({ positions: [{ instId: 'BTC-USDT-SWAP', pos: '2', posSide: 'net', avgPx: '100000', markPx: '106000', upl: '0' }], mark: 106000 });
  const c = require('../src/okx').createClient({ apiKey: 'k', apiSecret: 's', passphrase: 'p', fetchImpl: f.fetchImpl, marginMode: 'isolated' });
  assert.equal(c.marginMode, 'isolated');
  await c.setLeverage('BTCUSDT', 10);
  await c.openMarket({ symbol: 'BTCUSDT', bias: 1, qty: 0.02, stopLoss: 98000 });
  await c.setStopLoss('BTCUSDT', 103000); // no stop algo in the fake -> a new one is placed
  await c.closeMarket({ symbol: 'BTCUSDT', bias: 1, qty: 0.02 });
  assert.equal(f.S.calls.find(x => x.path === '/api/v5/account/set-leverage').body.mgnMode, 'isolated');
  assert.deepEqual(f.S.calls.filter(x => x.path === '/api/v5/trade/order' || x.path === '/api/v5/trade/order-algo').map(x => x.body.tdMode), ['isolated', 'isolated', 'isolated']);
  // Long/short mode: leverage set for both sides.
  const g = fakeOkx({ posMode: 'long_short_mode' });
  await require('../src/okx').createClient({ apiKey: 'k', apiSecret: 's', passphrase: 'p', fetchImpl: g.fetchImpl, marginMode: 'isolated' }).setLeverage('BTCUSDT', 10);
  assert.deepEqual(g.S.calls.filter(x => x.path === '/api/v5/account/set-leverage').map(x => x.body.posSide), ['long', 'short']);
});

test('entry read-back: a position that shows up a moment late is still tracked', async () => {
  exchange.setReadbackMs(0);
  const { ex, client } = fakeBybit();
  let hidden = 2; // the first two position reads after the order come back empty
  const getPositions = client.getPositions;
  client.getPositions = async () => {
    const p = await getPositions();
    if (p.BTCUSDT && hidden > 0) { hidden--; return {}; }
    return p;
  };
  const st = freshState();
  const events = await enterLong(client, st);
  assert.ok(st.position, JSON.stringify(events));
  assert.equal(st.position.qty, 0.02);
  assert.equal(events.filter(e => e.type === 'error').length, 0);
  exchange.setReadbackMs(500);
});

/* ---------------- ATLAS flip strategy ---------------- */

test('ATLAS flip rule: -25 or lower then +25 or higher within the window -> long; mirror -> short', () => {
  const { swing } = require('../src/flip');
  assert.deepEqual(swing(30, [-40, -10, 5], 25), { enter: 1, flipFrom: -40 });
  assert.deepEqual(swing(25, [-25, 0, 10], 25), { enter: 1, flipFrom: -25 });   // exactly at the levels counts
  assert.deepEqual(swing(24, [-60, 0, 10], 25), { enter: 0, flipFrom: null });  // not bullish enough yet
  assert.deepEqual(swing(40, [-24, 0, 10], 25), { enter: 0, flipFrom: null });  // never bearish enough in the window
  assert.deepEqual(swing(-31, [45, 20, 0], 25), { enter: -1, flipFrom: 45 });
  assert.deepEqual(swing(-31, [10, 20, 0], 25), { enter: 0, flipFrom: null });
});

test('ATLAS flip series: the bot scores candles exactly like the backtest (same window, UTC days)', () => {
  const { series, scoreAt } = require('../src/flip');
  // A synthetic trend: 600 4H candles down, then up — enough history for the 400-candle window.
  const c4 = [], d1 = [];
  let p = 100000;
  for (let i = 0; i < 600; i++) {
    const t = Date.UTC(2026, 0, 1) + i * TF, o = p;
    p *= i < 480 ? 0.999 : 1.006;
    c4.push({ t, o, h: Math.max(o, p) * 1.002, l: Math.min(o, p) * 0.998, c: p, v: 100 + (i % 7) });
  }
  for (let i = 0; i < c4.length; i += 6) {
    const g = c4.slice(i, i + 6);
    if (g.length === 6) d1.push({ t: g[0].t, o: g[0].o, h: Math.max(...g.map(x => x.h)), l: Math.min(...g.map(x => x.l)), c: g[5].c, v: 1 });
  }
  const s = series(c4, d1, { threshold: 25, window: 3 }, 470); // the swing comes around candle 482
  assert.equal(s.length, 130);
  assert.ok(s.every(x => x && Number.isFinite(x.score) && x.atr > 0));
  // The same candle scored on its own gives the same score (what a live run does for its last candle).
  const last = scoreAt(c4, d1, c4.length - 1);
  assert.equal(s[s.length - 1].score, last.score);
  // Downtrend scores bearish, the later rally bullish, and the swing between them is an entry.
  assert.ok(scoreAt(c4, d1, 470).score <= -25);
  assert.ok(s.some(x => x.enter === 1));
  assert.ok(s.every(x => x.upper === null && x.exitLong === (x.enter === -1)));
});

test('ATLAS flip through the bot: an opposite swing closes the long (and reverses), with the reason in words', async () => {
  const saved = [config.DIRECTION, config.STRATEGY];
  Object.assign(config, { DIRECTION: 'both', STRATEGY: 'atlas-flip' });
  try {
    const { ex, client } = fakeBybit();
    const st = freshState();
    const flipSig = (t, close, score, flipFrom, enter) => ({ t, close, atr: 1000, score, flipFrom, enter, exitLong: enter === -1, exitShort: enter === 1, upper: null, lower: null, exitUpper: null, exitLower: null });
    const events = [];
    await exchange.runExchange({ client, st, sig: [flipSig(T0, 100000, 30, -40, 1)], events, now: after(T0) });
    assert.equal(st.position.bias, 1);
    assert.equal(st.position.score, 30);
    const notify = require('../src/notify');
    assert.match(notify.messagesFor(events, st)[0].message, /ATLAS score swung -40 → \+30 within 8h/);
    const t1 = T0 + TF;
    ex.marks.BTCUSDT = 99000;
    await exchange.runExchange({ client, st, sig: [flipSig(t1, 99000, -28, 35, -1)], events: [], now: after(t1) });
    assert.match(st.trades[0].reason, /exit signal: ATLAS score swung \+35 → -28 against the long/);
    assert.equal(st.position.bias, -1);
    // Status push when flat describes the rule instead of a channel level.
    const summary = require('../src/summary');
    const m = summary.status({ account: { balance: 2000, startingBalance: 2000 }, position: null, signal: flipSig(t1, 99000, -12, null, 0) });
    assert.match(m.message, /ATLAS -12/);
    assert.match(m.message, /swing from −10 to \+10 within 8h or a score of \+80, short on the mirror/);
  } finally { [config.DIRECTION, config.STRATEGY] = saved; }
});

test('settings: STRATEGY / FLIP_SCORE / FLIP_WINDOW are adjustable within limits', () => {
  const { apply } = require('../src/settings');
  const cfg = JSON.parse(JSON.stringify({ ...config, SETTINGS_APPLIED: undefined }));
  const r = apply(cfg, { STRATEGY: 'breakout', FLIP_SCORE: 35, FLIP_WINDOW: 99 });
  assert.deepEqual(r.applied, { STRATEGY: 'breakout', FLIP_SCORE: 35 });
  assert.match(r.errors[0], /FLIP_WINDOW: must be between 1 and 12/);
});

test('ATLAS flip trend band: a swing far from the 200-candle average is ignored, a near one trades', () => {
  const atlas = require('../src/atlasScore'), flip = require('../src/flip');
  const real = atlas.analyse;
  // Stub the scorer: each candle carries its own score in `v`.
  atlas.analyse = ({ candles }) => { const c = candles[240]; return { score: c[c.length - 2].v, atr: 1 }; };
  try {
    const run = (closeNow, band) => {
      const c4 = Array.from({ length: 260 }, (_, i) => ({ t: i * 14400000, o: 100, h: 100, l: 100, c: 100, v: 0 }));
      c4[257].v = -40; c4[259].v = 30; c4[259].c = closeNow;
      return flip.series(c4, [], { threshold: 25, window: 3, trendBandPct: band }, 255).find(s => s && s.t === 259 * 14400000);
    };
    assert.equal(run(105, 10).enter, 1);                 // 5% above the average: trades
    const far = run(120, 10);                            // 20% above: ignored, and says why
    assert.equal(far.enter, 0); assert.equal(far.blocked, true); assert.equal(far.exitShort, false);
    assert.equal(run(120, null).enter, 1);               // band off: trades
  } finally { atlas.analyse = real; }
});

test('daily loss limit counts the other coins\' trades too', () => {
  const now = Date.UTC(2026, 9, 1, 12);
  const sig = { t: now - 4 * 3600000 - 600000, close: 100000, atr: 1000, enter: 1, upper: 99000, lower: 90000 };
  const st = freshState();
  st.account.balance = 2000;
  assert.equal(exchange.entryBlock(st, sig, now), null);
  // ETH lost 12% of the balance today: no BTC entry either.
  st.peers = { ETH: { trades: [{ closedAt: now - 3600000, pnl: -240 }] } };
  assert.match(exchange.entryBlock(st, sig, now), /daily loss limit/);
  st.peers = { ETH: { trades: [{ closedAt: now - 3600000, pnl: -100 }] } };
  assert.equal(exchange.entryBlock(st, sig, now), null);
});

test('ATLAS flip extreme entry: a close at +/-EXTREME_SCORE enters once (fresh crossing), inside the trend band', () => {
  const atlas = require('../src/atlasScore'), flip = require('../src/flip');
  const real = atlas.analyse;
  atlas.analyse = ({ candles }) => { const c = candles[240]; return { score: c[c.length - 2].v, atr: 1 }; };
  try {
    const run = (scores, closeNow = 100, extremeScore = 90, trendBandPct = 10) => {
      const c4 = Array.from({ length: 260 }, (_, i) => ({ t: i * 14400000, o: 100, h: 100, l: 100, c: 100, v: 0 }));
      scores.forEach((v, i) => { c4[260 - scores.length + i].v = v; });
      c4[259].c = closeNow;
      return flip.series(c4, [], { threshold: 25, window: 3, trendBandPct, extremeScore }, 255).find(s => s && s.t === 259 * 14400000);
    };
    let s = run([0, 0, 85, 92]);                       // crosses +90 now: long, no swing behind it
    assert.equal(s.enter, 1); assert.equal(s.extreme, true); assert.equal(s.flipFrom, null); assert.equal(s.exitShort, true);
    assert.equal(run([0, 0, 95, 93]).enter, 0);        // already above 90 on the candle before: not a fresh crossing
    s = run([0, 0, -85, -91]);                         // short mirror
    assert.equal(s.enter, -1); assert.equal(s.extreme, true);
    assert.equal(run([0, 0, 85, 92], 100, null).enter, 0);          // off
    s = run([0, 0, 85, 92], 120);                      // 20% above its average: band rules it out
    assert.equal(s.enter, 0); assert.equal(s.blocked, true);
    s = run([-40, -5, 10, 30]);                        // an ordinary swing still enters as before
    assert.equal(s.enter, 1); assert.equal(s.extreme, false); assert.equal(s.flipFrom, -40);
  } finally { atlas.analyse = real; }
});

test('price text keeps the decimals a cheap coin needs (NEAR 4.807), BTC / ETH as before', () => {
  const { price } = require('../src/format');
  assert.equal(price(84625.55, 1), '84,625.6');
  assert.equal(price(84625.55, 0), '84,626');
  assert.equal(price(2696.84), '2,696.8');
  assert.equal(price(255.1234), '255.12');
  assert.equal(price(4.8071), '4.807');
  assert.equal(price(0.123456), '0.12346');
  assert.equal(price(NaN), '—');
});

test('settings: COIN_RISK_PCT gives single coins their own risk, validated', () => {
  const { apply, current } = require('../src/settings');
  const cfg = JSON.parse(JSON.stringify({ PORTFOLIO: { RISK_PCT: 2, MAX_POSITION_X: 2, LEVERAGE: 10, STARTING_BALANCE: 2000 }, EXECUTION: { DAILY_LOSS_LIMIT_PCT: 10 }, NOTIFY: { STATUS_EVERY_H: 4 }, COIN_RISK_PCT: { NEAR: 1 }, TRADE_MODE: 'fixed', FIXED: { MARGIN: 500, SL_USDT: 100, TP_USDT: 200 }, STRATEGY: 'atlas-flip', FLIP_SCORE: 10, FLIP_WINDOW: 2, EXTREME_SCORE: 90, TREND_BAND_PCT: 10, DIRECTION: 'both', CHANNEL_N: 15, EXIT_N: 15, STOP_ATR: 2, TRAIL_ATR: 3, ENTRY_FRESH_MIN: 180, MARKET_DATA: null, SCORE_MODE: 'graded' }));
  assert.deepEqual(current(cfg).COIN_RISK_PCT, { NEAR: 1 });
  let r = apply(cfg, { COIN_RISK_PCT: { NEAR: 0.5, ETH: 3 } });
  assert.deepEqual(cfg.COIN_RISK_PCT, { NEAR: 0.5, ETH: 3 }); assert.equal(r.errors.length, 0);
  r = apply(cfg, { COIN_RISK_PCT: { NEAR: 50 } });
  assert.match(r.errors[0], /COIN_RISK_PCT: NEAR must be a number between 0.1 and 10/);
  assert.deepEqual(cfg.COIN_RISK_PCT, { NEAR: 0.5, ETH: 3 }); // bad value: kept
  r = apply(cfg, { COIN_RISK_PCT: null });
  assert.deepEqual(cfg.COIN_RISK_PCT, {});
});

test('fixed mode: 500 margin x 10x = $5000, stop-loss -$100 (2%), take-profit +$200 (4%), no trailing, no signal exit', async () => {
  config.TRADE_MODE = 'fixed';
  const dir = config.DIRECTION; config.DIRECTION = 'both';
  try {
    for (const bias of [1, -1]) {
      const { ex, client } = fakeBybit();
      const st = freshState();
      const flipSig = (t, close, score, flipFrom, enter) => ({ t, close, atr: 1000, score, flipFrom, enter, exitLong: enter === -1, exitShort: enter === 1, upper: null, lower: null, exitUpper: null, exitLower: null });
      const events = [];
      await exchange.runExchange({ client, st, sig: [flipSig(T0, 100000, 30 * bias, -40 * bias, bias)], events, now: after(T0) });
      const p = st.position;
      assert.equal(p.fixed, true);
      assert.equal(p.bias, bias);
      const mark = ex.marks.BTCUSDT;
      assert.ok(Math.abs(p.qty * mark - 5000) < 5000 * 0.01, 'position value about $5000: ' + p.qty * mark);
      assert.ok(Math.abs(p.qty * Math.abs(mark - p.stop) - 100) < 2, 'loss at the stop about $100: ' + p.qty * Math.abs(mark - p.stop));
      assert.ok(Math.abs(p.qty * Math.abs(p.takeProfit - mark) - 200) < 4, 'gain at the take-profit about $200');
      assert.equal(Math.sign(p.takeProfit - mark), bias);        // target on the winning side
      assert.equal(ex.positions.BTCUSDT.takeProfit, p.takeProfit); // sent to the exchange with the order
      const enter = events.find(e => e.type === 'enter');
      assert.equal(enter.takeProfit, p.takeProfit);
      assert.match(require('../src/notify').messagesFor(events, st)[0].message, /take profit .* \(fixed\)/);
      // Next 4H close, an opposite swing and a trail-worthy move: a fixed position is left alone.
      const t1 = T0 + TF;
      ex.marks.BTCUSDT = mark * (1 + 0.01 * bias);
      const before = ex.calls.length;
      await exchange.runExchange({ client, st, sig: [flipSig(t1, mark * (1 + 0.01 * bias), -30 * bias, 40 * bias, -bias)], events: [], now: after(t1) });
      assert.ok(st.position, 'still open');
      assert.deepEqual(ex.calls.slice(before).filter(c => ['setStopLoss', 'closeMarket'].includes(c[0])), []);
      // The exchange fires the take-profit: booked as "take profit".
      ex.closedPnl.push({ symbol: 'BTCUSDT', orderId: ex.id(), qty: p.qty, exit: p.takeProfit, pnl: 200, at: Date.now() });
      delete ex.positions.BTCUSDT;
      await exchange.runExchange({ client, st, events: [], now: after(t1) });
      assert.equal(st.position, null);
      assert.equal(st.trades.at(-1).reason, 'take profit');
    }
  } finally { config.TRADE_MODE = 'atr'; config.DIRECTION = dir; }
});

test('fixed mode: a stop-loss hit is booked as "stop loss"; spot coins keep the ATR rules', async () => {
  config.TRADE_MODE = 'fixed';
  try {
    const { ex, client } = fakeBybit();
    const st = freshState();
    const sig = { t: T0, close: 100000, atr: 1000, score: 30, flipFrom: -40, enter: 1, exitLong: false, exitShort: false, upper: null, lower: null, exitUpper: null, exitLower: null };
    await exchange.runExchange({ client, st, sig: [sig], events: [], now: after(T0) });
    const p = st.position;
    ex.hitStop('BTCUSDT', Date.now());
    await exchange.runExchange({ client, st, events: [], now: after(T0) });
    assert.equal(st.trades.at(-1).reason, 'stop loss');
    assert.ok(Math.abs(st.trades.at(-1).pnl + 100) < 2, 'lost about $100: ' + st.trades.at(-1).pnl);
    // A spot client (no leverage) is not sized by the fixed rules.
    const spot = fakeBybit();
    spot.client.spot = true;
    const st2 = freshState();
    await exchange.runExchange({ client: spot.client, st: st2, sig: [{ ...sig, t: T0 + TF }], events: [], now: after(T0 + TF) });
    assert.equal(st2.position.fixed, false);
    assert.equal(st2.position.takeProfit, null);
  } finally { config.TRADE_MODE = 'atr'; }
});

test('OKX setExits: amends the one existing stop in place (stop + take-profit); wrong-side prices are refused', async () => {
  const f = fakeOkx({
    positions: [{ instId: 'BTC-USDT-SWAP', pos: '2.21', posSide: 'net', avgPx: '86000', markPx: '86000', upl: '0' }],
    algos: [{ ordType: 'oco', algoId: 'old1', instId: 'BTC-USDT-SWAP', slTriggerPx: '84000', tpTriggerPx: '90000' }],
    mark: 86000,
  });
  const id = await okxClient(f).setExits('BTCUSDT', { stopLoss: 81485.1, takeProfit: 95059 });
  assert.equal(id, 'old1');
  assert.deepEqual(f.S.calls.find(x => x.path === '/api/v5/trade/amend-algos').body, { instId: 'BTC-USDT-SWAP', algoId: 'old1',
    newSlTriggerPx: '81485.1', newSlOrdPx: '-1', newSlTriggerPxType: 'mark', newTpTriggerPx: '95059', newTpOrdPx: '-1', newTpTriggerPxType: 'mark' });
  assert.ok(!f.S.calls.some(x => x.path === '/api/v5/trade/order-algo' || x.path === '/api/v5/trade/cancel-algos'));
  const g = fakeOkx({ positions: [{ instId: 'BTC-USDT-SWAP', pos: '2.21', posSide: 'net', avgPx: '86000', markPx: '86000', upl: '0' }], mark: 86000 });
  await assert.rejects(okxClient(g).setExits('BTCUSDT', { stopLoss: 87000, takeProfit: 95000 }), /wrong side/);
  await assert.rejects(okxClient(g).setExits('BTCUSDT', { stopLoss: 81000, takeProfit: 85000 }), /wrong side/);
  assert.ok(!g.S.calls.some(x => x.path === '/api/v5/trade/order-algo'));
});

test('OKX setExits: if the stop cannot be amended and OKX refuses a second TP/SL (51088), the old one is replaced', async () => {
  const f = fakeOkx({
    positions: [{ instId: 'BTC-USDT-SWAP', pos: '2.21', posSide: 'net', avgPx: '86000', markPx: '86000', upl: '0' }],
    algos: [{ ordType: 'conditional', algoId: 'old1', instId: 'BTC-USDT-SWAP', slTriggerPx: '84000' }],
    mark: 86000, amendFails: true, oneTpSl: true,
  });
  const id = await okxClient(f).setExits('BTCUSDT', { stopLoss: 81485.1, takeProfit: 95059 });
  assert.match(id, /^alg/);
  const paths = f.S.calls.map(x => x.path);
  const places = paths.filter(p => p === '/api/v5/trade/order-algo').length;
  assert.equal(places, 2, 'first refused (51088), then placed after cancelling the old stop');
  assert.ok(paths.indexOf('/api/v5/trade/cancel-algos') < paths.lastIndexOf('/api/v5/trade/order-algo'));
});

test('OKX addToPosition: a plain same-side market order with no algo attached', async () => {
  const f = fakeOkx();
  await okxClient(f).addToPosition({ symbol: 'BTCUSDT', bias: 1, qty: 0.0365 });
  const body = f.S.calls.find(x => x.path === '/api/v5/trade/order').body;
  assert.deepEqual(body, { instId: 'BTC-USDT-SWAP', tdMode: 'cross', side: 'buy', ordType: 'market', sz: '3.65' });
  const g = fakeOkx({ posMode: 'long_short_mode' });
  await okxClient(g).addToPosition({ symbol: 'BTCUSDT', bias: -1, qty: 0.02 });
  const b2 = g.S.calls.find(x => x.path === '/api/v5/trade/order').body;
  assert.deepEqual([b2.side, b2.posSide, b2.sz, b2.attachAlgoOrds], ['sell', 'short', '2', undefined]);
});
