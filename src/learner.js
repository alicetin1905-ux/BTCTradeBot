// The learning strategy (STRATEGY 'learning'), built 2026-11-03.
//
// Two trend setups from the earlier bots produce candidate trades on closed 4H candles:
//   pullback   with the trend (EMA50 vs EMA200, close beyond EMA200), the candle dips to EMA20 and closes back
//              on the trend side, the close before beyond EMA50
//   breakout   with the trend, the close breaks the high (low) of the previous 20 candles
// Every candidate is followed to its end with the bot's own exits (stop STOP_ATR x ATR, trailed TRAIL_ATR x ATR
// behind the best close), so it has a result R (profit in units of the initial risk).
//
// The learner: a ridge regression over the features at each candidate's entry (src/features.js: the ATLAS page's
// indicators and the BTC-Halving page's 200-week average and halving cycle; GlassSphere's funding and taker flow were
// tested and made it worse, so they are left out). It is retrained on EVERY candidate that has closed - taken or
// not, both coins together, older results counting less (half-life LEARN.HALF_LIFE_BARS) - and a new candidate
// is traded only when the model expects at least LEARN.MIN_R. So it keeps learning from every new setup.
//
// Walk-forward test (research/LEARNING.md, Binance spot 4H, BTC+ETH, 2021 - Oct 2026, 2% risk, max 2 open):
// setups alone PF 1.31; with the learner PF 1.48, 418 trades, every year positive in R, worst drop 37%.
'use strict';

const F = require('./features');
const M = require('./model');

const DROP = ['funding_z', 'taker_flow'];
const KEEP = F.NAMES.map((n, i) => (DROP.includes(n) ? -1 : i)).filter(i => i >= 0);
const FEATURES = KEEP.map(i => F.NAMES[i]);
const SETUPS = ['pullback', 'breakout'];
const TF = 144e5;

function defaults(cfg = {}) {
  return {
    stopAtr: cfg.STOP_ATR ?? 2, trailAtr: cfg.TRAIL_ATR ?? 4, cost: cfg.COST ?? 0.0012,
    minR: cfg.MIN_R ?? 0, halfLife: cfg.HALF_LIFE_BARS ?? 8760, lambda: cfg.LAMBDA ?? 3, warm: cfg.WARMUP_TRADES ?? 40,
    breakoutN: cfg.BREAKOUT_N ?? 20, setups: cfg.SETUPS ?? SETUPS, guardMult: cfg.GUARD_MULT ?? 1,
  };
}

function trendAt(c, f, i) {
  if (f.e50[i] > f.e200[i] && c[i].c > f.e200[i]) return 1;
  if (f.e50[i] < f.e200[i] && c[i].c < f.e200[i]) return -1;
  return 0;
}
function setupAt(name, c, f, i, o) {
  const t = trendAt(c, f, i);
  if (!t || i < o.breakoutN + 1) return 0;
  if (name === 'pullback') {
    if (t === 1 && c[i].l <= f.e20[i] && c[i].c > f.e20[i] && c[i - 1].c > f.e50[i - 1]) return 1;
    if (t === -1 && c[i].h >= f.e20[i] && c[i].c < f.e20[i] && c[i - 1].c < f.e50[i - 1]) return -1;
    return 0;
  }
  if (name === 'stflip') { // Supertrend (10, 3) turns to the trend's side on this candle
    const d = f.X[i][2], dp = f.X[i - 1] ? f.X[i - 1][2] : d;
    return d === t && dp === -t ? t : 0;
  }
  if (name === 'emacross') { // EMA20 crosses EMA50 to the trend's side
    const now = Math.sign(f.e20[i] - f.e50[i]), prev = Math.sign(f.e20[i - 1] - f.e50[i - 1]);
    return now === t && prev !== t ? t : 0;
  }
  if (name === 'rsireset') { // RSI(14) crosses back over 50 to the trend's side (a dip inside the trend ends)
    const r = f.X[i][5], rp = f.X[i - 1] ? f.X[i - 1][5] : r;
    return t === 1 ? (r > 0 && rp <= 0 ? 1 : 0) : (r < 0 && rp >= 0 ? -1 : 0);
  }
  let hi = -Infinity, lo = Infinity;
  for (let j = i - o.breakoutN; j < i; j++) { hi = Math.max(hi, c[j].h); lo = Math.min(lo, c[j].l); }
  if (t === 1 && c[i].c > hi && c[i - 1].c <= hi) return 1;
  if (t === -1 && c[i].c < lo && c[i - 1].c >= lo) return -1;
  return 0;
}

