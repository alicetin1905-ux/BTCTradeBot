// Exchange executor — turns the signal into real orders on a demo account:
// OKX Demo Trading (okx.js) or Bybit Demo Trading (bybit.js), both behind the
// same client interface. Up to MAX_POSITIONS_PER_COIN positions per coin ("parts": st.position, the oldest, and
// st.position2), always on the same side: the exchange nets them into one position, the bot keeps each part's own
// entry, size and (real-price) stop, and the exchange holds one safety stop for the whole.
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
// down between runs. Only this coin's symbol is ever read, counted or touched:
// other positions on the same account are left alone.
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

// Position value for a new trade: loses RISK_PCT % of the base (x mult: the learner's risk guard) at a stop
// `stopDist` (fraction of the price) away, at most MAX_POSITION_X x the base.
function notionalFor(base, stopDist, mult = 1) {
  if (!(stopDist > 0) || !(base > 0)) return 0;
  return Math.min((base * P.RISK_PCT * mult / 100) / stopDist, base * P.MAX_POSITION_X);
}

// ---- parts: up to MAX_POSITIONS_PER_COIN positions on one coin ----
// More than one only with the stop on the real price (each part's stop is watched by the bot; the exchange can hold
// only one stop for the whole position) and the ATR rules.
function perCoin() {
  if (!config.STOP_ON_REAL_PRICE || config.TRADE_MODE === 'fixed') return 1;
  return Math.max(1, Math.floor(config.MAX_POSITIONS_PER_COIN || 1));
}
const partsOf = (st) => [st.position, st.position2].filter(Boolean);
function dropPart(st, pos) {
  if (st.position === pos) { st.position = st.position2 || null; st.position2 = null; } else if (st.position2 === pos) st.position2 = null;
}
// Where the exchange's one stop for the whole position goes: each part's own level (its stop, or with the stop on the
// real price its safety stop: the stop minus its safety gap); with two parts the widest, so no part is closed by a
// demo price spike before its own stop. Capped inside the liquidation price (more size moves it closer).
function wholeStopFor(st, live) {
  const parts = partsOf(st);
  if (!parts.length) return null;
  const b = parts[0].bias, tick = parts[0].tickSize || 0.1;
  let lvl = null;
  for (const p of parts) {
    const l = soft(p) ? p.stop - b * p.emergencyGap : p.stop;
    if (lvl == null || (lvl - l) * b > 0) lvl = l;
  }
  if (live && live.liqPrice > 0 && parts.length > 1) {
    const bound = live.liqPrice + b * LIQ_BUFFER * Math.abs(live.liqPrice - (live.avgPrice || parts[0].entry));
    if ((lvl - bound) * b < 0) lvl = bound;
  }
  return stopRound(lvl, tick, b);
}
// Puts the whole position's stop where wholeStopFor() says (two parts or more only; one part keeps its own logic).
async function syncWholeStop({ client, st, live, events }) {
  const parts = partsOf(st);
  if (parts.length < 2 || !live) return;
  const want = wholeStopFor(st, live), tick = parts[0].tickSize || 0.1;
  const have = live.stopLoss || parts[0].exchangeStop;
  const pending = !!(st.meta && st.meta.wholeStopPending);
  if (want == null || (!pending && have && Math.abs(want - have) < tick * 0.5)) { for (const p of parts) p.exchangeStop = have || want; return; }
  try {
    if (client.ensureWholeStop) await client.ensureWholeStop(SYMBOL, want); else await client.setStopLoss(SYMBOL, want);
    for (const p of parts) p.exchangeStop = want;
    if (st.meta) delete st.meta.wholeStopPending;
    events.push({ type: 'info', reason: `OKX safety stop for the whole ${config.COIN} position (${parts.length} parts) → ${px(want)}` });
  } catch (err) {
    events.push({ type: 'error', reason: `couldn't move the OKX safety stop to ${px(want)} (${err.message}) — retrying next run` });
  }
}

function reasonFor(pos, orderId, exit) {
  if (orderId && pos.orders && orderId === pos.orders.close) return pos.closeReason || 'closed at market';
  // Fixed mode: the exit price says which of the two orders fired.
  if (pos.fixed && pos.takeProfit && exit != null) return Math.abs(exit - pos.takeProfit) < Math.abs(exit - pos.stop) ? 'take profit' : 'stop loss';
  // Stop on the real price: a close the bot didn't send was the exchange's safety stop.
  if (pos.emergencyGap > 0 && config.STOP_ON_REAL_PRICE) return 'OKX safety stop';
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
    const reason = reasonFor(pos, r.orderId, r.exit);
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
  dropPart(st, pos);
}

