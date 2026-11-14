#!/usr/bin/env node
// Three ideas to make the learner learn more, each tested walk-forward exactly like research/walkforward.js
// (the model only trains on setups that finished before the moment it decides). See research/LEARNING.md section 7.
//   node research/improve.js MODE=base                     the live settings, as the reference
//   node research/improve.js MODE=memory HL=2190           faster adaptation: a shorter half-life (bars of 4H)
//   node research/improve.js MODE=memory HL=8760 RECENT=540 RBOOST=3   setups of the last RECENT days count RBOOST x more
//   node research/improve.js MODE=size LO=0.5 HI=1.5       position size scaled with the expected R (its rank among the
//                                                          model's past predictions), LO..HI x the risk, on average 1x
//   node research/improve.js MODE=exit TRAILS=3,4,5,7      a model per trailing distance; each setup gets the trail the
//                                                          models expect most from (enter if that is >= MIN_R);
//                                                          RANDOM=<seed> picks the trail at random instead (control)
//   node research/improve.js MODE=guard GUARD=check GMULT=0.5 [WATCH=1]   less risk while the self-check says 'alert'
//   node research/improve.js MODE=guard GUARD=dd DD=0.2 GMULT=0.5         less risk while 20%+ below the peak
//   node research/improve.js MODEL=gbm RETRAIN=30 [SHUFFLE=seed]          boosted trees instead of ridge (see src/gbm.js)
//   PER_COIN=2 MAX_OPEN=4: up to 2 positions per coin at once (the live bot: 1 and 2)
//   OWNW=w: the setups the bot itself traded count w x in the training
// Common: FROM=2021 RISK=0.025 MAXX=2 MAX_OPEN=2
'use strict';
const H = require('../src/history'), L = require('../src/learner'), M = require('../src/model'), G = require('../src/gbm');
const config = require('../config');
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(k + '=')); return a ? a.split('=')[1] : d; };
const num = (k, d) => +arg(k, d);
const MODE = arg('MODE', 'base');
const FROM = Date.UTC(num('FROM', 2021), 0, 1), UNTIL = Date.UTC(num('UNTIL', 2100), 0, 1);
const PER_COIN = num('PER_COIN', 1), RISK = num('RISK', config.PORTFOLIO.RISK_PCT / 100), MAXX = num('MAXX', config.PORTFOLIO.MAX_POSITION_X), MAX_OPEN = num('MAX_OPEN', 2);
const TF = 144e5;

