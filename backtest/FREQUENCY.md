# More trades: timeframe, channel, direction

Generated with scripts/backtest.js simulate() (live signal code, fees + funding), 2021-01 → 2026-09. ret% / DD% / PF: compounding 2% risk; <2024 / 2024+: fixed $40 risk, profit factor per half. The question was whether the bot can trade more often than ~31 times a year without losing its edge.

**Result:** 1H signals lose money after fees (PF below 1 in most settings); 2H is marginal; 4H holds up in every setting. Adding shorts and a 15-candle channel on 4H gives ~74 trades a year with the highest return (+374%, worst drop 32%, PF 1.41 / 1.51) — now the live setup.

```
Robustness per timeframe and direction (20 settings each: channel 10/15/20/30/40 x stop/trail 1.5/2.5, 2/3, 2.5/3.5, 3/4.5):

timeframe dir    PF>1 both halves  median trades/yr  median PF
1H        long               3/20               132       0.97
1H        both               2/20               261       0.92
2H        long              19/20                62       1.15
2H        both              16/20               124       1.03
4H        long              20/20                31       1.58
4H        both              20/20                62       1.29

All settings, sorted by trades per year:

setting                         trades/yr   ret%   DD%    PF  <2024 PF  2024+ PF
1H both n10 stop1.5 trail2.5          429    -95    97  0.92      0.94      0.90
1H both n10 stop2 trail3              388    -89    93  0.90      0.88      0.94
1H both n10 stop2.5 trail3.5          366    -81    89  0.90      0.82      0.95
1H both n10 stop3 trail4.5            348    -71    82  0.91      0.80      1.01
1H both n15 stop1.5 trail2.5          345    -92    96  0.93      1.01      0.80
1H both n15 stop2 trail3              308    -88    92  0.90      0.91      0.86
1H both n20 stop1.5 trail2.5          293    -85    91  0.93      1.01      0.82
1H both n15 stop2.5 trail3.5          285    -80    87  0.90      0.88      0.88
1H both n20 stop2 trail3              262    -84    87  0.91      0.92      0.88
1H both n15 stop3 trail4.5            261    -56    73  0.94      0.98      0.87
1H both n20 stop2.5 trail3.5          240    -77    85  0.89      0.84      0.91
1H both n30 stop1.5 trail2.5          223    -25    76  0.99      1.11      0.94
1H long n10 stop1.5 trail2.5          218    -49    79  0.96      1.01      0.95
1H both n20 stop3 trail4.5            217    -70    80  0.89      0.83      0.91
2H both n10 stop1.5 trail2.5          212    -30    65  0.98      1.06      0.95
1H both n30 stop2 trail3              201    -35    56  0.97      1.02      1.01
1H long n10 stop2 trail3              195    -28    65  0.97      0.94      1.03
1H both n40 stop1.5 trail2.5          195    -39    78  0.97      1.07      0.94
2H both n10 stop2 trail3              194    -32    58  0.97      1.01      0.95
1H long n10 stop2.5 trail3.5          186    -40    67  0.95      0.87      1.01
1H both n30 stop2.5 trail3.5          185    -22    55  0.98      0.99      1.04
2H both n10 stop2.5 trail3.5          183    -38    54  0.95      1.02      0.92
1H both n40 stop2 trail3              178    -62    71  0.92      0.94      0.95
1H long n15 stop1.5 trail2.5          177    -49    82  0.96      1.09      0.88
1H long n10 stop3 trail4.5            175    -35    65  0.94      0.88      1.06
2H both n10 stop3 trail4.5            173    -21    49  0.97      1.03      0.99
2H both n15 stop1.5 trail2.5          166     91    46  1.05      1.16      1.17
1H both n40 stop2.5 trail3.5          164    -61    70  0.90      0.83      0.99
1H both n30 stop3 trail4.5            162     28    46  1.03      1.05      1.14
1H long n15 stop2 trail3              156    -24    65  0.97      1.03      0.96
1H long n20 stop1.5 trail2.5          150    -25    76  0.98      1.14      0.88
2H both n15 stop2 trail3              149     28    43  1.03      1.07      1.13
2H both n20 stop1.5 trail2.5          146     12    63  1.01      1.13      1.02
1H long n15 stop2.5 trail3.5          144    -24    56  0.96      0.92      1.03
1H both n40 stop3 trail4.5            143    -16    48  0.98      0.98      1.04
2H both n15 stop2.5 trail3.5          136     30    42  1.04      1.06      1.13
1H long n20 stop2 trail3              133    -28    67  0.97      1.08      0.91
1H long n15 stop3 trail4.5            132      3    54  1.00      1.04      1.00
2H both n20 stop2 trail3              130     11    52  1.01      1.09      1.05
2H both n15 stop3 trail4.5            124     22    47  1.03      1.00      1.19
1H long n20 stop2.5 trail3.5          122    -29    57  0.95      0.99      0.98
2H both n20 stop2.5 trail3.5          117     25    46  1.03      1.10      1.09
1H long n30 stop1.5 trail2.5          116     29    71  1.02      1.23      0.93
2H both n30 stop1.5 trail2.5          116     46    55  1.04      1.09      1.17
1H long n20 stop3 trail4.5            110    -26    56  0.95      1.00      0.96
4H both n10 stop1.5 trail2.5          106     87    52  1.07      1.33      1.02
2H both n30 stop2 trail3              106      7    53  1.01      1.04      1.06
2H both n20 stop3 trail4.5            106     21    46  1.03      1.05      1.14
2H long n10 stop1.5 trail2.5          105    105    58  1.08      1.26      1.09
1H long n30 stop2 trail3              104     14    62  1.02      1.18      0.95
1H long n40 stop1.5 trail2.5          103     18    69  1.02      1.16      0.97
2H long n10 stop2 trail3               98     25    54  1.03      1.14      1.00
4H both n10 stop2 trail3               97     89    43  1.10      1.23      1.16
1H long n30 stop2.5 trail3.5           96     -0    56  1.00      1.05      1.00
2H both n30 stop2.5 trail3.5           95     74    40  1.10      1.15      1.20
2H both n40 stop1.5 trail2.5           95    105    47  1.11      1.15      1.29
1H long n40 stop2 trail3               93    -17    67  0.97      1.08      0.93
2H long n10 stop2.5 trail3.5           91     36    46  1.06      1.24      1.00
4H both n10 stop2.5 trail3.5           90     95    37  1.13      1.24      1.18
2H long n10 stop3 trail4.5             86     59    39  1.10      1.27      1.10
2H both n40 stop2 trail3               86     65    44  1.09      1.10      1.22
1H long n40 stop2.5 trail3.5           86    -22    56  0.96      0.98      0.99
4H both n10 stop3 trail4.5             86     59    32  1.11      1.22      1.12
4H both n15 stop1.5 trail2.5           84    242    44  1.19      1.37      1.32
2H long n15 stop1.5 trail2.5           84    188    50  1.15      1.37      1.21
1H long n30 stop3 trail4.5             83     54    47  1.07      1.26      1.04
2H both n30 stop3 trail4.5             83     86    45  1.13      1.13      1.29
2H both n40 stop2.5 trail3.5           78     99    35  1.15      1.20      1.25
2H long n15 stop2 trail3               76     98    45  1.12      1.28      1.15
2H long n20 stop1.5 trail2.5           75     86    64  1.09      1.27      1.10
4H both n15 stop2 trail3               74    374    32  1.35      1.41      1.51
1H long n40 stop3 trail4.5             73     58    49  1.08      1.37      1.01
4H both n20 stop1.5 trail2.5           71    190    40  1.21      1.35      1.33
2H long n15 stop2.5 trail3.5           69     86    33  1.15      1.25      1.24
4H both n15 stop2.5 trail3.5           68    222    31  1.30      1.38      1.44
2H long n20 stop2 trail3               67    107    53  1.13      1.35      1.13
2H both n40 stop3 trail4.5             66    188    30  1.28      1.30      1.44
4H both n15 stop3 trail4.5             63    148    28  1.29      1.32      1.41
2H long n15 stop3 trail4.5             62    101    37  1.21      1.18      1.40
4H both n20 stop2 trail3               62    287    27  1.36      1.47      1.48
2H long n30 stop1.5 trail2.5           60     97    59  1.13      1.29      1.18
2H long n20 stop2.5 trail3.5           60     72    39  1.13      1.26      1.19
4H both n30 stop1.5 trail2.5           56    197    34  1.27      1.50      1.31
4H both n20 stop2.5 trail3.5           55    175    31  1.29      1.54      1.31
2H long n30 stop2 trail3               54    120    49  1.19      1.39      1.25
4H long n10 stop1.5 trail2.5           53    182    48  1.22      1.57      1.27
2H long n20 stop3 trail4.5             53    110    41  1.23      1.24      1.40
2H long n40 stop1.5 trail2.5           50     98    50  1.17      1.29      1.25
2H long n30 stop2.5 trail3.5           50     93    43  1.19      1.38      1.19
4H both n30 stop2 trail3               49    199    28  1.33      1.61      1.32
4H both n20 stop3 trail4.5             49    122    25  1.28      1.55      1.23
4H long n10 stop2 trail3               48    186    37  1.31      1.57      1.38
4H both n40 stop1.5 trail2.5           48    118    38  1.19      1.53      1.12
2H long n40 stop2 trail3               45    126    41  1.27      1.34      1.40
4H long n10 stop2.5 trail3.5           45    151    32  1.35      1.58      1.39
4H both n30 stop2.5 trail3.5           44    130    27  1.29      1.61      1.24
4H long n15 stop1.5 trail2.5           43    282    47  1.37      1.64      1.59
4H long n10 stop3 trail4.5             43     88    30  1.28      1.44      1.32
2H long n30 stop3 trail4.5             42    157    39  1.35      1.43      1.53
4H both n40 stop2 trail3               42    222    28  1.42      1.77      1.36
2H long n40 stop2.5 trail3.5           41    109    33  1.29      1.39      1.33
4H both n30 stop3 trail4.5             40     56    26  1.18      1.39      1.13
4H long n15 stop2 trail3               37    356    31  1.60      1.88      1.76
4H both n40 stop2.5 trail3.5           37    157    26  1.38      1.88      1.25
4H long n20 stop1.5 trail2.5           36    319    34  1.53      1.81      1.74
2H long n40 stop3 trail4.5             34    186    37  1.50      1.68      1.62
4H long n15 stop2.5 trail3.5           34    245    27  1.63      1.81      1.79
4H both n40 stop3 trail4.5             33     87    23  1.31      1.66      1.17
4H long n15 stop3 trail4.5             32    140    26  1.54      1.56      1.73
4H long n20 stop2 trail3               31    324    26  1.70      2.22      1.70
4H long n30 stop1.5 trail2.5           29    262    35  1.60      1.98      1.73
4H long n20 stop2.5 trail3.5           28    201    26  1.65      2.11      1.61
4H long n30 stop2 trail3               26    220    35  1.58      2.55      1.43
4H long n20 stop3 trail4.5             25    103    23  1.49      1.82      1.42
4H long n40 stop1.5 trail2.5           25    222    28  1.63      2.07      1.66
4H long n30 stop2.5 trail3.5           23    147    29  1.57      2.29      1.42
4H long n40 stop2 trail3               21    291    24  1.95      2.96      1.77
4H long n30 stop3 trail4.5             21     63    25  1.37      1.63      1.34
4H long n40 stop2.5 trail3.5           19    191    23  1.91      2.76      1.73
4H long n40 stop3 trail4.5             17    104    20  1.73      2.02      1.69
```
