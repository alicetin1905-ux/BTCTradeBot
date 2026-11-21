#!/usr/bin/env node
// GitHub back-up for when the Mac is asleep or off (.github/workflows/bot.yml, scheduled runs).
// The Mac commits "Demo run …" / "Demo --sync …" every 5 minutes. When its newest such commit is older than
// MAC_STALE_MIN minutes, the Mac is taken to be down and this GitHub run goes ahead (go=true); otherwise it skips.
// Pushes one ntfy note when GitHub takes over and one when the Mac is back. Remembers that in state/backup.json.
//   node scripts/backup-guard.js            (writes go=true|false to $GITHUB_OUTPUT)
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'state', 'backup.json');
const MAC_STALE_MIN = +(process.env.MAC_STALE_MIN || 20);

// The newest Mac commit (subject "Demo …"), in ms, or 0 if none in the fetched history.
function lastMacCommit(log) {
  for (const line of log.split('\n')) {
    const [t, ...rest] = line.split('\t');
    if (/^Demo /.test(rest.join('\t'))) return +t * 1000;
  }
  return 0;
}

// Pure decision (tested): { go, state (next state/backup.json), message|null }.
function decide({ macAt, now, state = {}, staleMin = MAC_STALE_MIN }) {
  const ageMin = macAt ? (now - macAt) / 60000 : Infinity;
  const when = macAt ? new Date(macAt).toLocaleString('nl-NL', { timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short' }) : 'unknown';
  if (ageMin > staleMin) {
    if (state.active) return { go: true, state, message: null };
    return {
      go: true, state: { active: true, since: now, macLastSeen: macAt || null },
      message: { title: 'BTC-ETH-BOT: GitHub takes over', message: `No run from the Mac since ${when} (${isFinite(ageMin) ? Math.round(ageMin) + ' min' : 'long'}). GitHub runs the bot until the Mac is back: full runs at :07 and :37, syncs at :22 and :52.`, tags: ['arrows_counterclockwise'] },
    };
  }
  if (state.active) {
    return {
      go: false, state: { active: false, lastBackup: { from: state.since, to: now } },
      message: { title: 'BTC-ETH-BOT: the Mac is back', message: `The Mac ran again at ${when}; GitHub stops its back-up runs.`, tags: ['white_check_mark'] },
    };
  }
  return { go: false, state, message: null };
}

async function main() {
  let log = '';
  try { log = execSync('git log -n 400 --format=%ct%x09%s', { cwd: ROOT, encoding: 'utf8' }); } catch (e) { /* no history: treat as down */ }
  let state = {};
  try { state = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { /* first time */ }
  const d = decide({ macAt: lastMacCommit(log), now: Date.now(), state });
  console.log(d.go ? `Mac quiet for more than ${MAC_STALE_MIN} min: GitHub runs the bot.` : 'The Mac is running: nothing to do.');
  if (JSON.stringify(d.state) !== JSON.stringify(state)) {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(d.state, null, 2) + '\n');
  }
  if (d.message) { try { await require('../src/notify').push([d.message]); } catch (e) { console.log('ntfy: ' + e.message); } }
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `go=${d.go}\nchanged=${JSON.stringify(d.state) !== JSON.stringify(state)}\n`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { decide, lastMacCommit };
