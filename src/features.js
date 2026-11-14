'use strict';
// Features at each closed 4H candle, all causal (only data up to and including that candle).
// Groups: Atlas (trend / momentum / structure / flow indicators), GlassSphere (taker flow, funding),
// BTC-Halving (200-week MA ratio, halving-cycle phase).

const ema = (v, p) => { const k = 2 / (p + 1), o = new Array(v.length); let e = v[0]; for (let i = 0; i < v.length; i++) { e = i ? v[i] * k + e * (1 - k) : v[0]; o[i] = e; } return o; };
const rma = (v, p) => { const o = new Array(v.length); let e = null, s = 0; for (let i = 0; i < v.length; i++) { if (i < p) { s += v[i]; o[i] = i === p - 1 ? (e = s / p) : null; } else { e = (e * (p - 1) + v[i]) / p; o[i] = e; } } return o; };
const sma = (v, p) => { const o = new Array(v.length).fill(null); let s = 0; for (let i = 0; i < v.length; i++) { s += v[i]; if (i >= p) s -= v[i - p]; if (i >= p - 1) o[i] = s / p; } return o; };

function atr(c, p = 14) {
  const tr = c.map((k, i) => i ? Math.max(k.h - k.l, Math.abs(k.h - c[i - 1].c), Math.abs(k.l - c[i - 1].c)) : k.h - k.l);
  return rma(tr, p);
}
function rsi(v, p = 14) {
  const g = [0], l = [0];
  for (let i = 1; i < v.length; i++) { const d = v[i] - v[i - 1]; g.push(Math.max(d, 0)); l.push(Math.max(-d, 0)); }
  const ag = rma(g, p), al = rma(l, p);
  return v.map((_, i) => ag[i] == null ? 50 : al[i] === 0 ? 100 : 100 - 100 / (1 + ag[i] / al[i]));
}
function adx(c, p = 14) {
  const pdm = [0], ndm = [0], tr = [c[0].h - c[0].l];
  for (let i = 1; i < c.length; i++) {
    const up = c[i].h - c[i - 1].h, dn = c[i - 1].l - c[i].l;
    pdm.push(up > dn && up > 0 ? up : 0); ndm.push(dn > up && dn > 0 ? dn : 0);
    tr.push(Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c)));
  }
  const a = rma(tr, p), sp = rma(pdm, p), sn = rma(ndm, p);
  const pdi = a.map((x, i) => x ? 100 * sp[i] / x : 0), ndi = a.map((x, i) => x ? 100 * sn[i] / x : 0);
  const dx = pdi.map((x, i) => (x + ndi[i]) ? 100 * Math.abs(x - ndi[i]) / (x + ndi[i]) : 0);
  const ad = rma(dx.map(x => x || 0), p);
  return { adx: ad.map(x => x || 0), pdi, ndi };
}
function supertrend(c, p = 10, m = 3) {
  const a = atr(c, p), dir = new Array(c.length).fill(1), line = new Array(c.length).fill(null);
  let up = 0, dn = 0;
  for (let i = 0; i < c.length; i++) {
    const hl = (c[i].h + c[i].l) / 2, A = a[i] || (c[i].h - c[i].l);
    let bu = hl + m * A, bl = hl - m * A;
    if (i) {
      bl = (bl > dn || c[i - 1].c < dn) ? bl : dn;
      bu = (bu < up || c[i - 1].c > up) ? bu : up;
      dir[i] = dir[i - 1] === 1 ? (c[i].c < dn ? -1 : 1) : (c[i].c > up ? 1 : -1);
    }
    up = bu; dn = bl;
    line[i] = dir[i] === 1 ? bl : bu; // the level that flips it
  }
  dir.line = line;
  return dir;
}
const clip = (x, a = 3) => Math.max(-a, Math.min(a, x));

