// Tokens (design 3.6): a count drawn as that many marks with states. `set id=k[7:8] state=tax` (or
// `n=` how many) moves marks to another state's cluster; the counts are readouts (k.tax), never typed.
import { describe, expect, it } from 'vitest';
import { parseTag } from '../../src/script/parseTag';
import { GateState } from '../../src/gate/engine';
import { ScriptParser } from '../../src/script/parser';
import type { RawAction, ScriptEvent } from '../../src/script/types';

const said = (s: string) => {
  const p = new ScriptParser();
  const ev: ScriptEvent[] = [...p.push(s), ...p.end()];
  return ev.flatMap((e) => (e.type === 'word' ? [e.text] : [])).join(' ');
};

describe('tokens: grammar', () => {
  it('a count of marks with named states', () => {
    expect(parseTag('tokens on=s id=k n=8 states=seller,tax "coins"')).toMatchObject({ kind: 'tokens', region: 's', id: 'k', n: '8', states: ['seller', 'tax'], caption: 'coins' });
    expect(parseTag('tokens on=s id=k n=price')).toMatchObject({ kind: 'tokens', n: 'price', states: [] });
    expect(parseTag('tokens on=s id=k states=a,b')).toBeNull(); // no count
    expect(parseTag('tokens on=s id=k n=3 states=a,a')).toBeNull();
  });
  it('set … state= moves the named marks, or n= of them', () => {
    expect(parseTag('set id=k[7:8] state=tax')).toEqual({ kind: 'set', ref: 'k[7:8]', state: 'tax' });
    expect(parseTag('set id=k state=tax n=t')).toEqual({ kind: 'set', ref: 'k', state: 'tax', count: 't' });
    expect(parseTag('set id=k state=tax to=3')).toBeNull();
  });
});

describe('tokens: the value model', () => {
  const g0 = (tags: string[]) => { const g = new GateState(); return { g, errs: tags.map((t) => g.apply(parseTag(t) as RawAction, 0)) }; };
  it('counts per state are readouts', () => {
    const { g, errs } = g0(['const t=2', 'tokens on=s id=k n=8 states=seller,tax', 'set id=k state=tax n=t']);
    expect(errs).toEqual([undefined, undefined, undefined]);
    expect(g.value('k')).toMatchObject({ v: 8 });
    expect(g.value('k.seller')).toMatchObject({ v: 6 });
    expect(g.value('k.tax')).toMatchObject({ v: 2 });
    expect(g.apply(parseTag('set id=k[1:3] state=tax') as RawAction, 1)).toBeUndefined();
    expect(g.value('k.tax')).toMatchObject({ v: 5 });
  });
  it('skips what it cannot do, with a reason', () => {
    const { g } = g0(['tokens on=s id=k n=4 states=a,b']);
    expect(g.apply(parseTag('set id=k state=c n=1') as RawAction, 1)).toMatch(/no state c/);
    expect(g.apply(parseTag('set id=k state=b n=9') as RawAction, 1)).toMatch(/only 4 marks/);
    expect(g.value('k.z')).toMatch(/no state z/);
    expect(g0(['tokens on=s id=k n=1000']).errs[0]).toMatch(/more than/);
    expect(g0(['tokens on=s id=k n=2.5']).errs[0]).toMatch(/whole count/);
  });
  it('the narration says the engine counts', () => {
    expect(said('{{const t=2}} {{tokens on=s id=k n=8 states=seller,tax "coins"}} Eight coins paid; {{set id=k state=tax n=t}} the seller keeps {{val id=k.seller}} and {{val id=k.tax}} go to tax.')).toContain('seller keeps 6 and 2 go to tax.');
  });
});
