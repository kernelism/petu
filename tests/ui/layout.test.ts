// tests/ui/layout.test.ts
import { describe, it, expect } from 'vitest';
import { dockPlacement, dockReserve, DOCK_MAX } from '../../src/ui/layout';
import { band, inView, frameTop, setSafeBottom, safeBottom, SAFE_BOTTOM, SAFE_TOP } from '../../src/desk/layout';
import type { DeskState } from '../../src/desk/types';

const c = (x: number, w: number): DeskState => ({ split: x !== 290 ? 'normal' : 'none', stacked: false, following: true, sketching: x !== 290, column: { x, w } });

describe('dockPlacement', () => {
  it('centers in the window before the desk reports', () => {
    expect(dockPlacement(1440, null)).toEqual({ x: 720, w: DOCK_MAX });
  });
  it('centres under the page column while reading, under the slide column in a split', () => {
    expect(dockPlacement(1440, c(290, 860))).toEqual({ x: 720, w: DOCK_MAX });
    expect(dockPlacement(1440, c(36, 666)).x).toBe(36 + 333);
  });
  it('is never wider than its column', () => {
    expect(dockPlacement(1000, c(25, 462)).w).toBe(462);
  });
});

describe('dockReserve', () => {
  it('reserves the dock at its tallest: ask bar, the caption on it (no gap), a question line and two narration lines, plus clearance', () => {
    // 18 from the window bottom, a 52px ask bar, caption padding 20, question 18+4, two 21.75px lines, 12 clear.
    expect(dockReserve({ bottom: 18, askbar: 52, capPad: 20, capLine: 21.75 })).toBeCloseTo(167.5);
  });
  it('framing uses the measured reserve (never less than SAFE_BOTTOM)', () => {
    try {
      setSafeBottom(100);
      expect(safeBottom()).toBe(SAFE_BOTTOM);
      setSafeBottom(180);
      expect(band(800)).toBe(800 - SAFE_TOP - 180);
      const v = { top: 0, H: 800, max: 5000 };
      expect(inView({ x: 0, y: 800 - 170, w: 10, h: 10 }, v)).toBe(false); // under the caption
      const r = { x: 0, y: 1000, w: 10, h: 400 };
      const t = frameTop(r, v);
      expect(r.y + r.h - t).toBeLessThanOrEqual(800 - 180); // its bottom clears the caption
    } finally { setSafeBottom(0); }
  });
});
