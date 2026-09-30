#!/usr/bin/env node
// Read-only OKX check — places no orders. Answers, from wherever it runs
// (e.g. GitHub Actions):
//   - can this machine reach OKX's API at all?
//   - with keys (OKX_API_KEY / _SECRET / _PASSPHRASE in the env or .env):
//     are they valid demo keys, is the account mode right, what's the equity?
// Without keys it signs with a dummy key: "Invalid OK-ACCESS-KEY" then means
// the API is reachable and only the key is missing.
//
//   node scripts/okx-check.js          exit 1 if keys are set but don't work
'use strict';

require('../src/env').loadEnv();
const { createClient } = require('../src/okx');

// What the common OKX refusals mean for this bot.
const HINTS = {
  50101: 'this is a live-trading key — create the key while in Demo Trading (Trade → Demo trading → profile → Demo Trading API)',
  50102: 'timestamp rejected — the machine clock is off',
  50103: 'the key header is missing',
  50105: 'wrong passphrase (OKX_API_PASSPHRASE is the passphrase you typed when creating the key)',
  50110: 'the key is bound to other IP addresses — for GitHub Actions create it without an IP binding',
  50111: 'the API key is not valid (typo, deleted, or not a demo key)',
  50113: 'invalid signature — OKX_API_SECRET is wrong',
  50119: 'the API key does not exist',
};

async function main() {
  const base = process.env.OKX_API_BASE || 'https://www.okx.com';
  const haveKeys = !!(process.env.OKX_API_KEY && process.env.OKX_API_SECRET && process.env.OKX_API_PASSPHRASE);
  let r;
  try {
    r = await (await fetch(base + '/api/v5/public/mark-price?instType=SWAP&instId=BTC-USDT-SWAP')).json();
  } catch (err) {
    console.log(`✗ OKX public API unreachable from here: ${err.message}`);
    return 1;
  }
  if (r.code !== '0') { console.log(`✗ OKX public API answered ${r.code}: ${r.msg}`); return 1; }
  console.log(`✓ OKX public API reachable (${base}) — BTC mark price ${(+r.data[0].markPx).toFixed(1)}`);

  const client = createClient({
    apiKey: haveKeys ? process.env.OKX_API_KEY : 'dummy-key', apiSecret: haveKeys ? process.env.OKX_API_SECRET : 'dummy',
    passphrase: haveKeys ? process.env.OKX_API_PASSPHRASE : 'dummy', base,
  });
  try {
    const w = await client.getWallet();
    const a = await client.accountInfo();
    const p = await client.getPositions();
    const MODES = { 1: 'Spot mode', 2: 'Futures mode', 3: 'Multi-currency margin', 4: 'Portfolio margin' };
    console.log(`✓ Demo account OK — USDT equity ${w.equity.toFixed(2)}, available ${w.available.toFixed(2)}`);
    console.log(`  account mode: ${MODES[a.acctLv] || a.acctLv} · position mode: ${a.posMode === 'long_short_mode' ? 'long/short' : 'net (one-way)'}`);
    if (a.acctLv === '1') {
      console.log('✗ Spot mode can\'t trade perpetual swaps — switch the demo account to Futures mode (Settings → Account mode)');
      return 1;
    }
    console.log(`  open USDT-swap positions: ${Object.keys(p).length ? Object.entries(p).map(([s, x]) => `${s} ${x.bias === 1 ? 'long' : 'short'} ${x.size}`).join(', ') : 'none'}`);
    return 0;
  } catch (err) {
    const code = +(err.code || 0);
    if (!haveKeys && code === 50111) {
      console.log('✓ OKX private API reachable (a dummy key was refused, as expected) — add the three OKX_API_* keys to trade');
      return 0;
    }
    console.log(`✗ ${haveKeys ? 'Keys refused' : 'Private API'}: ${err.message}${HINTS[code] ? `\n  → ${HINTS[code]}` : ''}`);
    return 1;
  }
}

main().then((c) => { process.exitCode = c; }, (e) => { console.error(e); process.exitCode = 1; });