// The whole position closed on the exchange (safety stop, liquidation) while two or more parts were open: each
// closing record the bot didn't send is shared over the parts by size.
async function recordSplit(client, st, parts, events, skipIds) {
  const from = Math.min(...parts.map(p => p.openedAt)) - 60000;
  const seen = new Set([...st.seenOrderIds, ...skipIds]);
  const entries = new Set(parts.map(p => p.orders && p.orders.entry));
  const total = parts.reduce((s, p) => s + (p.qty || 0), 0);
  const records = await client.getClosedPnl(SYMBOL, from);
  for (const r of records.sort((a, b) => a.at - b.at)) {
    if (seen.has(r.orderId) || entries.has(r.orderId) || r.at < from) continue;
    seen.add(r.orderId);
    st.seenOrderIds.push(r.orderId);
    for (const p of parts) {
      const share = total > 0 ? (p.qty || 0) / total : 1 / parts.length, pnl = r.pnl * share, reason = reasonFor(p, r.orderId, r.exit);
      st.trades.push({ symbol: SYMBOL, bias: p.bias, entry: p.entry, exit: r.exit, qty: +(r.qty * share).toFixed(8), pnl, reason, openedAt: p.openedAt, closedAt: r.at, initialStop: p.initialStop });
      events.push({ type: 'exit', reason, pnl, price: r.exit });
      st.account.balance += pnl;
    }
  }
  if (st.seenOrderIds.length > 1000) st.seenOrderIds = st.seenOrderIds.slice(-1000);
}

// An entry whose position showed up after openEntry() gave up waiting (st.meta.pendingEntry): becomes the
// tracked position, with the exchange's own entry price and stop / take-profit, so its exit is booked and shown.
// Not on the exchange (never filled, or filled and already closed): its window goes to st.closing, where any
// closing fill is still booked; then it's forgotten.
const PENDING_GRACE_MS = 10 * 60000;
function adoptPending(st, live, events, now) {
  const p = st.meta && st.meta.pendingEntry;
  if (!p) return;
  if (p.add) return adoptPendingAdd(st, live, events, now, p);
  if (st.position) return;
  if (!live) {
    if (now - p.at < PENDING_GRACE_MS) return;
    st.closing.push({ symbol: SYMBOL, bias: p.bias, entry: 0, openedAt: p.at, orders: { entry: p.orderId }, initialStop: p.stopLoss, takeProfit: p.takeProfit, fixed: p.fixed, closedDetectedAt: now });
    delete st.meta.pendingEntry;
    return;
  }
  if (live.bias !== p.bias) return;
  // with the stop on the real price the exchange holds the safety stop; the position's stop is the one the bot watches
  const entry = live.avgPrice, stop = live.stopLoss || p.stopLoss, tp = live.takeProfit || p.takeProfit;
  st.position = {
    symbol: SYMBOL, exchange: config.MARKET_ID || config.EXCHANGE, bias: p.bias, entry, qty: live.size, qtyTotal: live.size,
    stop, initialStop: stop, takeProfit: tp, fixed: !!p.fixed, ext: p.close || entry, trailed: false,
    entryCandleT: p.candleT, lastExitCheckT: p.candleT, openedAt: p.at, orders: { entry: p.orderId }, tickSize: p.tickSize,
    notional: live.size * entry, margin: (live.size * entry) / P.LEVERAGE, riskAmt: live.size * Math.abs(entry - stop),
    atrAtEntry: p.atr, breakout: null, score: p.score ?? null, flipFrom: p.flipFrom ?? null, jump: !!p.jump,
    markPrice: live.markPrice || entry, unrealisedPnl: live.unrealisedPnl || 0, exchangeStop: live.stopLoss || stop, adopted: true, lastSoftCheckT: now,
  };
  delete st.meta.pendingEntry;
  events.push({ type: 'info', reason: `${config.COIN} ${p.bias === 1 ? 'long' : 'short'} ${live.size} @ ${px(entry)} found on the exchange and taken over (stop ${px(stop)}${tp ? `, take-profit ${px(tp)}` : ''})` });
}
// A second part whose fill showed up late: the exchange's size grew past what the parts hold.
function adoptPendingAdd(st, live, events, now, p) {
  const held = partsOf(st).reduce((s, q) => s + q.qty, 0);
  const extra = live && live.bias === p.bias ? +(live.size - held).toFixed(8) : 0;
  if (!(extra > 0) || !st.position || st.position2) {
    if (now - p.at >= PENDING_GRACE_MS) delete st.meta.pendingEntry;
    return;
  }
  const entry = live.avgPrice > 0 ? (live.avgPrice * live.size - st.position.entry * held) / extra : p.close;
  st.position2 = newPart({ bias: p.bias, entry, qty: extra, stop: p.stopLoss, s: { t: p.candleT, close: p.close, atr: p.atr, setup: p.setup, expR: p.expR, trend: p.trend }, entryId: p.orderId, tick: p.tickSize, now: p.at, live });
  st.position2.adopted = true;
  delete st.meta.pendingEntry;
  events.push({ type: 'info', reason: `${config.COIN} second ${p.bias === 1 ? 'long' : 'short'} ${extra} @ ${px(entry)} found on the exchange and taken over (stop ${px(p.stopLoss)})` });
}

