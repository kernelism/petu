// src/svgboard/render.ts — the svg board on the desk: a section's SVG root, and each group drawn on.
/**
 * A board is one `<svg data-svgboard>` in a section's agent layer, viewBox `0 0 w h` (the plan's
 * canvas) scaled to the section's 1000 units, so the model's coordinates are used as written. Groups
 * arrive one per beat (src/svgboard/wire.ts), are sanitized and restyled (sanitize.ts), appended, and
 * drawn on like the board's own ink: each stroke traced at pen speed (stroke-dashoffset, the pen
 * cursor riding its tip), its fill and arrowheads landing once it is traced, text fading in, in the
 * group's own order. Aborted (instant mode, a skip, a new answer) → the final state at once. While its
 * answer is paused the drawing stands still mid-stroke (src/playback/inkTime.ts) and goes on at resume.
 */
import { penDown, penLift, penTo } from '../ink/agent/penCursor';
import { prefersReducedMotion, strokeDurationMs, ease } from '../ink/agent/animate';
import { sanitizeGroup, type Sanitized } from './sanitize';
import { beatEnd, labelNames, partWords, paceParts, splitPart, REPLAN_MS, type BeatWord, type Slot } from '../playback/pace';
import { INK, type Palette } from './style';
import { isBound, newScope, resolveData, type DataScope } from './data';
import { prepareText } from './polish';
import { applyGrammar, LEGIBLE_PX, MIN_PX, newTypeState, typeScale, type TypeState } from './grammar';
import { settle } from './settle';
import { groupGeometry } from './check';
import { holdFades, InkTime, type Paused } from '../playback/inkTime';
import type { SRect } from '../geometry/space';

const NS = 'http://www.w3.org/2000/svg';
/**
 * No group takes longer than this to draw at pen speed (strokes are compressed to fit). Under the
 * director's ACTION_TIMEOUT_MS (3 s): at 3.2 s its timeout landed the last 200 ms of every long group at once.
 */
export const GROUP_MAX_MS = 2600;
const TEXT_FADE_MS = 240;
const FILL_FADE_MS = 220;

/** A board's state, kept on its root. */
export type SvgBoard = { root: SVGSVGElement; w: number; h: number; ns: string; palette: Palette; ids: Map<string, string>; groups: Map<string, SVGGElement>;
  /** Exact data (data.ts): constants, frames, curves, named points of this board. */
  scope: DataScope;
  /** Groups holding elements bound to constants, in drawing order (re-resolved when a constant changes). */
  bound: SVGGElement[];
  /** Trace paths of moving points (data-trace), by element. */
  traces: Map<Element, { path: SVGPathElement; pts: string[] }>;
  /** The board's type grammar state (grammar.ts), from its first group. */
  type?: TypeState;
  /** The part being drawn right now (the accent: `data-live`), and its settle timer. */
  live?: Element | null; liveTimer?: ReturnType<typeof setTimeout> };
const boards = new WeakMap<SVGSVGElement, SvgBoard>();

/** The board's root in a section layer (null when the section holds none). */
export function boardIn(layer: SVGGElement): SvgBoard | null {
  const root = layer.querySelector(':scope > svg[data-svgboard]') as SVGSVGElement | null;
  return root ? boards.get(root) ?? null : null;
}

/**
 * The hatch a board's washes are painted with (sanitize.ts marks them data-wash; prepareGroup points
 * their fill here): a pair of patterns in the board's own <defs>, in board units (a board is ~1000
 * wide, so lines ~10 units apart read as a fine diagonal hatch), over a faint tint of the same ink.
 * `-live` is the accent's, for the part being drawn (board CSS `[data-live] [data-wash]`). Inside the
 * board, not the document: a board serialised alone (report screenshots, svgUrl) keeps its hatch.
 */
