// tests/geometry/forgive.test.ts — Task 1c: resolver side of the forgiving grammar (evidence C12).
import { describe, it, expect } from 'vitest';
import { Figures, type Grounding } from '../../src/geometry/resolve';
import { parseTag } from '../../src/script/parseTag';
import type { RawAction } from '../../src/script/types';

const ground: Grounding = {
  mark: (page, id) => (page !== 12 ? undefined
    : id === '#s3' ? { kind: 'line', from: { x: 400, y: 600 }, to: { x: 500, y: 200 } }
    : id === '#e12' ? { kind: 'equation', rect: { x: 100, y: 100, w: 200, h: 50 } }
    : id === '#d1' ? { kind: 'dot', at: { x: 300, y: 300 } }
    : undefined),
};
const run = (f: Figures, ...tags: string[]) => {
  const as = tags.map((t) => parseTag(t) as RawAction);
  as.forEach((a) => f.note(a));
  return as.map((a) => f.resolve(a));
};

describe('highlight / underline on a mark with no words (C12i)', () => {
  it('a highlight frames an equation or a line mark', () => {
    const f = new Figures(ground);
    expect(f.resolve({ kind: 'highlight', page: 12, mark: '#e12' })).toEqual({ kind: 'box', page: 12, at: { x: 94, y: 94 }, w: 212, h: 62 });
    expect(f.resolve({ kind: 'highlight', page: 12, mark: '#s3' })).toEqual({ kind: 'box', page: 12, at: { x: 394, y: 194 }, w: 112, h: 412 });
    expect(f.resolve({ kind: 'highlight', page: 12, mark: '#d1' })).toMatchObject({ kind: 'circle', at: { x: 300, y: 300 } });
  });
  it('an underline runs under it', () => {
    const f = new Figures(ground);
    expect(f.resolve({ kind: 'underline', page: 12, mark: '#e12' })).toEqual({ kind: 'line', page: 12, from: { x: 100, y: 156 }, to: { x: 300, y: 156 } });
  });
  it('an unknown mark still skips', () => {
    expect(new Figures(ground).resolve({ kind: 'highlight', page: 12, mark: '#e9' })).toBe('unknown mark #e9');
  });
});

describe('arc → angle only when it resolves exactly (C12e)', () => {
  it('equal radii, less than a half turn: an angle arc of that radius', () => {
    const [, , a] = run(new Figures(ground), 'sketch id=p near=p3', 'let on=p P=500,400 D=700,400 B=500,200', 'arc on=p center=P from=D to=B');
    expect(a).toMatchObject({ kind: 'angle', at: { x: 500, y: 400 }, from: { x: 700, y: 400 }, to: { x: 500, y: 200 }, r: 200 });
    expect(a).not.toHaveProperty('arc');
  });
  it('the verbatim benchmark arc (D and B opposite) is a half turn: either side could be meant, so it skips', () => {
    const [, , a] = run(new Figures(ground), 'sketch id=p near=p159 fit', 'let on=p P=0,0 B=0,300 D=0,-300', 'arc on=p center=P from=D to=B');
    expect(a).toMatch(/^arc: .*half turn/);
  });
  it('unequal radii skip with what to write instead', () => {
    const [, , a] = run(new Figures(ground), 'sketch id=p near=p3', 'let on=p P=500,400 D=700,400 B=500,300', 'arc on=p center=P from=D to=B');
    expect(a).toMatch(/^arc: .*angle at= from= to= r=/);
  });
});

describe('connect end as a construction (C12f)', () => {
  it('to=w:mid(A,B) lands on the midpoint in the section', () => {
    const [, , c] = run(new Figures(ground), 'sketch id=w near=p12', 'let on=w A=100,200 B=300,400', 'connect from=p5:"P* = 7, Q* = 25" to=w:mid(A,B)');
    expect(c).toEqual({ kind: 'connect', from: { page: 5, quote: 'P* = 7, Q* = 25' }, to: { region: 'w', at: { x: 200, y: 300 } } });
  });
  it('an unknown name skips', () => {
    const [, c] = run(new Figures(ground), 'sketch id=w near=p12', 'connect from=p5:"x" to=w:mid(A,Z)');
    expect(c).toBe('unknown point A');
  });
});
