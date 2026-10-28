import { describe, expect, it } from 'vitest';
import { diffImages, expectedBy, unexpectedChanges, type ShotRow } from '../../scripts/gallery/diff';
import { decodePng, encodePng, type Image } from '../../scripts/gallery/png';

const blank = (w: number, h: number, v = 255): Image => ({ width: w, height: h, data: new Uint8Array(w * h * 4).fill(v) });
const paint = (img: Image, x0: number, y0: number, w: number, h: number, rgb = [0, 0, 0]) => {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const i = (y * img.width + x) * 4; img.data[i] = rgb[0]; img.data[i + 1] = rgb[1]; img.data[i + 2] = rgb[2]; img.data[i + 3] = 255;
  }
  return img;
};

describe('png', () => {
  it('round-trips RGBA', () => {
    const img = paint(blank(7, 5), 2, 1, 3, 2, [10, 200, 30]);
    const back = decodePng(encodePng(img));
    expect(back.width).toBe(7);
    expect(Array.from(back.data)).toEqual(Array.from(img.data));
  });
});

describe('diffImages', () => {
  it('identical images: no pixels, not changed', () => {
    const d = diffImages(blank(50, 50), blank(50, 50));
    expect(d.pixels).toBe(0);
    expect(d.changed).toBe(false);
    expect(d.box).toBeNull();
  });

  it('small channel noise under the threshold is ignored', () => {
    const b = blank(50, 50); for (let i = 0; i < b.data.length; i += 4) b.data[i] = 230;
    expect(diffImages(blank(50, 50), b).pixels).toBe(0);
  });

  it('forgives a 1px antialiasing shift of an edge', () => {
    const a = paint(blank(100, 100), 20, 20, 40, 40);
    const b = paint(blank(100, 100), 21, 20, 40, 40);
    const d = diffImages(a, b);
    expect(d.pixels).toBe(0);
    expect(diffImages(a, b, { aaRadius: 0 }).pixels).toBe(80);
  });

  it('a new block beyond tolerance is changed, with its box and a diff image', () => {
    const d = diffImages(blank(200, 200), paint(blank(200, 200), 10, 30, 20, 20));
    expect(d.pixels).toBe(400);
    expect(d.box).toEqual({ x: 10, y: 30, w: 20, h: 20 });
    expect(d.changed).toBe(true);
    expect(d.image?.data[(30 * 200 + 10) * 4]).toBe(230);
  });

  it('a tiny change stays under minPixels / maxRatio', () => {
    const d = diffImages(blank(200, 200), paint(blank(200, 200), 10, 10, 5, 5));
    expect(d.pixels).toBe(25);
    expect(d.changed).toBe(false);
    expect(diffImages(blank(200, 200), paint(blank(200, 200), 10, 10, 5, 5), { minPixels: 10, maxRatio: 0 }).changed).toBe(true);
  });

  it('a size mismatch is a full change', () => {
    const d = diffImages(blank(10, 10), blank(12, 10));
    expect(d.sizeMismatch).toBe(true);
    expect(d.changed).toBe(true);
  });
});

describe('expect patterns', () => {
  const n = 'side@14s.webkit.1440x900';
  it('matches scene, moment, browser prefixes at separators', () => {
    expect(expectedBy(n, ['side'])).toBe(true);
    expect(expectedBy(n, ['side@14s'])).toBe(true);
    expect(expectedBy(n, ['side@14s.webkit'])).toBe(true);
    expect(expectedBy(n, [n])).toBe(true);
    expect(expectedBy(n, ['sid'])).toBe(false);
    expect(expectedBy(n, ['side@1'])).toBe(false);
    expect(expectedBy(n, ['plane'])).toBe(false);
  });
  it('supports * wildcards', () => {
    expect(expectedBy(n, ['*.webkit.*'])).toBe(true);
    expect(expectedBy(n, ['*@end'])).toBe(false);
    expect(expectedBy('kit@end.chromium.2560x1440', ['*@end'])).toBe(true);
  });
  it('unexpectedChanges keeps only undeclared changed/missing/error rows', () => {
    const rows: ShotRow[] = [
      { name: 'side@6s.chromium.1440x900', status: 'changed' },
      { name: 'kit@end.webkit.1440x900', status: 'changed' },
      { name: 'plane@end.webkit.1440x900', status: 'missing' },
      { name: 'demo1@4s.webkit.1440x900', status: 'same' },
      { name: 'lec09@end.webkit.1440x900', status: 'new' },
    ];
    expect(unexpectedChanges(rows, ['kit']).map((r) => r.name)).toEqual(['side@6s.chromium.1440x900', 'plane@end.webkit.1440x900']);
    expect(unexpectedChanges(rows, ['side', 'kit', 'plane'])).toEqual([]);
  });
});