const hatchId = (ns: string, live = false) => `petu-hatch${live ? '-live' : ''}-${ns}`;
function addHatch(root: SVGSVGElement, ns: string, accent: string): void {
  const defs = root.appendChild(document.createElementNS(NS, 'defs'));
  for (const [id, ink] of [[hatchId(ns), INK.ink2], [hatchId(ns, true), accent]]) {
    const pat = defs.appendChild(document.createElementNS(NS, 'pattern'));
    for (const [k, v] of Object.entries({ id, patternUnits: 'userSpaceOnUse', width: '9', height: '9', patternTransform: 'rotate(45)' })) pat.setAttribute(k, v);
    const tint = pat.appendChild(document.createElementNS(NS, 'rect'));
    for (const [k, v] of Object.entries({ width: '9', height: '9', fill: ink, 'fill-opacity': '0.08' })) tint.setAttribute(k, v);
    const line = pat.appendChild(document.createElementNS(NS, 'line'));
    for (const [k, v] of Object.entries({ x1: '0', y1: '0', x2: '0', y2: '9', stroke: ink, 'stroke-width': '2.6', 'stroke-opacity': '0.62' })) line.setAttribute(k, v);
  }
  root.style.setProperty('--board-hatch-live', `url(#${hatchId(ns, true)})`);
}
/** The live hatch takes the colour a group is drawn in. */
function tintLiveHatch(b: SvgBoard, color: string): void {
  const p = b.root.querySelector(`pattern[id="${hatchId(b.ns, true)}"]`);
  p?.querySelector('rect')?.setAttribute('fill', color);
  p?.querySelector('line')?.setAttribute('stroke', color);
}

/**
 * Mounts a board (or, `extend`, takes the one already in the layer and grows it). Returns the section
 * height it needs, in section units (the caller grows the section).
 */
export function mountBoard(layer: SVGGElement, spec: { w: number; h: number; extend?: boolean }, ns: string, accent: string): { board: SvgBoard; height: number } {
  const old = boardIn(layer);
  if (old) {
    if (spec.h > old.h) { old.h = spec.h; old.root.setAttribute('viewBox', `0 0 ${old.w} ${old.h}`); old.root.setAttribute('height', String((old.h * 1000) / old.w)); }
    return { board: old, height: (old.h * 1000) / old.w };
  }
  const root = document.createElementNS(NS, 'svg') as SVGSVGElement;
  const w = spec.w > 0 ? spec.w : 1000, h = spec.h > 0 ? spec.h : 700;
  for (const [k, v] of Object.entries({ x: '0', y: '0', width: '1000', height: String((h * 1000) / w), viewBox: `0 0 ${w} ${h}`, overflow: 'visible', 'data-svgboard': ns })) root.setAttribute(k, v);
  addHatch(root, ns, accent);
  layer.appendChild(root);
  const board: SvgBoard = { root, w, h, ns, palette: { accent, hue: null }, ids: new Map(), groups: new Map(), scope: newScope(), bound: [], traces: new Map() };
  boards.set(root, board);
  return { board, height: (h * 1000) / w };
}

/** Grows a board's canvas to `h` (its own units); returns the section height needed. */
export function growBoard(b: SvgBoard, h: number): number {
  if (h > b.h) { b.h = h; b.root.setAttribute('viewBox', `0 0 ${b.w} ${b.h}`); b.root.setAttribute('height', String((b.h * 1000) / b.w)); }
  return (b.h * 1000) / b.w;
}

/**
 * Where `el` sits in its board's section, in section units (through any transforms), widened by
 * `air` units; null without layout.
 */
export function partBox(b: SvgBoard, el: Element, air = 0): SRect | null {
  try {
    // Through the root's screen matrix (a nested <svg>'s own client rect is its content's, not its canvas).
    const m = b.root.getScreenCTM?.(), r = el.getBoundingClientRect();
    if (!m || !(m.a > 0) || !(m.d > 0) || !(r.width > 0 || r.height > 0)) return null;
    const k = 1000 / b.w;
    return { x: ((r.left - m.e) / m.a) * k - air, y: ((r.top - m.f) / m.d) * k - air, w: (r.width / m.a) * k + 2 * air, h: (r.height / m.d) * k + 2 * air };
  } catch { return null; }
}

