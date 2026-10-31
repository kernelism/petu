// tests/ui/layout.test.ts
import { describe, it, expect } from 'vitest';
import { dockColumn, dockPlacement, dockReserve, DOCK_MAX, newQuestionReserve } from '../../src/ui/layout';
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
  // QA M4 (1440×900, lec06): the dock followed the pen into the lane mid-answer and covered its drawing.
  it('in the lane it stays under the page column wherever the pen is, clear of the lane', () => {
    const page = { x: 48, w: 800 }, laneCol = { x: 848, w: 544 };
    const onPage: DeskState = { ...c(48, 800), lane: true, page, column: page };
    const inLane: DeskState = { ...c(848, 544), lane: true, page, column: laneCol };
    const a = dockPlacement(1440, onPage), b = dockPlacement(1440, inLane);
    expect(b).toEqual(a);
    expect(b.x + b.w / 2).toBeLessThanOrEqual(laneCol.x);
    expect(dockColumn(1440, inLane)).toEqual(page);
  });
  it('keeps room on its left for the ask bar\'s + : unchanged where there is room, else it gives up its left side', () => {
    const R = newQuestionReserve(1440);
    expect(R).toBe(52);
    expect(dockPlacement(1440, c(290, 860), undefined, 0, R)).toEqual({ x: 720, w: DOCK_MAX });
    // A slide column from the window's margin: the dock's right edge stays under it, its left makes room.
    const d = dockPlacement(1000, c(25, 462), undefined, 0, R);
    expect(d.x + d.w / 2).toBeCloseTo(25 + 462, 5);
    expect(d.x - d.w / 2).toBeCloseTo(25 + R, 5);
    // The lane (layout C), the pen in the lane: the dock stays under the page column (QA M4), and the + keeps its room inside the window.
    const lane: DeskState = { split: 'normal', stacked: false, following: true, sketching: true, lane: true, column: { x: 848, w: 544 }, page: { x: 48, w: 800 } };
    const l = dockPlacement(1440, lane, undefined, 0, R);
    expect(l.x - l.w / 2 - R).toBeGreaterThanOrEqual(16);
    expect(l.x + l.w / 2).toBeLessThanOrEqual(848);
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

describe('dockPlacement under the overview zoom and beside the overview pill', () => {
  const lane = (x: number, w: number): DeskState => ({ ...c(x, w), lane: true } as DeskState);
  it('follows the column where it shows: scaled about the window centre and slid by the pan', () => {
    // 1440: page column 48–848; at 125% it shows from 720 + (48 − 720)·1.25 = −120 to 880 (clipped to 0).
    const d = dockPlacement(1440, lane(48, 800), { z: 1.25, panX: 0 });
    expect(d.x - d.w / 2).toBeGreaterThanOrEqual(16);
    expect(d.x + d.w / 2).toBeLessThanOrEqual(880);
  });
  it('never leaves the window at any zoom or pan', () => {
    for (const z of [0.5, 0.9, 1, 1.18, 1.5, 2]) for (const panX of [-700, 0, 700]) for (const W of [1200, 1440, 2560]) {
      const d = dockPlacement(W, lane(48, 800), { z, panX });
      expect(d.x - d.w / 2).toBeGreaterThanOrEqual(16 - 1e-9);
      expect(d.x + d.w / 2).toBeLessThanOrEqual(W - 16 + 1e-9);
      expect(d.w).toBeGreaterThanOrEqual(340);
    }
  });
  it('keeps clear of the overview pill on the right (the dock under the lane)', () => {
    // 1440: the lane 848–1392; the pill takes 260 px from the right edge.
    const d = dockPlacement(1440, lane(848, 544), { z: 1.1, panX: 0 }, 260);
    expect(d.x + d.w / 2).toBeLessThanOrEqual(1440 - 16 - 260);
    expect(d.w).toBeGreaterThanOrEqual(340);
  });
  it('is unchanged at 100% with no pill', () => {
    expect(dockPlacement(1440, c(36, 666), { z: 1, panX: 0 }, 0)).toEqual(dockPlacement(1440, c(36, 666)));
  });
});
