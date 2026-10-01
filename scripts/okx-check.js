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
  50119: 'OKX does not know this API key on this site',
  50123: 'OKX refuses trading this product with this API key',
};
// OKX's sites: a key only exists on the one its account belongs to.
const SITES = { 'https://www.okx.com': 'global', 'https://my.okx.com': 'EEA', 'https://app.okx.com': 'US', 'https://tr.okx.com': 'Türkiye' };

// Shape of the pasted values, without printing them: an OKX API key is a
// UUID (8-4-4-4-12), the secret 32 hex characters.
function shapes(key, secret, pass) {
  const out = [];
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, hex32 = /^[0-9a-f]{32}$/i;
  const raw = [process.env.OKX_API_KEY, process.env.OKX_API_SECRET, process.env.OKX_API_PASSPHRASE];
  if (raw.some(v => v && v !== v.trim())) out.push('a value had spaces or a line break around it (ignored now)');
  if (uuid.test(key) && hex32.test(secret)) return out.concat('key and secret look right (UUID key, 32-character secret)');
  if (uuid.test(secret) && hex32.test(key)) return out.concat('OKX_API_KEY and OKX_API_SECRET are SWAPPED — the key is the one with dashes');
  if (!uuid.test(key)) out.push(`OKX_API_KEY doesn't look like an OKX API key (usually 36 characters like xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx; it has ${key.length})`);
  if (!hex32.test(secret)) out.push(`OKX_API_SECRET doesn't look like an OKX secret key (usually 32 letters/digits; it has ${secret.length})`);
  if (!pass) out.push('OKX_API_PASSPHRASE is empty');
  return out;
}

