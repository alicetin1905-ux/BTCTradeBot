# BTC backtest 2021-01-01 → 2026-09-30

Generated 2026-09-30 23:32 UTC by `node scripts/backtest.js` — the live signal code (`src/signal.js`) replayed on OKX BTC-USDT-SWAP 1H candles.

- **trades … in mkt**: the whole period, compounding from 2000 USDT with the variant's % risk; *in mkt* = share of the time a position is open.
- **year columns**: net USDT for that calendar year alone, fresh 2000 USDT each year and a fixed $ risk (the variant's % of 2000), so years compare fairly.
- **<2024 / 2024+**: same fixed $ risk, net USDT and profit factor before and from 2024. The settings were picked on the years before 2024 only (`RESEARCH.md`, `DONCHIAN.md`), so 2024+ is the out-of-sample check.

Costs: Bybit taker fee 0.055% per side; funding approximated at 0.01% per 8h of position value (longs pay, shorts receive); no slippage unless a variant adds it. Stop checked on 1H candles, a gap through it fills at the open.

```
variant                                                        trades win%   ret% maxDD%    PF in mkt |   2021   2022   2023   2024   2025   2026 |  <2024   PF  2024+   PF
A  live: long-only, 20/20, stop 2 ATR, trail 3 ATR, 2% risk       179   36    324   26.0  1.70    35% |    267   -386   2511    941   -105    447 |   2392 2.22   1282 1.70
-- direction --
long + short                                                      354   34    287   27.5  1.36    65% |   -241     42   2192   1106    -34    626 |   1955 1.47   1706 1.48
-- costs --
+ 0.05% slippage per side                                         179   35    272   27.9  1.61    35% |    241   -423   2453    899   -167    404 |   2271 2.11   1137 1.59
no funding (fees only)                                            179   36    401   24.3  1.80    35% |    304   -351   2623   1007    -42    501 |   2575 2.34   1465 1.82
-- breakout channel --
channel 15                                                        212   35    326   33.9  1.56    40% |    184   -414   2480   1336   -316    483 |   2249 1.92   1561 1.67
channel 30                                                        147   33    227   35.0  1.59    28% |    207   -187   2193    825   -275    249 |   2213 2.58    813 1.43
channel 40                                                        121   38    298   24.0  1.96    26% |    199   -152   2281    826    -11    229 |   2328 3.00   1045 1.78
exit channel 10                                                   193   35    261   24.4  1.59    31% |    190   -360   2278    849    -85    402 |   2011 1.98   1166 1.60
exit channel 30                                                   179   36    311   26.0  1.68    35% |    267   -394   2466    914   -105    447 |   2340 2.19   1256 1.68
-- stops --
initial stop 1.5 ATR                                              191   32    434   35.6  1.57    33% |    510   -461   2948   1153    -89    230 |   3028 2.27   1580 1.65
initial stop 2.5 ATR                                              170   39    250   24.3  1.77    36% |    198   -233   1973    878    -77    295 |   1938 2.21   1095 1.77
trail 2.5 ATR                                                     200   38    204   29.7  1.54    30% |     70   -303   1722    984    -93    349 |   1488 1.74   1271 1.66
trail 4 ATR                                                       165   29    211   33.8  1.56    39% |    349   -599   2272    665   -140    542 |   2020 1.94   1067 1.57
-- risk per trade --
risk 1%                                                           179   36    125   14.0  1.83    35% |    134   -193   1255    470    -53    223 |   1196 2.22    641 1.70
risk 1.5%                                                         179   36    215   20.3  1.76    35% |    200   -290   1883    706    -79    335 |   1794 2.22    962 1.70
risk 3%                                                           179   36    442   36.1  1.51    35% |    401   -576   3325   1411   -197    290 |   3017 2.02   1924 1.70
buy & hold 2000 USDT, 1x                                                                              |   1197  -1284   3113   2425   -128    -90
```

## Live variant in detail

- 179 trades, 36% winners; average win $246, average loss $-80 (compounding, so later trades are bigger)
- 69 months with a closed trade, 36 of them losing; longest losing streak 9 trades
- worst drop from a peak 26.0%

| Exit | Trades | Net $ |
|---|---:|---:|
| trailing stop | 114 | 10835 |
| stop | 60 | -5955 |
| exit signal | 5 | 1609 |

Most trades lose a little (false breakouts); a few long trends pay for them. Expect long flat or losing stretches.
