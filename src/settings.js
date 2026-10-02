// Adjustable settings: control/settings.json (committed to this repo, pulled
// by the Mac before every run) overrides a whitelisted set of config.js
// values, e.g.
//   { "RISK_PCT": 1.5, "DIRECTION": "both", "TRAIL_ATR": 3.5 }
// Only keys listed in FIELDS are accepted, each checked against hard limits;
// a missing, unknown or out-of-range value keeps the config.js default and is
// reported in config.SETTINGS_ERRORS (shown on the dashboard). Changes apply
// from the next run; an open position keeps its current stop until the next
// 4H close trails it with the new TRAIL_ATR.
// TRADEBOT_SETTINGS=off skips the file (tests, backtest).
'use strict';

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'control', 'settings.json');

const num = (min, max, { int = false, nullable = false } = {}) => (v) => {
  if (v === null && nullable) return { value: null };
  if (typeof v !== 'number' || !Number.isFinite(v)) return { error: 'must be a number' + (nullable ? ' or null' : '') };
  if (int && !Number.isInteger(v)) return { error: 'must be a whole number' };
  if (v < min || v > max) return { error: `must be between ${min} and ${max}` };
  return { value: v };
};
// { "NEAR": 1, ... }: each value a risk % like RISK_PCT. null/{} = every coin uses RISK_PCT.
const coinMap = (min, max) => (v) => {
  if (v === null) return { value: {} };
  if (typeof v !== 'object' || Array.isArray(v)) return { error: 'must be an object like { "NEAR": 1 }' };
  for (const [k, x] of Object.entries(v)) {
    if (!/^[A-Z0-9]{2,10}$/.test(k)) return { error: `coin "${k}" must be an upper-case ticker` };
    if (typeof x !== 'number' || !Number.isFinite(x) || x < min || x > max) return { error: `${k} must be a number between ${min} and ${max}` };
  }
  return { value: { ...v } };
};
// { "ETH": { "MARGIN": 667, "SL_USDT": 100, "TP_USDT": 200 } }: fixed-mode numbers for single coins (any of the three).
const coinFixed = (v) => {
  if (v === null) return { value: {} };
  if (typeof v !== 'object' || Array.isArray(v)) return { error: 'must be an object like { "ETH": { "MARGIN": 667 } }' };
  const lim = { MARGIN: [10, 5000], SL_USDT: [1, 2000], TP_USDT: [1, 5000] };
  for (const [coin, o] of Object.entries(v)) {
    if (!/^[A-Z0-9]{2,10}$/.test(coin)) return { error: `coin "${coin}" must be an upper-case ticker` };
    if (!o || typeof o !== 'object' || Array.isArray(o)) return { error: `${coin} must be an object with MARGIN / SL_USDT / TP_USDT` };
    for (const [k, x] of Object.entries(o)) {
      if (!lim[k]) return { error: `${coin}.${k} is not a setting (MARGIN, SL_USDT, TP_USDT)` };
      if (typeof x !== 'number' || !Number.isFinite(x) || x < lim[k][0] || x > lim[k][1]) return { error: `${coin}.${k} must be a number between ${lim[k][0]} and ${lim[k][1]}` };
    }
  }
  return { value: JSON.parse(JSON.stringify(v)) };
};
const oneOf = (...opts) => (v) => (opts.includes(v) ? { value: v } : { error: `must be one of ${opts.map(o => JSON.stringify(o)).join(', ')}` });

