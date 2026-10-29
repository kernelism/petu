// src/agent/context/charts.ts — figure calibration: a page's chart axes, fitted to data → page maps.
import type { Pt } from '../../script/types';
import type { PageRect } from '../../geometry/space';
import type { PaintedPath } from './marks';
import type { TextLine } from './textLines';
import type { GroundMark, Grounding } from '../../geometry/resolve';

/**
 * One calibrated axis: data value `lo` sits at page coordinate `p0`, `hi` at `p1` (x axis: page x;
 * y axis: page y, so p0 > p1 when values grow upward). `log`: the map is linear in log10(value).
 */
export type ChartAxis = { name?: string; lo: number; hi: number; p0: number; p1: number; log?: boolean };
/** A calibrated chart (`#c1`): its plot box (the axes' extent, model coords) and one map per axis. */
export type Chart = { id: string; rect: PageRect; x: ChartAxis; y: ChartAxis };

const lin = (a: ChartAxis, v: number): number | null => {
  if (a.log) {
    if (!(v > 0) || !(a.lo > 0) || !(a.hi > 0)) return null;
    return a.p0 + ((Math.log10(v) - Math.log10(a.lo)) / (Math.log10(a.hi) - Math.log10(a.lo))) * (a.p1 - a.p0);
  }
  return a.p0 + ((v - a.lo) / (a.hi - a.lo)) * (a.p1 - a.p0);
};

/** Data → page (model coords). null when a log axis gets a value ≤ 0. */
export function chartToPage(c: Pick<Chart, 'x' | 'y'>, d: Pt): Pt | null {
  const x = lin(c.x, d.x), y = lin(c.y, d.y);
  return x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y) ? null : { x, y };
}

/**
 * The calibrated charts of the latest grounding the app built (groundingOf): the live parser's value
 * model reads a chart's axes from here at parse time, so a {{find}} on a chart plot is said with the
 * engine's value. Only chart marks (`#cN`) are served; the gate and tests pass their own grounding.
 */
