// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { Lint, MAX_DRAW, MAX_EM, MAX_SKETCH } from '../../server/lint';

const run = (s: string, cuts: number[] = []) => {
  const l = new Lint();
  let out = '', prev = 0;
  for (const c of [...cuts, s.length]) { out += l.push(s.slice(prev, c)); prev = c; }
  return { out: out + l.end(), notes: l.notes };
};

const circles = (n: number) => Array.from({ length: n }, (_, i) => `Look ${i}. {{circle p=1 at=${i},${i}}} `).join('');

describe('Lint', () => {
  it('passes text outside tags through untouched', () => {
    const s = 'Plain { braces } and a single } and {x} and newline\n stays. {{scroll p=2}} end.';
    expect(run(s).out).toBe(s);
    expect(run(s).notes).toEqual([]);
  });
  it(`drops drawing #${MAX_DRAW + 1} with its tag text only; the narration stays`, () => {
    const s = circles(MAX_DRAW + 1);
    const { out, notes } = run(s);
    expect(out).toBe(circles(MAX_DRAW) + `Look ${MAX_DRAW}.  `);
    expect(notes).toEqual([`dropped drawing #${MAX_DRAW + 1}`]);
  });
  it(`removes the em flag from em #${MAX_EM + 1}`, () => {
    const s = Array.from({ length: MAX_EM + 1 }, (_, i) => `{{circle p=1 at=${i},1 em}} `).join('');
    const { out, notes } = run(s);
    expect(out.match(/ em\}\}/g)).toHaveLength(MAX_EM);
    expect(out).toContain(`{{circle p=1 at=${MAX_EM},1}}`);
    expect(notes).toEqual(['removed extra em']);
  });
  it(`drops sketch #${MAX_SKETCH + 1}`, () => {
    const s = '{{sketch id=a near=p1}} one {{sketch id=b near=p1}} two {{sketch id=c near=p1}} three';
    const { out, notes } = run(s);
    expect(out).toBe('{{sketch id=a near=p1}} one {{sketch id=b near=p1}} two  three');
    expect(notes).toEqual(['dropped extra sketch']);
  });
  it('gives identical results when the input is split at every offset', () => {
    const s = circles(MAX_DRAW + 2) + '{{sketch id=a near=p1}}{{sketch id=b near=p1}}{{sketch id=c near=p1}} {{math on=a at=1,1 "\\frac{a}{b}" em}} {x} done';
    const whole = run(s);
    for (let i = 0; i <= s.length; i++) expect(run(s, [i]), String(i)).toEqual(whole);
    for (let i = 0; i < s.length; i += 3) expect(run(s, [i, i + 1, i + 2])).toEqual(whole);
  });
});
