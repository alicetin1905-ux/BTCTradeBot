// Daily summary and 4-hourly status pushes, for the whole account: this
// process's coin plus the others' last state (st.peers, written by their own
// runs just before — the lead coin runs last).
//   daily  — balance and change since the last summary, realized P&L of the
//            last 24h, win rate, the open positions. Sent once a day by the
//            first full run at/after config.NOTIFY.DAILY_SUMMARY_HOUR (local time).
//   weekly — the last 7 days per coin, once a week (NOTIFY.WEEKLY_REPORT_DAY / _HOUR).
//   status — equity, each coin's open position (live P&L, stop) or its ATLAS
//            score. Quiet (low priority).
'use strict';

const config = require('../config');

const DAY_MS = 86400000;
const money = (x) => `${x < 0 ? '-' : '+'}$${Math.abs(x).toFixed(2)}`;
const px = (x) => require('./format').price(x, 0);

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

function positionLine(p, coin = config.COIN) {
  const u = p.unrealisedPnl || 0;
  return `${coin} ${p.bias === 1 ? 'long' : 'short'} ${p.qty} @ ${px(p.entry)} · ${money(u)} · stop ${px(p.stop)}${p.trailed ? ' (trailed)' : ''}${p.takeProfit ? ` · TP ${px(p.takeProfit)}` : ''}`;
}

// Every coin's { coin, position, signal, trades }: this process's, then the peers'.
function coinsOf(st) {
  return [{ coin: config.COIN, position: st.position, signal: st.signal, trades: st.trades }]
    .concat(Object.entries(st.peers || {}).map(([coin, p]) => ({ coin, position: p.position, signal: p.signal, trades: p.trades || [] })))
    .sort((a, b) => (a.coin === 'BTC' ? -1 : b.coin === 'BTC' ? 1 : a.coin.localeCompare(b.coin)));
}

function build(st, now) {
  const a = st.account;
  const last = st.summary || {};
  const since = last.balance != null ? a.balance - last.balance : a.balance - a.startingBalance;
  const coins = coinsOf(st);
  const allTrades = [].concat(...coins.map(c => c.trades.map(t => ({ ...t, openedAt: c.coin + t.openedAt }))));
  const day = allTrades.filter(t => t.closedAt >= now - DAY_MS).reduce((s, t) => s + t.pnl, 0);
  const pos = positionsFrom(allTrades);
  const wins = pos.filter(p => p.pnl > 0.005).length, losses = pos.filter(p => p.pnl < -0.005).length;
  const lines = [
    `Balance $${a.balance.toFixed(2)} (${money(since)} since ${last.date ? 'yesterday' : 'start'}; started $${a.startingBalance.toFixed(0)})`,
    `Last 24h realized: ${money(day)}`,
    pos.length ? `All trades: ${wins}W / ${losses}L (${Math.round((wins / pos.length) * 100)}% win)` : 'No closed trades yet',
    ...coins.map(c => (c.position ? positionLine(c.position, c.coin) : `${c.coin} flat`)),
  ];
  return { title: `Bot daily · ${money(since)}`, message: lines.join('\n'), tags: ['bar_chart'] };
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

// The weekly report: the last 7 days per coin (positions, wins / losses, P&L), the balance, all trades since start.
function weekly(st, now) {
  const a = st.account;
  const coins = coinsOf(st);
  const from = now - 7 * DAY_MS;
  const wl = (pos) => {
    const w = pos.filter(p => p.pnl > 0.005).length, l = pos.filter(p => p.pnl < -0.005).length;
    return { n: pos.length, w, l, pnl: pos.reduce((s, p) => s + p.pnl, 0) };
  };
  const lines = [];
  let week = [];
  for (const c of coins) {
    const pos = positionsFrom(c.trades).filter(p => p.closedAt >= from);
    week = week.concat(pos);
    const r = wl(pos);
    lines.push(r.n ? `${c.coin}: ${r.n} trade${r.n > 1 ? 's' : ''} · ${r.w}W / ${r.l}L · ${money(r.pnl)}` : `${c.coin}: no trades`);
  }
  const t = wl(week);
  const all = wl([].concat(...coins.map(c => positionsFrom(c.trades))));
  lines.unshift(t.n ? `This week: ${t.n} trade${t.n > 1 ? 's' : ''} · ${t.w}W / ${t.l}L (${Math.round((t.w / t.n) * 100)}% win) · ${money(t.pnl)}` : 'This week: no closed trades');
  lines.push(`Balance $${a.balance.toFixed(2)} (${money(a.balance - a.startingBalance)} since the start, $${a.startingBalance.toFixed(0)})`);
  lines.push(all.n ? `Since the start: ${all.n} trades · ${all.w}W / ${all.l}L (${Math.round((all.w / all.n) * 100)}% win)` : 'Since the start: no closed trades');
  for (const c of coins) if (c.position) lines.push(positionLine(c.position, c.coin));
  return { title: `Bot weekly · ${money(t.pnl)}`, message: lines.join('\n'), tags: ['calendar'] };
}

// Returns the weekly report if it is due (and marks it sent in st.meta.weekly), else null.
function weeklyDue(st, now = Date.now()) {
  const d = new Date(now), N = config.NOTIFY;
  if (N.WEEKLY_REPORT_DAY == null || d.getDay() !== N.WEEKLY_REPORT_DAY || d.getHours() < (N.WEEKLY_REPORT_HOUR || 0)) return null;
  const key = localDate(now);
  if (st.meta && st.meta.weekly === key) return null;
  const msg = weekly(st, now);
  st.meta = { ...(st.meta || {}), weekly: key };
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
  const coins = coinsOf(st);
  const open = coins.reduce((sum, c) => sum + (c.position ? c.position.unrealisedPnl || 0 : 0), 0);
  const equity = a.balance + open;
  const pct = ((equity / a.startingBalance - 1) * 100).toFixed(1);
  const lines = [];
  for (const { coin, position: p, signal: s } of coins) {
    if (p) lines.push(positionLine(p, coin));
    else if (s && s.upper == null) lines.push(`${coin} flat · 4H close ${px(s.close)} · ATLAS ${s.score > 0 ? '+' : ''}${s.score}`);
    else if (s) lines.push(`${coin} flat · 4H close ${px(s.close)} · long above ${px(s.upper)}`);
    else lines.push(`${coin} flat`);
  }
  const X = config.FLIP_SCORE, h = config.FLIP_WINDOW * 4;
  if (coins.some(c => c.signal && c.signal.upper == null)) {
    lines.push(`Long on a swing from −${X} to +${X} within ${h}h` + (config.EXTREME_SCORE ? ` or a score of +${config.EXTREME_SCORE}` : '') + (config.JUMP_SCORE ? ` or a +${config.JUMP_SCORE} jump in one 4H candle` : '') + (config.DIRECTION === 'both' ? ', short on the mirror' : ''));
  }
  lines.push(`Balance $${a.balance.toFixed(2)}`);
  return { title: `Bot $${equity.toFixed(2)} (${pct >= 0 ? '+' : ''}${pct}%)`, message: lines.join('\n'), tags: ['clock3'], priority: 2 };
}

module.exports = { due, build, status, statusDue, positionsFrom, weekly, weeklyDue };
