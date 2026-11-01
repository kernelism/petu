// src/svgboard/check.ts — the live gate's checks on svg board groups (pure geometry over the parsed XML).
/**
 * A beat's groups must parse, have unique ids, keep text off text and off strokes, and stay inside
 * the board's canvas (the bottom may grow, within reason). Geometry is estimated without layout: a
 * text's box from its font size (at least the board's minimum, as the renderer will set it), anchor,
 * baseline and character count; strokes as segments (paths sampled, curves flattened); transforms
 * (translate, scale, rotate, matrix) applied. A text's box is shrunk a little before the stroke test
 * (estimates run wide), so a label that only touches a line passes; a line of the text's own group
 * crossing it only notes (the renderer's paper halo keeps it legible).
 */
import { parseGroup } from './sanitize';
import { newScope, resolveData, type DataScope } from './data';
import { prepareText } from './polish';
import { FONT_FIGURE } from './style';
import { settle, type Drawn } from './settle';

export type Pt = { x: number; y: number };
export type Box = { x: number; y: number; w: number; h: number };
export type TextBox = Box & { text: string; fs: number; group: string; /** The <text> it came from (polish.ts nudges it). */ el?: Element; m?: M;
  /** The curves its data-at point lies on (cross(d,s) → d, s): it labels that point, so touching them is by design. */ on?: string[] };
export type Seg = { a: Pt; b: Pt; group: string; /** Part of a tiny shape (a dot, a tick): never counts as crossing text. */ tiny?: boolean; /** The named data curve it is part of (data-fn / data-param). */ curve?: string };
export type GroupGeo = { id?: string; texts: TextBox[]; segs: Seg[]; box: Box | null; error?: string; /** Data attributes that did not resolve (the element is not drawn). */ problems?: string[] };
export type SvgFlag = { check: 'svg'; detail: string };

export type M = [number, number, number, number, number, number];
export const I: M = [1, 0, 0, 1, 0, 0];
export const mul = (m: M, n: M): M => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
export const ap = (m: M, p: Pt): Pt => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });

export function parseTransform(t: string | null): M {
  if (!t) return I;
  let m = I;
  for (const x of t.matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
    const v = x[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let n: M = I;
    if (x[1] === 'matrix' && v.length === 6) n = v as M;
    else if (x[1] === 'translate') n = [1, 0, 0, 1, v[0] ?? 0, v[1] ?? 0];
    else if (x[1] === 'scale') n = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0];
    else if (x[1] === 'rotate') {
      const r = ((v[0] ?? 0) * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
      n = [c, s, -s, c, 0, 0];
      if (v.length >= 3) n = mul(mul([1, 0, 0, 1, v[1], v[2]], n), [1, 0, 0, 1, -v[1], -v[2]]);
    } else if (x[1] === 'skewX') n = [1, 0, Math.tan(((v[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
    else if (x[1] === 'skewY') n = [1, Math.tan(((v[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
    if (n.some((k) => !Number.isFinite(k))) continue;
    m = mul(m, n);
  }
  return m;
}

const num = (v: string | null | undefined, d = 0): number => { const n = v == null ? NaN : parseFloat(v); return Number.isFinite(n) ? n : d; };
const first = (v: string | null) => num(v?.trim().split(/[\s,]+/)[0]);

/** A path's `d` → polylines (curves flattened, arcs as chords through their midpoint estimate). */
export function pathPolys(d: string): Pt[][] {
  const out: Pt[][] = [];
  const toks = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  let i = 0, cmd = '', cur: Pt = { x: 0, y: 0 }, start: Pt = { x: 0, y: 0 }, poly: Pt[] = [], lastCtl: Pt | null = null;
  const n = () => Number(toks[i++]);
  const push = (p: Pt) => { poly.push(p); cur = p; };
  const flush = () => { if (poly.length > 1) out.push(poly); poly = []; };
  const bez = (pts: Pt[]) => { for (let k = 1; k <= 8; k++) { const t = k / 8; let q = pts.slice(); while (q.length > 1) q = q.slice(1).map((p, j) => ({ x: q[j].x + (p.x - q[j].x) * t, y: q[j].y + (p.y - q[j].y) * t })); push(q[0]); } };
  let guard = 0;
  while (i < toks.length && guard++ < 20000) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase();
    const P = (x: number, y: number): Pt => (rel ? { x: cur.x + x, y: cur.y + y } : { x, y });
    switch (cmd.toUpperCase()) {
      case 'M': { flush(); const p = P(n(), n()); start = p; poly = [p]; cur = p; cmd = rel ? 'l' : 'L'; lastCtl = null; break; }
      case 'L': push(P(n(), n())); lastCtl = null; break;
      case 'H': { const x = n(); push({ x: rel ? cur.x + x : x, y: cur.y }); lastCtl = null; break; }
      case 'V': { const y = n(); push({ x: cur.x, y: rel ? cur.y + y : y }); lastCtl = null; break; }
      case 'C': { const c1 = P(n(), n()), c2 = P(n(), n()), e = P(n(), n()); bez([cur, c1, c2, e]); lastCtl = c2; break; }
      case 'S': { const c1: Pt = lastCtl ? { x: 2 * cur.x - lastCtl.x, y: 2 * cur.y - lastCtl.y } : cur; const c2 = P(n(), n()), e = P(n(), n()); bez([cur, c1, c2, e]); lastCtl = c2; break; }
      case 'Q': { const c = P(n(), n()), e = P(n(), n()); bez([cur, c, e]); lastCtl = c; break; }
      case 'T': { const c: Pt = lastCtl ? { x: 2 * cur.x - lastCtl.x, y: 2 * cur.y - lastCtl.y } : cur; const e = P(n(), n()); bez([cur, c, e]); lastCtl = c; break; }
      case 'A': {
        const rx = n(), ry = n(); n(); const large = n(), sweep = n(); const e = P(n(), n());
        // A bulge through the arc's middle (a fair stand-in for collision tests).
        const mx = (cur.x + e.x) / 2, my = (cur.y + e.y) / 2, dx = e.x - cur.x, dy = e.y - cur.y, L = Math.hypot(dx, dy) || 1;
        const r = Math.max(rx, ry, L / 2), sag = (large ? r + Math.sqrt(Math.max(0, r * r - (L / 2) ** 2)) : r - Math.sqrt(Math.max(0, r * r - (L / 2) ** 2))) * (sweep ? 1 : -1);
        push({ x: mx - (dy / L) * sag, y: my + (dx / L) * sag }); push(e); lastCtl = null; break;
      }
      case 'Z': push(start); flush(); poly = [start]; lastCtl = null; break;
      default: i++;
    }
    if (Number.isNaN(cur.x) || Number.isNaN(cur.y)) break;
  }
  flush();
  return out;
}

const polyOf = (pts: string | null): Pt[] => { const v = (pts ?? '').trim().split(/[\s,]+/).map(Number); const o: Pt[] = []; for (let k = 0; k + 1 < v.length; k += 2) if (Number.isFinite(v[k]) && Number.isFinite(v[k + 1])) o.push({ x: v[k], y: v[k + 1] }); return o; };
const ellipse = (cx: number, cy: number, rx: number, ry: number): Pt[] => Array.from({ length: 25 }, (_, k) => ({ x: cx + rx * Math.cos((k / 24) * 2 * Math.PI), y: cy + ry * Math.sin((k / 24) * 2 * Math.PI) }));

/**
 * The board font's real advance of a string in em, measured by the engine that draws it (an off-screen
 * board text, so the board's CSS — tabular numerals — applies; canvas measureText ran ~15% short):
 * WebKit's and Gecko's system sans run wider than the estimate below (founder WebKit stills:
 * "0.2€weights"). Null without a DOM to measure in (tests, the server): the estimate is used.
 */
/**
 * Measured at the small end of board text (10 px), where engines run widest (hinting). Board text sets
 * font-optical-sizing: none (desk.css), so Source Serif 4's widths do not change with its size.
 */
const MEASURE_PX = 10;
/** Drawn text inside the scaled board ran up to ~4% wider than the off-screen measure (Firefox, WebKit). */
const MEASURE_SAFETY = 1.05;
let measureEl: SVGTextElement | null | undefined;
let fontState: 'unknown' | 'loading' | 'ready' = 'unknown';
/** Whether the board's figure face is loaded; starts its load once, and clears the cache when it lands. */
function figureFontReady(): boolean {
  if (fontState === 'ready') return true;
  const fonts = typeof document !== 'undefined' ? (document as Document & { fonts?: FontFaceSet }).fonts : undefined;
  if (!fonts) { fontState = 'ready'; return true; }
  const spec = `${MEASURE_PX}px "Source Serif 4 Variable"`;
  try { if (fonts.check(spec)) { fontState = 'ready'; measured.clear(); return true; } } catch { /* a FontFaceSet without check */ }
  if (fontState === 'unknown') {
    fontState = 'loading';
    void fonts.load(spec).then(() => { fontState = 'ready'; measured.clear(); }, () => { fontState = 'ready'; });
  }
  return false;
}
const measured = new Map<string, number>();
function measureEm(s: string): number | null {
  if (measureEl === undefined) {
    measureEl = null;
    try {
      if (typeof document !== 'undefined' && document.body && !/jsdom/i.test(typeof navigator !== 'undefined' ? navigator.userAgent : '')) {
        // An off-screen board text: the board's own CSS applies (tabular numerals), so it measures as drawn.
        const NS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('data-svgboard', 'measure');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('style', 'position:fixed;left:-10000px;top:0;width:10px;height:10px;visibility:hidden;pointer-events:none');
        const t = document.createElementNS(NS, 'text') as SVGTextElement;
        t.setAttribute('font-size', String(MEASURE_PX)); t.setAttribute('font-family', FONT_FIGURE); t.setAttribute('x', '0'); t.setAttribute('y', '100');
        svg.appendChild(t); document.body.appendChild(svg);
        measureEl = t;
      }
    } catch { measureEl = null; }
  }
  if (!measureEl) return null;
  // The bundled serif must be in: a fallback face's widths are never measured, nor cached.
  if (!figureFontReady()) return null;
  let v = measured.get(s);
  if (v == null) {
    measureEl.textContent = s;
    v = (measureEl.getComputedTextLength() / MEASURE_PX) * MEASURE_SAFETY;
    if (!(v > 0)) return null;
    if (measured.size > 4000) measured.clear();
    measured.set(s, v);
  }
  return v;
}

/** Advance of a string in em: measured in the browser, else estimated (a sans: narrow letters and digits near 0.55). */
export function textEm(s: string): number {
  const m = measureEm(s);
  if (m != null && Number.isFinite(m) && m > 0) return m;
  let w = 0;
  for (const ch of s) w += /[iljtfI.,:;'!|]/.test(ch) ? 0.3 : /[mwMW]/.test(ch) ? 0.85 : /[A-Z]/.test(ch) ? 0.65 : / /.test(ch) ? 0.28 : /[Ͱ-Ͽ]/.test(ch) ? 0.58 : 0.55;
  return w;
}

const inherit = (el: Element, a: string): string | null => { for (let e: Element | null = el; e; e = e.parentElement) { const v = e.getAttribute(a) ?? styleOf(e, a); if (v != null) return v; } return null; };
function styleOf(e: Element, k: string): string | null { const m = new RegExp(`(?:^|;)\\s*${k}\\s*:\\s*([^;]+)`).exec(e.getAttribute('style') ?? ''); return m ? m[1].trim() : null; }
const stroked = (el: Element) => { const s = inherit(el, 'stroke'); return s != null && s !== 'none' && s !== 'transparent' && num(inherit(el, 'stroke-width'), 1) > 0; };

/** The curves a data-at point lies on: `cross(d,s)` → d, s; `at(d, …)`, `max(f)`, `min(f)` → the curve. */
export function curvesAt(at: string | null | undefined): string[] {
  const m = /^\s*(cross|at|max|min)\s*\(([^)]*)\)/i.exec(at ?? '');
  if (!m) return [];
  const args = m[2].split(',').map((x) => x.trim().toLowerCase());
  return (m[1].toLowerCase() === 'cross' ? args.slice(0, 2) : args.slice(0, 1)).filter((x) => /^[\p{L}_][\p{L}\p{N}_-]*$/u.test(x));
}

/**
 * Geometry of one group (raw SVG markup). `minFont`: text is never smaller (the renderer's rule).
 * `settleOn`: what the board already holds; the group's labels are nudged clear of it first, as the
 * renderer does (settle.ts), so the gate checks the geometry that will be drawn.
 */
export function groupGeometry(src: string | Element, minFont = 16, scope?: DataScope, settleOn?: { prior: Drawn; w: number }): GroupGeo {
  const g = typeof src === 'string' ? parseGroup(src) : src;
  if (typeof g === 'string') return { texts: [], segs: [], box: null, error: g };
  // Exact data first (the geometry checked is the geometry drawn), then the text fitting the renderer does.
  const problems = typeof src === 'string' ? resolveData(g, scope ?? newScope()).map((p) => p.detail) : [];
  const raw = settleOn ? g.cloneNode(true) as Element : null;
  if (typeof src === 'string') prepareText(g, minFont);
  if (raw && settleOn) { try { settle(g, raw, settleOn.prior, settleOn.w); } catch { /* best-effort, as the renderer */ } }
  const id = g.getAttribute('id') ?? undefined;
  const label = id ?? '(group)';
  const texts: TextBox[] = [], segs: Seg[] = [];
  const pts: Pt[] = [];
  const addPoly = (m: M, poly: Pt[], el: Element, closed = false) => {
    const q = poly.map((p) => ap(m, p));
    pts.push(...q);
    if (!stroked(el)) return;
    const xs = q.map((p) => p.x), ys = q.map((p) => p.y);
    const tiny = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) < 3;
    const nm = el.hasAttribute('data-fn') || el.hasAttribute('data-param') ? (el.getAttribute('data-name') ?? el.getAttribute('id'))?.toLowerCase() : undefined;
    const x = { group: label, ...(tiny ? { tiny } : {}), ...(nm ? { curve: nm } : {}) };
    for (let k = 1; k < q.length; k++) segs.push({ a: q[k - 1], b: q[k], ...x });
    if (closed && q.length > 2) segs.push({ a: q[q.length - 1], b: q[0], ...x });
  };
  const walk = (el: Element, m0: M) => {
    const name = el.nodeName.toLowerCase();
    if (['defs', 'marker', 'clippath', 'pattern', 'lineargradient', 'radialgradient', 'symbol', 'title', 'desc'].includes(name) || el.hasAttribute('data-bad')) return;
    const m = mul(m0, parseTransform(el.getAttribute('transform')));
    switch (name) {
      case 'line': addPoly(m, [{ x: num(el.getAttribute('x1')), y: num(el.getAttribute('y1')) }, { x: num(el.getAttribute('x2')), y: num(el.getAttribute('y2')) }], el); return;
      case 'polyline': addPoly(m, polyOf(el.getAttribute('points')), el); return;
      case 'polygon': addPoly(m, polyOf(el.getAttribute('points')), el, true); return;
      case 'rect': { const x = num(el.getAttribute('x')), y = num(el.getAttribute('y')), w = num(el.getAttribute('width')), h = num(el.getAttribute('height')); addPoly(m, [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], el, true); return; }
      case 'circle': { const r = num(el.getAttribute('r')); addPoly(m, ellipse(num(el.getAttribute('cx')), num(el.getAttribute('cy')), r, r), el); return; }
      case 'ellipse': addPoly(m, ellipse(num(el.getAttribute('cx')), num(el.getAttribute('cy')), num(el.getAttribute('rx')), num(el.getAttribute('ry'))), el); return;
      case 'path': for (const p of pathPolys(el.getAttribute('d') ?? '')) addPoly(m, p, el); return;
      case 'text': textBoxes(el, m); return;
    }
    for (const c of Array.from(el.children)) walk(c, m);
  };
  const textBoxes = (el: Element, m: M) => {
    // Lines: the text's own run, and each tspan that sets its own x or y (a new line or a placed run).
    const fsOf = (e: Element) => Math.max(minFont, num(inherit(e, 'font-size'), 16));
    const anchorOf = (e: Element) => inherit(e, 'text-anchor') ?? 'start';
    const baseOf = (e: Element) => inherit(e, 'dominant-baseline') ?? 'auto';
    const runs: { x: number; y: number; s: string; fs: number; anchor: string; base: string }[] = [];
    let x = first(el.getAttribute('x')) + first(el.getAttribute('dx')), y = first(el.getAttribute('y')) + first(el.getAttribute('dy'));
    let cur = { x, y, s: '', fs: fsOf(el), anchor: anchorOf(el), base: baseOf(el) };
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === 3) { cur.s += node.textContent ?? ''; continue; }
      const e = node as Element;
      if (e.nodeName.toLowerCase() !== 'tspan') continue;
      const hasPos = e.hasAttribute('x') || e.hasAttribute('y') || e.hasAttribute('dy');
      if (hasPos) {
        if (cur.s.trim()) runs.push(cur);
        x = e.hasAttribute('x') ? first(e.getAttribute('x')) : x;
        y = (e.hasAttribute('y') ? first(e.getAttribute('y')) : y) + first(e.getAttribute('dy'));
        cur = { x, y, s: e.textContent ?? '', fs: fsOf(e), anchor: anchorOf(e), base: baseOf(e) };
      } else { cur.s += e.textContent ?? ''; cur.fs = Math.max(cur.fs, fsOf(e)); }
    }
    if (cur.s.trim()) runs.push(cur);
    for (const r of runs) {
      const s = r.s.replace(/\s+/g, ' ').trim();
      const w = textEm(s) * r.fs, h = r.fs;
      const x0 = r.anchor === 'middle' ? r.x - w / 2 : r.anchor === 'end' ? r.x - w : r.x;
      const top = /middle|central/.test(r.base) ? r.y - 0.5 * h : /hanging|text-before|before-edge/.test(r.base) ? r.y : r.y - 0.78 * h;
      const corners = [ap(m, { x: x0, y: top }), ap(m, { x: x0 + w, y: top }), ap(m, { x: x0, y: top + h }), ap(m, { x: x0 + w, y: top + h })];
      const bx = Math.min(...corners.map((p) => p.x)), by = Math.min(...corners.map((p) => p.y));
      const b = { x: bx, y: by, w: Math.max(...corners.map((p) => p.x)) - bx, h: Math.max(...corners.map((p) => p.y)) - by };
      const on = curvesAt(el.closest('[data-at]')?.getAttribute('data-at'));
      texts.push({ ...b, text: s, fs: r.fs * Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])), group: label, el, m, ...(on.length ? { on } : {}) });
      pts.push(...corners);
    }
  };
  walk(g, I);
  const fin = pts.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const box = fin.length ? (() => { const x = Math.min(...fin.map((p) => p.x)), y = Math.min(...fin.map((p) => p.y)); return { x, y, w: Math.max(...fin.map((p) => p.x)) - x, h: Math.max(...fin.map((p) => p.y)) - y }; })() : null;
  return { ...(id ? { id } : {}), texts, segs, box, ...(problems.length ? { problems } : {}) };
}

export const overlapArea = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** Does segment ab cross (or lie in) box r? */
export function segHitsBox(a: Pt, b: Pt, r: Box): boolean {
  if (r.w <= 0 || r.h <= 0) return false;
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  const clip = (p: number, q: number) => { if (p === 0) return q >= 0; const t = q / p; if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; } return true; };
  return clip(-dx, a.x - r.x) && clip(dx, r.x + r.w - a.x) && clip(-dy, a.y - r.y) && clip(dy, r.y + r.h - a.y) && t0 <= t1;
}

/** The core of a text box a stroke must not cross (estimates run a little wide and tall). */
export const core = (t: TextBox): Box => ({ x: t.x + Math.min(t.w * 0.12, t.fs * 0.3), y: t.y + t.h * 0.22, w: Math.max(0, t.w - 2 * Math.min(t.w * 0.12, t.fs * 0.3)), h: t.h * 0.56 });

export type BoardState = { w: number; h: number; ids: Set<string>; texts: TextBox[]; segs: Seg[] };
export const newBoardState = (w = 1000, h = 700): BoardState => ({ w, h, ids: new Set(), texts: [], segs: [] });
/** The bottom may grow past the plan's height by this much (the board grows with it); beyond it, the group is outside. */
export const GROW = 1.6;

/**
 * Checks a beat's groups against the board so far. Pure; `board` is not changed.
 * What fails (a flag: the beat is withheld or repaired) is only what cannot draw right: a group that does
 * not parse, data that does not resolve (that element is never drawn), an id used twice. Layout is fixed,
 * not failed: the group's labels are first nudged clear of the board (settle.ts, as the renderer does),
 * and what still overlaps, crosses a line or runs off the canvas only notes (the paper halo keeps a label
 * legible; an overlapped label harms far less than a missing drawing: a32's equilibrium was dropped for
 * curves crossing "E1" beside its own cross() dot). A label placed at a data-at point is never counted
 * as crossing the curves that point lies on: labelling that point is what it is for.
 */
export function checkGroups(srcs: string[], board: BoardState, minFont = 16, scope: DataScope = newScope()): { flags: SvgFlag[]; notes: string[]; geos: GroupGeo[]; grow?: number; scope: DataScope } {
  const flags: SvgFlag[] = [];
  const notes: string[] = [];
  const ids = new Set(board.ids);
  const texts = [...board.texts], segs = [...board.segs];
  const geos: GroupGeo[] = [];
  let grow: number | undefined;
  for (const src of srcs) {
    const g = groupGeometry(src, minFont, scope, { prior: { texts: [...texts], segs: segs.filter((s) => !s.tiny) }, w: board.w });
    geos.push(g);
    const name = g.id ? `group ${g.id}` : 'a group';
    if (g.error) { flags.push({ check: 'svg', detail: `${name}: ${g.error}` }); continue; }
    // A data attribute that does not resolve: that element is never drawn (fix the formula or drop it).
    for (const p of g.problems ?? []) flags.push({ check: 'svg', detail: `${name}: ${p}` });
    if (g.id) { if (ids.has(g.id)) flags.push({ check: 'svg', detail: `id "${g.id}" is used twice` }); ids.add(g.id); }
    if (g.box) {
      const b = g.box, tol = 2;
      if (b.x < -tol || b.y < -tol || b.x + b.w > board.w + tol) notes.push(`svg: ${name} is outside the board (it spans x ${Math.round(b.x)}–${Math.round(b.x + b.w)}, y ${Math.round(b.y)}–${Math.round(b.y + b.h)}; the board is 0–${board.w} × 0–${board.h})`);
      else if (b.y + b.h > board.h + tol) {
        if (b.y + b.h > board.h * GROW) notes.push(`svg: ${name} runs below the board (to y ${Math.round(b.y + b.h)}; the board is ${board.h} tall)`);
        else grow = Math.max(grow ?? 0, Math.ceil(b.y + b.h + 12));
      }
    }
    for (const t of g.texts) {
      for (const o of texts) {
        const a = overlapArea(t, o);
        if (a > 0.25 * Math.min(t.w * t.h, o.w * o.h)) { notes.push(`svg: text "${t.text}" (${t.group}) overlaps text "${o.text}" (${o.group})`); break; }
      }
      texts.push(t);
    }
    // Text against strokes, both ways: the new text over every stroke, the new strokes over every text.
    const crossed = new Set<string>();
    const test = (t: TextBox, s: Seg) => {
      if (s.tiny || (s.curve && t.on?.includes(s.curve))) return;
      const key = `${t.group}|${t.text}`;
      if (crossed.has(key)) return;
      if (!segHitsBox(s.a, s.b, core(t))) return;
      crossed.add(key);
      notes.push(`svg: a line of ${s.group} crosses text "${t.text}" (${t.group})`);
    };
    for (const t of g.texts) for (const s of segs) test(t, s);
    for (const s of g.segs) for (const t of texts) test(t, s);
    segs.push(...g.segs);
  }
  return { flags, notes, geos, ...(grow ? { grow } : {}), scope };
}

/** Adds an accepted beat's groups to the board state. */
export function acceptGroups(board: BoardState, geos: GroupGeo[], grow?: number): void {
  for (const g of geos) { if (g.error) continue; if (g.id) board.ids.add(g.id); board.texts.push(...g.texts); board.segs.push(...g.segs); }
  if (grow && grow > board.h) board.h = grow;
}

/** Words written in a group's text (the named-object check reads them as labels). */
export function svgTextWords(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/<(?:text|tspan)\b[^>]*>([^<]*)/g)) for (const w of m[1].split(/[\s,=()·×:]+/)) if (w) out.push(w);
  return out;
}
