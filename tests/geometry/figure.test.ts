// tests/geometry/figure.test.ts
import { describe, it, expect } from 'vitest';
import { Figure, fitBox, meet, foot, rayEnd, FIT_MX } from '../../src/geometry/figure';
import { parsePtArg, worldPt } from '../../src/script/pointExpr';

const P = (s: string) => parsePtArg(s, worldPt)!;

describe('pointExpr', () => {
  it('parses literals, names, marks and constructions', () => {
    expect(P('10,-20')).toEqual({ x: 10, y: -20 });
    expect(P('X')).toEqual({ ref: 'X' });
    expect(P("O'")).toEqual({ ref: 'O′' });
    expect(P('img.a')).toEqual({ ref: 'img.a' });
    expect(P('#d3')).toEqual({ ref: '#d3' });
    expect(P('along(M,X,2)')).toEqual({ fn: 'along', args: [{ ref: 'M' }, { ref: 'X' }], t: 2 });
    expect(P('meet(O,X,mid(A,B),B)')).toEqual({ fn: 'meet', args: [{ ref: 'O' }, { ref: 'X' }, { fn: 'mid', args: [{ ref: 'A' }, { ref: 'B' }] }, { ref: 'B' }] });
  });
  it('rejects malformed arguments', () => {
    for (const bad of ['mid(A)', 'along(A,B)', 'along(A,B,x)', 'meet(A,B,C)', 'foo(A,B)', 'mid(A,B', '9x', '#D3', 'along(A,B,99)']) {
      expect(parsePtArg(bad, worldPt), bad).toBeUndefined();
    }
  });
});

describe('Figure', () => {
  it('twice as far: along() from the baseline midpoint doubles the depth exactly', () => {
    const f = new Figure(true);
    f.define('O', P('300,600')); f.define('O′', P('700,600')); f.define('X', P('500,300'));
    f.define('M', P('mid(O,O′)')); f.define('X2', P('along(M,X,2)'));
    expect(f.world({ ref: 'X2' })).toEqual({ x: 500, y: 0 });
  });
  it('image points are where the rays cross the image line', () => {
    const f = new Figure(false);
    for (const [k, v] of [['O', '300,620'], ['X', '500,220'], ['L', '100,520'], ['R', '900,520']]) f.define(k, P(v));
    expect(f.world(P('meet(O,X,L,R)'))).toEqual({ x: 350, y: 520 });
  });
  it('reports missing names, parallel meets and cycles instead of guessing', () => {
    const f = new Figure(false);
    f.define('A', P('0,0')); f.define('B', P('10,0')); f.define('C', P('0,5')); f.define('D', P('10,5'));
    expect(f.world(P('Q'))).toEqual({ missing: 'Q' });
    expect(f.world(P('meet(A,B,C,D)'))).toEqual({ degenerate: 'parallel lines in meet()' });
    f.define('U', P('mid(V,A)')); f.define('V', P('mid(U,A)'));
    expect('degenerate' in (f.world(P('U')) as object)).toBe(true);
  });
  it('first definition wins', () => {
    const f = new Figure(false);
    expect(f.define('A', P('1,1'))).toBe(true);
    expect(f.define('A', P('2,2'))).toBe(false);
    expect(f.world(P('A'))).toEqual({ x: 1, y: 1 });
  });
  it('page marks resolve through the grounding', () => {
    const f = new Figure(false, (id) => (id === '#d3' ? { x: 500, y: 220 } : undefined));
    expect(f.world(P('along(#d3,10,20,0.5)'.replace('10,20', 'A')))).toEqual({ missing: 'A' });
    f.define('A', P('100,220'));
    expect(f.world(P('mid(#d3,A)'))).toEqual({ x: 300, y: 220 });
  });
  it('fits the world box into the region uniformly, centred, with margins, frozen once', () => {
    const f = new Figure(true);
    f.define('O', P('300,600')); f.define('X2', P('500,-600'));
    const a = f.toLocal({ x: 300, y: 600 }), b = f.toLocal({ x: 500, y: -600 });
    expect(b.y).toBeCloseTo(70); expect(a.y).toBeCloseTo(630);
    expect((a.x + b.x) / 2).toBeCloseTo(500);
    f.define('far', P('5000,5000')); // after the freeze: clamped and counted, the frame does not jump
    const c = f.toLocal({ x: 5000, y: 5000 });
    expect(c).toEqual({ x: 1000, y: 700 });
    expect(f.outOfFrame).toBe(1);
  });
  it('unfitted figures are identity (demo scripts stay byte-identical)', () => {
    const f = new Figure(false);
    expect(f.toLocal({ x: 123, y: 456 })).toEqual({ x: 123, y: 456 });
  });
  it('fitBox handles points and lines without collapsing', () => {
    expect(fitBox({ x0: 5, y0: 5, x1: 5, y1: 5 })).toEqual({ s: 1, dx: 495, dy: 345 });
    const h = fitBox({ x0: 0, y0: 100, x1: 100, y1: 100 }); // horizontal segment: width decides, capped
    expect(h.s).toBe(4);
    const w = fitBox({ x0: 0, y0: 0, x1: 2000, y1: 10 });
    expect(w.s).toBeCloseTo((1000 - 2 * FIT_MX) / 2000);
  });
});

describe('constructions', () => {
  it('meet, foot, rayEnd', () => {
    expect(meet({ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 2, y: 0 })).toEqual({ x: 1, y: 1 });
    expect(foot({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toEqual({ x: 5, y: 0 });
    const e = rayEnd({ x: 500, y: 620 }, { x: 500, y: 520 }, 1000, 700)!;
    expect(e).toEqual({ x: 500, y: 12 });
    const d = rayEnd({ x: 100, y: 600 }, { x: 200, y: 500 }, 1000, 700)!; // leaves through the top edge
    expect(d.y).toBeCloseTo(12); expect(d.x).toBeCloseTo(688);
  });
});
