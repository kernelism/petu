// src/pixels/gray.ts — a page image's pixels as a small grid of gray levels (teaching-engine proposal §6,
// Phase 3: "raster on the student's own slide image"). Pure, so the browser, the gate's shadow board and
// the node replay all turn the same image bytes into the same integers.
import type { PageRect } from '../geometry/space';

/** Decoded image bytes as pdf.js gives them: kind 1 = 1 bit gray, 2 = RGB, 3 = RGBA (pdfjs ImageKind). */
export type RawImage = { width: number; height: number; kind: number; data: ArrayLike<number> };

/** Columns a page image is read at, unless the board asks for another (`data-px`). */
export const RASTER_COLS = 24;
/** The most columns a page image may be read at: 40 x 40 is 1600 numbers, under a computed tag's 2000. */
export const MAX_RASTER_COLS = 40;

/** Gray level of pixel i times 1000 (Rec. 601 luma, as most image courses define gray), in integers so no rounding drifts. */
function luma(img: RawImage, i: number): number {
  const d = img.data;
  if (img.kind === 1) {
    const rowBytes = (img.width + 7) >> 3, y = Math.floor(i / img.width), x = i % img.width;
    return (d[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255000 : 0;
  }
  const n = img.kind === 3 ? 4 : 3;
  return 299 * d[i * n] + 587 * d[i * n + 1] + 114 * d[i * n + 2];
}

/**
 * The image as `cols` columns of gray (rows keep its shape): each cell is the mean of the pixels it
 * covers, rounded to a whole level. `flipX`/`flipY` mirror it when the page paints it mirrored.
 */
export function grayGrid(img: RawImage, cols: number, o: { flipX?: boolean; flipY?: boolean } = {}): number[][] {
  const W = img.width, H = img.height;
  const C = Math.max(1, Math.min(cols, W));
  const R = Math.max(1, Math.min(H, Math.round((C * H) / W)));
  const out: number[][] = [];
  for (let r = 0; r < R; r++) {
    const y0 = Math.floor((r * H) / R), y1 = Math.max(y0 + 1, Math.floor(((r + 1) * H) / R));
    const row: number[] = [];
    for (let c = 0; c < C; c++) {
      const x0 = Math.floor((c * W) / C), x1 = Math.max(x0 + 1, Math.floor(((c + 1) * W) / C));
      let s = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) s += luma(img, y * W + x);
      row.push(Math.round(s / (1000 * (y1 - y0) * (x1 - x0))));
    }
    out.push(o.flipX ? row.reverse() : row);
  }
  return o.flipY ? out.reverse() : out;
}

/** The painted image that covers most of `rect` (a figure mark may cluster a few tiles: the largest wins). */
export function imageUnder<T extends { rect: PageRect }>(images: T[], rect: PageRect): T | null {
  let best: T | null = null, most = 0;
  for (const im of images) {
    const w = Math.min(im.rect.x + im.rect.w, rect.x + rect.w) - Math.max(im.rect.x, rect.x);
    const h = Math.min(im.rect.y + im.rect.h, rect.y + rect.h) - Math.max(im.rect.y, rect.y);
    if (w > 0 && h > 0 && w * h > most) { most = w * h; best = im; }
  }
  return best;
}
