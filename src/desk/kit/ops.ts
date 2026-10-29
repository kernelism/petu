// src/desk/kit/ops.ts
/**
 * Standard maths the board computes by name (spec "Board v2" 4–5): the model writes `op=softmax of=v`,
 * the engine computes, so common operations are right by construction. Pure; no DOM.
 *
 * Vector ops act on each row of a matrix (a vector is a one-row matrix): softmax, normalize (sum to 1),
 * l2 (unit length), cumsum, rank (1 = largest). Two-argument ops: matmul (A·B), wavg (a weighted
 * average of v's values by weights w: a scalar, with its expansion), dot. argmax returns 1-based indices.
 */
import type { Mat } from './compute';

export type VecOp = 'softmax' | 'normalize' | 'l2' | 'cumsum' | 'rank' | 'matmul' | 'scale';
export const VEC_OPS = new Set<VecOp>(['softmax', 'normalize', 'l2', 'cumsum', 'rank', 'matmul', 'scale']);
/** Ops that read two blocks. */
export const PAIR_OPS = new Set<VecOp>(['matmul']);

const finite = (xs: number[]) => xs.filter(Number.isFinite);

/** softmax(x / T): exp of each value over the sum of exps, shifted by the max for stability. T > 0 (default 1). */
export function softmax(xs: number[], T = 1): number[] {
  const t = T > 0 && Number.isFinite(T) ? T : 1;
  const ok = finite(xs);
  if (!ok.length) return xs.map(() => NaN);
  const m = Math.max(...ok) / t;
  const e = xs.map((x) => (Number.isFinite(x) ? Math.exp(x / t - m) : 0));
  const s = e.reduce((a, b) => a + b, 0);
  return xs.map((x, i) => (Number.isFinite(x) ? e[i] / s : NaN));
}

/** Shares of a whole: each value over the sum (the sum must not be 0). */
export function normalize(xs: number[]): number[] {
  const s = finite(xs).reduce((a, b) => a + b, 0);
  return xs.map((x) => (Number.isFinite(x) && s !== 0 ? x / s : NaN));
}

/** Unit length: each value over the vector's L2 norm. */
export function l2(xs: number[]): number[] {
  const n = Math.sqrt(finite(xs).reduce((a, b) => a + b * b, 0));
  return xs.map((x) => (Number.isFinite(x) && n > 0 ? x / n : NaN));
}

export function cumsum(xs: number[]): number[] {
  let s = 0;
  return xs.map((x) => (Number.isFinite(x) ? (s += x) : NaN));
}

/** 1 = the largest; ties share the better rank (competition ranking). */
export function rank(xs: number[]): number[] {
  return xs.map((x) => (Number.isFinite(x) ? 1 + xs.filter((y) => Number.isFinite(y) && y > x).length : NaN));
}

/** 1-based index of the largest value (the first on a tie); NaN when there is none. */
export function argmax(xs: number[]): number {
  let best = -1;
  xs.forEach((x, i) => { if (Number.isFinite(x) && (best < 0 || x > xs[best])) best = i; });
  return best < 0 ? NaN : best + 1;
}

export function dot(a: number[], b: number[]): number {
  return a.length === b.length ? a.reduce((s, x, i) => s + x * b[i], 0) : NaN;
}

/** Σ wᵢ·vᵢ / Σ wᵢ (weights that already sum to 1 give Σ wᵢ·vᵢ). */
export function wavg(w: number[], v: number[]): number {
  if (w.length !== v.length) return NaN;
  const s = w.reduce((a, b) => a + b, 0);
  return s !== 0 ? dot(w, v) / s : NaN;
}

/** A·B; null when the inner sizes differ. A vector on the left is a row; on the right, a column when that is what fits. */
export function matmul(A: Mat, B: Mat): Mat | null {
  let b = B;
  if (A[0]?.length !== B.length && B.length === 1 && B[0].length === A[0]?.length) b = B[0].map((x) => [x]);
  const n = A[0]?.length ?? 0;
  if (!n || n !== b.length) return null;
  const m = b[0].length;
  return A.map((row) => Array.from({ length: m }, (_, j) => row.reduce((s, x, k) => s + x * b[k][j], 0)));
}

/** Applies a vector op row by row. */
export function rowwise(m: Mat, f: (xs: number[]) => number[]): Mat {
  return m.map((r) => f(r));
}

/** Computes `op` on one or two matrices. `t` is softmax's temperature (or scale's factor). A string is a skip reason. */
export function applyOp(op: VecOp, a: Mat, b?: Mat, t?: number): Mat | string {
  switch (op) {
    case 'softmax': return rowwise(a, (xs) => softmax(xs, t ?? 1));
    case 'normalize': {
      const out = rowwise(a, normalize);
      return out.flat().some((x) => !Number.isFinite(x)) && a.flat().every(Number.isFinite) ? 'normalize: the values sum to 0' : out;
    }
    case 'l2': return rowwise(a, l2);
    case 'cumsum': return rowwise(a, cumsum);
    case 'rank': return rowwise(a, rank);
    case 'scale': return a.map((r) => r.map((x) => x * (t ?? 1)));
    case 'matmul': {
      if (!b) return 'matmul needs two blocks';
      return matmul(a, b) ?? 'matmul: inner sizes differ';
    }
  }
}