async function reconcile({ client, st, live, events, now }) {
  // Positions closed earlier whose final closed-pnl record may land late.
  // A record is stamped with its fill time, which is before the bot noticed
  // the close (plus a minute of clock slack); never one of another
  // position's own close orders, and never one after a newer position opened.
  const SLACK_MS = 60000;
  for (const pos of st.closing.slice()) {
    const others = [...partsOf(st), ...st.closing].filter(p => p && p !== pos);
    const skipIds = others.map(p => p.orders && p.orders.close).filter(Boolean);
    const newer = others.filter(p => p.openedAt > pos.openedAt).map(p => p.openedAt);
    const until = Math.min(pos.closedDetectedAt + SLACK_MS, ...newer.map(t => t - 1));
    await recordFills(client, st, pos, events, { until, skipIds });
    if (now - pos.closedDetectedAt > DAY_MS) st.closing.splice(st.closing.indexOf(pos), 1);
  }
  const parts = partsOf(st);
  if (!parts.length) return;
  const closingIds = st.closing.map(p => p.orders && p.orders.close).filter(Boolean);
  if (parts.length > 1 && (!live || live.bias !== parts[0].bias)) {
    // the whole position closed on the exchange: its closing records are shared over the parts
    await recordSplit(client, st, parts, events, closingIds);
    await client.cancelAll(SYMBOL);
    for (const p of parts) markClosed(st, p, now);
    if (!events.some(e => e.type === 'exit')) events.push({ type: 'exit', reason: 'closed on exchange (P&L record pending)', pnl: 0 });
    return;
  }
  const pos = parts[0];
  if (parts.length === 1) {
    await recordFills(client, st, pos, events, { skipIds: closingIds });
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
    return;
  }
  // two parts, still open: each keeps its own size; P&L from its own entry
  for (const p of parts) {
    p.markPrice = live.markPrice;
    p.unrealisedPnl = (live.markPrice - p.entry) * p.bias * p.qty;
    p.exchangeStop = live.stopLoss;
  }
}

async function closeAtMarket(client, st, pos, live, reason, events, now) {
  // one part of several: close only its size and keep the whole position's safety stop for the rest
  const others = partsOf(st).filter(p => p !== pos);
  if (!others.length) await client.cancelAll(SYMBOL);
  const id = await client.closeMarket({ symbol: SYMBOL, bias: pos.bias, qty: others.length ? Math.min(pos.qty, live.size) : live.size });
  pos.orders = { ...pos.orders, close: id };
  pos.closeReason = reason;
  events.push({ type: 'info', reason: `${reason} — closed at market` });
  await recordFills(client, st, pos, events);
  markClosed(st, pos, now);
}

// Exit signal and trailing stop for the open position, from the closed 4H
// candles' signal series.
async function manage({ client, st, live, sig, events, now }) {
  const parts = partsOf(st);
  if (!parts.length || !live) return false;
  if (parts.length === 1) return managePart({ client, st, live, sig, events, now, pos: parts[0] });
  let closed = false;
  for (const pos of parts) {
    if (await managePart({ client, st, live, sig, events, now, pos, multi: true })) {
      closed = true;
      live = (await client.getPositions())[SYMBOL] || null;
      if (!live) break;
    }
  }
  if (partsOf(st).length) await syncWholeStop({ client, st, live: live || (await client.getPositions())[SYMBOL] || null, events });
  return closed;
}