let memo: Grounding | undefined;
export function noteCharts(g: Grounding | undefined): void { memo = g; }
export const latestCharts: Grounding = {
  mark: (page: number, id: string): GroundMark | undefined => (/^#c\d+$/.test(id) ? memo?.mark(page, id) : undefined),
};

// ---------------------------------------------------------------------------------------------
// Detection. Everything below works in "x units": x as is, y × aspect, so lengths compare across
// both directions. Evidence, in order: long axis-aligned strokes (axes, arrow shafts, a plot frame),
// short perpendicular strokes touching them (ticks, or gridlines starting on them), numeric text in
// one row just below an x axis / one column just left of a y axis, snapped to the ticks, fitted by
// least squares. Anything ambiguous is dropped: a wrong calibration is worse than none.

type Box = { x0: number; y0: number; x1: number; y1: number };
type Seg = { x0: number; y0: number; x1: number; y1: number }; // horizontal: y0 = y1; vertical: x0 = x1, sorted ends
type Tok = { v: number; dec: number; pow: boolean; plain10: boolean; b: Box };
type Cal = { a: number; b: number; log: boolean; toks: Tok[]; pos: number[]; snapped: boolean };
type XAxis = { y: number; x0: number; x1: number; cal: Cal; dist: number };
type YAxis = { x: number; y0: number; y1: number; cal: Cal; dist: number };

/** Axis strokes shorter than this (x units) are not axes. */
const AXIS_MIN = 40;
/** A tick: a perpendicular stroke at most this long (longer ones count only when they start on the axis: gridlines). */
const TICK_MAX = 15;
/** An end this close to the axis line touches it. */
const TOUCH = 1.4;
/** Tick labels sit within this distance of their axis (x units), or 2.5 label heights. */
const LABEL_GAP = 25;

const MINUS = /[−–‒﹣－]/g;
const SUP: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-', '⁺': '+' };
const decimals = (s: string) => (/\.(\d+)/.exec(s)?.[1].length ?? 0);

/** A tick label's value: plain numbers (signs, decimals, thousands separators, %, $), powers (10^3, 10³, 1e3). */
export function parseTick(text: string): { v: number; dec: number; pow: boolean; plain10: boolean } | null {
  let t = text.trim().replace(/\s+/g, ' ').replace(MINUS, '-');
  if (!t || t.length > 16) return null;
  let m = /^(?:(\d+(?:\.\d+)?) ?[×x·] ?)?10 ?\^ ?\{?([+-]?\d{1,3})\}?$/.exec(t)
    ?? (() => { const s = /^(?:(\d+(?:\.\d+)?) ?[×x·] ?)?10([⁻⁺]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+)$/.exec(t); return s ? [s[0], s[1], [...s[2]].map((c) => SUP[c]).join('')] as unknown as RegExpExecArray : null; })();
  if (m) { const k = Number(m[2]); const mant = m[1] ? Number(m[1]) : 1; return { v: mant * 10 ** k, dec: Math.max(0, -k), pow: !m[1] || mant === 1, plain10: false }; }
  m = /^(-?\d+(?:\.\d+)?)[eE]([+-]?\d{1,3})$/.exec(t);
  if (m) { const mant = Number(m[1]), k = Number(m[2]); return { v: mant * 10 ** k, dec: Math.max(0, -k), pow: mant === 1, plain10: false }; }
  t = t.replace(/^\$ ?/, '').replace(/ ?[%°]$/, '');
  if (!/^[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?$/.test(t) || !/\d/.test(t)) return null;
  const v = Number(t.replace(/,/g, ''));
  if (!Number.isFinite(v)) return null;
  // "101", "10-3": a power of ten whose exponent was flattened into the same run. Ambiguous.
  return { v, dec: decimals(t), pow: false, plain10: /^10-?\d+$/.test(t) };
}

/** A line whose runs are "10" and a smaller raised exponent: 10^k (matplotlib, LaTeX). */
function powerFromRuns(l: TextLine): number | null {
  const rs = l.runs.filter((r) => r.text.trim());
  if (rs.length < 2) return null;
  const base = rs[0], rest = rs.slice(1);
  const bm = /^(?:(\d+(?:\.\d+)?) ?[×x·] ?)?10$/.exec(base.text.trim());
  if (!bm) return null;
  const e = rest.map((r) => r.text).join('').replace(/\s+/g, '').replace(MINUS, '-');
  if (!/^[-+]?\d{1,3}$/.test(e)) return null;
  const by = base.rect.y + base.rect.h / 2;
  if (!rest.every((r) => r.rect.h < 0.9 * base.rect.h && r.rect.y + r.rect.h / 2 < by)) return null;
  return (bm[1] ? Number(bm[1]) : 1) * 10 ** Number(e);
}

function tokensOf(lines: TextLine[], aspect: number): { toks: Tok[]; words: Box[] } {
  const toks: Tok[] = [], words: Box[] = [];
  const box = (r: PageRect): Box => ({ x0: r.x, y0: r.y * aspect, x1: r.x + r.w, y1: (r.y + r.h) * aspect });
  for (const l of lines) {
    if (l.runs.length && l.runs.every((r) => r.vertical)) { words.push(box(l.rect)); continue; }
    const pw = powerFromRuns(l);
    if (pw != null) { const e = Math.log10(pw); toks.push({ v: pw, dec: Math.max(0, -Math.round(e)), pow: true, plain10: false, b: box(l.rect) }); continue; }
    const n = parseTick(l.text);
    if (n) { toks.push({ ...n, b: box(l.rect) }); continue; }
    // A line merged from several numeric runs ("0 5 10" with wide gaps): each run on its own.
    const rs = l.runs.filter((r) => r.text.trim());
    const each = rs.length >= 2 ? rs.map((r) => parseTick(r.text)) : [];
    if (each.length && each.every(Boolean)) rs.forEach((r, i) => toks.push({ ...each[i]!, b: box(r.rect) }));
    else words.push(box(l.rect));
  }
  return { toks, words };
}

/** Straight strokes of the page's paths (curves skipped; a thin filled bar is its centre line). */
function strokes(paths: PaintedPath[], aspect: number): { h: Seg[]; v: Seg[] } {
  const h: Seg[] = [], v: Seg[] = [];
  const add = (ax: number, ay: number, bx: number, by: number) => {
    const dx = Math.abs(bx - ax), dy = Math.abs(by - ay), len = Math.hypot(dx, dy);
    if (len < 0.8) return;
    const tol = Math.max(0.6, 0.01 * len);
    if (dy <= tol) h.push({ x0: Math.min(ax, bx), x1: Math.max(ax, bx), y0: (ay + by) / 2, y1: (ay + by) / 2 });
    else if (dx <= tol) v.push({ x0: (ax + bx) / 2, x1: (ax + bx) / 2, y0: Math.min(ay, by), y1: Math.max(ay, by) });
  };
  for (const p of paths) {
    const need = [...p.ops].reduce((n, o) => n + (o === 'R' ? 4 : o === 'Z' ? 0 : 1), 0);
    if (need !== p.pts.length || !p.pts.length) continue; // thinned long path: not an axis
    const pts = p.pts.map((q) => ({ x: q.x, y: q.y * aspect }));
    if (p.paint === 'fill') {
      // A filled thin bar drawn as an axis or tick (some generators paint lines as rectangles).
      if (/C/.test(p.ops)) continue;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const q of pts) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
      const w = x1 - x0, hh = y1 - y0;
      if (hh <= 2 && w >= 3 * Math.max(hh, 0.3)) add(x0, (y0 + y1) / 2, x1, (y0 + y1) / 2);
      else if (w <= 2 && hh >= 3 * Math.max(w, 0.3)) add((x0 + x1) / 2, y0, (x0 + x1) / 2, y1);
      continue;
    }
    let k = 0, cur: { x: number; y: number } | null = null, start: { x: number; y: number } | null = null;
    for (const o of p.ops) {
      if (o === 'M') { cur = start = pts[k++]; }
      else if (o === 'L') { const q = pts[k++]; if (cur) add(cur.x, cur.y, q.x, q.y); cur = q; if (!start) start = q; }
      else if (o === 'C') { cur = pts[k++]; }
      else if (o === 'R') {
        const r = pts.slice(k, k + 4); k += 4;
        for (let i = 0; i < 4; i++) add(r[i].x, r[i].y, r[(i + 1) % 4].x, r[(i + 1) % 4].y);
        cur = start = r[0];
      } else if (o === 'Z') { if (cur && start) add(cur.x, cur.y, start.x, start.y); cur = start; }
    }
  }
  return { h, v };
}

/** Collinear pieces (a frame drawn edge by edge, a dashed spine) joined into one stroke. */
function merge(ss: Seg[], horiz: boolean): Seg[] {
  const at = (s: Seg) => (horiz ? s.y0 : s.x0), lo = (s: Seg) => (horiz ? s.x0 : s.y0), hi = (s: Seg) => (horiz ? s.x1 : s.y1);
  const sorted = [...ss].sort((a, b) => at(a) - at(b) || lo(a) - lo(b));
  const out: Seg[] = [];
  const rows: Seg[][] = [];
  for (const s of sorted) {
    const r = rows.find((g) => Math.abs(at(g[0]) - at(s)) <= 0.8);
    if (r) r.push(s); else rows.push([s]);
  }
  for (const r of rows) {
    r.sort((a, b) => lo(a) - lo(b));
    let a = lo(r[0]), b = hi(r[0]);
    const c = at(r[0]);
    const flush = () => out.push(horiz ? { x0: a, x1: b, y0: c, y1: c } : { x0: c, x1: c, y0: a, y1: b });
    for (const s of r.slice(1)) {
      if (lo(s) <= b + 1.5) b = Math.max(b, hi(s));
      else { flush(); a = lo(s); b = hi(s); }
    }
    flush();
  }
  return out;
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0; };

/**
 * Fits position = a + b·f(value) over the labels (f = log10 on a log axis). `dir` = +1 when
 * positions grow with values (x), −1 when they shrink (y, page y down). null: not a trusted axis.
 */
function fit(toks: Tok[], pos: number[], len: number, snapped: boolean, dir: 1 | -1): Cal | null {
  const n = toks.length;
  if (n < 2 || (n < 3 && !snapped)) return null;
  // Positions distinct, values strictly monotone in the expected direction.
  const order = toks.map((_, i) => i).sort((i, j) => pos[i] - pos[j]);
  for (let k = 1; k < n; k++) {
    const i = order[k - 1], j = order[k];
    if (pos[j] - pos[i] < 3) return null;
    if (dir * (toks[j].v - toks[i].v) <= 0) return null;
  }
  if (Math.max(...pos) - Math.min(...pos) < 0.2 * len) return null;
  // Flattened powers ("101 102 103"): the exponent is unreadable. Skip.
  if (toks.every((t) => t.plain10)) return null;
  const tol = snapped ? Math.max(0.7, 0.006 * len) : Math.max(1.5, 0.01 * len);
  const ls = (f: (v: number) => number) => {
    const xs = toks.map((t) => f(t.v));
    const mx = xs.reduce((s, x) => s + x, 0) / n, my = pos.reduce((s, y) => s + y, 0) / n;
    let sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (pos[i] - my); sxx += (xs[i] - mx) ** 2; }
    const b = sxy / sxx, a = my - b * mx;
    const res = Math.max(...xs.map((x, i) => Math.abs(a + b * x - pos[i])));
    return { a, b, res };
  };
  const positive = toks.every((t) => t.v > 0);
  const pow = toks.some((t) => t.pow) && positive;
  const L = ls((v) => v);
  const G = positive ? ls(Math.log10) : null;
  let log: boolean;
  if (pow) {
    // Powers of ten: a log axis unless the labels are spaced linearly (10, 20, 30… never pow).
    if (!G || G.res > tol) return null;
    log = true;
  } else if (n === 2) {
    // Two labels fit any map: a decade apart they could be a log axis. Skip that case.
    const r = Math.max(toks[0].v, toks[1].v) / Math.min(toks[0].v, toks[1].v);
    if (positive && r >= 10 && Math.abs(Math.log10(r) - Math.round(Math.log10(r))) < 1e-9) return null;
    log = false;
  } else if (L.res <= tol) log = false;
  else if (G && G.res <= tol && L.res > 4 * tol) log = true;
  else return null;
  const F = log ? G! : L;
  if (!Number.isFinite(F.b) || dir * F.b <= 0) return null;
  return { a: F.a, b: F.b, log, toks, pos, snapped };
}

