# BTC backtest 2021-01-01 → 2026-10-01

Generated 2026-10-01 23:07 UTC by `node scripts/backtest.js` — the live signal code (`src/signal.js`) replayed on OKX BTC-USDT-SWAP 1H candles.

- **trades … in mkt**: the whole period, compounding from 2000 USDT with the variant's % risk; *in mkt* = share of the time a position is open.
- **year columns**: net USDT for that calendar year alone, fresh 2000 USDT each year and a fixed $ risk (the variant's % of 2000), so years compare fairly.
- **<2024 / 2024+**: same fixed $ risk, net USDT and profit factor before and from 2024. The settings were picked on the years before 2024 only (`RESEARCH.md`, `DONCHIAN.md`), so 2024+ is the out-of-sample check.

Costs: Bybit taker fee 0.055% per side; funding approximated at 0.01% per 8h of position value (longs pay, shorts receive); no slippage unless a variant adds it. Stop checked on 1H candles, a gap through it fills at the open.

```
variant                                                        trades win%   ret% maxDD%    PF in mkt |   2021   2022   2023   2024   2025   2026 |  <2024   PF  2024+   PF
A  live: ATLAS flip ±10 within 2 candles (8h), 200-MA band ±10%, long+short, graded score    369   32    668   28.8  1.45    61% |    693    308   2383   1005    -82    854 |   3385 2.03   1778 1.45
   same with the classic score (live until 2026-10-01)            570   28    530   31.4  1.32    72% |    838    318   2399    378      6    942 |   3492 1.82   1347 1.26
   ±25 within 4 candles (16h), band ±10%                          180   37    157   27.9  1.50    34% |    538   -276   1052    -59    582    608 |   1313 1.69   1172 1.60
   ±25 within 4 candles (16h), classic score (live before ±10)    368   32    692   24.8  1.47    62% |    829     65   2723    693     34    953 |   3554 2.18   1706 1.41
   ±15 within 2 candles (8h)                                      232   38    273   22.2  1.55    42% |    587    144    807    670   -152   1191 |   1538 1.74   1709 1.65
   ±10 within 4 candles (16h)                                     509   31    476   35.3  1.31    74% |    552    234   2252   1140   -297    733 |   3038 1.71   1603 1.32
-- ATLAS flip variants --
no extreme entry (flip only)                                      367   32    662   30.8  1.46    60% |    693    308   2383   1005    -99    854 |   3385 2.03   1761 1.45
extreme entry at ±75                                              403   32    545   27.1  1.38    65% |    716    141   2202    957     59    765 |   3059 1.82   1780 1.40
no trend band                                                     444   31    430   32.7  1.33    71% |    593     99   1921   1208   -180    779 |   2613 1.60   1807 1.41
no trend band, window 3 candles (12h) — the previous live setting    546   31    360   34.7  1.26    81% |    660    -30   1863   1349   -386    723 |   2493 1.49   1686 1.33
trend band ±5%                                                    259   36    651   24.1  1.67    45% |    695    207   2335    760   -109   1128 |   3238 2.47   1779 1.61
trend band ±15%                                                   412   30    425   31.9  1.34    65% |    422    222   1979   1205   -225    782 |   2623 1.65   1762 1.41
window 2 candles (8h)                                             369   32    668   28.8  1.45    61% |    693    308   2383   1005    -82    854 |   3385 2.03   1778 1.45
window 3 candles (12h)                                            458   31    611   32.4  1.36    70% |    705    297   2366   1133   -232    774 |   3369 1.89   1675 1.36
window 5 candles (20h)                                            532   30    474   38.4  1.32    76% |    411    154   2415   1107   -409    926 |   2980 1.66   1666 1.32
window 6 candles (24h)                                            552   30    400   39.8  1.29    77% |    370    -96   2447   1186   -505    926 |   2721 1.56   1657 1.31
score ±20                                                         132   41    148   25.8  1.59    26% |    572    109    809    -88    388    377 |   1490 2.20    678 1.47
score ±30                                                          49   49     86   14.0  2.34    11% |    -46    115   1049    -13    155    219 |   1118 3.31    361 2.02
score ±35                                                          33   45     68   13.2  2.58     7% |     -9     88    904    -13    132    165 |    982 3.85    284 2.13
long-only                                                         182   30    312   28.1  1.64    30% |    325    -99   2444    749   -167    368 |   2670 2.42   1036 1.54
-- costs --
+ 0.05% slippage per side                                         369   31    476   32.0  1.37    61% |    649    245   2238    921   -230    760 |   3132 1.91   1450 1.35
no funding (fees only)                                            369   32    683   28.4  1.45    61% |    693    309   2447   1016    -74    844 |   3449 2.05   1786 1.45
-- stops --
initial stop 1.5 ATR                                              376   30   1053   36.8  1.41    57% |    965    448   2856   1402   -264   1174 |   4591 2.15   2492 1.50
initial stop 2.5 ATR                                              367   34    543   19.9  1.57    63% |    522    282   1787    913    215    742 |   2591 1.93   1870 1.60
trail 2.5 ATR                                                     376   33    463   25.7  1.44    53% |    632    368   1742    533    -81   1060 |   2743 1.88   1513 1.39
trail 4 ATR                                                       366   31    590   32.5  1.39    68% |   1082     33   2103   1353   -267    734 |   3217 1.93   1820 1.44
-- risk per trade --
risk 1%                                                           369   32    213   15.6  1.56    61% |    347    154   1192    503    -41    427 |   1692 2.03    889 1.45
risk 1.5%                                                         369   32    403   22.5  1.50    61% |    520    231   1787    754    -61    641 |   2539 2.03   1334 1.45
risk 3%                                                           369   32    969   39.6  1.31    61% |   1040    469   3058   1508   -350   1057 |   5077 2.03   2667 1.45
risk 5%                                                           368   32   1481   51.7  1.19    61% |   1733    772   3841   2383   -557   1094 |   8313 2.02   4240 1.43
risk 10% (position still capped at 2x balance)                    366   32   2664   55.5  1.15    60% |   3543   1465   4047   2999   -838    608 |  15551 1.99   3897 1.22
risk 10%, position cap 5x balance                                 330   33   9609   80.5  1.11    55% |   3676   1713   8891   4919   -826   2538 |  17133 2.06   8783 1.44
risk 10%, cap 5x, no daily loss limit                             369   32   2170   81.4  1.06    61% |   3466   1542   8891   4813  -1348   3474 |  16923 2.03   8677 1.44
risk 5%, cap 5x                                                   366   32   4265   57.1  1.26    60% |   1733    771   5853   2513   -598   2136 |   8462 2.03   4445 1.45
-- breakout strategy (earlier live setups) --
breakout 15, long+short (until the flip)                          424   34    374   32.2  1.35    76% |   -110    120   2113   1472     16    731 |   2033 1.41   2207 1.51
breakout 20, long-only (first setup)                              179   36    324   26.0  1.70    35% |    267   -386   2511    941   -105    447 |   2392 2.22   1282 1.70
breakout 15, 2H signals                                           859   30     25   42.9  1.02    72% |   -213   -163   1269    897   -508    602 |    684 1.07   1166 1.12
breakout 15, 1H signals                                          1771   29    -88   91.8  0.90    75% |     -7  -1106    133   -691  -1229    -14 |  -1453 0.91  -1664 0.86
buy & hold 2000 USDT, 1x                                                                              |   1197  -1284   3113   2425   -128    -66
```

## Live variant in detail

- 369 trades, 32% winners; average win $362, average loss $-117 (compounding, so later trades are bigger)
- 68 months with a closed trade, 26 of them losing; longest losing streak 13 trades
- worst drop from a peak 28.8%

| Exit | Trades | Net $ |
|---|---:|---:|
| exit signal | 128 | -5955 |
| trailing stop | 152 | 33841 |
| stop | 89 | -14534 |

Most trades lose a little (false breakouts); a few long trends pay for them. Expect long flat or losing stretches.
