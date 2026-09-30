// The BTC signal: a 4H Donchian channel breakout (trend following).
//
//   enter long   the 4H candle closes above the highest high of the
//                CHANNEL_N candles before it
//   enter short  it closes below their lowest low (only when DIRECTION is
//                'both')
//   exit long    it closes below the lowest low of the EXIT_N candles before it
//   exit short   it closes above their highest high
//
// Stops (src/exchange.js): the initial stop sits STOP_ATR x ATR from the
// entry; after every 4H close it trails to the best close since entry
// -/+ TRAIL_ATR x ATR and never loosens.
//
// Why this and not TradeBot's ATLAS score: on BTC the ATLAS score with fixed
// targets lost money in almost every year (backtest/ATLAS_ON_BTC.md, and
// TradeBot's own COIN_WF.md), while 4H breakouts with a trailing stop made
// money before and after 2024 across nearly every parameter set
// (backtest/RESEARCH.md, backtest/DONCHIAN.md).
//
// series() is what both the live bot (last element) and scripts/backtest.js
// (every element) use, so the backtest replays exactly this code.
'use strict';

const I = require('./indicators');

// candles: CLOSED candles only, oldest first ({ t, o, h, l, c }).
// Returns one entry per candle (null until there's enough history):
//   { t, close, atr, upper, lower, exitUpper, exitLower, enter, exitLong, exitShort }
// upper / lower: the entry channel of the candles BEFORE this one, i.e. the
// level this candle's close had to beat. enter: +1 / -1 / 0 before the
// DIRECTION filter (see allowed()).
function series(candles, { channelN, exitN, atrLen }) {
  const hs = candles.map(x => x.h), ls = candles.map(x => x.l);
  const hh = I.highest(hs, channelN), ll = I.lowest(ls, channelN);
  const xh = I.highest(hs, exitN), xl = I.lowest(ls, exitN);
  const atr = I.atr(candles, atrLen);
  const warm = Math.max(channelN, exitN, atrLen) + 1;
  return candles.map((k, i) => {
    if (i < warm || atr[i] == null) return null;
    const upper = hh[i - 1], lower = ll[i - 1], exitUpper = xh[i - 1], exitLower = xl[i - 1];
    return {
      t: k.t, close: k.c, atr: atr[i], upper, lower, exitUpper, exitLower,
      enter: k.c > upper ? 1 : k.c < lower ? -1 : 0,
      exitLong: k.c < exitLower,
      exitShort: k.c > exitUpper,
    };
  });
}

function latest(candles, params) {
  const s = series(candles, params);
  return s[s.length - 1];
}

// 'long' = long-only (the default: backtest/DONCHIAN.md), 'both' = long and short.
function allowed(bias, direction) {
  return bias === 1 || (bias === -1 && direction === 'both');
}

// Trailing stop for an open position from the candles closed since it was
// opened: best close so far -/+ trail x that candle's ATR, the tightest of
// all of them and never looser than `stop`. sig: series() output for the
// same candles. fromT: the open time of the first candle to count (the one
// after the entry candle). Returns { stop, ext }.
function trail({ bias, stop, ext, sig, fromT, trailAtr }) {
  for (const s of sig) {
    if (!s || s.t < fromT) continue;
    ext = bias === 1 ? Math.max(ext, s.close) : Math.min(ext, s.close);
    const cand = ext - bias * trailAtr * s.atr;
    if ((cand - stop) * bias > 0) stop = cand;
  }
  return { stop, ext };
}

module.exports = { series, latest, allowed, trail };
