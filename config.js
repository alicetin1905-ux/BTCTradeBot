// Central knobs for the whole bot. Everything else reads from here.
// control/settings.json can override the adjustable ones (src/settings.js)
// without touching this file — these are the defaults.
const config = module.exports = {
  // The only coin this bot trades (USDT perpetual: BTCUSDT on Bybit,
  // BTC-USDT-SWAP on OKX).
  SYMBOL: 'BTCUSDT',

  // Where it trades, always in demo mode: 'okx' (OKX Demo Trading) or
  // 'bybit' (Bybit Demo Trading). EXCHANGE in .env overrides this; the keys
  // for it go in .env too (.env.example).
  EXCHANGE: 'okx',
  // On OKX: the BTC perpetual 'BTC-USDT-SWAP'; on OKX's EEA site (no USDT,
  // no perpetual swaps) the USD-settled, USDC-margined BTC future
  // 'BTC-USD_UM_XPERP-310328' (perpetual-style, runs to 2031, max 10x); or a
  // spot pair such as 'BTC-USDC' (long-only, unleveraged). OKX_INSTRUMENT in
  // .env (or the GitHub workflow) overrides this.
  OKX_INSTRUMENT: 'BTC-USDT-SWAP',

  // Signal timeframe: closed 4H candles (UTC-aligned: 00/04/08/12/16/20).
  // backtest/RESEARCH.md: 1D breakouts were much weaker on BTC.
  ENTRY_TF: '240',
  // New entries only on the run right after the 4H close (within this many
  // minutes), like the backtest; a breakout that's an hour or more old isn't
  // chased. Stops and exits still update on any run.
  ENTRY_FRESH_MIN: 60,

  // Where the candles come from: null = the exchange it trades on (the
  // other one as a fallback), or 'bybit' / 'okx'.
  MARKET_DATA: null,

  // The signal (src/signal.js): 4H Donchian channel breakout.
  CHANNEL_N: 20,       // enter when a 4H close breaks the high (low) of the previous 20 candles
  EXIT_N: 20,          // exit when a 4H close breaks the opposite side of the previous 20 candles
  ATR_LEN: 14,
  // 'long' = long-only, 'both' = longs and shorts. backtest/DONCHIAN.md:
  // long-only made more with a smaller worst drop (2021-26, both halves),
  // long+short did better only in the 2022 bear market.
  DIRECTION: 'long',

  // Stops, in ATRs of the 4H candles. Both live on the exchange as the position's
  // stop-loss, so they work while the machine running the bot is off.
  STOP_ATR: 2,         // initial stop: entry -/+ 2 x ATR
  TRAIL_ATR: 3,        // after each 4H close: best close since entry -/+ 3 x ATR (never loosens)

  // Money rules.
  PORTFOLIO: {
    STARTING_BALANCE: 2000, // USDT — the bot's allocation; it trades like a 2000 USDT account
    RISK_PCT: 2,            // loss at the initial stop per trade, % of the balance
    MAX_POSITION_X: 2,      // position value at most this many x the balance (caps size on tight stops)
    LEVERAGE: 10,           // exchange leverage (cross margin); margin = position value / leverage.
                            // Sizing is by risk, so leverage changes the margin tied up, not the loss at the stop.
  },

  // Execution safety limits.
  EXECUTION: {
    // No new entries for the rest of the UTC day once today's realized loss
    // reaches this % of the day's starting balance. Open positions keep
    // their exchange-side stop either way.
    DAILY_LOSS_LIMIT_PCT: 10,
  },

  // Phone alerts through the ntfy app (src/notify.js). Subscribe to this
  // topic in ntfy; NTFY_TOPIC in .env overrides it, NTFY_TOPIC=off disables.
  NOTIFY: {
    SERVER: 'https://ntfy.sh/',
    NTFY_TOPIC: 'btctradebot-q7m2kx9vfa3c',
    CLICK_URL: 'https://alicetin1905-ux.github.io/BTCTradeBot/',
    // Daily summary: sent by the first hourly run at/after this hour, in the
    // running Mac's local time.
    DAILY_SUMMARY_HOUR: 8,
    // Status push (position with live P&L, stop, equity), low priority.
    HOURLY_STATUS: true,
    // ...only on the run right after every Nth UTC hour — 4 = after each 4H close.
    STATUS_EVERY_H: 4,
    // Watchdog (GitHub Actions, scripts/watchdog.js): alert when the bot's
    // last hourly run is older than this, repeat every REPEAT_H while it stays down.
    WATCHDOG_MAX_AGE_MIN: 130,
    WATCHDOG_REPEAT_H: 6,
  },
};

// control/settings.json overrides (validated; see src/settings.js).
const settings = require('./src/settings').load(config);
config.SETTINGS_APPLIED = settings.applied;
config.SETTINGS_ERRORS = settings.errors;
config.SETTINGS_DEFAULTS = settings.defaults;
