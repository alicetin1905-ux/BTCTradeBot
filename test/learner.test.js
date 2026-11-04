'use strict';
const test = require('node:test');
const assert = require('node:assert');
const L = require('../src/learner');
const M = require('../src/model');
const H = require('../src/history');
const fs = require('fs');

const TF = 144e5;
// Deterministic random walk with drifting trends: enough setups for the learner.
function walk(n, seed, start = 100) {
  let s = seed, p = start, drift = 0;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const out = [];
  for (let i = 0; i < n; i++) {
    if (i % 300 === 0) drift = (rnd() - 0.5) * 0.004;
    const o = p, c = o * (1 + drift + (rnd() - 0.5) * 0.02);
    const h = Math.max(o, c) * (1 + rnd() * 0.006), l = Math.min(o, c) * (1 - rnd() * 0.006);
    out.push({ t: Date.UTC(2020, 0, 1) + i * TF, o, h, l, c, v: 1000 + rnd() * 100, tbv: 500 });
    p = c;
  }
  return out;
}
const daily = (c) => c.filter((_, i) => i % 6 === 5).map(k => ({ t: k.t - 5 * TF, c: k.c }));
function data(n = 3000) {
  const btc = walk(n, 7, 30000), eth = walk(n, 11, 2000);
  return { BTC: { candles: btc, daily: daily(btc) }, ETH: { candles: eth, daily: daily(eth) } };
}

test('learner: a candidate is followed with the bot\'s exits (2 ATR stop, trailed 4 ATR behind the best close)', () => {
  const o = L.defaults({});
  const c = [], A = [];
  for (let i = 0; i < 6; i++) { c.push({ t: i * TF, o: 100, h: 100, l: 100, c: 100 }); A.push(1); }
  // long entry at 100 (stop 98); price runs to 110 (trail 110 - 4 = 106), then falls through 106
  c.push({ t: 6 * TF, o: 100, h: 110, l: 100, c: 110 }); A.push(1);
  c.push({ t: 7 * TF, o: 110, h: 110, l: 105, c: 105 }); A.push(1);
  const r = L.follow(c, A, 5, 1, o);
  assert.strictEqual(r.open, false);
  assert.strictEqual(r.exitI, 7);
  assert.ok(Math.abs(r.R - (6 - 0.0012 * 100) / 2) < 1e-9, `R ${r.R}`);
  // a short from the same bar: stopped at 102 on the spike to 110 → about -1 R
  const s = L.follow(c, A, 5, -1, o);
  assert.ok(s.R < -1 && s.R > -1.1, `R ${s.R}`);
});

test('learner: trains only on candidates that finished before now, never on running ones', () => {
  const o = L.defaults({});
  const { all } = L.candidates(data(), o);
  assert.ok(all.length > 100, `only ${all.length} candidates`);
  const cut = all[Math.floor(all.length / 2)].t0;
  const m = L.train(all, cut, o);
  const used = all.filter(q => !q.open && q.t1 <= cut);
  assert.strictEqual(m.n, used.length);
  assert.ok(all.some(q => q.t1 > cut && q.t0 < cut), 'some candidates were still running at the cut');
  // fewer finished setups than the warm-up: no model
  assert.strictEqual(L.train(all, all[5].t0, o), null);
});

test('learner: the last candle enters only when the expected R reaches MIN_R; the series fits src/exchange.js', () => {
  const d = data();
  const lo = L.series(d, 'BTC', { MIN_R: -100 }), hi = L.series(d, 'BTC', { MIN_R: 100 });
  const a = lo.series[lo.series.length - 1], b = hi.series[hi.series.length - 1];
  assert.ok(lo.series.length <= 500);
  for (const k of ['t', 'close', 'atr', 'enter', 'exitLong', 'exitShort', 'trend', 'ema20']) assert.ok(k in a, k);
  assert.strictEqual(b.enter, 0, 'MIN_R 100 never enters');
  if (a.setup) assert.strictEqual(a.enter, a.setupSide, 'MIN_R -100 takes any setup');
  assert.ok(lo.model.trainedOn > 40);
  assert.ok('cycle_cos' in lo.model.weights && !('funding_z' in lo.model.weights));
  // the dashboard's live tiles: raw indicators and the learner's view of each setup on the last candle
  for (const k of ['ema20', 'ema50', 'ema200', 'rsi', 'adx', 'supertrend', 'high20', 'low20', 'cycleDays']) assert.ok(a.ind && Number.isFinite(+a.ind[k]), k);
  assert.ok(a.ind.high20 >= a.ind.low20);
  for (const s of ['pullback', 'breakout']) assert.ok(Number.isFinite(a.hypo[s].long) && Number.isFinite(a.hypo[s].short));
  // only the last candle can enter
  assert.ok(lo.series.slice(0, -1).every(s => !s || s.enter === 0));
});

