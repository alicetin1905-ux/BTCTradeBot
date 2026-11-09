// The real market price for the stops (config.STOP_ON_REAL_PRICE): the highest and lowest trade since a moment, from
// Binance spot 1-minute candles — the same market the learner's signals and the walk-forward test use — with OKX's
// own spot market (the real one, not the demo) as a fallback. The OKX demo contracts trade thinly and sometimes print
// prices the real market never saw (ETH 2026-11-09: a 2,220 fill while the real high was 2,158), so the stop is
// judged here and only a wide safety stop stays on the exchange.
'use strict';

let fetchFn = (...a) => fetch(...a);
function setFetch(f) { fetchFn = f; }

async function getJson(url) {
  const r = await fetchFn(url, { headers: { 'User-Agent': 'btc-eth-bot' } });
  if (!r.ok) throw new Error(`${url.split('?')[0]} → HTTP ${r.status}`);
  return r.json();
}

async function binance(coin, since, now) {
  let hi = -Infinity, lo = Infinity, last = null, start = since;
  for (let n = 0; n < 5 && start < now; n++) {
    const k = await getJson(`https://data-api.binance.vision/api/v3/klines?symbol=${coin}USDT&interval=1m&startTime=${start}&limit=1000`);
    if (!k.length) break;
    for (const c of k) { hi = Math.max(hi, +c[2]); lo = Math.min(lo, +c[3]); last = +c[4]; }
    if (k.length < 1000) break;
    start = +k[k.length - 1][0] + 60000;
  }
  if (last == null) throw new Error('Binance: no candles');
  return { high: hi, low: lo, last, source: 'binance' };
}

async function okx(coin, since) {
  // newest first, at most 300 minutes back
  const j = await getJson(`https://www.okx.com/api/v5/market/candles?instId=${coin}-USDT&bar=1m&limit=300`);
  const rows = (j.data || []).filter(r => +r[0] + 60000 > since);
  if (!rows.length) throw new Error('OKX: no candles');
  let hi = -Infinity, lo = Infinity;
  for (const r of rows) { hi = Math.max(hi, +r[2]); lo = Math.min(lo, +r[3]); }
  return { high: hi, low: lo, last: +rows[0][4], source: 'okx' };
}

// { high, low, last, source } of the real market since `since` (ms).
async function extremesSince(coin, since, now = Date.now()) {
  const from = Math.floor(since / 60000) * 60000;
  try { return await binance(coin, from, now); } catch (e) {
    return okx(coin, from).catch((e2) => { throw new Error(`${e.message}; ${e2.message}`); });
  }
}

module.exports = { extremesSince, setFetch };
