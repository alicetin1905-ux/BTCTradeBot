# ATLAS score fast flip on BTC (research — not traded)

Idea: go long when the ATLAS score is +X or more and was −X or less within the last K signal candles (a fast swing from bearish to bullish); short = mirror. Scores from TradeBot's own ATLAS scorer (classic mode, daily pivot as live) on every closed BTC 1H and 4H candle since 2021. Same costs and conventions as `backtest/REPORT.md`: taker 0.055%, funding 0.01%/8h, 2% risk at the initial 2×ATR stop, position ≤ 2× balance, stop checked on 1H candles; before / from 2024 at fixed $40 risk.

Exits: **trail** = 2 ATR stop trailing 3 ATR (the live bot's) + reverse on an opposite flip; **score** = 2 ATR stop, out when the score turns back through 0; **trail+flip** = trail, also out when the score reaches −25 against; **target** = 2 ATR stop, take profit at 2R.

**Result:** on 4H with the trailing exit it works: X = ±25 within 3 candles (12 hours) trades ~60×/year, +581% 2021–26, worst drop 25%, profit factor 1.47 (1.93 before 2024, 1.49 from 2024). Chosen on 2021–2023 alone, the same setting is picked. 27 of 35 neighbouring settings are profitable in both halves. 1H fails (fees). Fixed 2R targets fail.

**Caveat:** the backtest score uses price and volume only. The live ATLAS score also weighs funding, open interest, long/short ratio, order book and taker flow (~20% of its weight), none of which has history. A threshold rule like this is sensitive to that difference — a live version should compute the score the same way as the backtest (price/volume only).

## All variants

```
setting                           trades  win    ret    DD        PF | <2024 2024+ | 2021  2022  2023  2024  2025  2026

Best 15 by the WORSE of the two halves (robustness first):
4H X±50 within 3 target               7/yr  51%     48%  10%DD  PF 1.93 |  2.10  2.06 |    315   148   -90   178   230    41
4H X±50 within 3 trail                7/yr  55%     44%  14%DD  PF 2.00 |  2.03  2.32 |    358    88  -123   231   225    -4
4H X±50 within 2 target               4/yr  48%     21%  10%DD  PF 1.72 |  1.88  1.82 |     82   232  -127   183   153  -122
4H X±50 within 3 score                7/yr  51%     34%  14%DD  PF 1.84 |  2.54  1.55 |    407   162  -120     5   162    14
4H X±25 within 3 trail               60/yr  31%    581%  25%DD  PF 1.47 |  1.93  1.49 |    727   101  2222   896   -48  1023
4H X±25 within 3 trail+flip          63/yr  29%    445%  23%DD  PF 1.44 |  1.86  1.41 |    642    31  2278   509   -38  1014
4H X±25 within 6 trail+flip          88/yr  30%    388%  32%DD  PF 1.33 |  1.52  1.38 |    407  -173  2208  1044  -309  1120
4H X±25 within 6 trail               87/yr  31%    389%  32%DD  PF 1.33 |  1.52  1.38 |    407  -143  2203  1020  -348  1161
4H X±50 within 2 score                4/yr  48%      7%  11%DD  PF 1.33 |  1.47  1.32 |     10   204  -127   -14   113   -42
4H X±25 within 3 score               63/yr  28%    189%  26%DD  PF 1.32 |  1.58  1.31 |    605   133   983   435  -334   924
4H X±35 within 6 trail               56/yr  33%    169%  28%DD  PF 1.27 |  1.52  1.30 |    512  -228  1425   392   119   542
4H X±35 within 6 trail+flip          57/yr  32%    158%  35%DD  PF 1.27 |  1.51  1.29 |    460  -240  1467   196   161   616
4H X±25 within 6 score               89/yr  28%    136%  36%DD  PF 1.20 |  1.28  1.27 |    576  -181   831   831  -666  1009
4H X±25 within 2 trail               42/yr  31%     69%  43%DD  PF 1.20 |  1.33  1.24 |    475   261     9   141  -734  1314
4H X±50 within 3 trail+flip           7/yr  46%     21%  18%DD  PF 1.49 |  2.08  1.22 |    366    88  -123   -40   149   -21

How many of each group made money in both halves:
  1H trail       1/12 · median PF 1.03 · median 81 trades/yr
  1H score       0/12 · median PF 1.03 · median 82 trades/yr
  1H trail+flip  1/12 · median PF 1.05 · median 82 trades/yr
  1H target      2/12 · median PF 0.95 · median 81 trades/yr
  4H trail       7/12 · median PF 1.33 · median 19 trades/yr
  4H score       7/12 · median PF 1.20 · median 19 trades/yr
  4H trail+flip  7/12 · median PF 1.27 · median 19 trades/yr
  4H target      3/12 · median PF 0.98 · median 18 trades/yr

Your exact idea (−25 → +25 within a short period), 1H and 4H:
1H X±25 within 1 trail               60/yr  34%    283%  39%DD  PF 1.24 |  1.99  0.98 |    297  1796  1210   333   -67  -350
1H X±25 within 1 score               61/yr  32%    105%  46%DD  PF 1.15 |  1.96  0.74 |    112  1722   825  -145  -326  -338
1H X±25 within 1 trail+flip          61/yr  32%    255%  42%DD  PF 1.24 |  2.05  0.96 |    292  1768  1100   408  -237  -305
1H X±25 within 1 target              58/yr  38%     28%  38%DD  PF 1.06 |  1.15  1.03 |   -214   732   109    30  -178   263
1H X±25 within 2 trail              151/yr  30%    182%  66%DD  PF 1.05 |  1.44  0.93 |   1406  1793   546   778  -701  -643
1H X±25 within 2 score              156/yr  28%     -1%  75%DD  PF 1.00 |  1.44  0.76 |    290  1861   850  -278  -757  -942
1H X±25 within 2 trail+flip         156/yr  29%    152%  68%DD  PF 1.05 |  1.45  0.91 |   1363  1726   460   726  -763  -627
1H X±25 within 2 target             145/yr  34%    -27%  70%DD  PF 0.98 |  1.11  0.87 |    353   672    44    75 -1022   108
1H X±25 within 3 trail              217/yr  30%     -1%  74%DD  PF 1.00 |  1.15  0.96 |   1284   891  -613   762  -644  -686
1H X±25 within 3 score              223/yr  28%    -63%  85%DD  PF 0.95 |  1.16  0.78 |    366   995    -2  -731  -691  -967
1H X±25 within 3 trail+flip         223/yr  29%     -2%  72%DD  PF 1.00 |  1.14  0.97 |   1152  1047  -713   736  -585  -663
1H X±25 within 3 target             210/yr  33%    -79%  92%DD  PF 0.93 |  0.96  0.82 |    624   -82  -919  -686 -1181   188
4H X±25 within 1 trail               15/yr  36%     34%  20%DD  PF 1.29 |  1.56  1.22 |    130   164   176   284   -93    27
4H X±25 within 1 score               15/yr  30%     -3%  22%DD  PF 0.96 |  1.05  0.95 |   -101    17   123   174  -283    71
4H X±25 within 1 trail+flip          15/yr  28%      3%  25%DD  PF 1.03 |  1.15  1.02 |   -120   194    57   148  -193    62
4H X±25 within 1 target              14/yr  35%     -1%  20%DD  PF 0.99 |  0.85  1.20 |    211  -213  -158   229   -52    32
4H X±25 within 2 trail               42/yr  31%     69%  43%DD  PF 1.20 |  1.33  1.24 |    475   261     9   141  -734  1314
4H X±25 within 2 score               43/yr  29%     25%  43%DD  PF 1.10 |  1.22  1.10 |    350   -39   121   186  -943  1107
4H X±25 within 2 trail+flip          43/yr  30%     61%  45%DD  PF 1.19 |  1.32  1.22 |    490   251    -6    80  -771  1310
4H X±25 within 2 target              40/yr  32%    -27%  44%DD  PF 0.89 |  0.90  0.93 |    116  -188  -181   -67  -523   378
4H X±25 within 3 trail               60/yr  31%    581%  25%DD  PF 1.47 |  1.93  1.49 |    727   101  2222   896   -48  1023
4H X±25 within 3 score               63/yr  28%    189%  26%DD  PF 1.32 |  1.58  1.31 |    605   133   983   435  -334   924
4H X±25 within 3 trail+flip          63/yr  29%    445%  23%DD  PF 1.44 |  1.86  1.41 |    642    31  2278   509   -38  1014
4H X±25 within 3 target              59/yr  32%    -10%  29%DD  PF 0.98 |  1.00  1.00 |    487  -426   -59   143  -156    12
```

## Neighbourhood of the pick (4H, trail exit)

```
4H, stop 2 ATR + trail 3 ATR — profit factor (all years) and trades/yr, by threshold X and window K (candles):

                 K=1          K=2          K=3          K=4          K=5          K=6          K=8
X=±20      1.10 (26)    1.28 (63)    1.28 (81)    1.20 (95)   1.21 (100)   1.18 (107)   1.17 (112)
X=±25      1.29 (15)    1.20 (42)    1.47 (60)    1.39 (72)    1.34 (81)    1.33 (87)    1.25 (93)
X=±30       1.07 (8)    0.89 (26)    1.09 (41)    1.21 (52)    1.31 (61)    1.26 (69)    1.21 (77)
X=±35       0.93 (6)    0.87 (19)    1.06 (32)    1.21 (42)    1.34 (49)    1.27 (56)    1.24 (66)
X=±40       0.95 (4)    0.90 (13)    0.97 (22)    1.20 (31)    1.19 (37)    1.24 (46)    1.43 (55)

27/35 cells profit in both halves.
Picked on 2021-2023 only: X=±25 K=3 (PF 1.93 before 2024) → 2024+ PF 1.49
2024+ PF across all cells with >= 30 trades/yr: median 1.34, worst 1.12, best 1.70
```

## Combined with the live breakout (one position at a time)

Same engine as `scripts/backtest.js` (row A reproduces the live backtest exactly). C = enter on whichever signal fires first; an opposite signal from either reverses. D = breakout only when the ATLAS score agrees (±25). E = C without the exit channel — identical, because with equal 15-candle channels an exit-channel close is also an opposite breakout.

```
variant                                       trades/yr win%    ret%  DD%   PF  in mkt | <2024 2024+ | 2021  2022  2023  2024  2025  2026
A  breakout only (live bot)                          74   34     374   32 1.35     76% |  1.41  1.51 |  -110   120  2113  1472    16   731
B  ATLAS flip only                                   60   31     581   25 1.47     60% |  1.93  1.49 |   727   101  2222   896   -48  1023
C  either, first wins (+ exit channel)               92   31     283   36 1.22     87% |  1.42  1.30 |   312    49  1969  1216  -255   692
D  breakout only when ATLAS agrees (>= ±25)          71   35     334   33 1.33     72% |  1.43  1.47 |  -122    78  2187  1356  -165   777
E  either, stop/trail exits only                     92   31     283   36 1.22     87% |  1.42  1.30 |   312    49  1969  1216  -255   692

C — where the trades came from: breakout: 198 trades, +1032 · both: 111 trades, +1597 · flip: 222 trades, +3033
C — longest losing streak: 11
```

**Result:** combining is worse than either signal alone (+283%, worst drop 36%, PF 1.22): the two signals reverse each other's trades, the position is open 87% of the time (more funding) and the longest losing streak grows to 11. Using ATLAS as a filter on the breakout (D) changes little. The ATLAS flip alone (B) stays the strongest.

## Trend band + 16h window (live from 2026-10-01)

Trade-by-trade look at the ±25 / 3-candle flip (360 trades, fixed $40 risk):
trades against the 200-candle 4H average by more than 10% lost (31 trades,
PF 0.11, negative in both halves), trades already over-extended by more than
10% in their direction lost too (PF 0.47), and very volatile entries (ATR > 3%
of price) were weak. Entry-score and swing-depth buckets were not monotonic, so
no strength-based sizing. Stop 2 ATR / trail 3 ATR sits on a flat plateau
(tested 1.5-3 x 2-5), so it stays.

Rule added: ignore a swing when |close / MA200(4H) - 1| > 10%
(`TREND_BAND_PCT`), and widen the window to 4 candles.

| | trades | win% | return | max DD | PF | PF <2024 / 2024+ |
|---|---:|---:|---:|---:|---:|---:|
| previous (no band, 3 candles) | 347 | 31 | +581% | 24.9% | 1.47 | 1.93 / 1.49 |
| live (band ±10%, 4 candles) | 342 | 32 | +834% | 24.6% | 1.56 | 2.33 / 1.49 |

Across X 20-40 x window 2-6 the band lifts the median PF from 1.21 to 1.41 and
the cells profitable in both halves from 19 to 22 of 25. Caveat: the filter was
found on the full period, so part of the gain is in-sample. Faster timeframes
(15m ATLAS flip: PF 0.82-0.96, every setting loses) and support/resistance
fades (30m/1H/4H, fixed +2.5% target) were tested and rejected.

## Live from 2026-10-01 (later): ±10 within 2 candles (8h), band ±10%

Chosen for trade count. With the 200-MA band: 555 trades (~97/yr), +644%, max
drawdown 29%, PF 1.37 (1.88 before 2024 / 1.31 from 2024), +0.05% slippage
per side still +382% (PF 1.27). The stricter ±25 / 4 candles had 342 trades,
+834%, 25% drawdown, PF 1.56 — fewer, better trades; set `FLIP_SCORE` 25 and
`FLIP_WINDOW` 4 (control/settings.json or config.js) to go back.
Lower levels (±10, ±15) with 4-6 candle windows lose in 2025 (-380 to -440 at
$40 risk); the 2-candle window avoids that.
