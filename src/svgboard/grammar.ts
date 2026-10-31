// src/svgboard/grammar.ts — the board's visual grammar for text, enforced on every model SVG (pure: no layout).
/**
 * Weight and colour carry meaning on the board, so the model's own values are discarded; size keeps
 * the model's own hierarchy (its sizes scaled by one factor per board: roomSizes), with roles for
 * weight and the floor:
 *  - SIZE encodes structure. Three roles exist: `title` (the board's top-most heading, once per
 *    board: the top-most text of the board's first group, words written larger than the rest of
 *    it, standing clear above it, not an axis's title), `small` (axis ticks and units: short numeric text next to a tick mark or along an axis
 *    line, or the engine's own ticks) and `content` (everything else: labels, values, card lines).
 *  - WEIGHT encodes importance only: semibold for the title, regular for everything else.
 *  - COLOUR encodes time only: every text is ink at rest. The part being drawn is the accent while it
 *    draws (render.ts `data-live`, styled in board CSS); superseded parts (ghosts) are grey.
 * The grammar's sizes (user units, from the slide's measured body size: content = the body, title =
 * 1.25 × body, small = 0.82 × body but never under 11 px on screen) are the ceiling the model's sizes
 * are raised toward; the legibility floor (LEGIBLE_PX) is what its smallest text is raised to.
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
export type TypeState = { scale: TypeScale; axes: Seg[]; ticks: Seg[]; titled: boolean; /** The scale factor over the model's sizes the board's tightest group settled on (a later group is never scaled more). */ roomK?: number; /** The legibility floor in user units (render.ts): a model's smaller text counts as this. */ floor?: number; /** The hard floor (units) a text may go to on its own, to clear a collision. */ minFloor?: number; drawn?: { texts: TextBox[]; segs: GSeg[] } };

export const SMALL_MIN_PX = 11;
/**
 * No board text is ever set under this on screen (a model's smaller text is raised to it first). It was
 * 10, with tight rows going to 8: dense lane boards read at 8–10 px (founder 2026-10-31). A label the
 * raise leaves no room moves instead (settle.ts); the model's canvas (p6.4) gives its labels this room.
 */
export const LEGIBLE_PX = 12;
/** The last resort a label with no room anywhere near may go to (settle.ts): the floor itself. */
export const MIN_PX = 12;
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
 * Applies the grammar to a group's texts: each gets its size (the model's, scaled: roomSizes; returned
 * for the text fitter, which owns font-size), weight and ink; the model's sizes, weights and colours on tspans are dropped.
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
/** Text is raised at most this far over the model's own sizes (uniformly): the drawing's proportions hold. */
export const RAISE_MAX = 1.5;

/**
 * The size each text is set at: the model's own sizes, scaled by ONE factor k for the whole board, so
 * the hierarchy the model wrote (title > label > annotation) is kept as it wrote it (founder 2026-10-31:
 * "text hierarchy doesn't exist" when every content text was set to one size). k is at least what
 * brings the smallest text of the group to the legibility floor (`st.floor`, 12 px on screen), and at
 * most the grammar's content target over the model's median content size (so the board's text reads at
 * the slide's body size, whatever the canvas), RAISE_MAX, and the k an earlier, tighter group settled
 * on; in that range, the largest k at which no text runs into a text or stroke it was clear of at the
 * model's own sizes. A title is never under TITLE_K × the content median.
 * Collisions that remain are moved apart by settle.ts (nudge, wrap), never by shrinking a tier.
 */
function roomSizes(g: Element, roles: Map<Element, Role>, st: TypeState): Map<Element, number> {
  const els = Array.from(roles.keys());
  const own = new Map<Element, number>();
  for (const el of els) {
    let fs = 16;
    for (let e: Element | null = el; e; e = e.parentElement) { const v = e.getAttribute('font-size'); if (v != null) { fs = num(v, 16); break; } }
    own.set(el, Math.max(1, fs));
    el.setAttribute('data-own', String(Math.round(fs * 10) / 10));
  }
  if (!els.length) return new Map();
  const ownMin = Math.min(...own.values());
  const contentOwn = els.filter((e) => roles.get(e) !== 'small').map((e) => own.get(e)!);
  const med = contentOwn.length ? contentOwn.slice().sort((a, b) => a - b)[Math.floor((contentOwn.length - 1) / 2)] : ownMin;
  // k may be under 1: a model that wrote its text larger than the slide's body (a 560 canvas on the 2560
  // lane is 1.6 px a unit) is brought to the grammar's target, never under the floor.
  const kMin = (st.floor ?? 0) / ownMin;
  const kMax = Math.max(kMin, Math.min(st.roomK ?? Infinity, RAISE_MAX, st.scale.content / med));
  const sizesAt = (k: number) => {
    const m = new Map<Element, number>();
    for (const el of els) m.set(el, roles.get(el) === 'title' ? Math.max(k * own.get(el)!, TITLE_K * k * med) : k * own.get(el)!);
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
  let k = kMax;
  if (kMax > kMin + 1e-3) {
    const base = hits(null);
    const fits = (v: number) => { const h = hits(sizesAt(v)); return !h || !base || [...h].every((x) => base.has(x)); };
    if (!fits(kMax)) {
      let a = kMin, b = kMax;
      for (let i = 0; i < 8; i++) { const mid = (a + b) / 2; if (fits(mid)) a = mid; else b = mid; }
      k = a;
    }
  }
  if (contentOwn.length) st.roomK = Math.min(st.roomK ?? Infinity, k);
  const sizes = sizesAt(k);
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
