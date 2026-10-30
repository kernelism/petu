// src/svgboard/grammar.ts — the board's visual grammar for text, enforced on every model SVG (pure: no layout).
/**
 * Size, weight and colour carry meaning on the board, so the model's own values are discarded:
 *  - SIZE encodes structure only. Three sizes exist: `title` (the board's top-most heading, once per
 *    board: the top-most text of the board's first group, words written larger than the rest of
 *    it, standing clear above it, not an axis's title), `small` (axis ticks and units: short numeric text next to a tick mark or along an axis
 *    line, or the engine's own ticks) and `content` (everything else: labels, values, card lines).
 *  - WEIGHT encodes importance only: semibold for the title, regular for everything else.
 *  - COLOUR encodes time only: every text is ink at rest. The part being drawn is the accent while it
 *    draws (render.ts `data-live`, styled in board CSS); superseded parts (ghosts) are grey.
 * Sizes are in the board's user units, from the slide's measured body size: content = the body,
 * title = 1.25 × body, small = 0.82 × body but never under 11 px on screen.
 */
import { INK } from './style';
import { core, groupGeometry, overlapArea, segHitsBox, type Box, type Seg as GSeg, type TextBox } from './check';

export type Role = 'title' | 'content' | 'small';
export type TypeScale = { title: number; content: number; small: number };
type Seg = { x1: number; y1: number; x2: number; y2: number };
/**
 * Per board: its scale, the axis lines and tick marks seen so far, whether a title was given; `room`:
 * the content size the board's drawing has room for (set by its tightest group so far, never grows);
 * `drawn`: earlier groups' text boxes and strokes (a later label keeps clear of them too).
 */
export type TypeState = { scale: TypeScale; axes: Seg[]; ticks: Seg[]; titled: boolean; room?: number; /** The legibility floor in user units (render.ts): a model's smaller text counts as this. */ floor?: number; /** The hard floor (units) a text may go to on its own, to clear a collision. */ minFloor?: number; drawn?: { texts: TextBox[]; segs: GSeg[] } };

export const SMALL_MIN_PX = 11;
/** No board text is ever set under this on screen (a model's tiny text is raised to it first). */
export const LEGIBLE_PX = 10;
/** A text in a row too tight for LEGIBLE_PX may go this small (and no smaller than the model wrote it). */
export const MIN_PX = 8;
export const TITLE_K = 1.25;
export const SMALL_K = 0.82;

/**
 * The board's three sizes in user units: `bodyPx` the slide's body text on screen, `pxPerUnit` the
 * board's scale, `widthPx` the board's width on screen. Content is the kit's numeral size (kit.ts
 * metrics: the body size, never under 13px, growing with a wide board to 20px), so a kit block and
 * an SVG board read at one size.
 */
export function typeScale(bodyPx: number, pxPerUnit: number, widthPx = 0): TypeScale {
  const k = pxPerUnit > 0 ? pxPerUnit : 1;
  const px = Math.max(13, bodyPx * 0.9, Math.min(20, widthPx / 50));
  const content = px / k;
  return { content, title: content * TITLE_K, small: Math.min(content, Math.max(SMALL_MIN_PX, px * SMALL_K) / k) };
}

export const newTypeState = (scale: TypeScale): TypeState => ({ scale, axes: [], ticks: [], titled: false });

const num = (v: string | null | undefined, d = 0): number => { const n = v == null ? NaN : parseFloat(v); return Number.isFinite(n) ? n : d; };
const tag = (e: Element) => e.nodeName.toLowerCase().replace(/^svg:/, '');
const skip = (e: Element) => !!e.closest('defs,marker,symbol,clipPath,clippath,pattern');
/** Translation of an element within the group (rotated or scaled ancestors: null). */
function shiftOf(el: Element, root: Element): { x: number; y: number } | null {
  let x = 0, y = 0;
  for (let e: Element | null = el; e && e !== root.parentElement; e = e.parentElement) {
    const t = e.getAttribute('transform');
    if (!t) continue;
    const m = /^\s*translate\(\s*(-?[\d.]+)(?:[\s,]+(-?[\d.]+))?\s*\)\s*$/.exec(t);
    if (!m) return null;
    x += +m[1]; y += +(m[2] ?? 0);
  }
  return { x, y };
}

