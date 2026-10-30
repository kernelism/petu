// src/svgboard/render.ts — the svg board on the desk: a section's SVG root, and each group drawn on.
/**
 * A board is one `<svg data-svgboard>` in a section's agent layer, viewBox `0 0 w h` (the plan's
 * canvas) scaled to the section's 1000 units, so the model's coordinates are used as written. Groups
 * arrive one per beat (src/svgboard/wire.ts), are sanitized and restyled (sanitize.ts), appended, and
 * drawn on like the board's own ink: each stroke traced at pen speed (stroke-dashoffset, the pen
 * cursor riding its tip), its fill and arrowheads landing once it is traced, text fading in, in the
 * group's own order. Aborted (instant mode, a skip, a new answer) → the final state at once.
 */
import { penDown, penLift, penTo } from '../ink/agent/penCursor';
import { prefersReducedMotion, strokeDurationMs, ease } from '../ink/agent/animate';
import { sanitizeGroup, type Sanitized } from './sanitize';
import { namesWord } from '../playback/scheduler';
import { INK, type Palette } from './style';
import { isBound, newScope, resolveData, type DataScope } from './data';
import { prepareText } from './polish';
import { applyGrammar, newTypeState, typeScale, type TypeState } from './grammar';
import type { SRect } from '../geometry/space';

const NS = 'http://www.w3.org/2000/svg';
/** No group takes longer than this to draw (strokes are compressed to fit). */
export const GROUP_MAX_MS = 3200;
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
 * Mounts a board (or, `extend`, takes the one already in the layer and grows it). Returns the section
 * height it needs, in section units (the caller grows the section).
 */
/**
 * The hatch every board's washes use (board CSS `[data-wash]`): one pair of patterns per document, in
 * board units (a board is ~1000 wide, so lines ~10 units apart read as a fine diagonal hatch), over a
 * faint tint of the same ink. `-live` is the accent's, for the part being drawn.
 */
export function ensureHatch(doc: Document, accent: string): void {
  let defs = doc.getElementById('petu-hatch-defs') as Element | null;
  if (!defs) {
    const svg = doc.createElementNS(NS, 'svg');
    svg.setAttribute('id', 'petu-hatch-defs');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
    doc.body.appendChild(svg);
    defs = svg;
  }
  const host = defs;
  const pattern = (id: string, ink: string) => {
    let p = doc.getElementById(id) as Element | null;
    if (!p) {
      const pat = doc.createElementNS(NS, 'pattern');
      for (const [k, v] of Object.entries({ id, patternUnits: 'userSpaceOnUse', width: '9', height: '9', patternTransform: 'rotate(45)' })) pat.setAttribute(k, v);
      const tint = doc.createElementNS(NS, 'rect');
      for (const [k, v] of Object.entries({ width: '9', height: '9', 'fill-opacity': '0.08' })) tint.setAttribute(k, v);
      const line = doc.createElementNS(NS, 'line');
      for (const [k, v] of Object.entries({ x1: '0', y1: '0', x2: '0', y2: '9', 'stroke-width': '2.6', 'stroke-opacity': '0.62' })) line.setAttribute(k, v);
      pat.append(tint, line);
      host.appendChild(pat);
      p = pat;
    }
    p.querySelector('rect')?.setAttribute('fill', ink);
    p.querySelector('line')?.setAttribute('stroke', ink);
  };
  pattern('petu-hatch', INK.ink2);
  pattern('petu-hatch-live', accent);
}

export function mountBoard(layer: SVGGElement, spec: { w: number; h: number; extend?: boolean }, ns: string, accent: string): { board: SvgBoard; height: number } {
  ensureHatch(layer.ownerDocument, accent);
  const old = boardIn(layer);
  if (old) {
    if (spec.h > old.h) { old.h = spec.h; old.root.setAttribute('viewBox', `0 0 ${old.w} ${old.h}`); old.root.setAttribute('height', String((old.h * 1000) / old.w)); }
    return { board: old, height: (old.h * 1000) / old.w };
  }
  const root = document.createElementNS(NS, 'svg') as SVGSVGElement;
  const w = spec.w > 0 ? spec.w : 1000, h = spec.h > 0 ? spec.h : 700;
  for (const [k, v] of Object.entries({ x: '0', y: '0', width: '1000', height: String((h * 1000) / w), viewBox: `0 0 ${w} ${h}`, overflow: 'visible', 'data-svgboard': ns })) root.setAttribute(k, v);
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
  const st = b.type, min = Math.max(8, scale.small);
  return sanitizeGroup(src, { ns: b.ns, palette: b.palette, minFont: min, w: b.w, h: b.h, ids: b.ids, prepare: (g) => { resolveData(g, b.scope); prepareText(g, min, applyGrammar(g, st)); } });
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
const frame = () => new Promise<number>((r) => requestAnimationFrame(r));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));

type Step = { el: SVGElement; kind: 'trace' | 'fade'; len: number; px: number };

/** A part of a group drawn as one: a top-level child (a nested group is one part). */
type Unit = { el: Element; steps: Step[]; cat: number; words: string[]; at: number };

/**
 * Pen order of a part: frames and axes, then lines and curves, then points, then labels, then large
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

/** Words a part answers to in the narration: its id's words, else its text's first words. */
function wordsOf(el: Element, ns: string): string[] {
  const id = (el.getAttribute('data-name') ?? el.getAttribute('id') ?? '').replace(new RegExp(`^${ns.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-`), '');
  const fromId = id.split(/[^A-Za-z0-9]+|(?<=[a-z])(?=[A-Z])/).map((w) => w.toLowerCase()).filter((w) => w.length >= 3 && !/^(g|grp|group|lbl|label|txt|text|line|path|\d+)$/.test(w));
  if (fromId.length) return fromId;
  const t = el.nodeName.toLowerCase() === 'text' || el.nodeName.toLowerCase() === 'g' ? (el.textContent ?? '') : '';
  return t.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4).slice(0, 2);
}

