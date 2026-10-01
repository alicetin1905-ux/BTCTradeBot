// OKX v5 REST client — DEMO TRADING only (every request carries
// `x-simulated-trading: 1`, so a demo key can't touch a real account and a
// real key is rejected). Same interface as src/bybit.js, so src/exchange.js
// runs unchanged on either exchange:
//
//   sizes are in BTC here and converted to/from OKX contracts inside
//   (BTC-USDT-SWAP: 1 contract = ctVal = 0.01 BTC);
//   the stop is an OKX stop-loss algo order ("conditional"): attached to the
//   entry order, moved with amend-algos;
//   realized P&L per closing order is rebuilt from fills (fillPnl + fees,
//   with the entry fee shared out), matching Bybit's closed-pnl records;
//   funding payments come from the bills (type 8).
//
// Keys: create them on okx.com in Demo Trading (Trade → Demo trading →
// profile → Demo Trading API). Works in net (one-way) and long/short position
// mode; the account mode must allow derivatives (not "Spot mode").
'use strict';

const crypto = require('crypto');

const DEFAULT_BASE = 'https://www.okx.com';
const TD_MODE = 'cross';

class OkxError extends Error {
  constructor(path, code, msg) {
    super(`${path} -> OKX ${code}: ${msg}`);
    this.code = code;
  }
}

function sign(secret, timestamp, method, requestPath, body) {
  return crypto.createHmac('sha256', secret).update(timestamp + method + requestPath + body).digest('base64');
}

const instIdOf = (symbol) => symbol.replace(/USDT$/, '') + '-USDT-SWAP';
const symbolOf = (instId) => instId.replace(/-USDT-SWAP$/, 'USDT');
const num = (x) => (x === '' || x == null ? 0 : +x);
const dp = (step) => Math.max(0, (String(step).split('.')[1] || '').length);