// Each field: where it lives in config, how it's checked, and a label.
const FIELDS = {
  // Money
  RISK_PCT: { at: ['PORTFOLIO', 'RISK_PCT'], check: num(0.1, 10), label: 'Loss at the initial stop per trade (% of balance)' },
  COIN_RISK_PCT: { at: ['COIN_RISK_PCT'], check: coinMap(0.1, 10), label: 'Own risk per trade for single coins (% of balance), e.g. { "NEAR": 1 }; others use the line above' },
  TRADE_MODE: { at: ['TRADE_MODE'], check: oneOf('fixed', 'atr'), label: 'Position rules ("fixed" = fixed margin, stop-loss and take-profit in USDT; "atr" = risk % of the balance, ATR stop that trails)' },
  COIN_FIXED: { at: ['COIN_FIXED'], check: coinFixed, label: 'Fixed mode: own margin / stop / target for single coins, e.g. { "ETH": { "MARGIN": 667 } }' },
  FIXED_MARGIN: { at: ['FIXED', 'MARGIN'], check: num(10, 5000), label: 'Fixed mode: margin per trade (USDT)' },
  FIXED_SL_USDT: { at: ['FIXED', 'SL_USDT'], check: num(1, 2000), label: 'Fixed mode: loss at the stop-loss (USDT)' },
  FIXED_TP_USDT: { at: ['FIXED', 'TP_USDT'], check: num(1, 5000), label: 'Fixed mode: gain at the take-profit (USDT)' },
  MAX_POSITION_X: { at: ['PORTFOLIO', 'MAX_POSITION_X'], check: num(0.1, 5), label: 'Max position value (x balance)' },
  LEVERAGE: { at: ['PORTFOLIO', 'LEVERAGE'], check: num(1, 25, { int: true }), label: 'Leverage' },
  DAILY_LOSS_LIMIT_PCT: { at: ['EXECUTION', 'DAILY_LOSS_LIMIT_PCT'], check: num(1, 100), label: 'Daily loss limit (% of balance)' },
  // Signal
  STRATEGY: { at: ['STRATEGY'], check: oneOf('atlas-flip', 'breakout'), label: 'Signal ("atlas-flip" = ATLAS score fast swing, "breakout" = 4H channel breakout)' },
  SCORE_MODE: { at: ['SCORE_MODE'], check: oneOf('graded', 'classic'), label: 'ATLAS score method ("graded" = by strength, groups blended; "classic" = flat votes)' },
  FLIP_SCORE: { at: ['FLIP_SCORE'], check: num(10, 90, { int: true }), label: 'ATLAS flip: score level (swing from -X to +X)' },
  FLIP_WINDOW: { at: ['FLIP_WINDOW'], check: num(1, 12, { int: true }), label: 'ATLAS flip: within this many 4H candles' },
  EXTREME_SCORE: { at: ['EXTREME_SCORE'], check: num(50, 100, { int: true, nullable: true }), label: 'ATLAS flip: also enter when the score closes at +/- this level (null = off)' },
  TREND_BAND_PCT: { at: ['TREND_BAND_PCT'], check: num(2, 50, { nullable: true }), label: 'ATLAS flip: skip swings when the 4H close is more than this % from its 200-candle average (null = off)' },
  DIRECTION: { at: ['DIRECTION'], check: oneOf('long', 'both'), label: 'Trade direction ("long" = long-only, "both" = longs and shorts)' },
  CHANNEL_N: { at: ['CHANNEL_N'], check: num(5, 100, { int: true }), label: 'Breakout channel (4H candles)' },
  EXIT_N: { at: ['EXIT_N'], check: num(5, 100, { int: true }), label: 'Exit channel (4H candles)' },
  STOP_ATR: { at: ['STOP_ATR'], check: num(0.5, 6), label: 'Initial stop (x ATR)' },
  TRAIL_ATR: { at: ['TRAIL_ATR'], check: num(0.5, 8), label: 'Trailing stop (x ATR from the best close)' },
  ENTRY_FRESH_MIN: { at: ['ENTRY_FRESH_MIN'], check: num(5, 240, { int: true, nullable: true }), label: 'Enter only within this many minutes of a 4H close (null = any time)' },
  MARKET_DATA: { at: ['MARKET_DATA'], check: oneOf('bybit', 'okx', null), label: 'Candles from (null = the exchange it trades on, or "bybit" / "okx"; the other is the fallback)' },
  // Alerts
  STATUS_EVERY_H: { at: ['NOTIFY', 'STATUS_EVERY_H'], check: num(1, 24, { int: true }), label: 'Status push every N hours' },
};

const get = (cfg, at) => at.reduce((o, k) => o[k], cfg);
function set(cfg, at, value) {
  const parent = at.slice(0, -1).reduce((o, k) => o[k], cfg);
  parent[at[at.length - 1]] = value; // mutate in place: modules hold references to PORTFOLIO etc.
}
const clone = (v) => (Array.isArray(v) ? v.slice() : v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);

function current(cfg) {
  return Object.fromEntries(Object.entries(FIELDS).map(([k, f]) => [k, clone(get(cfg, f.at))]));
}

// Applies overrides to cfg; returns { applied, errors, defaults }.
function apply(cfg, overrides) {
  const defaults = current(cfg);
  const applied = {};
  const errors = [];
  if (overrides == null) return { applied, errors, defaults };
  if (typeof overrides !== 'object' || Array.isArray(overrides)) {
    return { applied, errors: ['settings.json must be a JSON object'], defaults };
  }
  for (const [key, raw] of Object.entries(overrides)) {
    if (key.startsWith('_')) continue; // comments
    const f = FIELDS[key];
    if (!f) { errors.push(`${key}: unknown setting (ignored)`); continue; }
    const res = f.check(raw);
    if (res.error) { errors.push(`${key}: ${res.error} — kept ${JSON.stringify(get(cfg, f.at))}`); continue; }
    set(cfg, f.at, res.value);
    applied[key] = clone(res.value);
  }
  return { applied, errors, defaults };
}

// Reads control/settings.json and applies it. Never throws: a broken file
// keeps every default and says why.
function load(cfg, file = FILE) {
  if (/^(off|0|false)$/i.test(process.env.TRADEBOT_SETTINGS || '')) return apply(cfg, null);
  let overrides = null;
  try {
    if (fs.existsSync(file)) overrides = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    const r = apply(cfg, null);
    r.errors.push(`control/settings.json is not valid JSON (${err.message}) — using config.js defaults`);
    return r;
  }
  return apply(cfg, overrides);
}

module.exports = { FIELDS, apply, load, current };
