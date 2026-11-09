# BTC-ETH-BOT — the learning bot

(The repository and the dashboard address keep the old name `BTCTradeBot`.)

A trading bot for **BTC and ETH** on the **OKX demo account** (EEA site): 2000 USDC, 5x leverage, isolated margin (10x until 2026-11-09).
It started on 2026-11-03.

## What it does

On every 4H close (00/04/08/12/16/20 UTC) it looks for two trend setups:

- **pullback:** the trend is up (EMA50 above EMA200, close above EMA200); a candle dips to EMA20 and closes back
  above it. Shorts are the mirror image.
- **breakout:** with the trend, the close breaks the high (low) of the previous 20 candles.

Every setup since 2017 is followed with the bot's own exits, so each has a result in **R**: the profit in units of
the loss at the initial stop. A **ridge regression** (`src/learner.js`) learns from those results what makes a
setup work. Its inputs are:

- the **ATLAS** page's indicators: EMA stack, price vs EMA200, Supertrend, ADX/DI, RSI, MACD, Stoch RSI, OBV,
  Bollinger, 1-day and 1-week moves;
- the **BTC-Halving** page's 200-week-average ratio and the halving-cycle phase.

The **GlassSphere** order-flow inputs (funding, taker flow) were tested and made it worse, so they are left out.

On every full run the model is **retrained on every setup that has finished**, BTC and ETH together, whether the
bot took it or not. Older results count half after 4 years. The bot only trades a setup the model expects to win
(`LEARN.MIN_R` 0). So every finished setup is something it learns from.

**Money rules:**
- 1% of the balance at risk per trade.
- Initial stop 2×ATR, trailed 5×ATR behind the best close; no take-profit.
- At most 2 positions (one per coin), each at most 2× the balance.
- Daily loss limit 20%.

