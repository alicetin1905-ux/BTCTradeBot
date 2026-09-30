// Daily summary and 4-hourly status pushes.
//   daily  — balance and change since the last summary, realized P&L of the
//            last 24h, win rate, the open position. Sent once a day by the
//            first full run at/after config.NOTIFY.DAILY_SUMMARY_HOUR (local time).
//   status — equity, the open position's live P&L from Bybit and its stop,
//            or where the next breakout would be. Quiet (low priority).
'use strict';

const config = require('../config');

const DAY_MS = 86400000;
const money = (x) => `${x < 0 ? '-' : '+'}$${Math.abs(x).toFixed(2)}`;
const px = (x) => (+x).toLocaleString('en-US', { maximumFractionDigits: 0 });

function localDate(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// One P&L per real position (a close can come in several fills).
function positionsFrom(trades) {
  const g = {};
  for (const t of trades) {
    const k = t.openedAt;
    g[k] = g[k] || { bias: t.bias, entry: t.entry, pnl: 0, closedAt: 0, openedAt: t.openedAt, reason: t.reason, exit: t.exit };
    g[k].pnl += t.pnl;
    if (t.closedAt >= g[k].closedAt) { g[k].closedAt = t.closedAt; g[k].reason = t.reason; g[k].exit = t.exit; }
  }
  return Object.values(g).sort((a, b) => a.closedAt - b.closedAt);
}

function positionLine(p) {
  const u = p.unrealisedPnl || 0;
  return `${p.bias === 1 ? 'Long' : 'Short'} ${p.qty} BTC @ ${px(p.entry)} · ${money(u)} · stop ${px(p.stop)}${p.trailed ? ' (trailed)' : ''}`;
}

function build(st, now) {
  const a = st.account;
  const last = st.summary || {};
  const since = last.balance != null ? a.balance - last.balance : a.balance - a.startingBalance;
  const day = st.trades.filter(t => t.closedAt >= now - DAY_MS).reduce((s, t) => s + t.pnl, 0);
  const pos = positionsFrom(st.trades);
  const wins = pos.filter(p => p.pnl > 0.005).length, losses = pos.filter(p => p.pnl < -0.005).length;
  const lines = [
    `Balance $${a.balance.toFixed(2)} (${money(since)} since ${last.date ? 'yesterday' : 'start'}; started $${a.startingBalance.toFixed(0)})`,
    `Last 24h realized: ${money(day)}`,
    pos.length ? `All trades: ${wins}W / ${losses}L (${Math.round((wins / pos.length) * 100)}% win)` : 'No closed trades yet',
    st.position ? positionLine(st.position) : 'Flat — waiting for a breakout',
  ];
  return { title: `BTC bot daily · ${money(since)}`, message: lines.join('\n'), tags: ['bar_chart'] };
}

// Returns the message if today's summary is due (and marks it sent), else null.
function due(st, now = Date.now()) {
  const today = localDate(now);
  if (new Date(now).getHours() < config.NOTIFY.DAILY_SUMMARY_HOUR) return null;
  if (st.summary && st.summary.date === today) return null;
  const msg = build(st, now);
  st.summary = { date: today, balance: st.account.balance };
  return msg;
}

// True on the runs that send the status push: the first run in every
// NOTIFY.STATUS_EVERY_H-th UTC hour (runs are at :01, right after a candle close).
function statusDue(now = Date.now()) {
  const every = config.NOTIFY.STATUS_EVERY_H || 1;
  return new Date(now).getUTCHours() % every === 0;
}

function status(st) {
  const a = st.account;
  const p = st.position;
  const equity = a.balance + (p ? p.unrealisedPnl || 0 : 0);
  const pct = ((equity / a.startingBalance - 1) * 100).toFixed(1);
  const s = st.signal;
  const lines = [];
  if (p) lines.push(positionLine(p));
  else if (s) {
    lines.push(`Flat · 4H close ${px(s.close)}`);
    lines.push(`Long above ${px(s.upper)} (${(((s.upper / s.close) - 1) * 100).toFixed(1)}% away)` +
      (config.DIRECTION === 'both' ? ` · short below ${px(s.lower)}` : ''));
  }
  lines.push(`Balance $${a.balance.toFixed(2)}`);
  return { title: `BTC bot $${equity.toFixed(2)} (${pct >= 0 ? '+' : ''}${pct}%)`, message: lines.join('\n'), tags: ['clock3'], priority: 2 };
}

module.exports = { due, build, status, statusDue, positionsFrom };
