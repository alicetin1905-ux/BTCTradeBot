// Exchange executor — turns the signal into real orders on a demo account:
// OKX Demo Trading (okx.js) or Bybit Demo Trading (bybit.js), both behind the
// same client interface. One BTC position at a time.
//
// Per run:
//   1. Reconcile the tracked position with the exchange: book realized P&L
//      (net of fees) and notice when the exchange stop closed it.
//   2. Full runs only (with fresh 4H candles):
//      - exit signal (a 4H close through the exit channel) -> close at market
//      - trail the stop: best close since entry -/+ TRAIL_ATR x ATR, moved on
//        the exchange only when it tightens
//      - no position and a fresh entry signal (breakout or ATLAS flip) -> market entry with the stop
//        attached in the same order
//
// The stop lives ON the exchange, so it keeps working if this machine goes
// down between runs. Only BTCUSDT is ever read, counted or touched: other
// positions on the same account are left alone.
'use strict';

const config = require('../config');
const signal = require('./signal');

const P = config.PORTFOLIO;
const SYMBOL = config.SYMBOL;
const DAY_MS = 86400000;
let ENTRY_READBACK_MS = 500; // wait between position read-backs after an entry (tests set 0)
const TF_MS = 4 * 3600000;

function floorStep(x, step) { return Math.floor(x / step + 1e-6) * step; }
// Decimals of a lot / tick step — also for tiny steps JavaScript prints as "1e-8".
function dp(step) {
  let d = 0;
  while (d < 12 && Math.abs(Math.round(step * 10 ** d) - step * 10 ** d) > 1e-9) d++;
  return d;
}
function fixStep(x, step) { return +x.toFixed(dp(step)); }
// Stops are rounded away from the price (a hair looser), never through it.
function stopRound(x, tick, bias) {
  const n = bias === 1 ? Math.floor(x / tick + 1e-9) : Math.ceil(x / tick - 1e-9);
  return +(n * tick).toFixed(dp(tick));
}

// Allocation = the capital this bot may use: the configured starting balance
// plus everything it has realized since. Sizing uses the smaller of this and
// the exchange's own equity, so a big demo wallet still trades like the
// configured 2000 USDT account.
function sizingBase(st, wallet) { return Math.max(0, Math.min(st.account.balance, wallet.equity)); }

// Position value for a new trade: loses RISK_PCT % of the base at a stop
// `stopDist` (fraction of the price) away, at most MAX_POSITION_X x the base.
function notionalFor(base, stopDist) {
  if (!(stopDist > 0) || !(base > 0)) return 0;
  return Math.min((base * P.RISK_PCT / 100) / stopDist, base * P.MAX_POSITION_X);
}

function reasonFor(pos, orderId) {
  if (orderId && pos.orders && orderId === pos.orders.close) return pos.closeReason || 'closed at market';
  return pos.trailed ? 'trailing stop' : 'stop';
}

// Pulls closed-pnl records for one position since it opened and appends the
// new ones to the trade log; returns the realized sum added. `until` and
// `skipIds` keep a closed position from claiming records of another trade.
async function recordFills(client, st, pos, events, { until = Infinity, skipIds = [] } = {}) {
  const seen = new Set([...st.seenOrderIds, ...skipIds]);
  const records = await client.getClosedPnl(SYMBOL, pos.openedAt - 60000);
  let added = 0;
  for (const r of records.sort((a, b) => a.at - b.at)) {
    if (seen.has(r.orderId) || r.orderId === (pos.orders && pos.orders.entry)) continue;
    // The bot's own close order is this position's whatever its timestamp.
    if (r.orderId !== (pos.orders && pos.orders.close) && (r.at < pos.openedAt - 60000 || r.at > until)) continue;
    seen.add(r.orderId);
    st.seenOrderIds.push(r.orderId);
    const reason = reasonFor(pos, r.orderId);
    st.trades.push({
      symbol: SYMBOL, bias: pos.bias, entry: pos.entry, exit: r.exit, qty: r.qty, pnl: r.pnl,
      reason, openedAt: pos.openedAt, closedAt: r.at, initialStop: pos.initialStop,
    });
    events.push({ type: 'exit', reason, pnl: r.pnl, price: r.exit });
    st.account.balance += r.pnl;
    added += r.pnl;
  }
  if (st.seenOrderIds.length > 1000) st.seenOrderIds = st.seenOrderIds.slice(-1000);
  return added;
}

