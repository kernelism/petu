import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { meaningfulUnit, isBullet } from '../../src/locate/unit';
import { locateQuote, type TextRun } from '../../src/locate/locateQuote';
import { getTextRuns } from '../../src/pdf/textRuns';

const run = (text: string, x: number, y: number, w: number, h = 20): TextRun => ({ text, rect: { x, y, w, h } });

/** Every piece must resolve exactly where the unit put it (the toolkit locates each one again). */
function resolvable(runs: TextRun[], aspect: number, u: NonNullable<ReturnType<typeof meaningfulUnit>>) {
  for (const p of u.pieces) {
    const r = locateQuote(runs, p.quote, p.near, { aspect });
    expect(r, p.quote).toHaveLength(1);
    expect(Math.abs(r[0].y + r[0].h / 2 - p.near.y)).toBeLessThan(2);
  }
}

describe('meaningfulUnit (synthetic paragraphs)', () => {
  const para: TextRun[] = [
    run('Hypothesis tests', 50, 40, 300, 34),
    run('We reject the null when the statistic is extreme. To decide, compare the', 50, 100, 880),
    run('p-value and the significance level alpha. A small p-value is evidence', 50, 128, 860),
    run('against the null.', 50, 156, 200),
    run('- A second bullet that stands alone', 50, 220, 500),
  ];

  it('grows a fragment to its sentence, across lines, with an inner emphasis', () => {
    const u = meaningfulUnit(para, 'compare the p-value and')!;
    expect(u.kind).toBe('sentence');
    expect(u.text).toBe('to decide, compare the pvalue and the significance level alpha.');
    expect(u.pieces).toHaveLength(2);
    expect(u.inner?.quote).toBe('compare the p-value and');
    resolvable(para, 1, u);
  });

  it('keeps a symbol or a short term as quoted', () => {
    expect(meaningfulUnit(para, 'alpha')).toBeNull();
    expect(meaningfulUnit(para, 'significance level')).toBeNull();
  });

  it('a quote that is already the sentence stays as it is', () => {
    expect(meaningfulUnit(para, 'We reject the null when the statistic is extreme.')).toBeNull();
  });

  it('does not run into the title above or the next bullet below', () => {
    const u = meaningfulUnit(para, 'is evidence against')!;
    expect(u.text).toBe('a small pvalue is evidence against the null.');
    const b = meaningfulUnit(para, 'second bullet that')!;
    expect(b.text).toBe('a second bullet that stands alone');
  });

  it('does not end a sentence at an abbreviation', () => {
    const r = [run('Use a robust loss, e.g. Huber or Cauchy, when outliers are common in the data.', 50, 100, 880)];
    expect(meaningfulUnit(r, 'Huber or Cauchy')!.text).toBe('use a robust loss, e.g. huber or cauchy, when outliers are common in the data.');
  });

  it('falls back to the hit\'s whole lines when the sentence is very long', () => {
    const long = Array.from({ length: 6 }, (_, i) => run(`clause number ${i} of a sentence that keeps going and going without a stop`, 50, 100 + 28 * i, 880));
    const u = meaningfulUnit(long, 'number 3 of a')!;
    expect(u.kind).toBe('line');
    expect(u.pieces).toHaveLength(1);
    expect(u.text).toBe('clause number 3 of a sentence that keeps going and going without a stop');
  });

  it('recognises bullets', () => {
    expect(isBullet('- Other things equal')).toBe(true);
    expect(isBullet('• point')).toBe(true);
    expect(isBullet('2) second')).toBe(true);
    expect(isBullet('e.g. this')).toBe(false);
    expect(isBullet('Velocity is')).toBe(false);
  });
});

describe('meaningfulUnit (fixture PDFs, the same runs the viewer reads)', () => {
  const pages = new Map<string, { runs: TextRun[]; aspect: number }>();
  beforeAll(async () => {
    for (const [name, p] of [['econ', 2], ['epipolar', 3], ['mechanics', 2], ['mechanics', 3]] as const) {
      const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(`public/fixtures/${name}.pdf`)), verbosity: 0, isEvalSupported: false, fontExtraProperties: true }).promise;
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      pages.set(`${name}${p}`, { runs: await getTextRuns(page as never), aspect: vp.height / vp.width });
    }
  });
  const unit = (key: string, q: string) => { const { runs, aspect } = pages.get(key)!; return meaningfulUnit(runs, q, undefined, { aspect }); };

  it('econ p2: a fragment of a wrapped bullet marks the whole bullet, not the figure label between its lines', () => {
    const u = unit('econ2', 'a higher price')!;
    expect(u.text).toBe('other things equal, a higher price means a lower quantity demanded');
    expect(u.pieces).toHaveLength(2);
    expect(u.inner).not.toBeNull();
    resolvable(pages.get('econ2')!.runs, pages.get('econ2')!.aspect, u);
  });

  it('epipolar p3: a fragment of a bullet line marks the bullet', () => {
    const u = unit('epipolar3', 'the search becomes')!;
    expect(u.text).toMatch(/^so the match x' must lie on l', and the search becomes 1d$/);
    resolvable(pages.get('epipolar3')!.runs, pages.get('epipolar3')!.aspect, u);
    expect(unit('epipolar3', 'epipolar line')).toBeNull(); // a term
  });

  it('mechanics p2: a fragment of a two-line sentence marks the sentence', () => {
    const u = unit('mechanics2', 'tends to the tangent')!;
    expect(u.text).toBe('the secant tends to the tangent as the interval shrinks.');
    expect(u.pieces).toHaveLength(2);
  });

  it('mechanics p3: an equation part marks the whole equation line', () => {
    const u = unit('mechanics3', '2a(x – x0)');
    // "2a(x – x0)" → 3 words: the equation line, as the listing shows it
    expect(u?.kind).toBe('equation');
    expect(u!.text.replace(/ /g, '')).toContain('v=v0+2a(xx0)'.replace(/ /g, ''));
  });
});
