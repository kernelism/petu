// src/svgboard/data.ts — exact data on the svg board: the model writes formulas, the engine draws them.
/**
 * The model keeps its creative freedom (it writes the SVG), but numbers and positions that follow from
 * a formula are computed here instead of in its head. Attributes the engine resolves before drawing
 * (formulas use src/desk/expr.ts, over the answer's constants; names are case-insensitive):
 *
 *  data-const="g=9.8 R=6.37e6 T=2*pi*sqrt(R/g)"   constants, in order (formulas may read earlier ones)
 *  data-axes="ax" data-x="0,140" data-y="600,1200" data-box="80,60,520,420"
 *                                    a plot frame: data x/y ranges onto a board box (x,y,w,h);
 *                                    `data-frame` draws its L axes, `data-ticks-x="0,40,80"` /
 *                                    `data-ticks-y` its ticks and numbers (data-fmt, data-unit-x/-y)
 *  <path data-fn="1200-5*x" data-axes="ax" [data-x="a,b"]>      y = f(x), sampled, clipped to the frame
 *  <path data-param="R*cos(t), R*sin(t)" data-t="0,2*pi" [data-axes]>   a parametric curve
 *  <path data-between="d,s" data-x="80,100" data-axes="ax">   the region between two curves (or a
 *                                    curve and a level: "d,pc")
 *  data-at="<point>"                 places an element: circle/ellipse centre, text x/y, rect centre,
 *                                    anything else translate(x y). `data-name="E"` names the point.
 *  <line data-from="<point>" data-to="<point>">,  <polyline|polygon data-points="<p>; <p>; <p>">
 *  data-set="cx: 300+120*cos(th); r: 8*m"        any numeric attribute as a formula (board units)
 *  data-rotate="deg[, cx, cy]"  data-translate="dx, dy"   a transform after the element's own
 *  <text data-val="pi*sqrt(R/g)/60" data-fmt="1" data-unit="min">   computed text; a "{}" in the
 *                                    text's own words is replaced (else the value + unit is the text);
 *                                    with an id it is a readout the narration says as {{val id=…}},
 *                                    several {} take several formulas in order ("{} × {}", data-val="n, m");
 *                                    with the affixes the text writes around it ("${}" → "$10",
 *                                    "{} units" → "100 units": src/values/quantity.ts, one reading)
 *  <g data-slide="img.f" data-kernel="img.k" data-step="k"/>   a sliding window the engine lays out,
 *                                    steps and works (slide.ts); its outputs are said as {{val id.out[i]}}
 *  data-schematic                    a sketch, not a plot: its hand-placed dots and typed numbers are
 *                                    left alone (snapMarkers, svgboard/check.ts grounded)
 *
 * <point>: `cross(d,s)` · `at(d, x=80)` · `at(d, y=900)` · `at(c, t=1.2)` · `max(f)` · `min(f)` ·
 * `pt(ax, x, y)` (data coords) · `onx(P)` / `ony(P)` (P's foot on the frame's x / y axis) · a named
 * point · `x, y` (board coords, formulas). In data-val and data-set, `xof(P)` / `yof(P)` read a
 * point's data coordinates (board ones without a frame).
 *
 * Anything that does not resolve is never drawn wrong: the element is hidden (render) and the gate
 * flags it (repair or drop). Resolution is idempotent: a constant changes (a tween) → resolve again.
 */
import { compileVars, freeNames } from '../desk/expr';
import { pickNumber, type CalcTable } from '../calc/stream';
import { drawSlide, SlideError } from './slide';
import { drawText, readTemplate, type Affix } from '../values/quantity';
import { isUnitWord } from '../values/units';
import { readFormat } from '../values/format';

export type Axes = { name: string; x0: number; x1: number; y0: number; y1: number; box: { x: number; y: number; w: number; h: number } };
type CurveSpec = { kind: 'fn'; src: string; ax: string | null; dom: string | null } | { kind: 'param'; src: [string, string]; ax: string | null; t: string };
export type DPt = { x: number; y: number; ax?: Axes; dx: number; dy: number };

export type DataScope = {
  /** Constants (lowercase names), read live. */
  consts: Record<string, number>;
  /** Calc programs' numbers by lowercase calc id (src/calc/stream.ts): a formula reads `rod.I4`, `box.out[3]`. */
  calcs?: Map<string, CalcTable>;
  /** Defines constants (in order). Default: evaluated into `consts`. The board defines through the kit store. */
  define?: (defs: [string, string][]) => void;
  axes: Map<string, { name: string; src: [string, string, string] }>;
  curves: Map<string, CurveSpec>;
  points: Map<string, DPt>;
  /** Computed values written this pass (data-val), for the gate's number check. */
  values: { v: number; of: string; /** The words the text puts before the number ("SSD = {}" → "SSD"): what the narration calls it. */ label?: string;
    /** The readout's name (its data-name or id): what `{{val id=…}}` says. */ id?: string; /** The number as the board writes it (fmtValue, data-fmt): what is seen. */ text: string;
    /** Its unit (quantity.ts readTemplate: its affixes, or data-unit): a number said in another unit is not this one. */ unit?: string;
    /** What the board writes around the number ("$" of "${}", " units" of "{} units"): said with it (values/say.ts). */ affix?: Affix;
    /** Its data-fmt: a {{val}} that drops the sign (as=abs) formats the same way. */ fmt?: string;
    /** Its text's own words, unit and filler dropped ("lands {} m downstream" → lands, downstream): words that refer to it. */ words?: string[] }[];
};

export const newScope = (consts: Record<string, number> = {}): DataScope => ({ consts, axes: new Map(), curves: new Map(), points: new Map(), values: [] });

const SVGNS = 'http://www.w3.org/2000/svg';
const lc = (s: string) => s.trim().toLowerCase();
const r2 = (v: number) => String(Math.round(v * 100) / 100);

/** Splits at top-level separators (parentheses respected). */
export function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let d = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') d++;
    else if (ch === ')') d--;
    if (d === 0 && ch === sep) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter((x, i, a) => x !== '' || a.length === 1);
}

class DataError extends Error {}
const fail = (m: string): never => { throw new DataError(m); };