(async () => {
  const base = { ...config.LEARN, STOP_ATR: config.STOP_ATR, TRAIL_ATR: config.TRAIL_ATR, HALF_LIFE_BARS: num('HL', config.LEARN.HALF_LIFE_BARS), MIN_R: num('MINR', config.LEARN.MIN_R), BREAKOUT_N: num('BN', config.LEARN.BREAKOUT_N), ...(arg('SETUPS') ? { SETUPS: arg('SETUPS').split(',') } : {}) };
  const o = L.defaults(base);
  const data = await H.loadAll(config.COINS);
  const TRAILS = MODE === 'exit' ? arg('TRAILS', '3,4,5,7').split(',').map(Number) : [o.trailAtr];
  // one candidate list per trailing distance; the setups are the same, only the exit (R, t1) differs
  const sets = TRAILS.map(tr => L.candidates(data, { ...o, trailAtr: tr }));
  const byCoin = sets[0].byCoin;
  const key = q => q.coin + q.setup + q.i;
  const lists = sets.map(s => s.all.sort((a, b) => a.t0 - b.t0));
  const maps = lists.map(l => new Map(l.map(q => [key(q), q])));
  const all = lists[TRAILS.indexOf(o.trailAtr) >= 0 ? TRAILS.indexOf(o.trailAtr) : 0];
  const RANDOM = num('RANDOM', 0); let seed = RANDOM; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const RECENT = num('RECENT', 0) * 864e5, RBOOST = num('RBOOST', 1);
  // OWNW=w: the setups the bot itself traded count w x in the training (it learns more from its own trades)
  const OWNW = num('OWNW', 1), taken = new Set();

  // MODEL=ridge (live) | inter (ridge + every pairwise product of the features) | gbm (boosted trees, src/gbm.js)
  // RETRAIN=days: retrain at most every N days (the live bot retrains every 4H; gbm is slow, so compare at equal N)
  // SHUFFLE=seed: control test, every setup gets another setup's features (the model then learns from noise)
  const MODEL = arg('MODEL', 'ridge'), RETRAIN = num('RETRAIN', 0) * 864e5;
  const GB = { trees: num('TREES', 150), lr: num('LR', 0.05), depth: num('DEPTH', 2), minLeaf: num('LEAF', 60) };
  const inter = x => { const o2 = x.slice(); for (let a = 0; a < x.length; a++) for (let b = a + 1; b < x.length; b++) o2.push(x[a] * x[b]); return o2; };
  const xOf = q => (MODEL === 'inter' ? (q._xi || (q._xi = inter(q.x))) : q.x);
  if (num('SHUFFLE', 0)) {
    let sd = num('SHUFFLE', 0); const rr = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
    for (const l of lists) { const xs = l.map(q => q.x); for (let i = xs.length - 1; i > 0; i--) { const j = Math.floor(rr() * (i + 1)); [xs[i], xs[j]] = [xs[j], xs[i]]; } l.forEach((q, i) => { q.x = xs[i]; }); }
  }
  const train = (list, now) => {
    const done = list.filter(q => !q.open && q.t1 <= now);
    if (done.length < o.warm) return null;
    const w = done.map(q => Math.pow(0.5, (now - q.t1) / (o.halfLife * TF)) * (RECENT && now - q.t1 < RECENT ? RBOOST : 1) * (OWNW !== 1 && taken.has(key(q)) ? OWNW : 1));
    const y = done.map(q => Math.max(-1.5, Math.min(6, q.R)));
    if (MODEL === 'gbm') return G.fit(done.map(q => q.x), y, w, GB);
    return M.fit(done.map(xOf), y, w, MODEL === 'inter' ? num('IL', 30) : o.lambda);
  };
  const P = (m, q) => (m.gbm ? G.predict(m, q.x) : M.predict(m, xOf(q)));

  let eq = config.PORTFOLIO.STARTING_BALANCE, peak = eq, mdd = 0;
  const busy = {}, done = [], cache = new Map(), preds = [], trailUse = {}; let guarded = 0;
  const settle = (t) => { for (const k of Object.keys(busy)) if (busy[k].t1 <= t) { eq += busy[k].pnl; done.push(busy[k]); delete busy[k]; peak = Math.max(peak, eq); mdd = Math.max(mdd, 1 - eq / peak); } };
  for (const cd of lists[0]) {
    settle(cd.t0);
    // PER_COIN=n: up to n positions per coin at once (the live bot: 1)
    const mine = Object.keys(busy).filter(k => k.split('#')[0] === cd.coin);
    if (cd.t0 < FROM || cd.t0 >= UNTIL || mine.length >= PER_COIN || Object.keys(busy).length >= MAX_OPEN) continue;
    // SAME_SIDE=1: a second position on a coin only in the same direction as the open one (one net position on OKX)
    if (num('SAME_SIDE', 0) && mine.some(k => busy[k].side !== cd.side)) continue;
    const now = cd.t0 + TF, tAt = RETRAIN ? Math.floor(now / RETRAIN) * RETRAIN : now;
    if (!cache.has(tAt)) cache.set(tAt, lists.map(l => train(l, tAt)));
    const models = cache.get(tAt);
    if (models.some(m => !m)) continue;
    // the expected R per trailing distance; pick the best
    let bestK = 0, bestR = -Infinity;
    TRAILS.forEach((tr, k) => { const r = P(models[k], maps[k].get(key(cd))); if (r > bestR) { bestR = r; bestK = k; } });
    if (MODE !== 'exit') { bestK = 0; bestR = P(models[0], cd); }
    // RANDOM=seed: control test, the trail is picked at random (the entry decision stays the model's)
    if (MODE === 'exit' && RANDOM) bestK = Math.floor(rnd() * TRAILS.length);
    const past = preds.slice(); preds.push(bestR);
    if (bestR < o.minR) continue;
    let mult = 1;
    if (MODE === 'guard') {
      // GUARD=check: the self-check (last 150 finished setups, each judged out-of-sample) → GMULT x risk while 'alert'
      //       (WATCH=1 also while 'watch'); GUARD=dd: GMULT x risk while the balance is DD or more below its peak
      const g = arg('GUARD', 'check'), gm = num('GMULT', 0.5);
      if (g === 'dd') { if (1 - eq / peak >= num('DD', 0.2)) mult = gm; }
      else if (g === 'random') { if (rnd() < num('P', 0.25)) { mult = gm; guarded++; } } // control: the same cut on random trades (RANDOM=seed)
      else {
        const fin = lists[0].filter(q => !q.open && q.t1 <= now).sort((x, y) => x.t1 - y.t1).slice(-150);
        if (fin.length === 150) {
          for (const q of fin) if (q._p === undefined) { const at0 = q.t0 + TF, at = RETRAIN ? Math.floor(at0 / RETRAIN) * RETRAIN : at0; if (!cache.has(at)) cache.set(at, lists.map(l => train(l, at))); const m = cache.get(at)[0]; q._p = m ? P(m, q) : null; }
          const tk = fin.filter(q => q._p != null && q._p >= o.minR), sk = fin.filter(q => q._p != null && q._p < o.minR);
          const avg = xs => (xs.length ? xs.reduce((s2, q) => s2 + q.R, 0) / xs.length : 0);
          const ta = avg(tk), gap = ta - avg(sk);
          const st = gap < -0.2 && ta < -0.3 ? 'alert' : gap < 0 ? 'watch' : 'ok';
          if (st === 'alert' || (st === 'watch' && num('WATCH', 0))) { mult = gm; guarded++; }
        }
      }
    }
    if (MODE === 'size') {
      // rank of this expected R among the past ones that cleared MIN_R → LO..HI (average 1x)
      const ok = past.filter(p => p >= o.minR);
      const rank = ok.length >= 30 ? ok.filter(p => p < bestR).length / ok.length : 0.5;
      mult = num('LO', 0.5) + (num('HI', 1.5) - num('LO', 0.5)) * rank;
    }
    let q = maps[bestK].get(key(cd));
    // SPLIT=1: the position in equal parts, one per trailing distance (R the average; busy until the last part closes)
    if (MODE === 'exit' && num('SPLIT', 0)) { const parts = TRAILS.map((_, k) => maps[k].get(key(cd))); q = { ...q, R: parts.reduce((s, p) => s + p.R, 0) / parts.length, t1: Math.max(...parts.map(p => p.t1)) }; }
    const c = byCoin[cd.coin].c[cd.i], dist = o.stopAtr * byCoin[cd.coin].f.atr[cd.i];
    const qty = Math.min(eq * RISK * mult / dist, eq * MAXX / c.c);
    trailUse[TRAILS[bestK]] = (trailUse[TRAILS[bestK]] || 0) + 1;
    let slot = 0; while (busy[cd.coin + '#' + slot]) slot++;
    busy[cd.coin + '#' + slot] = { ...q, pnl: qty * dist * q.R, mult };
    taken.add(key(q));
  }
  settle(Infinity);
  const wins = done.filter(x => x.pnl > 0), gw = wins.reduce((s, x) => s + x.pnl, 0), gl = -done.filter(x => x.pnl <= 0).reduce((s, x) => s + x.pnl, 0);
  const sumR = done.reduce((s, x) => s + x.R, 0), gR = done.filter(x => x.R > 0).reduce((s, x) => s + x.R, 0), lR = -done.filter(x => x.R <= 0).reduce((s, x) => s + x.R, 0);
  const years = {};
  for (const x of done) { const y = new Date(x.t1).getUTCFullYear(); years[y] = (years[y] || 0) + x.R * (x.mult || 1); }
  const label = process.argv.slice(2).join(' ') || 'MODE=base';
  console.log(`${label.padEnd(44)} ${String(done.length).padStart(3)} trades  ${Math.round(wins.length / done.length * 100)}% won  PF$ ${(gw / gl).toFixed(2)}  PF-R ${(gR / lR).toFixed(2)}  ${sumR.toFixed(0).padStart(4)} R  $2000 → ${String(Math.round(eq)).padStart(6)}  drop ${Math.round(mdd * 100)}%  ret/drop ${(Math.log(eq / 2000) / mdd).toFixed(1)}`
    + `  years ${Object.entries(years).map(([y, r]) => y.slice(2) + ':' + r.toFixed(0)).join(' ')}` + (MODE === 'exit' ? `  trails ${JSON.stringify(trailUse)}` : '') + (MODE === 'guard' ? `  guarded ${guarded}` : ''));
})().catch(e => { console.error(e); process.exit(1); });