test('learner: finds the planted setups (pullback to EMA20 in an uptrend, 20-candle breakout)', () => {
  const o = L.defaults({});
  const n = 260, c = [];
  for (let i = 0; i < n; i++) { const p = 100 + i * 0.5; c.push({ t: i * TF, o: p - 0.2, h: p + 0.3, l: p - 0.3, c: p }); }
  const F = require('../src/features').build(c, [], []);
  // breakout: a strong close above the previous 20 highs
  const i = n - 1;
  c[i] = { ...c[i], c: c[i - 1].h + 5, h: c[i - 1].h + 5.5 };
  const F2 = require('../src/features').build(c, [], []);
  assert.strictEqual(L.setupAt('breakout', c, F2, i, o), 1);
  // pullback: the low dips under EMA20, the close back above it
  const j = n - 1, c2 = c.slice(0, n - 1).concat([{ t: c[j].t, o: c[j - 1].c, h: c[j - 1].c + 1, l: F.e20[j] - 1, c: F.e20[j] + 0.5 }]);
  const F3 = require('../src/features').build(c2, [], []);
  assert.strictEqual(L.setupAt('pullback', c2, F3, j, o), 1);
});

test('ridge model: recovers a linear rule', () => {
  const X = [], y = [];
  for (let i = 0; i < 200; i++) { const a = Math.sin(i), b = Math.cos(i * 1.3); X.push([a, b]); y.push(2 * a - b + 0.5); }
  const m = M.fit(X, y, null, 0);
  assert.ok(Math.abs(m.w[0] - 2) < 1e-6 && Math.abs(m.w[1] + 1) < 1e-6 && Math.abs(m.b - 0.5) < 1e-6);
});

test('history: tops up the cache from Binance, refuses a history that misses the newest closed candle', async () => {
  const now = Date.UTC(2026, 10, 3, 12, 30);
  const file = `${H.CACHE}/ZZZ-4h.json`;
  try { fs.unlinkSync(file); } catch (e) { /* none */ }
  const last = Math.floor(now / TF) * TF - TF; // 08:00 candle, closed at 12:00
  let calls = 0;
  H.setFetch(async (url) => {
    calls++;
    const start = +new URL(url).searchParams.get('startTime');
    const rows = [];
    for (let t = Math.max(start, last - 5 * TF); t <= last + TF && rows.length < 1000; t += TF) rows.push([t, '1', '2', '0.5', '1.5', '0', t + TF - 1, '10', 0, '0', '5', '0']);
    return { ok: true, json: async () => rows };
  });
  const c = await H.load('ZZZ', '4h', now);
  assert.strictEqual(c[c.length - 1].t, last, 'the running 12:00 candle is left out');
  assert.strictEqual(c[c.length - 1].tbv, 5);
  await H.load('ZZZ', '4h', now); // cached: nothing new to fetch
  assert.strictEqual(calls, 1);
  H.setFetch(async () => ({ ok: false, status: 500 }));
  await assert.rejects(() => H.load('ZZZ', '4h', now + 2 * TF), /history stops at/);
  fs.unlinkSync(file);
  H.setFetch((...a) => fetch(...a));
});

