#!/usr/bin/env node
// One tiny real order round-trip on the OKX demo account, with the bot's own
// client and settings — to prove OKX accepts its orders before the first
// real breakout:
//   1. leverage (LEVERAGE, margin mode as configured)
//   2. market buy of the smallest size with the stop-loss attached
//   3. read back the position and the stop on OKX
//   4. move the stop up once (what trailing does)
//   5. hold HOLD_SEC seconds (look in the OKX app), then cancel the stop and
//      close at market, and read the realized P&L
// The position is closed in every case, also after an error. Nothing is
// written to state/: the bot's balance and trade list don't include it.
//
//   node scripts/okx-testtrade.js            (GitHub: Run workflow → action "testtrade")
'use strict';

require('../src/env').loadEnv();
const config = require('../config');
const { createClient } = require('../src/okx');

const HOLD_SEC = +(process.env.HOLD_SEC || 60);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const px = (x) => (+x).toLocaleString('en-US', { maximumFractionDigits: 1 });

async function main() {
  const instrument = (process.env.OKX_INSTRUMENT || '').trim().toUpperCase() || config.OKX_INSTRUMENT;
  const client = createClient({
    apiKey: process.env.OKX_API_KEY, apiSecret: process.env.OKX_API_SECRET, passphrase: process.env.OKX_API_PASSPHRASE,
    base: process.env.OKX_API_BASE, instrument, symbol: config.SYMBOL, marginMode: process.env.OKX_MARGIN_MODE,
  });
  const S = config.SYMBOL;
  const lev = client.spot ? 1 : config.PORTFOLIO.LEVERAGE;
  console.log(`Test trade on ${instrument} (${client.spot ? 'spot' : `${client.marginMode} margin, ${lev}x`})`);

  if ((await client.getPositions())[S]) {
    console.log('✗ A BTC position is already open on this instrument — not testing on top of it.');
    return 1;
  }
  const inst = await client.getInstrument(S);
  const qty = inst.minOrderQty;
  const mark = await client.getMarkPrice(S);
  const stop1 = +(Math.floor(mark * 0.98 / inst.tickSize) * inst.tickSize).toFixed(4);
  const stop2 = +(Math.floor(mark * 0.985 / inst.tickSize) * inst.tickSize).toFixed(4);
  const startedAt = Date.now();
  let opened = false, ok = true;
  try {
    await client.setLeverage(S, lev);
    console.log(`✓ 1. leverage ${lev}x set`);

    const ordId = await client.openMarket({ symbol: S, bias: 1, qty, stopLoss: stop1 });
    opened = true;
    console.log(`✓ 2. bought ${qty} BTC at market (order ${ordId}), stop attached at ${px(stop1)} (mark was ${px(mark)})`);

    let live = null;
    for (let i = 0; i < 10 && !(live && live.stopLoss); i++) { live = (await client.getPositions())[S]; if (!(live && live.stopLoss)) await sleep(500); }
    if (!live) throw new Error('no position showed up after the buy');
    console.log(`${live.stopLoss ? '✓' : '✗'} 3. OKX shows: long ${live.size} BTC @ ${px(live.avgPrice)}, stop ${live.stopLoss ? px(live.stopLoss) : 'MISSING'}`);
    if (!live.stopLoss) ok = false;

    await client.setStopLoss(S, stop2);
    await sleep(500);
    const moved = (await client.getPositions())[S];
    const movedOk = moved && Math.abs(moved.stopLoss - stop2) < inst.tickSize;
    console.log(`${movedOk ? '✓' : '✗'} 4. stop moved ${px(stop1)} → ${moved ? px(moved.stopLoss) : '?'}`);
    if (!movedOk) ok = false;

    console.log(`   holding ${HOLD_SEC}s — open the OKX app: Positions should show the long with its stop-loss…`);
    await sleep(HOLD_SEC * 1000);
  } catch (err) {
    ok = false;
    console.log(`✗ ${err.message}`);
  } finally {
    // Close whatever is open on the instrument, in every case.
    try {
      const live = (await client.getPositions())[S];
      await client.cancelAll(S);
      if (live) {
        const id = await client.closeMarket({ symbol: S, bias: live.bias, qty: live.size });
        console.log(`✓ 5. stop cancelled, closed ${live.size} BTC at market (order ${id})`);
      } else if (opened) {
        console.log('  5. position already gone (stop hit?) — orders cancelled');
      }
    } catch (err) {
      ok = false;
      console.log(`✗ CLOSING FAILED: ${err.message} — close it in the OKX app!`);
    }
  }

  if (opened) {
    let recs = [];
    for (let i = 0; i < 10 && !recs.length; i++) { await sleep(1000); recs = await client.getClosedPnl(S, startedAt - 60000); }
    const pnl = recs.reduce((a, r) => a + r.pnl, 0);
    console.log(recs.length ? `✓ 6. realized P&L read back: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)} (fees included)` : '✗ 6. no P&L record found yet (it can take a moment on OKX)');
    if (!(await client.getPositions())[S]) console.log('✓ nothing left open');
    else { ok = false; console.log('✗ a position is still open — close it in the OKX app'); }
  }
  console.log(ok ? '\nTEST PASSED — the bot can trade this instrument.' : '\nTEST FAILED — see the ✗ lines above.');
  return ok ? 0 : 1;
}

main().then((c) => { process.exitCode = c; }, (e) => { console.error(e); process.exitCode = 1; });