// Exit signal and trailing for one part. multi: other parts are open — the exchange stop is the whole position's,
// set after all parts moved (syncWholeStop).
async function managePart({ client, st, live, sig, events, now, pos, multi = false }) {
  // Fixed mode (TRADE_MODE 'fixed'): the stop-loss and take-profit sit on the exchange; nothing to trail, no signal exit.
  if (pos.fixed) return false;
  const fromT = pos.entryCandleT + TF_MS; // candles closed after the entry candle
  // Exit signal on any 4H close since the last check (a missed run still exits).
  const exitOn = sig.filter(s => s && s.t >= fromT && s.t > (pos.lastExitCheckT || 0))
    .find(s => (pos.bias === 1 ? s.exitLong : s.exitShort));
  const last = sig[sig.length - 1];
  if (last) pos.lastExitCheckT = Math.max(pos.lastExitCheckT || 0, last.t);
  if (exitOn) {
    const why = exitOn.exitLower == null && exitOn.score != null
      ? (exitOn.flipFrom == null
        ? `exit signal: ATLAS score reached ${exitOn.score > 0 ? '+' : ''}${exitOn.score} against the ${pos.bias === 1 ? 'long' : 'short'}`
        : `exit signal: ATLAS score swung ${exitOn.flipFrom > 0 ? '+' : ''}${exitOn.flipFrom} → ${exitOn.score > 0 ? '+' : ''}${exitOn.score} against the ${pos.bias === 1 ? 'long' : 'short'}`)
      : `exit signal: 4H close ${px(exitOn.close)} ${pos.bias === 1 ? `below the ${config.EXIT_N}-candle low ${px(exitOn.exitLower)}` : `above the ${config.EXIT_N}-candle high ${px(exitOn.exitUpper)}`}`;
    await closeAtMarket(client, st, pos, live, why, events, now);
    return true;
  }

  const t = signal.trail({ bias: pos.bias, stop: pos.stop, ext: pos.ext, sig, fromT, trailAtr: config.TRAIL_ATR });
  pos.ext = t.ext;
  const tick = pos.tickSize || 0.1;
  const next = stopRound(t.stop, tick, pos.bias);
  if ((next - pos.stop) * pos.bias < tick * 0.5) return false; // doesn't tighten
  // With the stop on the real price, "already passed" is judged on the real price too, not the demo's mark.
  const mark = soft(pos) && pos.realPrice ? pos.realPrice : live.markPrice;
  if (mark && (mark - next) * pos.bias <= 0) {
    // Price is already through the new stop level: it would trigger at once.
    await closeAtMarket(client, st, pos, live, `trailing stop ${px(next)} already passed`, events, now);
    return true;
  }
  if (multi) {
    events.push({ type: 'info', reason: `stop trailed ${px(pos.stop)} → ${px(next)}` + (partsOf(st).length > 1 ? ` (part ${partsOf(st).indexOf(pos) + 1})` : '') });
    pos.stop = next;
    pos.trailed = true;
    return false;
  }
  // On the exchange: the stop itself, or (stop on the real price) the safety stop that keeps its distance behind it.
  const exNext = soft(pos) ? stopRound(next - pos.bias * pos.emergencyGap, tick, pos.bias) : next;
  try {
    if (!soft(pos) || ((exNext - (pos.exchangeStop ?? -pos.bias * Infinity)) * pos.bias) >= tick * 0.5) {
      await client.setStopLoss(SYMBOL, exNext);
      pos.exchangeStop = exNext;
    }
    events.push({ type: 'info', reason: `stop trailed ${px(pos.stop)} → ${px(next)}` + (soft(pos) ? ` (OKX safety stop ${px(exNext)})` : '') });
    pos.stop = next;
    pos.trailed = true;
  } catch (err) {
    events.push({ type: 'error', reason: `couldn't trail the stop to ${px(next)} (${err.message}) — retrying next run` });
  }
  return false;
}

// ---- the stop on the real price (config.STOP_ON_REAL_PRICE) ----
// The position's stop (pos.stop, trailed as always) is watched by the bot on the real market (src/realprice.js) on
// every run and sync; the exchange keeps a safety stop EMERGENCY_STOP_X times as far away, so a demo price spike
// doesn't close the trade but the position is still protected while the bot isn't running.
const soft = (pos) => !!(config.STOP_ON_REAL_PRICE && pos && !pos.fixed && pos.emergencyGap > 0);
const realPrice = { source: require('./realprice') };
function setRealPrice(src) { realPrice.source = src; } // tests

// The safety stop for a position: EMERGENCY_STOP_X times the stop distance from the entry, but always inside the
// liquidation price with a buffer of LIQ_BUFFER of the entry-to-liquidation distance (10x isolated on the OKX demo
// liquidates only ~5% away: ETH 2026-11-09 was liquidated and lost its whole margin). No room, or no liquidation
// price known: null — the normal stop stays on the exchange.
const LIQ_BUFFER = 0.25;
function safetyStopFor(pos, liq) {
  if (!(liq > 0)) return null;
  const tick = pos.tickSize || 0.1, b = pos.bias;
  const dist = Math.abs(pos.entry - (pos.initialStop ?? pos.stop)) * config.EMERGENCY_STOP_X;
  let ex = pos.entry - b * dist;
  const bound = liq + b * LIQ_BUFFER * Math.abs(liq - pos.entry); // between the entry and the liquidation price
  if ((ex - bound) * b < 0) ex = bound;                            // past the bound: pulled back inside it
  ex = stopRound(ex, tick, b);
  if ((pos.stop - ex) * b <= tick) return null;                    // not wider than the stop itself: keep the stop
  return ex;
}

