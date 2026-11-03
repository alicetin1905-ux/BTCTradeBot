#!/usr/bin/env node
// Does the ATLAS page's own 4H score (src/atlasPage.js, copied verbatim from the page) help the bot?
// Walk-forward, same setups, exits, costs and sizing as research/walkforward.js, 1% risk, BTC + ETH, max 2 open.
// The score uses price and volume only (funding / OI / order book / tape have no history), 400 closed 4H candles
// and the closed daily candles, at every setup's entry candle. Scores are cached in cache/atlas-scores.json.
//   node research/atlas_score.js
'use strict';
const fs = require('fs');
const path = require('path');
const H = require('../src/history'), L = require('../src/learner'), M = require('../src/model'), A = require('../src/atlasPage');
const config = require('../config');

const TF = 144e5, DAY = 864e5, CACHE = path.join(__dirname, '..', 'cache', 'atlas-scores.json');

(async () => {
  const o = L.defaults({ ...config.LEARN, STOP_ATR: config.STOP_ATR, TRAIL_ATR: config.TRAIL_ATR });
  const data = await H.loadAll(config.COINS);
  const { byCoin, all } = L.candidates(data, o);
  all.sort((a, b) => a.t0 - b.t0);

  // the ATLAS score at every setup's entry candle
  let cache = {}; try { cache = JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch (e) { /* first run */ }
  const daily = {};
  for (const c of config.COINS) daily[c] = (await H.load(c, '1d')).map(k => ({ t: k.t, o: k.o, h: k.h, l: k.l, c: k.c, v: k.v }));
  let n = 0;
  for (const cd of all) {
    const key = cd.coin + ':' + cd.t0;
    if (key in cache) continue;
    const c = byCoin[cd.coin].c, i = cd.i;
    if (i < 400) { cache[key] = null; continue; }
    const win = c.slice(i - 399, i + 1).map(k => ({ t: k.t, o: k.o, h: k.h, l: k.l, c: k.c, v: k.v }));
    win.push({ ...win[win.length - 1], t: win[win.length - 1].t + TF }); // the "forming" candle the page drops
    const closeT = c[i].t + TF;
    const d = daily[cd.coin].filter(k => k.t + DAY <= closeT).slice(-30);
    d.push({ ...d[d.length - 1], t: d[d.length - 1].t + DAY });           // the forming day: the pivot uses the one before it
    const r = A.analyse({ tf: '240', candles: { '240': win, D: d }, live: c[i].c });
    cache[key] = r ? r.score : null;
    if (++n % 500 === 0) { console.log(`  ${n} scores…`); fs.writeFileSync(CACHE, JSON.stringify(cache)); }
  }
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, JSON.stringify(cache));
  const scoreOf = cd => cache[cd.coin + ':' + cd.t0];

  // variants
  const run = (name, { learn = true, feature = false, gate = null, from = 2021, until = 2100 }) => {
    const FROM = Date.UTC(from, 0, 1), UNTIL = Date.UTC(until, 0, 1);
    const X = cd => (feature ? [...cd.x, (scoreOf(cd) || 0) / 100 * cd.side] : cd.x);
    const pool = all.map(cd => ({ ...cd, x: X(cd) }));
    let eq = config.PORTFOLIO.STARTING_BALANCE, peak = eq, mdd = 0, model = null, nT = -1;
    const busy = {}, done = [];
    const settle = t => { for (const k of Object.keys(busy)) if (busy[k].t1 <= t) { eq += busy[k].pnl; done.push(busy[k]); delete busy[k]; peak = Math.max(peak, eq); mdd = Math.max(mdd, 1 - eq / peak); } };
    for (const cd of pool) {
      settle(cd.t0);
      if (cd.t0 < FROM || cd.t0 >= UNTIL || busy[cd.coin] || Object.keys(busy).length >= (config.MAX_OPEN_POSITIONS || 2)) continue;
      const sc = scoreOf(cd);
      if (gate != null && (sc == null || sc * cd.side < gate)) continue;
      if (learn) {
        const now = cd.t0 + TF, k = pool.filter(q => !q.open && q.t1 <= now).length;
        if (k !== nT) { model = L.train(pool, now, o); nT = k; }
        if (model && M.predict(model, cd.x) < o.minR) continue;
      }
      const c = byCoin[cd.coin].c[cd.i], dist = o.stopAtr * byCoin[cd.coin].f.atr[cd.i];
      const qty = Math.min(eq * config.PORTFOLIO.RISK_PCT / 100 / dist, eq * config.PORTFOLIO.MAX_POSITION_X / c.c);
      busy[cd.coin] = { ...cd, pnl: qty * dist * cd.R };
    }
    settle(Infinity);
    const w = done.filter(x => x.pnl > 0), gw = w.reduce((s, x) => s + x.pnl, 0), gl = -done.filter(x => x.pnl <= 0).reduce((s, x) => s + x.pnl, 0);
    return `${name.padEnd(46)} ${String(done.length).padStart(4)} trades  PF ${(gw / gl).toFixed(2)}  $2,000 → $${Math.round(eq).toLocaleString('en-US').padStart(6)}  worst drop ${Math.round(mdd * 100)}%`;
  };
  const variants = [
    ['Now: learner (setups + model)', {}],
    ['Learner + ATLAS score as an extra input', { feature: true }],
    ['Learner, only if ATLAS agrees (score ≥ 0 our way)', { gate: 0 }],
    ['Learner, only if ATLAS ≥ +25 our way', { gate: 25 }],
    ['No learner: setups when ATLAS ≥ +25 our way', { learn: false, gate: 25 }],
    ['No learner, no filter: setups alone', { learn: false }],
  ];
  for (const [label, from, until] of [['2021 - Oct 2026', 2021, 2100], ['2021 - 2023', 2021, 2024], ['2024 - Oct 2026', 2024, 2100]]) {
    console.log(`\n${label}`);
    for (const [name, v] of variants) console.log('  ' + run(name, { ...v, from, until }));
  }
})().catch(e => { console.error(e); process.exit(1); });