const fcache = new Map<string, ReturnType<typeof compileVars> | null>();
/** A formula over the constants and `vars` → its value; throws a DataError naming what is wrong. */
function evalF(src: string, sc: DataScope, vars: Record<string, number> = {}): number {
  const s = valueFns(src, sc);
  const names = [...Object.keys(vars), ...Object.keys(sc.consts)];
  const key = `${s}|${names.join(',')}`;
  let f = fcache.get(key);
  if (f === undefined) {
    try { f = compileVars(s, names); } catch { f = null; }
    if (fcache.size > 2000) fcache.clear();
    fcache.set(key, f);
  }
  if (!f) {
    const miss = freeNames(s)?.find((n) => !names.includes(n));
    return fail(miss ? `unknown constant ${miss} in "${src}"` : `bad formula "${src}"`);
  }
  const v = f({ ...sc.consts, ...vars });
  if (!Number.isFinite(v)) {
    const miss = freeNames(s)?.find((n) => !names.includes(n));
    return fail(miss ? `unknown constant ${miss} in "${src}"` : `"${src}" has no value`);
  }
  return v;
}

/**
 * xof(P) / yof(P) → the point's data coordinate as a number literal; a calc's number (`rod.I4`,
 * `box.out[3]`) → its value. A calc path that names no exported number fails (never a guess).
 */
function valueFns(src: string, sc: DataScope): string {
  let s = src;
  if (sc.calcs?.size) s = s.replace(/(?<![\w.])([A-Za-z]\w*)\.([A-Za-z_]\w*(?:\.[A-Za-z_]\w*|\[\d+\])*)/g, (m, id: string, path: string) => {
    const t = sc.calcs!.get(id.toLowerCase());
    if (!t) return m;
    const v = pickNumber(t, path);
    return v != null && Number.isFinite(v) ? `(${v})` : fail(`calc ${id} exports no number ${path}`);
  });
  for (let guard = 0; guard < 20; guard++) {
    const m = /\b(xof|yof)\s*\(/i.exec(s);
    if (!m) return s;
    let d = 0, j = m.index + m[0].length - 1;
    for (; j < s.length; j++) { if (s[j] === '(') d++; else if (s[j] === ')' && --d === 0) break; }
    if (d !== 0) fail(`unclosed ${m[1]}( in "${src}"`);
    const p = point(s.slice(m.index + m[0].length, j), sc);
    const v = lc(m[1]) === 'xof' ? p.dx : p.dy;
    s = `${s.slice(0, m.index)}(${v})${s.slice(j + 1)}`;
  }
  return s;
}

function axesOf(name: string | null, sc: DataScope): Axes | null {
  if (!name) return null;
  const a = sc.axes.get(lc(name));
  if (!a) return fail(`no axes ${name}`);
  const [xs, ys, bs] = a.src;
  const xr = splitTop(xs, ','), yr = splitTop(ys, ','), br = splitTop(bs, ',');
  if (xr.length !== 2 || yr.length !== 2 || br.length !== 4) fail(`axes ${name}: data-x, data-y take "lo,hi" and data-box "x,y,w,h"`);
  const [x0, x1] = xr.map((v) => evalF(v, sc)), [y0, y1] = yr.map((v) => evalF(v, sc));
  const [bx, by, bw, bh] = br.map((v) => evalF(v, sc));
  if (x0 === x1 || y0 === y1 || !(bw > 0) || !(bh > 0)) fail(`axes ${name} has an empty range`);
  return { name: a.name, x0, x1, y0, y1, box: { x: bx, y: by, w: bw, h: bh } };
}

const toBoard = (ax: Axes | null | undefined, x: number, y: number) => (ax ? { x: ax.box.x + ((x - ax.x0) / (ax.x1 - ax.x0)) * ax.box.w, y: ax.box.y + ax.box.h - ((y - ax.y0) / (ax.y1 - ax.y0)) * ax.box.h } : { x, y });
const mk = (ax: Axes | null, dx: number, dy: number): DPt => ({ ...toBoard(ax, dx, dy), ...(ax ? { ax } : {}), dx, dy });

type Curve = { name: string; ax: Axes | null; kind: 'fn'; f: (x: number) => number; dom: [number, number] } | { name: string; ax: Axes | null; kind: 'param'; f: (t: number) => [number, number]; dom: [number, number] };

function curve(name: string, sc: DataScope): Curve {
  const c = sc.curves.get(lc(name));
  if (!c) return fail(`no curve ${name}`);
  const ax = axesOf(c.ax, sc);
  if (c.kind === 'fn') {
    const dom = c.dom ? splitTop(c.dom, ',').map((v) => evalF(v, sc)) : ax ? [ax.x0, ax.x1] : fail(`curve ${name} needs data-x or data-axes`);
    if (dom.length !== 2) fail(`curve ${name}: data-x takes "lo,hi"`);
    // Fails early on a bad formula. A pole at an end of the domain (-(a-x)/x from 0: eval D19, 2026-11-01,
    // the whole elasticity board withheld) is not one: the sampler skips x with no value, so the curve
    // fails only when no probe across the domain has one (and then with the midpoint's reason).
    const probe = [0, 0.25, 0.5, 0.75, 1].map((k) => dom[0] + (dom[1] - dom[0]) * k);
    if (!probe.some((x) => { try { return Number.isFinite(evalF(c.src, sc, { x })); } catch { return false; } })) evalF(c.src, sc, { x: probe[2] });
    return { name, ax, kind: 'fn', f: (x) => { try { return evalF(c.src, sc, { x }); } catch { return NaN; } }, dom: [Math.min(dom[0], dom[1]), Math.max(dom[0], dom[1])] };
  }
  const t = splitTop(c.t, ',').map((v) => evalF(v, sc));
  if (t.length !== 2) fail(`curve ${name}: data-t takes "lo,hi"`);
  evalF(c.src[0], sc, { t: t[0] }); evalF(c.src[1], sc, { t: t[0] });
  return { name, ax, kind: 'param', f: (u) => { try { return [evalF(c.src[0], sc, { t: u }), evalF(c.src[1], sc, { t: u })]; } catch { return [NaN, NaN]; } }, dom: [t[0], t[1]] };
}

/** Root of g on [a,b] by sampling then bisection; null when none. */
function root(g: (x: number) => number, a: number, b: number, n = 400): number | null {
  let px = a, pv = g(a);
  if (Math.abs(pv) < 1e-12) return a;
  for (let i = 1; i <= n; i++) {
    const x = a + ((b - a) * i) / n, v = g(x);
    if (Number.isFinite(v) && Number.isFinite(pv) && (v === 0 || Math.sign(v) !== Math.sign(pv))) {
      let lo = px, hi = x, lv = pv;
      for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2, mv = g(m); if (Math.sign(mv) === Math.sign(lv)) { lo = m; lv = mv; } else hi = m; }
      return (lo + hi) / 2;
    }
    px = x; pv = v;
  }
  return null;
}

