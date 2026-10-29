// Split / stacked amounts (design 3.5): one quantity as parts on one scale. `bars … stack` (rows of
// vals=, any lengths) draws each bar as the sum of its parts; `split id=v[i] vals=… "a" "b"` turns one
// bar into parts that sum to it; `set id=v[i,j] to=` changes one part and the total follows.
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

describe('stacked bars: grammar', () => {
  it('bars … stack: a row per bar, parts by position', () => {
    expect(parseTag('bars on=s id=bill vals=100;90,20 labels=before,after parts=room,tax stack "a night"')).toMatchObject({
      kind: 'bars', stack: { vals: [[100], [90, 20]] }, labels: ['before', 'after'], parts: ['room', 'tax'], caption: 'a night',
    });
  });
  it('rows of different lengths can only mean stacked bars (forgiven without the flag)', () => {
    expect(parseTag('bars on=s id=bill vals=100;90,20')).toMatchObject({ kind: 'bars', stack: { vals: [[100], [90, 20]] } });
    // Rectangular rows without the flag stay malformed (a bar chart is one row).
    expect(parseTag('bars on=s id=bill vals=1,2;3,4')).toBeNull();
    expect(parseTag('bars on=s id=bill vals=1,2;3,4 stack')).toMatchObject({ stack: { vals: [[1, 2], [3, 4]] } });
  });
  it('parts may be formulas over constants', () => {
    expect(parseTag('bars on=s id=pay vals=7;8-t,t stack')).toMatchObject({ stack: { vals: [[7], [NaN, NaN]], cells: [[null], ['8-t', 't']] } });
  });
  it('split: parts of one bar, labelled; one value fewer = the first part is what remains', () => {
    expect(parseTag('split id=pay[2] vals=8-t,t "seller" "tax"')).toEqual({ kind: 'splitBar', ref: 'pay[2]', vals: ['8-t', 't'], labels: ['seller', 'tax'] });
    expect(parseTag('split id=pay[2] vals=t "seller" "tax"')).toEqual({ kind: 'splitBar', ref: 'pay[2]', vals: ['t'], labels: ['seller', 'tax'] });
    expect(parseTag('split id=pay vals=max(a,b),2')).toMatchObject({ vals: ['max(a,b)', '2'] });
    expect(parseTag('split id=pay[2] vals=t')).toBeNull(); // one part is no split
    // Without vals= it is still the scene's split of a chip.
    expect(parseTag('split id=a "x" "y"')).toEqual({ kind: 'split', ref: 'a', items: ['x', 'y'] });
  });
});

describe('stacked bars: the value model', () => {
  const run = (tags: string[]) => {
    const g = new GateState();
    const errs = tags.map((t) => g.apply(parseTag(t) as RawAction, 0));
    return { g, errs };
  };
  it('a stacked bar is its total; [i,j] is a part', () => {
    const { g, errs } = run(['const t=2', 'bars on=s id=pay vals=7;8-t,t stack']);
    expect(errs).toEqual([undefined, undefined]);
    expect(g.value('pay[2]')).toMatchObject({ v: 8 });
    expect(g.value('pay[2,1]')).toMatchObject({ v: 6 });
    expect(g.value('pay[2,2]')).toMatchObject({ v: 2 });
  });
  it('split: parts must sum to the bar; the remainder form computes the first part', () => {
    const { g, errs } = run(['const t=2', 'bars on=s id=pay vals=7,8', 'split id=pay[2] vals=t "seller" "tax"']);
    expect(errs).toEqual([undefined, undefined, undefined]);
    expect(g.value('pay[2,1]')).toMatchObject({ v: 6 });
    expect(g.value('pay[2,2]')).toMatchObject({ v: 2 });
    expect(g.value('pay[2]')).toMatchObject({ v: 8 });
    expect(g.apply(parseTag('split id=pay[1] vals=5,1 "a" "b"') as RawAction, 1)).toMatch(/sum to 6, not 7/);
  });
  it('set on a part: the total follows', () => {
    const { g } = run(['bars on=s id=bill vals=100;90,20 stack', 'set id=bill[2,2] to=30']);
    expect(g.value('bill[2]')).toMatchObject({ v: 120 });
    expect(g.value('bill[2,2]')).toMatchObject({ v: 30 });
  });
  it('vals of the parts are said by the engine', () => {
    expect(said('{{const t=2}} {{bars on=s id=pay vals=8 labels=paid}} Eight paid, {{split id=pay[1] vals=t "seller" "tax"}} of which the seller keeps {{val id=pay[1,1]}} and {{val id=pay[1,2]}} is tax.')).toContain('seller keeps 6 and 2 is tax.');
  });
});
