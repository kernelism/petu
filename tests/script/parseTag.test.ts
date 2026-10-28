import { describe, it, expect } from 'vitest';
import { parseTag } from '../../src/script/parseTag';

describe('parseTag', () => {
  it('parses circle with r', () => {
    expect(parseTag('circle p=3 at=290,473 r=21')).toEqual({ kind: 'circle', page: 3, at: { x: 290, y: 473 }, rx: 21, ry: 21 });
  });
  it('parses highlight quote with smart quotes', () => {
    expect(parseTag('highlight p=2 “the epipolar line”')).toEqual({ kind: 'highlight', page: 2, quote: 'the epipolar line' });
  });
  it('parses line, arrow, box, label, scroll, clear', () => {
    expect(parseTag('line p=1 from=0,0 to=10,20')).toEqual({ kind: 'line', page: 1, from: { x: 0, y: 0 }, to: { x: 10, y: 20 } });
    expect(parseTag('arrow p=1 from=5,5 to=9,9')?.kind).toBe('arrow');
    expect(parseTag('box p=1 at=100,100 size=50,40')).toEqual({ kind: 'box', page: 1, at: { x: 100, y: 100 }, w: 50, h: 40 });
    expect(parseTag('label p=1 at=10,10 "epipolar line"')).toEqual({ kind: 'label', page: 1, at: { x: 10, y: 10 }, text: 'epipolar line' });
    expect(parseTag('scroll p=4')).toEqual({ kind: 'scroll', page: 4 });
    expect(parseTag('scroll p=4 y=300')).toEqual({ kind: 'scroll', page: 4, y: 300 });
    expect(parseTag('clear')).toEqual({ kind: 'clear' });
  });
  it('parses anchored circle/box/highlight with optional near', () => {
    expect(parseTag('circle p=3 "x" near=290,470')).toEqual({ kind: 'circle', page: 3, quote: 'x', near: { x: 290, y: 470 } });
    expect(parseTag('box p=3 "F x = 0"')).toEqual({ kind: 'box', page: 3, quote: 'F x = 0' });
    expect(parseTag('highlight p=2 "ray" near=100,100')).toEqual({ kind: 'highlight', page: 2, quote: 'ray', near: { x: 100, y: 100 } });
  });
  it('clamps coordinates to 0..1000', () => {
    expect(parseTag('line p=1 from=-20,5 to=1200,9')).toEqual({ kind: 'line', page: 1, from: { x: 0, y: 5 }, to: { x: 1000, y: 9 } });
  });
  it('rejects malformed tags', () => {
    expect(parseTag('circle p=1 at=10 r=5')).toBeNull();
    expect(parseTag('highlight p=1')).toBeNull();
    expect(parseTag('wiggle p=1')).toBeNull();
    expect(parseTag('line from=1,1 to=2,2')).toBeNull();
    expect(parseTag('')).toBeNull();
  });
  it('parses board actions: board, write, on=board, em', () => {
    expect(parseTag('board')).toEqual({ kind: 'board' });
    expect(parseTag('write on=board at=100,200 "x′ᵀFx = 0" size=l')).toEqual({ kind: 'write', page: 0, at: { x: 100, y: 200 }, text: 'x′ᵀFx = 0', size: 'l' });
    expect(parseTag('write on=board at=10,20 "C"')).toEqual({ kind: 'write', page: 0, at: { x: 10, y: 20 }, text: 'C', size: 'm' });
    expect(parseTag('circle on=board "Fx" em')).toEqual({ kind: 'circle', page: 0, quote: 'Fx', em: true });
    expect(parseTag('line on=board from=0,0 to=10,20 em')).toEqual({ kind: 'line', page: 0, from: { x: 0, y: 0 }, to: { x: 10, y: 20 }, em: true });
    expect(parseTag('box on=board at=10,10 size=50,40')).toEqual({ kind: 'box', page: 0, at: { x: 10, y: 10 }, w: 50, h: 40 });
  });
  it('rejects malformed board tags', () => {
    expect(parseTag('scroll on=board')).toBeNull();
    expect(parseTag('write p=3 at=1,1 "x"')).toBeNull();
    expect(parseTag('write on=board "x"')).toBeNull();
    expect(parseTag('write on=board at=1,1 "x" size=xl')).toBeNull();
    expect(parseTag('circle p=0 at=1,1 r=5')).toBeNull();
  });
});
