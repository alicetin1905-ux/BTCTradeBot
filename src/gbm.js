'use strict';
// Gradient-boosted regression trees (weighted, squared loss), small and dependency-free. Unlike the ridge model in
// src/model.js it can learn combinations ("RSI high AND far above EMA200") and thresholds. Used by research/improve.js.
//   fit(X, y, w, { trees, lr, depth, minLeaf, bins, leafL2 }) → model;  predict(model, x) → number

function thresholds(X, j, bins) {
  const v = X.map(r => r[j]).sort((a, b) => a - b), out = [];
  for (let b = 1; b < bins; b++) { const t = v[Math.floor(b * v.length / bins)]; if (!out.length || t > out[out.length - 1]) out.push(t); }
  return out;
}

function fit(X, y, w, { trees = 150, lr = 0.05, depth = 2, minLeaf = 60, bins = 16, leafL2 = 5 } = {}) {
  const n = X.length, d = X[0].length;
  const W = w || new Array(n).fill(1);
  const sw = W.reduce((a, b) => a + b, 0);
  const base = W.reduce((s, wi, i) => s + wi * y[i], 0) / sw;
  const F = new Float64Array(n).fill(base);
  const th = Array.from({ length: d }, (_, j) => thresholds(X, j, bins));
  // bin index of every value, once
  const B = X.map(r => r.map((v, j) => { const t = th[j]; let k = 0; while (k < t.length && v > t[k]) k++; return k; }));
  const out = [];
  const build = (idx, r, level) => {
    let sW = 0, sR = 0;
    for (const i of idx) { sW += W[i]; sR += W[i] * r[i]; }
    const leaf = { v: lr * sR / (sW + leafL2 * sw / n) };
    if (level >= depth || idx.length < 2 * minLeaf) return leaf;
    let best = null;
    for (let j = 0; j < d; j++) {
      const nb = th[j].length + 1, hw = new Float64Array(nb), hr = new Float64Array(nb), hc = new Int32Array(nb);
      for (const i of idx) { const k = B[i][j]; hw[k] += W[i]; hr[k] += W[i] * r[i]; hc[k]++; }
      let lw = 0, lr2 = 0, lc = 0;
      for (let k = 0; k < nb - 1; k++) {
        lw += hw[k]; lr2 += hr[k]; lc += hc[k];
        const rw = sW - lw, rr = sR - lr2, rc = idx.length - lc;
        if (lc < minLeaf || rc < minLeaf || lw <= 0 || rw <= 0) continue;
        const gain = lr2 * lr2 / lw + rr * rr / rw - sR * sR / sW;
        if (!best || gain > best.gain) best = { gain, j, k };
      }
    }
    if (!best || best.gain <= 0) return leaf;
    const L = [], R = [];
    for (const i of idx) (B[i][best.j] <= best.k ? L : R).push(i);
    return { j: best.j, t: th[best.j][best.k], l: build(L, r, level + 1), r: build(R, r, level + 1) };
  };
  const all = Array.from({ length: n }, (_, i) => i), res = new Float64Array(n);
  const val = (node, x) => { while (node.j !== undefined) node = x[node.j] <= node.t ? node.l : node.r; return node.v; };
  for (let t = 0; t < trees; t++) {
    for (let i = 0; i < n; i++) res[i] = y[i] - F[i];
    const tree = build(all, res, 0);
    out.push(tree);
    for (let i = 0; i < n; i++) F[i] += val(tree, X[i]);
  }
  return { gbm: true, base, trees: out };
}

function predict(m, x) {
  let s = m.base;
  for (let node of m.trees) { while (node.j !== undefined) node = x[node.j] <= node.t ? node.l : node.r; s += node.v; }
  return s;
}

module.exports = { fit, predict };
