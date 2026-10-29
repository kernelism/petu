// src/values/readout.ts — engine readouts on plots and fits ({{find}}), computed from the plot's
// formula. Pure: the board (src/desk/kit/kit.ts) and the value model (src/values/model.ts, also the
// commit gate's) call the same functions with the same constants, so what the caption says, where a
// point lands and what the gate checks are one number.
import { formula } from '../desk/kit/kit';
import * as C from '../desk/kit/compute';
import type { FindAction } from '../script/types';

/** A plot as the engine knows it: y(x) for fn= plots (exact), or a dense polyline (parametric). */
export type Curve = { f?: (x: number) => number; pts: C.Pt[]; x0: number; x1: number };
/** A fitted line and its scatter's points. */
export type FitData = { line: C.Line; pts: C.Pt[] };
/** A readout: a point (x, y) on the plot's axes, and the value it stands for (y, a slope, an area, a count…). */
export type Reading = { x: number; y: number; v: number; point: boolean };

/** Samples a parametric curve this densely (the board draws 160 segments; readouts need finer). */
const PARAM_N = 2000;

type PlotSrc = { fn?: string; x?: string; y?: string; t?: [string, string]; domain?: [number, number]; domainSrc?: [string, string]; with?: Record<string, number> };

/** The constants a plot sees: the answer's, with a contrast's overrides. */
export const withConsts = (consts: Record<string, number>, over?: Record<string, number>): Record<string, number> => (over ? { ...consts, ...over } : consts);

/** A plot's curve from its tag and the constants (null when its formula or range doesn't evaluate). */
export function curveOf(a: PlotSrc, consts0: Record<string, number>): Curve | null {
  const consts = withConsts(consts0, a.with);
  const val = (e: string) => { const f = formula(e, [], consts); return f ? f({}) : NaN; };
  if (a.x && a.y && a.t) {
    const t0 = val(a.t[0]), t1 = val(a.t[1]);
    const fx = formula(a.x, ['t'], consts), fy = formula(a.y, ['t'], consts);
    if (!fx || !fy || !(Number.isFinite(t0) && Number.isFinite(t1) && t1 > t0)) return null;
    const pts: C.Pt[] = [];
    for (let i = 0; i <= PARAM_N; i++) { const t = t0 + ((t1 - t0) * i) / PARAM_N; const p = { x: fx({ t }), y: fy({ t }) }; if (Number.isFinite(p.x) && Number.isFinite(p.y)) pts.push(p); }
    if (pts.length < 2) return null;
    const xs = pts.map((p) => p.x);
    return { pts, x0: Math.min(...xs), x1: Math.max(...xs) };
  }
  const [s0, s1] = a.domainSrc ?? (a.domain ? [String(a.domain[0]), String(a.domain[1])] : ['', '']);
  const x0 = val(s0), x1 = val(s1);
  const g = a.fn ? formula(a.fn, ['x'], consts) : null;
  if (!g || !(Number.isFinite(x0) && Number.isFinite(x1) && x1 > x0)) return null;
  const f = (x: number) => g({ x });
  const pts: C.Pt[] = [];
  for (let i = 0; i <= 400; i++) { const x = x0 + ((x1 - x0) * i) / 400; pts.push({ x, y: f(x) }); }
  return { f, pts, x0, x1 };
}

/** y at x: exact for fn= plots, interpolated along a parametric polyline (its first pass over x). */
export function yAt(c: Curve, x: number): number {
  if (c.f) return x >= c.x0 - 1e-9 && x <= c.x1 + 1e-9 ? c.f(x) : NaN;
  for (let i = 0; i + 1 < c.pts.length; i++) {
    const p = c.pts[i], q = c.pts[i + 1];
    if ((p.x - x) * (q.x - x) <= 0 && p.x !== q.x) return p.y + ((q.y - p.y) * (x - p.x)) / (q.x - p.x);
    if (p.x === x) return p.y;
  }
  return NaN;
}

/** Zeros of d over [lo, hi], left to right (sign changes on a 400-step grid, refined by bisection). */
function zeros(d: (x: number) => number, lo: number, hi: number): number[] {
  const out: number[] = [];
  const N = 400;
  for (let k = 0; k < N; k++) {
    let a = lo + ((hi - lo) * k) / N, b = lo + ((hi - lo) * (k + 1)) / N;
    let da = d(a);
    const db = d(b);
    if (!Number.isFinite(da) || !Number.isFinite(db)) continue;
    if (da === 0) { if (!out.length || Math.abs(out[out.length - 1] - a) > 1e-9) out.push(a); continue; }
    if (da * db > 0) continue;
    for (let it = 0; it < 60; it++) { const m = (a + b) / 2, dm = d(m); if (da * dm <= 0) b = m; else { a = m; da = dm; } }
    const x = (a + b) / 2;
    if (!out.length || Math.abs(out[out.length - 1] - x) > 1e-9 * Math.max(1, Math.abs(x))) out.push(x);
  }
  return out;
}

/** Simpson's rule over [a, b] (n even). */
function integrate(f: (x: number) => number, a: number, b: number, n = 400): number {
  const h = (b - a) / n;
  let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += f(a + i * h) * (i % 2 ? 4 : 2);
  return (s * h) / 3;
}