// Follow a candidate from its entry candle with the bot's exits. open = still running at the last candle.
function follow(c, A, i, side, o) {
  const entry = c[i].c, dist = o.stopAtr * A[i];
  let stop = entry - side * dist, best = entry;
  for (let j = i + 1; j < c.length; j++) {
    if (side === 1 ? c[j].l <= stop : c[j].h >= stop) {
      const px = side === 1 ? Math.min(stop, c[j].o) : Math.max(stop, c[j].o);
      return { exitI: j, R: (side * (px - entry) - o.cost * entry) / dist, open: false };
    }
    best = side === 1 ? Math.max(best, c[j].c) : Math.min(best, c[j].c);
    const ts = best - side * o.trailAtr * A[j];
    if (side === 1 ? ts > stop : ts < stop) stop = ts;
  }
  return { exitI: c.length - 1, R: (side * (c[c.length - 1].c - entry) - o.cost * entry) / dist, open: true };
}

const vec = (f, i, side, setup, coin, setups = SETUPS) => [...KEEP.map(k => f.X[i][k] * side), ...setups.map(s => (s === setup ? 1 : 0)), coin === 'BTC' ? 1 : 0, side];

// data: { BTC: { candles, daily }, ETH: {...} } (closed 4H candles {t,o,h,l,c,v,tbv}, daily {t,c}).
// Returns per coin the feature/indicator arrays and every candidate trade.
function candidates(data, o) {
  const out = {}, all = [];
  for (const [coin, d] of Object.entries(data)) {
    const c = d.candles, f = F.build(c, [], d.daily || []);
    const list = [];
    for (let i = 220; i < c.length; i++) {
      if (!f.X[i]) continue;
      for (const s of o.setups) {
        const side = setupAt(s, c, f, i, o);
        if (!side) continue;
        const r = follow(c, f.atr, i, side, o);
        const cd = { coin, setup: s, side, i, t0: c[i].t, t1: c[r.exitI].t, R: r.R, open: r.open, x: vec(f, i, side, s, coin, o.setups) };
        list.push(cd); all.push(cd);
      }
    }
    out[coin] = { c, f, list };
  }
  return { byCoin: out, all };
}

function train(all, now, o) {
  const done = all.filter(q => !q.open && q.t1 <= now);
  if (done.length < o.warm) return null;
  const model = M.fit(done.map(q => q.x), done.map(q => Math.max(-1.5, Math.min(6, q.R))),
    done.map(q => Math.pow(0.5, (now - q.t1) / (o.halfLife * TF))), o.lambda);
  return { ...model, n: done.length };
}

// Self-check: did the learner's choices hold up on the last N setups that finished? Each one is judged out-of-sample,
// with the model as it was when that setup formed (trained only on what had finished before it), exactly as the live
// bot would have. Compared: the average result of the setups it would take vs the ones it would skip.
//   status 'ok'     the taken ones did at least as well as the skipped ones
//          'watch'  they did worse
//          'alert'  clearly worse (by 0.2 R or more) AND losing on average (-0.3 R or worse)
// Over 150 setups (~2.5 months) the walk-forward history 2020-26 was 'alert' 7% of the time, mostly in weak spells
// such as 2022; shorter windows are mostly noise (most setups lose a little, a few win big).
const SELF_N = 150;
function selfCheck(all, now, o, n = SELF_N) {
  const finished = all.filter(q => !q.open && q.t1 <= now).sort((a, b) => a.t1 - b.t1).slice(-n);
  if (finished.length < n) return null;
  const cache = new Map();
  for (const q of finished) {
    const at = q.t0 + TF;
    if (!cache.has(at)) cache.set(at, train(all, at, o));
    const m = cache.get(at);
    q._pred = m ? M.predict(m, q.x) : null;
  }
  const taken = finished.filter(q => q._pred != null && q._pred >= o.minR), skipped = finished.filter(q => q._pred != null && q._pred < o.minR);
  const avg = a => (a.length ? a.reduce((s, q) => s + q.R, 0) / a.length : 0);
  const ta = avg(taken), sa = avg(skipped), gap = ta - sa;
  const status = gap < -0.2 && ta < -0.3 ? 'alert' : gap < 0 ? 'watch' : 'ok';
  return {
    n: finished.length, from: finished[0].t1, to: finished[finished.length - 1].t1, status,
    taken: taken.length, takenAvgR: +ta.toFixed(3), skipped: skipped.length, skippedAvgR: +sa.toFixed(3), gap: +gap.toFixed(3),
    takenWon: taken.filter(q => q.R > 0).length,
  };
}

