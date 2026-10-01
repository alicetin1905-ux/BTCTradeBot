// Phone alerts via ntfy (https://ntfy.sh): one push per trade event — entry,
// exit, stop trailed. Subscribe to the topic in the ntfy app to receive them.
//
// Topic: NTFY_TOPIC from the environment / .env, else config.NOTIFY.NTFY_TOPIC;
// NTFY_TOPIC=off turns alerts off. The topic name is effectively the password
// (anyone who knows it can read and post), but everything it carries is also
// on the public dashboard. A failed push is logged and never stops a run.
'use strict';

const config = require('../config');

function px(x) { return (+x).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
function money(x) { return `${x < 0 ? '-' : '+'}$${Math.abs(x).toFixed(2)}`; }

// Turns run events into ntfy messages. Holds, info lines and the "P&L record
// pending" placeholder (followed by the real exit) are left out; a trailed
// stop is sent quietly.
function messagesFor(events, st) {
  const out = [];
  for (const ev of events) {
    if (ev.type === 'enter') {
      const dir = ev.bias === 1 ? 'LONG' : 'SHORT';
      out.push({
        title: `${config.COIN} ${dir} opened @ ${px(ev.entry)}`,
        message: (ev.breakout != null
          ? `4H close ${px(ev.close)} broke the ${config.CHANNEL_N}-candle ${ev.bias === 1 ? 'high' : 'low'} ${px(ev.breakout)}\n`
          : ev.flipFrom == null
            ? `ATLAS score reached ${ev.score > 0 ? '+' : ''}${ev.score} (extreme level ±${config.EXTREME_SCORE}, 4H close ${px(ev.close)})\n`
            : `ATLAS score swung ${ev.flipFrom > 0 ? '+' : ''}${ev.flipFrom} → ${ev.score > 0 ? '+' : ''}${ev.score} within ${config.FLIP_WINDOW * 4}h (4H close ${px(ev.close)})\n`) +
          `Stop ${px(ev.stop)} (trails ${config.TRAIL_ATR}x ATR) · ${ev.qty} ${config.COIN} ($${ev.notional.toFixed(0)}) · loss at stop $${ev.riskAmt.toFixed(0)}`,
        tags: [ev.bias === 1 ? 'chart_with_upwards_trend' : 'chart_with_downwards_trend'],
      });
    } else if (ev.type === 'exit' && !/record pending/.test(ev.reason)) {
      out.push({
        title: `${config.COIN} closed ${money(ev.pnl)}`,
        message: `${ev.reason}${ev.price ? ' @ ' + px(ev.price) : ''}`,
        tags: [ev.pnl >= 0 ? 'white_check_mark' : 'x'],
      });
    } else if (ev.type === 'info' && /^stop trailed/.test(ev.reason)) {
      out.push({ title: `${config.COIN} stop trailed`, message: ev.reason.replace(/^stop trailed /, 'Stop '), tags: ['lock'], priority: 2 });
    } else if (ev.type === 'error') {
      out.push({ title: `${config.COIN} bot error`, message: ev.reason, tags: ['warning'] });
    }
  }
  if (out.length && st) {
    const foot = `\nBalance $${st.account.balance.toFixed(2)}`;
    for (const m of out) m.message += foot;
  }
  return out;
}

function topic() {
  const t = (process.env.NTFY_TOPIC || config.NOTIFY.NTFY_TOPIC || '').trim();
  return /^(off|none|false|0)?$/i.test(t) ? null : t;
}

async function send(events, st, opts) {
  return push(messagesFor(events, st), opts);
}

// Posts ready-made { title, message, tags } messages; returns how many went out.
async function push(messages, { fetchImpl = fetch, log = console.log } = {}) {
  const t = topic();
  if (!t) return 0;
  let sent = 0;
  for (const m of messages) {
    try {
      const res = await fetchImpl(config.NOTIFY.SERVER, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: t, click: config.NOTIFY.CLICK_URL, ...m }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      sent++;
    } catch (err) {
      log(`ntfy push failed (${m.title}): ${err.message}`);
    }
  }
  return sent;
}

module.exports = { send, push, messagesFor, topic };