/** Golden-section refinement of an extremum found on the grid. */
function refineExt(f: (x: number) => number, a: number, b: number, max: boolean): number {
  const g = (Math.sqrt(5) - 1) / 2, s = max ? -1 : 1;
  let c = b - g * (b - a), d = a + g * (b - a);
  for (let i = 0; i < 80; i++) { if (s * f(c) < s * f(d)) b = d; else a = c; c = b - g * (b - a); d = a + g * (b - a); }
  return (a + b) / 2;
}

const evalF = (src: string | undefined, consts: Record<string, number>): number | undefined => {
  if (src == null) return undefined;
  const f = formula(src, [], consts);
  const v = f ? f({}) : NaN;
  return Number.isFinite(v) ? v : NaN;
};

/**
 * Computes a {{find}}. `curve(id)` gives a plot's curve, `fit(id)` a fit's line and points. A string
 * is why it can't be read (unknown plot, no crossing, outside the domain…): skip, never guess.
 */
export function read(a: FindAction, curve: (id: string) => Curve | undefined, fit: (id: string) => FitData | undefined, consts: Record<string, number>): Reading | string {
  if (a.mode === 'inside' || a.mode === 'residual') {
    const ft = fit(a.of[0]);
    if (!ft) return `no fitted line ${a.of[0]}`;
    if (a.mode === 'inside') { const n = C.inliers(ft.pts, ft.line, a.w!).length; return { x: NaN, y: NaN, v: n, point: false }; }
    if (a.point != null) {
      const p = ft.pts[a.point - 1];
      if (!p) return `no point ${a.point} in ${a.of[0]}`;
      return { x: p.x, y: p.y, v: C.distTo(p, ft.line), point: false };
    }
    const ds = ft.pts.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)).map((p) => C.distTo(p, ft.line));
    if (!ds.length) return 'no points';
    return { x: NaN, y: NaN, v: Math.sqrt(ds.reduce((s, d) => s + d * d, 0) / ds.length), point: false };
  }
  const p = curve(a.of[0]);
  if (!p) return `no plot ${a.of[0]}`;
  const q = a.of[1] != null ? curve(a.of[1]) : undefined;
  if (a.of[1] != null && !q) return `no plot ${a.of[1]}`;
  const fp = (x: number) => yAt(p, x);
  const k = (a.n ?? 1) - 1;
  const pick = (xs: number[], what: string): Reading | string => {
    if (xs.length <= k) return xs.length ? `only ${xs.length} ${what}` : `no ${what}`;
    const x = xs[k];
    return { x, y: fp(x), v: fp(x), point: true };
  };
  switch (a.mode) {
    case 'cross': {
      const lo = Math.max(p.x0, q!.x0), hi = Math.min(p.x1, q!.x1);
      if (!(hi > lo)) return `${a.of[0]} and ${a.of[1]} share no x range`;
      return pick(zeros((x) => fp(x) - yAt(q!, x), lo, hi), 'crossing');
    }
    case 'level': {
      const L = evalF(a.level, consts)!;
      if (!Number.isFinite(L)) return `bad level ${a.level}`;
      return pick(zeros((x) => fp(x) - L, p.x0, p.x1), `crossing at ${a.level}`);
    }
    case 'max':
    case 'min': {
      const max = a.mode === 'max';
      let best = -1, bv = 0;
      const N = 400, xs = Array.from({ length: N + 1 }, (_, i) => p.x0 + ((p.x1 - p.x0) * i) / N);
      xs.forEach((x, i) => { const y = fp(x); if (Number.isFinite(y) && (best < 0 || (max ? y > bv : y < bv))) { best = i; bv = y; } });
      if (best < 0) return 'nothing to read';
      let x = xs[best];
      if (p.f && best > 0 && best < N) x = refineExt(fp, xs[best - 1], xs[best + 1], max);
      return { x, y: fp(x), v: fp(x), point: true };
    }
    case 'at':
    case 'slope': {
      const x = evalF(a.x, consts)!;
      if (!Number.isFinite(x)) return `bad x ${a.x}`;
      const y = fp(x);
      if (!Number.isFinite(y)) return `x=${a.x} is outside ${a.of[0]}`;
      if (a.mode === 'at') return { x, y, v: y, point: true };
      const h = Math.max(1e-6, (p.x1 - p.x0) * 1e-5);
      const s = (yAt(p, Math.min(p.x1, x + h)) - yAt(p, Math.max(p.x0, x - h))) / (Math.min(p.x1, x + h) - Math.max(p.x0, x - h));
      return Number.isFinite(s) ? { x, y, v: s, point: true } : 'no slope there';
    }
    case 'area': {
      const lo = evalF(a.from, consts) ?? Math.max(p.x0, q?.x0 ?? -Infinity), hi = evalF(a.to, consts) ?? Math.min(p.x1, q?.x1 ?? Infinity);
      if (!(Number.isFinite(lo) && Number.isFinite(hi) && hi > lo)) return 'bad area range';
      if (lo < p.x0 - 1e-9 || hi > p.x1 + 1e-9 || (q && (lo < q.x0 - 1e-9 || hi > q.x1 + 1e-9))) return 'area range outside the plot';
      const v = integrate((x) => fp(x) - (q ? yAt(q, x) : 0), lo, hi);
      return Number.isFinite(v) ? { x: (lo + hi) / 2, y: NaN, v, point: false } : 'area does not evaluate';
    }
  }
  return 'unknown readout';
}
