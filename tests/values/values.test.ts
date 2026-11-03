import { describe, expect, it } from 'vitest';
import { ScriptParser } from '../../src/script/parser';
import { parseTag } from '../../src/script/parseTag';
import { GateState, UNBOUND_TEXT } from '../../src/gate/engine';
import { sayNumber, saidText, spokenOf, intWords } from '../../src/values/say';
import { curveOf, read } from '../../src/values/readout';
import { SCRIPTS } from '../../src/demo/scripts';
import type { RawAction, ScriptEvent } from '../../src/script/types';

const run = (script: string, chunk = 0) => {
  const p = new ScriptParser();
  const ev: ScriptEvent[] = [];
  if (chunk) for (let i = 0; i < script.length; i += chunk) ev.push(...p.push(script.slice(i, i + chunk)));
  else ev.push(...p.push(script));
  ev.push(...p.end());
  return { words: ev.flatMap((e) => (e.type === 'word' ? [e.text] : [])), acts: ev.flatMap((e) => (e.type === 'action' ? [e.action] : [])), model: p.values };
};

describe('grammar', () => {
  it('parses val, find and the moves', () => {
    expect(parseTag('val id=t[3].price fmt=1')).toEqual({ kind: 'val', ref: 't[3].price', fmt: 1 });
    expect(parseTag('val id=r as=percent')).toEqual({ kind: 'val', ref: 'r', as: 'percent' });
    expect(parseTag('val id=E.x')).toEqual({ kind: 'val', ref: 'E.x' });
    expect(parseTag('val id=r as=money')).toBeNull();
    expect(parseTag('find id=E of=d,s')).toMatchObject({ kind: 'find', id: 'E', of: ['d', 's'], mode: 'cross' });
    expect(parseTag('find id=top of=h max')).toMatchObject({ mode: 'max' });
    expect(parseTag('find id=s of=h x=T/2 slope')).toMatchObject({ mode: 'slope', x: 'T/2' });
    expect(parseTag('find id=r of=h level=0 n=2')).toMatchObject({ mode: 'level', level: '0', n: 2 });
    expect(parseTag('find id=a of=h,g area from=0 to=3')).toMatchObject({ mode: 'area', of: ['h', 'g'] });
    expect(parseTag('find id=n of=f inside=2')).toMatchObject({ mode: 'inside', w: 2 });
    expect(parseTag('find id=e of=f residual=3')).toMatchObject({ mode: 'residual', point: 3 });
    expect(parseTag('find id=x of=h')).toBeNull();
    expect(parseTag('contrast of=p k=3 "steeper"')).toEqual({ kind: 'contrast', ref: 'p', set: ['k', '3'], text: 'steeper' });
    expect(parseTag('limit of=p k=0 dur=4 show=E')).toEqual({ kind: 'limit', ref: 'p', set: ['k', '0'], dur: 4, show: 'E' });
    expect(parseTag('beforeafter of=p rate=r/2')).toEqual({ kind: 'beforeafter', ref: 'p', set: ['rate', 'r/2'] });
    expect(parseTag('limit of=p k=0 m=2')).toBeNull(); // one input at a time
  });
});

describe('say', () => {
  const said = (v: number, f?: Parameters<typeof sayNumber>[1]) => saidText(sayNumber(v, f)!);
  const spoken = (v: number, f?: Parameters<typeof sayNumber>[1]) => spokenOf(sayNumber(v, f)!);
  it('formats like the board and speaks it', () => {
    expect(said(133.333)).toBe('133.3');
    expect(spoken(133.333)).toBe('one hundred thirty-three point three');
    expect(said(0.583, { as: 'percent' })).toBe('58%');
    expect(said(0.0583, { as: 'percent' })).toBe('5.8%');
    expect(said(-12, { as: 'abs' })).toBe('12');
    expect(spoken(-2.5)).toBe('minus two point five');
    expect(said(7.25, { fmt: 0 })).toBe('7');
    expect(spokenOf({ num: '1,250', pre: '', post: '%' })).toBe('one thousand two hundred fifty percent');
    expect(intWords(21000)).toBe('twenty-one thousand');
    expect(sayNumber(NaN)).toBeNull();
  });
});

