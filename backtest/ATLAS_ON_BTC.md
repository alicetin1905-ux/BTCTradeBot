# ATLAS score (TradeBot rules) on BTC — why this bot uses a different signal

Run with the ATLAS scorer from [TradeBot](https://github.com/alicetin1905-ux/TradeBot) (BTC only, one position, TradeBot's live exit ladder) before this bot was built. Every variant lost money over 2021–2026 as a whole (profit factor below 1), and all but one lost after 2024 too — the same picture as TradeBot's own `backtest/COIN_WF.md` (BTC: 1 of 7 years positive, PF 0.88). The ATLAS code isn't part of this repo; see `RESEARCH.md` and `DONCHIAN.md` for what replaced it.

## Original run

Generated 2026-09-30 23:22 UTC by the first (ATLAS) version of `scripts/backtest.js`, 2021-01-21 → 2026-09-30. BTCUSDT only, one position at a time.

- **trades / win% / ret% / maxDD% / PF**: the whole period, compounding — 2000 USDT start, risk as a % of the current balance (2.5% unless the variant says otherwise), max 400 USDT margin at 10x.
- **per-year columns**: net USDT for that calendar year alone, fresh 2000 USDT each year and a fixed $ risk (the variant's % of 2000), so years compare fairly.
- **<2024 / 2024+**: same fixed $ risk, net USDT before and from 2024 — pick on the first, check on the second.

Approximation: price/volume signals only (no funding, OI, long/short, book, tape); exits replayed on 1H candles, stop first when a candle touches stop and target; Bybit fees (0.055% taker, 0.02% maker), no slippage, no funding.

```
variant                                                    trades  win%     ret%  maxDD%    PF |   2021   2022   2023   2024   2025   2026 |  <2024  2024+
A  TradeBot rules (4H, score 50, 1.5/2.5/3.5R, 25/25/50%)     437    34      -73    77.9  0.81 |   -149   -523   -394    -68   -746   -254 |  -1150  -1068
-- min score to enter --
min score 30                                                  627    35      -64    73.2  0.89 |    450   -404   -855    476   -647   -429 |   -946   -562
min score 35                                                  602    35      -74    79.3  0.86 |    467   -561   -907     69   -735   -361 |  -1137   -989
min score 40                                                  554    35      -72    78.5  0.86 |    379   -550   -597    169   -715   -608 |   -905  -1116
min score 45                                                  503    34      -77    80.4  0.83 |    115   -545   -602    234  -1134   -392 |  -1168  -1254
min score 55                                                  388    37      -55    63.1  0.85 |   -181   -262   -558     64   -260      6 |  -1049   -190
min score 60                                                  329    38      -47    54.9  0.86 |   -277   -191   -316    309   -198   -275 |   -832   -165
min score 70                                                  205    37      -35    41.3  0.85 |   -133   -202   -304    269    132   -331 |   -737     70
-- targets (R) --
targets 1 / 2 / 3                                             456    44      -67    73.4  0.84 |     -1   -425    -59   -508   -715   -126 |   -530  -1350
targets 1.5 / 3 / 4.5                                         421    34      -71    78.5  0.82 |     56   -566   -187   -230   -845   -120 |   -865  -1195
targets 2 / 3 / 4.5                                           420    31      -70    76.9  0.82 |     31   -783   -116    -55   -723   -219 |  -1041   -997
targets 2 / 4 / 6                                             414    31      -57    69.4  0.88 |    275   -537    254    -93   -902     12 |   -201   -983
-- close shares at T1/T2/T3 --
close 40 / 35 / 25                                            437    34      -72    77.1  0.81 |   -121   -463   -450   -161   -657   -270 |  -1099  -1088
close 33 / 33 / 34                                            437    34      -73    77.4  0.81 |   -130   -485   -433   -124   -688   -264 |  -1120  -1076
close 50 / 25 / 25                                            437    34      -72    77.0  0.81 |   -127   -461   -431   -182   -665   -272 |  -1079  -1119
-- stop --
stop 1 ATR                                                    452    36      -63    68.1  0.85 |   -269   -345   -209   -156   -476    -88 |   -907   -720
stop 2 ATR                                                    416    33      -66    71.8  0.81 |      1   -532   -301   -142   -443   -246 |   -969   -830
stop 2.5 ATR                                                  400    32      -45    56.2  0.88 |    136   -288   -157   -159   -166   -150 |   -445   -476
stop to entry after T2 (not T1)                               433    31      -73    78.8  0.81 |    -98   -642   -325      8   -799   -262 |  -1149  -1053
no stop to T1 after T2                                        425    34      -69    75.8  0.83 |     53   -530   -463    -36   -750   -162 |   -990   -947
-- filters / exits --
Fibonacci check off                                           438    34      -73    77.7  0.81 |   -200   -562   -394    -68   -681   -254 |  -1202  -1003
no flip exit                                                  310    41      -42    53.7  0.90 |    250    -48   -245   -192   -230    -49 |   -275   -471
no fees (reference)                                           437    34      -57    65.5  0.87 |    -57   -395   -207     81   -540   -120 |   -747   -579
-- risk per trade --
risk 1.5%                                                     437    34      -52    57.8  0.81 |    -90   -322   -219    -41   -458   -152 |   -681   -651
risk 2%                                                       437    34      -64    69.3  0.81 |   -119   -427   -283    -54   -610   -203 |   -896   -867
risk 3%                                                       437    34      -80    84.4  0.81 |   -179   -615   -536    -84   -859   -292 |  -1431  -1234
risk 4%                                                       437    34      -90    92.5  0.80 |   -239   -733   -758   -231  -1092   -406 |  -1860  -1843
```