/** Straight horizontal / vertical segments of a group (lines, and M/L/H/V paths). */
function straightSegs(g: Element): Seg[] {
  const out: Seg[] = [];
  const hv = (s: Seg) => Math.abs(s.x1 - s.x2) < 0.5 || Math.abs(s.y1 - s.y2) < 0.5;
  for (const el of Array.from(g.querySelectorAll('line,path,polyline'))) {
    if (skip(el) || el.hasAttribute('data-bad')) continue;
    const o = shiftOf(el, g);
    if (!o) continue;
    const pts: { x: number; y: number }[][] = [];
    if (tag(el) === 'line') pts.push([{ x: num(el.getAttribute('x1')), y: num(el.getAttribute('y1')) }, { x: num(el.getAttribute('x2')), y: num(el.getAttribute('y2')) }]);
    else if (tag(el) === 'polyline') { const v = (el.getAttribute('points') ?? '').trim().split(/[\s,]+/).map(Number); const p = []; for (let i = 0; i + 1 < v.length; i += 2) p.push({ x: v[i], y: v[i + 1] }); pts.push(p); }
    else {
      const d = el.getAttribute('d') ?? '';
      if (/[cCsSqQtTaA]/.test(d)) continue;
      let cur: { x: number; y: number }[] = [], x = 0, y = 0;
      for (const m of d.matchAll(/([MLHVZmlhvz])([^MLHVZmlhvz]*)/g)) {
        const v = m[2].trim().split(/[\s,]+/).filter(Boolean).map(Number), c = m[1];
        if (c === 'M' || c === 'm') { if (cur.length) pts.push(cur); x = c === 'm' ? x + v[0] : v[0]; y = c === 'm' ? y + v[1] : v[1]; cur = [{ x, y }]; for (let i = 2; i + 1 < v.length; i += 2) { x = v[i]; y = v[i + 1]; cur.push({ x, y }); } }
        else if (c === 'L' || c === 'l') for (let i = 0; i + 1 < v.length; i += 2) { x = c === 'l' ? x + v[i] : v[i]; y = c === 'l' ? y + v[i + 1] : v[i + 1]; cur.push({ x, y }); }
        else if (c === 'H' || c === 'h') for (const a of v) { x = c === 'h' ? x + a : a; cur.push({ x, y }); }
        else if (c === 'V' || c === 'v') for (const a of v) { y = c === 'v' ? y + a : a; cur.push({ x, y }); }
      }
      if (cur.length) pts.push(cur);
    }
    for (const p of pts) for (let i = 1; i < p.length; i++) {
      const s = { x1: p[i - 1].x + o.x, y1: p[i - 1].y + o.y, x2: p[i].x + o.x, y2: p[i].y + o.y };
      if (hv(s) && Number.isFinite(s.x1 + s.y1 + s.x2 + s.y2)) out.push(s);
    }
  }
  return out;
}

/** A tick label or unit: a short number, maybe signed, with a currency or a short unit. */
export const isTickText = (s: string): boolean => /^[−\-+]?[$€£]?\s?\d[\d.,]*\s?(%|°|[a-zA-Zµ²³/]{1,3})?$/.test(s.replace(/\s+/g, ' ').trim()) || /^[−\-+]?π(\/\d)?$|^\d?π$/.test(s.trim());

const segLen = (s: Seg) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
/** Distance from p to a segment. */
function distTo(s: Seg, x: number, y: number): number {
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1, L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((x - s.x1) * dx + (y - s.y1) * dy) / L)) : 0;
  return Math.hypot(x - (s.x1 + t * dx), y - (s.y1 + t * dy));
}

type TextInfo = { el: Element; x: number; y: number; text: string; fs: number; x0: number; x1: number };

/**
 * The role of each <text> of a group. Updates the board's state (axes, ticks, whether its title is
 * given). A group's texts are judged against the axes and ticks of this group and earlier ones.
 */
