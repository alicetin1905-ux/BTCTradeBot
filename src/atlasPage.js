// The ATLAS page's own score, copied VERBATIM from alicetin1905-ux/iOSAPP ios/AtlasSuite/Resources/atlas.html
// (the indicators: lines 324-565, the timeframes: 716-721, analyse(): 776-949, fmt: 951-952) and wrapped so it can
// run for any coin and any candle set, in the browser (window.AtlasPage) and in node (research).
// Do not edit the copied parts — copy them again from the page when the page changes.
//
//   AtlasPage.analyse({ tf: '240', candles: { '240': [...], 'D': [...], '15': [...], '60': [...] },
//                       live, ticker, oi: [], ratio, book, tape })  ->  { score, sig, mtf, mtfDir, ... } or null
// candles: {t,o,h,l,c,v} oldest first, the last one still forming (the page drops it). ticker / oi / ratio / book /
// tape are Bybit's v5 shapes, as on the page; leave them out and those flow signals are skipped, as on the page.
(function (root) {
  'use strict';
  function make(state) {
    const sizeFor = () => null; // the page's trade plan isn't used here
const nn = (x) => x !== null && x !== undefined && !Number.isNaN(x);

function sma(v, p) {
  const o = Array(v.length).fill(null); let s = 0;
  for (let i = 0; i < v.length; i++) {
    s += v[i]; if (i >= p) s -= v[i - p];
    if (i >= p - 1) o[i] = s / p;
  } return o;
}
function ema(v, p) {
  const o = Array(v.length).fill(null), k = 2 / (p + 1); let s = 0;
  for (let i = 0; i < v.length; i++) {
    if (i < p - 1) { s += v[i]; continue; }
    if (i === p - 1) { s += v[i]; o[i] = s / p; continue; }
    o[i] = v[i] * k + o[i - 1] * (1 - k);
  } return o;
}
function rma(v, p) {
  const o = Array(v.length).fill(null); let s = 0, n = 0, started = false;
  for (let i = 0; i < v.length; i++) {
    if (!nn(v[i])) continue;
    if (!started) {
      s += v[i]; n++;
      if (n === p) { o[i] = s / p; started = true; }
      continue;
    }
    o[i] = (o[i - 1] * (p - 1) + v[i]) / p;
  } return o;
}
function stdev(v, p) {
  const o = Array(v.length).fill(null), m = sma(v, p);
  for (let i = p - 1; i < v.length; i++) {
    let s = 0; for (let k = i - p + 1; k <= i; k++) s += (v[k] - m[i]) ** 2;
    o[i] = Math.sqrt(s / p);
  } return o;
}
function highest(v, p) {
  const o = Array(v.length).fill(null);
  for (let i = p - 1; i < v.length; i++) { let m = -Infinity; for (let k = i - p + 1; k <= i; k++) m = Math.max(m, v[k]); o[i] = m; }
  return o;
}
function lowest(v, p) {
  const o = Array(v.length).fill(null);
  for (let i = p - 1; i < v.length; i++) { let m = Infinity; for (let k = i - p + 1; k <= i; k++) m = Math.min(m, v[k]); o[i] = m; }
  return o;
}
function linreg(v, p) {
  const o = Array(v.length).fill(null);
  for (let i = p - 1; i < v.length; i++) {
    let sx = 0, sy = 0, sxy = 0, sxx = 0, ok = true;
    for (let k = 0; k < p; k++) {
      const y = v[i - p + 1 + k]; if (!nn(y)) { ok = false; break; }
      sx += k; sy += y; sxy += k * y; sxx += k * k;
    }
    if (!ok) continue;
    const d = p * sxx - sx * sx; if (d === 0) continue;
    const slope = (p * sxy - sx * sy) / d, intercept = (sy - slope * sx) / p;
    o[i] = intercept + slope * (p - 1);
  } return o;
}
function trueRange(c) {
  const o = Array(c.length).fill(null);
  for (let i = 0; i < c.length; i++) {
    o[i] = i === 0 ? c[i].h - c[i].l
      : Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c));
  } return o;
}
const atr = (c, p) => rma(trueRange(c), p);

function rsi(v, p) {
  const g = Array(v.length).fill(null), l = Array(v.length).fill(null);
  for (let i = 1; i < v.length; i++) { const d = v[i] - v[i - 1]; g[i] = Math.max(d, 0); l[i] = Math.max(-d, 0); }
  const ag = rma(g, p), al = rma(l, p), o = Array(v.length).fill(null);
  for (let i = 0; i < v.length; i++) {
    if (!nn(ag[i])) continue;
    o[i] = al[i] === 0 ? 100 : 100 - 100 / (1 + ag[i] / al[i]);
  } return o;
}
function macd(v, f, s, sig) {
  const ef = ema(v, f), es = ema(v, s), line = Array(v.length).fill(null);
  for (let i = 0; i < v.length; i++) if (nn(ef[i]) && nn(es[i])) line[i] = ef[i] - es[i];
  const first = line.findIndex(nn);
  const sl = ema(line.slice(first).map(x => x || 0), sig);
  const signal = Array(first).fill(null).concat(sl);
  const hist = line.map((x, i) => (nn(x) && nn(signal[i])) ? x - signal[i] : null);
  return { line, signal, hist };
}
function adx(c, p) {
  const n = c.length, pdm = Array(n).fill(0), ndm = Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const up = c[i].h - c[i - 1].h, dn = c[i - 1].l - c[i].l;
    pdm[i] = (up > dn && up > 0) ? up : 0;
    ndm[i] = (dn > up && dn > 0) ? dn : 0;
  }
  const tr = rma(trueRange(c), p), sp = rma(pdm, p), sn = rma(ndm, p);
  const pdi = Array(n).fill(null), ndi = Array(n).fill(null), dx = Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (!nn(tr[i]) || tr[i] === 0) continue;
    pdi[i] = 100 * sp[i] / tr[i]; ndi[i] = 100 * sn[i] / tr[i];
    const sum = pdi[i] + ndi[i];
    dx[i] = sum === 0 ? 0 : 100 * Math.abs(pdi[i] - ndi[i]) / sum;
  }
  return { adx: rma(dx, p), pdi, ndi };
}
function supertrend(c, p, mult) {
  const n = c.length, a = atr(c, p), dir = Array(n).fill(null), st = Array(n).fill(null);
  let fu = null, fl = null, prevDir = 1;
  for (let i = 0; i < n; i++) {
    if (!nn(a[i])) continue;
    const basis = (c[i].h + c[i].l) / 2, up = basis + mult * a[i], lo = basis - mult * a[i];
    fu = (fu === null || up < fu || c[i - 1].c > fu) ? up : fu;
    fl = (fl === null || lo > fl || c[i - 1].c < fl) ? lo : fl;
    let d = prevDir;
    if (c[i].c > fu) d = 1; else if (c[i].c < fl) d = -1;
    dir[i] = d; st[i] = d === 1 ? fl : fu; prevDir = d;
  }
  return { dir, st };
}
/* Chandelier Exit (everget), useClose = true */
function chandelier(c, len, mult) {
  const n = c.length, closes = c.map(x => x.c), a = atr(c, len);
  const hh = highest(closes, len), ll = lowest(closes, len);
  const longStop = Array(n).fill(null), shortStop = Array(n).fill(null), dir = Array(n).fill(null);
  let pl = null, ps = null, pd = 1;
  for (let i = 0; i < n; i++) {
    if (!nn(a[i]) || !nn(hh[i])) continue;
    let ls = hh[i] - a[i] * mult, ss = ll[i] + a[i] * mult;
    if (pl !== null) ls = c[i - 1].c > pl ? Math.max(ls, pl) : ls;
    if (ps !== null) ss = c[i - 1].c < ps ? Math.min(ss, ps) : ss;
    let d = pd;
    if (ps !== null && c[i].c > ps) d = 1; else if (pl !== null && c[i].c < pl) d = -1;
    longStop[i] = ls; shortStop[i] = ss; dir[i] = d;
    pl = ls; ps = ss; pd = d;
  }
  return { longStop, shortStop, dir };
}
function zlsma(v, len) {
  const l1 = linreg(v, len), l2 = linreg(l1, len), o = Array(v.length).fill(null);
  for (let i = 0; i < v.length; i++) if (nn(l1[i]) && nn(l2[i])) o[i] = l1[i] + (l1[i] - l2[i]);
  return o;
}
function stochRsi(v, rlen, slen, k, d) {
  const r = rsi(v, rlen), n = v.length, raw = Array(n).fill(null);
  const hi = highest(r.map(x => nn(x) ? x : 0), slen), lo = lowest(r.map(x => nn(x) ? x : 0), slen);
  for (let i = 0; i < n; i++) {
    if (!nn(r[i]) || !nn(hi[i])) continue;
    raw[i] = hi[i] === lo[i] ? 50 : 100 * (r[i] - lo[i]) / (hi[i] - lo[i]);
  }
  const first = raw.findIndex(nn);
  if (first < 0) return { k: raw, d: raw };
  const kk = Array(first).fill(null).concat(sma(raw.slice(first), k));
  const dd = Array(first).fill(null).concat(sma(kk.slice(first).map(x => nn(x) ? x : 0), d));
  return { k: kk, d: dd };
}
function cci(c, p) {
  const tp = c.map(x => (x.h + x.l + x.c) / 3), m = sma(tp, p), o = Array(c.length).fill(null);
  for (let i = p - 1; i < c.length; i++) {
    let dev = 0; for (let k = i - p + 1; k <= i; k++) dev += Math.abs(tp[k] - m[i]);
    dev /= p; o[i] = dev === 0 ? 0 : (tp[i] - m[i]) / (0.015 * dev);
  } return o;
}
function willr(c, p) {
  const hi = highest(c.map(x => x.h), p), lo = lowest(c.map(x => x.l), p), o = Array(c.length).fill(null);
  for (let i = 0; i < c.length; i++) if (nn(hi[i]) && hi[i] !== lo[i]) o[i] = -100 * (hi[i] - c[i].c) / (hi[i] - lo[i]);
  return o;
}
function mfi(c, p) {
  const n = c.length, pos = Array(n).fill(0), neg = Array(n).fill(0), o = Array(n).fill(null);
  const tp = c.map(x => (x.h + x.l + x.c) / 3);
  for (let i = 1; i < n; i++) {
    const f = tp[i] * c[i].v;
    if (tp[i] > tp[i - 1]) pos[i] = f; else if (tp[i] < tp[i - 1]) neg[i] = f;
  }
  for (let i = p; i < n; i++) {
    let sp = 0, sn = 0;
    for (let k = i - p + 1; k <= i; k++) { sp += pos[k]; sn += neg[k]; }
    o[i] = sn === 0 ? 100 : 100 - 100 / (1 + sp / sn);
  } return o;
}
function obv(c) {
  const o = Array(c.length).fill(0);
  for (let i = 1; i < c.length; i++) o[i] = o[i - 1] + (c[i].c > c[i - 1].c ? c[i].v : c[i].c < c[i - 1].c ? -c[i].v : 0);
  return o;
}
function bollinger(v, p, m) {
  const b = sma(v, p), s = stdev(v, p);
  return {
    mid: b,
    up: b.map((x, i) => nn(x) ? x + m * s[i] : null),
    dn: b.map((x, i) => nn(x) ? x - m * s[i] : null)
  };
}
function keltner(c, p, m) {
  const mid = ema(c.map(x => x.c), p), a = atr(c, p);
  return {
    mid,
    up: mid.map((x, i) => nn(x) && nn(a[i]) ? x + m * a[i] : null),
    dn: mid.map((x, i) => nn(x) && nn(a[i]) ? x - m * a[i] : null)
  };
}
function ichimoku(c) {
  const n = c.length, h = c.map(x => x.h), l = c.map(x => x.l);
  const mid = (p) => { const hi = highest(h, p), lo = lowest(l, p); return hi.map((x, i) => nn(x) ? (x + lo[i]) / 2 : null); };
  const tenkan = mid(9), kijun = mid(26), b = mid(52);
  const spanA = tenkan.map((x, i) => nn(x) && nn(kijun[i]) ? (x + kijun[i]) / 2 : null);
  const i = n - 1, s = i - 26;
  return {
    tenkan: tenkan[i], kijun: kijun[i],
    cloudTop: s >= 0 && nn(spanA[s]) && nn(b[s]) ? Math.max(spanA[s], b[s]) : null,
    cloudBot: s >= 0 && nn(spanA[s]) && nn(b[s]) ? Math.min(spanA[s], b[s]) : null
  };
}
function vwapAnchored(c, tf) {
  const o = Array(c.length).fill(null);
  let pv = 0, vv = 0, day = null;
  for (let i = 0; i < c.length; i++) {
    const d = new Date(c[i].t).getUTCDate();
    if (tf !== 'D' && d !== day) { pv = 0; vv = 0; day = d; }
    const tp = (c[i].h + c[i].l + c[i].c) / 3;
    pv += tp * c[i].v; vv += c[i].v;
    o[i] = vv > 0 ? pv / vv : null;
  } return o;
}
/* swing structure via 5-bar fractals */
function structure(c) {
  const hs = [], ls = [];
  for (let i = 2; i < c.length - 2; i++) {
    if (c[i].h > c[i - 1].h && c[i].h > c[i - 2].h && c[i].h > c[i + 1].h && c[i].h > c[i + 2].h) hs.push(c[i].h);
    if (c[i].l < c[i - 1].l && c[i].l < c[i - 2].l && c[i].l < c[i + 1].l && c[i].l < c[i + 2].l) ls.push(c[i].l);
  }
  const h2 = hs.slice(-2), l2 = ls.slice(-2);
  let dir = 0, label = 'unclear';
  if (h2.length === 2 && l2.length === 2) {
    const hh = h2[1] > h2[0], hl = l2[1] > l2[0];
    if (hh && hl) { dir = 1; label = 'higher highs + higher lows'; }
    else if (!hh && !hl) { dir = -1; label = 'lower highs + lower lows'; }
    else { dir = 0; label = 'mixed / ranging'; }
  }
  return { dir, label, lastHigh: h2[h2.length - 1] || null, lastLow: l2[l2.length - 1] || null };
}


