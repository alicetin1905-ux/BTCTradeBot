#!/usr/bin/env node
// Failure alerts for the GitHub Actions runs (scripts/actions-run.sh): an
// ntfy push when runs start failing, repeated every 6h while they keep
// failing, and an all-clear when they work again. Remembers what it sent in
// state/actions.json.
//
//   node scripts/actions-alert.js <exit code> <log file>
'use strict';

const fs = require('fs');
const path = require('path');
const notify = require('../src/notify');

const FILE = path.join(__dirname, '..', 'state', 'actions.json');
const REPEAT_MS = 6 * 3600000;

// Pure decision so it can be tested: returns { message|null, state }.
function decide({ ok, prev, now, lastLines }) {
  if (ok) {
    if (!prev.failing) return { message: null, state: prev };
    return { message: { title: 'BTC bot runs work again', message: 'The last GitHub Actions run went through.', tags: ['white_check_mark'] }, state: { failing: false } };
  }
  const due = !prev.failing || now - (prev.alertedAt || 0) >= REPEAT_MS;
  const state = { failing: true, since: prev.failing ? prev.since : now, alertedAt: due ? now : prev.alertedAt };
  if (!due) return { message: null, state };
  return {
    message: {
      title: 'BTC bot run failed',
      message: `${lastLines || 'no output'}\nAn open position keeps its stop on OKX. Details: the repo's Actions tab.`,
      tags: ['warning'], priority: 4,
    },
    state,
  };
}

async function main() {
  const [code, log] = process.argv.slice(2);
  let prev = { failing: false };
  try { prev = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { /* first run */ }
  let lastLines = '';
  try {
    lastLines = fs.readFileSync(log, 'utf8').trim().split('\n').filter(l => !/^\s+at /.test(l)).slice(-3).join('\n').slice(0, 500);
  } catch (e) { /* no log */ }
  const r = decide({ ok: code === '0', prev, now: Date.now(), lastLines });
  if (r.message) await notify.push([r.message]);
  if (JSON.stringify(r.state) !== JSON.stringify(prev)) {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(r.state, null, 2) + '\n');
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { decide };
