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
import type { Palette } from './style';
import type { SRect } from '../geometry/space';

const NS = 'http://www.w3.org/2000/svg';
/** No group takes longer than this to draw (strokes are compressed to fit). */
export const GROUP_MAX_MS = 3200;
const TEXT_FADE_MS = 240;
const FILL_FADE_MS = 220;

/** A board's state, kept on its root. */
export type SvgBoard = { root: SVGSVGElement; w: number; h: number; ns: string; palette: Palette; ids: Map<string, string>; groups: Map<string, SVGGElement> };
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
export function mountBoard(layer: SVGGElement, spec: { w: number; h: number; extend?: boolean }, ns: string, accent: string): { board: SvgBoard; height: number } {
  const old = boardIn(layer);
  if (old) {
    if (spec.h > old.h) { old.h = spec.h; old.root.setAttribute('viewBox', `0 0 ${old.w} ${old.h}`); old.root.setAttribute('height', String((old.h * 1000) / old.w)); }
    return { board: old, height: (old.h * 1000) / old.w };
  }
  const root = document.createElementNS(NS, 'svg') as SVGSVGElement;
  const w = spec.w > 0 ? spec.w : 1000, h = spec.h > 0 ? spec.h : 700;
  for (const [k, v] of Object.entries({ x: '0', y: '0', width: '1000', height: String((h * 1000) / w), viewBox: `0 0 ${w} ${h}`, overflow: 'visible', 'data-svgboard': ns })) root.setAttribute(k, v);
  layer.appendChild(root);
  const board: SvgBoard = { root, w, h, ns, palette: { accent, hue: null }, ids: new Map(), groups: new Map() };
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
  const minFont = pxPerUnit > 0 ? minPx / pxPerUnit : 16;
  return sanitizeGroup(src, { ns: b.ns, palette: b.palette, minFont: Math.max(8, minFont), w: b.w, h: b.h, ids: b.ids });
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

/**
 * Appends `g` (a replaced id's old group fades to a ghost first) and draws it. `speed` ≤ 1 compresses
 * (backlog); `signal` aborted → the final state at once.
 */
export async function drawGroup(b: SvgBoard, g: SVGGElement, id: string | undefined, o: { signal: AbortSignal; speed?: number; color: string;
  /** Each part as it starts drawing (in order): the board follows the pen through a group taller than the view. */
  onStep?: (el: SVGElement) => void }): Promise<void> {
  if (id) {
    const prev = b.groups.get(id);
    if (prev && prev !== g) { prev.removeAttribute('id'); prev.setAttribute('opacity', '0.3'); prev.setAttribute('data-ghost', ''); }
    b.groups.set(id, g);
  }
  b.root.appendChild(g);
  const instant = o.signal.aborted || prefersReducedMotion() || typeof requestAnimationFrame !== 'function';
  const leaves = Array.from(g.querySelectorAll(`${SHAPES},text`)).filter((el) => !el.closest('defs,marker,clipPath,pattern,symbol')) as SVGElement[];
  if (instant) {
    if (!o.signal.aborted && prefersReducedMotion()) { g.style.opacity = '0'; g.style.transition = `opacity ${TEXT_FADE_MS}ms ease-out`; await frame(); g.style.opacity = ''; }
    return;
  }
  const steps: Step[] = [];
  for (const el of leaves) {
    const isText = el.tagName.toLowerCase() === 'text';
    const cs = getComputedStyle(el);
    const strokeOn = !isText && cs.stroke && cs.stroke !== 'none' && parseFloat(cs.strokeWidth || '1') > 0;
    const dashed = cs.strokeDasharray && cs.strokeDasharray !== 'none';
    let len = 0;
    if (strokeOn && !dashed) { try { len = (el as unknown as SVGGeometryElement).getTotalLength(); } catch { len = 0; } }
    const m = (el as unknown as SVGGraphicsElement).getScreenCTM?.();
    const px = m ? Math.hypot(m.a, m.b) : 1;
    steps.push({ el, kind: len > 0 && Number.isFinite(len) ? 'trace' : 'fade', len, px });
  }
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
  const durs = steps.map((s) => (s.kind === 'trace' ? strokeDurationMs(s.len * s.px, s.len * s.px < 60 ? 120 : 200, speed) : 60 * speed));
  const total = durs.reduce((a, d) => a + d, 0);
  const k = total > GROUP_MAX_MS * speed ? (GROUP_MAX_MS * speed) / total : 1;
  const land = (s: Step) => {
    if (s.kind === 'trace') {
      s.el.style.strokeDasharray = ''; s.el.style.strokeDashoffset = ''; s.el.style.vectorEffect = ''; s.el.style.strokeWidth = '';
      for (const [a, v] of saved.get(s.el)?.markers ?? []) s.el.setAttribute(a, v);
      s.el.style.transition = `fill-opacity ${FILL_FADE_MS}ms ease-out`;
      s.el.style.fillOpacity = '';
    } else { s.el.style.transition = `opacity ${TEXT_FADE_MS}ms ease-out`; s.el.style.opacity = ''; }
  };
  const pen = {};
  penDown(pen);
  try {
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (o.signal.aborted) { for (const r of steps.slice(i)) land(r); break; }
      o.onStep?.(s.el);
      if (s.kind === 'fade') { land(s); await sleep(durs[i] * k); continue; }
      const geo = s.el as unknown as SVGGeometryElement;
      const dur = Math.max(60, durs[i] * k), t0 = performance.now();
      for (;;) {
        const t = o.signal.aborted ? 1 : Math.min(1, (performance.now() - t0) / dur);
        const d = s.len * ease(t);
        s.el.style.strokeDashoffset = String(s.len - d);
        try { const p = geo.getPointAtLength(d); penTo(pen, geo as unknown as SVGGraphicsElement, { x: p.x, y: p.y }, o.color); } catch { /* no geometry */ }
        if (t >= 1) break;
        await frame();
      }
      land(s);
    }
  } finally { penLift(pen); }
  if (!o.signal.aborted) await sleep(Math.min(FILL_FADE_MS, TEXT_FADE_MS));
}