/** Ticks touching an axis at `c` (the axis line) along [lo, hi]: positions along it. */
function ticksOn(perp: Seg[], horizAxis: boolean, c: number, lo: number, hi: number): number[] {
  const out: number[] = [];
  for (const s of perp) {
    const along = horizAxis ? s.x0 : s.y0;
    if (along < lo - 1.5 || along > hi + 1.5) continue;
    const a = horizAxis ? s.y0 : s.x0, b = horizAxis ? s.y1 : s.x1; // a ≤ b
    const len = b - a;
    const touches = Math.abs(a - c) <= TOUCH || Math.abs(b - c) <= TOUCH;
    const crosses = a < c && b > c && len <= TICK_MAX;
    if (!(touches || crosses)) continue;
    if (!touches && len > TICK_MAX) continue;
    const p = horizAxis ? s.x0 : s.y0;
    if (!out.some((q) => Math.abs(q - p) < 0.5)) out.push(p);
  }
  return out.sort((a, b) => a - b);
}

/** Snaps label centres to ticks. All labels must snap (one stray may be dropped), one label per tick. */
function snap(toks: Tok[], centre: (t: Tok) => number, tol: (t: Tok) => number, ticks: number[]): { toks: Tok[]; pos: number[] } | null {
  const keep: Tok[] = [], pos: number[] = [];
  let miss = 0;
  const used = new Set<number>();
  for (const t of toks) {
    let best = -1, bd = Infinity;
    ticks.forEach((p, i) => { const d = Math.abs(p - centre(t)); if (d < bd) { bd = d; best = i; } });
    if (best < 0 || bd > tol(t)) { miss++; continue; }
    if (used.has(best)) return null;
    used.add(best);
    keep.push(t); pos.push(ticks[best]);
  }
  if (miss > 1 || (miss === 1 && keep.length < 3)) return null;
  return { toks: keep, pos };
}