function markClosed(st, pos, now) {
  pos.closedDetectedAt = now;
  st.closing.push(pos);
  st.position = null;
}

async function reconcile({ client, st, live, events, now }) {
  // Positions closed earlier whose final closed-pnl record may land late.
  // A record is stamped with its fill time, which is before the bot noticed
  // the close (plus a minute of clock slack); never one of another
  // position's own close orders, and never one after a newer position opened.
  const SLACK_MS = 60000;
  for (const pos of st.closing.slice()) {
    const others = [st.position, ...st.closing].filter(p => p && p !== pos);
    const skipIds = others.map(p => p.orders && p.orders.close).filter(Boolean);
    const newer = others.filter(p => p.openedAt > pos.openedAt).map(p => p.openedAt);
    const until = Math.min(pos.closedDetectedAt + SLACK_MS, ...newer.map(t => t - 1));
    await recordFills(client, st, pos, events, { until, skipIds });
    if (now - pos.closedDetectedAt > DAY_MS) st.closing.splice(st.closing.indexOf(pos), 1);
  }
  const pos = st.position;
  if (!pos) return;
  await recordFills(client, st, pos, events, { skipIds: st.closing.map(p => p.orders && p.orders.close).filter(Boolean) });
  if (!live || live.bias !== pos.bias) {
    await client.cancelAll(SYMBOL);
    markClosed(st, pos, now);
    if (!events.some(e => e.type === 'exit')) events.push({ type: 'exit', reason: 'closed on exchange (P&L record pending)', pnl: 0 });
    return;
  }
  pos.qty = live.size;
  pos.markPrice = live.markPrice;
  // Spot has no exchange-side P&L for the bot's own lot: work it out.
  pos.unrealisedPnl = live.unrealisedPnl != null ? live.unrealisedPnl : (live.markPrice - pos.entry) * pos.bias * live.size;
  pos.exchangeStop = live.stopLoss;
}

async function closeAtMarket(client, st, pos, live, reason, events, now) {
  await client.cancelAll(SYMBOL);
  const id = await client.closeMarket({ symbol: SYMBOL, bias: pos.bias, qty: live.size });
  pos.orders = { ...pos.orders, close: id };
  pos.closeReason = reason;
  events.push({ type: 'info', reason: `${reason} — closed at market` });
  await recordFills(client, st, pos, events);
  markClosed(st, pos, now);
}

// Exit signal and trailing stop for the open position, from the closed 4H
// candles' signal series.
async function manage({ client, st, live, sig, events, now }) {
  const pos = st.position;
  if (!pos || !live) return false;
  const fromT = pos.entryCandleT + TF_MS; // candles closed after the entry candle
  // Exit signal on any 4H close since the last check (a missed run still exits).
  const exitOn = sig.filter(s => s && s.t >= fromT && s.t > (pos.lastExitCheckT || 0))
    .find(s => (pos.bias === 1 ? s.exitLong : s.exitShort));
  const last = sig[sig.length - 1];
  if (last) pos.lastExitCheckT = Math.max(pos.lastExitCheckT || 0, last.t);
  if (exitOn) {
    const why = exitOn.exitLower == null && exitOn.score != null
      ? `exit signal: ATLAS score swung ${exitOn.flipFrom > 0 ? '+' : ''}${exitOn.flipFrom} → ${exitOn.score > 0 ? '+' : ''}${exitOn.score} against the ${pos.bias === 1 ? 'long' : 'short'}`
      : `exit signal: 4H close ${px(exitOn.close)} ${pos.bias === 1 ? `below the ${config.EXIT_N}-candle low ${px(exitOn.exitLower)}` : `above the ${config.EXIT_N}-candle high ${px(exitOn.exitUpper)}`}`;
    await closeAtMarket(client, st, pos, live, why, events, now);
    return true;
  }

  const t = signal.trail({ bias: pos.bias, stop: pos.stop, ext: pos.ext, sig, fromT, trailAtr: config.TRAIL_ATR });
  pos.ext = t.ext;
  const tick = pos.tickSize || 0.1;
  const next = stopRound(t.stop, tick, pos.bias);
  if ((next - pos.stop) * pos.bias < tick * 0.5) return false; // doesn't tighten
  const mark = live.markPrice;
  if (mark && (mark - next) * pos.bias <= 0) {
    // Price is already through the new stop level: it would trigger at once.
    await closeAtMarket(client, st, pos, live, `trailing stop ${px(next)} already passed`, events, now);
    return true;
  }
  try {
    await client.setStopLoss(SYMBOL, next);
    events.push({ type: 'info', reason: `stop trailed ${px(pos.stop)} → ${px(next)}` });
    pos.stop = next;
    pos.trailed = true;
  } catch (err) {
    events.push({ type: 'error', reason: `couldn't trail the stop to ${px(next)} (${err.message}) — retrying next run` });
  }
  return false;
}

