// state/demo/model.json: what the learner learned, written by the lead coin after every full run.
// On the first run after a 4H close (the model's `at` moved on) it also records:
//   newSetups  how many finished setups were added since the previous 4H close (the dashboard's "learned" pulse)
//   learnedAt  when that happened
//   history    the weights after each 4H close (last 180 = 30 days), for the dashboard's weight chart
// and returns the phone alerts for the self-check: once when it turns 'alert', once when it is back to normal.
'use strict';
const fs = require('fs');
const path = require('path');

const HISTORY = 180;

function write(file, model, now) {
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { /* first time */ }
  const fresh = !prev || prev.at !== model.at;
  const history = ((prev && prev.history) || []).slice();
  if (fresh) history.push({ at: model.at, n: model.trainedOn, w: model.weights });
  const out = {
    ...model,
    updatedAt: now,
    learnedAt: fresh ? now : (prev.learnedAt || now),
    newSetups: fresh ? (prev && prev.trainedOn ? model.trainedOn - prev.trainedOn : null) : (prev.newSetups ?? null),
    history: history.slice(-HISTORY),
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 1) + '\n');

  const push = [];
  const was = prev && prev.selfCheck && prev.selfCheck.status, is = model.selfCheck && model.selfCheck.status;
  const c = model.selfCheck;
  if (is === 'alert' && was !== 'alert') {
    push.push({
      title: 'BTC-ETH-BOT · learner check: attention',
      message: `Over the last ${c.n} finished setups the ones the learner would take averaged ${c.takenAvgR.toFixed(2)} R, ` +
        `the ones it would skip ${c.skippedAvgR.toFixed(2)} R. The bot keeps trading by its rules; worth a look (dashboard → bot page).`,
      tags: ['warning'],
    });
  } else if (was === 'alert' && is && is !== 'alert') {
    push.push({ title: 'BTC-ETH-BOT · learner check back to normal', message: `Taken ${c.takenAvgR.toFixed(2)} R vs skipped ${c.skippedAvgR.toFixed(2)} R over the last ${c.n} setups.`, tags: ['white_check_mark'] });
  }
  return push;
}

module.exports = { write, HISTORY };
