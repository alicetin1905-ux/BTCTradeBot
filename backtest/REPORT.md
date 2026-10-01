# BTC backtest 2021-01-01 → 2026-09-30

Generated 2026-10-01 00:54 UTC by `node scripts/backtest.js` — the live signal code (`src/signal.js`) replayed on OKX BTC-USDT-SWAP 1H candles.

- **trades … in mkt**: the whole period, compounding from 2000 USDT with the variant's % risk; *in mkt* = share of the time a position is open.
- **year columns**: net USDT for that calendar year alone, fresh 2000 USDT each year and a fixed $ risk (the variant's % of 2000), so years compare fairly.
- **<2024 / 2024+**: same fixed $ risk, net USDT and profit factor before and from 2024. The settings were picked on the years before 2024 only (`RESEARCH.md`, `DONCHIAN.md`), so 2024+ is the out-of-sample check.

Costs: Bybit taker fee 0.055% per side; funding approximated at 0.01% per 8h of position value (longs pay, shorts receive); no slippage unless a variant adds it. Stop checked on 1H candles, a gap through it fills at the open.

```
variant                                                        trades win%   ret% maxDD%    PF in mkt |   2021   2022   2023   2024   2025   2026 |  <2024   PF  2024+   PF
A  live: long+short, 15/15, stop 2 ATR, trail 3 ATR, 2% risk      424   34    374   32.2  1.35    76% |   -110    120   2113   1472     16    731 |   2033 1.41   2207 1.51
-- direction / channel --
previous: long-only, 20/20                                        179   36    324   26.0  1.70    35% |    267   -386   2511    941   -105    447 |   2392 2.22   1282 1.70
long-only, 15/15                                                  215   35    356   30.9  1.60    39% |     97   -385   2486   1369   -160    489 |   2170 1.88   1755 1.76
long + short, 20/20                                               354   34    287   27.5  1.36    65% |   -241     42   2192   1106    -34    626 |   1955 1.47   1706 1.48
-- costs --
+ 0.05% slippage per side                                         424   33    250   36.4  1.27    76% |   -177     27   1992   1377   -142    610 |   1753 1.34   1873 1.42
no funding (fees only)                                            424   33    390   31.8  1.36    76% |   -104    108   2176   1498     28    738 |   2094 1.42   2247 1.52
-- breakout channel --
channel 10                                                        555   33     89   43.3  1.10    84% |     84   -255   1654    823   -425    518 |   1376 1.23    943 1.16
channel 20                                                        354   34    287   27.5  1.36    65% |   -241     42   2192   1106    -34    626 |   1955 1.47   1706 1.48
channel 30                                                        284   32    199   27.9  1.33    51% |   -239     52   2141    786   -265    514 |   1925 1.61   1051 1.32
exit channel 10                                                   446   35    290   31.7  1.29    70% |     33     94   1862   1287    -84    683 |   1892 1.39   1859 1.42
exit channel 20                                                   405   35    309   34.0  1.32    75% |   -133     72   2185   1319   -165    655 |   2035 1.42   1798 1.45
-- timeframe --
2H signals                                                        858   30     28   42.9  1.03    72% |   -213   -163   1269    897   -508    644 |    684 1.07   1208 1.13
1H signals                                                       1771   29    -88   91.8  0.90    75% |     -7  -1106    133   -691  -1229    -12 |  -1453 0.91  -1663 0.86
-- stops --
initial stop 1.5 ATR                                              455   30    427   41.3  1.25    69% |    -77    292   2704   1598   -237    563 |   2866 1.49   2425 1.41
initial stop 2.5 ATR                                              407   36    285   29.1  1.36    79% |   -123    172   1673   1365     -2    468 |   1650 1.41   1805 1.53
trail 2.5 ATR                                                     457   36    229   30.6  1.27    67% |   -224    344   1321   1138    -55    678 |   1442 1.30   1762 1.40
trail 4 ATR                                                       394   32    313   36.8  1.31    83% |      8    234   2026   1247   -109    611 |   2178 1.44   1791 1.41
-- risk per trade --
risk 1%                                                           424   34    147   17.4  1.41    76% |    -55     60   1057    736     18    366 |   1016 1.41   1103 1.51
risk 1.5%                                                         424   34    252   25.1  1.38    76% |    -83     90   1585   1104     27    548 |   1525 1.41   1655 1.51
risk 3%                                                           424   34    419   44.5  1.23    76% |   -165    181   2728   2208   -200    666 |   2539 1.34   3310 1.51
buy & hold 2000 USDT, 1x                                                                              |   1197  -1284   3113   2425   -128    -92
```

## Live variant in detail

- 424 trades, 34% winners; average win $197, average loss $-77 (compounding, so later trades are bigger)
- 69 months with a closed trade, 33 of them losing; longest losing streak 12 trades
- worst drop from a peak 32.2%

| Exit | Trades | Net $ |
|---|---:|---:|
| trailing stop | 237 | 15474 |
| stop | 142 | -13548 |
| exit signal | 45 | 5556 |

Most trades lose a little (false breakouts); a few long trends pay for them. Expect long flat or losing stretches.
