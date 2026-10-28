// src/desk/render.ts
import type { SPt, SRect } from '../geometry/space';
import type { InkStyle } from '../ink/agent/marks';
import { drawStrokes, prefersReducedMotion } from '../ink/agent/animate';
import { lineStroke } from '../ink/agent/strokes';
import { estimateTextBox } from './nudge';
import type { ElementEntry } from './registry';
import type { Pace } from './types';

const SVG = 'http://www.w3.org/2000/svg';
/** Neutral ink for the setup in regions (rule 6); `em` uses the accent ink color. */
export const DESK_INK = '#1D1D1F';
const SYSTEM = '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';
const HAND = '"Bradley Hand", "Segoe Print", cursive';
/**
 * Text is sized for the screen at the moment it is written (CSS px), then lives in target units,
 * so a region that later moves between C and B scales as one picture.
 */
export const TEXT_PX = { label: 15, s: 14, m: 17, l: 22 } as const;
export const MATH_PX = { s: 17, m: 22, l: 28 } as const;
/** Letters reveal at this pace; one text never takes longer than WRITE_MAX_MS. */
export const CHARS_PER_SEC = 34;
export const WRITE_MAX_MS = 900;
const FADE_MS = 260;

const frame = () => new Promise<number>((r) => requestAnimationFrame(r));
const wait = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const set = (el: Element, attrs: Record<string, string | number>) => Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));

export const own = (parent: SVGGElement): SVGGElement => parent.appendChild(document.createElementNS(SVG, 'g')) as SVGGElement;

export type TextOpts = { size: number; style: InkStyle; color: string; run?: boolean };

/** A text element with its left edge at at.x and its vertical middle at at.y (target units). */
export function makeText(g: SVGGElement, at: SPt, text: string, o: TextOpts): SVGTextElement {
  const t = document.createElementNS(SVG, 'text');
  const hand = o.style === 'hand';
  set(t, {
    x: at.x, y: at.y, 'font-size': o.size * (hand ? 1.12 : 1), 'font-family': hand ? HAND : SYSTEM,
    'font-weight': hand ? 700 : 560, fill: o.color, 'dominant-baseline': 'middle',
  });
  if (o.run) t.setAttribute('data-run', '');
  t.textContent = text;
  g.appendChild(t);
  return t;
}

/** A text's box in target units before it is shown: getBBox in a browser, an estimate in jsdom. */
export function measureText(layer: SVGGElement, text: string, o: TextOpts): { w: number; h: number } {
  const probe = own(layer);
  probe.setAttribute('visibility', 'hidden');
  const t = makeText(probe, { x: 0, y: 0 }, text, o);
  let b: { width: number; height: number } | null = null;
  try { b = typeof t.getBBox === 'function' ? t.getBBox() : null; } catch { b = null; }
  probe.remove();
  return b && b.width > 0 ? { w: b.width, h: b.height } : estimateTextBox(text, o.size);
}

/** Each glyph (or word) fades in over this, one after another: never half a glyph on screen. */
export const UNIT_FADE_MS = 110;
/** Text longer than this is written word by word. */
export const WORDS_FROM = 40;

/**
 * The units a text is written in: whole characters (code points), or whole words for long text.
 * Spaces ride with the unit before them, so no unit is blank and nothing collapses between tspans.
 */
export function textUnits(text: string): string[] {
  const chars = Array.from(text);
  const out: string[] = [];
  if (chars.length > WORDS_FROM) {
    for (const m of text.matchAll(/\S+\s*|\s+/g)) out.push(m[0]);
  } else {
    for (const c of chars) {
      if (/\s/.test(c) && out.length) out[out.length - 1] += c;
      else out.push(c);
    }
  }
  return out;
}

/** Start times of `n` units fading in over `fade` ms, spread so the last one lands at `dur`. */
export function unitStarts(n: number, dur: number, fade: number): number[] {
  if (n <= 1) return [0];
  const span = Math.max(0, dur - fade);
  return Array.from({ length: n }, (_, i) => (span * i) / (n - 1));
}

type Unit = { el: HTMLElement | SVGElement; prop: 'opacity' | 'fillOpacity' };

