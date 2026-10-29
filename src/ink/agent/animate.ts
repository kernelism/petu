import type { SPt } from '../../geometry/space';
import type { Stroke } from './strokes';
import { penDown, penLift, penTo } from './penCursor';

export const PX_PER_SEC = 700;
/** No single stroke takes longer than this, however long it is. */
export const STROKE_CAP_MS = 700;
const BETWEEN_STROKES_MS = 60;
const FADE_MS = 280;
const SVG = 'http://www.w3.org/2000/svg';

export const ease = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, t)));

export function cumulative(s: Stroke): number[] {
  const c = [0];
  for (let i = 1; i < s.length; i++) c.push(c[i - 1] + Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y));
  return c;
}

export function partial(s: Stroke, cum: number[], dist: number): { points: SPt[]; tip: SPt } {
  if (dist >= cum[cum.length - 1]) return { points: s.slice(), tip: s[s.length - 1] };
  let i = 1;
  while (cum[i] < dist) i++;
  const f = (dist - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
  const tip = { x: s[i - 1].x + (s[i].x - s[i - 1].x) * f, y: s[i - 1].y + (s[i].y - s[i - 1].y) * f };
  return { points: [...s.slice(0, i), tip], tip };
}

/** lenPx = on-screen length in CSS px. Short flicks (arrow heads) are quick. `speed` < 1 compresses (backlog). */
export function strokeDurationMs(lenPx: number, minMs?: number, speed = 1): number {
  const ms = Math.round((lenPx / PX_PER_SEC) * 1000);
  return Math.round(Math.min(STROKE_CAP_MS, Math.max(minMs ?? (lenPx < 60 ? 140 : 250), ms)) * speed);
}

/** True when the user asked the OS for reduced motion: strokes fade in, scrolls jump. */
export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const toD = (pts: SPt[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');

export type InkOpts = {
  color: string;
  /** CSS px stroke width (non-scaling). */
  width: number;
  mode: 'trace' | 'fade';
  /** CSS px per page-space unit (rendered page width / 1000). */
  scale: number;
  signal?: AbortSignal;
  /** Floor for each stroke's duration (closed shapes look rushed when traced too fast). */
  minMs?: number;
  /** Duration multiplier (≤ 1 when the ink is behind the narration). Default 1. */
  speed?: number;
  /** Fade mode's duration. Default 280ms. */
  fadeMs?: number;
  /** SVG dash pattern in CSS px (non-scaling), e.g. '7 6'. */
  dash?: string;
  /** Stroke opacity. Default 1. */
  opacity?: number;
};

const frame = () => new Promise<number>((r) => requestAnimationFrame(r));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makePath(g: SVGGElement, o: InkOpts): SVGPathElement {
  const p = document.createElementNS(SVG, 'path');
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', o.color);
  p.setAttribute('stroke-width', String(o.width));
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  p.setAttribute('vector-effect', 'non-scaling-stroke');
  if (o.dash) p.setAttribute('stroke-dasharray', o.dash);
  if (o.opacity != null) p.setAttribute('stroke-opacity', String(o.opacity));
  g.appendChild(p);
  return p;
}

/** Draws strokes in order. 'trace' moves a pen tip along each stroke; 'fade' fades the whole shape in. */
export async function drawStrokes(g: SVGGElement, strokes: Stroke[], o: InkOpts): Promise<void> {
  if (o.mode === 'fade') {
    const paths = strokes.map((s) => { const p = makePath(g, o); p.setAttribute('d', toD(s)); return p; });
    const ms = o.fadeMs ?? FADE_MS;
    for (const p of paths) { p.style.opacity = '0'; p.style.transition = `opacity ${ms}ms ease-out`; }
    await frame();
    for (const p of paths) p.style.opacity = '1';
    if (!o.signal?.aborted) await wait(ms);
    return;
  }
  const tip = document.createElementNS(SVG, 'circle');
  tip.setAttribute('r', String((o.width * 1.15) / o.scale));
  tip.setAttribute('fill', o.color);
  if (o.opacity != null) tip.setAttribute('fill-opacity', String(o.opacity)); // a faint stroke's pen is faint too
  tip.style.transition = 'opacity 160ms ease-out';
  const pen = {};
  penDown(pen);
  try {
    for (let k = 0; k < strokes.length; k++) {
      const s = strokes[k];
      const cum = cumulative(s), L = cum[cum.length - 1];
      const dur = strokeDurationMs(L * o.scale, o.minMs, o.speed);
      const p = makePath(g, o);
      g.appendChild(tip);
      tip.style.opacity = '1';
      const t0 = performance.now();
      for (;;) {
        const t = o.signal?.aborted ? 1 : (performance.now() - t0) / dur;
        const { points, tip: at } = partial(s, cum, L * ease(t));
        p.setAttribute('d', toD(points));
        tip.setAttribute('cx', String(at.x));
        tip.setAttribute('cy', String(at.y));
        penTo(pen, g, at, o.color);
        if (t >= 1) break;
        await frame();
      }
      if (k < strokes.length - 1 && !o.signal?.aborted) await wait(BETWEEN_STROKES_MS * (o.speed ?? 1));
    }
  } finally { penLift(pen); }
  tip.style.opacity = '0';
  setTimeout(() => tip.remove(), 200);
}
