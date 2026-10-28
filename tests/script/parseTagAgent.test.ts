// tests/script/parseTagAgent.test.ts
import { describe, it, expect, vi } from 'vitest';
import { parseTag } from '../../src/script/parseTag';
import { ScriptParser } from '../../src/script/parser';
import { Figures } from '../../src/geometry/resolve';

describe('parseTag: agent v2 grammar', () => {
  it('sketch … fit', () => {
    expect(parseTag('sketch id=s near=p4 size=m fit')).toEqual({ kind: 'sketch', id: 's', page: 4, size: 'm', place: 'auto', fit: true });
  });
  it('let names points (case-sensitive, primes), literals and constructions', () => {
    expect(parseTag("let on=s O=300,600 O'=700,600 X=500,-200 x=meet(O,X,L,R)")).toEqual({
      kind: 'let', region: 's',
      defs: [['O', { x: 300, y: 600 }], ['O′', { x: 700, y: 600 }], ['X', { x: 500, y: -200 }],
        ['x', { fn: 'meet', args: [{ ref: 'O' }, { ref: 'X' }, { ref: 'L' }, { ref: 'R' }] }]],
    });
    expect(parseTag('let on=s')).toBeNull();
    expect(parseTag('let on=s 9a=1,1')).toBeNull();
    expect(parseTag('let on=s A=mid(B)')).toBeNull();
  });
  it('points accept names and constructions; element ids are case-sensitive', () => {
    expect(parseTag('point on=s at=meet(O,X,L,R) "x" id=x dir=s')).toEqual({
      kind: 'point', region: 's', at: { fn: 'meet', args: [{ ref: 'O' }, { ref: 'X' }, { ref: 'L' }, { ref: 'R' }] }, text: 'x', dir: 's', id: 'x',
    });
    expect((parseTag('point on=s at=1,1 id=X') as { id: string }).id).toBe('X');
    expect(parseTag('shade on=s pts=O X O′ em')).toMatchObject({ pts: [{ ref: 'O' }, { ref: 'X' }, { ref: 'O′' }], em: true });
  });
  it('rays: from + through (+ len), never with to', () => {
    expect(parseTag('line on=s from=O through=x weight=secondary')).toEqual({ kind: 'line', region: 's', from: { ref: 'O' }, through: { ref: 'x' }, weight: 'secondary' });
    expect(parseTag('arrow p=4 from=#d1 through=#d3 len=1.2')).toEqual({ kind: 'arrow', page: 4, from: { ref: '#d1' }, through: { ref: '#d3' }, len: 1.2 });
    expect(parseTag('line on=s from=O to=X through=x')).toBeNull();
    expect(parseTag('line on=s from=O through=x len=0')).toBeNull();
  });
  it('mark= on page shapes only', () => {
    expect(parseTag('circle p=4 mark=#d3 em')).toEqual({ kind: 'circle', page: 4, mark: '#d3', em: true });
    expect(parseTag('box p=4 mark=#t12 id=eq')).toEqual({ kind: 'box', page: 4, mark: '#t12', id: 'eq' });
    expect(parseTag('line p=4 mark=#s2 weight=secondary')).toEqual({ kind: 'line', page: 4, mark: '#s2', weight: 'secondary' });
    expect(parseTag('circle on=s mark=#d3')).toBeNull();
    expect(parseTag('point p=4 mark=#d3')).toBeNull();
    expect(parseTag('circle p=4 mark=d3')).toBeNull();
  });
  it('a relational script parses at every chunking and resolves with exact topology', () => {
    const script = '{{sketch id=s near=p4 fit}} Two cameras {{let on=s O=300,600 O′=700,600 L=100,500 R=900,500 X=500,300 M=mid(O,O′)}}' +
      ' {{line on=s from=L to=R id=img}} on one image line, {{point on=s at=X "X" id=X}} a point, {{line on=s from=O to=X weight=secondary}} its ray,' +
      ' {{point on=s at=meet(O,X,L,R) "x" dir=s}} and where it lands. {{point on=s at=along(M,X,2) "2z" em id=X2}} Twice as far.';
    for (const step of [1, 3, 7, 1000]) {
      const p = new ScriptParser();
      const evs = [];
      for (let i = 0; i < script.length; i += step) evs.push(...p.push(script.slice(i, i + step)));
      evs.push(...p.end());
      const acts = evs.flatMap((e) => (e.type === 'action' ? [e.action] : []));
      expect(acts).toHaveLength(7);
      const f = new Figures({ mark: () => undefined });
      acts.forEach((a) => f.note(a));
      const resolved = acts.map((a) => f.resolve(a));
      expect(resolved.every((r) => r !== undefined && typeof r !== 'string')).toBe(true);
      const ray = resolved[4] as { from: { x: number; y: number }; to: { x: number; y: number } };
      const x = resolved[5] as { at: { x: number; y: number } };
      const cross = (ray.to.x - ray.from.x) * (x.at.y - ray.from.y) - (ray.to.y - ray.from.y) * (x.at.x - ray.from.x);
      expect(Math.abs(cross)).toBeLessThan(1e-3);
    }
  });
});

describe('parseTag agent: connector ends on page marks', () => {
  it('accepts p<N>:#mark and a line end #s2.a', () => {
    expect(parseTag('connect from=p4:#d3 to=side:X')).toEqual({ kind: 'connect', from: { page: 4, mark: '#d3' }, to: { region: 'side', ref: 'X' } });
    expect(parseTag('connect from=side:x to=p4:#s2.b')).toMatchObject({ to: { page: 4, mark: '#s2.b' } });
  });
  it('rejects malformed marks', () => {
    expect(parseTag('connect from=p4:#3 to=side:X')).toBeNull();
    expect(parseTag('connect from=p4:#d3.c to=side:X')).toBeNull();
  });
});

describe('parseTag: a key given twice', () => {
  it('is malformed on a drawing tag (never guess which value was meant)', () => {
    expect(parseTag('line on=s from=D to=C to=E')).toBeNull();
  });
  it('drops only the twice-defined name from a let, keeping the rest of the figure', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const a = parseTag('let on=s C=0,0 I=150,-100 H=1,1 H=2,2');
    expect(a && a.kind === 'let' && a.defs.map(([n]) => n)).toEqual(['C', 'I']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