describe('bound numbers in the parser', () => {
  it('says the engine value, glued to the text that touches it', () => {
    const r = run('Prices {{bars on=s id=p vals=2,4.5,7}} rise to ${{val id=p[2]}}. The total {{calc on=s id=tot of=p reduce=sum}} is {{val id=tot}}.');
    expect(r.words).toContain('$4.5.');
    const v = r.acts.find((a) => a.kind === 'val') as Extract<RawAction, { kind: 'val' }>;
    expect(v).toMatchObject({ said: '4.5', spoken: 'four point five' });
  });
  it('is chunk-independent', () => {
    const s = '{{const v=20 g=9.8 T=2*v/g}} The flight lasts {{val id=T}}s, about {{val id=v as=percent}} more.';
    for (const n of [1, 2, 3, 7]) expect(run(s, n).words).toEqual(run(s).words);
    expect(run(s).words).toContain('4.08s,');
  });
  it('a word touching a tag on its left glues to its val however the stream is cut (it waited apart when the tag was still streaming)', () => {
    const s = 'Prices {{bars on=s id=p vals=2,4.5,7}} rise to ${{val id=p[2]}} and (${{val id=p[3]}}).';
    for (const n of [1, 2, 3, 5, 7]) expect(run(s, n).words, `chunk ${n}`).toEqual(['Prices', 'rise', 'to', '$4.5', 'and', '($7).']);
  });
  it('an unknown reference shows the neutral dash, with no said text', () => {
    const r = run('It costs {{val id=nope}} dollars.');
    expect(r.words).toEqual(['It', 'costs', UNBOUND_TEXT, 'dollars.']);
    expect(r.acts[0]).toEqual({ kind: 'val', ref: 'nope' });
  });
  it('a block with several values needs a part; table rows by column letter or header', () => {
    const m = new GateState();
    m.apply(parseTag('table on=s id=t cols=x,price vals=1,10;2,12')!, 0);
    expect(m.value('t')).toMatch(/name one/);
    expect(m.value('t[2].price')).toEqual({ v: 12, dp: undefined });
    expect(m.value('t[2].b')).toEqual({ v: 12, dp: undefined });
    expect(m.value('t[2,1]')).toEqual({ v: 2, dp: undefined });
    expect(m.value('t[2]')).toMatch(/name a column/);
  });
  it('follows set: a later val says the new value', () => {
    const r = run('{{bars on=s id=a vals=1,2}} {{bars on=s id=d map=a fn="x*10"}} first {{val id=d[2]}} {{set id=a vals=1,5}} then {{val id=d[2]}}');
    expect(r.words).toEqual(['first', '20', 'then', '50']);
  });
});