export function textRoles(g: Element, st: TypeState): Map<Element, Role> {
  const B = st.scale.content;
  const segs = straightSegs(g);
  // Tick marks: short h/v strokes; axis lines: long ones.
  for (const s of segs) { const L = segLen(s); if (L > 0.5 && L <= 1.2 * B) st.ticks.push(s); else if (L >= 6 * B) st.axes.push(s); }
  const texts: TextInfo[] = [];
  for (const el of Array.from(g.querySelectorAll('text'))) {
    if (skip(el)) continue;
    const o = shiftOf(el, g) ?? { x: 0, y: 0 };
    const xy = (a: string) => num(el.getAttribute(a)?.split(/[\s,]+/)[0]);
    const at = el.getAttribute('data-at-xy')?.split(/[\s,]+/).map(Number);
    const x = (at && Number.isFinite(at[0]) ? at[0] : xy('x')) + o.x + num(el.getAttribute('dx'));
    const y = (at && Number.isFinite(at[1]) ? at[1] : xy('y')) + o.y + num(el.getAttribute('dy'));
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    let fs = 16;
    for (let e: Element | null = el; e; e = e.parentElement) { const v = e.getAttribute('font-size'); if (v != null) { fs = num(v, 16); break; } }
    // Where its line runs (a rough width: 0.55 em a character), for distances to an axis.
    const w = text.length * 0.55 * fs, anchor = el.closest('[text-anchor]')?.getAttribute('text-anchor') ?? 'start';
    const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
    texts.push({ el, x, y, text, fs, x0, x1: x0 + w });
  }
  const roles = new Map<Element, Role>();
  const reach = 2.2 * B;
  for (const t of texts) {
    let r: Role = 'content';
    if (t.el.hasAttribute('data-tick')) r = 'small';
    else if (isTickText(t.text)) {
      // Next to a tick mark's end, or close along an axis line.
      const nearTick = st.ticks.some((s) => Math.min(Math.hypot(t.x - s.x1, t.y - s.y1), Math.hypot(t.x - s.x2, t.y - s.y2)) <= reach);
      const ym = t.y - 0.35 * t.fs;
      const nearAxis = st.axes.some((s) => Math.min(distTo(s, t.x0, ym), distTo(s, (t.x0 + t.x1) / 2, ym), distTo(s, t.x1, ym)) <= 2.2 * B);
      if (nearTick || nearAxis) r = 'small';
    }
    roles.set(t.el, r);
  }
  // The title: the board's first texts only, the top-most text standing clear above everything else
  // in its group, not a number, not an axis's title (next to an axis end).
  if (!st.titled && texts.length) {
    st.titled = true;
    const top = texts.filter((t) => roles.get(t.el) === 'content').sort((a, b) => a.y - b.y)[0];
    // A heading: words (two or more, no figures), written larger than the rest of its group.
    const larger = top && texts.every((t) => t === top || t.fs < top.fs - 0.01);
    if (top && larger && /\S\s+\S/.test(top.text) && !/\d/.test(top.text) && !top.el.hasAttribute('data-val')) {
      const others = otherTops(g, top.el);
      const clear = others.every((y) => y >= top.y + 0.4 * B);
      const axisEnd = st.axes.some((s) => Math.min(Math.hypot(top.x - s.x1, top.y - s.y1), Math.hypot(top.x - s.x2, top.y - s.y2)) <= 3 * B);
      const inCard = Array.from(g.querySelectorAll('rect')).some((rc) => { const o = shiftOf(rc, g) ?? { x: 0, y: 0 }; const x = num(rc.getAttribute('x')) + o.x, y = num(rc.getAttribute('y')) + o.y; return top.x >= x && top.x <= x + num(rc.getAttribute('width')) && top.y >= y && top.y <= y + num(rc.getAttribute('height')); });
      if (clear && !axisEnd && !inCard) roles.set(top.el, 'title');
    }
  }
  return roles;
}

/** Top edges (y) of a group's other drawn things: text baselines minus a line, shapes' tops. */
function otherTops(g: Element, except: Element): number[] {
  const ys: number[] = [];
  for (const el of Array.from(g.querySelectorAll('text,line,rect,circle,ellipse,path,polyline,polygon'))) {
    if (el === except || skip(el) || except.contains(el)) continue;
    const o = shiftOf(el, g) ?? { x: 0, y: 0 };
    const n = tag(el);
    if (n === 'text') ys.push(num(el.getAttribute('y')) + o.y);
    else if (n === 'line') ys.push(Math.min(num(el.getAttribute('y1')), num(el.getAttribute('y2'))) + o.y);
    else if (n === 'rect') ys.push(num(el.getAttribute('y')) + o.y);
    else if (n === 'circle') ys.push(num(el.getAttribute('cy')) - num(el.getAttribute('r')) + o.y);
    else if (n === 'ellipse') ys.push(num(el.getAttribute('cy')) - num(el.getAttribute('ry')) + o.y);
    else if (el.hasAttribute('data-box')) ys.push((el.getAttribute('data-box') ?? '').split(/[\s,]+/).map(Number)[1] + o.y);
    else { const v = (el.getAttribute('d') ?? el.getAttribute('points') ?? '').match(/-?\d*\.?\d+/g)?.map(Number) ?? []; const yy = v.filter((_, i) => i % 2 === 1); if (yy.length) ys.push(Math.min(...yy) + o.y); }
  }
  for (const el of Array.from(g.querySelectorAll('[data-box]'))) ys.push((el.getAttribute('data-box') ?? '').split(/[\s,]+/).map(Number)[1]);
  return ys.filter(Number.isFinite);
}

