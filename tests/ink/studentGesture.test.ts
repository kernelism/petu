import { describe, expect, it } from 'vitest';
import { joins, kindOf, shapeOf, type Pt } from '../../src/ink/student/gesture';

// Strokes as a student draws them (page units: 1000 across), with a little hand jitter.
const jit = (p: Pt[], a = 1.2) => p.map((q, i) => ({ x: q.x + a * Math.sin(i * 1.7), y: q.y + a * Math.cos(i * 2.3) }));
const seg = (a: Pt, b: Pt, n = 20) => Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }));
const ellipse = (cx: number, cy: number, rx: number, ry: number, turn = 1.08) =>
  Array.from({ length: 48 }, (_, i) => { const t = -Math.PI / 2 + (i / 47) * Math.PI * 2 * turn; return { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) }; });
/** A question mark's curl: over the top clockwise from the left, then the stem down. */
const hook = (cx: number, cy: number, r: number) => [
  ...Array.from({ length: 30 }, (_, i) => { const t = 0.9 * Math.PI + (i / 29) * 1.6 * Math.PI; return { x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) }; }),
  ...seg({ x: cx, y: cy + r }, { x: cx, y: cy + 2.2 * r }, 8).slice(1),
];
const dot = (x: number, y: number) => [{ x, y }, { x: x + 1.5, y: y + 1 }, { x: x + 0.5, y: y + 2 }];

describe('student gestures', () => {
  it('a closed loop is a circle (lasso), even drawn slanted and overshooting', () => {
    expect(shapeOf(jit(ellipse(400, 300, 120, 40))).kind).toBe('loop');
    expect(kindOf(shapeOf(ellipse(400, 300, 60, 60, 1.0)))).toBe('circle');
  });

  it('a flat straight stroke is an underline; a slanted one alone is a note', () => {
    const u = shapeOf(jit(seg({ x: 100, y: 500 }, { x: 420, y: 506 }), 0.8));
    expect(u).toEqual({ kind: 'line', flat: true });
    expect(kindOf(u)).toBe('underline');
    expect(kindOf(shapeOf(seg({ x: 100, y: 500 }, { x: 260, y: 700 })))).toBe('note');
  });

  it('a one-stroke arrow (shaft, then the head) is an arrow from its start to its tip', () => {
    const pts = [...seg({ x: 100, y: 400 }, { x: 300, y: 400 }), ...seg({ x: 300, y: 400 }, { x: 280, y: 388 }, 5).slice(1), ...seg({ x: 280, y: 388 }, { x: 300, y: 400 }, 5).slice(1), ...seg({ x: 300, y: 400 }, { x: 280, y: 412 }, 5).slice(1)];
    const s = shapeOf(pts);
    expect(s.kind).toBe('arrow');
    if (s.kind !== 'arrow') return;
    expect(s.from.x).toBeCloseTo(100, 0);
    expect(Math.abs(s.to.x - 300)).toBeLessThan(10);
  });

  it('a line, then a head drawn at one end within a moment, is an arrow to that end', () => {
    const line = { shape: shapeOf(seg({ x: 100, y: 400 }, { x: 300, y: 300 })), pts: seg({ x: 100, y: 400 }, { x: 300, y: 300 }), t: 0 };
    const headPts = [...seg({ x: 115, y: 380 }, { x: 100, y: 400 }, 6), ...seg({ x: 100, y: 400 }, { x: 122, y: 400 }, 6).slice(1)];
    const head = { shape: shapeOf(headPts), pts: headPts, t: 900 };
    expect(head.shape.kind).toBe('chevron');
    const j = joins(line, head);
    expect(j?.kind).toBe('arrow');
    if (j?.kind === 'arrow') { expect(j.to).toEqual({ x: 100, y: 400 }); expect(j.from).toEqual({ x: 300, y: 300 }); }
    // Too late: two gestures.
    expect(joins(line, { ...head, t: 4000 })).toBeNull();
  });

  it('a "?" is its curl, alone or with its dot under the stem', () => {
    const h = jit(hook(500, 300, 25), 0.6);
    const s = shapeOf(h);
    expect(s.kind).toBe('hook');
    expect(kindOf(s)).toBe('confused');
    const d = dot(500, 372);
    expect(shapeOf(d).kind).toBe('dot');
    expect(joins({ shape: s, pts: h, t: 0 }, { shape: shapeOf(d), pts: d, t: 400 })).toEqual({ kind: 'confused' });
    // A dot far away is not the "?"'s.
    const far = dot(700, 372);
    expect(joins({ shape: s, pts: h, t: 0 }, { shape: shapeOf(far), pts: far, t: 400 })).toBeNull();
  });

  it('anything else (a scribble, a word) is a note', () => {
    const zig = Array.from({ length: 30 }, (_, i) => ({ x: 100 + i * 6, y: 300 + (i % 2 ? 18 : 0) }));
    expect(kindOf(shapeOf(zig))).toBe('note');
    expect(kindOf(shapeOf(dot(10, 10)))).toBe('note');
  });

  it('a highlighter stroke always means "this phrase"', () => {
    expect(kindOf(shapeOf(ellipse(400, 300, 50, 50)), 'highlighter')).toBe('underline');
  });
});