let trace: string[] | null = null;
const note = (s: string) => { trace?.push(s); };
const r1 = (v: number) => Math.round(v * 10) / 10;
/** Why each long stroke was or was not taken as an axis (for scripts/corpus/charts.ts --why). */
export function chartTrace(paths: PaintedPath[], lines: TextLine[], aspect: number): { charts: Chart[]; trace: string[] } {
  trace = [];
  try { return { charts: chartMarks(paths, lines, aspect), trace }; } finally { trace = null; }
}

const cx = (b: Box) => (b.x0 + b.x1) / 2, cy = (b: Box) => (b.y0 + b.y1) / 2;

function xAxes(H: Seg[], V: Seg[], toks: Tok[], words: Box[]): XAxis[] {
  const out: XAxis[] = [];
  for (const s of H) {
    const len = s.x1 - s.x0;
    if (len < AXIS_MIN) continue;
    const y = s.y0, slack = 0.05 * len;
    const below = toks.filter((t) => {
      const h = t.b.y1 - t.b.y0;
      return cx(t.b) >= s.x0 - slack && cx(t.b) <= s.x1 + slack && t.b.y0 >= y - 0.5 && t.b.y0 - y <= Math.max(LABEL_GAP, 2.5 * h);
    });
    if (below.length < 2) continue;
    // The row nearest the axis.
    const rows: Tok[][] = [];
    for (const t of [...below].sort((a, b) => a.b.y0 - b.b.y0)) {
      const r = rows.find((g) => Math.abs(cy(g[0].b) - cy(t.b)) <= 0.5 * Math.min(g[0].b.y1 - g[0].b.y0, t.b.y1 - t.b.y0));
      if (r) r.push(t); else rows.push([t]);
    }
    const row = rows[0];
    if (row.length < 2) { note(`x@${r1(y)} ${r1(s.x0)}–${r1(s.x1)}: nearest row has one number`); continue; }
    const ry = cy(row[0].b), rh = row[0].b.y1 - row[0].b.y0;
    // A row with words between its numbers is a table row, not tick labels.
    if (words.some((w) => Math.abs(cy(w) - ry) <= 0.5 * rh && cx(w) > s.x0 && cx(w) < s.x1)) { note(`x@${r1(y)}: words in the label row`); continue; }
    const gap = row[0].b.y0 - y;
    const ticks = ticksOn(V, true, y, s.x0, s.x1);
    const sorted = [...row].sort((a, b) => cx(a.b) - cx(b.b));
    let cal: Cal | null = null;
    if (ticks.length >= 2) {
      const sn = snap(sorted, (t) => cx(t.b), (t) => Math.max(2.5, 0.35 * (t.b.x1 - t.b.x0)), ticks);
      if (sn) cal = fit(sn.toks, sn.pos, len, true, 1);
      else cal = null;
    } else cal = fit(sorted, sorted.map((t) => cx(t.b)), len, false, 1);
    note(`x@${r1(y)} ${r1(s.x0)}–${r1(s.x1)}: labels ${sorted.map((t) => t.v).join(',')} ticks ${ticks.map(r1).join(',')} → ${cal ? (cal.log ? 'log' : 'linear') : 'no fit'}`);
    if (cal) out.push({ y, x0: s.x0, x1: s.x1, cal, dist: gap });
  }
  return dedupe(out);
}

