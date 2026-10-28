import { describe, it, expect } from 'vitest';
import { imageSize, patches, inkCropRect, MAX_PATCHES } from '../../../src/agent/context/image';

describe('page image size', () => {
  it('renders a 16:9 slide at 1280×720', () => {
    expect(imageSize(9 / 16)).toEqual({ w: 1280, h: 720 });
  });
  it('fits a letter page under the patch budget at about 896×1160', () => {
    const s = imageSize(11 / 8.5);
    expect(patches(s.w, s.h)).toBeLessThanOrEqual(MAX_PATCHES);
    expect(Math.abs(s.w - 896)).toBeLessThanOrEqual(8);
    expect(Math.abs(s.h - 1160)).toBeLessThanOrEqual(8);
  });
  it('keeps every shape within the patch budget and a 1280 px long side', () => {
    for (const a of [0.2, 0.5625, 0.75, 1, 1.294, 1.414, 3, 8]) {
      const s = imageSize(a);
      expect(patches(s.w, s.h)).toBeLessThanOrEqual(MAX_PATCHES);
      expect(Math.max(s.w, s.h)).toBeLessThanOrEqual(1280);
      expect(Math.min(s.w, s.h)).toBeGreaterThanOrEqual(1);
      expect(s.h / s.w).toBeCloseTo(a, 1);
    }
  });
  it('counts 32 px patches', () => {
    expect(patches(1280, 720)).toBe(40 * 23);
  });
});

describe('inkCropRect', () => {
  it('pads the ink bbox by 25%, at least 300 units, clamped to the page', () => {
    const r = inkCropRect([{ points: [[400, 300, 0.5], [500, 350, 0.5]] }], 1)!;
    // bbox 100×50 → padded to 300×300 around its centre (450, 325).
    expect(r).toEqual({ x: 300, y: 175, w: 300, h: 300 });
    const big = inkCropRect([{ points: [[0, 0, 0.5], [900, 600, 0.5]] }], 1)!;
    expect(big.x).toBe(0);
    expect(big.w).toBeLessThanOrEqual(1000);
  });
  it('reads stroke y in page space (y · 1000/aspect)', () => {
    const r = inkCropRect([{ points: [[400, 281.25, 0.5], [500, 281.25, 0.5]] }], 0.5625)!;
    expect(r.y + r.h / 2).toBeCloseTo(500, 0);
  });
  it('is undefined without ink', () => {
    expect(inkCropRect([], 1)).toBeUndefined();
  });
});
