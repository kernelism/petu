// src/desk/plot.ts
import type { SPt } from '../geometry/space';
import type { Stroke } from '../ink/agent/strokes';
import type { Fn } from './expr';

/** Samples per plot. */
export const PLOT_SAMPLES = 96;
/** The axes box a plot draws into: origin at bottom-left, w right, h up (target space). */
export type AxesBox = { x: number; y: number; w: number; h: number };

/**
 * Samples `fn` over `domain` and maps it into `box`, left to right. `range` defaults to
 * [min(0, lo), hi] over the finite samples, where hi is capped at 4× the median |y| so a pole
 * (1/x near 0) doesn't flatten the rest. Points that are non-finite or outside the range break the
 * path, so the result is one stroke per visible run. Returns [] when nothing is plottable.
 */
export function plotStrokes(fn: Fn, domain: [number, number], box: AxesBox, range?: [number, number]): Stroke[] {
  const [d0, d1] = domain;
  if (!(d1 > d0)) return [];
  const xs = Array.from({ length: PLOT_SAMPLES + 1 }, (_, i) => d0 + ((d1 - d0) * i) / PLOT_SAMPLES);
  const ys = xs.map((x) => { try { return fn(x); } catch { return NaN; } });
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
  const abs = f.map(Math.abs).sort((a, b) => a - b);
  const cap = Math.max(abs[Math.floor(abs.length / 2)] * 4, 1e-9);
  const lo = Math.max(Math.min(0, ...f), -cap), hi = Math.min(Math.max(...f), cap);
  return [lo, hi > lo ? hi : lo + 1];
}