function yAxes(V: Seg[], H: Seg[], toks: Tok[], words: Box[]): YAxis[] {
  const out: YAxis[] = [];
  for (const s of V) {
    const len = s.y1 - s.y0;
    if (len < AXIS_MIN) continue;
    const x = s.x0, slack = 0.03 * len;
    const left = toks.filter((t) => {
      const h = t.b.y1 - t.b.y0;
      return cy(t.b) >= s.y0 - slack && cy(t.b) <= s.y1 + slack && t.b.x1 <= x + 0.5 && x - t.b.x1 <= Math.max(LABEL_GAP, 2.5 * h);
    });
    if (left.length < 2) continue;
    // The column nearest the axis: tokens overlapping the nearest one's x-span, or right-aligned with it.
    const near = left.reduce((a, b) => (b.b.x1 > a.b.x1 ? b : a));
    const col = left.filter((t) => Math.abs(t.b.x1 - near.b.x1) <= 2.5 || (t.b.x0 < near.b.x1 && t.b.x1 > near.b.x0));
    if (col.length < 2) { note(`y@${r1(x)}: nearest column has one number`); continue; }
    const c0 = Math.min(...col.map((t) => t.b.x0)), c1 = Math.max(...col.map((t) => t.b.x1));
    if (words.some((w) => w.x0 < c1 && w.x1 > c0 && cy(w) > s.y0 && cy(w) < s.y1 && w.y1 - w.y0 < 3 * (near.b.y1 - near.b.y0))) { note(`y@${r1(x)}: words in the label column`); continue; }
    const ticks = ticksOn(H, false, x, s.y0, s.y1);
    const sorted = [...col].sort((a, b) => cy(a.b) - cy(b.b));
    let cal: Cal | null;
    if (ticks.length >= 2) {
      const sn = snap(sorted, (t) => cy(t.b), (t) => Math.max(2.5, 0.6 * (t.b.y1 - t.b.y0)), ticks);
      cal = sn ? fit(sn.toks, sn.pos, len, true, -1) : null;
    } else cal = fit(sorted, sorted.map((t) => cy(t.b)), len, false, -1);
    note(`y@${r1(x)} ${r1(s.y0)}–${r1(s.y1)}: labels ${sorted.map((t) => t.v).join(',')} ticks ${ticks.map(r1).join(',')} → ${cal ? (cal.log ? 'log' : 'linear') : 'no fit'}`);
    if (cal) out.push({ x, y0: s.y0, y1: s.y1, cal, dist: x - near.b.x1 });
  }
  return dedupe(out);
}

