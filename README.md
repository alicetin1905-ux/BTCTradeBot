# BTCTradeBot

A trading bot for **BTC and ETH** on an **OKX Demo Trading** account: mainnet
prices, demo funds. It runs on GitHub Actions (no computer needed) and trades
the EEA site's USD-settled BTC and ETH futures with USDC margin at 10x. It can also
trade the BTC-USDT perpetual, or **Bybit Demo Trading** (`EXCHANGE=bybit`).

It's built on the same engine as
[TradeBot](https://github.com/alicetin1905-ux/TradeBot): stop on the exchange,
state committed to this repo, a phone dashboard, ntfy alerts and a bot-down
alarm.

## How the signal was found

1. **TradeBot's rules don't work on BTC.** Its ATLAS score with T1/T2/T3
   targets **loses money on BTC** in every variant tried, 27 in total
   (`backtest/ATLAS_ON_BTC.md`, and TradeBot's own `COIN_WF.md`: 1 of 7 years
   positive). That's why TradeBot only uses BTC as a filter.
2. **Trend following on 4H with a trailing stop does work.** Donchian
   breakouts, EMA crosses and Supertrend all made money before and after 2024
   on 4H candles (`RESEARCH.md`, `DONCHIAN.md`). 1H loses to fees
   (`FREQUENCY.md`). The breakout was the first live signal.
3. **The ATLAS score works when used as a fast swing, with a trailing stop
   instead of fixed targets.** Trade when the score swings from −10 to +10
   (or back) within 8 hours, ignoring swings far from the 200-candle average.
   This made more than the breakout (+644% vs +374%) at a similar worst drop
   (29% vs 32%), with more trades (~97 a year vs ~74). The stricter ±25 / 16h
   setting makes fewer, better trades (+834%, PF 1.56); ±10 / 8h was chosen
   for trade count (`ATLAS_FLIP.md`). This is the live signal now.

## Coins: BTC and ETH (`COINS` in `config.js`)

The same rules run on **BTC and ETH**, each with its own position, stop and
state (BTC in `state/demo/`, ETH in `state/demo/eth/`), sharing **one balance**
and one daily loss limit. A run is one `COIN=<coin> node src/run.js` process per
coin (`scripts/actions-run.sh`; ETH first, BTC last, and the last one sends the
combined phone pushes). One coin failing doesn't stop the other.

Why: one position at a time caps the trade count, and the flip signal also
works on ETH (a coin it was never tuned on). Backtest from 2021-03, live
settings (graded score, ±10 within 8h, 200-MA band), by risk per trade:

| | Trades/yr | Return | Worst drop | PF | PF before / from 2024 |
|---|---:|---:|---:|---:|---:|
| BTC alone, 2% risk (before) | 65 | +680% | 31% | 1.46 | 2.06 / 1.45 |
| BTC alone, 1% | 65 | +215% | 17% | 1.57 | 2.06 / 1.45 |
| ETH alone, 1% | 54 | +158% | 16% | 1.80 | 1.33 / 2.27 |
| BTC + ETH, 1% each | 119 | +629% | 21% | 1.64 | 1.71 / 1.76 |
| BTC + ETH, 1.5% each | 119 | +1,510% | 30% | 1.60 | 1.71 / 1.76 |
| **BTC + ETH, 2% each (live)** | **119** | **+3,086%** | **38%** | **1.56** | **1.71 / 1.76** |
| BTC + ETH, 3% each | 119 | +6,492% | 50% | 1.43 | 1.71 / 1.76 |

SOL has no demo future on this account (only BTC, ETH, XRP, DOGE and a few
others do: `scripts/okx-check.js` lists them). ETH's instrument is
`ETH-USD_UM_XPERP-310328` (override with the `OKX_INSTRUMENT_ETH` variable).
Order-tested on the demo account with the `testtrade` workflow (coin = ETH).

## The rules (`config.js`, `src/flip.js`)

- **Signal: the ATLAS score swinging fast.** The score is TradeBot's ATLAS
  score (`src/atlasScore.js`, ~25 indicators, −100 to +100), computed on
  closed 4H candles (00/04/08/12/16/20 UTC). Nothing repaints. It uses the
  **graded** method (`SCORE_MODE`), the same as the ATLAS page: each
  indicator counts by its strength and the groups are blended Trend 35 /
  Momentum 25 / Structure 20 / Flow 20. Until 2026-10-01 it used the
  classic flat −1/0/+1 votes (`SCORE_MODE: "classic"` switches back).
  - **Long** when the score closes at **+10 or higher** and was at **−10 or
    lower** within the previous **2 candles (8h)**: a fast swing from
    bearish to bullish.
  - **Short** is the mirror image.
  - **Extreme entry:** also enter when the score first closes at **+90 or
    higher** (long) or **−90 or lower** (short), the candle before being
    inside it, with the same trend band (`EXTREME_SCORE`, `null` = off). On
    BTC + ETH at 2% risk it lifts +3,086% to +3,692% (PF 1.56 → 1.60, worst
    drop 38% → 32%); on BTC alone it changes almost nothing (+662% → +668%).
    Lower levels (75, 60) made it worse.
  - **Trend band:** a swing is ignored when the 4H close is more than 10 %
    from its 200-candle 4H average (`TREND_BAND_PCT`): the flip lost on
    counter-trend and over-extended entries.
  - Settings: `FLIP_SCORE`, `FLIP_WINDOW`, `TREND_BAND_PCT`, `DIRECTION`.
- **Price and volume only.** The score is calculated without the
  funding / open interest / order book / taker-flow inputs, which have no
  history. So the live score is exactly the one the backtest used.
- **Entry:** a market order with the stop attached, on the run right after the
  4H close (within 3 h, `ENTRY_FRESH_MIN`, so late GitHub runs don't miss it). One attempt per signal candle.
- **Initial stop:** 2 × ATR(14) from the entry (`STOP_ATR`).
- **Trailing stop:** after every 4H close the stop moves to *best close since
  entry ∓ 3 × ATR* (`TRAIL_ATR`). It only ever tightens, and it sits on the
  exchange, so it works between runs.
- **Exit:** an opposite swing closes the position at market, and the bot
  reverses into the new direction. Otherwise the trailing stop exits.
- **Size:** each trade risks **2% of the balance** at its initial stop
  (`RISK_PCT`). Position value is capped at 2× the balance (`MAX_POSITION_X`),
  at 10× leverage, isolated margin. One position at a time.
- **Balance:** the bot's own 2000 USDT/USDC allocation, moved by its realized
  P&L and funding payments. A bigger demo wallet still trades like 2000.
- **Safety:**
  - `TRADEBOT_HALT=1` stops new entries (an open position keeps its trailing stop).
  - The daily loss limit (10%) stops entries until 00:00 UTC.
  - `close-all` and `reset` are available as remote commands.
  - There is **no real-money mode**. The OKX client sends
    `x-simulated-trading: 1` on every request, so OKX refuses real-account
    keys. The Bybit client only knows `api-demo.bybit.com`.
- **The earlier signal** is still built in: the 4H channel breakout
  (`"STRATEGY": "breakout"`, `src/signal.js`).

Expect it to be wrong often. Only about 1 trade in 3 wins: most swings fade
and cost a little, and a few long trends pay for all of them.

## Backtest (`node scripts/backtest.js` → `backtest/REPORT.md`)

The backtest runs the live signal code (`src/flip.js` with `src/atlasScore.js`)
hour by hour on OKX BTC 1H history since 2021. It charges a 0.055% taker fee
on each side and funding of about 0.01% per 8h, which longs pay.

| | Trades | Win % | Return | Worst drop | Profit factor |
|---|---:|---:|---:|---:|---:|
| **Live: ATLAS flip ±10 within 8h, 200-MA band ±10%, long + short, graded score** | 367 (~64/yr) | 32 | **+662%** | 31% | 1.46 |
| Same with the classic score (live until 2026-10-01) | 555 (~97/yr) | 29 | +644% | 29% | 1.37 |
| Previous: ±25 within 16h, band ±10%, classic score | 342 (~60/yr) | 32 | +834% | 25% | 1.56 |
| + 0.05% slippage per side (graded) | 367 | 31 | +472% | 34% | 1.37 |
| ±15 within 8h (classic score) | 413 (~72/yr) | 31 | +432% | 33% | 1.40 |
| ±10 within 16h (classic score) | 667 (~116/yr) | 28 | +612% | 36% | 1.33 |
| Breakout 15, long + short (the previous live setup) | 424 (~74/yr) | 34 | +374% | 32% | 1.35 |
| Breakout 20, long-only (the first setup) | 179 (~31/yr) | 36 | +324% | 26% | 1.70 |
| Breakout 15 on 1H signals | 1771 | 29 | −88% | 92% | 0.90 |

These are compounding results, 2021-01 → 2026-09, starting from 2000 USDT.

Year by year, starting each year fresh with 2000 USDT at a fixed $40 risk per trade:

| | 2021 | 2022 | 2023 | 2024 | 2025 | 2026 (to Sep) |
|---|---:|---:|---:|---:|---:|---:|
| ATLAS flip (live, graded) | +693 | +308 | +2383 | +1005 | −99 | +854 |
| Buy & hold 2000 USDT | +1197 | −1284 | +3113 | +2425 | −128 | −94 |

**Out-of-sample check:** choosing the setting on 2021–2023 alone picks exactly
±25 within 3 candles (profit factor 1.93). On 2024–2026, which that choice
never saw, it made +1870 with a profit factor of 1.49. (The 200-candle trend
band and the 4-candle window were added afterwards, from the trade-by-trade
look in `backtest/ATLAS_FLIP.md`: they lifted every one of 8 settings checked
and 22 of 25 grid cells are profitable in both periods, but they were found on
the full period, so expect somewhat less than the table.) 27 of 35 neighbouring
settings are profitable in both periods (`backtest/ATLAS_FLIP.md`).

Other research behind the choice:
- `ATLAS_ON_BTC.md`: TradeBot's ATLAS rules lose on BTC.
- `RESEARCH.md`, `DONCHIAN.md`: breakouts.
- `FREQUENCY.md`: 1H/2H/4H comparison.
- `ATLAS_FLIP.md`: the flip, and combining it with the breakout (worse).

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
| `src/flip.js`, `src/atlasScore.js` | the ATLAS flip signal (live and backtest) and the ATLAS score |
| `src/signal.js` | the breakout signal and the trailing-stop rule |
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
