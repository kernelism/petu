// tests/script/tokenize.test.ts
import { describe, it, expect } from 'vitest';
import { tokenize } from '../../src/script/tokenize';

describe('tokenize', () => {
  it('name, args, quotes and flags', () => {
    const t = tokenize('circle P=3 "x" near=290,470 em')!;
    expect(t.name).toBe('circle');
    expect(t.args).toEqual({ p: '3', near: '290,470' });
    expect(t.quotes).toEqual(['x']);
    expect([...t.flags]).toEqual(['em']);
  });
  it('quoted values may hold spaces, inside keys and inside connector ends', () => {
    const t = tokenize('axes on=side at=100,600 size=500,400 x="depth z" y=“disparity d”')!;
    expect(t.args.x).toBe('depth z');
    expect(t.args.y).toBe('disparity d');
    expect(tokenize('connect from=p3:"image 1" to=side:x')!.args.from).toBe('p3:"image 1"');
  });
  it('pts continues over bare points', () => {
    expect(tokenize('curve on=side pts=1,2 30,40 5.5,6 dash')!.args.pts).toBe('1,2 30,40 5.5,6');
    expect([...tokenize('curve on=side pts=1,2 30,40 dash')!.flags]).toEqual(['dash']);
  });
  it('rawArgs keeps keys as written (let names are case-sensitive)', () => {
    expect(tokenize('let on=s O=1,2 o=3,4')!.rawArgs).toEqual({ on: 's', O: '1,2', o: '3,4' });
  });
  it('pts continues over names and constructions, but not flags', () => {
    const t = tokenize('shade on=s pts=O X mid(A,B) em')!;
    expect(t.args.pts).toBe('O X mid(A,B)');
    expect([...t.flags]).toEqual(['em']);
  });
  it('keeps backslashes in math', () => {
    expect(tokenize('math on=side at=1,2 "\\frac{B f}{z}"')!.quotes).toEqual(['\\frac{B f}{z}']);
  });
  it('rejects an unterminated quote and an empty body', () => {
    expect(tokenize('label p=1 at=1,1 "oops')).toBeNull();
    expect(tokenize('   ')).toBeNull();
  });
  it('notes a key given twice; let names differing in case are two names', () => {
    expect([...tokenize('line on=s from=D to=C to=E')!.dupKeys]).toEqual(['to']);
    const t = tokenize('let on=s O=0,0 o=1,1')!;
    expect(t.rawArgs).toEqual({ on: 's', O: '0,0', o: '1,1' });
    expect(t.dupKeys.size).toBe(0);
  });
});