function samples(c: Curve, n = 240): DPt[] {
  const out: DPt[] = [];
  for (let i = 0; i <= n; i++) {
    const u = c.dom[0] + ((c.dom[1] - c.dom[0]) * i) / n;
    if (c.kind === 'fn') { const y = c.f(u); if (Number.isFinite(y)) out.push(mk(c.ax, u, y)); }
    else { const [x, y] = c.f(u); if (Number.isFinite(x) && Number.isFinite(y)) out.push(mk(c.ax, x, y)); }
  }
  return out;
}

/** Resolves a point expression. */
export function point(src: string, sc: DataScope): DPt {
  const s = src.trim();
  const named = sc.points.get(lc(s));
  if (named) return named;
  const m = /^([a-z]+)\s*\(([\s\S]*)\)$/i.exec(s);
  const fn = m ? lc(m[1]) : '';
  const args = m ? splitTop(m[2], ',') : [];
  switch (fn) {
    case 'pt': {
      if (args.length !== 3) fail(`pt(axes, x, y) takes three arguments: "${s}"`);
      const ax = axesOf(args[0], sc)!;
      return mk(ax, evalF(args[1], sc), evalF(args[2], sc));
    }
    case 'cross': {
      if (args.length !== 2) fail(`cross(a, b) takes two curves: "${s}"`);
      const a = curve(args[0], sc), b = curve(args[1], sc);
      if (a.kind === 'fn' && b.kind === 'fn' && (a.ax?.name ?? '') === (b.ax?.name ?? '')) {
        const lo = Math.max(a.dom[0], b.dom[0]), hi = Math.min(a.dom[1], b.dom[1]);
        const x = lo < hi ? root((x) => a.f(x) - b.f(x), lo, hi) : null;
        if (x == null) return fail(`${args[0]} and ${args[1]} do not cross in their range`);
        return mk(a.ax, x, a.f(x));
      }
      // Any two curves: their polylines on the board.
      const pa = samples(a, 400), pb = samples(b, 400);
      for (let i = 1; i < pa.length; i++) for (let j = 1; j < pb.length; j++) {
        const p = pa[i - 1], q = pa[i], r = pb[j - 1], t = pb[j];
        const den = (q.x - p.x) * (t.y - r.y) - (q.y - p.y) * (t.x - r.x);
        if (Math.abs(den) < 1e-12) continue;
        const u = ((r.x - p.x) * (t.y - r.y) - (r.y - p.y) * (t.x - r.x)) / den, v = ((r.x - p.x) * (q.y - p.y) - (r.y - p.y) * (q.x - p.x)) / den;
        if (u >= 0 && u <= 1 && v >= 0 && v <= 1) return { x: p.x + u * (q.x - p.x), y: p.y + u * (q.y - p.y), ...(a.ax ? { ax: a.ax } : {}), dx: p.dx + u * (q.dx - p.dx), dy: p.dy + u * (q.dy - p.dy) };
      }
      return fail(`${args[0]} and ${args[1]} do not cross in their range`);
    }
    case 'at': {
      if (args.length !== 2) fail(`at(curve, x=…) takes a curve and x=, y= or t=: "${s}"`);
      const c = curve(args[0], sc);
      const k = /^([xyt])\s*=\s*([\s\S]+)$/i.exec(args[1]);
      if (!k) return fail(`at(${args[0]}, …) needs x=, y= or t=: "${s}"`);
      const v = evalF(k[2], sc), which = lc(k[1]);
      if (c.kind === 'param') {
        if (which !== 't') fail(`${args[0]} is parametric: use at(${args[0]}, t=…)`);
        const [x, y] = c.f(v);
        if (!Number.isFinite(x) || !Number.isFinite(y)) fail(`${args[0]} has no point at t=${v}`);
        return mk(c.ax, x, y);
      }
      if (which === 'x') {
        const y = c.f(v);
        if (!Number.isFinite(y)) fail(`${args[0]} has no value at x=${v}`);
        return mk(c.ax, v, y);
      }
      if (which === 'y') {
        const x = root((x) => c.f(x) - v, c.dom[0], c.dom[1]);
        if (x == null) return fail(`${args[0]} never reaches y=${+v.toPrecision(6)} in its range`);
        return mk(c.ax, x, v);
      }
      return fail(`${args[0]} is y = f(x): use x= or y=`);
    }
    case 'max': case 'min': {
      if (args.length !== 1) fail(`${fn}(curve) takes one curve: "${s}"`);
      const c = curve(args[0], sc), ps = samples(c, 800);
      if (!ps.length) fail(`${args[0]} has no points`);
      const sgn = fn === 'max' ? 1 : -1;
      let best = ps[0];
      for (const p of ps) if (sgn * (p.dy - best.dy) > 0) best = p;
      if (c.kind === 'fn') {
        // Golden-section refine around the best sample.
        const h = (c.dom[1] - c.dom[0]) / 800;
        let a = Math.max(c.dom[0], best.dx - h), b = Math.min(c.dom[1], best.dx + h);
        for (let i = 0; i < 60; i++) { const m1 = a + (b - a) * 0.382, m2 = a + (b - a) * 0.618; if (sgn * (c.f(m1) - c.f(m2)) > 0) b = m2; else a = m1; }
        const x = (a + b) / 2, y = c.f(x);
        if (sgn * (y - best.dy) >= 0) return mk(c.ax, x, y);
      }
      return best;
    }
    case 'onx': case 'ony': {
      if (args.length !== 1) fail(`${fn}(P) takes one point: "${s}"`);
      const p = point(args[0], sc);
      if (!p.ax) return fail(`${fn}(${args[0]}): the point has no axes`);
      return fn === 'onx' ? mk(p.ax, p.dx, p.ax.y0) : mk(p.ax, p.ax.x0, p.dy);
    }
    case 'mid': {
      if (args.length !== 2) fail(`mid(P, Q) takes two points`);
      const p = point(args[0], sc), q = point(args[1], sc);
      return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, ...(p.ax ? { ax: p.ax } : {}), dx: (p.dx + q.dx) / 2, dy: (p.dy + q.dy) / 2 };
    }
  }
  const xy = splitTop(s, ',');
  if (xy.length === 2) { const x = evalF(xy[0], sc), y = evalF(xy[1], sc); return { x, y, dx: x, dy: y }; }
  if (/^[a-z_]\w*$/i.test(s)) return fail(`no point ${s}`);
  return fail(`not a point: "${s}"`);
}