test('bot log: one scan line per 4H close, plus entries, stop moves, exits and errors; capped', () => {
  const { logRun, LOG_MAX } = require('../src/botlog');
  const st = { log: [], meta: {}, position: null };
  const s = { t: 1000, close: 50, trend: -1, setup: 'pullback', setupSide: -1, expR: 0.3456, wait: null };
  logRun(st, [{ type: 'enter', bias: -1, entry: 50, stop: 52, qty: 1, riskAmt: 2, setup: 'pullback', expR: 0.3456 }], 5, s);
  assert.deepStrictEqual(st.log.map(e => e.kind), ['scan', 'enter']);
  assert.strictEqual(st.log[0].decision, 'entered');
  assert.strictEqual(st.log[1].expR, 0.346);
  // the :32 run on the same candle adds no second scan line; a trailed stop and an exit are logged
  logRun(st, [{ type: 'info', reason: 'stop trailed 52 → 51' }, { type: 'hold', reason: 'x' }], 6, s);
  logRun(st, [{ type: 'exit', pnl: 1.5, price: 48.5, reason: 'trailing stop' }, { type: 'exit', pnl: 0, reason: 'P&L record pending' }], 7, null);
  assert.deepStrictEqual(st.log.map(e => e.kind), ['scan', 'enter', 'trail', 'exit']);
  // the next close: a skipped setup is logged with the reason
  logRun(st, [], 8, { ...s, t: 2000, expR: -0.2, wait: 'skipped by the learner' });
  assert.strictEqual(st.log[4].decision, 'skipped by the learner');
  for (let i = 0; i < LOG_MAX + 50; i++) logRun(st, [{ type: 'error', reason: 'e' + i }], 9, null);
  assert.strictEqual(st.log.length, LOG_MAX);
});

test('model file: learning recorded once per 4H close, weights history kept, self-check alert pushed once', () => {
  const MF = require('../src/modelfile');
  const os = require('os'), path = require('path');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mf-')), 'model.json');
  const m = (at, n, status) => ({ at, trainedOn: n, weights: { rsi: n / 1e4 }, selfCheck: status && { status, n: 150, takenAvgR: -0.5, skippedAvgR: 0.1 } });
  assert.deepStrictEqual(MF.write(file, m(1, 100, 'ok'), 10), []);
  let j = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(j.newSetups, null); assert.strictEqual(j.history.length, 1);
  // the :32 run on the same candle: nothing new learned, history unchanged
  MF.write(file, m(1, 100, 'ok'), 20);
  j = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(j.history.length, 1); assert.strictEqual(j.learnedAt, 10);
  // next close: 8 new setups, alert turns on → one push
  const p1 = MF.write(file, m(2, 108, 'alert'), 30);
  j = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(j.newSetups, 8); assert.strictEqual(j.learnedAt, 30); assert.strictEqual(j.history.length, 2);
  assert.strictEqual(p1.length, 1); assert.match(p1[0].title, /attention/);
  assert.deepStrictEqual(MF.write(file, m(3, 110, 'alert'), 40), []);      // still alert: no repeat
  assert.match(MF.write(file, m(4, 112, 'watch'), 50)[0].title, /back to normal/);
  for (let i = 5; i < MF.HISTORY + 20; i++) MF.write(file, m(i, 112 + i, 'ok'), 60 + i);
  assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).history.length, MF.HISTORY);
});

test('learner self-check: out-of-sample, taken vs skipped over the last finished setups', () => {
  const d = data(4000);
  const o = L.defaults({});
  const { all } = L.candidates(d, o);
  const now = d.BTC.candles[d.BTC.candles.length - 1].t + TF;
  const c = L.selfCheck(all, now, o, 60);
  assert.ok(c && c.n === 60 && c.taken + c.skipped === 60);
  assert.ok(['ok', 'watch', 'alert'].includes(c.status));
  assert.strictEqual(L.selfCheck(all, now, o, 1e6), null); // not enough finished setups yet
  // the walk-forward rule: a setup's prediction never uses its own result
  const r = L.series(d, 'BTC', {}, { check: true });
  assert.ok(r.model.selfCheck && r.model.selfCheck.n === L.SELF_N || r.model.selfCheck === null);
});