/** Sanitizes a group for this board (never appends). `minPx`: the smallest text on screen. */
export function prepareGroup(b: SvgBoard, src: string, minPx: number, pxPerUnit: number): Sanitized | string {
  // The board's grammar (grammar.ts): three text sizes from the body size, ink text, one title.
  const scale = pxPerUnit > 0 ? typeScale(minPx, pxPerUnit, pxPerUnit * b.w) : { content: 16, title: 20, small: 13 };
  if (b.type) b.type.scale = scale; else b.type = newTypeState(scale);
  // The floor any text is raised to before the grammar sets it (a legibility floor on screen, not the
  // grammar's sizes: those are raised only as far as the drawing has room, grammar.ts roomSizes).
  const st = b.type, floor = pxPerUnit > 0 ? LEGIBLE_PX / pxPerUnit : Math.max(8, scale.small);
  st.floor = floor;
  // The hard floor (MIN_PX = LEGIBLE_PX): no text goes under it, not even to clear a tight row (settle moves it).
  const min = pxPerUnit > 0 ? Math.min(floor, MIN_PX / pxPerUnit) : floor;
  st.minFloor = min;
  const s = sanitizeGroup(src, { ns: b.ns, palette: b.palette, minFont: min, w: b.w, h: b.h, ids: b.ids, prepare: (g) => {
    resolveData(g, b.scope);
    const raw = g.cloneNode(true) as Element, prior = st.drawn ?? { texts: [], segs: [] };
    prepareText(g, min, applyGrammar(g, st));
    // A label the floor leaves no room moves instead of shrinking (settle.ts); then this group's final
    // geometry is what the next group keeps clear of.
    settle(g, raw, prior, b.w);
    try { const geo = groupGeometry(g, 0); st.drawn = { texts: prior.texts.concat(geo.texts.map((t) => ({ ...t, el: undefined }))), segs: prior.segs.concat(geo.segs.filter((x) => !x.tiny)), bands: (prior.bands ?? []).concat(geo.bands ?? []) }; } catch { /* best-effort */ }
  } });
  // Washes: the board's hatch (an attribute, so a serialised board carries it with its pattern).
  if (typeof s !== 'string') s.el.querySelectorAll('[data-wash]').forEach((e) => e.setAttribute('fill', `url(#${hatchId(b.ns)})`));
  return s;
}

/** Whether a prepared group has elements bound to constants. */
export const hasBound = (g: Element): boolean => isBound(g) || Array.from(g.querySelectorAll('*')).some(isBound);

/**
 * A constant changed (a tween's frame): every bound group re-resolves in drawing order (named points
 * and curves of earlier groups first). A moving thing marked `data-ghost` leaves a faint copy of where
 * it started (the before stays readable); `data-trace` leaves the path its point travelled.
 */
export function refreshData(b: SvgBoard): void {
  b.scope.values.length = 0;
  for (const g of b.bound) {
    if (!g.isConnected) continue;
    for (const h of Array.from(g.querySelectorAll('[data-ghost]:not([data-ghosted])')).concat(g.matches('[data-ghost]:not([data-ghosted])') ? [g] : [])) ghost(h);
    resolveData(g, b.scope);
    for (const e of Array.from(g.querySelectorAll('[data-bad]'))) { e.setAttribute('display', 'none'); e.setAttribute('data-hid', ''); }
    for (const e of Array.from(g.querySelectorAll('[data-hid]:not([data-bad])'))) { e.removeAttribute('display'); e.removeAttribute('data-hid'); }
    for (const e of Array.from(g.querySelectorAll('[data-trace]')).concat(g.matches('[data-trace]') ? [g] : [])) trace(b, e);
  }
}