/** Polyline(s) of a curve inside its frame (cut where it leaves; ends meet the frame's edge). */
function clipped(c: Curve, n = 240): DPt[][] {
  const ps = samples(c, n);
  if (!c.ax) return [ps];
  const { y0, y1, x0, x1 } = c.ax;
  const ylo = Math.min(y0, y1), yhi = Math.max(y0, y1), xlo = Math.min(x0, x1), xhi = Math.max(x0, x1);
  const inside = (p: DPt) => p.dy >= ylo - 1e-9 && p.dy <= yhi + 1e-9 && p.dx >= xlo - 1e-9 && p.dx <= xhi + 1e-9;
  const edge = (p: DPt, q: DPt): DPt => {
    // Where pq leaves the frame (y bound first; then x).
    let t = 1;
    for (const [v0, v1, b] of [[p.dy, q.dy, q.dy > yhi ? yhi : ylo], [p.dx, q.dx, q.dx > xhi ? xhi : xlo]] as const) if (v1 !== v0 && (v1 > yhi || v1 < ylo || b === xlo || b === xhi)) { const k = (b - v0) / (v1 - v0); if (k >= 0 && k <= 1) t = Math.min(t, k); }
    return mk(c.ax, p.dx + t * (q.dx - p.dx), p.dy + t * (q.dy - p.dy));
  };
  const out: DPt[][] = [];
  let cur: DPt[] = [];
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i], prev = ps[i - 1];
    if (inside(p)) {
      if (!cur.length && prev && !inside(prev)) cur.push(edge(p, prev));
      cur.push(p);
    } else if (cur.length) { cur.push(edge(cur[cur.length - 1], p)); out.push(cur); cur = []; }
  }
  if (cur.length) out.push(cur);
  return out.filter((l) => l.length > 1);
}

const dOf = (lines: { x: number; y: number }[][], close = false) => lines.map((l) => l.map((p, i) => `${i ? 'L' : 'M'}${r2(p.x)} ${r2(p.y)}`).join('') + (close ? 'Z' : '')).join('');

/**
 * Formats a computed value: `fmt`'s decimals (values/format.ts: "2", "0.00", ".2f"; a percent format
 * shows v × 100, its "%" is the caller's affix), else about 3 significant figures (thousands grouped from 10,000).
 */
export function fmtValue(v: number, fmt?: string | null): string {
  const f = readFormat(fmt);
  if (f?.percent) v *= 100;
  const dp = f ? f.dp : Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : Math.abs(v) >= 1 ? 2 : 3;
  let s = v.toFixed(dp);
  if (!f && s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  if (s === '-0') s = '0';
  if (Math.abs(v) >= 10000) { const [i, f] = s.split('.'); s = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f ? `.${f}` : ''); }
  return s.replace(/^-/, '−');
}
/** A number with its unit, as a bare data-val or a tick writes it ("12%", "$10", "5 m"): quantity.ts. */
const withUnit = (v: string, u: string | null, fmt?: string | null) => drawText(readFormat(fmt)?.percent ? `${v}%` : v, readTemplate(null, u));

const ATTRS_DATA = ['data-const', 'data-axes', 'data-fn', 'data-param', 'data-between', 'data-at', 'data-from', 'data-to', 'data-points', 'data-set', 'data-rotate', 'data-translate', 'data-val', 'data-slide'];
/** Whether an element (or its subtree) uses the data attributes. */
export const hasData = (el: Element): boolean => ATTRS_DATA.some((a) => el.hasAttribute(a)) || !!el.querySelector(ATTRS_DATA.map((a) => `[${a}]`).join(','));
/** Whether an element's geometry depends on the constants (re-resolved each frame). */
export const isBound = (el: Element): boolean => ATTRS_DATA.slice(2).some((a) => el.hasAttribute(a)) || (el.hasAttribute('data-axes') && (el.hasAttribute('data-ticks-x') || el.hasAttribute('data-ticks-y') || el.hasAttribute('data-frame')));

/** Parses "a=1 b=2*a" (space or ; separated) into ordered defs. */
export function constDefs(src: string): [string, string][] {
  const out: [string, string][] = [];
  for (const part of src.trim().split(/[;\s]+(?=[A-Za-z]\w*\s*=(?!=))/)) {
    const m = /^([A-Za-z]\w*)\s*=(?!=)\s*([\s\S]+?)[;\s]*$/.exec(part.trim());
    if (m) out.push([m[1], m[2].trim()]);
  }
  return out;
}

const own = (el: Element, a: string, sc: DataScope, el0: Element) => el.getAttribute(a) ?? inheritAxes(el0, a);
function inheritAxes(el: Element, a: string): string | null {
  if (a !== 'data-axes') return null;
  // A data element inside an axes group uses it by default.
  for (let e = el.parentElement; e; e = e.parentElement) { const v = e.getAttribute('data-axes'); if (v) return v; }
  return null;
}

export type Problem = { el: Element; detail: string };

/**
 * Resolves every data attribute in `g` (in document order) against `sc`, writing geometry and text
 * in place. Returns the problems (the elements are left as they were; the caller hides or flags them).
 * `doc` creates tick marks (defaults to the element's own document).
 */
export function resolveData(g: Element, sc: DataScope): Problem[] {
  const problems: Problem[] = [];
  const els = [g, ...Array.from(g.querySelectorAll('*'))];
  for (const el of els) {
    if (!(el.getAttributeNames?.() ?? []).some((a) => a.startsWith('data-'))) continue;
    if (el.hasAttribute('data-engine')) continue; // the engine's own ticks
    try { resolveOne(el, sc); el.removeAttribute('data-bad'); }
    catch (e) {
      if (!(e instanceof DataError)) throw e;
      el.setAttribute('data-bad', e.message);
      problems.push({ el, detail: e.message });
    }
  }
  snapMarkers(g, sc);
  return problems;
}