function dailyLossHit(st, now) {
  const dayStart = Math.floor(now / DAY_MS) * DAY_MS;
  const today = st.trades.filter(t => t.closedAt >= dayStart).reduce((s, t) => s + t.pnl, 0);
  const startOfDay = st.account.balance - today;
  return today < 0 && -today >= startOfDay * config.EXECUTION.DAILY_LOSS_LIMIT_PCT / 100;
}

// Why a new entry can't happen on this signal, or null. Also used for the
// dashboard's "waiting because" line.
function entryBlock(st, s, now, { halt = false, live = null } = {}) {
  if (!s) return 'not enough candle history yet';
  if (st.position) return 'a position is open';
  if (live) return 'a BTCUSDT position the bot didn\'t open is on the account — left alone';
  if (!s.enter) return `no ${config.STRATEGY === 'atlas-flip' ? 'ATLAS flip' : 'breakout'} on the last 4H close`;
  if (!signal.allowed(s.enter, config.DIRECTION)) return 'short signal, but the bot trades long-only (DIRECTION)';
  if (st.meta && st.meta.lastEntryCandle === s.t) return 'already entered on this 4H candle';
  const ago = now - (s.t + TF_MS);
  if (config.ENTRY_FRESH_MIN != null && ago > config.ENTRY_FRESH_MIN * 60000) return `signal candle closed ${Math.round(ago / 60000)} min ago — entries only within ${config.ENTRY_FRESH_MIN} min of a 4H close`;
  if (halt) return 'trading halted (TRADEBOT_HALT)';
  if (dailyLossHit(st, now)) return `daily loss limit (${config.EXECUTION.DAILY_LOSS_LIMIT_PCT}%) reached — no new entries until 00:00 UTC`;
  return null;
}

async function openEntry({ client, st, live, wallet, s, events, halt, now }) {
  const block = entryBlock(st, s, now, { halt, live });
  if (block) {
    if (s && s.enter) events.push({ type: 'hold', reason: block });
    return;
  }
  const bias = s.enter;
  const base = sizingBase(st, wallet);
  const stopDist = (config.STOP_ATR * s.atr) / s.close;
  let notional = notionalFor(base, stopDist);
  const maxByMargin = wallet.available * 0.95 * P.LEVERAGE;
  if (notional > maxByMargin) {
    events.push({ type: 'info', reason: `size cut to what ${client.label || 'the exchange'}'s free margin allows ($${maxByMargin.toFixed(0)} of $${notional.toFixed(0)})` });
    notional = maxByMargin;
  }
  const inst = await client.getInstrument(SYMBOL);
  const mark = await client.getMarkPrice(SYMBOL);
  const qty = fixStep(floorStep(notional / mark, inst.qtyStep), inst.qtyStep);
  if (qty < inst.minOrderQty || qty * mark < (inst.minNotional || 0)) {
    events.push({ type: 'hold', reason: `size ${qty} BTC is below ${client.label || 'the exchange'}'s minimum order` });
    return;
  }
  const stopLoss = stopRound(mark * (1 - bias * stopDist), inst.tickSize, bias);
  st.meta = { ...st.meta, lastEntryCandle: s.t }; // one attempt per signal candle, even if the order fails

  await client.setLeverage(SYMBOL, P.LEVERAGE);
  const entryId = await client.openMarket({ symbol: SYMBOL, bias, qty, stopLoss });
  // The exchange's position list can lag the fill by a moment: without this
  // retry the bot would lose track of its own trade (stop on the exchange,
  // but no trailing or exit).
  let pos = null;
  for (let i = 0; i < 10 && !pos; i++) {
    pos = (await client.getPositions())[SYMBOL];
    if (!pos && i < 9) await new Promise(r => setTimeout(r, ENTRY_READBACK_MS));
  }
  if (!pos) { events.push({ type: 'error', reason: `entry order ${entryId} sent but no position showed up after 5 s — check the exchange` }); return; }

  const entry = pos.avgPrice;
  st.position = {
    symbol: SYMBOL, exchange: config.MARKET_ID || config.EXCHANGE, bias, entry, qty: pos.size, qtyTotal: pos.size,
    stop: stopLoss, initialStop: stopLoss, ext: s.close, trailed: false,
    entryCandleT: s.t, lastExitCheckT: s.t, openedAt: now, orders: { entry: entryId }, tickSize: inst.tickSize,
    notional: pos.size * entry, margin: (pos.size * entry) / P.LEVERAGE, riskAmt: pos.size * Math.abs(entry - stopLoss),
    atrAtEntry: s.atr, breakout: bias === 1 ? s.upper : s.lower, score: s.score ?? null, flipFrom: s.flipFrom ?? null,
    markPrice: pos.markPrice || entry, unrealisedPnl: pos.unrealisedPnl || 0, exchangeStop: pos.stopLoss || stopLoss,
  };
  events.push({
    type: 'enter', bias, entry, stop: stopLoss, qty: pos.size, notional: pos.size * entry,
    riskAmt: st.position.riskAmt, breakout: st.position.breakout, score: s.score ?? null, flipFrom: s.flipFrom ?? null, close: s.close,
  });
}

