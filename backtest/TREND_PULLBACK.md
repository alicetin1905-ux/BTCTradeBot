# Trend pullback — the strategy since 2026-10-19

Why a new strategy: the ATLAS flip with a fixed −$100 / +$200 lost 66% in its first two forward weeks
(1 win in 15 trades): the score confirms a move after it happened, the market was choppy, and BTC / ETH / HYPE
entered and lost together.

## Candidates tested (4H candles, BTC + ETH + HYPE, 2024-10-17 → 2026-10-18)

Costs 0.2% of the price per round trip (fees + slippage), entry at the next candle's open, stop checked
before target inside a candle, at most 2 positions open at once, $40 risk per trade (2% of 2,000).

| Strategy | Trades/month | Win rate | Profit factor | Result | Worst drawdown |
|---|---|---|---|---|---|
| A. Range: Bollinger 20/2 + RSI 30/70, only when ADX < 25, target the middle band | 4.8 | 37% | 0.70 | −$867 | $888 |
| **B. Trend pullback** (stop 2 ATR, trail 4 ATR) | 7.1 | 32% | **1.56** | **+$2,298** | $454 |
| C. Regime switch (B when ADX > 25, A when ADX < 20) | 6.9 | 32% | 0.66 | −$1,373 | $1,398 |

A lost in every variant tried (bands 2.5 / RSI 25, no ADX filter, ADX 20 with a 2 ATR stop and 72h hold).

## B by year (max 2 open, $40 risk)

| Year | Trades | Win rate | PF | Result | Drawdown |
|---|---|---|---|---|---|
| 2021 | 74 | 43% | 1.55 | +$845 | $206 |
| 2022 | 78 | 18% | 0.64 | **−$772** | $1,020 |
| 2023 | 80 | 26% | 1.06 | +$124 | $803 |
| 2024 | 72 | 29% | 1.74 | +$1,260 | $458 |
| 2025 | 87 | 33% | 1.45 | +$949 | $383 |
| 2026 to 18 Oct | 71 | 30% | 1.57 | +$962 | $454 |

Neighbouring settings are all positive over 2024-26: stop 1.5–3 ATR, trail 2–4 ATR (PF 1.18–1.65).
The last 3 weeks (choppy) would have lost too: 5 trades, −$171.

## Rules (src/pullback.js — checked identical to the backtest on every candle)

- Trend up: EMA50 > EMA200 and close > EMA200 (down: the mirror).
- Long: uptrend, the 4H candle's low touches EMA20 and it closes above EMA20, the close before above EMA50.
- Short: the mirror.
- Stop 2 × ATR(14) at the entry, then trailed 4 × ATR behind the best close after every 4H close; no take-profit.
- 2% risk per trade (owner's choice), at most 2 positions open at once.

Reproduce: `backtest/pullback/run.js` / `run2.js` (1H candles merged to 4H; see data.js for the sources).