/**
 * Applies the grammar to a group's texts: each gets its role's size (returned for the text fitter,
 * which owns font-size), weight and ink; the model's sizes, weights and colours on tspans are dropped.
 * Returns the size each text is set at.
 */
export function applyGrammar(g: Element, st: TypeState): Map<Element, number> {
  const roles = textRoles(g, st);
  const sizes = roomSizes(g, roles, st);
  for (const [el, role] of roles) {
    el.setAttribute('data-role', role);
    el.setAttribute('font-weight', role === 'title' ? '600' : '400');
    el.setAttribute('fill', INK.ink);
    for (const k of ['fill-opacity', 'opacity', 'font-style', 'letter-spacing', 'stroke', 'stroke-width']) el.removeAttribute(k);
    for (const s of Array.from(el.querySelectorAll('tspan'))) for (const k of ['font-size', 'font-weight', 'fill', 'fill-opacity', 'opacity', 'font-style']) s.removeAttribute(k);
  }
  // Groups may carry text styling for their texts: the texts now set their own.
  for (const e of [g, ...Array.from(g.querySelectorAll('g'))]) e.removeAttribute('font-weight');
  return sizes;
}

/** Where a text's glyphs actually sit (its estimated box less the empty band above caps and below descenders). */
export const inkBox = (t: Box): Box => ({ x: t.x, y: t.y + 0.08 * t.h, w: t.w, h: 0.86 * t.h });
/** The room a text keeps around it (em): its ink box widened by this on every side (also absorbs width estimates). */
const AIR = 0.12;
const airBox = (t: TextBox): Box => { const b = inkBox(t), a = AIR * t.fs; return { x: b.x - a, y: b.y - a / 2, w: b.w + 2 * a, h: b.h + a }; };
/** Text is raised at most this far over the model's own (median) content size: the drawing's proportions hold. */
export const RAISE_MAX = 1.5;

/**
 * The size each text is set at. The grammar's sizes are a target, not a floor: the model laid its
 * drawing out for its own text sizes, so text is raised toward the target only as far as the drawing
 * has room (founder 2026-10-30: in the 544 px lane the target doubled the model's labels; they sat on
 * the strokes they label and on each other). One content size for the group (the hierarchy holds):
 * the largest in [the model's smallest content size, the target] at which no text runs into a text or
 * stroke (this group's or an earlier group's) it was clear of at the model's own sizes. Title and
 * small follow it (title 1.25 ×, small 0.82 × but not under the grammar's small or what the model wrote).
 * The board keeps the tightest group's size, so a later group is never set larger.
 */