/**
 * A dot the model placed by hand on a plot (cx/cy, no data-at) beside a crossing of the frame's named
 * data-fn curves was often that crossing a little off (C1, 2026-10-31: a dot labelled E drawn beside the
 * curves' real crossing, so the picture and its numbers disagreed). What the dot means decides, not only
 * where it is (review, numbers-agree: a ceiling's Qd and Qs, each on its curve 14 px from E, both became E;
 * data points ±10 px about a line lost their residuals; a dot labelled E past the crossing's reach was put
 * on the demand curve):
 *  - labelled as a crossing (E, E*, eq, equilibrium…: the short text beside it): within reach of exactly
 *    one crossing, placed at cross(a,b); within reach of none, marked data-snap-off (the gate fails it);
 *  - labelled with a curve's name: within reach of that curve, placed on it at at(c, x=…);
 *  - unlabelled, and on a curve already (within SNAP_ON): a point of that curve, left where it is;
 *  - unlabelled, off every curve, within reach of exactly one crossing: placed at cross(a,b);
 *  - unlabelled, near a curve but not on it: left where it is, marked data-snap-near (a note: data with
 *    a residual looks the same as a point drawn a little off).
 * A placed dot gets data-at (data-snapped keeps what it became): from then on the engine places it, so it
 * follows a tween and the gate checks the point that is drawn. Reach is relative to the frame's shorter
 * side. Two crossings in reach: never guessed; marked data-snap-ambiguous for the gate. A dot in a
 * [data-schematic] group or a transformed one is left as it is. Each dot is decided once (data-snap-done):
 * a later resolve (a tween's frame) never snaps what the first left.
 */
export const SNAP_CROSS = 0.08, SNAP_CURVE = 0.04, SNAP_ON = 0.01, SNAP_LABEL = 0.08;
/** A label that names a crossing: E, E1, E*, E′, eq, equilibrium, crossing, intersection. */
const CROSS_LABEL = /^(e|eq\.?|equilibrium|crossing|intersection)\s*[*′'’₀-₉\d]*$/i;
/** A point marker: a small circle (or ellipse), r ≤ 8 board units. */
export const isMarker = (el: Element): boolean => {
  const t = el.nodeName.toLowerCase().replace(/^svg:/, '');
  const r = (k: string) => parseFloat(el.getAttribute(k) ?? '');
  return t === 'circle' ? r('r') > 0 && r('r') <= 8 : t === 'ellipse' && r('rx') > 0 && r('rx') <= 8 && r('ry') > 0 && r('ry') <= 8;
};
/** Placed by the engine: its own data-at / data-set of its centre, or an ancestor's data-at / data-translate. */
/**
 * The attributes an element's data-set computes ("opacity", "x" …): the engine owns them, so the style
 * passes (grammar, sanitize) leave them alone. A reveal's opacity 0 is "not yet", not a faint label.
 */
export const setAttrs = (el: Element): Set<string> => new Set(splitTop(el.getAttribute('data-set') ?? '', ';').map((p) => p.slice(0, p.indexOf(':')).trim().toLowerCase()).filter(Boolean));
export const enginePlaced = (el: Element): boolean => el.hasAttribute('data-at') || /\bc[xy]\s*:/.test(el.getAttribute('data-set') ?? '') || !!el.parentElement?.closest('[data-at],[data-translate]');
function snapMarkers(g: Element, sc: DataScope): void {
  const marks = [g, ...Array.from(g.querySelectorAll('circle,ellipse'))].filter((el) => isMarker(el) && !el.hasAttribute('data-snap-done') && !enginePlaced(el) && !el.closest('[data-schematic],[data-engine],[data-defs]') && !el.hasAttribute('data-bad'));
  // Decided once, on the first resolve: a tween frame never moves a dot the first draw left where it was.
  for (const el of marks) el.setAttribute('data-snap-done', '');
  if (!marks.length || !sc.curves.size) return;
  // Short hand-written texts (not readouts, not the engine's ticks): the labels a dot may carry.
  const labels = Array.from(g.querySelectorAll('text')).filter((t) => !t.closest('[data-engine],[data-val]') && !t.querySelector('[data-val]'))
    .map((t) => ({ s: (t.textContent ?? '').trim(), x: parseFloat(t.getAttribute('x') ?? ''), y: parseFloat(t.getAttribute('y') ?? '') }))
    .filter((t) => t.s && t.s.length <= 14 && Number.isFinite(t.x) && Number.isFinite(t.y));
  for (const el of marks) {
    let tf = false;
    for (let e: Element | null = el; e && !tf; e = e === g ? null : e.parentElement) tf = !!e.getAttribute('transform');
    if (tf) continue;
    const p = { x: parseFloat(el.getAttribute('cx') ?? ''), y: parseFloat(el.getAttribute('cy') ?? '') };
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    let ax: Axes | null = null;
    for (const name of sc.axes.keys()) { try { const a = axesOf(name, sc)!; const b = a.box; if (p.x >= b.x - 2 && p.x <= b.x + b.w + 2 && p.y >= b.y - 2 && p.y <= b.y + b.h + 2) { ax = a; break; } } catch { /* a bad frame snaps nothing */ } }
    if (!ax) continue;
    const reach = Math.min(ax.box.w, ax.box.h);
    const names = [...sc.curves.entries()].filter(([k, c]) => c.kind === 'fn' && !k.startsWith('_c') && lc(c.ax ?? '') === lc(ax!.name)).map(([k]) => k);
    const d = (q: { x: number; y: number }) => Math.hypot(q.x - p.x, q.y - p.y);
    const crosses: { at: string; q: DPt }[] = [];
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
      try { const q = point(`cross(${names[i]},${names[j]})`, sc); if (d(q) <= SNAP_CROSS * reach && !crosses.some((h) => Math.hypot(h.q.x - q.x, h.q.y - q.y) < 1)) crosses.push({ at: `cross(${names[i]},${names[j]})`, q }); } catch { /* they do not cross */ }
    }
    // Each curve's nearest point to the dot.
    const near: { n: string; at: string; q: DPt }[] = [];
    for (const n of names) {
      try {
        const q = samples(curve(n, sc), 480).reduce<DPt | null>((b, s) => (!b || d(s) < d(b) ? s : b), null);
        if (q && d(q) <= SNAP_CURVE * reach) near.push({ n, at: `at(${n}, x=${+q.dx.toPrecision(6)})`, q });
      } catch { /* a curve that does not resolve */ }
    }
    const lab = labels.filter((t) => Math.hypot(t.x - p.x, t.y - p.y) <= SNAP_LABEL * reach).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0]?.s;
    const onCurve = near.some((h) => d(h.q) <= SNAP_ON * reach);
    let hits: { at: string; q: DPt }[] = [];
    if (lab && CROSS_LABEL.test(lab)) {
      if (!crosses.length) { el.setAttribute('data-snap-off', lab); continue; }
      hits = crosses;
    } else if (lab && names.some((n) => lc(n) === lc(lab))) hits = near.filter((h) => lc(h.n) === lc(lab));
    else if (!onCurve) {
      hits = crosses;
      if (!hits.length && near.length) { el.setAttribute('data-snap-near', near.map((h) => h.at).join(' | ')); continue; }
    }
    if (hits.length > 1) { el.setAttribute('data-snap-ambiguous', hits.map((h) => h.at).join(' | ')); continue; }
    if (!hits.length) continue;
    el.setAttribute('data-at', hits[0].at);
    el.setAttribute('data-snapped', hits[0].at);
    try { resolveOne(el, sc); } catch { el.removeAttribute('data-at'); el.removeAttribute('data-snapped'); }
  }
}

