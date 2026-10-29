// tests/script/forgive.test.ts — Task 1c: small grammar slips whose intent is unambiguous are
// recovered; ambiguous ones stay malformed (verbatim tags from the draw benchmark's evidence, C12/C4).
import { describe, it, expect } from 'vitest';
import { parseTag } from '../../src/script/parseTag';
import { ScriptParser } from '../../src/script/parser';
import type { RawAction } from '../../src/script/types';

const actions = (script: string): RawAction[] => {
  const p = new ScriptParser();
  return [...p.push(script), ...p.end()].flatMap((e) => (e.type === 'action' ? [e.action] : []));
};

describe('missing = after a known key (C12a)', () => {
  it('from=Ps to Pb: `to` is a key of line/arrow/brace and Pb a bare value', () => {
    expect(parseTag('line on=t from=Ps to Pb')).toEqual({ kind: 'line', region: 't', from: { ref: 'Ps' }, to: { ref: 'Pb' } });
    expect(parseTag('arrow on=t from=Ps to Pb em')).toEqual({ kind: 'arrow', region: 't', from: { ref: 'Ps' }, to: { ref: 'Pb' }, em: true });
    expect(parseTag('brace on=t from=Pb to P0 "1"')).toEqual({ kind: 'brace', region: 't', from: { ref: 'Pb' }, to: { ref: 'P0' }, text: '1' });
  });
  it('real flags stay flags', () => {
    expect(parseTag('sketch id=s near=p3 fit')).toMatchObject({ kind: 'sketch', id: 's', fit: true });
    expect(parseTag('shade on=s pts=A B C outline')).toMatchObject({ kind: 'shade', outline: true });
    expect(parseTag('arrow on=t from=A to=B em')).toMatchObject({ to: { ref: 'B' }, em: true });
    expect(parseTag('line on=t from=A to=B dash')).toMatchObject({ to: { ref: 'B' }, dash: true });
  });
  it('never when the key is given, the next token is a flag, a quote or key=value, or the word is no key of the tag', () => {
    expect(parseTag('line on=t from=A to em')).toBeNull();
    expect(parseTag('line on=t from=A to "B"')).toBeNull();
    expect(parseTag('line on=t from=A to id=B')).toBeNull();
    expect(parseTag('line on=t from=A to=B through C')).toBeNull(); // to= given: `through` is not taken as a key
    expect(parseTag('grid on=s id=a vals=1,2 shade')).toMatchObject({ kind: 'grid', shade: 'heat' }); // no point key of grid: a flag, as before
  });
});

describe('a point in parentheses (C12b)', () => {
  it('at=(0,-150) is the literal 0,-150', () => {
    expect(parseTag('math on=g at=(0,-150) "d^4 = 0.0625" size=m')).toMatchObject({ kind: 'math', region: 'g', at: { x: 0, y: -150 } });
    expect(parseTag('write on=g at=(0,0) "x0" size=m')).toMatchObject({ kind: 'write', at: { x: 0, y: 0 } });
    expect(parseTag('point p=3 at=(100,200)')).toMatchObject({ kind: 'point', page: 3, at: { x: 100, y: 200 } });
  });
  it('only one wrapping pair around a literal pair', () => {
    expect(parseTag('point on=s at=((1,2))')).toBeNull();
    expect(parseTag('point on=s at=(1,2,3)')).toBeNull();
  });
});

describe('connect end as a construction (C12f)', () => {
  it('to=w:mid(A,B) is a point of the section', () => {
    expect(parseTag('connect from=p5:"P* = 7, Q* = 25" to=w:mid(A,B)')).toEqual({
      kind: 'connect', from: { page: 5, quote: 'P* = 7, Q* = 25' }, to: { region: 'w', at: { fn: 'mid', args: [{ ref: 'A' }, { ref: 'B' }] } },
    });
  });
});

