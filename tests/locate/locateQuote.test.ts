import { describe, it, expect } from 'vitest';
import { locateQuote, type TextRun } from '../../src/locate/locateQuote';

const run = (text: string, x: number, y: number, w: number, h = 20): TextRun => ({ text, rect: { x, y, w, h } });

describe('locateQuote', () => {
  const runs: TextRun[] = [
    run('Given a point in one image, its match must', 50, 100, 600),
    run('lie on the epi-', 50, 130, 200),
    run('polar line in the other image.', 260, 130, 380),
    run('The ﬁrst constraint', 50, 160, 300),
  ];

  it('finds an exact single-line quote and returns a partial-width rect', () => {
    const r = locateQuote(runs, 'its match must');
    expect(r).toHaveLength(1);
    expect(r[0].y).toBe(100);
    expect(r[0].x).toBeGreaterThan(50);
    expect(r[0].x + r[0].w).toBeCloseTo(650, 0);
  });

  it('spans lines (one rect per line) and joins hyphenation', () => {
    const r = locateQuote(runs, 'must lie on the epipolar line');
    expect(r).toHaveLength(2);
    expect(r[0].y).toBe(100);
    expect(r[1].y).toBe(130);
  });

  it('normalizes ligatures, quotes, dashes and case', () => {
    expect(locateQuote(runs, 'the first constraint')).toHaveLength(1);
  });

  it('falls back to a fuzzy match', () => {
    expect(locateQuote(runs, 'its match should lie on the')).not.toHaveLength(0);
  });

  it('returns [] when nothing is close', () => {
    expect(locateQuote(runs, 'convolutional neural networks')).toEqual([]);
  });

  it('prefers whole-word matches and picks the occurrence nearest `near`', () => {
    const r2 = [run('next x here', 50, 100, 110), run('and x there', 50, 400, 110)];
    const top = locateQuote(r2, 'x');
    expect(top).toHaveLength(1);
    expect(top[0].y).toBe(100);
    expect(top[0].x).toBeGreaterThan(90); // the standalone "x", not the x inside "next"
    expect(locateQuote(r2, 'x', { x: 100, y: 410 })[0].y).toBe(400);
  });

  it('does not insert spaces between same-line runs that touch', () => {
    const split = [run('epi', 50, 100, 30), run('polar', 80, 100, 50)];
    expect(locateQuote(split, 'epipolar')).toHaveLength(1);
  });
  it('keeps a lone label whole when the next run in stream order sits to its left', () => {
    // lec09 p40: figure label "x" is followed in the content stream by a "z" far to its left.
    const runs = [run('x', 415, 436, 11, 44), run('z', 319, 414, 11, 58), run('x’', 589, 444, 16, 44)];
    const r = locateQuote(runs, 'x', { x: 420, y: 458 });
    expect(r).toHaveLength(1);
    expect(r[0].x).toBe(415);
  });
});