describe('readouts', () => {
  const m = new GateState();
  for (const t of ['const tax=0 v=20 g=9.8', 'plot on=s id=d fn="12-x/5" domain=0,50', 'plot on=s id=su fn="2+tax+x/10" domain=0,50 axes=d',
    'plot on=s id=h x="v*t" y="v*t-g*t^2/2" t=0,2*v/g', 'plot on=s id=q fn="x^2-4" domain=-3,3']) m.apply(parseTag(t)!, 0);
  const at = (t: string) => { const a = parseTag(t) as Extract<RawAction, { kind: 'find' }>; m.apply(a, 0); return m.reading(a.id); };
  it('crossings, levels, extrema, values, slopes, areas', () => {
    expect(at('find id=E of=d,su')).toMatchObject({ x: expect.closeTo(100 / 3, 6), y: expect.closeTo(12 - 20 / 3, 6) });
    expect(at('find id=r1 of=q level=0 n=2')).toMatchObject({ x: expect.closeTo(2, 6) });
    expect(at('find id=lo of=q min')).toMatchObject({ x: expect.closeTo(0, 4), v: expect.closeTo(-4, 6) });
    expect(at('find id=y1 of=q x=1')).toMatchObject({ v: -3 });
    expect(at('find id=s1 of=q x=1 slope')).toMatchObject({ v: expect.closeTo(2, 4) });
    expect(at('find id=A of=q area from=-2 to=2')).toMatchObject({ v: expect.closeTo(16 / 3 - 16, 6) });
    // A parametric path: its top is v²/2g.
    expect(at('find id=top of=h max')).toMatchObject({ y: expect.closeTo(400 / 19.6, 2) });
    expect(at('find id=no of=q level=10')).toMatch(/no crossing/);
  });
  it('fits: inliers and residuals', () => {
    m.apply(parseTag('scatter on=r id=p pts=1,1 2,2 3,3 4,8')!, 0);
    m.apply(parseTag('fit on=r id=f of=p pick=1,2')!, 0);
    expect(at('find id=n of=f inside=0.5')).toMatchObject({ v: 3 });
    expect(at('find id=e4 of=f residual=4')).toMatchObject({ v: expect.closeTo(4 / Math.SQRT2, 6) });
  });
  it('the board and the model read one curve', () => {
    const c = curveOf({ fn: 'x^2-4', domain: [-3, 3] }, {})!;
    expect(read({ kind: 'find', id: 'z', of: ['q'], mode: 'level', level: '0' }, () => c, () => undefined, {})).toMatchObject({ x: expect.closeTo(-2, 6) });
  });
  it('a val of a readout follows a beforeafter', () => {
    const r = run('{{const tax=0}} {{plot on=s id=d fn="12-x/5" domain=0,50}} {{plot on=s id=su fn="2+tax+x/10" domain=0,50 axes=d}} {{find id=E of=d,su}} at {{val id=E}} {{beforeafter of=su tax=1.5}} now {{val id=E}}');
    expect(r.words).toEqual(['at', '5.33', 'now', '6.33']);
  });
});

describe('moves', () => {
  it('contrast expands into a copy with one constant changed: a plot on the same axes, a block beside', () => {
    const r = run('{{const k=2}} {{plot on=s id=p fn="k*x" domain=0,3 "k = 2"}} {{contrast of=p k=4}} {{bars on=s id=b size=1x3 fn="k*c"}} {{contrast of=b k=1 id=b1 "k = 1"}} {{val id=b1[3]}}');
    const plots = r.acts.filter((a) => a.kind === 'plot');
    expect(plots[1]).toMatchObject({ id: 'p_2', axes: 'p', with: { k: 4 }, label: 'k = 4', dash: true });
    const b1 = r.acts.find((a) => (a as { id?: string }).id === 'b1');
    expect(b1).toMatchObject({ kind: 'bars', right: 'b', with: { k: 1 }, caption: 'k = 1' });
    expect(r.words).toEqual(['3']);
  });
  it('contrast of something with no such constant is left for the director to skip', () => {
    const r = run('{{plot on=s id=p fn="2*x" domain=0,3}} {{contrast of=p k=4}}');
    expect(r.acts[1]).toMatchObject({ kind: 'contrast' });
  });
  it('limit lands the constant on its value (the val after it says the end state)', () => {
    const r = run('{{const k=1}} {{plot on=s id=v fn="9.8/k*(1-exp(-k*x))" domain=0,6}} {{find id=e of=v x=6}} {{val id=e}} {{limit of=v k=0.05}} {{val id=e}}');
    expect(r.words[0]).toBe('9.78');
    expect(Number(r.words[1])).toBeCloseTo((9.8 / 0.05) * (1 - Math.exp(-0.3)), 0);
  });
  it('the moves demo binds every number', () => {
    const r = run(SCRIPTS.moves.script);
    expect(r.words).not.toContain(UNBOUND_TEXT);
    expect(r.acts.filter((a) => a.kind === 'contrast')).toEqual([]);
    expect(r.words.join(' ')).toMatch(/price of 5\.33, with 33 units/);
  });
});
