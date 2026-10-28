import { describe, it, expect } from 'vitest';
import { cumulative, partial, strokeDurationMs, ease } from '../../src/ink/agent/animate';

describe('animate helpers', () => {
  const s = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
  it('cumulative lengths', () => expect(cumulative(s)).toEqual([0, 10, 20]));
  it('partial path ends at an interpolated tip', () => {
    const p = partial(s, cumulative(s), 15);
    expect(p.tip).toEqual({ x: 10, y: 5 });
    expect(p.points).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }]);
  });
  it('duration scales with on-screen length and clamps', () => {
    expect(strokeDurationMs(10)).toBe(140);
    expect(strokeDurationMs(350)).toBe(500);
    expect(strokeDurationMs(5000)).toBe(700);
    expect(strokeDurationMs(5000, undefined, 0.5)).toBe(350); // backlog compression
    expect(strokeDurationMs(100, 400)).toBe(400); // closed-shape floor
    expect(strokeDurationMs(10, 400)).toBe(400);
  });
  it('ease is slow-fast-slow and hits the endpoints', () => {
    expect(ease(0)).toBe(0); expect(ease(1)).toBeCloseTo(1);
    expect(ease(0.1)).toBeLessThan(0.1); expect(ease(0.5)).toBeCloseTo(0.5);
  });
});
