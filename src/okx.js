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
// Decimals of a lot / tick step — also for tiny steps JavaScript prints as "1e-8".
function dp(step) {
  let d = 0;
  while (d < 12 && Math.abs(Math.round(step * 10 ** d) - step * 10 ** d) > 1e-9) d++;
  return d;
}

// Signed / public HTTP for both clients. Every call is marked as demo.
function transport({ apiKey, apiSecret, passphrase, base = DEFAULT_BASE, fetchImpl = fetch }) {
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

  return { request, publicGet, base };
}

// Read-only account facts for scripts/okx-check.js (both clients).
function diagnostics(request) {
  return {
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
  };
}

function createSwapClient(opts) {
  const { request, publicGet } = transport(opts);
  // The bot's instrument: BTC-USDT-SWAP by default, or e.g. the USD-margined
  // BTC-USD_UM_XPERP-310328 future (OKX EEA). Other symbols keep the USDT-swap naming.
  const SYMBOL = opts.symbol || 'BTCUSDT';
  const INST = String(opts.instrument || '').trim().toUpperCase() || instIdOf(SYMBOL);
  const idOf = (symbol) => (symbol === SYMBOL ? INST : instIdOf(symbol));
  const symOf = (instId) => (instId === INST ? SYMBOL : symbolOf(instId));
  const TYPE = /-SWAP$/.test(INST) ? 'SWAP' : 'FUTURES';
  const ours = (instId) => instId === INST || /-USDT-SWAP$/.test(instId);
  // Instrument rules, cached per run.
  const instCache = {};
  async function inst(symbol) {
    if (!instCache[symbol]) {
      const i = (await publicGet('/api/v5/public/instruments', { instType: TYPE, instId: idOf(symbol) }))[0];
      if (!i) throw new Error(`${symbol} is not listed on OKX`);
      instCache[symbol] = { ctVal: num(i.ctVal), lotSz: num(i.lotSz), minSz: num(i.minSz), tickSz: num(i.tickSz), settleCcy: i.settleCcy };
    }
    return instCache[symbol];
  }
  // BTC -> contracts string on the lot step.
  async function contracts(symbol, qty) {
    const i = await inst(symbol);
    return String(+(Math.round(qty / i.ctVal / i.lotSz) * i.lotSz).toFixed(dp(i.lotSz)));
  }

  async function marginCcy() {
    if (opts.marginCcy) return String(opts.marginCcy).trim().toUpperCase();
    const settle = (await inst(SYMBOL)).settleCcy || 'USDT';
    return settle === 'USD' ? 'USDC' : settle;
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
      const rows = await request('GET', '/api/v5/trade/orders-algo-pending', { ordType, instType: TYPE, instId: idOf(symbol) });
      for (const r of rows) if (num(r.slTriggerPx)) out.push(r);
    }
    return out;
  }

  async function placeStop(symbol, bias, stopLoss) {
    await request('POST', '/api/v5/trade/order-algo', {
      instId: idOf(symbol), tdMode: TD_MODE, side: bias === 1 ? 'sell' : 'buy', ...(await posSide(bias)),
      ordType: 'conditional', slTriggerPx: String(stopLoss), slOrdPx: '-1', slTriggerPxType: 'mark',
      closeFraction: '1', reduceOnly: true,
    });
  }

  return {
    name: 'okx-demo',
    label: 'OKX',
    instrument: INST,
    marginCcy,

    ...diagnostics(request),

    // Margin balance of the trading account: the instrument's settlement
    // currency (USDT for BTC-USDT-SWAP). USD-settled futures (OKX EEA) are
    // margined in USDC — OKX_MARGIN_CCY can name another.
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
      const ccy = await marginCcy();
      const m = (acct.details || []).find(c => c.ccy === ccy) || {};
      return {
        equity: num(m.eq),
        available: num(m.availEq !== undefined && m.availEq !== '' ? m.availEq : m.availBal),
      };
    },

    // Open positions on the bot's instrument (and USDT swaps), keyed like Bybit ("BTCUSDT"), size in BTC.
    async getPositions() {
      const rows = await request('GET', '/api/v5/account/positions', { instType: TYPE });
      const out = {};
      for (const p of rows) {
        const pos = num(p.pos);
        if (!pos || !ours(p.instId)) continue;
        const symbol = symOf(p.instId);
        const i = await inst(symbol);
        const bias = p.posSide === 'long' ? 1 : p.posSide === 'short' ? -1 : pos > 0 ? 1 : -1;
        out[symbol] = {
          symbol, bias, size: +(Math.abs(pos) * i.ctVal).toFixed(8),
          avgPrice: num(p.avgPx), markPrice: num(p.markPx), unrealisedPnl: num(p.upl), stopLoss: 0,
        };
      }
      // The stop lives in a separate algo order: read it for the bot's coin(s).
      for (const symbol of Object.keys(out)) {
        if (symbol !== SYMBOL) continue;
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
      const r = (await publicGet('/api/v5/public/mark-price', { instType: TYPE, instId: idOf(symbol) }))[0];
      if (!r) throw new Error(`no mark price for ${symbol}`);
      return num(r.markPx);
    },

    async setLeverage(symbol, leverage) {
      await accountConfig();
      await request('POST', '/api/v5/account/set-leverage', { instId: idOf(symbol), lever: String(leverage), mgnMode: TD_MODE });
    },

    // Market entry with the stop-loss attached to the same order, so the
    // position never exists on OKX without a stop.
    async openMarket({ symbol, bias, qty, stopLoss }) {
      const r = await request('POST', '/api/v5/trade/order', {
        instId: idOf(symbol), tdMode: TD_MODE, side: bias === 1 ? 'buy' : 'sell', ...(await posSide(bias)),
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
            instId: idOf(symbol), algoId: o.algoId, newSlTriggerPx: String(stopLoss), newSlOrdPx: '-1', newSlTriggerPxType: 'mark',
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
        instId: idOf(symbol), tdMode: TD_MODE, side: bias === 1 ? 'sell' : 'buy', ...(await posSide(bias)),
        ordType: 'market', sz: await contracts(symbol, qty), reduceOnly: true,
      });
      return r[0].ordId;
    },

    // Cancels pending orders and stop-loss algo orders on one instrument.
    async cancelAll(symbol) {
      const instId = idOf(symbol);
      const algos = await stopOrders(symbol);
      if (algos.length) await request('POST', '/api/v5/trade/cancel-algos', algos.map(o => ({ algoId: o.algoId, instId })));
      const open = await request('GET', '/api/v5/trade/orders-pending', { instType: TYPE, instId });
      if (open.length) await request('POST', '/api/v5/trade/cancel-batch-orders', open.map(o => ({ instId, ordId: o.ordId })));
    },

    // Funding payments on the bot's instrument since startTime (bills type 8, last 7
    // days). amount: > 0 received, < 0 paid.
    async getFundingFees(startTime) {
      const out = [];
      let after = '';
      for (let page = 0; page < 10; page++) {
        const params = { instType: TYPE, type: '8', begin: String(Math.max(startTime, Date.now() - 7 * 86400000 + 60000)), limit: '100' };
        if (after) params.after = after;
        const rows = await request('GET', '/api/v5/account/bills', params);
        for (const b of rows) {
          if (!ours(b.instId)) continue;
          out.push({ id: b.billId, symbol: symOf(b.instId), amount: num(b.balChg), at: num(b.ts) });
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
      const instId = idOf(symbol);
      const i = await inst(symbol);
      const fills = [];
      let after = '';
      for (let page = 0; page < 20; page++) {
        const params = { instType: TYPE, instId, begin: String(startTime), limit: '100' };
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

// ---------------------------------------------------------------------------
// Spot (e.g. BTC-USDC): for accounts that can't trade perpetuals — OKX's EEA
// site has no USDT and no perpetual access for many accounts. Long-only, no
// leverage, no funding. The "position" is what the bot itself bought: it's
// recognised by the bot's own stop-loss order (algoClOrdId starting "btcbot"),
// so other BTC in the account is never sold or counted.
//
//   entry   market buy of the BTC amount (tgtCcy base_ccy), then a
//           stop-loss sell order for exactly what arrived (the buy fee is
//           taken in BTC); if the stop can't be placed the BTC is sold again
//   stop    conditional sell, trigger on the last price, market when hit;
//           trailing amends it
//   P&L     rebuilt from fills: sell proceeds minus the cost of what was
//           bought, fees included on both sides
// Don't trade the same pair by hand on the demo account while the bot holds
// a position: its fills would be counted as the bot's.
const BOT_TAG = 'btcbot';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function createSpotClient(opts) {
  const { request, publicGet } = transport(opts);
  const instId = opts.instrument;
  const [baseCcy, quoteCcy] = instId.split('-');
  const SYMBOL = opts.symbol || 'BTCUSDT';
  let rules = null;
  async function inst() {
    if (!rules) {
      const i = (await publicGet('/api/v5/public/instruments', { instType: 'SPOT', instId }))[0];
      if (!i) throw new Error(`${instId} is not listed on OKX`);
      rules = { lotSz: num(i.lotSz), minSz: num(i.minSz), tickSz: num(i.tickSz) };
    }
    return rules;
  }
  const size = async (qty) => { const i = await inst(); return String(+(Math.floor(qty / i.lotSz + 1e-6) * i.lotSz).toFixed(dp(i.lotSz))); };
  const tag = () => (BOT_TAG + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).slice(0, 32);
  async function last() {
    const t = (await publicGet('/api/v5/market/ticker', { instId }))[0];
    if (!t) throw new Error(`no ticker for ${instId}`);
    return num(t.last);
  }
  async function botStops() {
    const rows = await request('GET', '/api/v5/trade/orders-algo-pending', { ordType: 'conditional', instType: 'SPOT', instId });
    return rows.filter(r => String(r.algoClOrdId || '').startsWith(BOT_TAG) && r.side === 'sell');
  }
  async function placeStop(qty, stopLoss) {
    const r = await request('POST', '/api/v5/trade/order-algo', {
      instId, tdMode: 'cash', side: 'sell', ordType: 'conditional', sz: await size(qty),
      slTriggerPx: String(stopLoss), slOrdPx: '-1', slTriggerPxType: 'last', algoClOrdId: tag(),
    });
    return r[0].algoId;
  }
  let lastEntry = null; // the fill of the entry this process just made (openEntry reads it right away)

  return {
    name: 'okx-demo-spot',
    label: 'OKX',
    spot: true,
    instrument: instId,
    ...diagnostics(request),

    // Quote-currency (e.g. USDC) cash in the trading account.
    async getWallet() {
      const acct = (await request('GET', '/api/v5/account/balance', { ccy: quoteCcy }))[0] || {};
      const q = (acct.details || []).find(c => c.ccy === quoteCcy) || {};
      return { equity: num(q.eq), available: num(q.availBal !== undefined && q.availBal !== '' ? q.availBal : q.availEq) };
    },

    async getPositions() {
      const stops = await botStops();
      if (!stops.length) return {};
      return {
        [SYMBOL]: {
          symbol: SYMBOL, bias: 1, size: +stops.reduce((a, o) => a + num(o.sz), 0).toFixed(8),
          avgPrice: lastEntry ? lastEntry.avgPx : 0, markPrice: await last(), unrealisedPnl: null,
          stopLoss: num(stops[0].slTriggerPx),
        },
      };
    },

    async getInstrument() {
      const i = await inst();
      return { qtyStep: i.lotSz, minOrderQty: i.minSz, minNotional: 0, tickSize: i.tickSz };
    },

    async getMarkPrice() { return last(); },

    async setLeverage() { /* spot: no leverage */ },

    async openMarket({ bias, qty, stopLoss }) {
      if (bias !== 1) throw new Error(`${instId} is spot: the bot can only buy (long-only)`);
      const ordId = (await request('POST', '/api/v5/trade/order', {
        instId, tdMode: 'cash', side: 'buy', ordType: 'market', tgtCcy: 'base_ccy', sz: await size(qty), clOrdId: tag(),
      }))[0].ordId;
      let o = null;
      for (let i = 0; i < 10; i++) {
        o = (await request('GET', '/api/v5/trade/order', { instId, ordId }))[0];
        if (o && ['filled', 'canceled', 'mmp_canceled'].includes(o.state)) break;
        await sleep(300);
      }
      const filled = num(o && o.accFillSz);
      if (!filled) throw new Error(`buy order ${ordId} did not fill (${o ? o.state : 'unknown'})`);
      const net = filled + (o.feeCcy === baseCcy ? num(o.fee) : 0); // the buy fee is taken in BTC
      try {
        await placeStop(net, stopLoss);
      } catch (err) {
        await request('POST', '/api/v5/trade/order', { instId, tdMode: 'cash', side: 'sell', ordType: 'market', sz: await size(net), clOrdId: tag() });
        throw new Error(`stop order failed (${err.message}) — the bought ${baseCcy} was sold again`);
      }
      lastEntry = { avgPx: num(o.avgPx), size: net };
      return ordId;
    },

    async setStopLoss(symbol, stopLoss) {
      const stops = await botStops();
      if (!stops.length) throw new Error(`no ${instId} stop order of the bot on OKX`);
      const px = await last();
      if (px <= stopLoss) throw new Error(`stop ${stopLoss} is not below the price ${px}`);
      try {
        for (const o of stops) {
          await request('POST', '/api/v5/trade/amend-algos', {
            instId, algoId: o.algoId, newSlTriggerPx: String(stopLoss), newSlOrdPx: '-1', newSlTriggerPxType: 'last',
          });
        }
      } catch (err) {
        // Not amendable: place the new stop first, then cancel the old one.
        await placeStop(stops.reduce((a, o) => a + num(o.sz), 0), stopLoss);
        await request('POST', '/api/v5/trade/cancel-algos', stops.map(o => ({ algoId: o.algoId, instId })));
      }
    },

    async closeMarket({ qty }) {
      const r = await request('POST', '/api/v5/trade/order', { instId, tdMode: 'cash', side: 'sell', ordType: 'market', sz: await size(qty), clOrdId: tag() });
      return r[0].ordId;
    },

    // Cancels the bot's own stop and open orders on the pair — nothing else.
    async cancelAll() {
      const stops = await botStops();
      if (stops.length) await request('POST', '/api/v5/trade/cancel-algos', stops.map(o => ({ algoId: o.algoId, instId })));
      const open = (await request('GET', '/api/v5/trade/orders-pending', { instType: 'SPOT', instId }))
        .filter(o => String(o.clOrdId || '').startsWith(BOT_TAG));
      if (open.length) await request('POST', '/api/v5/trade/cancel-batch-orders', open.map(o => ({ instId, ordId: o.ordId })));
    },

    async getFundingFees() { return []; }, // spot: no funding

    // Realized P&L per sell order since startTime: proceeds minus the cost
    // of the BTC sold (bought at the replayed average, fees included).
    async getClosedPnl(symbol, startTime) {
      const fills = [];
      let after = '';
      for (let page = 0; page < 20; page++) {
        const params = { instType: 'SPOT', instId, begin: String(startTime), limit: '100' };
        if (after) params.after = after;
        const rows = await request('GET', '/api/v5/trade/fills-history', params);
        fills.push(...rows);
        if (rows.length < 100) break;
        after = rows[rows.length - 1].billId;
      }
      fills.sort((a, b) => num(a.ts) - num(b.ts) || num(a.billId) - num(b.billId));
      let held = 0, cost = 0;
      const byOrder = new Map();
      for (const f of fills) {
        const sz = num(f.fillSz), px = num(f.fillPx), fee = num(f.fee); // fee < 0 = charged
        if (f.side === 'buy') {
          held += sz + (f.feeCcy === baseCcy ? fee : 0);
          cost += sz * px - (f.feeCcy === quoteCcy ? fee : 0);
          continue;
        }
        if (held <= 1e-12) continue; // not the bot's BTC
        const share = Math.min(1, sz / held), basis = cost * share;
        held -= Math.min(sz, held); cost -= basis;
        const proceeds = sz * px + (f.feeCcy === quoteCcy ? fee : f.feeCcy === baseCcy ? fee * px : 0);
        const o = byOrder.get(f.ordId) || { orderId: f.ordId, qty: 0, notional: 0, pnl: 0, at: 0 };
        o.qty += sz; o.notional += sz * px; o.pnl += proceeds - basis; o.at = Math.max(o.at, num(f.ts));
        byOrder.set(f.ordId, o);
      }
      return [...byOrder.values()].map(o => ({ orderId: o.orderId, qty: +o.qty.toFixed(8), exit: o.notional / o.qty, pnl: o.pnl, at: o.at }));
    },
  };
}

// Perpetual swaps ("-SWAP") and dated / XPERP futures ("-YYMMDD") are
// derivatives; anything else (e.g. BTC-USDC) is a spot pair.
function isSpot(instrument) { return !/-SWAP$|-\d{6}$/.test(String(instrument).toUpperCase()); }

// BTC-USDT-SWAP (default), a future such as BTC-USD_UM_XPERP-310328, or a spot pair such as BTC-USDC.
function createClient(opts) {
  const instrument = String(opts.instrument || '').trim().toUpperCase();
  if (instrument && isSpot(instrument)) return createSpotClient({ ...opts, instrument });
  return createSwapClient({ ...opts, instrument });
}

module.exports = { createClient, isSpot, sign, instIdOf, symbolOf, OkxError };
