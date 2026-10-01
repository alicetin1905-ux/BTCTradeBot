# BTC backtest 2021-01-01 → 2026-10-01

Generated 2026-10-01 01:22 UTC by `node scripts/backtest.js` — the live signal code (`src/signal.js`) replayed on OKX BTC-USDT-SWAP 1H candles.

- **trades … in mkt**: the whole period, compounding from 2000 USDT with the variant's % risk; *in mkt* = share of the time a position is open.
- **year columns**: net USDT for that calendar year alone, fresh 2000 USDT each year and a fixed $ risk (the variant's % of 2000), so years compare fairly.
- **<2024 / 2024+**: same fixed $ risk, net USDT and profit factor before and from 2024. The settings were picked on the years before 2024 only (`RESEARCH.md`, `DONCHIAN.md`), so 2024+ is the out-of-sample check.

Costs: Bybit taker fee 0.055% per side; funding approximated at 0.01% per 8h of position value (longs pay, shorts receive); no slippage unless a variant adds it. Stop checked on 1H candles, a gap through it fills at the open.

```
variant                                                        trades win%   ret% maxDD%    PF in mkt |   2021   2022   2023   2024   2025   2026 |  <2024   PF  2024+   PF
A  live: ATLAS flip ±25 within 3 candles (12h), long+short        347   31    581   24.9  1.47    60% |    727    101   2222    896    -48   1023 |   3050 1.93   1870 1.49
-- ATLAS flip variants --
window 2 candles (8h)                                             241   31     69   43.6  1.20    41% |    475    261      9    141   -734   1314 |    743 1.33    721 1.24
window 4 candles (16h)                                            416   30    459   27.7  1.39    68% |    603   -182   2280    862    -77   1040 |   2702 1.67   1851 1.43
window 5 candles (20h)                                            467   30    403   30.7  1.34    74% |    487    -73   2161    964   -322   1131 |   2574 1.58   1800 1.38
window 6 candles (24h)                                            501   31    389   31.9  1.33    78% |    407   -143   2203   1020   -348   1161 |   2468 1.52   1859 1.38
score ±20                                                         468   30    334   32.8  1.28    71% |    782   -184   2240    593   -385   1009 |   2838 1.67   1218 1.25
score ±30                                                         237   31     27   37.6  1.09    41% |    471   -139   -106    304    296    -23 |    226 1.09    577 1.21
score ±35                                                         186   32     16   36.1  1.06    33% |    519    -28   -230    318     71    -97 |    260 1.15    291 1.12
long-only                                                         164   29    384   25.3  1.78    29% |    350   -278   2427   1033    -49    508 |   2499 2.48   1533 1.84
-- costs --
+ 0.05% slippage per side                                         347   29    433   25.9  1.38    60% |    676     43   2106    808   -159    948 |   2826 1.82   1597 1.40
no funding (fees only)                                            347   30    593   25.1  1.47    60% |    726     98   2275    908    -37   1015 |   3100 1.94   1885 1.49
-- stops --
initial stop 1.5 ATR                                              355   28    689   29.6  1.37    55% |    978    152   2826    832   -179   1255 |   4368 2.07   1950 1.40
initial stop 2.5 ATR                                              344   32    407   20.8  1.50    62% |    554    111   1658    955    -72    771 |   2323 1.83   1654 1.55
trail 2.5 ATR                                                     352   31    356   24.6  1.41    51% |    636    114   1646    427   -124   1130 |   2397 1.79   1433 1.39
trail 4 ATR                                                       339   29    554   26.8  1.42    69% |   1033    131   2009    731     99    856 |   3172 1.89   1686 1.43
-- risk per trade --
risk 1%                                                           347   31    194   13.4  1.56    60% |    363     50   1111    448    -24    511 |   1525 1.93    935 1.49
risk 1.5%                                                         347   31    359   19.4  1.51    60% |    545     76   1667    672    -36    767 |   2287 1.93   1403 1.49
risk 3%                                                           347   31    783   34.9  1.32    60% |   1090    151   2680   1344   -100   1408 |   4574 1.93   2805 1.49
-- breakout strategy (earlier live setups) --
breakout 15, long+short (until the flip)                          424   34    374   32.2  1.35    76% |   -110    120   2113   1472     16    731 |   2033 1.41   2207 1.51
breakout 20, long-only (first setup)                              179   36    324   26.0  1.70    35% |    267   -386   2511    941   -105    447 |   2392 2.22   1282 1.70
breakout 15, 2H signals                                           858   30     28   42.9  1.03    72% |   -213   -163   1269    897   -508    643 |    684 1.07   1208 1.13
breakout 15, 1H signals                                          1771   29    -88   91.8  0.90    75% |     -7  -1106    133   -691  -1229    -12 |  -1453 0.91  -1663 0.86
buy & hold 2000 USDT, 1x                                                                              |   1197  -1284   3113   2425   -128    -94
```

## Live variant in detail

- 347 trades, 31% winners; average win $345, average loss $-103 (compounding, so later trades are bigger)
- 67 months with a closed trade, 28 of them losing; longest losing streak 11 trades
- worst drop from a peak 24.9%

| Exit | Trades | Net $ |
|---|---:|---:|
| exit signal | 99 | 532 |
| trailing stop | 166 | 23502 |
| stop | 82 | -12407 |

Most trades lose a little (false breakouts); a few long trends pay for them. Expect long flat or losing stretches.
