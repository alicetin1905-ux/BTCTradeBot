// The BTC signal (STRATEGY 'atlas-flip'): the ATLAS score swinging fast.
//
//   enter long   the 4H score is +FLIP_SCORE or more now, and was
//                −FLIP_SCORE or less within the previous FLIP_WINDOW 4H
//                candles (4 = 16h): a fast swing from bearish to bullish
//   enter short  the mirror image
//   trend band   a swing is ignored (no entry, no reversal) when the 4H close
//                is more than TREND_BAND_PCT % away from its 200-candle 4H
//                average — chasing an over-extended move, or fading a strong
//                one, was where the flip lost (backtest/ATLAS_FLIP.md)
//   exit         an opposite swing closes the position (and the bot reverses
//                into it when DIRECTION is 'both'); otherwise the stop: 2 ATR,
//                trailing 3 ATR after every 4H close (src/exchange.js)
//
// The score is TradeBot's ATLAS score (src/atlasScore.js) from price and
// volume only — no funding / open interest / order book / tape, which have no
// history — so the live score is exactly the one the backtest used
// (backtest/REPORT.md, research in backtest/ATLAS_FLIP.md). Each score
// sees the 400 closed 4H candles up to it and the closed UTC daily candles
// (the daily pivot), as in the backtest.
//
// series() is what both the live bot and scripts/backtest.js use. Its
// entries have the same shape as src/signal.js's, so the exchange code,
// trailing stop and exits run unchanged.
'use strict';

const atlas = require('./atlasScore');

const HOUR = 3600000, DAY = 24 * HOUR, TF_H = 4, LOOKBACK = 400, TREND_MA = 200;

// ATLAS score and ATR on the closed 4H candle c4[i]. d1: closed UTC daily
// candles (any range; the ones closed by c4[i]'s close are used).
// dj: optional cursor { j } into d1 for sequential calls (backtest speed).
function scoreAt(c4, d1, i, dj = null) {
  const closeT = c4[i].t + TF_H * HOUR;
  const closed = c4.slice(Math.max(0, i - LOOKBACK + 1), i + 1);
  // analyse() drops the last candle as "still forming": hand it a placeholder.
  const cs = { 240: closed.concat([c4[i + 1] || c4[i]]) };
  let j;
  if (dj) { while (dj.j + 1 < d1.length && d1[dj.j + 1].t + DAY <= closeT) dj.j++; j = dj.j; } else {
    j = -1;
    for (let k = d1.length - 1; k >= 0; k--) if (d1[k].t + DAY <= closeT) { j = k; break; }
  }
  if (j >= 1) { const dc = d1.slice(Math.max(0, j - LOOKBACK + 1), j + 1); cs.D = dc.concat([dc[dc.length - 1]]); }
  let a = null;
  try {
    a = atlas.analyse({
      symbol: 'BTCUSDT', candles: cs, ticker: null, oi: [], ratio: null, book: null, tape: null,
      entryTf: '240', mtfTfs: [], flipStore: {}, account: 1000, riskPct: 10, leverage: 10, scoreThreshold: 25,
      scoreMode: 'classic', mtfTrim: false,
    });
  } catch (e) { a = null; }
  return a ? { t: c4[i].t, close: c4[i].c, score: a.score, atr: a.atr } : null;
}

// The rule itself: +1 when the score is >= +threshold now and was <=
// -threshold in one of the `prev` scores (the window before it), -1 for the
// mirror, else 0. flipFrom: that opposite extreme.
function swing(score, prev, threshold) {
  const lo = Math.min(...prev), hi = Math.max(...prev);
  if (score >= threshold && lo <= -threshold) return { enter: 1, flipFrom: lo };
  if (score <= -threshold && hi >= threshold) return { enter: -1, flipFrom: hi };
  return { enter: 0, flipFrom: null };
}

// Average of the last TREND_MA closes up to c4[i], or null with too little history.
function trendMa(c4, i) {
  if (i + 1 < TREND_MA) return null;
  let sum = 0;
  for (let k = i + 1 - TREND_MA; k <= i; k++) sum += c4[k].c;
  return sum / TREND_MA;
}

// Signal entries for c4[from..] (needs `window` scored candles before `from`).
// Returns one entry per candle (null where it can't be scored):
//   { t, close, atr, score, flipFrom, enter, exitLong, exitShort, ma, blocked }
// flipFrom: the opposite extreme within the window that made the swing.
// blocked: a swing happened but the trend band (trendBandPct, null = off) ruled it out.
function series(c4, d1, { threshold, window, trendBandPct = null }, from = 0) {
  const start = Math.max(221, from - window);
  const dj = { j: -1 };
  const scored = [];
  for (let i = start; i < c4.length; i++) scored.push(scoreAt(c4, d1, i, dj));
  const out = [];
  for (let k = 0; k < scored.length; k++) {
    const s = scored[k];
    if (start + k < from) continue;
    if (!s) { out.push(null); continue; }
    const prev = scored.slice(Math.max(0, k - window), k).filter(Boolean).map(p => p.score);
    let { enter, flipFrom } = prev.length === window ? swing(s.score, prev, threshold) : { enter: 0, flipFrom: null };
    const ma = trendMa(c4, start + k);
    let blocked = false;
    if (enter && trendBandPct != null && ma != null && Math.abs((s.close / ma - 1) * 100) > trendBandPct) {
      enter = 0; flipFrom = null; blocked = true;
    }
    out.push({
      ...s, flipFrom, enter, exitLong: enter === -1, exitShort: enter === 1, ma, blocked,
      // No channel in this strategy (src/signal.js fields, for shared code).
      upper: null, lower: null, exitUpper: null, exitLower: null,
    });
  }
  return out;
}

module.exports = { series, scoreAt, swing };
