// tests/ink/strokesV2.test.ts
import { describe, it, expect } from 'vitest';
import { curveStroke, arcStroke, bisector, braceStroke, dotStroke, rng } from '../../src/ink/agent/strokes';

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
});