function nameOf(el: Element): string | null { return el.getAttribute('data-name') ?? el.getAttribute('data-svg-id') ?? el.getAttribute('id'); }

function resolveOne(el: Element, sc: DataScope): void {
  const tag = el.nodeName.toLowerCase().replace(/^svg:/, '');
  // Stamp the model's name once (the sanitizer namespaces ids later).
  if (!el.hasAttribute('data-name') && el.getAttribute('id') && (el.hasAttribute('data-fn') || el.hasAttribute('data-param') || el.hasAttribute('data-at') || el.hasAttribute('data-axes') && el.hasAttribute('data-box'))) el.setAttribute('data-name', el.getAttribute('id')!);
  const dc = el.getAttribute('data-const');
  if (dc != null && !el.hasAttribute('data-const-done')) {
    const defs = constDefs(dc);
    if (!defs.length) fail(`data-const "${dc}" defines nothing (write name=value pairs)`);
    if (sc.define) sc.define(defs); else for (const [k, v] of defs) sc.consts[lc(k)] = evalF(v, sc);
    el.setAttribute('data-const-done', '');
  }
  // A sliding window the engine draws (slide.ts), at its step constant.
  if (el.hasAttribute('data-slide')) {
    const step = el.getAttribute('data-step') ?? 'k';
    if (!(lc(step) in sc.consts)) fail(`data-slide steps on ${step}: define it first (data-const="${step}=0")`);
    sc.calcs ??= new Map();
    try { drawSlide(el, sc, sc.consts[lc(step)]); } catch (e) { if (e instanceof SlideError) fail(e.message); throw e; }
  }
  // A frame.
  if (el.hasAttribute('data-box') && el.hasAttribute('data-axes')) {
    const name = el.getAttribute('data-axes')!;
    sc.axes.set(lc(name), { name, src: [el.getAttribute('data-x') ?? '', el.getAttribute('data-y') ?? '', el.getAttribute('data-box') ?? ''] });
    const ax = axesOf(name, sc)!;
    drawFrame(el, ax, sc);
  }
  const axName = el.hasAttribute('data-box') ? null : own(el, 'data-axes', sc, el);
  const nm = nameOf(el);
  if (el.hasAttribute('data-fn')) {
    const spec: CurveSpec = { kind: 'fn', src: el.getAttribute('data-fn')!, ax: axName, dom: el.getAttribute('data-x') ?? el.getAttribute('data-domain') };
    const key = lc(nm ?? `_c${sc.curves.size}`);
    sc.curves.set(key, spec);
    try { const c = curve(key, sc); el.setAttribute('d', dOf(clipped(c))); }
    catch (e) { sc.curves.delete(key); throw e; }
  }
  if (el.hasAttribute('data-param')) {
    const xy = splitTop(el.getAttribute('data-param')!, ',');
    if (xy.length !== 2) fail(`data-param takes "x(t), y(t)"`);
    const spec: CurveSpec = { kind: 'param', src: [xy[0], xy[1]], ax: axName, t: el.getAttribute('data-t') ?? '0,1' };
    const key = lc(nm ?? `_c${sc.curves.size}`);
    sc.curves.set(key, spec);
    try { const c = curve(key, sc); el.setAttribute('d', dOf(clipped(c))); }
    catch (e) { sc.curves.delete(key); throw e; }
  }
  if (el.hasAttribute('data-between')) {
    const [a, b] = splitTop(el.getAttribute('data-between')!, ',');
    if (!a || !b) fail(`data-between takes "curve, curve" or "curve, level"`);
    const ca = curve(a, sc);
    if (ca.kind !== 'fn') throw new DataError(`data-between needs y = f(x) curves (${a} is parametric)`);
    const cb = sc.curves.has(lc(b)) ? curve(b, sc) : null;
    if (cb && cb.kind !== 'fn') throw new DataError(`data-between needs y = f(x) curves (${b} is parametric)`);
    const level = cb ? null : evalF(b, sc);
    const fb: (x: number) => number = cb && cb.kind === 'fn' ? cb.f : () => level!;
    const xr = el.getAttribute('data-x');
    let [lo, hi] = xr ? splitTop(xr, ',').map((v) => evalF(v, sc)) : [Math.max(ca.dom[0], cb?.dom[0] ?? -Infinity), Math.min(ca.dom[1], cb?.dom[1] ?? Infinity)];
    if (lo > hi) [lo, hi] = [hi, lo];
    if (!(hi > lo)) fail(`data-between: an empty x range`);
    const ax = ca.ax;
    const clampY = (y: number) => (ax ? Math.max(Math.min(ax.y0, ax.y1), Math.min(Math.max(ax.y0, ax.y1), y)) : y);
    const N = 120, top: { x: number; y: number }[] = [], bot: { x: number; y: number }[] = [];
    for (let i = 0; i <= N; i++) { const x = lo + ((hi - lo) * i) / N; const ya = ca.f(x), yb = fb(x); if (!Number.isFinite(ya) || !Number.isFinite(yb)) fail(`data-between: no value at x=${+x.toPrecision(4)}`); top.push(toBoard(ax, x, clampY(ya))); bot.push(toBoard(ax, x, clampY(yb))); }
    el.setAttribute('d', dOf([[...top, ...bot.reverse()]], true));
  }
  if (el.hasAttribute('data-at')) {
    const p = point(el.getAttribute('data-at')!, sc);
    if (nm) sc.points.set(lc(nm), p);
    place(el, tag, p);
  }
  if (el.hasAttribute('data-from') || el.hasAttribute('data-to')) {
    const a = point(el.getAttribute('data-from') ?? fail('data-to needs data-from'), sc), b = point(el.getAttribute('data-to') ?? fail('data-from needs data-to'), sc);
    if (tag === 'line') { el.setAttribute('x1', r2(a.x)); el.setAttribute('y1', r2(a.y)); el.setAttribute('x2', r2(b.x)); el.setAttribute('y2', r2(b.y)); }
    else if (tag === 'path') el.setAttribute('d', dOf([[a, b]]));
    else fail(`data-from/data-to go on a <line> or <path>`);
  }
  if (el.hasAttribute('data-points')) {
    const ps = splitTop(el.getAttribute('data-points')!, ';').map((s) => point(s, sc));
    if (ps.length < 2) fail(`data-points needs two or more points ("P; Q; R")`);
    const pts = ps.map((p) => `${r2(p.x)},${r2(p.y)}`).join(' ');
    if (tag === 'polyline' || tag === 'polygon') el.setAttribute('points', pts);
    else if (tag === 'path') el.setAttribute('d', dOf([ps], el.hasAttribute('data-closed')));
    else fail(`data-points go on a <polyline>, <polygon> or <path>`);
  }
  if (el.hasAttribute('data-set')) {
    for (const part of splitTop(el.getAttribute('data-set')!, ';')) {
      const i = part.indexOf(':');
      if (i < 0) fail(`data-set takes "attr: formula; …" ("${part}")`);
      const k = part.slice(0, i).trim().toLowerCase();
      if (!/^(x|y|x1|y1|x2|y2|cx|cy|r|rx|ry|width|height|opacity|fill-opacity|stroke-opacity|font-size|dx|dy)$/.test(k)) fail(`data-set cannot set ${k}`);
      const v = evalF(part.slice(i + 1), sc);
      el.setAttribute(k, r2(v));
    }
  }
  if (el.hasAttribute('data-rotate') || el.hasAttribute('data-translate') || el.hasAttribute('data-at') && !/^(circle|ellipse|text|rect)$/.test(tag)) {
    if (!el.hasAttribute('data-tf0')) el.setAttribute('data-tf0', el.getAttribute('transform') ?? '');
    const parts: string[] = [];
    const at = el.getAttribute('data-at-xy');
    if (at) parts.push(`translate(${at})`);
    const t0 = el.getAttribute('data-tf0');
    if (t0) parts.push(t0);
    if (el.hasAttribute('data-translate')) { const v = splitTop(el.getAttribute('data-translate')!, ',').map((s) => evalF(s, sc)); if (v.length !== 2) fail(`data-translate takes "dx, dy"`); parts.push(`translate(${r2(v[0])} ${r2(v[1])})`); }
    if (el.hasAttribute('data-rotate')) { const v = splitTop(el.getAttribute('data-rotate')!, ',').map((s) => evalF(s, sc)); if (v.length !== 1 && v.length !== 3) fail(`data-rotate takes "deg" or "deg, cx, cy"`); parts.push(`rotate(${v.map(r2).join(' ')})`); }
    if (parts.length) el.setAttribute('transform', parts.join(' ')); else el.removeAttribute('transform');
  }
  if (el.hasAttribute('data-val')) {
    const src = el.getAttribute('data-val')!;
    if (!el.hasAttribute('data-tpl')) el.setAttribute('data-tpl', el.textContent ?? '');
    const tpl = el.getAttribute('data-tpl')!;
    // Several numbers in one text ("valid: {} × {}", data-val="n-m+1, n-m+1"): each {} takes the next formula,
    // so a line never has to be split into texts that the layout can pull apart (a live answer lost its second 3).
    const parts = splitTop(src, ','), holes = tpl.split('{}').length - 1;
    if (parts.length > 1 && holes === parts.length) {
      const fmt = el.getAttribute('data-fmt');
      const vs = parts.map((p) => evalF(p, sc));
      let i = 0;
      const text = tpl.replace(/\{\}/g, () => fmtValue(vs[i++], fmt));
      vs.forEach((v, j) => sc.values.push({ v, of: `${nm ?? src}#${j}`, ...(j === 0 && nm ? { id: nm } : {}), text: fmtValue(v, fmt), ...(fmt != null ? { fmt } : {}) }));
      if (tag !== 'text' && tag !== 'tspan') fail(`data-val goes on a <text> or <tspan>`);
      const kids = Array.from(el.childNodes);
      const tn = kids.find((k) => k.nodeType === 3 && (k.textContent ?? '').trim());
      if (tn && !kids.every((k) => k.nodeType === 3)) tn.textContent = text; else el.textContent = text;
      return;
    }
    if (parts.length > 1 && holes !== parts.length && holes > 1) fail(`data-val has ${parts.length} formulas for ${holes} {} in its text`);
    const v = evalF(src, sc);
    // One reading of the text drives both what is drawn and what is said ({{val}}): "{}" in the text's own
    // words takes the number (the words carry its affixes), else the value + data-unit.
    const fmt = el.getAttribute('data-fmt');
    const t0 = readTemplate(tpl, el.getAttribute('data-unit'));
    // A percent format ("0%") shows the fraction as a percent: its "%" is the quantity's, unless the text writes one.
    const t = readFormat(fmt)?.percent && !t0.post.startsWith('%') ? { ...t0, post: `%${t0.post}` } : t0;
    const label = valueLabel(tpl), words = valueWords(tpl);
    const num = fmtValue(v, fmt);
    const affix = t.pre || t.post ? { pre: t.pre, post: t.post } : undefined;
    sc.values.push({ v, of: nm ?? src, ...(label ? { label } : {}), ...(nm ? { id: nm } : {}), text: num, ...(t.unit ? { unit: t.unit } : {}), ...(affix ? { affix } : {}), ...(fmt != null ? { fmt } : {}), ...(words.length ? { words } : {}) });
    const text = drawText(num, t);
    if (tag === 'text' || tag === 'tspan') {
      // The text's own words (its first text node) take the value; tspans keep theirs.
      const kids = Array.from(el.childNodes);
      const tn = kids.find((k) => k.nodeType === 3 && (k.textContent ?? '').trim()) ?? kids.find((k) => k.nodeType === 3);
      if (tn && kids.every((k) => k.nodeType === 3)) el.textContent = text;
      else if (tn) tn.textContent = text;
      else el.textContent = text;
    } else fail(`data-val goes on a <text> or <tspan>`);
  }
}

