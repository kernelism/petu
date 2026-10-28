// tests/ink/strokesV2.test.ts
import { describe, it, expect } from 'vitest';
import { curveStroke, crossesItself, arcStroke, bisector, braceStroke, dotStroke, rng } from '../../src/ink/agent/strokes';

const d = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe('toolkit v2 strokes', () => {
  it('curve passes through every given point, in order', () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 50 }, { x: 200, y: 0 }, { x: 300, y: 80 }];
    const s = curveStroke(pts, null, 16);
    expect(s[0]).toEqual(pts[0]);
    expect(d(s[s.length - 1], pts[3])).toBeLessThan(1e-9);
    for (const p of pts) expect(Math.min(...s.map((q) => d(q, p)))).toBeLessThan(1e-9);
    expect(s).toHaveLength(3 * 16 + 1);
  });
  it('hand curve is seeded and keeps its ends', () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 50 }, { x: 200, y: 0 }];
    const a = curveStroke(pts, rng(3)), b = curveStroke(pts, rng(3));
    expect(a).toEqual(b);
    expect(a[0]).toEqual(pts[0]);
    expect(a[a.length - 1]).toEqual(pts[2]);
  });
  it('arc sweeps the smaller angle between the rays at radius r', () => {
    const c = { x: 100, y: 100 };
    const s = arcStroke(c, { x: 200, y: 100 }, { x: 100, y: 0 }, 30); // east to north: 90° (counter-clockwise on screen)
    expect(d(s[0], { x: 130, y: 100 })).toBeLessThan(1e-9);
    expect(d(s[s.length - 1], { x: 100, y: 70 })).toBeLessThan(1e-9);
    for (const p of s) expect(d(p, c)).toBeCloseTo(30);
    const b = bisector(c, { x: 200, y: 100 }, { x: 100, y: 0 });
    expect(b.x).toBeCloseTo(Math.SQRT1_2);
    expect(b.y).toBeCloseTo(-Math.SQRT1_2);
  });
  it('brace runs end to end through a tip `depth` to the left of the direction', () => {
    const a = { x: 100, y: 500 }, b = { x: 400, y: 500 };
    const s = braceStroke(a, b, 20);
    expect(d(s[0], a)).toBeLessThan(1e-9);
    expect(d(s[s.length - 1], b)).toBeLessThan(1e-9);
    const tip = s.reduce((m, p) => (p.y < m.y ? p : m));
    expect(tip.x).toBeCloseTo(250);
    expect(tip.y).toBeCloseTo(480); // left of east is up (y down)
    // written right to left, the same span braces downward
    const down = braceStroke(b, a, 20);
    expect(Math.max(...down.map((p) => p.y))).toBeCloseTo(520);
  });
  it('dot is a closed loop of radius r', () => {
    const s = dotStroke({ x: 10, y: 10 }, 5);
    expect(d(s[0], s[s.length - 1])).toBeLessThan(1e-9);
    for (const p of s) expect(d(p, { x: 10, y: 10 })).toBeCloseTo(5);
  });
  it('a curve through points out of order crosses itself; an ordered wave or a closed loop does not', () => {
    const P = (xs: number[][]) => xs.map(([x, y]) => ({ x, y }));
    // A wave listed out of order (the spline doubles back): the P1 failure.
    expect(crossesItself(curveStroke(P([[0, 0], [25, -70], [100, 0], [75, 70], [200, 0], [125, -70], [300, 0], [175, 70], [400, 0], [225, -70], [275, 70]]), null))).toBe(true);
    // The same wave in order, left to right.
    expect(crossesItself(curveStroke(P([[0, 0], [25, -70], [50, 0], [75, 70], [100, 0], [125, -70], [150, 0]]), null))).toBe(false);
    // A closed loop meets itself only at its ends.
    expect(crossesItself(curveStroke(P([[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]), null))).toBe(false);
    // A figure eight.
    expect(crossesItself(P([[0, 0], [100, 100], [100, 0], [0, 100]]))).toBe(true);
  });
});
