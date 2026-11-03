// Full candle history for the learner: Binance spot 4H (from 2017) and daily closes, per coin, cached in cache/
// (not committed) and topped up each run. Fallback for the newest candles: OKX spot (BTC-USDT, '4Hutc').
'use strict';
const fs = require('fs');
const path = require('path');

const CACHE = path.join(__dirname, '..', 'cache');
const TF = { '4h': 144e5, '1d': 864e5 };
const START = Date.UTC(2017, 7, 17);
let fetchFn = (...a) => fetch(...a);
function setFetch(f) { fetchFn = f; }

async function getJson(url) {
  const r = await fetchFn(url, { headers: { 'User-Agent': 'btc-eth-bot' } });
  if (!r.ok) throw new Error(`${url.split('?')[0]} → HTTP ${r.status}`);
  return r.json();
}

async function binance(symbol, interval, startT) {
  const out = [];
  let start = startT;
  for (let n = 0; n < 40; n++) {
    const j = await getJson(`https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${start}&limit=1000`);
    for (const k of j) out.push({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[7], tbv: +k[10] });
    if (j.length < 1000) break;
    start = +j[j.length - 1][0] + 1;
  }
  return out;
}

async function okx(coin, interval, startT) {
  const bar = interval === '4h' ? '4H' : '1Dutc'; // OKX's 4H candles already start at 00/04/08… UTC
  const out = [];
  let after = '';
  for (let n = 0; n < 30; n++) {
    const j = await getJson(`https://www.okx.com/api/v5/market/history-candles?instId=${coin}-USDT&bar=${bar}&limit=100${after ? '&after=' + after : ''}`);
    const rows = (j.data || []).filter(k => k[8] === '1');
    for (const k of rows) out.push({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[7], tbv: +k[7] / 2 });
    if (!j.data || j.data.length < 100 || +j.data[j.data.length - 1][0] <= startT) break;
    after = j.data[j.data.length - 1][0];
  }
  return out.filter(k => k.t >= startT).sort((a, b) => a.t - b.t);
}

function readCache(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return []; } }

// Closed candles only (the candle's end <= now).
async function load(coin, interval, now = Date.now()) {
  const file = path.join(CACHE, `${coin}-${interval}.json`);
  let have = readCache(file);
  const step = TF[interval];
  const closed = k => k.t + step <= now;
  have = have.filter(closed);
  const from = have.length ? have[have.length - 1].t + 1 : START;
  // The newest candle that has closed by now; fetch only when the cache doesn't have it yet.
  const expected = Math.floor(now / step) * step - step;
  let add = [], note = null;
  if (!have.length || have[have.length - 1].t < expected) {
    try { add = await binance(coin + 'USDT', interval, from); } catch (e) {
      note = `Binance: ${e.message}`;
      try { add = await okx(coin, interval, from); } catch (e2) { note += `; OKX: ${e2.message}`; }
    }
  }
  const map = new Map(have.map(k => [k.t, k]));
  for (const k of add) if (closed(k)) map.set(k.t, k);
  const all = [...map.values()].sort((a, b) => a.t - b.t);
  if (add.length) { fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(file, JSON.stringify(all)); }
  const lastT = all.length ? all[all.length - 1].t : 0;
  // The newest closed candle must be there, or the signal would be stale.
  if (lastT < expected) throw new Error(`${coin} ${interval} history stops at ${new Date(lastT).toISOString()}${note ? ' (' + note + ')' : ''}`);
  return all;
}

// { BTC: { candles, daily }, ETH: {...} }
async function loadAll(coins, now = Date.now()) {
  const out = {};
  for (const c of coins) {
    out[c] = { candles: await load(c, '4h', now), daily: (await load(c, '1d', now)).map(k => ({ t: k.t, c: k.c })) };
  }
  return out;
}

module.exports = { load, loadAll, setFetch, CACHE };