// A position without its safety stop yet (just opened, opened before the switch, or adopted): set it, so the bot
// watches the position's stop on the real price. Needs the exchange's liquidation price (live.liqPrice).
async function toSoftStop({ client, st, live, events }) {
  const parts = partsOf(st);
  if (parts.length > 1) {
    if (!config.STOP_ON_REAL_PRICE || !live || client.spot) return;
    for (const p of parts) {
      if (p.fixed || p.emergencyGap > 0) continue;
      const ex = safetyStopFor(p, live.liqPrice);
      if (ex == null) continue;
      p.emergencyGap = Math.abs(p.stop - ex);
      events.push({ type: 'info', reason: `stop ${px(p.stop)} (part ${parts.indexOf(p) + 1}) now watched on the real price` });
    }
    return syncWholeStop({ client, st, live, events });
  }
  const pos = parts[0];
  if (!config.STOP_ON_REAL_PRICE || !pos || pos.fixed || pos.emergencyGap > 0 || !live || client.spot) return;
  const ex = safetyStopFor(pos, live.liqPrice);
  if (ex == null) return;
  const gap = Math.abs(pos.stop - ex);
  try {
    await client.setStopLoss(SYMBOL, ex);
    pos.emergencyGap = gap;
    pos.exchangeStop = ex;
    events.push({ type: 'info', reason: `stop ${px(pos.stop)} now watched on the real price; OKX keeps a safety stop at ${px(ex)}` });
  } catch (err) {
    events.push({ type: 'error', reason: `couldn't set the OKX safety stop ${px(ex)} (${err.message}) — the exchange stop stays at ${px(pos.exchangeStop ?? pos.stop)}` });
  }
}

// Closes the position when the real market has reached its stop since the last check. Returns true if it closed.
async function checkSoftStop({ client, st, live, events, now }) {
  // with two parts each one's stop is watched here, also a part that got no wider safety level (no room before liquidation)
  const parts = partsOf(st).length > 1 ? partsOf(st).filter(p => !p.fixed) : partsOf(st).filter(soft);
  if (!parts.length || !live) return false;
  const since = Math.max(Math.min(...parts.map(p => p.lastSoftCheckT || p.openedAt)), now - DAY_MS);
  let x;
  try { x = await realPrice.source.extremesSince(config.COIN, since, now); } catch (err) {
    events.push({ type: 'info', reason: `real price not read (${err.message}) — the OKX safety stop ${px(parts[0].exchangeStop)} still protects` });
    return false;
  }
  let closed = false;
  for (const pos of parts) {
    pos.lastSoftCheckT = now;
    pos.realPrice = x.last;
    const touched = pos.bias === 1 ? x.low : x.high;
    if ((touched - pos.stop) * pos.bias > 0) continue;
    if (closed) live = (await client.getPositions())[SYMBOL] || null;
    if (!live) break;
    await closeAtMarket(client, st, pos, live, `${pos.trailed ? 'trailing stop' : 'stop'} ${px(pos.stop)} reached on the real price (${pos.bias === 1 ? 'low' : 'high'} ${px(touched)})` + (parts.length > 1 ? ` (part ${parts.indexOf(pos) + 1})` : ''), events, now);
    closed = true;
  }
  if (closed && partsOf(st).length > 1) await syncWholeStop({ client, st, live: (await client.getPositions())[SYMBOL] || null, events });
  return closed;
}

function dailyLossHit(st, now) {
  const dayStart = Math.floor(now / DAY_MS) * DAY_MS;
  // The daily limit is for the whole account: the other coins' trades count too (st.peers, read-only).
  const all = st.trades.concat(...Object.values(st.peers || {}).map(p => p.trades || []));
  const today = all.filter(t => t.closedAt >= dayStart).reduce((s, t) => s + t.pnl, 0);
  const startOfDay = st.account.balance - today;
  return today < 0 && -today >= startOfDay * config.EXECUTION.DAILY_LOSS_LIMIT_PCT / 100;
}

