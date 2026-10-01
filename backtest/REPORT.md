# BTC backtest 2021-01-01 → 2026-10-01

Generated 2026-10-01 19:50 UTC by `node scripts/backtest.js` — the live signal code (`src/signal.js`) replayed on OKX BTC-USDT-SWAP 1H candles.

- **trades … in mkt**: the whole period, compounding from 2000 USDT with the variant's % risk; *in mkt* = share of the time a position is open.
- **year columns**: net USDT for that calendar year alone, fresh 2000 USDT each year and a fixed $ risk (the variant's % of 2000), so years compare fairly.
- **<2024 / 2024+**: same fixed $ risk, net USDT and profit factor before and from 2024. The settings were picked on the years before 2024 only (`RESEARCH.md`, `DONCHIAN.md`), so 2024+ is the out-of-sample check.

Costs: Bybit taker fee 0.055% per side; funding approximated at 0.01% per 8h of position value (longs pay, shorts receive); no slippage unless a variant adds it. Stop checked on 1H candles, a gap through it fills at the open.

```
variant                                                        trades win%   ret% maxDD%    PF in mkt |   2021   2022   2023   2024   2025   2026 |  <2024   PF  2024+   PF
A  live: ATLAS flip ±10 within 2 candles (8h), 200-MA band ±10%, long+short, graded score    367   32    662   30.8  1.46    60% |    693    308   2383   1005    -99    854 |   3385 2.03   1761 1.45
   same with the classic score (live until 2026-10-01)            555   29    644   29.0  1.37    71% |    820    339   2457    399     79   1058 |   3616 1.88   1551 1.31
   ±25 within 4 candles (16h), band ±10%                          176   38    152   30.7  1.50    33% |    538   -276    954    -45    623    608 |   1215 1.65   1227 1.64
   ±25 within 4 candles (16h), classic score (live before ±10)    342   32    834   24.6  1.56    59% |    848    128   2731    735     30   1083 |   3706 2.33   1874 1.49
   ±15 within 2 candles (8h)                                      227   37    129   29.3  1.39    40% |    587    144   -331    670   -183   1191 |    401 1.19   1678 1.65
   ±10 within 4 candles (16h)                                     508   31    489   35.3  1.32    74% |    552    234   2252   1140   -256    733 |   3038 1.71   1644 1.33
-- ATLAS flip variants --
no trend band                                                     439   31    455   34.6  1.35    70% |    593    139   1946   1208   -197    822 |   2678 1.63   1833 1.42
no trend band, window 3 candles (12h) — the previous live setting    542   31    396   34.7  1.28    81% |    660     10   1887   1349   -345    766 |   2557 1.51   1770 1.35
trend band ±5%                                                    259   36    651   24.1  1.67    45% |    695    207   2335    760   -109   1128 |   3238 2.47   1779 1.61
trend band ±15%                                                   408   30    439   33.8  1.36    64% |    422    222   2004   1205   -243    825 |   2648 1.66   1787 1.42
window 2 candles (8h)                                             367   32    662   30.8  1.46    60% |    693    308   2383   1005    -99    854 |   3385 2.03   1761 1.45
window 3 candles (12h)                                            457   31    626   32.4  1.37    70% |    705    297   2366   1133   -191    774 |   3369 1.89   1716 1.37
window 5 candles (20h)                                            531   31    485   38.4  1.32    76% |    411    154   2415   1107   -368    926 |   2980 1.66   1707 1.33
window 6 candles (24h)                                            551   30    411   39.8  1.30    77% |    370    -96   2447   1186   -465    926 |   2721 1.56   1698 1.32
score ±20                                                         126   40     42   30.1  1.25    24% |    572    109   -329    -74    415    159 |    353 1.28    500 1.36
score ±30                                                          42   48      8   15.2  1.21     9% |    -46    115    -63      1    182      1 |      6 1.01    184 1.62
score ±35                                                          25   40     -5   18.8  0.81     5% |     -9     88   -208      1    101    -54 |   -129 0.59     48 1.25
long-only                                                         181   29    301   28.5  1.62    29% |    325    -99   2444    749   -225    368 |   2670 2.42    978 1.51
-- costs --
+ 0.05% slippage per side                                         367   31    472   33.9  1.37    60% |    649    245   2238    921   -244    760 |   3132 1.91   1436 1.35
no funding (fees only)                                            367   32    675   30.6  1.46    60% |    693    309   2447   1016    -97    844 |   3449 2.05   1763 1.45
-- stops --
initial stop 1.5 ATR                                              374   29   1034   39.1  1.41    57% |    965    448   2856   1402   -330   1174 |   4591 2.15   2457 1.49
initial stop 2.5 ATR                                              366   34    528   19.9  1.56    63% |    522    282   1787    913    169    742 |   2591 1.93   1824 1.59
trail 2.5 ATR                                                     374   33    468   26.1  1.44    52% |    632    368   1742    533    -64   1060 |   2743 1.88   1530 1.40
trail 4 ATR                                                       364   31    589   34.0  1.39    68% |   1082     33   2103   1353   -270    734 |   3217 1.93   1817 1.45
-- risk per trade --
risk 1%                                                           367   32    212   16.8  1.57    60% |    347    154   1192    503    -49    427 |   1692 2.03    880 1.45
risk 1.5%                                                         367   32    400   24.1  1.51    60% |    520    231   1787    754    -74    641 |   2539 2.03   1321 1.45
risk 3%                                                           367   32    957   42.2  1.31    60% |   1040    469   3058   1508   -392   1057 |   5077 2.03   2641 1.45
risk 5%                                                           366   32   1459   54.9  1.19    60% |   1733    772   3841   2383   -623   1094 |   8313 2.02   4137 1.42
risk 10% (position still capped at 2x balance)                    364   32   2646   58.4  1.15    60% |   3543   1465   4047   2999   -846    608 |  15551 1.99   3673 1.21
risk 10%, position cap 5x balance                                 328   33   9340   83.0  1.11    55% |   3676   1713   8891   4919   -952   2538 |  17133 2.06   8697 1.45
risk 10%, cap 5x, no daily loss limit                             367   32   2107   83.7  1.06    60% |   3466   1542   8891   4813  -1440   3474 |  16923 2.03   8590 1.44
risk 5%, cap 5x                                                   364   32   4188   60.0  1.27    60% |   1733    771   5853   2513   -745   2136 |   8462 2.03   4402 1.45
-- breakout strategy (earlier live setups) --
breakout 15, long+short (until the flip)                          424   34    374   32.2  1.35    76% |   -110    120   2113   1472     16    731 |   2033 1.41   2207 1.51
breakout 20, long-only (first setup)                              179   36    324   26.0  1.70    35% |    267   -386   2511    941   -105    447 |   2392 2.22   1282 1.70
breakout 15, 2H signals                                           859   30     25   42.9  1.02    72% |   -213   -163   1269    897   -508    602 |    684 1.07   1166 1.12
breakout 15, 1H signals                                          1771   29    -88   91.8  0.90    75% |     -7  -1106    133   -691  -1229    -14 |  -1453 0.91  -1664 0.86
buy & hold 2000 USDT, 1x                                                                              |   1197  -1284   3113   2425   -128    -65
```

## Live variant in detail

- 367 trades, 32% winners; average win $360, average loss $-116 (compounding, so later trades are bigger)
- 68 months with a closed trade, 27 of them losing; longest losing streak 12 trades
- worst drop from a peak 30.8%

| Exit | Trades | Net $ |
|---|---:|---:|
| exit signal | 128 | -5920 |
| trailing stop | 151 | 33300 |
| stop | 88 | -14151 |

Most trades lose a little (false breakouts); a few long trends pay for them. Expect long flat or losing stretches.
