// src/desk/render.ts
import type { SPt, SRect } from '../geometry/space';
import type { InkStyle } from '../ink/agent/marks';
import { drawStrokes, prefersReducedMotion } from '../ink/agent/animate';
import { lineStroke } from '../ink/agent/strokes';
import { estimateTextBox } from './nudge';
import { token } from '../ink/agent/tokens';
import type { ElementEntry } from './registry';
import type { Pace } from './types';

const SVG = 'http://www.w3.org/2000/svg';
/** Neutral ink for the setup in regions (rule 6); `em` uses the accent ink color. Mirrors --ink. */
export const DESK_INK = '#1D1D1F';
const SYSTEM = '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';
const HAND = '"Bradley Hand", "Segoe Print", cursive';
/**
 * Text is sized for the screen at the moment it is written (CSS px), then lives in target units,
 * so a region that later moves between C and B scales as one picture.
 */
export const TEXT_PX = { label: 15, s: 14, m: 17, l: 22 } as const;
export const MATH_PX = { s: 17, m: 22, l: 28 } as const;
/** Math symbols set inside text are this much larger than the text: KaTeX_Math reads small beside a sans. */
export const SYMBOL_SCALE = 1.22;
/** Letters reveal at this pace; one text never takes longer than WRITE_MAX_MS. */
export const CHARS_PER_SEC = 34;
export const WRITE_MAX_MS = 900;
const FADE_MS = 260;

const frame = () => new Promise<number>((r) => requestAnimationFrame(r));
const wait = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const set = (el: Element, attrs: Record<string, string | number>) => Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));

export const own = (parent: SVGGElement): SVGGElement => parent.appendChild(document.createElementNS(SVG, 'g')) as SVGGElement;

/**
 * size: target units. weight: the words' font weight (default --ink-label-weight). symColor: the
 * color of math symbols in the text (default `color`).
 */
export type TextOpts = { size: number; style: InkStyle; color: string; run?: boolean; weight?: number; symColor?: string };

/** One piece of a text: plain words, or a math symbol (base letter + primes, optional subscript). */
export type TextSeg = { text: string; math?: false } | { text: string; math: true; sub?: string };

