'use strict';
// Weighted ridge regression, solved with Gaussian elimination. Learns w so that X·w ≈ y.
function fit(X, y, wts, lambda = 1) {
  const d = X[0].length + 1; // + bias
  const A = Array.from({ length: d }, () => new Float64Array(d)), b = new Float64Array(d);
  for (let r = 0; r < X.length; r++) {
    const x = [...X[r], 1], w = wts ? wts[r] : 1;
    for (let i = 0; i < d; i++) { b[i] += w * x[i] * y[r]; for (let j = i; j < d; j++) A[i][j] += w * x[i] * x[j]; }
  }
  const W = wts ? wts.reduce((a, b) => a + b, 0) : X.length;
  for (let i = 0; i < d; i++) { for (let j = 0; j < i; j++) A[i][j] = A[j][i]; if (i < d - 1) A[i][i] += lambda * W / 100; }
  // solve
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < d; c++) {
    let p = c; for (let r = c + 1; r < d; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) continue;
    for (let r = 0; r < d; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= d; k++) M[r][k] -= f * M[c][k]; }
  }
  const w = M.map((row, i) => Math.abs(row[i]) < 1e-12 ? 0 : row[d] / row[i]);
  return { w: w.slice(0, -1), b: w[d - 1] };
}
const predict = (m, x) => x.reduce((s, v, i) => s + v * m.w[i], m.b);
module.exports = { fit, predict };
