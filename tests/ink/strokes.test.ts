import { describe, it, expect } from 'vitest';
import { circleStroke, lineStroke, arrowStrokes, boxStroke, rng } from '../../src/ink/agent/strokes';

const d = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe('strokes', () => {
  it('circle starts and ends at (nearly) the same spot after a full loop', () => {
    const s = circleStroke({ x: 500, y: 500 }, 40, 40, null);
    expect(d(s[0], s[s.length - 1])).toBeLessThan(40 * 0.35);
    // sweeps more than a full turn: accumulated angle
    let total = 0;
    for (let i = 1; i < s.length; i++) {
      const a0 = Math.atan2(s[i - 1].y - 500, s[i - 1].x - 500), a1 = Math.atan2(s[i].y - 500, s[i].x - 500);
      let da = a1 - a0; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
      total += da;
    }
    expect(Math.abs(total)).toBeGreaterThan(2 * Math.PI);
  });
  it('hand circle is deterministic for a seed and still closes', () => {
    const a = circleStroke({ x: 300, y: 300 }, 30, 30, rng(7));
    const b = circleStroke({ x: 300, y: 300 }, 30, 30, rng(7));
    expect(a).toEqual(b);
    expect(d(a[0], a[a.length - 1])).toBeLessThan(30 * 0.45);
  });
  it('line goes from start to end', () => {
    const s = lineStroke({ x: 10, y: 10 }, { x: 200, y: 50 }, null);
    expect(s[0]).toEqual({ x: 10, y: 10 });
    expect(s[s.length - 1]).toEqual({ x: 200, y: 50 });
  });
  it('arrow = shaft then head, head passes through the tip', () => {
    const [shaft, head] = arrowStrokes({ x: 0, y: 0 }, { x: 100, y: 0 }, null);
    expect(shaft[shaft.length - 1]).toEqual({ x: 100, y: 0 });
    expect(head).toHaveLength(3);
    expect(head[1]).toEqual({ x: 100, y: 0 });
  });
  it('box is one stroke that closes near its start', () => {
    const s = boxStroke(100, 100, 80, 40, null);
    expect(d(s[0], s[s.length - 1])).toBeLessThan(15);
    const xs = s.map((p) => p.x), ys = s.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(100); expect(Math.max(...xs)).toBeCloseTo(180);
    expect(Math.min(...ys)).toBeCloseTo(100); expect(Math.max(...ys)).toBeCloseTo(140);
  });
});
