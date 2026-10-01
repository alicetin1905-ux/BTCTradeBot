# BTCTradeBot

A trading bot for **BTC only** (the BTC-USDT perpetual) on an **OKX Demo
Trading** account: mainnet prices, demo funds. It can trade on **Bybit Demo
Trading** instead (`EXCHANGE=bybit` in `.env`). It's built on the same engine
as [TradeBot](https://github.com/alicetin1905-ux/TradeBot): stop on the
exchange, state committed to this repo, a phone dashboard, ntfy alerts and a
bot-down alarm. The signal is different.

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
  the exchange, so it works while the Mac is off.
- **Exit:** a 4H close **below the lowest low of the previous 20 candles**
  (`EXIT_N`) closes at market, if the stop hasn't already.
- **Direction:** long-only by default. `DIRECTION: "both"` also shorts the
  mirror image. Long-only made more with a smaller worst drop; long+short only
  did better in the 2022 bear market.
- **Size:** each trade risks **2% of the balance** at its initial stop
  (`RISK_PCT`). Position value is capped at 2× the balance (`MAX_POSITION_X`),
  at 10× leverage, cross margin (`LEVERAGE`). One position at a time.
- **Balance:** the bot's own 2000 USDT allocation, moved by its realized P&L
  and BTC funding payments. A bigger demo wallet still trades like 2000 USDT.
- **Safety:**
  - `TRADEBOT_HALT=1` in `.env` stops new entries (an open position keeps its trailing stop).
  - The daily loss limit (10%) stops entries until 00:00 UTC.
  - `close-all` and `reset` are available as remote commands.
  - There is **no real-money mode**. The OKX client sends
    `x-simulated-trading: 1` on every request, so OKX refuses real-account
    keys. The Bybit client only knows `api-demo.bybit.com`.

Expect it to be wrong often. About 1 trade in 3 wins: most breakouts fail and
cost a little, and a few long trends pay for all of them. Long flat or losing
stretches are normal (2022 and 2025 in the backtest).

## Backtest (`node scripts/backtest.js` → `backtest/REPORT.md`)

The backtest runs the live signal code (`src/signal.js`) hour by hour on OKX
BTC 1H history since 2021: the same `BTC-USDT-SWAP` the bot trades on OKX. It
charges a 0.055% taker fee on each side (Bybit's; OKX's base rate of 0.05% is
slightly cheaper) and funding of about 0.01% per 8h, which longs pay.

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
node src/run.js              # full run: sync with the exchange, read 4H candles, exit / trail / enter
node src/run.js --sync       # sync the position and fills only — no new entries
node src/run.js --close-all  # cancel orders + close the BTC position on the exchange
bash scripts/reset.sh        # close it and start over from 2000 USDT (--clear-history wipes trades)
npm test                     # offline tests of the order logic
npm run backtest             # backtest/REPORT.md
npm run research             # backtest/RESEARCH.md + DONCHIAN.md
```

It needs Node 18+ and no dependencies. Keys come from `.env` (see `.env.example`).

## OKX EEA accounts: USD-settled BTC future, USDC margin, 10x

On OKX's EEA site (`my.okx.com`) the demo account holds no USDT and can't
trade perpetual swaps. Its futures are the USD-settled `BTC-USD_UM…` contracts.
The bot trades **`BTC-USD_UM_XPERP-310328`** there, which is the GitHub
workflow's default:

- **The contract:** a perpetual-style future that runs to 2031, with funding
  like a perpetual. 1 contract = 1 BTC, sizes in steps of 0.0001 BTC.
- **Margin in USDC** at **10x** leverage, **isolated** margin as in the OKX
  app (`OKX_MARGIN_MODE`; `cross` also works; max 10x). Sizing is
  still by risk: each trade loses 2% of the balance at its initial stop.
  Leverage only sets how much USDC is tied up as margin. The position is
  capped at 2× the balance (`MAX_POSITION_X`).
- **Long and short** possible (`DIRECTION`); long-only by default.
- **Signal from real prices:** this future only exists in OKX's demo
  environment, where it trades thinly (candle wicks up to ~11% off the real
  price). So the 4H signal reads the live BTC-USDT perpetual, the same data as
  the backtest. Orders and the stop go to the future, whose stop triggers on
  the mark price, which tracks the BTC index.

There's no USDC-margined BTC contract on OKX itself. For a spot-only setup
instead, set the repository variable `OKX_INSTRUMENT` to `BTC-USDC`
(long-only, no leverage, backtest +190%).

## Setup from your phone (GitHub Actions, no Mac)

The bot can run on GitHub's servers: `.github/workflows/bot.yml` does a full
run at :03 and :33 every hour and a sync at :18 and :48. It commits
`state/demo/` back to the repo after each run. Everything below works in a
phone browser.

1. **Create the OKX demo API key** on okx.com (desktop view in the phone
   browser if the app hides it):
   - Go to Trade → Demo trading, then profile → Demo Trading API → Create API key.
   - Permissions: **Read + Trade**, never Withdraw.
   - **No IP binding**, because GitHub's servers change addresses.
   - Write down the key, the secret and your passphrase.
2. **Add them as repository secrets.** On GitHub, open this repo → Settings →
   Secrets and variables → Actions → New repository secret, and create:
   - `OKX_API_KEY`
   - `OKX_API_SECRET`
   - `OKX_API_PASSPHRASE`
   - optionally `OKX_API_BASE` (regional OKX site) and `NTFY_TOPIC`
3. **Test without trading.** Go to Actions → BTC bot → Run workflow, action
   `check`. The log shows whether OKX accepts the keys from GitHub, your demo
   equity and the account mode (it must not be Spot mode). A red run explains
   what's wrong.
4. **Done.** From the next :03 or :33 the bot trades. Also turn on the
   dashboard (Settings → Pages → branch `main`, folder `/`) and subscribe to
   the ntfy topic for alerts. If runs start failing you get a push, repeated
   every 6h, and an all-clear when they recover.

To pause new entries, add a repository **variable** (not a secret)
`TRADEBOT_HALT` = `1`. Settings and remote commands work as described below,
by editing the files on GitHub.

Use GitHub Actions **or** the Mac, never both: two copies would trade the
same account. GitHub may start scheduled runs late, or skip one when it's
busy. That's why there are two full runs an hour, and the stop sits on OKX
either way.

## Setup on the Mac

Alternatively, the bot runs on your Mac (or any always-on machine) from cron.

1. **Get an OKX demo API key.**
   - Log in at <https://www.okx.com> and open **Trade → Demo trading**.
   - While in demo mode, open the profile menu → **Demo Trading API** →
     **Create API key**.
   - Permissions: **Read + Trade** only, never Withdraw. Bind it to your IP if
     you can. Note the key, the secret and the passphrase you chose.
   - The demo account's mode must allow derivatives (Futures or
     Multi-currency margin, not Spot mode). Net (one-way) and long/short
     position mode both work.
   - Your demo account starts with demo USDT. The bot trades like a 2000 USDT
     account whatever the wallet holds.
2. **Clone and try one run.**
   ```
   git clone https://github.com/alicetin1905-ux/BTCTradeBot.git ~/BTCTradeBot && cd ~/BTCTradeBot
   cp .env.example .env      # EXCHANGE=okx + OKX_API_KEY / OKX_API_SECRET / OKX_API_PASSPHRASE
   npm test
   node src/run.js           # one run — check the output
   ```
   If your OKX account belongs to a regional site (e.g. `my.okx.com` in the
   EEA), set `OKX_API_BASE` to it. Keys only work on their own site.
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

### How OKX differs under the hood (`src/okx.js`)

- **Contracts:** OKX trades contracts (1 = 0.01 BTC). The client converts, so
  the rest of the bot works in BTC.
- **The stop:** it's an OKX stop-loss algo order. It's attached to the entry
  order, and trailing it amends that order. If there's none, the client places
  a whole-position stop.
- **P&L:** rebuilt from fills (realized P&L plus fees, including the entry
  fee), so it matches what OKX shows.
- **Funding:** read from the account bills.

### Bybit instead

Set `EXCHANGE=bybit` and the `BYBIT_*` keys in `.env`. Bybit geo-blocks many
regions and cloud hosts (GitHub Actions too), so the machine must reach
`api-demo.bybit.com` and `api.bybit.com`. The bot won't switch exchanges while
a position is open: close it first.

### Next to TradeBot

The two bots can run on the same Mac without touching each other:

- **Separate cron lines:** `btc-run.sh` vs TradeBot's `exchange-run.sh`, and
  each setup script only replaces its own lines.
- **Separate GitHub tokens:** this repo uses its own credential file,
  `~/.btctradebot-git-credentials`.
- **Separate lock files and logs.**

On OKX the two bots don't share an exchange account at all, since TradeBot
trades on Bybit. If you run this bot on Bybit instead, give it its own demo
account or sub-account. TradeBot counts every open position on the account as
one of its slots, and its `close-all`/`reset` also closes `BTCUSDT`.

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
| `src/exchange.js` | reconcile, exit, trail, enter; P&L and funding booking (exchange-neutral) |
| `src/run.js` | one run / sync / close-all / reset, state files, remote commands |
| `src/market.js` | 4H candles from the trading exchange, the other one as a fallback |
| `src/okx.js` | OKX v5 client (Demo Trading only) |
| `src/bybit.js` | Bybit v5 client (Demo Trading only) |
| `state/demo/*.json` | the bot's memory, read by the dashboard |
| `index.html` | the dashboard (GitHub Pages) |
| `.github/workflows/bot.yml`, `scripts/actions-run.sh` | the bot on GitHub Actions |
| `scripts/okx-check.js` | read-only OKX connection / key / account check |
| `scripts/backtest.js`, `scripts/research.js` | backtest of the live rules, strategy research |

Demo funds only: every number here is a rehearsal of the strategy, not
investment advice.
