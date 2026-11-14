#!/usr/bin/env node
// Real-order test on the OKX demo of what two positions per coin need (src/exchange.js, MAX_POSITIONS_PER_COIN):
//   1. open the smallest short with the stop attached (as the bot's first entry)
//   2. move that stop wider (as the switch to the real-price stop does)
//   3. add the smallest size on the same side (the second part: addToPosition, no stop attached)
//   4. ensureWholeStop: one stop for the WHOLE position (the attached one covered only the first order)
//   5. close one part (reduce-only, half the size): the whole-position stop must stay for the rest
//   6. move the whole stop again (amend), then close the rest, and read the fills and OKX's positions history
// It runs on an instrument WITHOUT a bot position (default BTC-USD_UM-261225, the same USD-settled futures family
// as the bot's), so the bot's own positions are never touched. Everything is closed at the end, also after an error.
// Nothing is written to state/.
//   node scripts/okx-test-parts.js            (GitHub: Run workflow → action "parts", instrument optional)
'use strict';

require('../src/env').loadEnv();
const config = require('../config');
const { createClient, transport } = require('../src/okx');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const px = (x) => require('../src/format').price(x, 1);

async function main() {
  const instrument = (process.env.TESTTRADE_INSTRUMENT || '').trim().toUpperCase() || 'BTC-USD_UM-261225';
  const keys = { apiKey: process.env.OKX_API_KEY, apiSecret: process.env.OKX_API_SECRET, passphrase: process.env.OKX_API_PASSPHRASE, base: process.env.OKX_API_BASE };
  const client = createClient({ ...keys, instrument, symbol: config.SYMBOL, marginMode: process.env.OKX_MARGIN_MODE, triggerPxType: process.env.OKX_TRIGGER_PX });
  const { request } = transport(keys);
  const S = config.SYMBOL, lev = config.PORTFOLIO.LEVERAGE, bias = -1;
  const type = /_XPERP|-\d{6}$/.test(instrument) ? 'FUTURES' : 'SWAP';
  const algos = async () => {
    const out = [];
    for (const ordType of ['conditional', 'oco']) out.push(...(await request('GET', '/api/v5/trade/orders-algo-pending', { ordType, instType: type, instId: instrument })));
    return out.filter(o => +o.slTriggerPx);
  };
  const showAlgos = async (label) => {
    const a = await algos();
    console.log(`   ${label}: ${a.length} stop order(s) — ` + a.map(o => `trigger ${o.slTriggerPx}, sz ${o.sz || '-'}, closeFraction ${o.closeFraction || '-'}, ${o.ordType}`).join(' | '));
    return a;
  };
  const position = async (want) => {
    let live = null;
    for (let i = 0; i < 12; i++) { live = (await client.getPositions())[S] || null; if (want(live)) break; await sleep(500); }
    return live;
  };
  console.log(`Two-parts test on ${instrument} (${client.marginMode} margin, ${lev}x), a short`);
  if ((await client.getPositions())[S]) { console.log(`✗ A position is already open on ${instrument} — not testing on top of it.`); return 1; }
  const inst = await client.getInstrument(S);
  const q = inst.minOrderQty;
  const lvl = (mark, pct) => +((Math.ceil(mark * (1 + pct) / inst.tickSize)) * inst.tickSize).toFixed(4); // above the price (short)
  const startedAt = Date.now();
  let ok = true;
  const check = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) ok = false; return cond; };
  try {
    await client.setLeverage(S, lev);
    let mark = await client.getMarkPrice(S);
    const id1 = await client.openMarket({ symbol: S, bias, qty: q, stopLoss: lvl(mark, 0.02) });
    let live = await position(l => l && l.stopLoss);
    check(live && live.bias === bias && live.size === q && live.stopLoss, `1. short ${q} opened (order ${id1}) @ ${live && px(live.avgPrice)}, stop ${live && live.stopLoss}`);
    await showAlgos('after the entry');

    await client.setStopLoss(S, lvl(mark, 0.04));
    live = await position(l => l && Math.abs(l.stopLoss - lvl(mark, 0.04)) < inst.tickSize);
    check(live && Math.abs(live.stopLoss - lvl(mark, 0.04)) < inst.tickSize, `2. stop moved wider to ${lvl(mark, 0.04)} (OKX shows ${live && live.stopLoss})`);

    const before = live.size, avg1 = live.avgPrice;
    const id2 = await client.addToPosition({ symbol: S, bias, qty: q });
    live = await position(l => l && l.size > before);
    check(live && Math.abs(live.size - 2 * q) < 1e-9, `3. second part added (order ${id2}): size ${live && live.size}, average ${live && px(live.avgPrice)}`);
    const p2entry = live ? (live.avgPrice * live.size - avg1 * before) / (live.size - before) : null;
    console.log(`   the second part's own entry, worked out as the bot does: ${p2entry && px(p2entry)}`);
    await showAlgos('after the add, before ensureWholeStop');

    mark = await client.getMarkPrice(S);
    await client.ensureWholeStop(S, lvl(mark, 0.035));
    const a4 = await showAlgos('after ensureWholeStop');
    check(a4.length === 1 && String(a4[0].closeFraction) === '1' && Math.abs(+a4[0].slTriggerPx - lvl(mark, 0.035)) < inst.tickSize,
      `4. one whole-position stop at ${lvl(mark, 0.035)}`);

    const id3 = await client.closeMarket({ symbol: S, bias, qty: q });
    live = await position(l => l && l.size < 2 * q);
    check(live && Math.abs(live.size - q) < 1e-9, `5. one part closed (order ${id3}): ${live && live.size} left`);
    const a5 = await showAlgos('after closing one part');
    check(a5.length === 1 && String(a5[0].closeFraction) === '1', '5b. the whole-position stop is still there for the rest');

    await client.ensureWholeStop(S, lvl(mark, 0.03));
    const a6 = await showAlgos('after moving it again');
    check(a6.length === 1 && Math.abs(+a6[0].slTriggerPx - lvl(mark, 0.03)) < inst.tickSize, `6. the whole stop moved to ${lvl(mark, 0.03)} (amended in place)`);
  } catch (err) {
    ok = false;
    console.log(`✗ ${err.message}${err.code ? ' (OKX code ' + err.code + ')' : ''}`);
  } finally {
    try {
      await client.cancelAll(S);
      const live = (await client.getPositions())[S];
      if (live) { const id = await client.closeMarket({ symbol: S, bias: live.bias, qty: live.size }); console.log(`   closed the rest (${live.size}, order ${id})`); }
      const left = await position(l => !l);
      check(!left, '7. nothing left open on the test instrument');
      const a = await algos();
      check(!a.length, '7b. no stop orders left');
    } catch (e) { ok = false; console.log(`✗ cleanup: ${e.message} — CLOSE ${instrument} BY HAND in the OKX app`); }
  }
  await sleep(2000);
  try {
    const fills = await client.getClosedPnl(S, startedAt - 60000);
    console.log(`   closing fills: ` + fills.map(f => `${f.qty} @ ${px(f.exit)} → ${f.pnl.toFixed(4)}`).join(' | '));
    const hist = await client.getPositionsHistory(startedAt - 60000).catch(() => []);
    console.log(`   OKX positions history: ` + (hist.filter(h => h.symbol === S).map(h => `type ${h.type}, realized ${h.realized.toFixed(4)}`).join(' | ') || 'none yet (can lag)'));
  } catch (e) { console.log(`   fills not read: ${e.message}`); }
  console.log(ok ? '\nTEST PASSED — two parts per coin work on OKX as the bot expects.' : '\nTEST FAILED — see the ✗ lines above.');
  return ok ? 0 : 1;
}

main().then(code => process.exit(code)).catch((e) => { console.error(e); process.exit(1); });
