// tests/ui/layout.test.ts
import { describe, it, expect } from 'vitest';
import { dockPlacement, DOCK_MAX } from '../../src/ui/layout';
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
