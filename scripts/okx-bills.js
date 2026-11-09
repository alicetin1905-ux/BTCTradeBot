#!/usr/bin/env node
// Read-only: where does the OKX demo account's USDC equity differ from the bot's own balance? Places no orders.
//   - the USDC balance details (equity, cash, unrealized P&L)
//   - every USDC bill since the bot started (or the last 3 months), grouped by type / subtype, with sums
//   - OKX's own positions history (realized P&L incl. fees and funding) for the bot's instruments
//   - the bot's own trades (state/demo) for the same period
//   node scripts/okx-bills.js        (keys from the env / .env, as for the bot)
'use strict';
require('../src/env').loadEnv();
const fs = require('fs');
const path = require('path');
const { transport } = require('../src/okx');

const { request } = transport({ apiKey: process.env.OKX_API_KEY, apiSecret: process.env.OKX_API_SECRET, passphrase: process.env.OKX_API_PASSPHRASE, base: process.env.OKX_API_BASE });
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', f), 'utf8')); } catch (e) { return d; } };
const iso = (t) => new Date(+t).toISOString().replace('T', ' ').slice(0, 16);
const TYPES = { 1: 'transfer', 2: 'trade', 3: 'delivery', 4: 'forced repayment', 5: 'liquidation', 6: 'margin transfer', 7: 'interest', 8: 'funding fee', 9: 'ADL', 10: 'clawback', 11: 'system token conversion', 12: 'strategy transfer', 13: 'DDH', 14: 'block trade', 15: 'quick margin', 22: 'repay', 24: 'spread trading', 26: 'structured', 27: 'convert', 28: 'easy convert', 29: 'one-click repay', 30: 'simple trade', 33: 'loans', 34: 'settlement' };

(async () => {
  const account = read('state/demo/account.json', {});
  const since = account.startedAt || Date.now() - 90 * 864e5;
  console.log(`bot started ${iso(since)} UTC with ${account.startingBalance}; bot balance now ${account.balance?.toFixed(2)}; last OKX equity seen ${account.exchangeEquity?.toFixed(2)}`);

  const bal = (await request('GET', '/api/v5/account/balance', { ccy: 'USDC' }))[0] || {};
  const u = (bal.details || []).find(d => d.ccy === 'USDC') || {};
  console.log(`\nOKX USDC now: equity ${u.eq} · cash ${u.cashBal} · available ${u.availBal} · unrealized P&L ${u.upl} · frozen ${u.frozenBal}`);

  // bills: the last 7 days (/bills) and older ones up to 3 months (/bills-archive)
  const bills = [];
  for (const ep of ['/api/v5/account/bills', '/api/v5/account/bills-archive']) {
    let after = '';
    for (let page = 0; page < 30; page++) {
      const params = { ccy: 'USDC', limit: '100', begin: String(since) };
      if (after) params.after = after;
      let rows;
      try { rows = await request('GET', ep, params); } catch (e) { console.log(`${ep}: ${e.message}`); break; }
      for (const b of rows) if (!bills.some(x => x.billId === b.billId)) bills.push(b);
      if (rows.length < 100) break;
      after = rows[rows.length - 1].billId;
    }
  }
  bills.sort((a, b) => +a.ts - +b.ts);
  const groups = {};
  for (const b of bills) {
    const k = `${TYPES[b.type] || 'type ' + b.type} / sub ${b.subType}${b.instId ? ' · ' + b.instId : ''}`;
    const g = groups[k] || (groups[k] = { n: 0, balChg: 0, pnl: 0, fee: 0 });
    g.n++; g.balChg += +b.balChg || 0; g.pnl += +b.pnl || 0; g.fee += +b.fee || 0;
  }
  console.log(`\n${bills.length} USDC bills since the start, by type (balChg = what changed the balance):`);
  let total = 0;
  for (const [k, g] of Object.entries(groups)) { total += g.balChg; console.log(`  ${k.padEnd(60)} ${String(g.n).padStart(4)}x  balChg ${g.balChg.toFixed(4).padStart(11)}  pnl ${g.pnl.toFixed(4).padStart(10)}  fee ${g.fee.toFixed(4).padStart(9)}`); }
  console.log(`  total balance change ${total.toFixed(4)}`);
  console.log('\nevery bill:');
  for (const b of bills) console.log(`  ${iso(b.ts)}  ${(TYPES[b.type] || b.type).padEnd(12)} sub ${String(b.subType).padEnd(4)} ${String(b.instId || '').padEnd(26)} balChg ${(+b.balChg).toFixed(4).padStart(10)}  pnl ${(+b.pnl || 0).toFixed(4).padStart(9)}  fee ${(+b.fee || 0).toFixed(4).padStart(8)}  px ${b.px || ''} sz ${b.sz || ''}`);

  console.log('\nOKX positions history (realized P&L incl. fee and funding):');
  try {
    const ph = await request('GET', '/api/v5/account/positions-history', { instType: 'FUTURES', limit: '50' });
    for (const p of ph.filter(p => +p.uTime >= since)) console.log(`  ${iso(p.cTime)} → ${iso(p.uTime)}  ${p.instId.padEnd(26)} ${p.direction || p.posSide} open ${p.openAvgPx} close ${p.closeAvgPx}  pnl ${(+p.pnl).toFixed(4)}  fee ${(+p.fee).toFixed(4)}  funding ${(+p.fundingFee).toFixed(4)}  realized ${(+p.realizedPnl).toFixed(4)}  type ${p.type}`);
  } catch (e) { console.log('  ' + e.message); }

  console.log('\nthe bot\'s own trades:');
  let botSum = 0;
  for (const dir of ['state/demo', 'state/demo/eth']) {
    for (const t of read(dir + '/trades.json', [])) { botSum += t.pnl; console.log(`  ${iso(t.closedAt)}  ${t.symbol}  ${t.bias === 1 ? 'long' : 'short'} ${t.entry.toFixed(2)} → ${t.exit.toFixed(2)}  pnl ${t.pnl.toFixed(4)}  ${t.reason}`); }
  }
  console.log(`  sum ${botSum.toFixed(4)} · funding booked by the bot ${(account.funding?.total || 0).toFixed(4)}`);
})().catch((e) => { console.error(e); process.exit(1); });
