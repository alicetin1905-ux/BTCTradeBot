# BTC backtest 2021-01-01 → 2026-10-01

Generated 2026-10-01 18:43 UTC by `node scripts/backtest.js` — the live signal code (`src/signal.js`) replayed on OKX BTC-USDT-SWAP 1H candles.

- **trades … in mkt**: the whole period, compounding from 2000 USDT with the variant's % risk; *in mkt* = share of the time a position is open.
- **year columns**: net USDT for that calendar year alone, fresh 2000 USDT each year and a fixed $ risk (the variant's % of 2000), so years compare fairly.
- **<2024 / 2024+**: same fixed $ risk, net USDT and profit factor before and from 2024. The settings were picked on the years before 2024 only (`RESEARCH.md`, `DONCHIAN.md`), so 2024+ is the out-of-sample check.

Costs: Bybit taker fee 0.055% per side; funding approximated at 0.01% per 8h of position value (longs pay, shorts receive); no slippage unless a variant adds it. Stop checked on 1H candles, a gap through it fills at the open.

```
variant                                                        trades win%   ret% maxDD%    PF in mkt |   2021   2022   2023   2024   2025   2026 |  <2024   PF  2024+   PF
A  live: ATLAS flip ±25 within 4 candles (16h), 200-MA band ±10%, long+short    342   32    834   24.6  1.56    59% |    848    128   2731    735     30   1083 |   3706 2.33   1874 1.49
-- ATLAS flip variants --
no trend band                                                     416   30    459   27.7  1.39    69% |    603   -182   2280    862    -77   1040 |   2702 1.67   1851 1.43
no trend band, window 3 candles (12h) — the previous live setting    347   31    581   24.9  1.47    60% |    727    101   2222    896    -48   1023 |   3050 1.93   1870 1.49
trend band ±5%                                                    244   34    547   26.2  1.65    43% |    470    166   2567    426    -37   1121 |   3203 2.59   1536 1.52
trend band ±15%                                                   385   30    564   27.2  1.46    64% |    574    -50   2362   1001    -77   1052 |   2885 1.79   2003 1.49
window 2 candles (8h)                                             197   32    128   36.3  1.38    34% |    595    352     50    324   -637   1358 |    996 1.60   1045 1.41
window 3 candles (12h)                                            286   32    832   23.8  1.61    51% |    895    212   2613    722     43   1066 |   3720 2.55   1830 1.53
window 5 candles (20h)                                            389   32    710   27.2  1.47    64% |    715    278   2595    732   -215   1174 |   3588 2.12   1718 1.41
window 6 candles (24h)                                            421   33    712   28.4  1.45    68% |    681    264   2637    788   -241   1167 |   3582 2.06   1741 1.39
score ±20                                                         452   32    572   35.5  1.35    68% |    871     62   2501    999   -562   1074 |   3433 1.94   1538 1.32
score ±30                                                         245   34    293   28.4  1.44    44% |    756   -184   1540    561    260    518 |   2112 2.08   1365 1.44
score ±35                                                         204   34    198   27.7  1.40    37% |    729   -115   1067    585    141    433 |   1681 2.00   1185 1.43
long-only                                                         171   30    387   26.3  1.77    30% |    355   -290   2715    756    -26    517 |   2780 2.72   1296 1.67
-- costs --
+ 0.05% slippage per side                                         342   31    621   26.6  1.46    59% |    810     71   2607    647   -101    995 |   3488 2.19   1569 1.39
no funding (fees only)                                            342   32    856   24.7  1.56    59% |    850    122   2797    750     42   1075 |   3768 2.36   1895 1.49
-- stops --
initial stop 1.5 ATR                                              347   30   1161   30.7  1.46    55% |   1180    211   3151    982   -107   1460 |   4960 2.46   2376 1.48
initial stop 2.5 ATR                                              338   34    540   21.4  1.59    60% |    657    128   2105    708      6    837 |   2890 2.23   1572 1.51
trail 2.5 ATR                                                     345   34    620   22.6  1.57    51% |    803    165   2034    435    -29   1302 |   3002 2.18   1734 1.47
trail 4 ATR                                                       335   31   1008   26.3  1.51    68% |   1306    249   2460   1127    -52    935 |   4014 2.35   2037 1.51
-- risk per trade --
risk 1%                                                           342   32    246   13.2  1.67    59% |    424     64   1365    367     15    541 |   1853 2.33    937 1.49
risk 1.5%                                                         342   32    483   19.1  1.61    59% |    636     96   2048    551     23    812 |   2780 2.33   1406 1.49
risk 3%                                                           342   32   1296   34.4  1.41    59% |   1271    184   3442   1102      8   1500 |   5559 2.33   2811 1.49
-- breakout strategy (earlier live setups) --
breakout 15, long+short (until the flip)                          424   34    374   32.2  1.35    76% |   -110    120   2113   1472     16    731 |   2033 1.41   2207 1.51
breakout 20, long-only (first setup)                              179   36    324   26.0  1.70    35% |    267   -386   2511    941   -105    447 |   2392 2.22   1282 1.70
breakout 15, 2H signals                                           859   30     25   42.9  1.02    72% |   -213   -163   1269    897   -508    602 |    684 1.07   1166 1.12
breakout 15, 1H signals                                          1771   29    -88   91.8  0.90    75% |     -7  -1106    133   -691  -1229    -14 |  -1453 0.91  -1664 0.86
buy & hold 2000 USDT, 1x                                                                              |   1197  -1284   3113   2425   -128    -62
```

## Live variant in detail

- 342 trades, 32% winners; average win $419, average loss $-129 (compounding, so later trades are bigger)
- 67 months with a closed trade, 27 of them losing; longest losing streak 10 trades
- worst drop from a peak 24.6%

| Exit | Trades | Net $ |
|---|---:|---:|
| exit signal | 105 | -7523 |
| trailing stop | 165 | 37257 |
| stop | 72 | -13033 |

Most trades lose a little (false breakouts); a few long trends pay for them. Expect long flat or losing stretches.
