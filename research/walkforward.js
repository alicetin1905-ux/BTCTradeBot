#!/usr/bin/env node
// Walk-forward test of the learning strategy with the bot's own code (src/learner.js): at every candidate the
// model is trained only on candidates that had closed before it. Portfolio: one position per coin, at most
// MAX_OPEN at once, RISK of the balance at the 2 ATR stop, position value at most MAXX x the balance.
//   node research/walkforward.js [FROM=2021] [RISK=0.02] [MINR=0] [LEARN=1]
// Uses the cached history in cache/ (src/history.js; run the bot or `node research/walkforward.js` once online).
'use strict';
const H = require('../src/history'), L = require('../src/learner'), M = require('../src/model');
const config = require('../config');
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(k + '=')); return a ? +a.split('=')[1] : d; };
const FROM = Date.UTC(arg('FROM', 2021), 0, 1), RISK = arg('RISK', config.PORTFOLIO.RISK_PCT / 100), LEARN = arg('LEARN', 1);
const MAXX = arg('MAXX', config.PORTFOLIO.MAX_POSITION_X), MAX_OPEN = arg('MAX_OPEN', config.MAX_OPEN_POSITIONS || 2);
const UNTIL = Date.UTC(arg('UNTIL', 2100), 0, 1);

(async () => {
  const o = L.defaults({ ...config.LEARN, STOP_ATR: arg('STOP', config.STOP_ATR), TRAIL_ATR: arg('TRAIL', config.TRAIL_ATR), MIN_R: arg('MINR', config.LEARN.MIN_R),
    BREAKOUT_N: arg('BN', config.LEARN.BREAKOUT_N), HALF_LIFE_BARS: arg('HL', config.LEARN.HALF_LIFE_BARS), LAMBDA: arg('L', config.LEARN.LAMBDA) });
  const data = await H.loadAll(config.COINS);
  const { byCoin, all } = L.candidates(data, o);
  all.sort((a, b) => a.t0 - b.t0);
  let eq = config.PORTFOLIO.STARTING_BALANCE, peak = eq, mdd = 0, model = null, nTrained = -1;
  const busy = {}, done = [];
  const settle = (t) => { for (const k of Object.keys(busy)) if (busy[k].t1 <= t) { eq += busy[k].pnl; done.push(busy[k]); delete busy[k]; peak = Math.max(peak, eq); mdd = Math.max(mdd, 1 - eq / peak); } };
  for (const cd of all) {
    settle(cd.t0);
    if (cd.t0 < FROM || cd.t0 >= UNTIL || busy[cd.coin] || Object.keys(busy).length >= MAX_OPEN) continue;
    const now = cd.t0 + 144e5;
    let expR = null;
    if (LEARN) {
      const n = all.filter(q => !q.open && q.t1 <= now).length;
      if (n !== nTrained) { model = L.train(all, now, o); nTrained = n; }
      if (model) { expR = M.predict(model, cd.x); if (expR < o.minR) continue; }
    }
    const c = byCoin[cd.coin].c[cd.i], dist = o.stopAtr * byCoin[cd.coin].f.atr[cd.i];
    const qty = Math.min(eq * RISK / dist, eq * MAXX / c.c);
    busy[cd.coin] = { ...cd, pnl: qty * dist * cd.R, expR };
  }
  settle(Infinity);
  const wins = done.filter(x => x.pnl > 0), gw = wins.reduce((s, x) => s + x.pnl, 0), gl = -done.filter(x => x.pnl <= 0).reduce((s, x) => s + x.pnl, 0);
  const years = {};
  for (const x of done) { const y = new Date(x.t1).getUTCFullYear(); const r = years[y] || (years[y] = { trades: 0, R: 0 }); r.trades++; r.R += x.R; }
  console.log(`learning ${LEARN ? 'on' : 'off'}, from ${new Date(FROM).toISOString().slice(0, 10)}, risk ${RISK * 100}%: ${done.length} trades, ${Math.round(wins.length / done.length * 100)}% winners, PF ${(gw / gl).toFixed(2)}, ${config.PORTFOLIO.STARTING_BALANCE} → ${Math.round(eq)}, worst drop ${Math.round(mdd * 100)}%`);
  for (const [y, r] of Object.entries(years)) console.log(`  ${y}: ${r.trades} trades, ${r.R >= 0 ? '+' : ''}${r.R.toFixed(1)} R`);
})().catch(e => { console.error(e); process.exit(1); });
