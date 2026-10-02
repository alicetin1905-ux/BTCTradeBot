#!/usr/bin/env node
// Diagnostic: which kinds of order does OKX accept on one instrument? Places
// 1-contract market buys (margin mode x with / without an attached stop-loss)
// and closes whatever fills. For "why is this pair refused" questions
// (e.g. OKX 51155); nothing is written to state/.
//   INSTRUMENT=NEAR-USD_UM_XPERP-310725 node scripts/okx-probe.js
'use strict';

require('../src/env').loadEnv();
const { transport } = require('../src/okx');

// One instrument, or several separated by commas (then only the plain isolated order is tried on each).
const INSTS = (process.env.INSTRUMENT || process.env.OKX_INSTRUMENT || '').split(',').map(x => x.trim().toUpperCase()).filter(Boolean);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  if (!INSTS.length) throw new Error('INSTRUMENT is not set');
  const t = transport({
    apiKey: process.env.OKX_API_KEY, apiSecret: process.env.OKX_API_SECRET, passphrase: process.env.OKX_API_PASSPHRASE, base: process.env.OKX_API_BASE,
  });
  let ok = 0;
  // "CLOSE:<instrument>" only flattens that instrument (and cancels its stops) instead of probing it.
  for (const raw of INSTS.filter(x => x.startsWith('CLOSE:'))) {
    const id = raw.slice(6);
    // Pending (close) orders and stops first, then a reduce-only market order the other way.
    for (const o of await t.request('GET', '/api/v5/trade/orders-pending', { instType: 'FUTURES', instId: id }).catch(() => [])) {
      await t.request('POST', '/api/v5/trade/cancel-order', { instId: id, ordId: o.ordId }).catch(e => console.log(`  cancel order: ${e.message}`));
      console.log(`cancelled pending order ${o.ordId} (${o.side} ${o.sz} ${o.ordType})`);
    }
    for (const ordType of ['conditional', 'oco']) {
      for (const o of await t.request('GET', '/api/v5/trade/orders-algo-pending', { ordType, instType: 'FUTURES', instId: id }).catch(() => [])) {
        await t.request('POST', '/api/v5/trade/cancel-algos', [{ algoId: o.algoId, instId: id }]).catch(() => {});
      }
    }
    for (const p of (await t.request('GET', '/api/v5/account/positions', { instType: 'FUTURES', instId: id })).filter(q => +q.pos)) {
      const n = +p.pos;
      await t.request('POST', '/api/v5/trade/order', { instId: id, tdMode: p.mgnMode, side: n > 0 ? 'sell' : 'buy', ordType: 'market', sz: String(Math.abs(n)), reduceOnly: true, ...(p.mgnMode === 'cross' ? { ccy: 'USDC' } : {}) });
      console.log(`closed ${p.pos} contracts on ${id}`);
    }
    await sleep(2000);
    const left = (await t.request('GET', '/api/v5/account/positions', { instType: 'FUTURES', instId: id })).filter(q => +q.pos);
    console.log(left.length ? `✗ still open on ${id}` : `✓ nothing open on ${id}`);
  }
  INSTS.splice(0, INSTS.length, ...INSTS.filter(x => !x.startsWith('CLOSE:')));
  if (!INSTS.length) return 0;
  for (const inst of INSTS) {
    try { ok += (await probe(t, inst, INSTS.length === 1)) === 0 ? 1 : 0; } catch (e) { console.log(`✗ ${inst}: ${e.message.replace(/^.*-> /, '')}`); }
  }
  console.log(`\n${ok} of ${INSTS.length} instruments accepted an order`);
  return ok ? 0 : 1;
}

async function probe({ request, publicGet }, INST, full) {
  const i = (await publicGet('/api/v5/public/instruments', { instType: 'FUTURES', instId: INST }))[0];
  console.log(`${INST}: ${i ? `ctVal ${i.ctVal} ${i.ctValCcy}, lotSz ${i.lotSz}, minSz ${i.minSz}, state ${i.state}, lever ${i.lever}` : 'NOT LISTED (public)'}`);
  const mark = +(await publicGet('/api/v5/public/mark-price', { instType: 'FUTURES', instId: INST }))[0].markPx;
  console.log(`mark ${mark}`);
  let anyOk = false;
  for (const tdMode of full ? ['isolated', 'cross'] : ['isolated']) {
    for (const withStop of full ? [false, true] : [false]) {
      const label = `${tdMode}, ${withStop ? 'with stop-loss attached' : 'plain market order'}`;
      const order = { instId: INST, tdMode, side: 'buy', ordType: 'market', sz: String(i ? i.minSz : 1) };
      if (tdMode === 'cross') order.ccy = 'USDC';
      if (withStop) order.attachAlgoOrds = [{ slTriggerPx: String(+(mark * 0.9).toFixed(4)), slOrdPx: '-1', slTriggerPxType: 'mark' }];
      try {
        await request('POST', '/api/v5/account/set-leverage', { instId: INST, lever: '10', mgnMode: tdMode, ...(tdMode === 'cross' ? { ccy: 'USDC' } : {}) });
      } catch (e) { console.log(`  leverage (${tdMode}): ${e.message.replace(/^.*-> /, '')}`); }
      try {
        const r = await request('POST', '/api/v5/trade/order', order);
        console.log(`✓ ${label}: ACCEPTED (order ${r[0].ordId})`);
        anyOk = true;
        await sleep(1500);
        for (const o of await request('GET', '/api/v5/trade/orders-algo-pending', { ordType: 'conditional', instType: 'FUTURES', instId: INST }).catch(() => [])) {
          await request('POST', '/api/v5/trade/cancel-algos', [{ algoId: o.algoId, instId: INST }]).catch(() => {});
        }
        await request('POST', '/api/v5/trade/close-position', { instId: INST, mgnMode: tdMode, ...(tdMode === 'cross' ? { ccy: 'USDC' } : {}) }).catch(e => console.log(`  close: ${e.message}`));
        await sleep(1000);
      } catch (e) {
        console.log(`✗ ${label}: ${e.message.replace(/^.*-> /, '')}`);
      }
    }
  }
  const left = (await request('GET', '/api/v5/account/positions', { instType: 'FUTURES', instId: INST })).filter(p => +p.pos);
  console.log(left.length ? `✗ a position is still open on ${INST}: ${left.map(p => p.pos).join(', ')}` : '✓ nothing left open');
  return anyOk ? 0 : 1;
}

main().then((c) => process.exit(c), (e) => { console.error('✗', e.message); process.exit(1); });
