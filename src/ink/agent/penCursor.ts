import type { SPt } from '../../geometry/space';
import { prefersReducedMotion } from './animate';

/**
 * The pen cursor: a small nib that travels with the tutor's live stroke tip (page ink and board
 * ink alike), so the eye knows where the pen is. One fixed element on document.body, positioned in
 * client px from the stroke group's getScreenCTM(). The most recently started stroke owns it; when
 * the last stroke lifts, it waits IDLE_MS and fades (opacity only). Reduced motion, `?nopen`, or a
 * DOM without getScreenCTM (jsdom) → never shown.
 */
export const IDLE_MS = 400;
export const FADE_MS = 240;
const SIZE = 16;

/** Slim pen, nib point at (0, SIZE): bottom-left corner of the box. */
const GLYPH = `<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 16 16" aria-hidden="true">`
  + '<path d="M0.6 15.4 L2.2 10.6 L11.6 1.2 Q12.6 0.2 13.6 1.2 L14.8 2.4 Q15.8 3.4 14.8 4.4 L5.4 13.8 Z" '
  + 'fill="currentColor" fill-opacity="0.82" stroke="#fff" stroke-opacity="0.7" stroke-width="0.8" stroke-linejoin="round"/>'
  + '<path d="M2.2 10.6 L5.4 13.8" stroke="#fff" stroke-opacity="0.75" stroke-width="0.8"/></svg>';

export type PenToken = object;

let el: HTMLDivElement | null = null;
const active: PenToken[] = [];
let idle: ReturnType<typeof setTimeout> | null = null;

const disabled = (): boolean =>
  prefersReducedMotion() || (typeof location !== 'undefined' && /[?&]nopen\b/.test(location.search));

function element(): HTMLDivElement {
  if (el && el.isConnected) return el;
  el = document.createElement('div');
  el.className = 'pen-cursor';
  el.innerHTML = GLYPH;
  Object.assign(el.style, {
    position: 'fixed', left: '0', top: '0', width: `${SIZE}px`, height: `${SIZE}px`,
    pointerEvents: 'none', zIndex: '15', opacity: '0', transition: `opacity ${FADE_MS}ms ease-out`,
    willChange: 'transform', color: '#333',
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(el);
  return el;
}

/** A stroke starts: it becomes the one the pen follows. */
export function penDown(token: PenToken): void {
  const i = active.indexOf(token);
  if (i >= 0) active.splice(i, 1);
  active.push(token);
  if (idle) { clearTimeout(idle); idle = null; }
}

/**
 * Moves the nib to `pt` (in `svg`'s user space) if `token` is the most recent active stroke.
 * `color` tints the pen (the ink colour; the glyph is drawn at reduced opacity).
 */
export function penTo(token: PenToken, svg: SVGGraphicsElement, pt: SPt, color?: string): void {
  if (active[active.length - 1] !== token || disabled()) return;
  const m = typeof svg.getScreenCTM === 'function' ? svg.getScreenCTM() : null;
  if (!m) return;
  const x = m.a * pt.x + m.c * pt.y + m.e, y = m.b * pt.x + m.d * pt.y + m.f;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  const e = element();
  e.style.transform = `translate(${x.toFixed(1)}px, ${(y - SIZE).toFixed(1)}px)`;
  if (color) e.style.color = color;
  e.style.opacity = '1';
}

/** A stroke run ends. The pen hands back to an older active stroke, or fades after IDLE_MS. */
export function penLift(token: PenToken): void {
  const i = active.indexOf(token);
  if (i >= 0) active.splice(i, 1);
  if (active.length || idle) return;
  idle = setTimeout(() => {
    idle = null;
    if (!active.length && el) el.style.opacity = '0';
  }, IDLE_MS);
}

/** Tests only: forget all state and remove the element. */
export function resetPen(): void {
  active.length = 0;
  if (idle) clearTimeout(idle);
  idle = null;
  el?.remove();
  el = null;
}
