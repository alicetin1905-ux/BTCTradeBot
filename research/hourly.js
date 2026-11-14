#!/usr/bin/env node
// Does 1H (or, with TF=1d, daily) data help the learner? Walk-forward, like research/improve.js (Binance spot, BTC + ETH, since 2021).
//   node research/hourly.js MODE=base                 the live learner (4H setups only), retrained every RETRAIN days
//   node research/hourly.js MODE=learn W=0.5          also LEARN from the same setups on 1H candles (weight W, with a
//                                                     1H flag), still trade only the 4H setups
//   node research/hourly.js MODE=trade W=1            learn from both AND trade the 1H setups too (decided at each 1H close)
//   node research/hourly.js MODE=feat                 4H setups, plus the 1H indicators at the 4H close as extra inputs
//   node research/hourly.js MODE=only1h               learn and trade on 1H alone
//   node research/hourly.js MODE=parallel TF=1d   two bots side by side on one balance: the live 4H learner and a 1D learner
//                                                     (its own model and its own slot per coin; at most 4 positions)
//   TF=1d: the same modes with daily candles instead of 1H ("only1h" then means daily alone)
// Common: FROM=2021 RISK=0.025 RETRAIN=7 (days; the live bot retrains every 4H, RETRAIN=7 gave the same result there)
'use strict';
const H = require('../src/history'), L = require('../src/learner'), M = require('../src/model'), F = require('../src/features');
const config = require('../config');
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(k + '=')); return a ? a.split('=')[1] : d; };
const num = (k, d) => +arg(k, d);
const MODE = arg('MODE', 'base'), FROM = Date.UTC(num('FROM', 2021), 0, 1), RISK = num('RISK', config.PORTFOLIO.RISK_PCT / 100);
const RETRAIN = num('RETRAIN', 7) * 864e5, W1 = num('W', 0.5), MAXX = config.PORTFOLIO.MAX_POSITION_X, MAX_OPEN = 2;
const H4 = 144e5, OTHER = arg('TF', '1h'), H1 = { '1h': 36e5, '2h': 72e5, '8h': 288e5, '12h': 432e5, '1d': 864e5 }[OTHER];

(async () => {
  const o = L.defaults({ ...config.LEARN, STOP_ATR: config.STOP_ATR, TRAIL_ATR: config.TRAIL_ATR, MIN_R: num('MINR', config.LEARN.MIN_R) }); // MINR=-99: no learner
  const d4 = await H.loadAll(config.COINS), d1 = {};
  for (const c of config.COINS) d1[c] = { candles: await H.load(c, OTHER), daily: d4[c].daily };
  const A = L.candidates(d4, o), B = L.candidates(d1, o);
  for (const q of A.all) { q.tf = H4; q.x = [...q.x, 0]; }
  for (const q of B.all) { q.tf = H1; q.x = [...q.x, 1]; }
  if (MODE === 'feat') {
    // the 1H indicators (same feature set as 4H) at the 4H candle's close, signed by the side
    const KEEP = L.FEATURES.map(n => F.NAMES.indexOf(n));
    for (const c of config.COINS) {
      const f1 = B.byCoin[c].f, c1 = B.byCoin[c].c;
      let j = -1;
      for (const q of A.all.filter(x => x.coin === c).sort((a, b) => a.t0 - b.t0)) {
        // the last 1H / daily candle that has closed by the 4H candle's close
        while (j + 1 < c1.length && c1[j + 1].t + H1 <= q.t0 + H4) j++;
        const X = j >= 0 && f1.X[j];
        q.x = [...q.x, ...KEEP.map(k => (X ? X[k] * q.side : 0))];
      }
    }
  }
  const learnFrom = MODE === 'base' || MODE === 'feat' ? A.all : MODE === 'only1h' ? B.all : [...A.all, ...B.all];
  const tradeOn = MODE === 'trade' || MODE === 'parallel' ? [...A.all, ...B.all] : MODE === 'only1h' ? B.all : A.all;
  tradeOn.sort((a, b) => (a.t0 + a.tf) - (b.t0 + b.tf));
  const byCoin = { [H4]: A.byCoin, [H1]: B.byCoin };

  const train = (now, tf) => {
    const src = MODE === 'parallel' ? (tf === H1 ? B.all : A.all) : learnFrom;
    const done = src.filter(q => !q.open && q.t1 <= now);
    if (done.length < o.warm) return null;
    const w = done.map(q => Math.pow(0.5, (now - q.t1) / (o.halfLife * H4)) * (q.tf === H1 ? W1 : 1));
    return M.fit(done.map(q => q.x), done.map(q => Math.max(-1.5, Math.min(6, q.R))), w, o.lambda);
  };
  let eq = config.PORTFOLIO.STARTING_BALANCE, peak = eq, mdd = 0;
  const busy = {}, done = [], cache = new Map();
  const settle = (t) => { for (const k of Object.keys(busy)) if (busy[k].t1 <= t) { eq += busy[k].pnl; done.push(busy[k]); delete busy[k]; peak = Math.max(peak, eq); mdd = Math.max(mdd, 1 - eq / peak); } };
  for (const cd of tradeOn) {
    const now = cd.t0 + cd.tf;
    settle(now);
    const slot = MODE === 'parallel' ? cd.tf + cd.coin : cd.coin;
    if (cd.t0 < FROM || busy[slot] || Object.keys(busy).length >= (MODE === 'parallel' ? 4 : MAX_OPEN)) continue;
    const at = Math.floor(now / RETRAIN) * RETRAIN, ck = at + (MODE === 'parallel' ? ':' + cd.tf : '');
    if (!cache.has(ck)) cache.set(ck, train(at, cd.tf));
    const m = cache.get(ck);
    if (!m || M.predict(m, cd.x) < o.minR) continue;
    const bc = byCoin[cd.tf][cd.coin], c = bc.c[cd.i], dist = o.stopAtr * bc.f.atr[cd.i];
    const qty = Math.min(eq * RISK / dist, eq * MAXX / c.c);
    busy[slot] = { ...cd, pnl: qty * dist * cd.R };
  }
  settle(Infinity);
  const gw = done.filter(x => x.pnl > 0).reduce((s, x) => s + x.pnl, 0), gl = -done.filter(x => x.pnl <= 0).reduce((s, x) => s + x.pnl, 0);
  const gR = done.filter(x => x.R > 0).reduce((s, x) => s + x.R, 0), lR = -done.filter(x => x.R <= 0).reduce((s, x) => s + x.R, 0);
  const years = {}; for (const x of done) { const y = new Date(x.t1).getUTCFullYear(); years[y] = (years[y] || 0) + x.R; }
  const n1 = done.filter(x => x.tf === H1).length;
  console.log(`${(process.argv.slice(2).join(' ') || 'MODE=base').padEnd(28)} learn ${String(learnFrom.filter(q => !q.open).length).padStart(5)} setups  ${String(done.length).padStart(4)} trades${n1 ? ' (' + n1 + ' 1H)' : ''}  ${Math.round(done.filter(x => x.pnl > 0).length / done.length * 100)}% won  PF$ ${(gw / gl).toFixed(2)}  PF-R ${(gR / lR).toFixed(2)}  ${Math.round(gR - lR)} R  $2000 → ${Math.round(eq)}  drop ${Math.round(mdd * 100)}%  years ${Object.entries(years).map(([y, r]) => y.slice(2) + ':' + r.toFixed(0)).join(' ')}`);
})().catch(e => { console.error(e); process.exit(1); });
