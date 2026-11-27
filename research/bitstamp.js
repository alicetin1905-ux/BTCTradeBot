#!/usr/bin/env node
// BTC history before Binance (Bitstamp BTC/USD since 2011), for research/improve.js LONGBTC=<year>: 4H and daily
// candles up to Binance's first candle (2017-08-17), cached in cache/BTC-4h-bitstamp.json / BTC-1d-bitstamp.json.
//   node research/bitstamp.js
'use strict';
const fs = require('fs'), path = require('path');
const CACHE = path.join(__dirname, '..', 'cache');
const END = Date.UTC(2017, 7, 17) / 1000;
async function pull(step) {
  const out = [];
  let start = Date.UTC(2011, 8, 1) / 1000;
  while (start < END) {
    const j = await (await fetch(`https://www.bitstamp.net/api/v2/ohlc/btcusd/?step=${step}&limit=1000&start=${start}`)).json();
    const rows = j.data.ohlc.map(k => ({ t: +k.timestamp * 1000, o: +k.open, h: +k.high, l: +k.low, c: +k.close, v: +k.volume * +k.close, tbv: +k.volume * +k.close / 2 }));
    if (!rows.length) break;
    for (const r of rows) if (r.t < END * 1000 && (!out.length || r.t > out[out.length - 1].t)) out.push(r);
    start = rows[rows.length - 1].t / 1000 + step;
  }
  return out;
}
(async () => {
  for (const [step, name] of [[14400, '4h'], [86400, '1d']]) {
    const rows = await pull(step);
    fs.writeFileSync(path.join(CACHE, `BTC-${name}-bitstamp.json`), JSON.stringify(rows));
    console.log(name, rows.length, new Date(rows[0].t).toISOString(), '→', new Date(rows[rows.length - 1].t).toISOString());
  }
})().catch(e => { console.error(e); process.exit(1); });