/** Splits every svg text in `g` into one tspan per unit; returns the units and how to undo the split. */
function splitTexts(g: SVGGElement): { units: Unit[]; undo(): void } {
  const units: Unit[] = [];
  const undo: (() => void)[] = [];
  for (const t of g.querySelectorAll('text')) {
    const text = t.textContent ?? '';
    t.textContent = '';
    for (const u of textUnits(text)) {
      const span = document.createElementNS(SVG, 'tspan');
      span.textContent = u;
      t.appendChild(span);
      units.push({ el: span, prop: 'fillOpacity' }); // opacity doesn't apply to tspans
    }
    undo.push(() => { t.textContent = text; });
  }
  return { units, undo: () => undo.forEach((f) => f()) };
}

/** Typeset math's smallest pieces (glyph runs, fraction rules, radicals), in writing order (left to right). */
function mathUnits(g: SVGGElement): Unit[] {
  const leaves: HTMLElement[] = [];
  const walk = (el: Element) => {
    const kids = el.children;
    if (el.namespaceURI === SVG && el.tagName.toLowerCase() === 'svg') { leaves.push(el as HTMLElement); return; }
    if (!kids.length) { leaves.push(el as HTMLElement); return; } // glyph runs, and empty spans that draw (fraction rules)
    for (const k of kids) walk(k);
  };
  for (const fo of g.querySelectorAll('foreignObject')) for (const k of fo.children) walk(k);
  const x = leaves.map((el) => { const r = el.getBoundingClientRect?.(); return r && r.width + r.height > 0 ? r.left : NaN; });
  const order = leaves.map((_, i) => i);
  if (x.every((v) => !Number.isNaN(v))) order.sort((a, b) => x[a] - x[b] || a - b);
  return order.map((i) => ({ el: leaves[i], prop: 'opacity' as const }));
}

/**
 * Writes `g` in at writing pace: whole glyphs (whole words for long text, typeset pieces for math)
 * appear one after another, each with a short fade, so no frame shows a half-cut letter. Or fades
 * it in (clean style, reduced motion, backlog). Same total time as before: `chars` at
 * CHARS_PER_SEC, 220ms to WRITE_MAX_MS, × speed.
 */
export async function reveal(g: SVGGElement, _box: SRect, chars: number, o: { style: InkStyle; signal?: AbortSignal } & Pace): Promise<void> {
  const fadeIn = async () => {
    const ms = o.fadeMs ?? FADE_MS;
    g.style.opacity = '0';
    g.style.transition = `opacity ${ms}ms ease-out`;
    await frame();
    g.style.opacity = '1';
    if (!o.signal?.aborted) await wait(ms);
  };
  if (o.style === 'clean' || o.fadeMs != null || prefersReducedMotion()) return fadeIn();
  const split = splitTexts(g);
  const units = [...split.units, ...mathUnits(g)];
  if (!units.length) { split.undo(); return fadeIn(); }
  const dur = Math.min(WRITE_MAX_MS, Math.max(220, (chars / CHARS_PER_SEC) * 1000)) * o.speed;
  const fade = Math.min(UNIT_FADE_MS * o.speed, dur / 2);
  const starts = unitStarts(units.length, dur, fade);
  const setOp = (u: Unit, v: number) => { (u.el.style as unknown as Record<string, string>)[u.prop] = v >= 1 ? '' : String(v); };
  units.forEach((u) => setOp(u, 0));
  const t0 = performance.now();
  let from = 0; // units before this are fully in
  for (;;) {
    const t = o.signal?.aborted ? Infinity : performance.now() - t0;
    for (let i = from; i < units.length && starts[i] <= t; i++) {
      const v = Math.min(1, (t - starts[i]) / Math.max(1, fade));
      setOp(units[i], v);
      if (v >= 1 && i === from) from++;
    }
    if (from >= units.length) break;
    await frame();
  }
  split.undo();
}

/** A filled dot that pops in (scale 0 → 1, 140ms). */
export async function drawDot(g: SVGGElement, c: SPt, r: number, color: string, k: Pace, signal?: AbortSignal): Promise<SVGCircleElement> {
  const d = document.createElementNS(SVG, 'circle');
  set(d, { cx: c.x, cy: c.y, r, fill: color, class: 'desk-dot' });
  const ms = Math.round((k.fadeMs ?? 140) * (k.fadeMs != null ? 1 : k.speed));
  d.style.transformBox = 'fill-box';
  d.style.transformOrigin = 'center';
  d.style.transform = 'scale(0)';
  d.style.transition = `transform ${ms}ms cubic-bezier(.3,1.4,.5,1)`;
  g.appendChild(d);
  await frame();
  d.style.transform = 'none';
  if (!signal?.aborted) await wait(ms);
  return d;
}

