// src/pdf/column.ts
import type { Column } from '../desk/types';

/**
 * The page column the viewer actually lays out, from the window frame's column (src/desk/layout.ts):
 * fitted to the visible band (a slide is read whole) and scaled by the student's page zoom. All pure.
 */

/**
 * A landscape page (a slide) a little taller than the band shrinks until it fits whole, down to this
 * share of its column; a page that would need more (or a portrait page, a paper) keeps its width and
 * scrolls, since reading width matters more there than seeing the sheet whole.
 */
export const MIN_FIT_SHARE = 0.6;

/** The column with its page fitted to a band `band` px tall (centred in the column it came from). */
export function fitColumn(col: Column, aspect: number, band: number): Column {
  if (!(aspect > 0) || aspect >= 1 || !(band > 0)) return col;
  const w = Math.floor(band / aspect);
  if (w >= col.pageW || w < col.pageW * MIN_FIT_SHARE) return col;
  return { pageW: w, pageX: col.pageX + (col.pageW - w) / 2 };
}

/** Page zoom steps (1 = the fitted column). Pinch zooms continuously between the ends. */
export const PAGE_ZOOM_STEPS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3] as const;
export const PAGE_ZOOM_MIN = PAGE_ZOOM_STEPS[0];
export const PAGE_ZOOM_MAX = PAGE_ZOOM_STEPS[PAGE_ZOOM_STEPS.length - 1];

export const clampPageZoom = (z: number) => (Number.isFinite(z) ? Math.min(PAGE_ZOOM_MAX, Math.max(PAGE_ZOOM_MIN, z)) : 1);

/** The next step past `z` in direction `dir` (an off-step zoom, after a pinch, goes to its neighbour). */
export function pageZoomStep(z: number, dir: -1 | 1): number {
  const e = 1e-3;
  if (dir > 0) return PAGE_ZOOM_STEPS.find((v) => v > z + e) ?? PAGE_ZOOM_MAX;
  return [...PAGE_ZOOM_STEPS].reverse().find((v) => v < z - e) ?? PAGE_ZOOM_MIN;
}

/** The horizontal room a zoomed page may use, viewport px. */
export type Span = { a: number; b: number };

/**
 * The column at zoom `z`. Centred on the fitted column; kept inside `span` while it fits there; wider
 * than the span, it is panned: `pan` px of it lie left of `span.a` (clamped to [0, maxPan]).
 */
export function zoomColumn(col: Column, span: Span, z: number, pan = 0): { col: Column; pan: number; maxPan: number } {
  const pageW = col.pageW * z;
  const room = span.b - span.a;
  if (pageW <= room + 0.5) {
    const x = col.pageX + (col.pageW - pageW) / 2;
    return { col: { pageW, pageX: Math.min(Math.max(x, span.a), span.b - pageW) }, pan: 0, maxPan: 0 };
  }
  const maxPan = pageW - room;
  const p = Math.min(maxPan, Math.max(0, pan));
  return { col: { pageW, pageX: span.a - p }, pan: p, maxPan };
}

/** The pan that puts fraction `fx` of a page `pageW` wide under viewport x `px` (a zoom about the pointer). */
export const panFor = (span: Span, pageW: number, fx: number, px: number) => span.a - (px - fx * pageW);

/** app.css fades the viewer out over this many px just outside its visible band (`--fade`). */
export const MASK_FADE = 12;

/**
 * Reading: how far below the band's top a page that fits is framed. Centred in the room, but never
 * so low that the page above (`gap` px higher) shows its bottom edge in the band's top fade: a
 * sliver of white under the chrome reads as a glitch. The rest of the room goes below the page.
 */
export const readingOffset = (room: number, h: number, gap: number) => Math.max(0, Math.min((room - h) / 2, gap - MASK_FADE));
