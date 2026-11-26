'use strict';
process.env.NTFY_TOPIC = 'off';
const test = require('node:test');
const assert = require('node:assert/strict');
const { decide, lastMacCommit } = require('../scripts/backup-guard');

const M = 60000, now = Date.UTC(2026, 10, 21, 10, 7);

test('back-up guard: the newest Mac commit ("Demo …") is found; GitHub\'s own commits are skipped', () => {
  const log = [`${(now - 5 * M) / 1000}\tActions run 2026-11-21T10:02:00Z`, `${(now - 30 * M) / 1000}\tDemo --sync 2026-11-21T09:37:00Z`, `${(now - 35 * M) / 1000}\tDemo run x`].join('\n');
  assert.equal(lastMacCommit(log), now - 30 * M);
  assert.equal(lastMacCommit('123\tWatchdog state'), 0);
});

test('back-up guard: runs when the Mac is quiet 45+ min, says so once, and once when the Mac is back', () => {
  let d = decide({ macAt: now - 5 * M, now, state: {} });
  assert.deepEqual([d.go, d.message], [false, null]);
  assert.equal(decide({ macAt: now - 35 * M, now, state: {} }).go, false); // between two full runs (no syncs commit while flat)
  d = decide({ macAt: now - 50 * M, now, state: {} });
  assert.equal(d.go, true);
  assert.match(d.message.title, /GitHub takes over/);
  assert.equal(d.state.active, true);
  const again = decide({ macAt: now - 55 * M, now: now + 30 * M, state: d.state });
  assert.deepEqual([again.go, again.message], [true, null]);
  const back = decide({ macAt: now + 58 * M, now: now + 60 * M, state: d.state });
  assert.equal(back.go, false);
  assert.match(back.message.title, /the Mac is back/);
  assert.equal(back.state.active, false);
  assert.equal(decide({ macAt: 0, now, state: {} }).go, true); // no Mac commit at all
});
