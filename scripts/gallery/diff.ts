// scripts/gallery/diff.ts — pixelwise comparison of two stills with antialiasing tolerance, and the
// per-shot verdicts the contact sheet and the gate share. Pure: no browser, no files.
import type { Image } from './png.ts';

export type DiffOptions = {
  /** A pixel differs when its largest RGB channel delta exceeds this (0–255). */
  threshold: number;
  /** A differing pixel is forgiven when a pixel within this radius in the other image matches it (both ways): 1px antialiasing / subpixel shifts. */
  aaRadius: number;
  /** A shot counts as changed when more than this share of its pixels differ... */
  maxRatio: number;
  /** ...and more than this many pixels (tiny areas never fail a shot). */
  minPixels: number;
};

export const DEFAULT_DIFF: DiffOptions = { threshold: 40, aaRadius: 1, maxRatio: 0.0005, minPixels: 100 };

export type DiffResult = {
  /** Pixels that differ after antialiasing tolerance. */
  pixels: number;
  ratio: number;
  /** Bounding box of the differing pixels, or null. */
  box: { x: number; y: number; w: number; h: number } | null;
  sizeMismatch: boolean;
  changed: boolean;
  /** The current image, faded, with differing pixels in red (null when sizes differ). */
  image: Image | null;
};

const close = (a: Uint8Array, i: number, b: Uint8Array, j: number, t: number) =>
  Math.abs(a[i] - b[j]) <= t && Math.abs(a[i + 1] - b[j + 1]) <= t && Math.abs(a[i + 2] - b[j + 2]) <= t;

/** True when some pixel of `other` within `r` of (x, y) matches `src` at (x, y). */
function nearMatch(src: Uint8Array, other: Uint8Array, w: number, h: number, x: number, y: number, r: number, t: number): boolean {
  const i = (y * w + x) * 4;
  for (let dy = -r; dy <= r; dy++) {
    const yy = y + dy;
    if (yy < 0 || yy >= h) continue;
    for (let dx = -r; dx <= r; dx++) {
      const xx = x + dx;
      if (xx < 0 || xx >= w || (!dx && !dy)) continue;
      if (close(src, i, other, (yy * w + xx) * 4, t)) return true;
    }
  }
  return false;
}

export function diffImages(base: Image, cur: Image, opts: Partial<DiffOptions> = {}): DiffResult {
  const o = { ...DEFAULT_DIFF, ...opts };
  if (base.width !== cur.width || base.height !== cur.height) {
    return { pixels: cur.width * cur.height, ratio: 1, box: { x: 0, y: 0, w: cur.width, h: cur.height }, sizeMismatch: true, changed: true, image: null };
  }
  const { width: w, height: h } = cur;
  const a = base.data, b = cur.data;
  const out = new Uint8Array(w * h * 4);
  let n = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let diff = !close(a, i, b, i, o.threshold);
      if (diff && o.aaRadius > 0 && nearMatch(b, a, w, h, x, y, o.aaRadius, o.threshold) && nearMatch(a, b, w, h, x, y, o.aaRadius, o.threshold)) diff = false;
      if (diff) {
        n++;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        out[i] = 230; out[i + 1] = 30; out[i + 2] = 40; out[i + 3] = 255;
      } else {
        const g = 255 - ((255 - (b[i] * 0.3 + b[i + 1] * 0.59 + b[i + 2] * 0.11)) * 0.25);
        out[i] = out[i + 1] = out[i + 2] = g; out[i + 3] = 255;
      }
    }
  }
  const ratio = n / (w * h);
  return {
    pixels: n, ratio, sizeMismatch: false,
    box: n ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null,
    changed: n > o.minPixels && ratio > o.maxRatio,
    image: { width: w, height: h, data: out },
  };
}

/** One shot's name: `<scene>@<moment>.<browser>.<W>x<H>`. */
export type ShotKey = { scene: string; moment: string; browser: string; size: string };
export const shotName = (k: ShotKey) => `${k.scene}@${k.moment}.${k.browser}.${k.size}`;

export type ShotStatus = 'same' | 'changed' | 'new' | 'missing' | 'error';
export type ShotRow = { name: string; status: ShotStatus; pixels?: number; ratio?: number; box?: DiffResult['box']; error?: string; expected?: boolean };

/**
 * Whether `--expect` patterns cover a shot. A pattern matches a whole name, or a prefix ending at a
 * separator: `side` covers every `side@…` shot, `side@end` that moment in every browser and size,
 * `side@end.webkit` one browser; `*` is a wildcard (`*.webkit.*`).
 */
export function expectedBy(name: string, patterns: string[]): boolean {
  return patterns.some((p) => {
    if (p.includes('*')) {
      const re = new RegExp(`^${p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}(?:[@.].*)?$`);
      return re.test(name);
    }
    return name === p || (name.startsWith(p) && /[@.]/.test(name[p.length]));
  });
}

/** Rows that fail the gate: changed, missing or errored shots no `--expect` covers. New shots never fail. */
export const unexpectedChanges = (rows: ShotRow[], expect: string[]): ShotRow[] =>
  rows.filter((r) => (r.status === 'changed' || r.status === 'missing' || r.status === 'error') && !expectedBy(r.name, expect));
