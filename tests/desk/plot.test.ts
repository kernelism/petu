// tests/desk/plot.test.ts
import { describe, it, expect } from 'vitest';
import { plotStrokes, PLOT_SAMPLES } from '../../src/desk/plot';
import { compile } from '../../src/desk/expr';

const box = { x: 100, y: 600, w: 500, h: 400 };

describe('plotStrokes', () => {
  it('maps the domain across the box, left to right, and the range bottom to top', () => {
    const [s] = plotStrokes(compile('x'), [0, 10], box, [0, 10]);
    expect(s).toHaveLength(PLOT_SAMPLES + 1);
    expect(s[0]).toEqual({ x: 100, y: 600 });
    expect(s[s.length - 1]).toEqual({ x: 600, y: 200 });
    for (let i = 1; i < s.length; i++) expect(s[i].x).toBeGreaterThan(s[i - 1].x);
  });
  it('1/x over 0.5..5 fits the box with an automatic range', () => {
    const strokes = plotStrokes(compile('1/x'), [0.5, 5], box);
    expect(strokes).toHaveLength(1);
    const ys = strokes[0].map((p) => p.y);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(200 - 1e-9);
    expect(Math.max(...ys)).toBeLessThanOrEqual(600 + 1e-9);
  });
  it('breaks the path at poles and outside the range', () => {
    const strokes = plotStrokes(compile('1/x'), [-2, 2], box, [-3, 3]);
    expect(strokes.length).toBe(2);
  });
  it('returns nothing for an empty domain or an all-NaN function', () => {
    expect(plotStrokes(compile('x'), [3, 3], box)).toEqual([]);
    expect(plotStrokes(compile('sqrt(x)'), [-5, -1], box)).toEqual([]);
  });
});