/**
 * Appends `g` (a replaced id's old group fades to a ghost first) and draws it part by part. With the
 * beat's narration (`beat`: its words and when each is spoken) the parts are spread across it in pen
 * order, and a part the narration names (its id, its label's words) draws on that word; without it
 * they follow one another (≤ GROUP_MAX_MS). `speed` ≤ 1 compresses (backlog); `signal` aborted → the
 * final state at once.
 */
export async function drawGroup(b: SvgBoard, g: SVGGElement, id: string | undefined, o: { signal: AbortSignal; speed?: number; color: string; beat?: () => { text: string; inMs: number }[]; stop?: AbortSignal;
  /** Each part as it starts drawing (in order): the board follows the pen through a group taller than the view. */
  onStep?: (el: SVGElement) => void }): Promise<void> {
  if (id) {
    const prev = b.groups.get(id);
    if (prev && prev !== g) { prev.removeAttribute('id'); prev.setAttribute('opacity', '0.3'); prev.setAttribute('data-ghost', ''); }
    b.groups.set(id, g);
  }
  b.root.appendChild(g);
  b.root.style.setProperty('--board-live', o.color);
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
    units.push({ el: c, steps: leaves.map(stepOf), cat: categoryOf(c), words: wordsOf(c, b.ns), at: 0 });
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
  // The schedule: pen order, spread over the beat; a named part on its word.
  const words = speed >= 0.99 ? (o.beat?.() ?? []) : [];
  const order = units.map((u, i) => ({ u, i })).sort((a, z) => a.u.cat - z.u.cat || a.i - z.i).map((x) => x.u);
  let budget: number[];
  const paced = words.length >= 3 && order.length > 1;
  if (paced) {
    const span = Math.max(1500, Math.min(words[words.length - 1].inMs + 250, 900 * order.length, 9000));
    order.forEach((u, i) => { u.at = (i / order.length) * span * 0.85; });
    for (const u of order) {
      if (!u.words.length) continue;
      const w = words.find((x) => namesWord(x.text, u.words));
      if (w && w.inMs <= span + 1500) u.at = w.inMs;
    }
    order.sort((a, z) => a.at - z.at);
    budget = order.map((u, i) => Math.max(260, (order[i + 1]?.at ?? Math.max(u.at + 900, span)) - u.at));
  } else {
    const total = steps.reduce((a, s) => a + natural(s), 0);
    const k = total > GROUP_MAX_MS * speed ? (GROUP_MAX_MS * speed) / total : 1;
    let t = 0;
    for (const u of order) { u.at = t; t += u.steps.reduce((a, s) => a + natural(s) * k, 0); }
    budget = order.map((u) => u.steps.reduce((a, s) => a + natural(s) * k, 0) + 1);
  }
  const land = (s: Step) => {
    if (s.kind === 'trace') {
      s.el.style.strokeDasharray = ''; s.el.style.strokeDashoffset = ''; s.el.style.vectorEffect = ''; s.el.style.strokeWidth = '';
      for (const [a, v] of saved.get(s.el)?.markers ?? []) s.el.setAttribute(a, v);
      s.el.style.transition = `fill-opacity ${FILL_FADE_MS}ms ease-out`;
      s.el.style.fillOpacity = '';
    } else { s.el.style.transition = `opacity ${TEXT_FADE_MS}ms ease-out`; s.el.style.opacity = ''; }
  };
  const pen = {};
  const t0 = performance.now();
  // Paced over the beat, the drawing outlives the director's step (it resolves once under way): from
  // then on only a stop (a new answer, the student's stop) ends it, landing everything at once.
  const bg = new AbortController();
  const onSig = () => bg.abort();
  o.signal.addEventListener('abort', onSig);
  o.stop?.addEventListener('abort', onSig);
  const sig = bg.signal;
  const run = async () => { try {
    for (let ui = 0; ui < order.length; ui++) {
      const u = order[ui];
      if (sig.aborted) break;
      const wait = t0 + u.at - performance.now();
      if (wait > 16) { penLift(pen); await sleep(wait); if (sig.aborted) break; }
      penDown(pen);
      setLive(b, u.el);
      const nat = u.steps.reduce((a, s) => a + natural(s), 0);
      const k = nat > budget[ui] * 0.9 ? (budget[ui] * 0.9) / nat : 1;
      for (const s of u.steps) {
        if (sig.aborted) break;
        o.onStep?.(s.el);
        const d = natural(s) * k;
        if (s.kind === 'fade') { land(s); await sleep(d); continue; }
        const geo = s.el as unknown as SVGGeometryElement;
        const dur = Math.max(60, d), ts = performance.now();
        for (;;) {
          const t = sig.aborted ? 1 : Math.min(1, (performance.now() - ts) / dur);
          const len = s.len * ease(t);
          s.el.style.strokeDashoffset = String(s.len - len);
          try { const p = geo.getPointAtLength(len); penTo(pen, geo as unknown as SVGGraphicsElement, { x: p.x, y: p.y }, o.color); } catch { /* no geometry */ }
          if (t >= 1) break;
          await frame();
        }
        land(s);
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
  if (!sig.aborted) await sleep(Math.min(FILL_FADE_MS, TEXT_FADE_MS)); };
  const done = run();
  if (paced && o.stop) await Promise.race([done, sleep(Math.min(1500, ACTION_STEP_MS))]);
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
