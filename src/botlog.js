// The per-coin bot log (state/demo[/<coin>]/log.json) that the dashboard shows on each coin bot's page.
'use strict';

const LOG_MAX = 400;
// One line per 4H close the bot judged (once, on the first full run after the close), plus every entry, stop move, exit
// and error. Newest last; the dashboard shows it per coin.
function logRun(st, events, now, s) {
  const add = (e) => st.log.push({ at: now, ...e });
  if (s && s.t !== (st.meta.lastLoggedCandle || 0)) {
    st.meta = { ...st.meta, lastLoggedCandle: s.t };
    const entered = events.find(e => e.type === 'enter');
    add({
      kind: 'scan', candleT: s.t, close: s.close, trend: s.trend ?? 0, setup: s.setup || null, side: s.setupSide || 0,
      expR: s.expR == null ? null : +(+s.expR).toFixed(3), decision: entered ? 'entered' : (s.wait || (st.position ? 'a position is open' : 'no entry')),
    });
  }
  for (const e of events) {
    if (e.type === 'enter') add({ kind: 'enter', part: e.part || 1, side: e.bias, price: e.entry, stop: e.stop, qty: e.qty, risk: e.riskAmt, riskMult: e.riskMult ?? 1, setup: e.setup || null, expR: e.expR == null ? null : +(+e.expR).toFixed(3) });
    else if (e.type === 'exit' && !/record pending/.test(e.reason)) add({ kind: 'exit', pnl: e.pnl, price: e.price || null, reason: e.reason });
    else if (e.type === 'info' && /^stop trailed/.test(e.reason)) add({ kind: 'trail', text: e.reason });
    else if (e.type === 'error') add({ kind: 'error', text: e.reason });
  }
  if (st.log.length > LOG_MAX) st.log = st.log.slice(-LOG_MAX);
}

module.exports = { logRun, LOG_MAX };