function ghost(h: Element): void {
  h.setAttribute('data-ghosted', '');
  const c = h.cloneNode(true) as Element;
  for (const e of [c, ...Array.from(c.querySelectorAll('*'))]) {
    for (const a of e.getAttributeNames()) if (a.startsWith('data-')) e.removeAttribute(a);
    if (e.getAttribute('id')) e.removeAttribute('id');
    (e as SVGElement).style?.removeProperty?.('opacity');
    // Superseded: grey (the board's grammar: grey only for what was replaced).
    for (const k of ['stroke', 'fill']) { const v = e.getAttribute(k); if (v && v !== 'none' && v !== INK.paper && !/^url/i.test(v)) e.setAttribute(k, INK.muted); }
  }
  c.setAttribute('opacity', '0.28');
  c.setAttribute('data-ghost-of', '');
  // A ghost's text would read as a second label: only its marks stay.
  c.querySelectorAll('text').forEach((t) => t.remove());
  if (c.nodeName.toLowerCase() === 'text') return;
  h.parentNode?.insertBefore(c, h);
}

function trace(b: SvgBoard, e: Element): void {
  const tag = e.nodeName.toLowerCase();
  const xy = tag === 'circle' || tag === 'ellipse' ? `${e.getAttribute('cx')} ${e.getAttribute('cy')}` : e.getAttribute('data-at-xy');
  if (!xy || /null|NaN/.test(xy)) return;
  let t = b.traces.get(e);
  if (!t) {
    const path = document.createElementNS(NS, 'path') as SVGPathElement;
    for (const [k, v] of Object.entries({ fill: 'none', stroke: b.palette.accent, 'stroke-width': '1.5', 'stroke-opacity': '0.45', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke', 'data-trace-of': '' })) path.setAttribute(k, v);
    const g = e.closest('[data-svg-group]') ?? e;
    g.parentNode?.insertBefore(path, g);
    t = { path, pts: [] };
    b.traces.set(e, t);
  }
  if (t.pts[t.pts.length - 1] === xy) return;
  if (t.pts.length > 4000) t.pts.splice(1, 1);
  t.pts.push(xy);
  t.path.setAttribute('d', `M${t.pts.join('L')}`);
}


/** The group's box in section units (getBBox through the board's scale); null without layout. */
export function groupBox(b: SvgBoard, g: SVGGElement): SRect | null {
  try {
    const r = typeof g.getBBox === 'function' ? g.getBBox() : null;
    if (!r || !(r.width > 0 || r.height > 0)) return null;
    const k = 1000 / b.w;
    return { x: r.x * k, y: r.y * k, w: r.width * k, h: r.height * k };
  } catch { return null; }
}

const SHAPES = 'path,line,polyline,polygon,rect,circle,ellipse';
const isNum = (w: string) => /\d/.test(w);
const frame = () => new Promise<number>((r) => requestAnimationFrame(r));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));

type Step = { el: SVGElement; kind: 'trace' | 'fade'; len: number; px: number };

/** A part of a group drawn as one: a top-level child (a nested group is one part). */
type Unit = { el: Element; steps: Step[]; cat: number; names: { words: string[]; label?: string[] }; at: number };

/**
 * Pen order of a part, at pen speed only (no beat to pace by; paced, the group's own order and its
 * words decide): frames and axes, then lines and curves, then points, then labels, then large
 * fills (a wash lands under what it shades once the strokes are there).
 */
function categoryOf(el: Element): number {
  const name = el.nodeName.toLowerCase();
  if (el.hasAttribute('data-box') || el.hasAttribute('data-frame')) return 0;
  if (name === 'text') return 3;
  if (name === 'g') {
    const kids = Array.from(el.querySelectorAll(SHAPES)).filter((k) => !k.closest('defs,marker,clipPath,pattern,symbol'));
    return kids.length ? Math.min(...kids.map(categoryOf)) : 3;
  }
  if ((name === 'circle' || name === 'ellipse') && parseFloat(el.getAttribute('r') ?? el.getAttribute('rx') ?? '99') <= 12) return 2;
  const fill = el.getAttribute('fill'), stroke = el.getAttribute('stroke');
  if (fill && fill !== 'none' && (!stroke || stroke === 'none')) return 4;
  return 1;
}

/**
 * The words a part answers to in the narration (pace.ts PartIn): its `data-say` when it has one (the
 * author's words for it, numbers included), else its id's words (partWords), with its label's numbers and
 * words (labelNames, data-val readouts resolved by now) for when the id's words aren't said. A frame
 * (axes with engine L or ticks, data.ts drawFrame) answers to its id only: its texts are tick values,
 * round numbers the narration says all the time ("at a price of 10"), and named by one it drew after the
 * curves on it (D20: the frame last, on "30" in the closing sentence). Unnamed, it leads from the beat's start.
 * Texts are read one by one: engine ticks have no space between them ("0 m10 m20 m" read 051015).
 */
export function partNames(el: Element, ns: string, groupId?: string): { words: string[]; label?: string[] } {
  const say = el.getAttribute('data-say');
  if (say?.trim()) return { words: labelNames(say, true) };
  const id = (el.getAttribute('data-name') ?? el.getAttribute('id') ?? '').replace(new RegExp(`^${ns.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-`), '');
  if (el.hasAttribute('data-axes') && (el.hasAttribute('data-frame') || el.hasAttribute('data-ticks-x') || el.hasAttribute('data-ticks-y'))) return { words: partWords(id, groupId) };
  const tag = el.nodeName.toLowerCase();
  const t = tag === 'text' ? (el.textContent ?? '') : tag === 'g' ? Array.from(el.querySelectorAll('text'), (x) => x.textContent ?? '').join(' ') : '';
  // A readout (a data-val text) is said by its value ({{val id=…}}): that is its name, before its id's
  // words and its prose, which drew it early: "midpoint 15", "midpoint 9", "midpoint change: +66.7%" all
  // on the beat's first "midpoint" (D18), "×1.5 per block" (id factor) on a later "factors" (D9). The
  // value only: "+$10: 50.0%" is said on "50.0", not on the "$10" its template typed.
  if (tag === 'text') {
    const vals = [el, ...Array.from(el.querySelectorAll('[data-val]'))].filter((e) => e.hasAttribute('data-val')).flatMap((e) => {
      const typed = labelNames(e.getAttribute('data-tpl') ?? '').filter(isNum);
      return labelNames(e.textContent ?? '').filter((w) => { const i = typed.indexOf(w); if (i >= 0) typed.splice(i, 1); return isNum(w) && i < 0; });
    });
    if (vals.length) return { words: vals, label: [...partWords(id, groupId), ...labelNames(t).filter((w) => !vals.includes(w))] };
  }
  return { words: partWords(id, groupId), label: labelNames(t) };
}

/**
 * Appends `g` (a replaced id's old group fades to a ghost first) and draws it part by part. With the
 * beat's narration (`beat`: its words and when each is spoken) the drawing is paced to the speech
 * (src/playback/pace.ts): a part the narration names (its data-say, its id, its label's words and
 * numbers) starts on that word, the others draw next to their named neighbours in the group's order,
 * and each draws across its share of the words, not
 * at pen speed; `slot`: this group shares the beat with others that came with it. Without a beat they
 * follow one another at pen speed (≤ GROUP_MAX_MS). `speed` ≤ 1 compresses (backlog); `signal`
 * aborted → the final state at once; `paused`: while it holds, nothing moves (no stroke, fade or new
 * part), and every time left in the plan moves later by the pause.
 */
export async function drawGroup(b: SvgBoard, g: SVGGElement, id: string | undefined, o: { signal: AbortSignal; speed?: number; color: string; beat?: () => BeatWord[];
  /** This group's share of a beat other groups also draw in (they came together, before its words). */
  slot?: Slot; stop?: AbortSignal;
  /** Whether the answer is paused (its narration stopped): the drawing waits with it. */
  paused?: Paused;
  /** Each part as it starts drawing (in order): the board follows the pen through a group taller than the view. */
  onStep?: (el: SVGElement) => void }): Promise<void> {
  if (id) {
    const prev = b.groups.get(id);
    if (prev && prev !== g) { prev.removeAttribute('id'); prev.setAttribute('opacity', '0.3'); prev.setAttribute('data-ghost', ''); }
    b.groups.set(id, g);
  }
  b.root.appendChild(g);
  b.root.style.setProperty('--board-live', o.color);
  tintLiveHatch(b, o.color);
  setLive(b, null);
  const instant = o.signal.aborted || prefersReducedMotion() || typeof requestAnimationFrame !== 'function';
  const isLeaf = (el: Element) => el.matches(`${SHAPES},text`) && !el.closest('defs,marker,clipPath,pattern,symbol') && el.getAttribute('display') !== 'none';
  if (instant) {
    if (!o.signal.aborted && prefersReducedMotion()) { g.style.opacity = '0'; g.style.transition = `opacity ${TEXT_FADE_MS}ms ease-out`; await frame(); g.style.opacity = ''; }
    return;
  }
  const stepOf = (el: SVGElement): Step => {
    const isText = el.tagName.toLowerCase() === 'text';
    const cs = getComputedStyle(el);
    const strokeOn = !isText && cs.stroke && cs.stroke !== 'none' && parseFloat(cs.strokeWidth || '1') > 0;
    const dashed = cs.strokeDasharray && cs.strokeDasharray !== 'none';
    let len = 0;
    if (strokeOn && !dashed) { try { len = (el as unknown as SVGGeometryElement).getTotalLength(); } catch { len = 0; } }
    const m = (el as unknown as SVGGraphicsElement).getScreenCTM?.();
    const px = m ? Math.hypot(m.a, m.b) : 1;
    return { el, kind: len > 0 && Number.isFinite(len) ? 'trace' : 'fade', len, px };
  };
  const units: Unit[] = [];
  for (const c of Array.from(g.children)) {
    const leaves = (isLeaf(c) ? [c] : Array.from(c.querySelectorAll(`${SHAPES},text`)).filter(isLeaf)) as SVGElement[];
    if (!leaves.length) continue;
    units.push({ el: c, steps: leaves.map(stepOf), cat: categoryOf(c), names: partNames(c, b.ns, id), at: 0 });
  }
  const steps = units.flatMap((u) => u.steps);
  // Hide everything, then reveal in order.
  const saved = new Map<SVGElement, { markers: [string, string][] }>();
  for (const s of steps) {
    if (s.kind === 'trace') {
      const markers: [string, string][] = [];
      for (const k of ['marker-start', 'marker-mid', 'marker-end']) { const v = s.el.getAttribute(k); if (v) { markers.push([k, v]); s.el.removeAttribute(k); } }
      saved.set(s.el, { markers });
      // Dashes of a non-scaling stroke are measured on screen: while it traces, it scales (same look).
      const sw = parseFloat(getComputedStyle(s.el).strokeWidth || '1') || 1;
      s.el.style.vectorEffect = 'none';
      s.el.style.strokeWidth = String(sw / (s.px || 1));
      s.el.style.strokeDasharray = `${s.len} ${s.len}`;
      s.el.style.strokeDashoffset = `${s.len}`;
      s.el.style.fillOpacity = '0';
    } else s.el.style.opacity = '0';
  }
  const speed = o.speed ?? 1;
  const natural = (s: Step) => (s.kind === 'trace' ? strokeDurationMs(s.len * s.px, s.len * s.px < 60 ? 120 : 200, speed) : 60 * speed);
  // The schedule: paced to the beat's narration (src/playback/pace.ts), else at pen speed.
  // Paced whenever the beat is known, even a little behind its word (a backlog `speed` < 1): the beat's
  // times are from now, so the drawing catches up with the words by itself.
  const words = o.beat?.() ?? [];
  const partIn = (u: Unit) => ({ ...u.names, naturalMs: u.steps.reduce((a, s) => a + natural(s), 0) });
  // Every time below is on the ink's own clock: it stands still while the answer is paused.
  const clock = new InkTime(o.paused, (held) => holdFades(g, held));
  const plannedAt = clock.now();
  const plan = paceParts(units.map(partIn), words, o.slot);
  /** When the beat began and when it was last known to end (absolute ms): a later end re-plans the parts left. */
  const beatFrom = plannedAt + (words[0]?.inMs ?? 0);
  let beatTo = plannedAt + beatEnd(words);
  const paced = !!plan;
  let order: Unit[];
  /** Each part's draw time (in `order`); paced, split over its steps in proportion to their pen time. */
  let budget: number[];
  if (plan) {
    order = plan.map((p) => { units[p.i].at = p.at; return units[p.i]; });
    budget = plan.map((p) => p.dur);
  } else {
    order = units.map((u, i) => ({ u, i })).sort((a, z) => a.u.cat - z.u.cat || a.i - z.i).map((x) => x.u);
    const total = steps.reduce((a, s) => a + natural(s), 0);
    const k = total > GROUP_MAX_MS * speed ? (GROUP_MAX_MS * speed) / total : 1;
    let t = 0;
    for (const u of order) { u.at = t; t += u.steps.reduce((a, s) => a + natural(s) * k, 0); }
    budget = order.map((u) => u.steps.reduce((a, s) => a + natural(s) * k, 0) + 1);
  }
  const land = (s: Step, fadeMs = TEXT_FADE_MS) => {
    if (s.kind === 'trace') {
      s.el.style.strokeDasharray = ''; s.el.style.strokeDashoffset = ''; s.el.style.vectorEffect = ''; s.el.style.strokeWidth = '';
      for (const [a, v] of saved.get(s.el)?.markers ?? []) s.el.setAttribute(a, v);
      s.el.style.transition = `fill-opacity ${FILL_FADE_MS}ms ease-out`;
      s.el.style.fillOpacity = '';
    } else { s.el.style.transition = `opacity ${fadeMs}ms ease-out`; s.el.style.opacity = ''; }
  };
  const pen = {};
  /** When the last fade started lands (ink time). */
  let fadesTo = 0;
  const t0 = clock.now();
  // Paced over the beat, the drawing outlives the director's step (it resolves once under way), and only
  // a stop (a new answer, the student's stop) ends it, landing everything at once. The step's own signal
  // (the director's land() before the view moves, its step timeout) no longer does, even in the step's
  // first moments: a scroll or a reveal then landed the whole group at once, skipping every part still
  // to come in its beat. At pen speed (or with no stop to end it) the step's signal still lands it.
  const bg = new AbortController();
  const onSig = () => bg.abort();
  const own = paced && !!o.stop;
  if (!own) o.signal.addEventListener('abort', onSig);
  o.stop?.addEventListener('abort', onSig);
  const sig = bg.signal;
  const run = async () => { try {
    /**
     * The beat's end moved since the plan (more streamed in, it closed, a voice piece came late or the
     * speed changed): the parts from `ui` on spread over what is left of it. A beat of one word too (it
     * was planned while open; left at pen speed, it kept the open guess).
     */
    const replan = (ui: number) => {
      if (!paced || !o.beat) return;
      const nowT = clock.now(), w = o.beat();
      if (!w.length || Math.abs(nowT + beatEnd(w) - beatTo) <= REPLAN_MS) return;
      beatTo = nowT + beatEnd(w);
      const rest = order.slice(ui);
      const re = paceParts(rest.map(partIn), w, o.slot, beatFrom - nowT);
      if (re) re.forEach((p, j) => { order[ui + j] = rest[p.i]; rest[p.i].at = nowT - t0 + p.at; budget[ui + j] = p.dur; });
    };
    for (let ui = 0; ui < order.length; ui++) {
      if (sig.aborted) break;
      // A part waiting for its word wakes every REPLAN_MS to re-plan: slept through, it drew at the time
      // its word had when it went to sleep (2 s early when the voice piece holding that word came late).
      let first = true;
      for (;;) {
        replan(ui);
        const wait = t0 + order[ui].at - clock.now();
        if (first && wait > 16) penLift(pen);
        // (Also while paused at a part's start: it waits for the resume before the board follows it.)
        await clock.sleep(wait > 16 ? Math.min(wait, REPLAN_MS) : 0, sig);
        first = false;
        if (sig.aborted || wait <= REPLAN_MS) break;
      }
      const u = order[ui];
      if (sig.aborted) break;
      penDown(pen);
      setLive(b, u.el);
      // Paced: the part fills its share of the narration (strokes in proportion to their length).
      // At pen speed: natural, compressed to its budget.
      const nat = u.steps.reduce((a, s) => a + natural(s), 0);
      const k = nat > budget[ui] * 0.9 ? (budget[ui] * 0.9) / nat : 1;
      const share = paced ? splitPart(budget[ui], u.steps.map(natural)) : u.steps.map((s) => natural(s) * k);
      for (let si = 0; si < u.steps.length; si++) {
        const s = u.steps[si];
        if (sig.aborted) break;
        o.onStep?.(s.el);
        const d = share[si];
        if (s.kind === 'fade') { const ms = paced ? Math.max(TEXT_FADE_MS, Math.min(TEXT_FADE_MS * 2.5, d)) : TEXT_FADE_MS; land(s, ms); fadesTo = Math.max(fadesTo, clock.now() + ms); await clock.sleep(d, sig); continue; }
        const geo = s.el as unknown as SVGGeometryElement;
        const dur = Math.max(60, d), ts = clock.now();
        for (;;) {
          const t = sig.aborted ? 1 : Math.min(1, (clock.now() - ts) / dur);
          const len = s.len * ease(t);
          s.el.style.strokeDashoffset = String(s.len - len);
          try { const p = geo.getPointAtLength(len); penTo(pen, geo as unknown as SVGGraphicsElement, { x: p.x, y: p.y }, o.color); } catch { /* no geometry */ }
          if (t >= 1) break;
          await clock.frame(sig);
        }
        land(s);
        fadesTo = Math.max(fadesTo, clock.now() + FILL_FADE_MS);
      }
    }
  } finally {
    penLift(pen);
    // The last part stays the accent a moment, then settles to ink (a stop settles it at once).
    if (sig.aborted) setLive(b, null); else settleLive(b, LIVE_SETTLE_MS);
    // Whatever did not draw (aborted) lands now.
    for (const s of steps) if (s.el.style.opacity === '0' || s.el.style.strokeDashoffset !== '') land(s);
    o.stop?.removeEventListener('abort', onSig);
  }
  // The last fades run out on the ink's clock (a pause holds them), then a held pause lets go.
  if (!sig.aborted) await clock.sleep(Math.max(Math.min(FILL_FADE_MS, TEXT_FADE_MS), fadesTo - clock.now()), sig);
  clock.release(); };
  const done = run();
  // The step hands back early when its signal asks (land() waits for it), the drawing goes on.
  const asked = new Promise<void>((r) => { if (o.signal.aborted) r(); else o.signal.addEventListener('abort', () => r(), { once: true }); });
  if (own) await Promise.race([done, sleep(Math.min(1500, ACTION_STEP_MS)), asked]);
  else await done;
  o.signal.removeEventListener('abort', onSig);
}
/** How long the last drawn part keeps the accent once its group is done. */
const LIVE_SETTLE_MS = 1400;

/** Marks `el` as the part being drawn (the accent, board CSS); the previous part settles to ink. */
export function setLive(b: SvgBoard, el: Element | null): void {
  if (b.liveTimer) { clearTimeout(b.liveTimer); b.liveTimer = undefined; }
  if (b.live && b.live !== el) b.live.removeAttribute('data-live');
  b.live = el;
  el?.setAttribute('data-live', '');
}
function settleLive(b: SvgBoard, ms: number): void {
  const el = b.live;
  if (!el) return;
  if (b.liveTimer) clearTimeout(b.liveTimer);
  b.liveTimer = setTimeout(() => { if (b.live === el) setLive(b, null); }, ms);
}

/** Under the director's per-action timeout (ACTION_TIMEOUT_MS 3 s): a paced group hands back before it. */
const ACTION_STEP_MS = 2400;