/** A label serves one axis: the nearest one claiming it keeps it. */
function dedupe<A extends { cal: Cal; dist: number }>(as: A[]): A[] {
  return as.filter((a) => !as.some((b) => b !== a && b.cal.toks.some((t) => a.cal.toks.includes(t)) && (b.dist < a.dist || (b.dist === a.dist && as.indexOf(b) < as.indexOf(a)))));
}

const nice = (v: number, dec: number) => { const r = Number(v.toFixed(Math.min(dec, 12))); return Object.is(r, -0) ? 0 : r; };

function axisOf(cal: Cal, start: number, scale: number): ChartAxis {
  const f = (v: number) => (cal.log ? Math.log10(v) : v);
  const vals = cal.toks.map((t) => t.v);
  const dec = Math.max(...cal.toks.map((t) => t.dec));
  let lo = Math.min(...vals);
  const hi = Math.max(...vals);
  if (!cal.log) {
    // The axis start, rounded to a tenth of the label step (never finer than the labels' decimals).
    const sorted = [...vals].sort((a, b) => a - b);
    const step = median(sorted.slice(1).map((v, i) => v - sorted[i]));
    const e = Math.floor(Math.log10(step)) - 1;
    const s = nice(Math.round((start - cal.a) / cal.b / 10 ** e) * 10 ** e, Math.max(dec, -e));
    if (s < lo) lo = s;
  }
  return { lo, hi, p0: (cal.a + cal.b * f(lo)) / scale, p1: (cal.a + cal.b * f(hi)) / scale, ...(cal.log ? { log: true } : {}) };
}