// Why a new entry can't happen on this signal, or null. Also used for the
// dashboard's "waiting because" line.
function entryBlock(st, s, now, { halt = false, live = null } = {}) {
  if (!s) return 'not enough candle history yet';
  const parts = partsOf(st), max1 = perCoin();
  if (parts.length >= max1) return max1 > 1 ? `${parts.length} ${config.COIN} positions are open (at most ${max1})` : 'a position is open';
  if (live && !parts.length) return `a ${SYMBOL} position the bot didn't open is on the account — left alone`;
  if (s.blocked) return `ATLAS flip, but the 4H close is more than ${config.TREND_BAND_PCT}% from its 200-candle average — skipped`;
  if (!s.enter && s.learning) return s.setup
    ? `${s.setup} ${s.setupSide === 1 ? 'long' : 'short'} setup, but the learner expects ${s.expR >= 0 ? '+' : ''}${(+s.expR).toFixed(2)} R (needs ${config.LEARN.MIN_R >= 0 ? '+' : ''}${config.LEARN.MIN_R}) — skipped`
    : 'no setup on the last 4H close';
  if (!s.enter) return `no ${config.STRATEGY === 'atlas-flip' ? 'ATLAS flip' : config.STRATEGY === 'trend-pullback' ? 'trend pullback' : 'breakout'} on the last 4H close`;
  if (!signal.allowed(s.enter, config.DIRECTION)) return 'short signal, but the bot trades long-only (DIRECTION)';
  if (parts.length && s.enter !== parts[0].bias) return `a ${parts[0].bias === 1 ? 'long' : 'short'} is open — no ${s.enter === 1 ? 'long' : 'short'} next to it (the exchange nets one position per coin)`;
  if (st.meta && st.meta.lastEntryCandle === s.t) return 'already entered on this 4H candle';
  const ago = now - (s.t + TF_MS);
  if (config.ENTRY_FRESH_MIN != null && ago > config.ENTRY_FRESH_MIN * 60000) return `signal candle closed ${Math.round(ago / 60000)} min ago — entries only within ${config.ENTRY_FRESH_MIN} min of a 4H close`;
  if (halt) return 'trading halted (TRADEBOT_HALT)';
  // At most MAX_OPEN_POSITIONS open across the coins (the others' positions: st.peers, read just before this run).
  const max = config.MAX_OPEN_POSITIONS;
  if (max) {
    const open = [];
    for (const [c, p] of Object.entries(st.peers || {})) for (const q of [p && p.position, p && p.position2]) if (q) open.push(c);
    for (const q of parts) if (q) open.push(config.COIN);
    if (open.length >= max) return `${open.length} positions already open (${open.join(', ')}) — at most ${max} at a time`;
  }
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
  // Fixed mode: always FIXED.MARGIN x leverage of position value, stop-loss at -FIXED.SL_USDT and
  // take-profit at +FIXED.TP_USDT of that size (so 500 x 10x = $5000: stop 2% away, target 4%).
  // Spot coins keep the ATR rules (no leverage there).
  const fixed = config.TRADE_MODE === 'fixed' && !client.spot;
  const F = config.FIXED;
  const stopDist = fixed ? F.SL_USDT / (F.MARGIN * P.LEVERAGE) : (config.STOP_ATR * s.atr) / s.close;
  const tpDist = fixed ? F.TP_USDT / (F.MARGIN * P.LEVERAGE) : null;
  const riskMult = fixed ? 1 : (s.riskMult >= 0 && s.riskMult < 1 ? s.riskMult : 1);
  let notional = fixed ? F.MARGIN * P.LEVERAGE : notionalFor(base, stopDist, riskMult);
  const maxByMargin = wallet.available * 0.95 * P.LEVERAGE;
  if (notional > maxByMargin) {
    events.push({ type: 'info', reason: `size cut to what ${client.label || 'the exchange'}'s free margin allows ($${maxByMargin.toFixed(0)} of $${notional.toFixed(0)})` });
    notional = maxByMargin;
  }
  const inst = await client.getInstrument(SYMBOL);
  const mark = await client.getMarkPrice(SYMBOL);
  const qty = fixStep(floorStep(notional / mark, inst.qtyStep), inst.qtyStep);
  if (qty < inst.minOrderQty || qty * mark < (inst.minNotional || 0)) {
    events.push({ type: 'hold', reason: `size ${qty} ${config.COIN} is below ${client.label || 'the exchange'}'s minimum order` });
    return;
  }
  const stopLoss = stopRound(mark * (1 - bias * stopDist), inst.tickSize, bias);
  const takeProfit = fixed ? +(Math.round(mark * (1 + bias * tpDist) / inst.tickSize) * inst.tickSize).toFixed(dp(inst.tickSize)) : null;
  st.meta = { ...st.meta, lastEntryCandle: s.t }; // one attempt per signal candle, even if the order fails
  // The order carries the normal stop; with the stop on the real price it is widened to the safety stop right after
  // the fill, once the exchange shows the position's liquidation price (toSoftStop).
  const exStop = stopLoss;

  await client.setLeverage(SYMBOL, P.LEVERAGE);
  // A second part goes onto the open position (same side): a plain market order, the whole position's safety stop
  // covers it and is moved for it right after (toSoftStop / syncWholeStop).
  const adding = partsOf(st).length > 0 && live && live.bias === bias;
  const before = adding ? live.size : 0;
  const entryId = adding ? await client.addToPosition({ symbol: SYMBOL, bias, qty }) : await client.openMarket({ symbol: SYMBOL, bias, qty, stopLoss: exStop, takeProfit });
  // The exchange's position list can lag the fill by a moment: without this
  // retry the bot would lose track of its own trade (stop on the exchange,
  // but no trailing or exit).
  let pos = null;
  for (let i = 0; i < 10 && !pos; i++) {
    pos = (await client.getPositions())[SYMBOL];
    if (pos && adding && !(pos.size > before + qty * 0.5)) pos = null; // the add hasn't shown yet
    if (!pos && i < 9) await new Promise(r => setTimeout(r, ENTRY_READBACK_MS));
  }
  if (!pos) {
    // OKX can show the position later than the readback (BTC 2026-10-07: filled, but missing for 5 s, then never tracked).
    // Remembered here; adoptPending() takes it over on a later run, or books its P&L if it already closed.
    st.meta.pendingEntry = {
      orderId: entryId, bias, stopLoss, takeProfit, fixed, at: now, candleT: s.t, close: s.close, atr: s.atr,
      tickSize: inst.tickSize, score: s.score ?? null, flipFrom: s.flipFrom ?? null, jump: !!s.jump, pullback: !!s.pullback, trend: s.trend ?? null, setup: s.setup ?? null, expR: s.expR ?? null,
      ...(adding ? { add: true } : {}),
    };
    events.push({ type: 'error', reason: `entry order ${entryId} sent but no position showed up after 5 s — taken over on a later run if it fills` });
    return;
  }

  if (adding) {
    // the stop that came with the first entry covers only that order's size: make it one stop for the whole position
    if (client.ensureWholeStop) {
      try { await client.ensureWholeStop(SYMBOL, pos.stopLoss || live.stopLoss || st.position.exchangeStop); } catch (err) {
        events.push({ type: 'error', reason: `couldn't make the OKX stop cover the whole ${config.COIN} position (${err.message}) — retrying next run` });
        st.meta.wholeStopPending = true;
      }
    }
    // this part's own fill price and size, from how the exchange's average and size moved
    const addQty = +(pos.size - before).toFixed(8);
    const entry = pos.avgPrice > 0 && live.avgPrice > 0 ? (pos.avgPrice * pos.size - live.avgPrice * before) / addQty : mark;
    st.position2 = newPart({ bias, entry, qty: addQty, stop: stopLoss, s, entryId, tick: inst.tickSize, now, live: pos });
    events.push({
      type: 'enter', bias, entry, stop: stopLoss, takeProfit: null, fixed: false, qty: addQty, notional: addQty * entry, part: 2,
      riskAmt: st.position2.riskAmt, breakout: null, score: null, flipFrom: null, jump: false, pullback: false, trend: s.trend ?? null, setup: s.setup ?? null, expR: s.expR ?? null, close: s.close, riskMult, guard: riskMult < 1 ? s.guard || null : null,
    });
    return;
  }

  const entry = pos.avgPrice;
  st.position = {
    symbol: SYMBOL, exchange: config.MARKET_ID || config.EXCHANGE, bias, entry, qty: pos.size, qtyTotal: pos.size,
    stop: stopLoss, initialStop: stopLoss, takeProfit, fixed, ext: s.close, trailed: false,
    entryCandleT: s.t, lastExitCheckT: s.t, openedAt: now, orders: { entry: entryId }, tickSize: inst.tickSize,
    notional: pos.size * entry, margin: (pos.size * entry) / P.LEVERAGE, riskAmt: pos.size * Math.abs(entry - stopLoss),
    atrAtEntry: s.atr, breakout: bias === 1 ? s.upper : s.lower, score: s.score ?? null, flipFrom: s.flipFrom ?? null, jump: !!s.jump, pullback: !!s.pullback, trend: s.trend ?? null, setup: s.setup ?? null, expR: s.expR ?? null,
    markPrice: pos.markPrice || entry, unrealisedPnl: pos.unrealisedPnl || 0, exchangeStop: pos.stopLoss || exStop, lastSoftCheckT: now,
  };
  events.push({
    type: 'enter', bias, entry, stop: stopLoss, takeProfit, fixed, qty: pos.size, notional: pos.size * entry,
    riskAmt: st.position.riskAmt, breakout: st.position.breakout, score: s.score ?? null, flipFrom: s.flipFrom ?? null, jump: !!s.jump, pullback: !!s.pullback, trend: s.trend ?? null, setup: s.setup ?? null, expR: s.expR ?? null, close: s.close, riskMult, guard: riskMult < 1 ? s.guard || null : null,
  });
}