function place(el: Element, tag: string, p: DPt): void {
  if (tag === 'circle' || tag === 'ellipse') { el.setAttribute('cx', r2(p.x)); el.setAttribute('cy', r2(p.y)); return; }
  if (tag === 'text') { el.setAttribute('x', r2(p.x)); el.setAttribute('y', r2(p.y)); return; }
  if (tag === 'rect') { const w = parseFloat(el.getAttribute('width') ?? '0') || 0, h = parseFloat(el.getAttribute('height') ?? '0') || 0; el.setAttribute('x', r2(p.x - w / 2)); el.setAttribute('y', r2(p.y - h / 2)); return; }
  el.setAttribute('data-at-xy', `${r2(p.x)} ${r2(p.y)}`);
}

/** A frame's L axes (data-frame) and ticks (data-ticks-x / -y), drawn by the engine inside the axes group. */
function drawFrame(el: Element, ax: Axes, sc: DataScope): void {
  const tx = el.getAttribute('data-ticks-x'), ty = el.getAttribute('data-ticks-y');
  if (!el.hasAttribute('data-frame') && !tx && !ty) return;
  // A redraw keeps the size the board's grammar gave the ticks (grammar.ts: small).
  const was = el.querySelector(':scope > text[data-engine]')?.getAttribute('font-size');
  for (const old of Array.from(el.querySelectorAll(':scope > [data-engine]'))) old.remove();
  const doc = el.ownerDocument;
  const add = (name: string, attrs: Record<string, string>, text?: string) => {
    const e = doc.createElementNS(SVGNS, name);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    e.setAttribute('data-engine', '');
    if (text != null) e.textContent = text;
    el.insertBefore(e, el.firstChild);
    return e;
  };
  const { x, y, w, h } = ax.box, fs = was ?? '15';
  const fmt = el.getAttribute('data-fmt');
  const nums = (s: string) => splitTop(s, ',').map((v) => evalF(v, sc));
  // Inserted at the front in reverse: texts last-in-front so the L draws first.
  if (ty) for (const v of nums(ty).reverse()) { const p = toBoard(ax, ax.x0, v); if (p.y < y - 0.5 || p.y > y + h + 0.5) continue; add('text', { x: r2(x - 10), y: r2(p.y), 'text-anchor': 'end', 'dominant-baseline': 'middle', 'font-size': String(fs), fill: '#1D1D1F', 'data-tick': '', 'data-role': 'small' }, withUnit(fmtValue(v, fmt), el.getAttribute('data-unit-y'), fmt)); }
  if (tx) for (const v of nums(tx).reverse()) { const p = toBoard(ax, v, ax.y0); if (p.x < x - 0.5 || p.x > x + w + 0.5) continue; add('text', { x: r2(p.x), y: r2(y + h + 8), 'text-anchor': 'middle', 'dominant-baseline': 'hanging', 'font-size': String(fs), fill: '#1D1D1F', 'data-tick': '', 'data-role': 'small' }, withUnit(fmtValue(v, fmt), el.getAttribute('data-unit-x'), fmt)); }
  if (ty) for (const v of nums(ty).reverse()) { const p = toBoard(ax, ax.x0, v); if (p.y < y - 0.5 || p.y > y + h + 0.5) continue; add('line', { x1: r2(x - 5), y1: r2(p.y), x2: r2(x), y2: r2(p.y), stroke: '#6E6E73', 'stroke-width': '1' }); }
  if (tx) for (const v of nums(tx).reverse()) { const p = toBoard(ax, v, ax.y0); if (p.x < x - 0.5 || p.x > x + w + 0.5) continue; add('line', { x1: r2(p.x), y1: r2(y + h), x2: r2(p.x), y2: r2(y + h + 5), stroke: '#6E6E73', 'stroke-width': '1' }); }
  if (el.hasAttribute('data-frame')) add('path', { d: `M${r2(x)} ${r2(y)}L${r2(x)} ${r2(y + h)}L${r2(x + w)} ${r2(y + h)}`, fill: 'none', stroke: '#3A3A3C', 'stroke-width': '2' });
}

/**
 * The words a readout's text puts before its number: "SSD = {}" → "ssd", "center output: {}" → "center output",
 * "{} min" → undefined. Lower-cased, punctuation dropped; what the narration would call the quantity.
 */
export function valueLabel(tpl: string): string | undefined {
  const head = tpl.includes('{}') ? tpl.slice(0, tpl.indexOf('{}')) : tpl;
  const words = head.toLowerCase().replace(/[=:≈~]/g, ' ').replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).filter(Boolean);
  return words.length && words.length <= 4 ? words.join(' ') : undefined;
}

// The unit vocabulary is src/values/units.ts (shared with the narration's number check and with {{val}}).
const FILLER = new Set(['a', 'an', 'the', 'of', 'at', 'is', 'in', 'on', 'to', 'by', 'for', 'and', 'or', 'it', 'its', 'per', 'now', 'than']);
/** A readout's own words, lower-cased, its unit and filler dropped: what a sentence about it would say. */
export const valueWords = (tpl: string): string[] =>
  [...new Set(tpl.replace('{}', ' ').toLowerCase().replace(/[^\p{L}\s'-]/gu, ' ').split(/\s+/).filter((w) => w && !FILLER.has(w) && !isUnitWord(w)))].slice(0, 8);