// Risk guard: while the self-check says 'watch' or 'alert', new trades risk `mult` x the normal amount (1 = off).
function riskGuard(check, mult) {
  if (!check || !(mult < 1) || !(mult >= 0)) return null;
  return check.status === 'watch' || check.status === 'alert' ? { status: check.status, mult } : null;
}

// The signal series for one coin (same shape as src/pullback.js, so src/exchange.js runs unchanged) plus what the
// model learned. Only the last candle can enter; trailing uses close/atr of the candles after the entry.
function series(data, coin, cfg = {}, { from = 500, check = false } = {}) {
  const o = defaults(cfg);
  const { byCoin, all } = candidates(data, o);
  const me = byCoin[coin];
  const c = me.c, f = me.f, last = c.length - 1;
  const now = c[last].t + TF; // the last candle's close
  const model = train(all, now, o);
  const out = [];
  for (let i = Math.max(0, c.length - from); i < c.length; i++) {
    if (!f.X[i]) { out.push(null); continue; }
    const e = {
      t: c[i].t, close: c[i].c, atr: f.atr[i], enter: 0, exitLong: false, exitShort: false,
      trend: trendAt(c, f, i), ema20: f.e20[i], ema50: f.e50[i], ema200: f.e200[i], learning: true,
      setup: null, setupSide: 0, expR: null, upper: null, lower: null, exitUpper: null, exitLower: null, score: null, flipFrom: null,
    };
    if (i === last) {
      for (const s of o.setups) {
        const side = setupAt(s, c, f, i, o);
        if (!side) continue;
        const x = vec(f, i, side, s, coin, o.setups);
        const expR = model ? M.predict(model, x) : null;
        if (!e.setup) { e.setup = s; e.setupSide = side; e.expR = expR; }
        if (expR == null || expR >= o.minR) { e.setup = s; e.setupSide = side; e.expR = expR; e.enter = side; break; }
      }
      e.features = Object.fromEntries(FEATURES.map((n, k) => [n, +f.X[i][KEEP[k]].toFixed(3)]));
      // For the dashboard: the raw indicators, and what the learner would expect from each setup if it formed now.
      e.ind = f.raw(i);
      if (model) e.hypo = Object.fromEntries(o.setups.map(s => [s, { long: +M.predict(model, vec(f, i, 1, s, coin, o.setups)).toFixed(3), short: +M.predict(model, vec(f, i, -1, s, coin, o.setups)).toFixed(3) }]));
      e.minR = o.minR;
    }
    out.push(e);
  }
  // What it learned, for the dashboard: weights, and how the candidates it would have taken did vs the rest.
  const recent = all.filter(q => !q.open && q.t1 > now - 365 * 864e5);
  const summary = model && {
    trainedOn: model.n, at: now, minR: o.minR, halfLifeDays: Math.round(o.halfLife * TF / 864e5),
    weights: Object.fromEntries([...FEATURES, ...o.setups.map(s => 'setup_' + s), 'coin_btc', 'side_long'].map((n, k) => [n, +model.w[k].toFixed(4)])),
    bias: +model.b.toFixed(4),
    lastYear: (() => {
      const pick = recent.filter(q => M.predict(model, q.x) >= o.minR), rest = recent.filter(q => M.predict(model, q.x) < o.minR);
      const avg = a => (a.length ? +(a.reduce((s, q) => s + q.R, 0) / a.length).toFixed(2) : null);
      return { candidates: recent.length, wouldTake: pick.length, avgRTaken: avg(pick), avgRSkipped: avg(rest) };
    })(),
    selfCheck: check ? selfCheck(all, now, o) : undefined,
  };
  // the risk guard rides on the last candle (src/exchange.js sizes the entry with it; the dashboard shows it)
  const g = riskGuard(summary && summary.selfCheck, o.guardMult), lastE = out[out.length - 1];
  if (lastE) { lastE.riskMult = g ? g.mult : 1; lastE.guard = g ? g.status : null; }
  return { series: out, model: summary };
}

module.exports = { series, candidates, train, selfCheck, riskGuard, setupAt, follow, FEATURES, SETUPS, defaults, SELF_N };
