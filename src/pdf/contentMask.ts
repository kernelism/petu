// src/pdf/contentMask.ts
import type { ContentMask } from '../desk/route';

/** Luminance buckets for finding the page background. */
const BUCKETS = 64;
/** A pixel this far from the background (0–255 luminance) is content: text, rules, light figure fills. */
const INK_DELTA = 8;
/** The background must cover at least this share of the page, else the page has none (a photo). */
const MIN_BG = 0.4;

/**
 * A coarse content grid from RGBA pixels (`w × h`, any resolution): a cell is set when any of its
 * pixels differs from the page background. The background is the page's most common luminance,
 * so off-white scans work. Null when there is no clear background.
 */
export function maskFromPixels(d: Uint8ClampedArray, w: number, h: number, cols: number, rows: number): ContentMask | null {
  const n = w * h;
  if (!n) return null;
  const lum = new Uint8Array(n);
  const hist = new Uint32Array(BUCKETS);
  for (let i = 0; i < n; i++) {
    const v = (d[4 * i] * 54 + d[4 * i + 1] * 183 + d[4 * i + 2] * 19) >> 8;
    lum[i] = v;
    hist[(v * BUCKETS) >> 8]++;
  }
  let best = 0;
  for (let b = 1; b < BUCKETS; b++) if (hist[b] > hist[best]) best = b;
  if (hist[best] < n * MIN_BG) return null;
  // The background level: the mean of its bucket.
  let sum = 0, cnt = 0;
  for (let i = 0; i < n; i++) if (((lum[i] * BUCKETS) >> 8) === best) { sum += lum[i]; cnt++; }
  const bg = sum / cnt;
  const cells = new Uint8Array(cols * rows);
  for (let y = 0; y < h; y++) {
    const row = Math.min(rows - 1, Math.floor((y * rows) / h)) * cols;
    for (let x = 0; x < w; x++) {
      if (Math.abs(lum[y * w + x] - bg) > INK_DELTA) cells[row + Math.min(cols - 1, Math.floor((x * cols) / w))] = 1;
    }
  }
  return { cols, rows, cells };
}

/** Grid columns across a page (about 5 px per cell on an 800 px page). */
const COLS = 160;
/** Pixels sampled per cell edge: thin rules survive the downsample. */
const SUB = 3;

/** The content mask of a rendered page canvas (null where canvas readback isn't available). */
export function canvasMask(canvas: HTMLCanvasElement): ContentMask | null {
  if (!canvas.width || !canvas.height) return null;
  const cols = COLS, rows = Math.max(1, Math.round((COLS * canvas.height) / canvas.width));
  const w = cols * SUB, h = rows * SUB;
  try {
    const small = document.createElement('canvas');
    small.width = w;
    small.height = h;
    const ctx = small.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'medium';
    ctx.drawImage(canvas, 0, 0, w, h);
    const m = maskFromPixels(ctx.getImageData(0, 0, w, h).data, w, h, cols, rows);
    small.width = small.height = 0;
    return m;
  } catch {
    return null;
  }
}
