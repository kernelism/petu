// src/desk/plot.ts
import type { SPt } from '../geometry/space';
import type { Stroke } from '../ink/agent/strokes';
import type { Fn } from './expr';

/** Samples per plot. */
export const PLOT_SAMPLES = 96;
/** The axes box a plot draws into: origin at bottom-left, w right, h up (target space). */
export type AxesBox = { x: number; y: number; w: number; h: number };

/**
 * Samples `fn` over `domain` and maps it into `box`, left to right. Poles break the curve
 * (`breakPoles`: found between neighbours, so a narrow peak is kept whole). `range` defaults to
 * [min(0, lo), hi] over what is left. Points that are non-finite or outside the range break the
 * path, so the result is one stroke per visible run. Returns [] when nothing is plottable.
 */
export function plotStrokes(fn: Fn, domain: [number, number], box: AxesBox, range?: [number, number]): Stroke[] {
  const [d0, d1] = domain;
  if (!(d1 > d0)) return [];
  const xs = Array.from({ length: PLOT_SAMPLES + 1 }, (_, i) => d0 + ((d1 - d0) * i) / PLOT_SAMPLES);
  const safe = (x: number) => { try { return fn(x); } catch { return NaN; } };
  const ys = xs.map(safe);
  if (!range) breakPoles(safe, xs, ys);
  let [r0, r1] = range ?? autoRange(ys);
  if (!(r1 > r0)) { r0 -= 1; r1 += 1; }
  const map = (x: number, y: number): SPt => ({ x: box.x + ((x - d0) / (d1 - d0)) * box.w, y: box.y - ((y - r0) / (r1 - r0)) * box.h });
  const out: Stroke[] = [];
  let cur: Stroke = [];
  for (let i = 0; i < xs.length; i++) {
    const y = ys[i];
    if (Number.isFinite(y) && y >= r0 && y <= r1) cur.push(map(xs[i], y));
    else { if (cur.length > 1) out.push(cur); cur = []; }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

function autoRange(ys: number[]): [number, number] {
  const f = ys.filter(Number.isFinite);
  if (!f.length) return [0, 1];
  const lo = Math.min(0, ...f), hi = Math.max(...f);
  return [lo, hi > lo ? hi : lo + 1];
}

/**
 * Breaks a sampled curve at its poles, in place (NaN), and nowhere else. A pole is found between
 * neighbours, by refining g there, never by comparing |y| with the median (that erased narrow peaks):
 * - a sign change whose bracket, bisected, grows in |g| instead of shrinking to a root (1/(x−1));
 * - a local maximum of |y| that grows without bound as it is refined (1/x², a sample beside the pole);
 * - a non-finite sample (a pole hit exactly, tan at π/2).
 * Around each pole, the samples on its rising arms beyond a cap (20× the median |y|, the visible
 * scale of the rest) are cut too, so no near-vertical spike flattens the curve. A smooth peak, however
 * narrow, refines to a finite maximum and is kept whole.
 */
export function breakPoles(g: (x: number) => number, xs: number[], ys: number[]): void {
  const n = ys.length;
  const fin = (v: number) => Number.isFinite(v);
  const poles: number[] = [];
  const A = (x: number) => Math.abs(g(x));
  for (let i = 0; i < n; i++) {
    if (!fin(ys[i])) { if ((i > 0 && fin(ys[i - 1])) || (i + 1 < n && fin(ys[i + 1]))) poles.push(i); continue; }
    // A sign change to the right: bisect; a root's |g| shrinks, a pole's grows.
    if (i + 1 < n && fin(ys[i + 1]) && ys[i] * ys[i + 1] < 0) {
      let a = xs[i], b = xs[i + 1], ga = ys[i];
      const start = Math.max(Math.abs(ys[i]), Math.abs(ys[i + 1]));
      let end = 0;
      for (let it = 0; it < 60; it++) {
        const m = (a + b) / 2, gm = g(m);
        if (!fin(gm)) { end = Infinity; break; }
        if (gm === 0) { end = 0; break; }
        if (gm * ga < 0) b = m; else { a = m; ga = gm; }
        end = Math.min(Math.abs(g(a)), Math.abs(g(b)));
      }
      if (end > start * 10) poles.push(Math.abs(ys[i]) > Math.abs(ys[i + 1]) ? i : i + 1);
      continue;
    }
    // A local maximum of |y|: refine (golden section on |g| between its neighbours).
    const l = i > 0 ? Math.abs(ys[i - 1]) : -Infinity, r = i + 1 < n ? Math.abs(ys[i + 1]) : -Infinity, c = Math.abs(ys[i]);
    if (c > 0 && c >= l && c >= r && (c > l || c > r) && (fin(l) || fin(r))) {
      let a = xs[Math.max(0, i - 1)], b = xs[Math.min(n - 1, i + 1)];
      const phi = (Math.sqrt(5) - 1) / 2;
      let p = b - phi * (b - a), q = a + phi * (b - a), fp = A(p), fq = A(q), best = c;
      for (let it = 0; it < 80 && fin(best); it++) {
        if (!fin(fp) || !fin(fq)) { best = Infinity; break; }
        best = Math.max(best, fp, fq);
        if (fp > fq) { b = q; q = p; fq = fp; p = b - phi * (b - a); fp = A(p); }
        else { a = p; p = q; fp = fq; q = a + phi * (b - a); fq = A(q); }
      }
      if (!fin(best) || best > c * 1e3) poles.push(i);
    }
  }
  if (!poles.length) return;
  const abs = ys.filter(fin).map(Math.abs).sort((a, b) => a - b);
  const cap = Math.max((abs[Math.floor(abs.length / 2)] ?? 1) * 20, 1e-9);
  for (const p of poles) {
    ys[p] = NaN;
    // Its arms: outward while |y| keeps falling; cut what is still above the cap.
    for (const dir of [-1, 1]) {
      let prev = Infinity;
      for (let j = p + dir; j >= 0 && j < n && fin(ys[j]); j += dir) {
        const v = Math.abs(ys[j]);
        if (v > prev || v <= cap) break;
        ys[j] = NaN;
        prev = v;
      }
    }
  }
}