async function main() {
  const base = (process.env.OKX_API_BASE || '').trim().replace(/\/$/, '') || 'https://www.okx.com';
  const key = (process.env.OKX_API_KEY || '').trim(), secret = (process.env.OKX_API_SECRET || '').trim(), pass = (process.env.OKX_API_PASSPHRASE || '').trim();
  const haveKeys = !!(key && secret && pass);
  let r;
  try {
    r = await (await fetch(base + '/api/v5/public/mark-price?instType=SWAP&instId=BTC-USDT-SWAP')).json();
  } catch (err) {
    console.log(`✗ OKX public API unreachable from here: ${err.message}`);
    return 1;
  }
  if (r.code !== '0') { console.log(`✗ OKX public API answered ${r.code}: ${r.msg}`); return 1; }
  console.log(`✓ OKX public API reachable (${base}) — BTC mark price ${(+r.data[0].markPx).toFixed(1)}`);

  if (haveKeys) for (const line of shapes(key, secret, pass)) console.log(`  · ${line}`);
  const instrument = (process.env.OKX_INSTRUMENT || '').trim().toUpperCase() || require('../config').OKX_INSTRUMENT;
  const client = createClient({
    apiKey: haveKeys ? key : 'dummy-key', apiSecret: haveKeys ? secret : 'dummy',
    passphrase: haveKeys ? pass : 'dummy', base, instrument, marginMode: process.env.OKX_MARGIN_MODE,
  });
  if (haveKeys) console.log(`  instrument: ${instrument}${client.spot ? ' (spot: long-only, no leverage)' : (/-SWAP$/.test(instrument) ? ' (perpetual swap' : ' (future') + `, ${client.marginMode} margin)`}`);
  try {
    const w = await client.getWallet();
    const a = await client.accountInfo();
    const p = await client.getPositions();
    const MODES = { 1: 'Spot mode', 2: 'Futures mode', 3: 'Multi-currency margin', 4: 'Portfolio margin' };
    const quote = client.spot ? instrument.split('-')[1] : await client.marginCcy();
    console.log(`✓ Demo account OK — ${quote} equity ${w.equity.toFixed(2)}, available ${w.available.toFixed(2)}`);
    const h = await client.holdings();
    console.log(`  trading account (≈ $${h.totalUsd.toFixed(0)}): ${h.trading.slice(0, 6).map(c => `${c.ccy} ${+c.eq.toFixed(4)}`).join(', ') || 'empty'}`);
    if (h.fundingUsdt != null) console.log(`  funding account USDT: ${h.fundingUsdt.toFixed(2)}`);
    for (const t of ['SWAP', 'FUTURES', 'SPOT']) {
      try { console.log(`  BTC ${t} instruments this account can trade: ${(await client.tradableBtc(t)).join(', ') || 'none'}`); } catch (e) { console.log(`  (${t} list: ${e.message})`); }
    }
    for (const coin of ['ETH', 'SOL']) {
      for (const t of ['FUTURES', 'SWAP']) {
        try {
          const list = await client.tradable(coin, t);
          console.log(`  ${coin} ${t} instruments this account can trade: ${list.join(', ') || 'none'}`);
          for (const id of list.map(x => x.split(' ')[0]).filter(x => /XPERP/.test(x))) {
            for (const tdMode of ['isolated']) {
              try { const m = await client.maxSize(id, tdMode); console.log(`  ${id} (${tdMode}): max buy ${m.buy}, max sell ${m.sell}`); } catch (e) { console.log(`  ${id} (${tdMode}): ${e.message.replace(/^.*-> /, '')}`); }
            }
          }
        } catch (e) { console.log(`  (${coin} ${t} list: ${e.message})`); }
      }
    }
    for (const [instId, tdMode] of [['BTC-USD_UM_XPERP-310328', 'cross'], ['BTC-USD_UM_XPERP-310328', 'isolated'], ['BTC-USDT-SWAP', 'cross'], ['BTC-USDC', 'cash']]) {
      try { const m = await client.maxSize(instId, tdMode); console.log(`  ${instId} (${tdMode}): max buy ${m.buy}, max sell ${m.sell}`); } catch (e) { console.log(`  ${instId} (${tdMode}): ${e.message.replace(/^.*-> /, '')}`); }
    }
    console.log(`  account mode: ${MODES[a.acctLv] || a.acctLv} · position mode: ${a.posMode === 'long_short_mode' ? 'long/short' : 'net (one-way)'}`);
    if (client.spot && w.available < 50) {
      console.log(`✗ Hardly any ${quote} in the trading account — the bot buys ${instrument} with ${quote}.\n` +
        `  In the OKX app (demo mode): convert or transfer some ${quote} into the Trading account (the bot trades like a 2000 ${quote} account).`);
      return 1;
    }
    if (!client.spot && a.acctLv === '2' && w.equity < 100) {
      console.log(`✗ No ${quote} in the trading account — ${instrument} needs ${quote} as margin in Futures mode.\n` +
        `  In the OKX app (demo mode): Assets → Transfer / Convert → ${quote} into the Trading account (the bot trades like a 2000 ${quote} account).\n` +
        '  Or switch the demo account to Multi-currency margin mode (Settings → Account mode): then its other coins count as margin.');
      return 1;
    }
    console.log(`  key permissions: ${a.perm || 'unknown'}`);
    if (a.perm && !/trade/.test(a.perm)) {
      console.log('✗ The API key can only read. Edit it in OKX (demo mode: profile → Demo Trading API → Edit) and tick "Trade" — key, secret and passphrase stay the same.');
      return 1;
    }
    if (!client.spot && a.acctLv === '1') {
      console.log('✗ Spot mode can\'t trade perpetual swaps — switch the demo account to Futures mode (Settings → Account mode)');
      return 1;
    }
    console.log(`  open positions: ${Object.keys(p).length ? Object.entries(p).map(([s, x]) => `${s} ${x.bias === 1 ? 'long' : 'short'} ${x.size}`).join(', ') : 'none'}`);
    return 0;
  } catch (err) {
    const code = +(err.code || 0);
    if (!haveKeys && code === 50111) {
      console.log('✓ OKX private API reachable (a dummy key was refused, as expected) — add the three OKX_API_* keys to trade');
      return 0;
    }
    console.log(`✗ ${haveKeys ? 'Keys refused' : 'Private API'} on ${base}: ${err.message}${HINTS[code] ? `\n  → ${HINTS[code]}` : ''}`);
    if (haveKeys && (code === 50119 || code === 50111)) {
      // Is the key known on another OKX site?
      for (const [site, name] of Object.entries(SITES)) {
        if (site === base) continue;
        try {
          const w = await createClient({ apiKey: key, apiSecret: secret, passphrase: pass, base: site }).getWallet();
          console.log(`→ The key works on the OKX ${name} site (${site}), demo equity ${w.equity.toFixed(2)} USDT.\n  Add a repository secret OKX_API_BASE = ${site} and run the check again.`);
          return 1;
        } catch (e) {
          if (e.code && +e.code !== 50119 && +e.code !== 50111) {
            console.log(`→ The key exists on the OKX ${name} site (${site}), which answered: ${e.message}${HINTS[+e.code] ? `\n  → ${HINTS[+e.code]}` : ''}\n  Add a repository secret OKX_API_BASE = ${site}.`);
            return 1;
          }
        }
      }
      console.log('  The key is unknown on every OKX site (global, EEA, US, Türkiye). Check that:\n' +
        '  - it was created while in Demo Trading (Demo Trading API page), and not deleted since\n' +
        '  - OKX_API_KEY holds the API key (with dashes), OKX_API_SECRET the secret key — re-paste them\n' +
        '    (GitHub: Settings → Secrets and variables → Actions → the secret → Update).');
    }
    return 1;
  }
}

main().then((c) => { process.exitCode = c; }, (e) => { console.error(e); process.exitCode = 1; });