The stop is judged on the **real** market price (Binance spot, the learner's own data): on every run and 5-minute sync
the bot checks the highest / lowest price since the last check and closes at market when the stop was reached. The OKX
demo contracts sometimes print prices the real market never saw, so OKX only holds a **safety stop** (2× the stop
distance, always inside the liquidation price) for when the Mac is off. After each closed position the bot books
OKX's own realized P&L (fees, funding, a liquidation) so its balance follows the account.

## The test (`node research/walkforward.js`, details in `research/LEARNING.md`)

Walk-forward test: the model only learns from what happened before each decision. Binance spot candles, 2021 - Oct
2026, BTC + ETH:

| | Trades | Winners | Profit factor | $2,000 → | Worst drop |
|---|---|---|---|---|---|
| Setups alone (2% risk, trail 4) | 516 | 30% | 1.31 | $15,444 | 36% |
| With the learner (2% risk, trail 4) | 419 | 32% | 1.48 | $22,490 | 37% |
| **Live settings: learner, 1% risk, trail 5** | 355 | 31% | **1.73** | **$9,766** | **21%** |

With the live settings every year was positive: +34, +7, +55, +35, +28 and +28 R (2021 - 2026). With features shuffled at random, the learner gives no
improvement, so the learning is real.

It still loses about 7 trades in 10. A drop of a fifth of the balance has happened before, and will happen again.
Expect less going forward than the test shows. This is demo money and not investment advice.

## Running it

```
node src/run.js              # full run: sync with OKX, update the history, retrain, exit / trail / enter
node src/run.js --sync       # sync the positions and fills only (every 5 min) — no new entries
node src/run.js --close-all  # cancel orders + close this coin's position
npm test                     # offline tests
npm run walkforward          # the walk-forward test with the bot's own code
```

It needs Node 18+ and no dependencies.
- **Keys:** `.env` (`.env.example`).
- **History:** the full history (Binance spot 4H and daily since 2017, OKX spot as a fallback) is cached in
  `cache/` (not committed) and topped up every run.
- **Model:** what it learned goes to `state/demo/model.json`; the dashboard shows it under *What the bot learned*.

## OKX EEA accounts: USD-settled futures, USDC margin, 5x

On OKX's EEA site (`my.okx.com`) the demo account holds no USDT and can't
trade perpetual swaps. Its futures are the USD-settled `BTC-USD_UM…` contracts.
The bot trades **`BTC-USD_UM_XPERP-310328`** there, which is the GitHub
workflow's default:

- **The contract:** a perpetual-style future that runs to 2031, with funding
  like a perpetual. 1 contract = 1 BTC, sizes in steps of 0.0001 BTC.
- **Margin in USDC** at **5x** leverage, **isolated** margin as in the OKX
  app (`OKX_MARGIN_MODE`; `cross` also works; max 10x). Sizing is
  still by risk: each trade loses 2% of the balance at its initial stop.
  Leverage only sets how much USDC is tied up as margin. The position is
  capped at 2× the balance (`MAX_POSITION_X`).
- **Long and short** possible (`DIRECTION`); long-only by default.
- **Signal from real prices:** this future only exists in OKX's demo
  environment, where it trades thinly (candle wicks up to ~11% off the real
  price). So the learner reads Binance spot candles, the same data as the
  test. Orders and the stop go to the future; the stop triggers on the index
  price. ETH trades `ETH-USD_UM_XPERP-310328` the same way.
- **SOL** has no perpetual-style future on the EEA demo. Its dated futures
  there trade at broken prices, so the bot doesn't trade it.

There's no USDC-margined BTC contract on OKX itself. For a spot-only setup
instead, set the repository variable `OKX_INSTRUMENT` to `BTC-USDC`
(long-only, no leverage, backtest +190%).

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
   - `:02` and `:32` every hour: full run (`scripts/btc-run.sh`)
   - every 5 minutes: sync (`scripts/btc-run.sh sync`)

   Logs go to `logs/demo.log`. Keep the Mac awake.
4. **Dashboard:** in this repo's GitHub *Settings → Pages*, deploy from branch
   `main`, folder `/`. The dashboard is then at
   <https://alicetin1905-ux.github.io/BTCTradeBot/>. Add it to the home screen.
5. **Alerts:** in the ntfy app, subscribe to `btctradebot-q7m2kx9vfa3c`
   (`config.js` → `NOTIFY`). You get entries, exits, stop moves, a quiet status
   every 4 hours and a daily summary. The watchdog workflow alerts you when no
   full run has happened for over 2 hours.

## Changing settings

`control/settings.json` overrides the adjustable values
(`src/settings.js` lists them with their limits):

- risk %, max position size, leverage, daily loss limit
- direction, the learner's minimum expected R (`LEARN_MIN_R`)
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

`control/commands.json` holds one-off actions. Each `id` runs once per coin:

```json
[{ "id": "2026-11-10-close", "action": "close-all" }]
```

- `close-all` closes the positions; the bot keeps running.
- `reset` (with `"clearHistory": true`) also restarts the tracking from 2000.

## Files

| Path | What |
|---|---|
| `src/learner.js` | the setups, their results, the learner |
| `src/features.js` | the model's inputs (ATLAS indicators, 200-week average, halving cycle) |
| `src/model.js` | weighted ridge regression |
| `src/history.js` | the candle history for the learner (Binance spot, OKX fallback), cached in `cache/` |
| `src/exchange.js` | reconcile, trail, enter; P&L and funding booking |
| `src/run.js` | one run / sync / close-all / reset, state files, remote commands |
| `src/okx.js` | OKX v5 client (Demo Trading only) |
| `state/demo/*.json` | the bot's memory (ETH in `state/demo/eth/`), read by the dashboard |
| `index.html` | the dashboard (GitHub Pages) |
| `research/` | the walk-forward test and the research notes |
| `scripts/setup-mac.sh`, `scripts/btc-run.sh` | cron on the Mac |
| `scripts/okx-check.js` | read-only OKX connection / key / account check |

Demo funds only: every number here is a rehearsal of the strategy, not investment advice.