// Halving dates (BTC); the cycle phase is used for every coin (crypto moves with BTC's cycle).
const HALVINGS = [Date.UTC(2012, 10, 28), Date.UTC(2016, 6, 9), Date.UTC(2020, 4, 11), Date.UTC(2024, 3, 20), Date.UTC(2028, 3, 15)];
function cyclePhase(t) {
  let h = HALVINGS[0];
  for (const x of HALVINGS) if (x <= t) h = x;
  return ((t - h) / 864e5) / 1458; // 0..1 over ~4 years
}

const NAMES = [
  'ema_stack', 'px_vs_ema200', 'supertrend', 'adx_di', 'adx_level', 'rsi', 'macd_hist', 'stoch_rsi', 'obv_slope', 'bb_pos',
  'ret_1d', 'ret_1w', 'taker_flow', 'funding_z', 'wma200_ratio', 'cycle_sin', 'cycle_cos',
];

// candles: [{t,o,h,l,c,v,tbv}] 4H; funding: [{t,r}] (8h, any source); daily: [{t,c}] for the 200-week MA.
function build(candles, funding = [], daily = []) {
  const close = candles.map(k => k.c), n = candles.length;
  const e20 = ema(close, 20), e50 = ema(close, 50), e200 = ema(close, 200);
  const A = atr(candles, 14), st = supertrend(candles, 10, 3), dm = adx(candles, 14), r = rsi(close, 14);
  const m12 = ema(close, 12), m26 = ema(close, 26), ml = close.map((_, i) => m12[i] - m26[i]), msig = ema(ml, 9);
  // Stoch RSI 14/14/3
  const sr = r.map((x, i) => { if (i < 14) return 0.5; let lo = 1e9, hi = -1e9; for (let j = i - 13; j <= i; j++) { lo = Math.min(lo, r[j]); hi = Math.max(hi, r[j]); } return hi > lo ? (x - lo) / (hi - lo) : 0.5; });
  const srk = sma(sr, 3);
  const obv = [0]; for (let i = 1; i < n; i++) obv.push(obv[i - 1] + (close[i] > close[i - 1] ? 1 : close[i] < close[i - 1] ? -1 : 0) * (candles[i].v || 0));
  const b20 = sma(close, 20);
  const sd = close.map((_, i) => { if (i < 19) return null; let s = 0; for (let j = i - 19; j <= i; j++) s += (close[j] - b20[i]) ** 2; return Math.sqrt(s / 20); });
  const tk = candles.map(k => k.v ? k.tbv / k.v - 0.5 : 0), tk6 = sma(tk, 6), tk90 = sma(tk, 540);
  // funding: last value known at the candle's close, z-score over the trailing 90 days
  let fi = 0; const fr = new Array(n).fill(null);
  for (let i = 0; i < n; i++) { const T = candles[i].t + 144e5; while (fi < funding.length && funding[fi].t <= T) fi++; fr[i] = fi ? funding[fi - 1].r : null; }
  const fz = fr.map((x, i) => {
    if (x == null || i < 60) return 0; let s = 0, s2 = 0, m = 0;
    for (let j = Math.max(0, i - 540); j <= i; j++) if (fr[j] != null) { s += fr[j]; s2 += fr[j] ** 2; m++; }
    const mu = s / m, v = s2 / m - mu * mu; let rec = 0, rn = 0; for (let j = Math.max(0, i - 5); j <= i; j++) if (fr[j] != null) { rec += fr[j]; rn++; }
    return v > 0 ? clip((rec / rn - mu) / Math.sqrt(v)) : 0;
  });
  // 200-week MA from daily closes (weekly sampled = 1400 daily closes)
  let di = 0; const wma = new Array(n).fill(0), wmaPx = new Array(n).fill(null);
  const dc = daily.map(d => d.c), dsum = [0]; for (const x of dc) dsum.push(dsum.at(-1) + x);
  for (let i = 0; i < n; i++) {
    const T = candles[i].t + 144e5; while (di < daily.length && daily[di].t + 864e5 <= T) di++;
    if (di >= 1400) { const ma = (dsum[di] - dsum[di - 1400]) / 1400; wma[i] = clip(Math.log(close[i] / ma), 2); wmaPx[i] = ma; }
    else if (di >= 200) { const ma = (dsum[di] - dsum[di - 200]) / 200; wma[i] = clip(Math.log(close[i] / ma) * 1.5, 2); }
  }
  const X = new Array(n).fill(null);
  for (let i = 210; i < n; i++) {
    const a = A[i], p = close[i]; if (!a) continue;
    const stack = e20[i] > e50[i] && e50[i] > e200[i] ? 1 : e20[i] < e50[i] && e50[i] < e200[i] ? -1 : 0;
    const ph = cyclePhase(candles[i].t) * 2 * Math.PI;
    X[i] = [
      stack,
      clip((p - e200[i]) / a / 5),
      st[i],
      dm.adx[i] < 20 ? 0 : (dm.pdi[i] > dm.ndi[i] ? 1 : -1),
      clip((dm.adx[i] - 25) / 15),
      (r[i] - 50) / 20,
      clip((ml[i] - msig[i]) / a * 4),
      (srk[i] ?? 0.5) * 2 - 1,
      obv[i] > obv[i - 10] ? 1 : -1,
      sd[i] ? clip((p - b20[i]) / (2 * sd[i])) : 0,
      clip((p - close[i - 6]) / a / 2),
      clip((p - close[i - 42]) / a / 5),
      clip(((tk6[i] ?? 0) - (tk90[i] ?? 0)) * 40),
      fz[i],
      wma[i],
      Math.sin(ph), Math.cos(ph),
    ];
  }
  // Raw indicator values at candle i, for the dashboard (the model uses X).
  const raw = (i) => {
    let hi = -Infinity, lo = Infinity;
    for (let j = Math.max(0, i - 19); j <= i; j++) { hi = Math.max(hi, candles[j].h); lo = Math.min(lo, candles[j].l); }
    return {
      ema20: e20[i], ema50: e50[i], ema200: e200[i], atr: A[i],
      supertrend: st[i], supertrendLine: st.line[i],
      adx: dm.adx[i], pdi: dm.pdi[i], ndi: dm.ndi[i],
      rsi: r[i], macdHist: ml[i] - msig[i], stochK: (srk[i] ?? 0.5) * 100,
      obvUp: obv[i] > obv[i - 10], bbMid: b20[i], bbUpper: sd[i] ? b20[i] + 2 * sd[i] : null, bbLower: sd[i] ? b20[i] - 2 * sd[i] : null,
      ret1d: close[i] / close[i - 6] - 1, ret1w: close[i] / close[i - 42] - 1,
      wma200w: wmaPx[i], cycleDays: Math.round(cyclePhase(candles[i].t) * 1458),
      high20: hi, low20: lo, prevClose: close[i - 1], prevEma50: e50[i - 1],
    };
  };
  // Volatility regime (no direction): ATR as % of the price vs its median over the last year (2,190 4H candles),
  // as a log ratio, clipped to +/-2. A sorted window keeps it fast.
  const regime = new Array(n).fill(0), win = [];
  const ins = (v) => { let lo = 0, hi = win.length; while (lo < hi) { const m = (lo + hi) >> 1; if (win[m] < v) lo = m + 1; else hi = m; } win.splice(lo, 0, v); };
  const del = (v) => { let lo = 0, hi = win.length; while (lo < hi) { const m = (lo + hi) >> 1; if (win[m] < v) lo = m + 1; else hi = m; } if (win[lo] === v) win.splice(lo, 1); };
  const atrp = A.map((a, i) => (a ? a / close[i] : null));
  for (let i = 0; i < n; i++) {
    if (atrp[i] != null) ins(atrp[i]);
    const out = i - 2190;
    if (out >= 0 && atrp[out] != null) del(atrp[out]);
    const med = win.length ? win[win.length >> 1] : null;
    regime[i] = med && atrp[i] ? clip(Math.log(atrp[i] / med), 2) : 0;
  }
  return { X, atr: A, close, e20, e50, e200, raw, regime };
}

module.exports = { build, NAMES, ema, atr, rsi, cyclePhase };
