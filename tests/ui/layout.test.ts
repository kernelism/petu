// tests/ui/layout.test.ts
import { describe, it, expect } from 'vitest';
import { dockPlacement, dockReserve, DOCK_MAX } from '../../src/ui/layout';
import { band, inView, frameTop, setSafeBottom, safeBottom, SAFE_BOTTOM, SAFE_TOP } from '../../src/desk/layout';
import type { DeskState } from '../../src/desk/types';

const c = (x: number, w: number): DeskState => ({ mode: 'c', following: true, sketching: x !== 290, column: { x, w } });

describe('dockPlacement', () => {
  it('centers in the window before the desk reports', () => {
    expect(dockPlacement(1440, null)).toEqual({ x: 720, w: DOCK_MAX });
  });
  it('centers under the page column (the window center without lanes)', () => {
    expect(dockPlacement(1440, c(290, 860))).toEqual({ x: 720, w: DOCK_MAX });
    expect(dockPlacement(1440, c(76, 790)).x).toBe(76 + 395);
  });
  it('centers under the canvas on the stage', () => {
    const s: DeskState = { ...c(76, 790), mode: 'b', canvas: { x: 76, y: 64, w: 1340, h: 680 }, card: 3 };
    expect(dockPlacement(1440, s).x).toBe(76 + 670);
  });
  it('keeps 16px from a narrow column edge', () => {
    expect(dockPlacement(600, c(32, 536)).w).toBe(536 - 32);
  });
});

describe('dockReserve', () => {
  it('reserves the dock at its tallest: ask bar, gap, a question line and two narration lines, plus clearance', () => {
    // 18 from the window bottom, a 52px ask bar, 6px gap, caption padding 20, question 18+4, two 21.75px lines, 12 clear.
    expect(dockReserve({ bottom: 18, askbar: 52, capPad: 20, capLine: 21.75 })).toBeCloseTo(173.5);
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