describe('plot axes= without domain= (C12c)', () => {
  it('inherits the host plot\'s domain', () => {
    const a = actions('{{sketch id=s}} {{plot on=s id=lin fn="x" domain=0,3.14 "θ"}} x {{plot on=s id=sn fn="sin(x)" axes=lin "sin θ (true)" label=top}} y');
    expect(a[2]).toMatchObject({ kind: 'plot', id: 'sn', axes: 'lin', domainSrc: ['0', '3.14'], domain: [0, 3.14], labelAt: 'top' });
  });
  it('a host with no domain of its own (unknown, or parametric) leaves it without one: the board skips it with a reason', () => {
    const a = actions('{{sketch id=s}} {{plot on=s id=sn fn="sin(x)" axes=nope}} y');
    expect(a[1]).toMatchObject({ kind: 'plot', axes: 'nope' });
    expect(a[1]).not.toHaveProperty('domainSrc');
  });
  it('without axes= a domain is still required', () => {
    expect(parseTag('plot on=s fn="sin(x)"')).toBeNull();
  });
});

describe('val … x= reads a plot at x, as find x= (C12h)', () => {
  it('val id=base.y x=0 says the plot\'s y at 0', () => {
    const p = new ScriptParser();
    const ev = [...p.push('{{const vmax=10 km=2}} {{sketch id=plot}} {{plot on=plot id=base fn="1/vmax+(km/vmax)*x" domain=-0.6,1 "no inhibitor"}} The intercept is {{val id=base.y x=0}} here.'), ...p.end()];
    const words = ev.flatMap((e) => (e.type === 'word' ? [e.text] : []));
    expect(words).toContain('0.1');
    const val = ev.find((e) => e.type === 'action' && e.action.kind === 'val');
    expect(val).toMatchObject({ action: { said: '0.1' } });
  });
  it('a bad x= is malformed', () => {
    expect(parseTag('val id=base.y x=0;1')).toBeNull();
  });
});

describe('vals=<block id> is map=<id> fn="x" (C4)', () => {
  it('a block id', () => {
    expect(parseTag('bars on=roots id=trace10 vals=means10 view=line below=means10 "n = 10"')).toMatchObject({ kind: 'bars', src: { map: 'means10', fn: 'x' }, view: 'line', below: 'means10', caption: 'n = 10' });
  });
  it('a constant\'s name is not a block: left to the constants path', () => {
    const a = actions('{{const a=30}} {{sketch id=p}} {{bars on=p id=angle vals=a labels="amplitude (degrees)"}} x');
    expect(a.some((x) => x.kind === 'bars' && 'map' in x.src)).toBe(false);
  });
  it('two columns stay malformed (a row or a stacked pair?)', () => {
    expect(parseTag('bars on=hotel id=burden vals=prices.guests,prices.hotel labels=guests,hotel below=prices')).toBeNull();
  });
});

describe('op= with literal vals= (C12d)', () => {
  it('shares op=normalize vals=… (shares normalise anyway)', () => {
    expect(parseTag('shares on=pop id=occ op=normalize vals=0.5,1,1 labels=free,S,I below=st')).toMatchObject({ kind: 'shares', src: { vals: [[0.5, 1, 1]] }, labels: ['free', 'S', 'I'], below: 'st' });
  });
  it('bars op=normalize vals=… is the normalised vector', () => {
    const b = parseTag('bars on=s id=p op=normalize vals=1,1,2') as { src: { vals: number[][] } };
    expect(b.src.vals[0]).toEqual([0.25, 0.25, 0.5]);
  });
  it('a two-block op (matmul) with vals= stays malformed', () => {
    expect(parseTag('grid on=s id=p op=matmul vals=1,2;3,4')).toBeNull();
  });
});

describe('arc → angle, only when it resolves exactly (C12e)', () => {
  it('arc center=P from=D to=B parses as an arc-angle (the resolver checks |PD| = |PB|)', () => {
    expect(parseTag('arc on=p center=P from=D to=B')).toEqual({ kind: 'angle', region: 'p', at: { ref: 'P' }, from: { ref: 'D' }, to: { ref: 'B' }, arc: true });
  });
});
