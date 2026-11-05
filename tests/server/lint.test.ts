// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { Lint } from '../../server/lint';

const run = (s: string, cuts: number[] = []) => {
  const l = new Lint();
  let out = '', prev = 0;
  for (const c of [...cuts, s.length]) { out += l.push(s.slice(prev, c)); prev = c; }
  return { out: out + l.end(), notes: l.notes };
};

const circles = (n: number) => Array.from({ length: n }, (_, i) => `Look ${i}. {{circle p=1 at=${i},${i} r=30 em}} `).join('');

describe('Lint (grammar checks only)', () => {
  it('passes text outside tags through untouched', () => {
    const s = 'Plain { braces } and a single } and {x} and newline\n stays. {{scroll p=2}} end.';
    expect(run(s).out).toBe(s);
    expect(run(s).notes).toEqual([]);
  });
  it('has no style caps: many drawings, accents and sketches pass untouched', () => {
    const s = circles(30) + '{{sketch id=a near=p1}} {{sketch id=b near=p2}} {{sketch id=c near=p3}} {{sketch id=d near=p4 size=l}}';
    expect(run(s)).toEqual({ out: s, notes: [] });
  });
  it('knows the amount, count and distribution moves (tokens, stacked and split bars, histograms)', () => {
    const s = '{{sketch id=k near=p1}} {{tokens on=k id=c n=8 states=seller,tax "coins"}} A {{set id=c state=tax n=2}} B {{set id=c[7:8] state=seller}} C ' +
      '{{bars on=k id=b vals=100;90,20 labels=before,after parts=room,tax stack}} D {{split id=b[1] vals=30 "kept" "tax"}} E {{bars on=k id=h hist=b bins=4}} F';
    expect(run(s)).toEqual({ out: s, notes: [] });
  });
  it('notes an unknown tag name and an unclosed quote, and changes nothing', () => {
    const s = 'A {{wiggle p=1}} B {{highlight p=1 "open}} C {{ point on=s at=1,1 "P"}}';
    const { out, notes } = run(s);
    expect(out).toBe(s);
    expect(notes).toEqual(['unknown tag "{{wiggle p=1}}"', 'unclosed quote in "{{highlight p=1 \\"open}}"', 'malformed (dropped): {{highlight p=1 "open}}']);
  });
  it('notes a malformed tag with its raw text; tag-board style (hand curves, a drawing made twice) is not linted; changes nothing', () => {
    const s = 'A {{grid on=s id=g vals=1,2;3}} B {{curve on=s pts=O A B C L}} C {{arrow on=s from=O to=A}} D {{arrow on=s from=O to=A em}} E {{fade id=s}}';
    const { out, notes } = run(s);
    expect(out).toBe(s);
    expect(notes).toEqual(['malformed (dropped): {{grid on=s id=g vals=1,2;3}}']);
  });
  it('gives identical results when the input is split at every offset', () => {
    const s = circles(4) + '{{sketch id=a near=p1}}{{bogus}} {{math on=a at=1,1 "\\frac{a}{b}" em}} {x} done';
    const whole = run(s);
    for (let i = 0; i <= s.length; i++) expect(run(s, [i]), String(i)).toEqual(whole);
    for (let i = 0; i < s.length; i += 3) expect(run(s, [i, i + 1, i + 2])).toEqual(whole);
  });
});

describe('Lint: what to write instead, for slips the engine cannot recover', () => {
  it('a tag over 800 characters: a hand curve should be a plot', () => {
    const pts = Array.from({ length: 90 }, (_, i) => `${(i / 20).toFixed(6)},-1.0001`).join(' ');
    const { notes } = run(`The period {{curve on=pend pts=${pts} em}} grows.`);
    expect(notes).toEqual([expect.stringMatching(/^tag over 800 characters \(spoken as words, not drawn\): \{\{curve .* — draw a curve from its formula with \{\{plot fn=\}\}$/)]);
  });
  it('a recovered slip is not noted (arc is read as an angle)', () => {
    expect(run('{{sketch id=p}} {{arc on=p center=P from=D to=B}}').notes).toEqual([]);
  });
  it('a calc program on the wire is one long tag, not words', () => {
    const code = `const r = [${Array.from({ length: 120 }, (_, i) => i).join(', ')}];&#10;export const s = r.reduce((a, b) =&gt; a + b, 0);`;
    const s = `Sum. {{calcsrc id=t ${code}}} Then {{val t.s}}.`;
    expect(run(s).notes.filter((n) => /over 800/.test(n))).toEqual([]);
  });
});
