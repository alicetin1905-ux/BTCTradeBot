// The trend-pullback signal (STRATEGY 'trend-pullback'), chosen 2026-10-17 after the ATLAS flip lost 66% in
// two weeks of forward trading (backtest/TREND_PULLBACK.md).
//
//   trend up     EMA50 above EMA200 and the 4H close above EMA200 (trend down: the mirror)
//   enter long   in an uptrend, the 4H candle dips to EMA20 (its low touches it) and closes back above it,
//                the close before having been above EMA50 (a pullback, not a breakdown)
//   enter short  the mirror image
//   exit         no signal exit and no take-profit: the stop does it — 2 ATR at the entry (STOP_ATR),
//                then trailed TRAIL_ATR (4) x ATR behind the best close after every 4H close (src/exchange.js)
//
// All on closed 4H candles. Indicators: EMAs seeded with the first close, ATR(14) Wilder.
'use strict';

function ema(a, n) {
  const k = 2 / (n + 1), o = [];
  let e = null;
  for (const x of a) { e = e == null ? x : x * k + e * (1 - k); o.push(e); }
  return o;
}

function atr(c, n = 14) {
  const o = [];
  let a = null;
  for (let i = 0; i < c.length; i++) {
    const tr = i ? Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c)) : c[i].h - c[i].l;
    a = a == null ? tr : (a * (n - 1) + tr) / n;
    o.push(a);
  }
  return o;
}

// The trend on candle i: 1 up, -1 down, 0 none.
function trendAt(I, i) {
  if (I.e50[i] > I.e200[i] && I.c[i] > I.e200[i]) return 1;
  if (I.e50[i] < I.e200[i] && I.c[i] < I.e200[i]) return -1;
  return 0;
}

// Entry on candle i: 1 long, -1 short, 0 none.
function enterAt(c, I, i) {
  if (i < 1) return 0;
  const t = trendAt(I, i);
  if (t === 1 && c[i].l <= I.e20[i] && I.c[i] > I.e20[i] && I.c[i - 1] > I.e50[i - 1]) return 1;
  if (t === -1 && c[i].h >= I.e20[i] && I.c[i] < I.e20[i] && I.c[i - 1] < I.e50[i - 1]) return -1;
  return 0;
}

function indicators(c) {
  const closes = c.map(x => x.c);
  return { c: closes, e20: ema(closes, 20), e50: ema(closes, 50), e200: ema(closes, 200), atr: atr(c) };
}

// One entry per closed 4H candle from `from` on (null before the EMA200 has 200 candles behind it).
// Same shape as src/signal.js / src/flip.js entries, so the exchange code runs unchanged.
const WARMUP = 200;
function series(c, from = 0) {
  const I = indicators(c);
  const out = [];
  for (let i = from; i < c.length; i++) {
    if (i < WARMUP) { out.push(null); continue; }
    const enter = enterAt(c, I, i);
    out.push({
      t: c[i].t, close: c[i].c, atr: I.atr[i], enter, exitLong: false, exitShort: false,
      trend: trendAt(I, i), ema20: I.e20[i], ema50: I.e50[i], ema200: I.e200[i], pullback: true,
      upper: null, lower: null, exitUpper: null, exitLower: null, score: null, flipFrom: null,
    });
  }
  return out;
}

module.exports = { series, indicators, trendAt, enterAt, ema, atr, WARMUP };
