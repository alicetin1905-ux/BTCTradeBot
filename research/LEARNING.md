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

## 7. Can it learn more? Three ideas tested (2026-11-14)

**Question (owner).** Does the bot learn enough from the market, or only from trades? Three ideas to make it learn more, each tested walk-forward with `node research/improve.js` (Binance spot 4H, BTC + ETH, 2021 - Nov 2026, 2.5% risk, at most 2 positions). PF-R is the profit factor in R, which compounding and position size don't distort.

| Idea | Trades | PF-R | $2,000 → | Worst drop |
|---|---|---|---|---|
| **Live settings** (half-life 4 years, fixed 1x size, trail 5) | 356 | **1.86** | **$50,030** | 44% |
| Faster memory: half-life 6 months / 1 year / 2 years | 311 - 350 | 1.56 - 1.69 | $11,096 - $22,167 | 45 - 48% |
| Slower memory: half-life 8 years / equal weight | 368 / 383 | 1.81 / 1.73 | $44,471 / $35,503 | 44% |
| Last 6 / 12 / 24 months count 2-4x more | 332 - 355 | 1.70 - 1.76 | $21,434 - $30,329 | 43 - 47% |
| Size with the expected R: 0.75-1.25x / 0.5-1.5x / 0-2x | 356 | 1.86 | $44,000 / $37,645 / $24,262 | 45 - 49% |
| Learn the exit: a model per trail, pick 5 or 7 ATR | 335 | 1.95 | $59,876 | 43% |
| Control: pick 5 or 7 ATR **at random** (5 seeds) | 314 - 328 | 1.89 - 2.07 | $46,281 - $65,665 | 42 - 45% |
| Half the position trails 5, half trails 7 | 290 | 2.07 | $55,006 | 40% |

- **Memory:** faster adaptation is clearly worse, as in section 3: it chases noise. The 4-year half-life stays.
- **Size:** the model's expected R ranks setups only weakly. Betting more on its favourites adds variance, not profit.
- **Exit:** a mix of 5 and 7 ATR trailing beats 5 alone, but picking at random does as well as the models. So the models don't learn which setup deserves the wider trail; the gain is the mix itself. Fixed trails alone are noisy (5: PF 1.65, 6: 1.41, 7: 1.77, 8: 1.66 in $), so the mix's edge (+10% end balance, worst drop 40% vs 44%) is small against that noise.

**Conclusion.** No change to the live bot. The learner already learns from every setup in the market (6,700+ since 2017, taken or not), and none of the three ideas made the learning itself better. A half-and-half trail (5 + 7 ATR) is the one candidate worth another look; it needs two stops per position on OKX.

## 8. Improve it: more setups, a risk guard, a smarter model (2026-11-14)

The owner asked for all three. Same test as section 7 (`node research/improve.js`, 2021 - Nov 2026, 2.5% risk).
Reference, the live settings: 356 trades, PF-R 1.86, $2,000 → $50,030, worst drop 44%.

**More setups: no.** New setups are added next to pullback and breakout; the learner judges them all.

| Setups | Trades | PF-R | $2,000 → | Worst drop |
|---|---|---|---|---|
| + Supertrend flip | 374 | 1.76 | $37,816 | 47% |
| + EMA20 / EMA50 cross | 364 | 1.87 | $53,591 | 45% |
| + RSI back over 50 in the trend | 415 | 1.73 | $45,252 | 44% |
| + all three | 417 | 1.72 | $43,742 | 44% |

With one position per coin, an extra setup mostly takes the slot a better one would have used. The EMA cross is +7%, which is within the noise of these tests; not worth it.

**Risk guard: yes, but off.** It was live on 2026-11-14 for a few hours; the owner then chose the full 2.5% always (`LEARN.GUARD_MULT` 1). While the self-check (the last 150 finished setups, each judged out-of-sample) says the taken setups did worse than the skipped ones, new trades risk less.

| Guard | $2,000 → | Worst drop | Return / drop |
|---|---|---|---|
| None (live before) | $50,030 | 44% | 7.3 |
| 0.5x risk on 'alert' only | $48,067 | 44% | 7.3 |
| **0.5x risk on 'watch' or 'alert'** (built, off) | **$47,190** | **36%** | **8.7** |
| 0.25x risk on 'watch' or 'alert' | $43,342 | 32% | 9.5 |
| 0.5x risk when 20% below the peak | $18,782 | 33% | 6.8 |
| Control: 0.5x on 25% random trades (5 seeds) | $27,485 - $58,983 | 39 - 42% | 6.3 - 8.7 |

- From 2023: worst drop 43% → 32%. From 2025: 35% → 27%. At 1% risk: 21% → 16%.
- It costs 6% of the end balance and cuts the worst drop by a fifth. Random cuts don't lower the drop as much.
- A drop-from-peak rule cuts too late and keeps risk low through the recovery.

**A smarter model: no.** Ridge (live) against models that see combinations of inputs. All retrain monthly here, to compare at equal cost.

| Model | Trades | PF-R | $2,000 → | Worst drop |
|---|---|---|---|---|
| **Ridge (live)** | 356 | 1.86 | **$50,669** | 44% |
| Ridge + all pairwise products | 361 - 374 | 1.66 - 1.75 | $24,050 - $32,484 | 42 - 44% |
| Boosted trees, depth 2 (src/gbm.js) | 315 | 1.92 | $41,137 | 42% |
| Boosted trees, other sizes (depth 1-3, leaf 60-200) | 315 - 325 | 1.72 - 1.87 | $20,666 - $36,211 | 41 - 46% |