function createClient({ apiKey, apiSecret, passphrase, base = DEFAULT_BASE, fetchImpl = fetch }) {
  // Pasted values often carry a stray space or line break.
  [apiKey, apiSecret, passphrase] = [apiKey, apiSecret, passphrase].map(v => (v == null ? v : String(v).trim()));
  if (!apiKey || !apiSecret || !passphrase) throw new Error('OKX_API_KEY / OKX_API_SECRET / OKX_API_PASSPHRASE are not set (see .env.example)');
  base = (String(base || '').trim() || DEFAULT_BASE).replace(/\/$/, '');

  async function parse(path, res) {
    const text = await res.text();
    let d;
    try { d = JSON.parse(text); } catch (e) { throw new Error(`${path} -> HTTP ${res.status}: ${text.slice(0, 200)}`); }
    if (d.code !== '0') {
      // Order endpoints put the reason per item.
      const item = Array.isArray(d.data) && d.data[0] && d.data[0].sCode && d.data[0].sCode !== '0' ? d.data[0] : null;
      throw new OkxError(path, item ? item.sCode : d.code, item ? item.sMsg : d.msg);
    }
    return d.data || [];
  }

  async function publicGet(path, params) {
    const url = base + path + '?' + new URLSearchParams(params).toString();
    return parse(path, await fetchImpl(url, { method: 'GET', headers: { 'x-simulated-trading': '1' } }));
  }

  async function request(method, path, params = {}) {
    let requestPath = path, body = '';
    if (method === 'GET') {
      const q = new URLSearchParams(params).toString();
      if (q) requestPath += '?' + q;
    } else {
      body = JSON.stringify(params);
    }
    const ts = new Date().toISOString();
    const res = await fetchImpl(base + requestPath, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'OK-ACCESS-KEY': apiKey,
        'OK-ACCESS-SIGN': sign(apiSecret, ts, method, requestPath, body),
        'OK-ACCESS-TIMESTAMP': ts,
        'OK-ACCESS-PASSPHRASE': passphrase,
        'x-simulated-trading': '1',
      },
      body: method === 'GET' ? undefined : body,
    });
    const data = await parse(path, res);
    // Batch endpoints can report success overall and failure per item.
    const bad = data.find(x => x && x.sCode && x.sCode !== '0');
    if (bad) throw new OkxError(path, bad.sCode, bad.sMsg);
    return data;
  }

  // Instrument rules, cached per run.
  const instCache = {};
  async function inst(symbol) {
    if (!instCache[symbol]) {
      const i = (await publicGet('/api/v5/public/instruments', { instType: 'SWAP', instId: instIdOf(symbol) }))[0];
      if (!i) throw new Error(`${symbol} is not listed on OKX`);
      instCache[symbol] = { ctVal: num(i.ctVal), lotSz: num(i.lotSz), minSz: num(i.minSz), tickSz: num(i.tickSz) };
    }
    return instCache[symbol];
  }
  // BTC -> contracts string on the lot step.
  async function contracts(symbol, qty) {
    const i = await inst(symbol);
    return String(+(Math.round(qty / i.ctVal / i.lotSz) * i.lotSz).toFixed(dp(i.lotSz)));
  }

  let acctCfg = null;
  async function accountConfig() {
    if (!acctCfg) {
      const c = (await request('GET', '/api/v5/account/config'))[0] || {};
      if (c.acctLv === '1') throw new Error('OKX account is in Spot mode — switch the demo account to Futures (or multi-currency) mode to trade swaps');
      acctCfg = { posMode: c.posMode || 'net_mode', acctLv: c.acctLv };
    }
    return acctCfg;
  }
  // posSide for an order on a position of this bias (long/short mode only).
  async function posSide(bias) {
    const { posMode } = await accountConfig();
    return posMode === 'long_short_mode' ? { posSide: bias === 1 ? 'long' : 'short' } : {};
  }

  // Pending stop-loss algo orders for one instrument.
  async function stopOrders(symbol) {
    const out = [];
    for (const ordType of ['conditional', 'oco']) {
      const rows = await request('GET', '/api/v5/trade/orders-algo-pending', { ordType, instType: 'SWAP', instId: instIdOf(symbol) });
      for (const r of rows) if (num(r.slTriggerPx)) out.push(r);
    }
    return out;
  }

  async function placeStop(symbol, bias, stopLoss) {
    await request('POST', '/api/v5/trade/order-algo', {
      instId: instIdOf(symbol), tdMode: TD_MODE, side: bias === 1 ? 'sell' : 'buy', ...(await posSide(bias)),
      ordType: 'conditional', slTriggerPx: String(stopLoss), slOrdPx: '-1', slTriggerPxType: 'mark',
      closeFraction: '1', reduceOnly: true,
    });
  }

  return {
    name: 'okx-demo',
    label: 'OKX',

    // Account and position mode, read-only (scripts/okx-check.js).
    async accountInfo() {
      const c = (await request('GET', '/api/v5/account/config'))[0] || {};
      return { acctLv: c.acctLv, posMode: c.posMode };
    },

    // BTC instruments this account may trade (account-level instrument list).
    async tradableBtc(instType = 'SWAP') {
      const rows = await request('GET', '/api/v5/account/instruments', { instType });
      return rows.filter(r => /^BTC-/.test(r.instId)).map(r => `${r.instId}${r.state && r.state !== 'live' ? ' (' + r.state + ')' : ''}`);
    },

    // Read-only "could I trade this?": OKX's max order size, or its refusal.
    async maxSize(instId, tdMode) {
      const r = (await request('GET', '/api/v5/account/max-size', { instId, tdMode }))[0] || {};
      return { buy: num(r.maxBuy), sell: num(r.maxSell) };
    },

    // Where the coins are, for scripts/okx-check.js: the trading account's
    // currencies (USD value) and the funding account's USDT.
    async holdings() {
      const acct = (await request('GET', '/api/v5/account/balance'))[0] || {};
      const trading = (acct.details || []).map(c => ({ ccy: c.ccy, eq: num(c.eq), usd: num(c.eqUsd) }))
        .filter(c => c.eq).sort((a, b) => b.usd - a.usd);
      let fundingUsdt = null;
      try {
        const f = (await request('GET', '/api/v5/asset/balances', { ccy: 'USDT' }))[0];
        fundingUsdt = f ? num(f.availBal) : 0;
      } catch (e) { /* key without asset read access */ }
      return { totalUsd: num(acct.totalEq), trading, fundingUsdt };
    },

    // USDT equity / available balance of the trading account.
    async getWallet() {
      const acct = (await request('GET', '/api/v5/account/balance'))[0];
      if (!acct) throw new Error('no trading account balance on OKX');
      // Multi-currency / portfolio margin: every coin counts as margin, valued
      // in USD (adjusted equity, minus the margin already in use).
      const { acctLv } = await accountConfig();
      if (acctLv === '3' || acctLv === '4') {
        const adj = num(acct.adjEq || acct.totalEq);
        return { equity: adj, available: Math.max(0, adj - num(acct.imr)) };
      }
      // Futures mode: only USDT counts — USDT-margined swaps can't use other
      // coins as margin (no USDT in the trading account = nothing to trade with).
      const usdt = (acct.details || []).find(c => c.ccy === 'USDT') || {};
      return {
        equity: num(usdt.eq),
        available: num(usdt.availEq !== undefined && usdt.availEq !== '' ? usdt.availEq : usdt.availBal),
      };
    },

    // Open USDT swap positions, keyed like Bybit ("BTCUSDT"), size in BTC.
    async getPositions() {
      const rows = await request('GET', '/api/v5/account/positions', { instType: 'SWAP' });
      const out = {};
      for (const p of rows) {
        const pos = num(p.pos);
        if (!pos || !/-USDT-SWAP$/.test(p.instId)) continue;
        const symbol = symbolOf(p.instId);
        const i = await inst(symbol);
        const bias = p.posSide === 'long' ? 1 : p.posSide === 'short' ? -1 : pos > 0 ? 1 : -1;
        out[symbol] = {
          symbol, bias, size: +(Math.abs(pos) * i.ctVal).toFixed(8),
          avgPrice: num(p.avgPx), markPrice: num(p.markPx), unrealisedPnl: num(p.upl), stopLoss: 0,
        };
      }
      // The stop lives in a separate algo order: read it for the bot's coin(s).
      for (const symbol of Object.keys(out)) {
        if (symbol !== 'BTCUSDT') continue;
        const sl = (await stopOrders(symbol))[0];
        if (sl) out[symbol].stopLoss = num(sl.slTriggerPx);
      }
      return out;
    },

    async getInstrument(symbol) {
      const i = await inst(symbol);
      return { qtyStep: +(i.lotSz * i.ctVal).toFixed(10), minOrderQty: +(i.minSz * i.ctVal).toFixed(10), minNotional: 0, tickSize: i.tickSz };
    },

    async getMarkPrice(symbol) {
      const r = (await publicGet('/api/v5/public/mark-price', { instType: 'SWAP', instId: instIdOf(symbol) }))[0];
      if (!r) throw new Error(`no mark price for ${symbol}`);
      return num(r.markPx);
    },

    async setLeverage(symbol, leverage) {
      await accountConfig();
      await request('POST', '/api/v5/account/set-leverage', { instId: instIdOf(symbol), lever: String(leverage), mgnMode: TD_MODE });
    },

    // Market entry with the stop-loss attached to the same order, so the
    // position never exists on OKX without a stop.
    async openMarket({ symbol, bias, qty, stopLoss }) {
      const r = await request('POST', '/api/v5/trade/order', {
        instId: instIdOf(symbol), tdMode: TD_MODE, side: bias === 1 ? 'buy' : 'sell', ...(await posSide(bias)),
        ordType: 'market', sz: await contracts(symbol, qty),
        attachAlgoOrds: [{ slTriggerPx: String(stopLoss), slOrdPx: '-1', slTriggerPxType: 'mark' }],
      });
      return r[0].ordId;
    },

    // Moves the position's stop: amends the pending stop-loss algo order, or
    // places one (whole position) if there is none.
    async setStopLoss(symbol, stopLoss) {
      const live = (await this.getPositions())[symbol];
      if (!live) throw new Error(`no ${symbol} position on OKX`);
      const mark = await this.getMarkPrice(symbol);
      if ((mark - stopLoss) * live.bias <= 0) throw new Error(`stop ${stopLoss} is on the wrong side of the mark price ${mark}`);
      const current = await stopOrders(symbol);
      if (!current.length) return placeStop(symbol, live.bias, stopLoss);
      try {
        for (const o of current) {
          await request('POST', '/api/v5/trade/amend-algos', {
            instId: instIdOf(symbol), algoId: o.algoId, newSlTriggerPx: String(stopLoss), newSlOrdPx: '-1', newSlTriggerPxType: 'mark',
          });
        }
      } catch (err) {
        // Not amendable: replace it (new stop first where OKX allows it, so
        // the position is never left without one).
        try { await placeStop(symbol, live.bias, stopLoss); } catch (e) {
          await request('POST', '/api/v5/trade/cancel-algos', current.map(o => ({ algoId: o.algoId, instId: o.instId })));
          await placeStop(symbol, live.bias, stopLoss);
          return;
        }
        await request('POST', '/api/v5/trade/cancel-algos', current.map(o => ({ algoId: o.algoId, instId: o.instId })));
      }
    },

    async closeMarket({ symbol, bias, qty }) {
      const r = await request('POST', '/api/v5/trade/order', {
        instId: instIdOf(symbol), tdMode: TD_MODE, side: bias === 1 ? 'sell' : 'buy', ...(await posSide(bias)),
        ordType: 'market', sz: await contracts(symbol, qty), reduceOnly: true,
      });
      return r[0].ordId;
    },

    // Cancels pending orders and stop-loss algo orders on one instrument.
    async cancelAll(symbol) {
      const instId = instIdOf(symbol);
      const algos = await stopOrders(symbol);
      if (algos.length) await request('POST', '/api/v5/trade/cancel-algos', algos.map(o => ({ algoId: o.algoId, instId })));
      const open = await request('GET', '/api/v5/trade/orders-pending', { instType: 'SWAP', instId });
      if (open.length) await request('POST', '/api/v5/trade/cancel-batch-orders', open.map(o => ({ instId, ordId: o.ordId })));
    },

    // Funding payments on USDT swaps since startTime (bills type 8, last 7
    // days). amount: > 0 received, < 0 paid.
    async getFundingFees(startTime) {
      const out = [];
      let after = '';
      for (let page = 0; page < 10; page++) {
        const params = { instType: 'SWAP', type: '8', begin: String(Math.max(startTime, Date.now() - 7 * 86400000 + 60000)), limit: '100' };
        if (after) params.after = after;
        const rows = await request('GET', '/api/v5/account/bills', params);
        for (const b of rows) {
          if (!/-USDT-SWAP$/.test(b.instId)) continue;
          out.push({ id: b.billId, symbol: symbolOf(b.instId), amount: num(b.balChg), at: num(b.ts) });
        }
        if (rows.length < 100) break;
        after = rows[rows.length - 1].billId;
      }
      return out;
    },

    // Realized P&L per closing order since startTime (ms), net of fees, like
    // Bybit's closed-pnl: fills are replayed oldest first; opening fills
    // collect their fee, and each closing order gets its fillPnl + its own
    // fee + its share of the opening fee. Fills history covers 3 months.
    async getClosedPnl(symbol, startTime) {
      const instId = instIdOf(symbol);
      const i = await inst(symbol);
      const fills = [];
      let after = '';
      for (let page = 0; page < 20; page++) {
        const params = { instType: 'SWAP', instId, begin: String(startTime), limit: '100' };
        if (after) params.after = after;
        const rows = await request('GET', '/api/v5/trade/fills-history', params);
        fills.push(...rows);
        if (rows.length < 100) break;
        after = rows[rows.length - 1].billId;
      }
      fills.sort((a, b) => num(a.ts) - num(b.ts) || num(a.billId) - num(b.billId));
      let net = 0, openQty = 0, openFee = 0; // position in contracts (signed), fee not yet charged to a close
      const byOrder = new Map();
      for (const f of fills) {
        const sz = num(f.fillSz), signed = f.side === 'buy' ? sz : -sz, fee = num(f.fee); // fee < 0 = charged
        const closing = net !== 0 && Math.sign(signed) !== Math.sign(net);
        if (!closing) {
          net += signed; openQty += sz; openFee += fee;
          continue;
        }
        const share = openQty > 0 ? Math.min(1, sz / openQty) : 0;
        const feeShare = openFee * share;
        openFee -= feeShare; openQty -= Math.min(sz, openQty); // the closed part no longer carries entry fee
        net += signed;
        if (Math.abs(net) < 1e-9) { net = 0; openQty = 0; openFee = 0; }
        const o = byOrder.get(f.ordId) || { orderId: f.ordId, qty: 0, notional: 0, pnl: 0, at: 0 };
        o.qty += sz * i.ctVal;
        o.notional += sz * i.ctVal * num(f.fillPx);
        o.pnl += num(f.fillPnl) + fee + feeShare;
        o.at = Math.max(o.at, num(f.ts));
        byOrder.set(f.ordId, o);
      }
      return [...byOrder.values()].map(o => ({ orderId: o.orderId, qty: +o.qty.toFixed(8), exit: o.notional / o.qty, pnl: o.pnl, at: o.at }));
    },
  };
}

module.exports = { createClient, sign, instIdOf, symbolOf, OkxError };