/** A short title near an axis: past the x axis's end or centred under its labels; above the y axis or beside its labels (rotated). */
function names(lines: TextLine[], aspect: number, xa: XAxis, ya: YAxis): { x?: string; y?: string } {
  const cand = lines.map((l) => ({ l, b: { x0: l.rect.x, y0: l.rect.y * aspect, x1: l.rect.x + l.rect.w, y1: (l.rect.y + l.rect.h) * aspect } }))
    .filter(({ l }) => l.text.trim().length <= 40 && !parseTick(l.text) && /\p{L}/u.test(l.text));
  const clean = (s: string) => s.trim().replace(/\s+/g, ' ');
  const lab = (c: Cal) => c.toks.reduce((m, t) => Math.max(m, t.b.y1 - t.b.y0), 0) || 8;
  const xh = lab(xa.cal), yh = lab(ya.cal);
  const xLabelsBottom = Math.max(...xa.cal.toks.map((t) => t.b.y1));
  const yLabelsLeft = Math.min(...ya.cal.toks.map((t) => t.b.x0));
  const xEnd = cand.find(({ b }) => b.x0 >= xa.x1 - 6 && b.x0 <= xa.x1 + 30 && Math.abs(cy(b) - xa.y) <= 2 * xh && b.x1 - b.x0 < 80);
  const xMid = cand.find(({ b }) => b.y0 >= xLabelsBottom - 0.5 * xh && b.y0 <= xLabelsBottom + 2.5 * xh && Math.abs(cx(b) - (xa.x0 + xa.x1) / 2) <= 0.2 * (xa.x1 - xa.x0));
  const yTop = cand.find(({ b }) => b.y1 <= ya.y0 + 4 && b.y1 >= ya.y0 - 30 && Math.abs(cx(b) - ya.x) <= 25 && b.x1 - b.x0 < 80);
  const ySide = cand.find(({ l, b }) => l.runs.some((r) => r.vertical) && b.x1 <= yLabelsLeft + 1 && b.x1 >= yLabelsLeft - 3 * yh && Math.abs(cy(b) - (ya.y0 + ya.y1) / 2) <= 0.25 * (ya.y1 - ya.y0));
  const x = xEnd ?? xMid, y = yTop ?? ySide;
  return { ...(x ? { x: clean(x.l.text) } : {}), ...(y ? { y: clean(y.l.text) } : {}) };
}

/**
 * Charts on a page: each a pair of calibrated axes (x axis below its numeric labels' row, y axis
 * right of its labels' column) meeting at the plot's bottom-left corner, or crossing inside both
 * with ticks on both (axes through the origin). `paths` and `lines` in model coords; `aspect` = h/w.
 */
