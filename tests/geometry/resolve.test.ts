// tests/geometry/resolve.test.ts
import { describe, it, expect } from 'vitest';
import { Figures, type Grounding } from '../../src/geometry/resolve';
import { parsePtArg, worldPt } from '../../src/script/pointExpr';
import type { RawAction } from '../../src/script/types';

const P = (s: string) => parsePtArg(s, worldPt)!;
const ground: Grounding = {
  mark: (page, id) => (page !== 40 ? undefined
    : id === '#d1' ? { kind: 'dot', at: { x: 407, y: 600 } }
    : id === '#d3' ? { kind: 'dot', at: { x: 500, y: 219 } }
    : id === '#s3' ? { kind: 'line', from: { x: 407, y: 600 }, to: { x: 500, y: 219 } }
    : id === '#t16' ? { kind: 'text', rect: { x: 602, y: 737, w: 46, h: 30 }, text: 'B ⋅ f' }
    : undefined),
};

/** The spike's failing case, written relationally: twice as far, image points on the rays. */
const script: RawAction[] = [
  { kind: 'sketch', id: 's', page: 40, size: 'm', place: 'auto', fit: true },
  { kind: 'let', region: 's', defs: [['O', P('300,600')], ['O′', P('700,600')], ['L', P('150,500')], ['R', P('850,500')], ['X', P('500,300')], ['M', P('mid(O,O′)')], ['X2', P('along(M,X,2)')]] },
  { kind: 'line', region: 's', from: P('O'), to: P('X2'), weight: 'secondary' },
  { kind: 'point', region: 's', at: P('meet(O,X2,L,R)'), text: 'x', id: 'x2' },
  { kind: 'line', region: 's', from: P('O'), through: P('X'), id: 'ray' },
];

describe('Figures', () => {
  it('fits the whole declared figure (lookahead) and keeps topology exact', () => {
    const f = new Figures(ground);
    script.forEach((a) => f.note(a));
    const ray = f.resolve(script[2]) as { from: { x: number; y: number }; to: { x: number; y: number } };
    const pt = f.resolve(script[3]) as { at: { x: number; y: number } };
    // x2 lies on the drawn ray O→X2 (cross product ≈ 0)
    const cross = (ray.to.x - ray.from.x) * (pt.at.y - ray.from.y) - (ray.to.y - ray.from.y) * (pt.at.x - ray.from.x);
    expect(Math.abs(cross)).toBeLessThan(1e-6 * 1e6);
    // X2 (world y = 0) is twice as far from the baseline (y = 600) as X (y = 300): fitted, ratios kept
    const fig = f.figure({ region: 's' });
    const O = fig.toLocal(fig.world(P('O')) as never), X = fig.toLocal(fig.world(P('X')) as never), X2 = fig.toLocal(fig.world(P('X2')) as never);
    expect((O.y - X2.y) / (O.y - X.y)).toBeCloseTo(2);
    expect(X2.y).toBeGreaterThanOrEqual(0); expect(O.y).toBeLessThanOrEqual(700);
    expect(fig.outOfFrame).toBe(0);
  });
  it('a ray in a region runs to the frame edge', () => {
    const f = new Figures(ground);
    script.forEach((a) => f.note(a));
    const r = f.resolve(script[4]) as { to: { x: number; y: number } };
    expect(r.to.y).toBeCloseTo(12);
  });
  it('page marks: circle a dot, retrace a segment, box a text line, point by mark', () => {
    const f = new Figures(ground);
    expect(f.resolve({ kind: 'circle', page: 40, mark: '#d3' })).toMatchObject({ kind: 'circle', page: 40, at: { x: 500, y: 219 } });
    expect(f.resolve({ kind: 'line', page: 40, mark: '#s3', em: true })).toEqual({ kind: 'line', page: 40, em: true, from: { x: 407, y: 600 }, to: { x: 500, y: 219 } });
    expect(f.resolve({ kind: 'box', page: 40, mark: '#t16' })).toEqual({ kind: 'box', page: 40, at: { x: 596, y: 731 }, w: 58, h: 42 });
    expect(f.resolve({ kind: 'highlight', page: 40, mark: '#t16' })).toMatchObject({ kind: 'highlight', quote: 'B ⋅ f' });
    expect(f.resolve({ kind: 'arrow', page: 40, from: P('#d1'), to: P('#d3') })).toMatchObject({ from: { x: 407, y: 600 }, to: { x: 500, y: 219 } });
    expect(f.resolve({ kind: 'circle', page: 40, mark: '#d9' })).toBe('unknown mark #d9');
    expect(f.resolve({ kind: 'line', page: 40, mark: '#d1' })).toBe('#d1 is not a line');
  });
  it('a page ray without len stops at 1.5 × |AB|', () => {
    const f = new Figures(ground);
    const r = f.resolve({ kind: 'line', page: 40, from: P('#d1'), through: P('#d3') }) as { to: { x: number; y: number } };
    expect(r.to.x).toBeCloseTo(407 + 1.5 * 93); expect(r.to.y).toBeCloseTo(600 - 1.5 * 381);
  });
  it('unknown names skip (never guess); unfitted regions keep literal coords', () => {
    const f = new Figures(ground);
    f.note({ kind: 'sketch', id: 'k', page: 3, size: 'm', place: 'auto' });
    expect(f.resolve({ kind: 'point', region: 'k', at: P('Q') })).toBe('unknown point Q');
    expect(f.resolve({ kind: 'line', region: 'k', from: P('10,20'), to: P('30,40') })).toEqual({ kind: 'line', region: 'k', from: { x: 10, y: 20 }, to: { x: 30, y: 40 } });
  });
  it('let resolves to nothing to draw', () => {
    expect(new Figures(ground).resolve(script[1])).toBeNull();
  });
});
