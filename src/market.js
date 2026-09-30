// BTC candles for the signal, from the exchange the bot trades on (the prices
// it actually trades at; config.MARKET_DATA can pick the other one): Bybit
// linear BTCUSDT or OKX BTC-USDT-SWAP, falling back to the other exchange when
// the first fails. Public mainnet reads only: no API key is sent. The set is
// never mixed between the two exchanges.
'use strict';

const config = require('../config');

let fetchImpl = (...a) => fetch(...a);
function setFetch(f) { fetchImpl = f; } // tests

const TF_MS = { '60': 3600000, '240': 4 * 3600000, D: 86400000 };
const OKX_BAR = { '60': '1H', '240': '4H', D: '1D' };

async function json(url) {
  const r = await fetchImpl(url);
  const text = await r.text();
  try { return JSON.parse(text); } catch (e) { throw new Error(`HTTP ${r.status}: ${text.slice(0, 120)}`); }
}

// Newest first from both APIs; returned oldest first.
async function bybitKlines(symbol, tf, limit) {
  const d = await json(`https://api.bybit.com/v5/market/kline?${new URLSearchParams({ category: 'linear', symbol, interval: tf, limit: String(Math.min(limit, 1000)) })}`);
  if (d.retCode !== 0) throw new Error(`Bybit kline ${d.retCode}: ${d.retMsg}`);
  const rows = (d.result && d.result.list) || [];
  if (!rows.length) throw new Error(`Bybit: no ${tf} candles for ${symbol}`);
  return rows.slice().reverse().map(k => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));
}

async function okxKlines(symbol, tf, limit) {
  const instId = symbol.replace('USDT', '') + '-USDT-SWAP';
  const out = [];
  let after = '';
  // /market/candles returns at most 300 per call: page back with `after`.
  while (out.length < limit) {
    const d = await json(`https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=${OKX_BAR[tf]}&limit=300${after ? '&after=' + after : ''}`);
    if (d.code !== '0') throw new Error(`OKX candles: ${d.msg}`);
    if (!d.data.length) break;
    for (const k of d.data) out.push({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[6] });
    after = d.data[d.data.length - 1][0];
  }
  return out.slice(0, limit).reverse();
}

function primary() { return config.MARKET_DATA || config.EXCHANGE || 'bybit'; }

// Closed candles only (the still-forming one is dropped), oldest first.
// Returns { candles, source, note } — note says why the first choice wasn't used.
async function closedCandles(symbol = config.SYMBOL, tf = config.ENTRY_TF, limit = 500, now = Date.now()) {
  const load = { bybit: bybitKlines, okx: okxKlines };
  const first = primary(), second = first === 'okx' ? 'bybit' : 'okx';
  let rows, source = first, note = null;
  try { rows = await load[first](symbol, tf, limit + 1); } catch (err) {
    note = err.message;
    source = second;
    rows = await load[second](symbol, tf, limit + 1);
  }
  const candles = rows.filter(k => k.t + TF_MS[tf] <= now);
  return { candles, source, note };
}

module.exports = { closedCandles, bybitKlines, okxKlines, setFetch, primary, TF_MS };
