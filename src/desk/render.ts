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

let clipSeq = 0;
/** Reveals `g` left to right through a growing clip (writing), or fades it in (clean style, reduced motion, backlog). */
export async function reveal(g: SVGGElement, box: SRect, chars: number, o: { style: InkStyle; signal?: AbortSignal } & Pace): Promise<void> {
  if (o.style === 'clean' || o.fadeMs != null || prefersReducedMotion()) {
    const ms = o.fadeMs ?? FADE_MS;
    g.style.opacity = '0';
    g.style.transition = `opacity ${ms}ms ease-out`;
    await frame();
    g.style.opacity = '1';
    if (!o.signal?.aborted) await wait(ms);
    return;
  }
  const id = `dk${++clipSeq}`;
  const clip = document.createElementNS(SVG, 'clipPath');
  clip.setAttribute('id', id);
  const r = document.createElementNS(SVG, 'rect');
  set(r, { x: box.x - 6, y: box.y - 12, height: box.h + 24, width: 0 });
  clip.appendChild(r);
  g.insertBefore(clip, g.firstChild);
  g.setAttribute('clip-path', `url(#${id})`);
  const full = box.w + 12;
  const dur = Math.min(WRITE_MAX_MS, Math.max(220, (chars / CHARS_PER_SEC) * 1000)) * o.speed;
  const t0 = performance.now();
  for (;;) {
    const k = o.signal?.aborted ? 1 : Math.min(1, (performance.now() - t0) / dur);
    r.setAttribute('width', String(full * k));
    if (k >= 1) break;
    await frame();
  }
  g.removeAttribute('clip-path');
  clip.remove();
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