export function chartMarks(paths: PaintedPath[], lines: TextLine[], aspect: number): Chart[] {
  if (!paths.length || lines.length < 4) return [];
  const st = strokes(paths, aspect);
  const H = merge(st.h, true), V = merge(st.v, false);
  const { toks, words } = tokensOf(lines, aspect);
  if (toks.length < 4) return [];
  // Ticks come from the raw strokes: a guide line ending on the axis would merge with its tick.
  const xs = xAxes(H, st.v, toks, words), ys = yAxes(V, st.h, toks, words);
  // A corner: the axes meet at the x axis's start and the y axis's foot (either may overshoot the
  // other by a tick's length). Otherwise they must cross well inside both, with ticks on both.
  const C = 8;
  const pairs: { xa: XAxis; ya: YAxis; d: number; corner: boolean }[] = [];
  for (const xa of xs) for (const ya of ys) {
    if (xa.cal.toks.some((t) => ya.cal.toks.includes(t))) continue;
    const corner = Math.abs(ya.x - xa.x0) <= C && Math.abs(ya.y1 - xa.y) <= C;
    const inside = ya.x > xa.x0 + C && ya.x < xa.x1 - C && xa.y > ya.y0 + C && xa.y < ya.y1 - C;
    if (corner) pairs.push({ xa, ya, d: Math.abs(ya.x - xa.x0) + Math.abs(ya.y1 - xa.y), corner });
    else if (inside && xa.cal.snapped && ya.cal.snapped) pairs.push({ xa, ya, d: C * 2, corner });
  }
  note(`axes: x ${xs.map((a) => r1(a.y)).join(',')} | y ${ys.map((a) => r1(a.x)).join(',')} | pairs ${pairs.length}`);
  pairs.sort((a, b) => a.d - b.d);
  const usedX = new Set<XAxis>(), usedY = new Set<YAxis>();
  const found: Omit<Chart, 'id'>[] = [];
  for (const { xa, ya, corner } of pairs) {
    if (usedX.has(xa) || usedY.has(ya)) continue;
    usedX.add(xa); usedY.add(ya);
    // The plot box: from the corner (the axes' meeting point) to the far ends; crossing axes span it.
    const r = corner ? { x0: ya.x, y0: ya.y0, x1: xa.x1, y1: xa.y } : { x0: xa.x0, y0: ya.y0, x1: xa.x1, y1: ya.y1 };
    // A table (rules with numbers in its cells) is not a chart: few pure numbers inside the plot box.
    const own = new Set([...xa.cal.toks, ...ya.cal.toks]);
    const inner = toks.filter((t) => !own.has(t) && cx(t.b) > r.x0 + 3 && cx(t.b) < r.x1 - 3 && cy(t.b) > r.y0 + 3 && cy(t.b) < r.y1 - 3);
    if (inner.length >= 4) { note('pair dropped: numbers inside the plot box'); continue; }
    const nm = names(lines, aspect, xa, ya);
    const x = axisOf(xa.cal, r.x0, 1);
    const y = axisOf(ya.cal, r.y1, aspect);
    found.push({
      rect: { x: r.x0, y: r.y0 / aspect, w: r.x1 - r.x0, h: (r.y1 - r.y0) / aspect },
      x: { ...(nm.x ? { name: nm.x } : {}), ...x },
      y: { ...(nm.y ? { name: nm.y } : {}), ...y },
    });
  }
  // Reading order: rows top to bottom (charts overlapping vertically share a row), left to right.
  found.sort((a, b) => {
    const overlap = Math.min(a.rect.y + a.rect.h, b.rect.y + b.rect.h) - Math.max(a.rect.y, b.rect.y);
    return overlap > 0.3 * Math.min(a.rect.h, b.rect.h) ? a.rect.x - b.rect.x : a.rect.y - b.rect.y;
  });
  return found.map((c, i) => ({ id: `#c${i + 1}`, ...c }));
}

/** One listing line per chart: `#c1 chart 113,254 422×550 x "Q" 0–60, y "P" 0–14` (` log` after a log axis). */
export function formatCharts(cs: Chart[]): string {
  const num = (v: number) => (Math.abs(v) >= 1e5 || (v !== 0 && Math.abs(v) < 1e-3) ? v.toExponential().replace('e+', 'e') : String(Number(v.toPrecision(12))));
  const ax = (k: string, a: ChartAxis) => `${k}${a.name ? ` "${a.name.replace(/"/g, "'")}"` : ''} ${num(a.lo)}–${num(a.hi)}${a.log ? ' log' : ''}`;
  return cs.map((c) => `${c.id} chart ${Math.round(c.rect.x)},${Math.round(c.rect.y)} ${Math.round(c.rect.w)}×${Math.round(c.rect.h)} ${ax('x', c.x)}, ${ax('y', c.y)}`).join('\n');
}