The richer models fit the past better but pick worse going forward: with ~6,700 noisy setups there is not enough signal for combinations.

## 9. 1H candles in the learning? No (2026-11-14)

**Question (owner).** Can the bot learn from 1H candles too? Tested with `node research/hourly.js` (Binance spot 1H since 2017, BTC + ETH, about 27,000 extra setups; 2021 - Nov 2026, 2.5% risk, retrained weekly). Every row runs in the same harness. That harness frees a position's slot at the close of the candle it was stopped in, so its reference differs from section 7. End balances in these tests react strongly to small rule changes; compare rows within one table.

| Variant | Learns from | Trades | PF-R | $2,000 → | Worst drop |
|---|---|---|---|---|---|
| **Live: 4H setups only** | 6,714 | 376 | **1.70** | **$29,610** | 46% |
| + the 4H setups also on 1H candles, as extra examples (weight 0.25 / 0.5 / 1) | 33,760 | 389 - 399 | 1.58 - 1.65 | $18,323 - $24,379 | 47 - 49% |
| + the 1H indicators at the 4H close as extra inputs | 6,714 | 382 | 1.65 | $24,689 | 48% |
| Learn from both and also trade the 1H setups | 33,760 | 970 - 992 | 1.27 - 1.29 | $8,118 - $9,383 | 61 - 63% |
| 1H alone | 27,046 | 1,277 | 1.16 | $1,885 | 85% |

1H setups behave differently: more noise, costs weigh 4x heavier against a stop a quarter as wide, and they win less. As extra examples they teach the 4H model the wrong lessons. As inputs they add no information the 4H indicators don't already carry. Traded, they cost money. The live bot stays on 4H.

## 10. Daily candles? Not in the learning; maybe as a second bot (2026-11-14)

**Question (owner).** And the daily candles? Same harness as section 9 (`node research/hourly.js TF=1d ...`, 2021 - Nov 2026, 2.5% risk).

| Variant | Trades | PF-R | $2,000 → | Worst drop |
|---|---|---|---|---|
| **Live: 4H setups only** | 376 | 1.70 | $29,610 | 46% |
| + the same setups on daily candles as extra examples (weight 0.5 / 1 / 2) | 373 - 380 | 1.61 - 1.65 | $18,943 - $23,099 | 47 - 51% |
| + the daily indicators as extra inputs | 382 | 1.50 | $11,150 | 49% |
| One bot trading 4H and daily setups (one slot per coin) | 256 | 1.69 | $13,302 | 48% |
| Daily setups alone, with the learner | 54 | 2.10 | $3,879 | 17% |
| Daily setups alone, without the learner | 72 | 2.02 | $4,400 | 22% |
| **Two bots side by side**: the live 4H bot + a daily bot (own slot per coin, max 4 positions) | 430 | **1.75** | **$37,358** | 47% |

- Learning from daily candles makes the 4H learner worse, as with 1H.
- Daily setups themselves are good: PF about 2, about 10 trades a year, drop 17-22%. The learner adds nothing there (1,013 examples since 2017 is too few).
- Run next to the 4H bot as a separate stream: +26% end balance, the same worst drop. From 2023: $22,033 vs $16,860. At 1% risk: $10,094 vs $8,274, drop 22% both.
- But: 54 daily trades in six years, and most of the gain is 2024 (+24 R). A small sample.
- Live it needs a second position per coin on the same OKX instrument, and the account nets those together. That is a real change to the order handling, not a setting. Not built.

## 11. 2H, 8H and 12H candles? No (2026-11-14)

Same harness as sections 9 - 10 (`node research/hourly.js TF=2h|8h|12h ...`, 2021 - Nov 2026, 2.5% risk). Reference, the live 4H bot: 376 trades, $2,000 → $29,610, worst drop 46%.

| Variant | 2H | 8H | 12H |
|---|---|---|---|
| Extra examples for the 4H learner (weight 0.5 / 1) | $20,907 / $20,160 | $26,768 / $22,081 | $24,234 / $22,588 |
| Their indicators as extra inputs | $19,458, drop 53% | $11,921, drop 54% | $26,838, drop 45% |
| That timeframe alone, with the learner | $4,764, drop 67% | $5,424, drop 49% | $5,724, drop 35% |
| One bot trading 4H and it (one slot per coin) | $11,825, drop 68% | $17,358, drop 45% | $15,740, drop 43% |
| Two bots side by side (4H + it) | $9,189, drop 85% | $30,294, drop 71% | $42,997, drop 58% |

Everything that changes the learner is worse than the 4H learner alone. Alone, 4H beats every other timeframe by far (1H $1,885, 2H $4,764, 8H $5,424, 12H $5,724, 1D $3,879). Side by side, 12H adds profit but makes the worst drop much deeper (58%). The daily bot (section 10: $37,358 at a 47% drop) remains the only addition that didn't worsen the drop. 4H stays the bot's timeframe.

## Honest limits

- **Winners and losers:** about 70% of trades lose, and the winners pay for them. Runs of 8-10 losses happen.
- **Drawdown:** at 2% risk the worst drop was 37%, which is $2,000 → ~$1,260 at some point. 1% halves that.
- **Choices made on the same data:** the feature choice, setups and memory length were picked on this data. Expect a profit factor nearer 1.3 than 1.5 going forward.
- **What the test skips:** fills at the 4H close (live: within 45 min, at the OKX price), and no funding.
- **Demo account:** OKX demo prices sometimes spike; the stops trigger on the index price for that reason.