const TFS = [
  { id: '15', label: '15m', ms: 900000 },
  { id: '60', label: '1H', ms: 3600000 },
  { id: '240', label: '4H', ms: 14400000 },
  { id: 'D', label: '1D', ms: 86400000 }
];
const fmt = (x) => nn(x) ? (+x).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—';
const fmt0 = (x) => nn(x) ? Math.round(x).toLocaleString('en-US') : '—';
function analyse() {
  const c = state.candles[state.tf];
  if (!c || c.length < 220) return null;
  /* closed candles only — drop the forming bar */
  const k = c.slice(0, -1);
  const i = k.length - 1;
  const close = k.map(x => x.c);
  const price = state.live || k[i].c;
  const sig = [];
  const add = (group, name, value, dir, weight, note) => sig.push({ group, name, value, dir, weight, note });

  /* --- trend --- */
  const e20 = ema(close, 20), e50 = ema(close, 50), e200 = ema(close, 200);
  const stacked = e20[i] > e50[i] && e50[i] > e200[i] ? 1 : (e20[i] < e50[i] && e50[i] < e200[i] ? -1 : 0);
  add('Trend', 'EMA stack 20/50/200', stacked === 1 ? 'bullish stack' : stacked === -1 ? 'bearish stack' : 'tangled', stacked, 8);
  add('Trend', 'Price vs EMA200', `${((price / e200[i] - 1) * 100).toFixed(2)}%`, price > e200[i] ? 1 : -1, 6);

  const st = supertrend(k, 10, 3);
  add('Trend', 'Supertrend 10/3', `${st.dir[i] === 1 ? 'long' : 'short'} @ ${fmt(st.st[i])}`, st.dir[i], 7);

  const ce = chandelier(k, 4, 2);
  const ceStop = ce.dir[i] === 1 ? ce.longStop[i] : ce.shortStop[i];
  add('Trend', 'Chandelier Exit 4/2', `${ce.dir[i] === 1 ? 'long' : 'short'} · stop ${fmt(ceStop)}`, ce.dir[i], 7);

  const zl = zlsma(close, 32);
  const zlDir = price > zl[i] ? 1 : -1;
  const zlSlope = zl[i] > zl[i - 3] ? 1 : -1;
  add('Trend', 'ZLSMA 32', `${fmt(zl[i])} · slope ${zlSlope === 1 ? 'up' : 'down'}`, zlDir === zlSlope ? zlDir : 0, 5);

  const dm = adx(k, 14);
  const adxV = dm.adx[i];
  add('Trend', 'ADX / DI 14', `${adxV.toFixed(1)} ${adxV < 20 ? '(no trend)' : adxV > 40 ? '(strong)' : '(trending)'}`,
    adxV < 20 ? 0 : (dm.pdi[i] > dm.ndi[i] ? 1 : -1), 5);

  const ich = ichimoku(k);
  let ichDir = 0, ichTxt = 'no data';
  if (nn(ich.cloudTop)) {
    ichDir = price > ich.cloudTop ? 1 : price < ich.cloudBot ? -1 : 0;
    ichTxt = ichDir === 1 ? 'above cloud' : ichDir === -1 ? 'below cloud' : 'inside cloud';
  }
  add('Trend', 'Ichimoku cloud', ichTxt, ichDir, 5);

  /* --- momentum --- */
  const r14 = rsi(close, 14);
  add('Momentum', 'RSI 14', r14[i].toFixed(1), r14[i] > 55 ? 1 : r14[i] < 45 ? -1 : 0, 6,
    r14[i] > 70 ? 'overbought' : r14[i] < 30 ? 'oversold' : '');
  const md = macd(close, 12, 26, 9);
  const mdDir = md.line[i] > md.signal[i] ? 1 : -1;
  add('Momentum', 'MACD 12/26/9', `hist ${md.hist[i].toFixed(1)} · ${mdDir === 1 ? 'above signal' : 'below signal'}`,
    (md.hist[i] > 0 ? 1 : -1) === mdDir ? mdDir : 0, 7);
  const sr = stochRsi(close, 14, 14, 3, 3);
  add('Momentum', 'Stoch RSI', `K ${sr.k[i].toFixed(0)} / D ${sr.d[i].toFixed(0)}`,
    sr.k[i] > sr.d[i] && sr.k[i] < 80 ? 1 : sr.k[i] < sr.d[i] && sr.k[i] > 20 ? -1 : 0, 4,
    sr.k[i] > 80 ? 'overbought' : sr.k[i] < 20 ? 'oversold' : '');
  const cc = cci(k, 20);
  add('Momentum', 'CCI 20', cc[i].toFixed(0), cc[i] > 100 ? 1 : cc[i] < -100 ? -1 : 0, 3);
  const wr = willr(k, 14);
  add('Momentum', 'Williams %R', wr[i].toFixed(1), wr[i] > -50 ? 1 : -1, 3);
  const roc = (close[i] / close[i - 10] - 1) * 100;
  add('Momentum', 'Rate of change 10', `${roc.toFixed(2)}%`, roc > 0.3 ? 1 : roc < -0.3 ? -1 : 0, 3);

  /* --- volatility & structure --- */
  const bb = bollinger(close, 20, 2), kc = keltner(k, 20, 1.5);
  const pctB = (price - bb.dn[i]) / (bb.up[i] - bb.dn[i]);
  add('Structure', 'Bollinger %B', pctB.toFixed(2), pctB > 0.55 ? 1 : pctB < 0.45 ? -1 : 0, 3,
    pctB > 1 ? 'outside upper band' : pctB < 0 ? 'outside lower band' : '');
  const squeeze = bb.up[i] < kc.up[i] && bb.dn[i] > kc.dn[i];
  const bw = (bb.up[i] - bb.dn[i]) / bb.mid[i] * 100;
  add('Structure', 'TTM squeeze', squeeze ? `on · bandwidth ${bw.toFixed(2)}%` : `off · bandwidth ${bw.toFixed(2)}%`, 0, 2,
    squeeze ? 'coiled — expect expansion, direction unknown' : '');
  const str = structure(k);
  add('Structure', 'Market structure', str.label, str.dir, 6);
  const vw = vwapAnchored(k, state.tf);
  add('Structure', 'VWAP', `${fmt(vw[i])} · ${price > vw[i] ? 'above' : 'below'}`, price > vw[i] ? 1 : -1, 4);

  const d1 = state.candles['D'];
  let piv = null;
  if (d1 && d1.length > 2) {
    const p = d1[d1.length - 2];
    const P = (p.h + p.l + p.c) / 3;
    piv = { P, R1: 2 * P - p.l, S1: 2 * P - p.h, R2: P + (p.h - p.l), S2: P - (p.h - p.l) };
    add('Structure', 'Daily pivot', `${fmt(P)} · ${price > P ? 'above' : 'below'}`, price > P ? 1 : -1, 3);
  }

  /* --- volume & flow --- */
  const vAvg = sma(k.map(x => x.v), 20)[i];
  const vRatio = k[i].v / vAvg;
  add('Flow', 'Volume vs 20-avg', `${vRatio.toFixed(2)}x`, 0, 3,
    vRatio > 1.5 ? 'conviction behind the last bar' : vRatio < 0.6 ? 'thin participation' : '');
  const ob = obv(k);
  const obvDir = ob[i] > ob[i - 10] ? 1 : -1;
  add('Flow', 'OBV slope (10)', obvDir === 1 ? 'accumulating' : 'distributing', obvDir, 4);
  const mf = mfi(k, 14);
  add('Flow', 'Money flow 14', mf[i].toFixed(1), mf[i] > 55 ? 1 : mf[i] < 45 ? -1 : 0, 3);

  if (state.ticker) {
    const f = +state.ticker.fundingRate * 100;
    let fDir = 0, fNote = '';
    if (f > 0.03) { fDir = -1; fNote = 'longs crowded and paying'; }
    else if (f < -0.02) { fDir = 1; fNote = 'shorts crowded and paying'; }
    else if (f > 0.005) { fDir = 1; }
    else if (f < -0.005) { fDir = -1; }
    add('Flow', 'Funding rate', `${f.toFixed(4)}% / 8h`, fDir, 5, fNote);
  }
  if (state.oi.length > 5) {
    const oiNow = +state.oi[state.oi.length - 1].openInterest;
    const oiPrev = +state.oi[0].openInterest;
    const oiChg = (oiNow / oiPrev - 1) * 100;
    const pChg = (price / k[Math.max(0, i - 24)].c - 1) * 100;
    let dir = 0, note = '';
    if (oiChg > 0.5 && pChg > 0) { dir = 1; note = 'new longs opening'; }
    else if (oiChg > 0.5 && pChg < 0) { dir = -1; note = 'new shorts opening'; }
    else if (oiChg < -0.5 && pChg > 0) { dir = 0; note = 'short covering, not fresh demand'; }
    else if (oiChg < -0.5 && pChg < 0) { dir = 0; note = 'long liquidation flush'; }
    add('Flow', 'Open interest 24h', `${oiChg > 0 ? '+' : ''}${oiChg.toFixed(2)}%`, dir, 5, note);
  }
  if (state.ratio) {
    const lr = +state.ratio.buyRatio, sr2 = +state.ratio.sellRatio;
    const skew = lr / (lr + sr2);
    add('Flow', 'Account long/short', `${(lr * 100).toFixed(1)}% long`,
      skew > 0.72 ? -1 : skew < 0.45 ? 1 : 0, 3, skew > 0.72 ? 'crowd is heavily long' : '');
  }
  if (state.book) {
    const bid = state.book.b.reduce((s, x) => s + +x[1], 0);
    const ask = state.book.a.reduce((s, x) => s + +x[1], 0);
    const imb = (bid - ask) / (bid + ask);
    add('Flow', 'Order book imbalance', `${(imb * 100).toFixed(1)}% ${imb > 0 ? 'bid' : 'ask'}`,
      imb > 0.08 ? 1 : imb < -0.08 ? -1 : 0, 3);
  }
  if (state.tape) {
    const buy = state.tape.filter(t => t.S === 'Buy').reduce((s, t) => s + +t.v, 0);
    const sell = state.tape.filter(t => t.S === 'Sell').reduce((s, t) => s + +t.v, 0);
    const tot = buy + sell, pct = tot ? buy / tot : 0.5;
    add('Flow', 'Taker tape', `${(pct * 100).toFixed(1)}% buy`, pct > 0.55 ? 1 : pct < 0.45 ? -1 : 0, 3);
  }

  /* --- multi timeframe alignment --- */
  const mtf = TFS.map(t => {
    const cc2 = state.candles[t.id];
    if (!cc2 || cc2.length < 210) return { tf: t.label, dir: 0, txt: '—' };
    const kk = cc2.slice(0, -1), j = kk.length - 1, cl = kk.map(x => x.c);
    const a50 = ema(cl, 50)[j], a200 = ema(cl, 200)[j];
    const ceD = chandelier(kk, 4, 2).dir[j];
    const rr = rsi(cl, 14)[j];
    let s = 0;
    s += cl[j] > a200 ? 1 : -1;
    s += a50 > a200 ? 1 : -1;
    s += ceD;
    s += rr > 50 ? 1 : -1;
    return { tf: t.label, dir: s >= 2 ? 1 : s <= -2 ? -1 : 0, score: s, txt: s >= 2 ? 'bullish' : s <= -2 ? 'bearish' : 'mixed' };
  });
  const aligned = mtf.filter(m => m.dir !== 0);
  const mtfDir = aligned.length && aligned.every(m => m.dir === aligned[0].dir) ? aligned[0].dir : 0;

  /* --- aggregate --- */
  let wsum = 0, tot = 0;
  sig.forEach(s => { wsum += s.weight; tot += s.dir * s.weight; });
  const score = Math.round(tot / wsum * 100);

  /* --- trade plan --- */
  const a14 = atr(k, 14)[i];
  const bias = score >= 25 ? 1 : score <= -25 ? -1 : 0;
  let plan = null;
  if (bias !== 0) {
    const entry = price;
    let stop = bias === 1 ? entry - 1.5 * a14 : entry + 1.5 * a14;
    if (bias === 1 && ce.dir[i] === 1 && ce.longStop[i] < entry) stop = Math.min(stop, ce.longStop[i]);
    if (bias === -1 && ce.dir[i] === -1 && ce.shortStop[i] > entry) stop = Math.max(stop, ce.shortStop[i]);
    plan = sizeFor(state.account, bias, entry, stop);
  }

  return { sig, score, plan, mtf, mtfDir, atr: a14, piv, price, closedAt: k[i].t, bb, vwap: vw[i], k, ce, e20, e50, e200 };
}

    return analyse;
  }
  const AtlasPage = { analyse: (state) => make({ oi: [], ...state })() };
  if (typeof module !== 'undefined' && module.exports) module.exports = AtlasPage;
  else root.AtlasPage = AtlasPage;
})(typeof window !== 'undefined' ? window : this);