// A part as the bot tracks it (a second part on an open position; the first is built in openEntry / adoptPending).
function newPart({ bias, entry, qty, stop, s, entryId, tick, now, live }) {
  return {
    symbol: SYMBOL, exchange: config.MARKET_ID || config.EXCHANGE, bias, entry, qty, qtyTotal: qty,
    stop, initialStop: stop, takeProfit: null, fixed: false, ext: s.close, trailed: false,
    entryCandleT: s.t, lastExitCheckT: s.t, openedAt: now, orders: { entry: entryId }, tickSize: tick,
    notional: qty * entry, margin: (qty * entry) / P.LEVERAGE, riskAmt: qty * Math.abs(entry - stop),
    atrAtEntry: s.atr, breakout: null, score: null, flipFrom: null, jump: false, pullback: false, trend: s.trend ?? null, setup: s.setup ?? null, expR: s.expR ?? null,
    markPrice: (live && live.markPrice) || entry, unrealisedPnl: 0, exchangeStop: (live && live.stopLoss) || stop, lastSoftCheckT: now,
  };
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

// After a position closed, OKX's positions history has its final realized P&L: fees, funding and — after a
// liquidation — the whole isolated margin lost (ETH 2026-11-09: the fills said -28.39, OKX took -59.15). The bot's
// own booking (from the fills) is compared with it once per position and the difference booked as part of that trade,
// so the bot's balance follows the account. Positions closed in the last few minutes wait a run (late fills).
const SETTLE_WAIT_MS = 10 * 60000;
async function settleWithExchange(client, st, events, now) {
  if (!client.getPositionsHistory || !st.account.startedAt) return;
  let rows;
  try { rows = await client.getPositionsHistory(st.account.startedAt); } catch (err) { return; }
  const seen = new Set(st.seenOrderIds);
  for (const r of rows.sort((a, b) => a.closedAt - b.closedAt)) {
    const key = 'settle:' + r.id;
    if (r.symbol !== SYMBOL || seen.has(key) || now - r.closedAt < SETTLE_WAIT_MS || r.closedAt < st.account.startedAt) continue;
    if (r.type === '1') continue; // a partial close (one part of several): the record of the full close settles them all
    // the bot's trades of this position: every part opened from a few minutes before OKX's open time until it closed
    const mine = st.trades.filter(t => (t.openedAt || 0) > r.openedAt - 5 * 60000 && (t.openedAt || 0) <= r.closedAt);
    if (!mine.length) continue; // not one of the bot's (or not booked yet): leave it
    seen.add(key);
    st.seenOrderIds.push(key);
    const booked = mine.reduce((s, t) => s + t.pnl, 0), diff = +(r.realized - booked).toFixed(6);
    if (Math.abs(diff) < 0.01) continue;
    const liquidated = r.type === '3' || r.type === '4';
    const last = mine[mine.length - 1];
    st.trades.push({
      symbol: SYMBOL, bias: last.bias, entry: last.entry, exit: last.exit, qty: 0, pnl: diff, settlement: true,
      reason: liquidated ? `${last.reason} — liquidated by OKX, rest of the margin lost` : last.reason,
      openedAt: last.openedAt, closedAt: last.closedAt, initialStop: last.initialStop,
    });
    st.account.balance += diff;
    events.push({ type: liquidated ? 'error' : 'info', reason: `OKX settled the ${new Date(r.closedAt).toISOString().slice(0, 16)} position at ${r.realized.toFixed(2)} (fees ${r.fee.toFixed(2)}, funding ${r.funding.toFixed(2)}${liquidated ? ', liquidated' : ''}): ${diff >= 0 ? '+' : ''}${diff.toFixed(2)} booked` });
  }
  if (st.seenOrderIds.length > 1000) st.seenOrderIds = st.seenOrderIds.slice(-1000);
}

// sig: signal.series() of the closed 4H candles (full runs), or null (sync:
// reconcile only — never opens, exits or trails).
async function runExchange({ client, st, sig = null, events, halt = false, now = Date.now() }) {
  let wallet = await client.getWallet();
  let live = (await client.getPositions())[SYMBOL] || null;
  adoptPending(st, live, events, now);
  await reconcile({ client, st, live, events, now });
  await recordFunding(client, st, events, now);
  await settleWithExchange(client, st, events, now);
  // the stop on the real price: checked on every run and sync, before any trailing
  await toSoftStop({ client, st, live, events });
  if (await checkSoftStop({ client, st, live, events, now })) {
    wallet = await client.getWallet();
    live = (await client.getPositions())[SYMBOL] || null;
  }
  if (sig) {
    if (st.position) {
      const closed = await manage({ client, st, live, sig, events, now });
      if (closed) {
        wallet = await client.getWallet();
        live = (await client.getPositions())[SYMBOL] || null;
      }
    }
    const had = partsOf(st).length;
    if (had < perCoin()) {
      await openEntry({ client, st, live, wallet, s: sig[sig.length - 1], events, halt, now });
      // a new position (or part): its safety stop as soon as the exchange shows the liquidation price
      if (partsOf(st).length > had && config.STOP_ON_REAL_PRICE) await toSoftStop({ client, st, live: (await client.getPositions())[SYMBOL] || null, events });
    }
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
    events.push({ type: 'info', reason: `closed ${live.size} ${config.COIN} at market` });
    for (const pos of partsOf(st)) {
      pos.orders = { ...pos.orders, close: id };
      pos.closeReason = 'closed by close-all';
      markClosed(st, pos, now);
    }
  } catch (err) {
    events.push({ type: 'error', reason: err.message });
  }
}

const px = (x) => require('./format').price(x, 1);

function setReadbackMs(ms) { ENTRY_READBACK_MS = ms; } // tests

module.exports = { setReadbackMs, setRealPrice, runExchange, closeAll, sizingBase, notionalFor, entryBlock, stopRound, perCoin, partsOf, wholeStopFor, SYMBOL };