/** One letter (Latin or Greek), up to two primes, an optional subscript (`_1`, `_L`, `₁`). */
const SYMBOL = /^([A-Za-z\u0391-\u03A9\u03B1-\u03C9])(['′″]{0,2})(?:_([A-Za-z0-9]{1,3})|([₀-₉]{1,2}))?$/u;
/** In running text these single letters are English words, not symbols. */
const WORDS = new Set(['a', 'A', 'I']);

/**
 * Splits text into plain runs and math symbols (x, x′, C, O′, l′, θ, x_L). A whole text that is
 * one symbol is always math; in running text, "a", "A" and "I" stay words. Trailing punctuation
 * stays plain. ASCII primes become ′.
 */
export function textSegments(text: string): TextSeg[] {
  const parts = text.split(/(\s+)/);
  const alone = parts.filter((p) => p.trim()).length === 1;
  const out: TextSeg[] = [];
  const plain = (t: string) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last && !last.math) last.text += t; else out.push({ text: t });
  };
  for (const p of parts) {
    const m = /^(\(?)(.*?)([,.;:!?)]*)$/u.exec(p)!;
    const sym = SYMBOL.exec(m[2]);
    if (!p.trim() || !sym || (!alone && WORDS.has(m[2]))) { plain(p); continue; }
    plain(m[1]);
    const primes = sym[2].replace(/''/g, '″').replace(/'/g, '′');
    const sub = sym[3] ?? (sym[4] ? sym[4].replace(/[₀-₉]/g, (c) => String(c.charCodeAt(0) - 0x2080)) : undefined);
    out.push({ text: sym[1] + primes, math: true, ...(sub ? { sub } : {}) });
    plain(m[3]);
  }
  return out;
}

/**
 * A text element with its left edge at at.x and its vertical middle at at.y (target units).
 * Math symbols in it are set in KaTeX's math italic (one tspan each, plus one per subscript);
 * plain text stays a single text node. The hand style is all handwriting.
 */
export function makeText(g: SVGGElement, at: SPt, text: string, o: TextOpts): SVGTextElement {
  const t = document.createElementNS(SVG, 'text');
  const hand = o.style === 'hand';
  const segs = hand ? [{ text } as TextSeg] : textSegments(text);
  const mixed = segs.some((x) => x.math);
  set(t, {
    x: at.x, 'font-size': o.size * (hand ? 1.12 : 1), 'font-family': hand ? HAND : SYSTEM,
    'font-weight': hand ? 600 : (o.weight ?? (Number(token('--ink-label-weight')) || 450)), fill: o.color,
  });
  // Mixed fonts align on one alphabetic baseline (a per-font "middle" would step between faces);
  // 0.34 em below the middle puts the box's center on at.y.
  if (mixed) t.setAttribute('y', String(at.y + o.size * 0.34));
  else set(t, { y: at.y, 'dominant-baseline': 'middle' });
  // A halo in the surface color (the sheet color in regions; `run` marks region text) keeps a label legible where a stroke passes under it (SVG-native, WebKit-safe).
  set(t, { 'paint-order': 'stroke', stroke: token('--ink-halo') || (o.run ? token('--shade-sheet') : token('--surface')) || '#fff', 'stroke-width': o.size * 0.22, 'stroke-linejoin': 'round' });
  if (o.run) t.setAttribute('data-run', '');
  if (!mixed) { t.textContent = text; g.appendChild(t); return t; }
  const font = token('--font-math');
  const span = (txt: string, attrs: Record<string, string | number>) => {
    const s = document.createElementNS(SVG, 'tspan');
    set(s, attrs);
    s.textContent = txt;
    t.appendChild(s);
  };
  let shift = 0; // a subscript's dy, undone by the next span
  let after = false; // italic overhang: words after a symbol start a hair later
  for (const sg of segs) {
    const back: Record<string, number> = { ...(shift ? { dy: -shift } : {}), ...(after ? { dx: o.size * 0.08 } : {}) };
    shift = 0;
    after = !!sg.math;
    if (!sg.math) { span(sg.text, back); continue; }
    const sym = { 'font-family': font, 'font-style': 'italic', 'font-weight': 400, fill: o.symColor ?? o.color };
    span(sg.text, { ...sym, 'font-size': o.size * SYMBOL_SCALE, ...back });
    if (sg.sub) {
      shift = o.size * 0.28;
      const digits = /^[0-9]+$/.test(sg.sub);
      span(sg.sub, { ...sym, ...(digits ? { 'font-style': 'normal', 'font-family': 'KaTeX_Main, ' + font } : {}), 'font-size': o.size * SYMBOL_SCALE * 0.72, dy: shift });
    }
  }
  g.appendChild(t);
  return t;
}

/** The font size a text's height is measured at (target units): large enough that rounding is noise. */
const REF_SIZE = 100;
/** Text height per unit of font size, per font setup (see measureText). */
const heightPerSize = new Map<string, number>();
/**
 * What a text's box height depends on: its faces, weight and subscripts (the font's ascent and
 * descent, never the glyphs: "Hxg" and "ace" measure the same).
 */
export const heightKey = (text: string, o: TextOpts): string =>
  o.style === 'hand' ? 'hand' : `${o.weight ?? ''}|${textSegments(text).map((s) => (s.math ? (s.sub ? 'ms' : 'm') : 't')).join('')}`;

function bbox(layer: SVGGElement, text: string, o: TextOpts): { width: number; height: number } | null {
  const probe = own(layer);
  probe.setAttribute('visibility', 'hidden');
  const t = makeText(probe, { x: 0, y: 0 }, text, o);
  let b: { width: number; height: number } | null = null;
  try { b = typeof t.getBBox === 'function' ? t.getBBox() : null; } catch { b = null; }
  probe.remove();
  return b && b.width > 0 ? b : null;
}

/**
 * A text's box in target units before it is shown: getBBox in a browser, an estimate in jsdom.
 * The height is the box at REF_SIZE scaled to the size: engines round a font's ascent and descent at
 * the rendered pixel size, so a small label's measured height drifts (Gecko by up to +11% at board
 * sizes, Blink by ±3%), and notes and wraps that hinge on it would land differently per browser.
 */
export function measureText(layer: SVGGElement, text: string, o: TextOpts): { w: number; h: number } {
  const b = bbox(layer, text, o);
  if (!b) return estimateTextBox(text, o.size);
  const key = heightKey(text, o);
  let per = heightPerSize.get(key);
  if (per == null) {
    const ref = bbox(layer, text, { ...o, size: REF_SIZE });
    if (!ref) return { w: b.width, h: b.height };
    per = ref.height / REF_SIZE;
    // Cached only once the page's fonts have loaded (a fallback face measures differently).
    if (typeof document === 'undefined' || !document.fonts || document.fonts.status === 'loaded') heightPerSize.set(key, per);
  }
  return { w: b.width, h: per * o.size };
}

/** Each glyph (or word) fades in over this, one after another: never half a glyph on screen. */
export const UNIT_FADE_MS = 110;
/** Text longer than this is written word by word. */
export const WORDS_FROM = 40;

/**
 * The units a text is written in: whole characters (code points), or whole words for long text.
 * Spaces ride with the unit before them, so no unit is blank and nothing collapses between tspans.
 */
export function textUnits(text: string, words = Array.from(text).length > WORDS_FROM): string[] {
  const chars = Array.from(text);
  const out: string[] = [];
  if (words) {
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

/**
 * Splits every svg text in `g` into one tspan per unit; returns the units and how to undo the split.
 * A text set in pieces (math symbols, subscripts) splits each piece in place, keeping its font.
 */
function splitTexts(g: SVGGElement): { units: Unit[]; undo(): void } {
  const units: Unit[] = [];
  const undo: (() => void)[] = [];
  for (const t of g.querySelectorAll('text')) {
    if (t.closest('.desk-math')) continue; // typeset math reveals by its own pieces
    const whole = t.textContent ?? '';
    const holders: Element[] = t.children.length ? [...t.children] : [t];
    const words = Array.from(whole).length > WORDS_FROM;
    for (const h of holders) {
      const text = h.textContent ?? '';
      h.textContent = '';
      for (const u of textUnits(text, words)) {
        const span = document.createElementNS(SVG, 'tspan');
        span.textContent = u;
        h.appendChild(span);
        units.push({ el: span, prop: 'fillOpacity' }); // opacity doesn't apply to tspans
      }
      undo.push(() => { h.textContent = text; });
    }
  }
  return { units, undo: () => undo.forEach((f) => f()) };
}

/** Typeset math's pieces (text runs, rules, KaTeX svg), already in writing order (left to right). */
function mathUnits(g: SVGGElement): Unit[] {
  return [...g.querySelectorAll('.desk-math > *')].map((el) => ({ el: el as SVGElement, prop: 'opacity' as const }));
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
  const setOp = (u: Unit, v: number) => {
    const st = u.el.style as unknown as Record<string, string>;
    st[u.prop] = v >= 1 ? '' : String(v);
    if (u.prop === 'fillOpacity') st.strokeOpacity = v >= 1 ? '' : String(v); // the halo fades with its glyph
  };
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
/** A shade's fill, and its 1px hairline (non-scaling) when `stroke` is set. */
export type ShadeLook = { fill: string; fillOpacity: number; stroke?: string; strokeOpacity?: number };
/** A fill that fades in under the ink. */
export async function drawShade(g: SVGGElement, s: ShadeShape, look: ShadeLook, k: Pace, signal?: AbortSignal): Promise<void> {
  const el = 'pts' in s ? document.createElementNS(SVG, 'polygon') : document.createElementNS(SVG, 'ellipse');
  if ('pts' in s) el.setAttribute('points', s.pts.map((p) => `${p.x},${p.y}`).join(' '));
  else set(el, { cx: s.c.x, cy: s.c.y, rx: s.rx, ry: s.ry });
  set(el, { fill: look.fill, 'fill-opacity': look.fillOpacity });
  if (look.stroke) {
    set(el, { stroke: look.stroke, 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke', 'stroke-linejoin': 'round' });
    if (look.strokeOpacity != null) el.setAttribute('stroke-opacity', String(look.strokeOpacity));
  }
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
  await drawStrokes(g, strokes, { color, width: 5, opacity: 0.4, scale, signal, mode: prefersReducedMotion() ? 'fade' : 'trace', speed: 0.6 });
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
