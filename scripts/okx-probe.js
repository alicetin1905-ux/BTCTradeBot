#!/usr/bin/env node
// Diagnostic: which kinds of order does OKX accept on one instrument? Places
// 1-contract market buys (margin mode x with / without an attached stop-loss)
// and closes whatever fills. For "why is this pair refused" questions
// (e.g. OKX 51155); nothing is written to state/.
//   INSTRUMENT=NEAR-USD_UM_XPERP-310725 node scripts/okx-probe.js
'use strict';

require('../src/env').loadEnv();
const { transport } = require('../src/okx');

const INST = (process.env.INSTRUMENT || process.env.OKX_INSTRUMENT || '').trim().toUpperCase();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  if (!INST) throw new Error('INSTRUMENT is not set');
  const { request, publicGet } = transport({
    apiKey: process.env.OKX_API_KEY, apiSecret: process.env.OKX_API_SECRET, passphrase: process.env.OKX_API_PASSPHRASE, base: process.env.OKX_API_BASE,
  });
  const i = (await publicGet('/api/v5/public/instruments', { instType: 'FUTURES', instId: INST }))[0];
  console.log(`${INST}: ${i ? `ctVal ${i.ctVal} ${i.ctValCcy}, lotSz ${i.lotSz}, minSz ${i.minSz}, state ${i.state}, lever ${i.lever}` : 'NOT LISTED (public)'}`);
  const mark = +(await publicGet('/api/v5/public/mark-price', { instType: 'FUTURES', instId: INST }))[0].markPx;
  console.log(`mark ${mark}`);
  let anyOk = false;
  for (const tdMode of ['isolated', 'cross']) {
    for (const withStop of [false, true]) {
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