function roomSizes(g: Element, roles: Map<Element, Role>, st: TypeState): Map<Element, number> {
  const els = Array.from(roles.keys());
  const own = new Map<Element, number>(), raw = new Map<Element, number>();
  for (const el of els) {
    let fs = 16;
    for (let e: Element | null = el; e; e = e.parentElement) { const v = e.getAttribute('font-size'); if (v != null) { fs = num(v, 16); break; } }
    raw.set(el, fs);
    own.set(el, Math.max(fs, st.floor ?? 0));
  }
  const target = st.scale.content;
  const contentOwn = els.filter((e) => roles.get(e) !== 'small').map((e) => own.get(e)!);
  const lo = Math.min(target, contentOwn.length ? Math.min(...contentOwn) : target);
  const med = contentOwn.length ? contentOwn.slice().sort((a, b) => a - b)[Math.floor((contentOwn.length - 1) / 2)] : target;
  const hi = Math.max(Math.min(lo, st.room ?? Infinity), Math.min(target, st.room ?? Infinity, RAISE_MAX * med));
  const sizesAt = (c: number) => {
    const m = new Map<Element, number>();
    for (const el of els) {
      const r = roles.get(el)!;
      m.set(el, r === 'title' ? c * TITLE_K : r === 'content' ? c : Math.min(c, Math.max(c * SMALL_K, Math.min(st.scale.small, own.get(el)!))));
    }
    return m;
  };
  const prior = st.drawn ?? { texts: [], segs: [] };
  /** Pairs (text-text, text-stroke) that collide with these sizes, as keys. */
  const hits = (m: Map<Element, number> | null): Set<string> | null => {
    try {
      const c = g.cloneNode(true) as Element;
      const all: Element[] = Array.from(g.querySelectorAll("text")), cl: Element[] = Array.from(c.querySelectorAll("text"));
      if (m) all.forEach((el, i) => { const v = m.get(el); if (v != null) { cl[i].setAttribute('font-size', String(v)); for (const s of Array.from(cl[i].querySelectorAll('tspan'))) s.removeAttribute('font-size'); } });
      const geo = groupGeometry(c, 0);
      const idx = (t: TextBox) => cl.indexOf(t.el as Element);
      const out = new Set<string>();
      const ts = geo.texts, segs = geo.segs.filter((s) => !s.tiny).concat(prior.segs);
      for (let i = 0; i < ts.length; i++) {
        const a = airBox(ts[i]), k = core(ts[i]);
        for (let j = i + 1; j < ts.length; j++) if (ts[j].el !== ts[i].el && overlapArea(a, airBox(ts[j])) > 0) out.add(`t${idx(ts[i])}:${idx(ts[j])}`);
        prior.texts.forEach((p, j) => { if (overlapArea(a, airBox(p)) > 0) out.add(`p${idx(ts[i])}:${j}`); });
        segs.forEach((s, j) => { if (segHitsBox(s.a, s.b, k)) out.add(`s${idx(ts[i])}:${j}`); });
      }
      return out;
    } catch { return null; }
  };
  let c = hi;
  if (hi > lo + 0.01) {
    const base = hits(null);
    const fits = (v: number) => { const h = hits(sizesAt(v)); return !h || !base || [...h].every((k) => base.has(k)); };
    if (!fits(hi)) {
      let a = lo, b = hi;
      for (let i = 0; i < 8; i++) { const mid = (a + b) / 2; if (fits(mid)) a = mid; else b = mid; }
      c = a;
    }
  } else c = Math.max(Math.min(hi, target), Math.min(lo, hi));
  if (contentOwn.length) st.room = Math.min(st.room ?? Infinity, c);
  const sizes = sizesAt(c);
  // A text that still runs into one it was clear of at the model's size (a row so tight that even the
  // legibility floor collides) is set smaller on its own, down to what the model wrote (never under
  // `minFloor`): the rest of the group keeps its size.
  const base0 = hits(null);
  for (let i = 0; base0 && i < 12; i++) {
    const h = hits(sizes);
    if (!h) break;
    const bad = [...h].filter((k) => !base0.has(k));
    if (!bad.length) break;
    const all = Array.from(g.querySelectorAll('text'));
    const idx = new Set<number>();
    for (const k of bad) { const m = /^([tps])(\d+):(\d+)$/.exec(k); if (!m) continue; idx.add(+m[2]); if (m[1] === 't') idx.add(+m[3]); }
    let moved = false;
    for (const n of idx) {
      const el = all[n], v = el && sizes.get(el);
      if (!el || v == null) continue;
      const lim = Math.max(raw.get(el) ?? v, st.minFloor ?? 0);
      const nv = Math.max(lim, v * 0.93);
      if (nv < v - 1e-3) { sizes.set(el, nv); moved = true; }
    }
    if (!moved) break;
  }
  // What this group leaves on the board, for the next group's room.
  try {
    const cl = g.cloneNode(true) as Element;
    const all = Array.from(g.querySelectorAll('text')), ct = Array.from(cl.querySelectorAll('text'));
    all.forEach((el, i) => { const v = sizes.get(el); if (v != null) ct[i].setAttribute('font-size', String(v)); });
    const geo = groupGeometry(cl, 0);
    st.drawn = { texts: prior.texts.concat(geo.texts.map((t) => ({ ...t, el: undefined }))), segs: prior.segs.concat(geo.segs.filter((s) => !s.tiny)) };
  } catch { /* best-effort */ }
  return sizes;
}
