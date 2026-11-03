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

## 4. Settings at 1% risk (2026-11-03)

The owner chose 1% risk and asked for the most profitable settings. The search covered:
- the stop (1.5 - 3 ATR) and the trailing distance (3 - 6 ATR);
- the minimum expected R, the breakout length and the memory.

Each combination was judged in both halves, 2021-23 and 2024-26. A setting only counted when **both** halves were
strong and its neighbours were close, not when one corner of the grid happened to shine.

The best corner was stop 1.5 / trail 6 / minimum 0.2 R: profit factor 1.88. Its neighbours sit around 1.55, which
looks like luck, so it was not taken.

| Stop | Trail | 2021-23 PF | 2024-26 PF | 2021-26 PF | $2,000 → | Worst drop |
|---|---|---|---|---|---|---|
| 2 | 4 (before) | 1.56 | 1.60 | 1.58 | $8,395 | 21% |
| 2 | 4.5 | 1.57 | 1.75 | 1.68 | $9,096 | 21% |
| **2** | **5 (live)** | **1.65** | **1.77** | **1.73** | **$9,766** | **21%** |
| 2 | 5.5 | 1.65 | 1.52 | 1.57 | $7,495 | 21% |
| 2.25 | 5 | 1.66 | 1.69 | 1.68 | $7,911 | 19% |
| 1.75 | 5 | 1.69 | 1.36 | 1.48 | $8,653 | 25% |

R per year with the live settings:

| Year | 2021 | 2022 | 2023 | 2024 | 2025 | 2026 (to Oct) |
|---|---|---|---|---|---|---|
| R | +34.3 | +7.4 | +55.1 | +34.9 | +27.6 | +28.2 |

The other choices stayed as they were. Each of the alternatives below did worse than the live 1.73:

| Choice | Alternative | Profit factor |
|---|---|---|
| Minimum expected R | −0.1 | 1.66 |
| | +0.1 | 1.52 |
| Breakout length | 15 candles | 1.60 |
| | 30 candles | 1.58 |
| Memory (half-life) | 2 years | 1.51 |
| | none | 1.59 |
| Positions at once | 1 | 1.60 (drop only 11%, but $5,014) |

Even this choice was made on the same data. A profit factor around 1.5 - 1.6 live would already be in line with it.

## 5. More coins? No (2026-11-03)

These contracts on the OKX EEA demo trade at a price that matches the real market: DOGE, HYPE, ETC, AVAX, BCH, FIL.
Broken in demo (bid/ask 3 - 55% off the real price, or empty): XRP, NEAR, UNI, ONDO, LINK, DOT, SUI, ARB, SOL.

HYPE has only 6 weeks of Binance spot history, so it couldn't be tested. All tests below use 1% risk, stop 2, trail 5.

| Coins | Max open | 2021-23 PF | 2024-26 PF | 2024-26 $2,000 → | Worst drop | 2021-26 $2,000 → |
|---|---|---|---|---|---|---|
| **BTC, ETH (live)** | 2 | 1.65 | **1.77** | **$4,266** | **16%** | $9,766 |
| + AVAX | 2 | 1.96 | 1.50 | $4,071 | 24% | $18,088 |
| + AVAX | 3 | 1.80 | 1.47 | $4,284 | 31% | $19,810 |
| + DOGE | 3 | 1.54 | 1.47 | $4,501 | 22% | $16,574 |
| + AVAX, DOGE | 4 | 1.64 | 1.35 | $4,523 | 30% | $34,395 |
| + AVAX, DOGE, ETC, FIL | 4 | 1.81 | 1.20 | $3,646 | 32% | $85,778 |

**Result:**
- The altcoins made a lot in 2021-23, the altcoin years.
- Since 2024 they add trades but no profit: the profit factor falls and the drops get deeper.
- 2025-26 alone shows the same: BTC + ETH PF 1.72, with all six coins PF 1.10.

**Learning from the altcoins but trading only BTC and ETH** also made it worse:

| Learns from | 2024-26 PF | 2021-26 PF |
|---|---|---|
| BTC, ETH | 1.77 | 1.73 |
| + AVAX | 1.67 | 1.65 |
| + AVAX, DOGE | 1.58 | 1.61 |
| + all six | 1.40 | 1.49 |

So the bot stays on BTC and ETH. Commands: `node research/walkforward.js COINS=BTC,ETH,AVAX MAX_OPEN=3 [TRADE=BTC,ETH]`.

## 6. The ATLAS page's own score: no help (2026-11-03)

`src/atlasPage.js` is the ATLAS page's `analyse()`, copied verbatim. On 4H candles with price and volume only, it
gives the page's score at every setup's entry; funding, OI, order book and tape have no history.
`node research/atlas_score.js` tests it walk-forward: same setups, exits and costs, 1% risk, BTC + ETH, max 2 open.

| Variant | 2021-26 PF | 2021-23 PF | 2024-26 PF | 2021-26 $2,000 → |
|---|---|---|---|---|
| **Learner (live)** | **1.73** | 1.65 | **1.77** | **$9,766** |
| Learner + ATLAS score as an extra input | 1.73 | 1.64 | 1.77 | $9,676 |
| Learner, only when ATLAS agrees (≥ 0) | 1.70 | 1.68 | 1.71 | $9,579 |
| Learner, only when ATLAS ≥ +25 our way | 1.63 | 1.67 | 1.59 | $8,380 |
| No learner: setups when ATLAS ≥ +25 | 1.40 | 1.60 | 1.29 | $6,531 |
| No learner, no filter | 1.45 | 1.61 | 1.36 | $7,497 |

**Result:**
- The learner already sees the ATLAS indicators one by one, so their sum adds nothing.
- Using the score as a gate throws away good trades.
- In place of the learner it is worse than no filter at all.

The dashboard shows the page's live 4H score for information only.

## Honest limits

- **Winners and losers:** about 70% of trades lose, and the winners pay for them. Runs of 8-10 losses happen.
- **Drawdown:** at 2% risk the worst drop was 37%, which is $2,000 → ~$1,260 at some point. 1% halves that.
- **Choices made on the same data:** the feature choice, setups and memory length were picked on this data. Expect a profit factor nearer 1.3 than 1.5 going forward.
- **What the test skips:** fills at the 4H close (live: within 45 min, at the OKX price), and no funding.
- **Demo account:** OKX demo prices sometimes spike; the stops trigger on the index price for that reason.
