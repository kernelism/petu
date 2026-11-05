// A page image's pixels as gray levels (src/pixels/gray.ts): the same bytes give the same integers everywhere.
import { describe, expect, it } from 'vitest';
import { grayGrid, imageUnder } from '../../src/pixels/gray';

/** A w x h RGB image whose pixel (x, y) is gray level f(x, y). */
const rgb = (w: number, h: number, f: (x: number, y: number) => number) => {
  const data = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.fill(f(x, y), (y * w + x) * 3, (y * w + x) * 3 + 3);
  return { width: w, height: h, kind: 2, data };
};

describe('grayGrid', () => {
  it('averages each block and rounds to a whole level', () => {
    // 4x4, read at 2 columns: each cell is a 2x2 block's mean.
    const img = rgb(4, 4, (x, y) => (x < 2 ? 10 : 20) + (y < 2 ? 0 : 1));
    expect(grayGrid(img, 2)).toEqual([[10, 20], [11, 21]]);
    expect(grayGrid(rgb(2, 1, (x) => (x ? 1 : 0)), 1)).toEqual([[1]]); // 0.5 rounds up
  });

  it('keeps the shape: rows follow the aspect, and never more cells than pixels', () => {
    const g = grayGrid(rgb(200, 100, () => 0), 24);
    expect([g.length, g[0].length]).toEqual([12, 24]);
    const small = grayGrid(rgb(5, 5, () => 0), 24);
    expect([small.length, small[0].length]).toEqual([5, 5]);
  });

  it('weights colour as luma, reads RGBA and 1-bit images', () => {
    expect(grayGrid({ width: 1, height: 1, kind: 2, data: [255, 0, 0] }, 1)).toEqual([[76]]);
    expect(grayGrid({ width: 1, height: 1, kind: 3, data: [0, 255, 0, 255] }, 1)).toEqual([[150]]);
    // 1 bit, 10 wide: rows are padded to whole bytes (10 bits → 2 bytes); bit set = white.
    const bits = { width: 10, height: 1, kind: 1, data: [0b10000000, 0b01000000] };
    expect(grayGrid(bits, 10)[0]).toEqual([255, 0, 0, 0, 0, 0, 0, 0, 0, 255]);
  });

  it('mirrors when the page paints the image mirrored', () => {
    const img = rgb(2, 2, (x, y) => x + 10 * y);
    expect(grayGrid(img, 2)).toEqual([[0, 1], [10, 11]]);
    expect(grayGrid(img, 2, { flipY: true })).toEqual([[10, 11], [0, 1]]);
    expect(grayGrid(img, 2, { flipX: true })).toEqual([[1, 0], [11, 10]]);
  });
});

describe('imageUnder', () => {
  it('picks the painted image that covers most of the mark', () => {
    const a = { rect: { x: 0, y: 0, w: 100, h: 100 }, name: 'a' }, b = { rect: { x: 90, y: 0, w: 100, h: 100 }, name: 'b' };
    expect(imageUnder([a, b], { x: 95, y: 10, w: 80, h: 50 })?.name).toBe('b');
    expect(imageUnder([a, b], { x: 500, y: 500, w: 10, h: 10 })).toBeNull();
  });
});
