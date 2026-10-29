// Braces drawn as brackets (design 3.4): beside the measured segment, on its clear side, never across it.
import { describe, expect, it } from 'vitest';
import { bracketSide, bracketStroke } from '../../src/ink/agent/strokes';

describe('bracket', () => {
  const a = { x: 100, y: 200 }, b = { x: 300, y: 200 }; // a → b east: left (side 1) is north (y smaller)
  it('stands off the segment: ticks stop short of it, the spine is parallel, the notch points out', () => {
    const s = bracketStroke(a, b, { gap: 5, tick: 7, notch: 4, side: 1 });
    expect(s[0]).toEqual({ x: 100, y: 195 });
    expect(s[1]).toEqual({ x: 100, y: 188 });
    expect(s[3]).toEqual({ x: 200, y: 184 });
    expect(s[s.length - 1]).toEqual({ x: 300, y: 195 });
    expect(Math.max(...s.map((p) => p.y))).toBeLessThan(200); // nothing crosses the measured edge
    const r = bracketStroke(a, b, { gap: 5, tick: 7, notch: 4, side: -1 });
    expect(Math.min(...r.map((p) => p.y))).toBeGreaterThan(200);
  });
  it('goes to the side with less on it; left of a → b on a tie', () => {
    expect(bracketSide(a, b, 40, [], [])).toBe(1);
    // A triangle above the edge (its sides cross the left strip): the bracket goes below.
    const tri = [{ a: { x: 100, y: 200 }, b: { x: 200, y: 120 } }, { a: { x: 200, y: 120 }, b: { x: 300, y: 200 } }];
    expect(bracketSide(a, b, 40, [], tri)).toBe(-1);
    // A label box below: above it is.
    expect(bracketSide(a, b, 40, [{ x: 150, y: 210, w: 80, h: 20 }], [])).toBe(1);
  });
});
