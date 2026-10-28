// tests/desk/nudge.test.ts
import { describe, it, expect } from 'vitest';
import { nudge, placeLabel, MAX_NUDGES, NUDGE_GAP } from '../../src/desk/nudge';

const B = { x: 0, y: 0, w: 1000, h: 700 };
const hit = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('nudge', () => {
  it('leaves a free label where it is', () => {
    const r = { x: 100, y: 100, w: 40, h: 20 };
    expect(nudge(r, [{ x: 300, y: 300, w: 10, h: 10 }], B)).toEqual(r);
  });
  it('moves off an overlapping element along the shortest axis, with a gap', () => {
    const r = nudge({ x: 100, y: 100, w: 40, h: 20 }, [{ x: 0, y: 112, w: 400, h: 4 }], B); // a thin horizontal line under it
    expect(r.x).toBe(100);
    expect(r.y + r.h).toBe(112 - NUDGE_GAP);
  });
  it('stays inside the bounds (picks another direction at an edge)', () => {
    const r = nudge({ x: 0, y: 0, w: 40, h: 20 }, [{ x: 0, y: 0, w: 30, h: 400 }], B);
    expect(r.x).toBeGreaterThanOrEqual(30 + NUDGE_GAP);
    expect(r.y).toBeGreaterThanOrEqual(0);
  });
  it('gives up after MAX_NUDGES and accepts', () => {
    // Obstacles tiled everywhere: no free spot.
    const obs = [];
    for (let x = 0; x < 1000; x += 50) for (let y = 0; y < 700; y += 50) obs.push({ x, y, w: 48, h: 48 });
    const r = nudge({ x: 500, y: 300, w: 40, h: 20 }, obs, B);
    expect(MAX_NUDGES).toBe(3);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.x + r.w).toBeLessThanOrEqual(1000);
  });
  it('clears two neighbours in a row', () => {
    const obs = [{ x: 90, y: 90, w: 60, h: 40 }, { x: 150, y: 90, w: 60, h: 40 }];
    const r = nudge({ x: 120, y: 100, w: 40, h: 20 }, obs, B);
    expect(obs.some((o) => hit(r, o))).toBe(false);
  });
});

describe('placeLabel', () => {
  it('puts the box toward its compass direction, growing away from the anchor', () => {
    const a = { x: 500, y: 300 };
    const ne = placeLabel(a, 30, 20, 'ne');
    expect(ne.x).toBeGreaterThan(500);
    expect(ne.y + ne.h).toBeLessThan(300);
    const w = placeLabel(a, 30, 20, 'w');
    expect(w.x + w.w).toBeLessThan(500);
    expect(w.y + w.h / 2).toBeCloseTo(300);
    const s = placeLabel(a, 30, 20, 's', 6);
    expect(s.y).toBe(300 + 12 + 6);
    expect(s.x + s.w / 2).toBeCloseTo(500);
  });
});
