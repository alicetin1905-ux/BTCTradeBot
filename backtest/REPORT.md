# BTC backtest 2021-01-01 → 2026-10-01

Generated 2026-10-01 19:04 UTC by `node scripts/backtest.js` — the live signal code (`src/signal.js`) replayed on OKX BTC-USDT-SWAP 1H candles.

- **trades … in mkt**: the whole period, compounding from 2000 USDT with the variant's % risk; *in mkt* = share of the time a position is open.
- **year columns**: net USDT for that calendar year alone, fresh 2000 USDT each year and a fixed $ risk (the variant's % of 2000), so years compare fairly.
- **<2024 / 2024+**: same fixed $ risk, net USDT and profit factor before and from 2024. The settings were picked on the years before 2024 only (`RESEARCH.md`, `DONCHIAN.md`), so 2024+ is the out-of-sample check.

Costs: Bybit taker fee 0.055% per side; funding approximated at 0.01% per 8h of position value (longs pay, shorts receive); no slippage unless a variant adds it. Stop checked on 1H candles, a gap through it fills at the open.

```
variant                                                        trades win%   ret% maxDD%    PF in mkt |   2021   2022   2023   2024   2025   2026 |  <2024   PF  2024+   PF
A  live: ATLAS flip ±10 within 2 candles (8h), 200-MA band ±10%, long+short    555   29    644   29.0  1.37    71% |    820    339   2457    399     79   1058 |   3616 1.88   1551 1.31
   previous live: ±25 within 4 candles (16h), band ±10%           342   32    834   24.6  1.56    59% |    848    128   2731    735     30   1083 |   3706 2.33   1874 1.49
   ±15 within 2 candles (8h)                                      413   31    432   32.7  1.40    62% |    741    283   1793    255     85   1187 |   2818 1.81   1527 1.38
   ±10 within 4 candles (16h)                                     667   28    612   36.1  1.33    78% |    831    268   2194    910   -380   1209 |   3293 1.67   1822 1.32
-- ATLAS flip variants --
no trend band                                                     663   29    458   30.8  1.29    83% |    919    116   1820    605     92    980 |   2855 1.53   1694 1.31
no trend band, window 3 candles (12h) — the previous live setting    764   28    324   33.6  1.23    89% |    844    -83   1718    591   -202   1121 |   2478 1.41   1549 1.26
trend band ±5%                                                    380   30    567   26.5  1.57    51% |    488    237   2511      3    218   1364 |   3236 2.17   1584 1.45
trend band ±15%                                                   616   28    494   30.8  1.31    77% |    735    295   1945    601     54   1044 |   2975 1.60   1716 1.33
window 2 candles (8h)                                             555   29    644   29.0  1.37    71% |    820    339   2457    399     79   1058 |   3616 1.88   1551 1.31
window 3 candles (12h)                                            631   28    744   30.2  1.38    76% |    846    334   2345    913   -156   1172 |   3525 1.77   1965 1.36
window 5 candles (20h)                                            687   28    616   36.6  1.33    80% |    757    234   2168   1097   -400   1192 |   3159 1.62   1977 1.34
window 6 candles (24h)                                            703   28    612   36.4  1.33    81% |    735     88   2187   1234   -395   1195 |   3010 1.57   2120 1.37
score ±20                                                         300   32    245   31.8  1.40    49% |    763    159    906    441   -371   1246 |   1827 1.74   1316 1.39
score ±30                                                         125   34      2   30.3  1.01    23% |    483    -64    -88    107   -374    109 |    331 1.37   -158 0.92
score ±35                                                          92   34     -1   34.3  0.99    17% |    490     12     59    116   -312   -280 |    561 1.94   -476 0.68
long-only                                                         279   27    318   27.0  1.51    36% |    495    -97   2389    276     98    601 |   2787 2.24    986 1.39
-- costs --
+ 0.05% slippage per side                                         555   28    382   32.3  1.27    71% |    758    215   2247    274   -167    932 |   3221 1.73   1062 1.20
no funding (fees only)                                            555   29    668   28.9  1.38    71% |    825    337   2524    406     98   1060 |   3687 1.89   1577 1.32
-- stops --
initial stop 1.5 ATR                                              561   28    988   33.7  1.33    68% |   1193    380   2865    659    203   1417 |   4750 1.91   2377 1.38
initial stop 2.5 ATR                                              549   29    428   25.0  1.40    72% |    635    267   1931    379     64    832 |   2834 1.84   1276 1.32
trail 2.5 ATR                                                     561   31    590   27.8  1.41    63% |    667    494   1795    363    227   1221 |   2956 1.75   1816 1.37
trail 4 ATR                                                       552   28    658   35.0  1.33    79% |    953    614   2165    756   -220    984 |   3733 1.88   1551 1.30
-- risk per trade --
risk 1%                                                           555   29    209   15.8  1.45    71% |    410    169   1229    199     47    529 |   1808 1.88    776 1.31
risk 1.5%                                                         555   29    392   22.7  1.41    71% |    615    254   1843    299     71    794 |   2712 1.88   1163 1.31
risk 3%                                                           555   29    851   39.9  1.25    71% |   1230    506   3182    598   -144   1485 |   5424 1.88   2270 1.31
-- breakout strategy (earlier live setups) --
breakout 15, long+short (until the flip)                          424   34    374   32.2  1.35    76% |   -110    120   2113   1472     16    731 |   2033 1.41   2207 1.51
breakout 20, long-only (first setup)                              179   36    324   26.0  1.70    35% |    267   -386   2511    941   -105    447 |   2392 2.22   1282 1.70
breakout 15, 2H signals                                           859   30     25   42.9  1.02    72% |   -213   -163   1269    897   -508    602 |    684 1.07   1166 1.12
breakout 15, 1H signals                                          1771   29    -88   91.8  0.90    75% |     -7  -1106    133   -691  -1229    -14 |  -1453 0.91  -1664 0.86
buy & hold 2000 USDT, 1x                                                                              |   1197  -1284   3113   2425   -128    -65
```

## Live variant in detail

- 555 trades, 29% winners; average win $299, average loss $-87 (compounding, so later trades are bigger)
- 69 months with a closed trade, 30 of them losing; longest losing streak 15 trades
- worst drop from a peak 29.0%

| Exit | Trades | Net $ |
|---|---:|---:|
| exit signal | 298 | -7008 |
| trailing stop | 170 | 33752 |
| stop | 87 | -13846 |

Most trades lose a little (false breakouts); a few long trends pay for them. Expect long flat or losing stretches.
