// src/desk/pageInk.ts
/**
 * What the slide itself has painted (its text, rules, axes, printed curves and labels), as an obstacle
 * for labels and brackets drawn on the page: a label never sits on the slide's own strokes or text.
 * Read from the page's rendered canvas (the content mask the connector router uses); null where there
 * is none (jsdom, a page not rendered yet), and then placement goes on without it.
 */
import { canvasMask } from '../pdf/contentMask';
import type { ContentMask } from './route';
import type { SRect } from '../geometry/space';

/** A page's content mask with the size of its target space (1000 × h). */
export type PageInk = ContentMask & { W: number; H: number };

const cache = new WeakMap<HTMLCanvasElement, { w: number; h: number; m: ContentMask | null }>();

/** The painted content of the page `layer` (an ink layer of a page slot) belongs to, or null. */
export function pageInkOf(layer: Element | null | undefined): PageInk | null {
  const page = layer?.closest?.('.pv-page');
  const canvas = page?.querySelector('canvas');
  const vb = (layer as SVGGraphicsElement | null)?.ownerSVGElement?.viewBox?.baseVal;
  if (!canvas || !vb || !vb.width || !vb.height || !canvas.width) return null;
  let c = cache.get(canvas);
  if (!c || c.w !== canvas.width || c.h !== canvas.height) {
    c = { w: canvas.width, h: canvas.height, m: canvasMask(canvas) };
    cache.set(canvas, c);
  }
  return c.m ? { ...c.m, W: vb.width, H: vb.height } : null;
}

/** The mask cells `r` (target space) covers, clamped to the page. */
function cellsOf(ink: PageInk, r: SRect) {
  const cw = ink.W / ink.cols, chh = ink.H / ink.rows;
  return {
    c0: Math.max(0, Math.floor(r.x / cw)), c1: Math.min(ink.cols - 1, Math.floor((r.x + r.w) / cw)),
    r0: Math.max(0, Math.floor(r.y / chh)), r1: Math.min(ink.rows - 1, Math.floor((r.y + r.h) / chh)),
    cw, chh,
  };
}

/** The share (0–1) of `r` that the slide has painted. */
export function inkIn(ink: PageInk | null, r: SRect): number {
  if (!ink) return 0;
  const { c0, c1, r0, r1 } = cellsOf(ink, r);
  if (c1 < c0 || r1 < r0) return 0;
  let n = 0;
  for (let y = r0; y <= r1; y++) for (let x = c0; x <= c1; x++) n += ink.cells[y * ink.cols + x];
  return n / ((c1 - c0 + 1) * (r1 - r0 + 1));
}

/** The slide's painted content inside `area` as boxes (runs of cells along a row merged), for placers that take boxes. */
export function inkBoxes(ink: PageInk | null, area: SRect): SRect[] {
  if (!ink) return [];
  const { c0, c1, r0, r1, cw, chh } = cellsOf(ink, area);
  const out: SRect[] = [];
  for (let y = r0; y <= r1; y++) {
    let start = -1;
    for (let x = c0; x <= c1 + 1; x++) {
      const on = x <= c1 && ink.cells[y * ink.cols + x] === 1;
      if (on && start < 0) start = x;
      if (!on && start >= 0) { out.push({ x: start * cw, y: y * chh, w: (x - start) * cw, h: chh }); start = -1; }
    }
  }
  return out;
}
