// Price text that suits the coin: BTC / ETH like 84,625.5 and 2,696.8, but NEAR
// at 4.807 needs its three decimals. bigDp = decimals for prices of 1000+.
'use strict';

function price(x, bigDp = 1) {
  const v = +x;
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const dp = a >= 1000 ? bigDp : a >= 100 ? 2 : a >= 1 ? 3 : 5;
  return v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

module.exports = { price };
