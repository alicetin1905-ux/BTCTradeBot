# The learning bot: research (2026-11-03)

**Question.** What can the three dashboards (GlassSphere, BTC-Halving, ATLAS) contribute to a bot for BTC and ETH that learns as it trades?

**Data.** Binance 4H candles (USD-M futures 2020-2026 with funding and taker flow; spot 2017-2026) and daily closes since 2017.

**Rule for every number below.** All tests are walk-forward: the model only ever trains on data from before the moment it decides.

## 1. A model that predicts the price directly: no edge

The first attempt was a ridge regression on 17 features. It predicted the next 1-7 days' move in ATR units.
- **Features:**
  - the ATLAS page's indicators;
  - GlassSphere's funding (contrarian) and taker flow;
  - BTC-Halving's 200-week-average ratio and halving-cycle phase.
- **Training:** retrained every week, with several memory lengths.
- **Result:** the out-of-sample correlation with the real move was between −0.09 and +0.02. A shorter memory (faster "learning") made it *worse*: the model chases noise.

This matches GlassSphere's own backtests (`backtests/glasssphere.md`): its signals hold an information coefficient of ±0.05 at most, and lose after costs.

## 2. Learning which setups to take: this works

The bot starts from two trend setups from the earlier bots:
- **pullback:** EMA50 vs EMA200 trend; a candle dips to EMA20 and closes back.
- **breakout:** a close beyond the 20-candle high or low, with the trend.

Each setup is followed with the live exits: stop 2 ATR, trailed 4 ATR behind the best close, 0.12% costs. That gives its result R, the profit in units of the initial risk.

The learner is a ridge regression. It is trained on the features at entry of every setup that has finished before now, whether the bot took it or not, BTC and ETH together. It only trades a setup when it expects at least 0 R.

Test setup for the table:
- `node research/walkforward.js` (the bot's own `src/learner.js`);
- Binance spot, BTC + ETH, 2% risk, at most 2 positions, position value at most 2× the balance.

| 2021 - Oct 2026 | Trades | Winners | Profit factor | $2,000 → | Worst drop |
|---|---|---|---|---|---|
| Setups alone | 516 | 30% | 1.31 | $15,444 | 36% |
| **With the learner** | **419** | **32%** | **1.48** | **$22,490** | **37%** |
| With the learner, 1% risk | 419 | 32% | 1.58 | $8,395 | 21% |

R per year with the learner:

| Year | 2021 | 2022 | 2023 | 2024 | 2025 | 2026 (to Oct) |
|---|---|---|---|---|---|---|
| Trades | 77 | 79 | 78 | 48 | 70 | 67 |
| R | +26.2 | 0.0 | +61.4 | +38.8 | +30.7 | +15.3 |

Starting the test in 2023 gives profit factor 1.52 (262 trades).

**Is the learning real?** I shuffled the features between setups (5 seeds), so the learner sees noise. The profit factor then fell to 1.14 - 1.32, the same as no learner. With the real features it is 1.48.

The same improvement shows on each setup alone (futures data):

| Setup | Without the learner | With the learner |
|---|---|---|
| pullback | 1.24 | 1.72 |
| breakout | 1.23 | 1.47 |
| supertrend flip | 1.31 | 1.56 |

## 3. Which inputs help (futures data, 2021-26, profit factor with the learner)

| Inputs | Profit factor | Worst drop |
|---|---|---|
| All 17 | 1.49 | 39% |
| Without GlassSphere funding | 1.58 | 36% |
| Without GlassSphere taker flow | 1.42 | 33% |
| **Without both GlassSphere inputs** (used) | **1.67** | **31%** |
| Without the BTC-Halving inputs | 1.37 | 42% |

- **ATLAS:** its indicators carry most of the information.
- **BTC-Halving:** the 200-week-average ratio and the cycle phase clearly help.
- **GlassSphere:** its order-flow inputs add noise, so they are left out. The bot doesn't need funding or flow data live.

**Memory.** Results counting half after 4 years (`LEARN.HALF_LIFE_BARS` 8760) did better than equal weight or a 1-2 year half-life (profit factor 1.48 vs 1.37 / 1.43).

## Honest limits

- **Winners and losers:** about 70% of trades lose, and the winners pay for them. Runs of 8-10 losses happen.
- **Drawdown:** at 2% risk the worst drop was 37%, which is $2,000 → ~$1,260 at some point. 1% halves that.
- **Choices made on the same data:** the feature choice, setups and memory length were picked on this data. Expect a profit factor nearer 1.3 than 1.5 going forward.
- **What the test skips:** fills at the 4H close (live: within 45 min, at the OKX price), and no funding.
- **Demo account:** OKX demo prices sometimes spike; the stops trigger on the index price for that reason.