export type ShadeShape = { pts: SPt[] } | { c: SPt; rx: number; ry: number };
/** A translucent fill that fades in under the ink (goes in the target's highlight layer). */
export async function drawShade(g: SVGGElement, s: ShadeShape, color: string, opacity: number, k: Pace, signal?: AbortSignal): Promise<void> {
  const el = 'pts' in s ? document.createElementNS(SVG, 'polygon') : document.createElementNS(SVG, 'ellipse');
  if ('pts' in s) el.setAttribute('points', s.pts.map((p) => `${p.x},${p.y}`).join(' '));
  else set(el, { cx: s.c.x, cy: s.c.y, rx: s.rx, ry: s.ry });
  set(el, { fill: color, 'fill-opacity': opacity });
  const ms = Math.round(k.fadeMs ?? 320 * k.speed);
  el.style.opacity = '0';
  el.style.transition = `opacity ${ms}ms ease-out`;
  g.appendChild(el);
  await frame();
  el.style.opacity = '1';
  if (!signal?.aborted) await wait(ms);
}

/**
 * emph: a brief thicker accent pass over the element, which then fades, leaving the original.
 * Stroked elements are re-traced; text gets a quick accent underline swoosh.
 */
export async function emphPass(e: ElementEntry, color: string, scale: number, signal?: AbortSignal): Promise<void> {
  const g = own(e.group.parentNode as SVGGElement);
  const strokes = e.strokes?.length ? e.strokes : [lineStroke({ x: e.bbox.x, y: e.bbox.y + e.bbox.h + 3 }, { x: e.bbox.x + e.bbox.w, y: e.bbox.y + e.bbox.h + 3 }, null)];
  await drawStrokes(g, strokes, { color, width: 7, opacity: 0.45, scale, signal, mode: prefersReducedMotion() ? 'fade' : 'trace', speed: 0.6 });
  g.style.transition = 'opacity 450ms ease-out';
  g.style.opacity = '0';
  await wait(signal?.aborted ? 0 : 450);
  g.remove();
}

/** move: glides a group by (dx, dy) target units over `ms` (ease-in-out). */
export async function moveGroup(g: SVGGElement, dx: number, dy: number, ms: number, signal?: AbortSignal): Promise<void> {
  const t = translateOf(g);
  return moveGroupTo(g, t.x + dx, t.y + dy, ms, signal);
}

/** A group's current translate (0 0 when it has none). */
export function translateOf(g: SVGGElement): { x: number; y: number } {
  const base = /translate\(([-\d.e]+)[ ,]([-\d.e]+)\)/.exec(g.getAttribute('transform') ?? '');
  return { x: base ? Number(base[1]) : 0, y: base ? Number(base[2]) : 0 };
}

const moveSeq = new WeakMap<SVGGElement, number>();
/** Glides a group's translate to (x1, y1) from where it is now. A newer move of the same group takes over mid-glide. */
export async function moveGroupTo(g: SVGGElement, x1: number, y1: number, ms: number, signal?: AbortSignal): Promise<void> {
  const seq = (moveSeq.get(g) ?? 0) + 1;
  moveSeq.set(g, seq);
  const { x: x0, y: y0 } = translateOf(g);
  const t0 = performance.now();
  for (;;) {
    if (moveSeq.get(g) !== seq) return; // superseded: the newer move goes on from here
    const t = signal?.aborted || prefersReducedMotion() ? 1 : Math.min(1, (performance.now() - t0) / ms);
    const e = 0.5 - 0.5 * Math.cos(Math.PI * t);
    g.setAttribute('transform', `translate(${x0 + (x1 - x0) * e} ${y0 + (y1 - y0) * e})`);
    if (t >= 1) return;
    await frame();
  }
}

/** fade: dims a group to `to` opacity over `ms`. */
export async function fadeGroup(g: SVGGElement, to: number, ms: number, signal?: AbortSignal): Promise<void> {
  g.style.transition = `opacity ${ms}ms ease-out`;
  await frame();
  g.style.opacity = String(to);
  if (!signal?.aborted) await wait(ms);
}
