// tests/pdf/contentMask.test.ts
import { describe, it, expect } from 'vitest';
import { maskFromPixels } from '../../src/pdf/contentMask';

/** An RGBA image w × h filled with `bg`, with `ink` rects painted in `fg`. */
function image(w: number, h: number, bg: number, fg: number, ink: { x: number; y: number; w: number; h: number }[]) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { d[4 * i] = d[4 * i + 1] = d[4 * i + 2] = bg; d[4 * i + 3] = 255; }
  for (const r of ink) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
    const i = 4 * (y * w + x); d[i] = d[i + 1] = d[i + 2] = fg;
  }
  return d;
}

describe('maskFromPixels', () => {
  it('marks the cells that hold anything printed, against the page background', () => {
    const d = image(40, 20, 255, 30, [{ x: 21, y: 5, w: 1, h: 1 }]);
    const m = maskFromPixels(d, 40, 20, 10, 5)!;
    expect(m.cols).toBe(10);
    expect(m.rows).toBe(5);
    expect([...m.cells].filter(Boolean).length).toBe(1);
    expect(m.cells[1 * 10 + 5]).toBe(1); // pixel (21, 5) → col 5, row 1
  });
  it('takes the background from the page itself (an off-white scan) and counts light fills as content', () => {
    const d = image(40, 20, 236, 226, [{ x: 0, y: 0, w: 8, h: 8 }]);
    const m = maskFromPixels(d, 40, 20, 10, 5)!;
    expect(m.cells[0]).toBe(1);
    expect(m.cells[9]).toBe(0);
  });
  it('a page with no clear background (a photo, a noisy scan) gives no mask', () => {
    const d = image(40, 20, 255, 0, []);
    for (let i = 0; i < 40 * 20; i++) d[4 * i] = d[4 * i + 1] = d[4 * i + 2] = (i * 37) % 256;
    expect(maskFromPixels(d, 40, 20, 10, 5)).toBeNull();
  });
});
