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
  it('notes an unknown tag name and an unclosed quote, and changes nothing', () => {
    const s = 'A {{wiggle p=1}} B {{highlight p=1 "open}} C {{ point on=s at=1,1 "P"}}';
    const { out, notes } = run(s);
    expect(out).toBe(s);
    expect(notes).toEqual(['unknown tag "{{wiggle p=1}}"', 'unclosed quote in "{{highlight p=1 \\"open}}"', 'malformed (dropped): {{highlight p=1 "open}}']);
  });
  it('notes a malformed tag with its raw text, a hand-placed curve and a duplicated drawing; changes nothing', () => {
    const s = 'A {{grid on=s id=g vals=1,2;3}} B {{curve on=s pts=O A B C L}} C {{arrow on=s from=O to=A}} D {{arrow on=s from=O to=A em}} E {{arrow on=s from=O to=B}}';
    const { out, notes } = run(s);
    expect(out).toBe(s);
    expect(notes[0]).toBe('malformed (dropped): {{grid on=s id=g vals=1,2;3}}');
    expect(notes[1]).toMatch(/^hand-placed curve \(5 points\)/);
    expect(notes[2]).toMatch(/^duplicate drawing/);
    expect(notes).toHaveLength(3);
  });
  it('gives identical results when the input is split at every offset', () => {
    const s = circles(4) + '{{sketch id=a near=p1}}{{bogus}} {{math on=a at=1,1 "\\frac{a}{b}" em}} {x} done';
    const whole = run(s);
    for (let i = 0; i <= s.length; i++) expect(run(s, [i]), String(i)).toEqual(whole);
    for (let i = 0; i < s.length; i += 3) expect(run(s, [i, i + 1, i + 2])).toEqual(whole);
  });
});
