# BTCTradeBot

A trading bot for **BTC only** (Bybit `BTCUSDT` perpetual) on **Bybit Demo
Trading**: mainnet prices, demo funds. It's built on the same engine as
[TradeBot](https://github.com/alicetin1905-ux/TradeBot): Bybit demo client,
stop on the exchange, state committed to this repo, a phone dashboard, ntfy
alerts and a bot-down alarm. The signal is different.

## Why not TradeBot's ATLAS signal?

TradeBot's ATLAS score with its T1/T2/T3 exits **loses money on BTC**. It lost
in every variant tried over 2021–2026 (27 of them: other scores, targets,
stops, risk; `backtest/ATLAS_ON_BTC.md`). TradeBot's own
`COIN_WF.md` shows the same thing: BTC was positive in 1 of 7 years, with a
profit factor of 0.88. That's why TradeBot only uses BTC as a filter.

What does work on BTC is **trend following on 4H candles with a trailing
stop**. `backtest/RESEARCH.md` compares Donchian breakouts, EMA crosses and
Supertrend flips, on 4H and 1D candles, long-only and long+short. Parameters
were picked on 2021–2023 and then checked on 2024–2026. Nearly every 4H parameter set
made money in both periods (all but a few EMA sets with a daily-trend filter);
on 1D it was about half. The 4H Donchian breakout
was the most robust: 188 of 192 nearby settings made money in both periods
(`backtest/DONCHIAN.md`), so the result doesn't hinge on one lucky number.

## The rules (`config.js`, `src/signal.js`)

- **Signal:** closed 4H candles only (00/04/08/12/16/20 UTC), nothing repaints.
- **Entry:** long when a 4H candle **closes above the highest high of the
  previous 20 candles**. It's a market order with the stop attached, placed
  on the run right after the close (within 60 min, `ENTRY_FRESH_MIN`). It
  doesn't chase an old breakout, and makes one attempt per breakout candle.
- **Initial stop:** 2 × ATR(14) below the entry (`STOP_ATR`).
- **Trailing stop:** after every 4H close the stop moves up to *best close
  since entry − 3 × ATR* (`TRAIL_ATR`). It only ever tightens, and it's set on
  Bybit, so it works while the Mac is off.
- **Exit:** a 4H close **below the lowest low of the previous 20 candles**
  (`EXIT_N`) closes at market, if the stop hasn't already.
- **Direction:** long-only by default. `DIRECTION: "both"` also shorts the
  mirror image. Long-only made more with a smaller worst drop; long+short only
  did better in the 2022 bear market.
- **Size:** each trade risks **2% of the balance** at its initial stop
  (`RISK_PCT`). Position value is capped at 2× the balance (`MAX_POSITION_X`),
  at 5× leverage (`LEVERAGE`). One position at a time.
- **Balance:** the bot's own 2000 USDT allocation, moved by its realized P&L
  and BTC funding payments. A bigger demo wallet still trades like 2000 USDT.
- **Safety:**
  - `TRADEBOT_HALT=1` in `.env` stops new entries (an open position keeps its trailing stop).
  - The daily loss limit (10%) stops entries until 00:00 UTC.
  - `close-all` and `reset` are available as remote commands.
  - There is **no real-money mode**: the Bybit client only knows `api-demo.bybit.com`.

Expect it to be wrong often. About 1 trade in 3 wins: most breakouts fail and
cost a little, and a few long trends pay for all of them. Long flat or losing
stretches are normal (2022 and 2025 in the backtest).

## Backtest (`node scripts/backtest.js` → `backtest/REPORT.md`)

The backtest runs the live signal code (`src/signal.js`) hour by hour on OKX
BTC 1H history since 2021. It charges the 0.055% taker fee on each side and
funding of about 0.01% per 8h, which longs pay.

| | Trades | Win % | Return | Worst drop | Profit factor |
|---|---:|---:|---:|---:|---:|
| **Live: long-only, 2% risk** | 179 | 36 | **+324%** | 26% | 1.70 |
| + 0.05% slippage per side | 179 | 35 | +272% | 28% | 1.61 |
| Long + short | 354 | 34 | +287% | 28% | 1.36 |
| Risk 1% | 179 | 36 | +125% | 14% | 1.83 |

These are compounding results, 2021-01 → 2026-09, starting from 2000 USDT.

Year by year, starting each year fresh with 2000 USDT at a fixed $40 risk per trade:

| | 2021 | 2022 | 2023 | 2024 | 2025 | 2026 (to Sep) |
|---|---:|---:|---:|---:|---:|---:|
| Bot (net USDT) | +267 | −386 | +2511 | +941 | −105 | +447 |
| Buy & hold 2000 USDT | +1197 | −1284 | +3113 | +2425 | −128 | −90 |

The settings were picked on 2021–2023 (+2392, profit factor 2.22). On
2024–2026, which the choice never saw, the bot made +1282 with a profit factor
of 1.70.

It's still an approximation: no slippage in the main line, funding is
estimated, and fills come at candle closes.

## Running it

```
node src/run.js              # full run: sync with Bybit, read 4H candles, exit / trail / enter
node src/run.js --sync       # sync the position and fills only — no new entries
node src/run.js --close-all  # cancel orders + close the BTC position on Bybit
bash scripts/reset.sh        # close it and start over from 2000 USDT (--clear-history wipes trades)
npm test                     # offline tests of the order logic
npm run backtest             # backtest/REPORT.md
npm run research             # backtest/RESEARCH.md + DONCHIAN.md
```

It needs Node 18+ and no dependencies. Keys come from `.env` (see `.env.example`).

## Setup on the Mac

Bybit geo-blocks GitHub Actions and many cloud regions, so the bot runs on
your Mac (or a VPS in a region Bybit serves). It needs both
`api-demo.bybit.com` and `api.bybit.com`.

1. **Get a Bybit demo key.** Log in at <https://www.bybit.com> and switch to
   **Demo Trading**. Then *API Management → Create New Key* while still in
   Demo Trading. Use a system-generated key with **Read-Write**, permissions
   **Contract → Orders + Positions** only, **no withdrawal/transfer**,
   restricted to your IP. The account needs a Unified Trading Account in
   **one-way** position mode.
2. **Clone and try one run.**
   ```
   git clone https://github.com/alicetin1905-ux/BTCTradeBot.git ~/BTCTradeBot && cd ~/BTCTradeBot
   cp .env.example .env      # add the key
   npm test
   node src/run.js           # one run — check the output
   ```
3. **Automate it:** `bash scripts/setup-mac.sh`. It asks once for a GitHub
   fine-grained token (**BTCTradeBot only**, *Contents: Read and write*), which
   lets runs upload `state/demo/`. Then it installs two cron lines:
   - `:02` every hour: full run (`scripts/btc-run.sh`)
   - every 5 minutes: sync (`scripts/btc-run.sh sync`)

   Logs go to `logs/demo.log`. Keep the Mac awake.
4. **Dashboard:** in this repo's GitHub *Settings → Pages*, deploy from branch
   `main`, folder `/`. The dashboard is then at
   <https://alicetin1905-ux.github.io/BTCTradeBot/>. Add it to the home screen.
5. **Alerts:** in the ntfy app, subscribe to `btctradebot-q7m2kx9vfa3c`
   (`config.js` → `NOTIFY`). You get entries, exits, stop moves, a quiet status
   every 4 hours and a daily summary. The watchdog workflow alerts you when no
   hourly run has happened for over 2 hours.

### Next to TradeBot

The two bots can run on the same Mac without touching each other:

- **Separate cron lines:** `btc-run.sh` vs TradeBot's `exchange-run.sh`, and
  each setup script only replaces its own lines.
- **Separate GitHub tokens:** this repo uses its own credential file,
  `~/.btctradebot-git-credentials`.
- **Separate lock files and logs.**

On Bybit, give the BTC bot **its own demo account or sub-account** if you can.
This bot only ever reads, counts and closes `BTCUSDT`, so TradeBot's coins are
safe from it. **TradeBot doesn't return the favour:**

- It counts every open position on the account as one of its slots.
- Its `close-all`/`reset` also closes `BTCUSDT`, which would end this bot's
  trade.

## Changing settings

`control/settings.json` overrides the adjustable values
(`src/settings.js` lists them with their limits):

- risk %, max position size, leverage, daily loss limit
- direction, breakout/exit channel lengths
- stop and trail distances
- entry window, candle source, status interval

For example:

```json
{ "RISK_PCT": 1.5, "DIRECTION": "both" }
```

The dashboard's **Edit settings** button opens the file in GitHub's editor.
The Mac picks it up on its next run (≤ 5 min). Invalid values keep the default
and are listed in red on the dashboard.

## Remote commands

`control/commands.json` holds one-off actions. Each `id` runs once:

```json
[{ "id": "2026-10-01-close", "action": "close-all" }]
[{ "id": "2026-10-01-reset", "action": "reset", "clearHistory": true }]
```

`close-all` closes the BTC position; the bot keeps running and can enter on
the next breakout. `reset` also restarts the tracking from 2000 USDT.

## Files

| Path | What |
|---|---|
| `src/signal.js` | the breakout / exit / trailing-stop logic (shared with the backtest) |
| `src/exchange.js` | reconcile, exit, trail, enter on Bybit; P&L and funding booking |
| `src/run.js` | one run / sync / close-all / reset, state files, remote commands |
| `src/market.js` | 4H candles: Bybit, OKX fallback |
| `src/bybit.js` | Bybit v5 client (Demo Trading only) |
| `state/demo/*.json` | the bot's memory, read by the dashboard |
| `index.html` | the dashboard (GitHub Pages) |
| `scripts/backtest.js`, `scripts/research.js` | backtest of the live rules, strategy research |

Demo funds only: every number here is a rehearsal of the strategy, not
investment advice.