// Funding fees on BTCUSDT since the account (re)started are added to the
// balance (paid = negative) and tallied in account.funding and on the open
// position. Tracking only; a failed lookup is retried next sync.
async function recordFunding(client, st, events, now) {
  if (!client.getFundingFees) return;
  const acc = st.account;
  if (!acc.fundingSince) acc.fundingSince = now;
  acc.funding = acc.funding || { total: 0 };
  let rows;
  try { rows = await client.getFundingFees(acc.fundingSince - 60000); acc.fundingError = null; } catch (err) {
    acc.fundingError = err.message;
    events.push({ type: 'info', reason: `funding fees not read (${err.message}) — retrying next sync` });
    return;
  }
  const seen = new Set(st.seenOrderIds);
  for (const r of rows.sort((a, b) => a.at - b.at)) {
    const key = 'funding:' + r.id;
    if (!r.id || seen.has(key) || r.at < acc.fundingSince || r.symbol !== SYMBOL || !r.amount) continue;
    seen.add(key);
    st.seenOrderIds.push(key);
    acc.balance += r.amount;
    acc.funding.total += r.amount;
    if (st.position) st.position.funding = (st.position.funding || 0) + r.amount;
  }
}

// sig: signal.series() of the closed 4H candles (full runs), or null (sync:
// reconcile only — never opens, exits or trails).
async function runExchange({ client, st, sig = null, events, halt = false, now = Date.now() }) {
  let wallet = await client.getWallet();
  let live = (await client.getPositions())[SYMBOL] || null;
  await reconcile({ client, st, live, events, now });
  await recordFunding(client, st, events, now);
  if (sig) {
    if (st.position) {
      const closed = await manage({ client, st, live, sig, events, now });
      if (closed) {
        wallet = await client.getWallet();
        live = (await client.getPositions())[SYMBOL] || null;
      }
    }
    if (!st.position) await openEntry({ client, st, live, wallet, s: sig[sig.length - 1], events, halt, now });
  }
  st.account.exchangeEquity = wallet.equity;
}

// Emergency flatten: cancel every BTCUSDT order and market-close the BTCUSDT
// position, tracked or not.
async function closeAll({ client, st, events, now = Date.now() }) {
  try {
    const live = (await client.getPositions())[SYMBOL];
    await client.cancelAll(SYMBOL);
    if (!live) return;
    const id = await client.closeMarket({ symbol: SYMBOL, bias: live.bias, qty: live.size });
    events.push({ type: 'info', reason: `closed ${live.size} BTC at market` });
    const pos = st.position;
    if (pos) {
      pos.orders = { ...pos.orders, close: id };
      pos.closeReason = 'closed by close-all';
      markClosed(st, pos, now);
    }
  } catch (err) {
    events.push({ type: 'error', reason: err.message });
  }
}

function px(x) { return (+x).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }

function setReadbackMs(ms) { ENTRY_READBACK_MS = ms; } // tests

module.exports = { setReadbackMs, runExchange, closeAll, sizingBase, notionalFor, entryBlock, stopRound, SYMBOL };
