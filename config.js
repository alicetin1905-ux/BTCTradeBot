// Central knobs for the whole bot. Everything else reads from here.
// control/settings.json can override the adjustable ones (src/settings.js)
// without touching this file — these are the defaults.
const config = module.exports = {
  // The coins it trades, each on its own USD-settled future with its own
  // position, stop and state (BTC in state/demo/, the others in
  // state/demo/<coin>/), all sharing one balance. COINS is the run order:
  // scripts/actions-run.sh runs `COIN=<coin> node src/run.js` for each, and
  // the last one also sends the combined daily / status pushes.
  COINS: ['HYPE', 'ETH', 'BTC'], // UNI was dropped on 2026-10-02 (too volatile for the fixed stop); its code path stays
  // Where each coin trades. BTC and ETH: the USD-settled futures (long + short,
  // 10x). NEAR: its futures are refused on the EEA site (OKX 51155, local
  // compliance), so it trades the SPOT pair NEAR-USDC: long only, no leverage,
  // the position at most 1x the balance, stop-loss as a bot-tagged algo order.
  // Per-coin instruments come from scripts/actions-run.sh (OKX_INSTRUMENT_<COIN>).
  // Backtest NEAR spot: 19 trades/yr, PF 1.41, profitable every year.
  // A coin's own risk per trade (% of the balance); the others use PORTFOLIO.RISK_PCT.
  // BTC+ETH at 2% + NEAR at 1%: 139 trades/yr, +4,247%, worst drop 37% (BTC+ETH alone: 120, +3,692%, 32%).
  // UNI (USD-settled future, long + short) at 1%: BTC+ETH+UNI 164 trades/yr, +4,377%, worst drop 35%, PF 1.56 (UNI's edge is the weakest: PF 0.96 before 2024, 1.62 since).
  COIN_RISK_PCT: { NEAR: 1, UNI: 1 },
  // The coin this process handles (COIN env var, default BTC) and its symbol
  // (USDT perpetual naming: BTCUSDT on Bybit, BTC-USDT-SWAP on OKX).
  COIN: (process.env.COIN || 'BTC').trim().toUpperCase(),
  get SYMBOL() { return this.COIN + 'USDT'; },

  // Where it trades, always in demo mode: 'okx' (OKX Demo Trading) or
  // 'bybit' (Bybit Demo Trading). EXCHANGE in .env overrides this; the keys
  // for it go in .env too (.env.example).
  EXCHANGE: 'okx',
  // On OKX: the BTC perpetual 'BTC-USDT-SWAP'; on OKX's EEA site (no USDT,
  // no perpetual swaps) the USD-settled, USDC-margined BTC future
  // 'BTC-USD_UM_XPERP-310328' (perpetual-style, runs to 2031, max 10x); or a
  // spot pair such as 'BTC-USDC' (long-only, unleveraged). OKX_INSTRUMENT in
  // .env (or the GitHub workflow) overrides this.
  OKX_INSTRUMENT: `${(process.env.COIN || 'BTC').trim().toUpperCase()}-USDT-SWAP`,

  // Signal timeframe: closed 4H candles (UTC-aligned: 00/04/08/12/16/20).
  // backtest/RESEARCH.md: 1D breakouts were much weaker on BTC.
  ENTRY_TF: '240',
  // New entries only within this many minutes of the 4H close. GitHub's cron
  // often delays or drops runs, so this leaves room for a few late ones; a
  // signal older than that isn't chased. Backtest: entering 1-4h after the
  // close costs nothing measurable (PF 1.43-1.46 vs 1.44 at the close).
  // Stops and exits still update on any run.
  ENTRY_FRESH_MIN: 180,

  // Where the candles come from: null = the exchange it trades on (the
  // other one as a fallback), or 'bybit' / 'okx'.
  MARKET_DATA: null,

  // Which signal trades, on closed 4H candles:
  //   'atlas-flip'  the ATLAS score swings from <= -FLIP_SCORE to >= +FLIP_SCORE
  //                 (or back) within FLIP_WINDOW candles (src/flip.js) — live
  //   'breakout'    Donchian channel breakout (src/signal.js) — the first setup
  // backtest/REPORT.md (+ research in ATLAS_FLIP.md): ±10 within 2 candles (8h) with the trend band, long and
  // short: ~97 trades a year, +644% 2021-26, worst drop 29%, PF 1.37 (±25 / 16h: ~60 a year,
  // +834%, 25%, PF 1.56 - fewer, better trades; breakout: 74, +374%, 32%).
  STRATEGY: 'atlas-flip',
  // How the ATLAS score is computed (src/atlasScore.js): 'graded' — the ATLAS
  // page's method: each indicator counts by its strength (RSI 85 more than
  // RSI 56), each group is averaged on its own and the groups are blended
  // Trend 35 / Momentum 25 / Structure 20 / Flow 20 — or 'classic', every
  // indicator a flat -1/0/+1 vote. Backtest at ±10 within 8h: graded ~60
  // trades a year, PF 1.47, worst drop 28%; classic ~97 a year, PF 1.37, 29%
  // (backtest/REPORT.md).
  SCORE_MODE: 'graded',
  FLIP_SCORE: 10,
  FLIP_WINDOW: 2,
  // Also enter when the score closes at +EXTREME_SCORE or higher (long) or
  // -EXTREME_SCORE or lower (short), the candle before being inside it (null =
  // off). BTC+ETH backtest, 2% risk each: flip only +3,086%, PF 1.56, worst
  // drop 38%; with 90 +3,692%, PF 1.60, 32%; 85 +3,514%, 1.59, 32%; 80 +2,924%,
  // PF 1.56, 34%; 75 +2,699%, PF 1.51, 36% (the lower the level, the more late
  // entries and the weaker the result). 80 chosen by the owner so that a steady
  // climb to +80 (BTC 2026-10-02: 8 -> 80 in a day, no swing) is traded.
  EXTREME_SCORE: 80,
  // Ignore a swing when the 4H close is more than this % from its 200-candle
  // 4H average (null = off). Backtest: PF 1.47 -> 1.56-1.61, better in both
  // halves and across the score/window grid; the losses were counter-trend
  // and over-extended entries.
  TREND_BAND_PCT: 10,

  // The breakout signal (src/signal.js), when STRATEGY is 'breakout'.
  CHANNEL_N: 15,       // enter when a 4H close breaks the high (low) of the previous 15 candles
  EXIT_N: 15,          // exit when a 4H close breaks the opposite side of the previous 15 candles
  ATR_LEN: 14,
  // 'long' = long-only, 'both' = longs and shorts. backtest/FREQUENCY.md:
  // long+short with a 15-candle channel trades ~74x a year (long-only 20: ~31)
  // and made more (+374% vs +324%, 2021-26) with a deeper worst drop (32% vs
  // 26%); profit factor 1.41 before / 1.51 from 2024. 1H and 2H signals didn't
  // hold up after fees.
  DIRECTION: 'both',

  // How a trade is sized and exited (the entry signals above are the same):
  //   'fixed' — every trade uses FIXED.MARGIN USDT of margin at PORTFOLIO.LEVERAGE (750 x 10x = $7500
  //             of position), a stop-loss at -FIXED.SL_USDT and a take-profit at +FIXED.TP_USDT of that
  //             position (-$100 / +$200 = 1.33% / 2.67% away), both on the exchange as one OCO pair. No
  //             trailing, no signal exit. A trade that loses = 5% of a 2000 balance, one that wins = +10%.
  //             Chosen (2026-10-02) for a sideways BTC: bounces of about 2-2.7%, 4H candles about 1%.
  //             With 2000 USDC of margin, two such trades fit at once; a third is cut to the free margin.
  //   'atr'   — the earlier rules: RISK_PCT of the balance at a 2 x ATR stop that trails 3 x ATR.
  // Spot coins (NEAR-USDC) can't be leveraged and keep the 'atr' rules.
  TRADE_MODE: 'fixed',
  FIXED: { MARGIN: 750, SL_USDT: 100, TP_USDT: 200 },
  // A coin's own fixed-mode numbers (merged over FIXED for that coin). ETH: 667 margin = a 6,667 USDT position, so
  // the same -$100 / +$200 sit 1.5% / 3% away from the entry (BTC: 750 margin, 1.33% / 2.67%). UNI (4H candles ~3%)
  // uses FIXED until it gets its own.
  // HYPE (4H candles ~2%, 7-day range ~11%) gets the same as ETH.
  COIN_FIXED: { ETH: { MARGIN: 667 }, HYPE: { MARGIN: 667 } },

  // Stops ('atr' mode), in ATRs of the 4H candles. Both live on the exchange as the position's
  // stop-loss, so they work while the machine running the bot is off.
  STOP_ATR: 2,         // initial stop: entry -/+ 2 x ATR
  TRAIL_ATR: 3,        // after each 4H close: best close since entry -/+ 3 x ATR (never loosens)

  // Money rules.
  PORTFOLIO: {
    STARTING_BALANCE: 2000, // USDT — the bot's allocation; it trades like a 2000 USDT account
    RISK_PCT: 2,            // loss at the initial stop per trade, % of the balance, per coin (COIN_RISK_PCT overrides it for one coin). Backtest BTC+ETH (graded, ±10/8h, ±90): 1% = +629%, 21% worst drop; 2% = +3,692%, 32%; 3% = +6,492%, 50%
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
