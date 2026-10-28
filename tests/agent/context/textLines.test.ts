import { describe, it, expect } from 'vitest';
import { textLines } from '../../../src/agent/context/textLines';
import type { TextRun } from '../../../src/locate/locateQuote';

const run = (text: string, x: number, y: number, w: number, h = 20): TextRun => ({ text, rect: { x, y, w, h } });
// Glyph-per-run equation, advancing 12 units per glyph (h 20 → hX 20 at aspect 1).
const glyphs = (s: string, x0: number, y: number) => Array.from(s).map((c, i) => run(c, x0 + i * 12, y, 10));

describe('textLines', () => {
  it('orders glyph runs on one baseline by x', () => {
    const g = glyphs('x−x′=B', 100, 300);
    const shuffled = [g[3], g[0], g[5], g[1], g[4], g[2]];
    const ls = textLines(shuffled, 1);
    expect(ls).toHaveLength(1);
    expect(ls[0].text).toBe('x−x′=B');
  });

  it('joins a subscript run (smaller, lower) to its line', () => {
    const ls = textLines([run('λ', 100, 300, 10), run('1', 110, 312, 6, 12), run('λ', 116, 300, 10), run('2', 126, 312, 6, 12)], 1);
    expect(ls).toHaveLength(1);
    expect(ls[0].text).toBe('λ1λ2');
  });

  it('lists superscripts (smaller, raised by baseline) as ^(...): lec05 p8 "2^(64×64) ∼ 10^(400)"', () => {
    // The runs pdf.js gives for that line (model units): base glyphs h 52, exponents h 37 raised ~22.
    const ls = textLines([
      run('2', 395, 401, 13, 52), run('64', 408, 394, 21, 37), run('×', 429, 394, 16, 37), run('64', 446, 394, 21, 37),
      run('∼', 475, 401, 20, 52), run('10', 503, 401, 26, 52), run('400', 529, 394, 31, 37),
    ], 9 / 16);
    expect(ls).toHaveLength(1);
    expect(ls[0].text).toBe('2^(64×64) ∼ 10^(400)');
  });

  it('a one-character exponent needs no parentheses; a word line with one keeps its words', () => {
    const ls = textLines([run('atoms in the known universe: 10', 280, 457, 375, 52), run('80', 655, 450, 21, 37)], 9 / 16);
    expect(ls[0].text).toBe('atoms in the known universe: 10^(80)');
    expect(textLines([run('σ', 100, 300, 10, 20), run('2', 111, 296, 6, 13)], 1)[0].text).toBe('σ^2');
  });

  it('a subscript or a smaller word on the same baseline is not a superscript', () => {
    expect(textLines([run('λ', 100, 300, 10), run('1', 110, 312, 6, 12)], 1)[0].text).toBe('λ1');
    // Same baseline (y + h = 320), smaller font: just a word.
    expect(textLines([run('Big', 100, 300, 40, 20), run('small', 146, 306, 40, 14)], 1)[0].text).toBe('Big small');
  });

  it('a sideways run (rotated axis label) is its own line and never merges into a band', () => {
    const ls = textLines([run('Error rate falls', 100, 300, 200), { ...run('Accuracy', 60, 200, 15, 200), vertical: true }], 1);
    expect(ls.map((l) => l.text)).toEqual(['Accuracy', 'Error rate falls']);
  });

  it('two-column pages read down the left column, then the right; full-width lines separate blocks', () => {
    const rows = 8;
    const runs: TextRun[] = [run('A Paper Title Across Both Columns', 100, 40, 800)];
    for (let i = 0; i < rows; i++) {
      runs.push(run(`left ${i} words here`, 60, 100 + i * 30, 420));
      runs.push(run(`right ${i} words here`, 520, 100 + i * 30, 420));
    }
    runs.push(run('Figure 1: a caption that spans the whole width', 60, 400, 880));
    for (let i = 0; i < rows; i++) {
      runs.push(run(`l2 ${i} more`, 60, 440 + i * 30, 420));
      runs.push(run(`r2 ${i} more`, 520, 440 + i * 30, 420));
    }
    const t = textLines(runs, 1.3).map((l) => l.text);
    expect(t[0]).toBe('A Paper Title Across Both Columns');
    expect(t.slice(1, 1 + rows)).toEqual(Array.from({ length: rows }, (_, i) => `left ${i} words here`));
    expect(t.slice(1 + rows, 1 + 2 * rows)).toEqual(Array.from({ length: rows }, (_, i) => `right ${i} words here`));
    expect(t[1 + 2 * rows]).toBe('Figure 1: a caption that spans the whole width');
    expect(t.slice(2 + 2 * rows, 2 + 3 * rows)).toEqual(Array.from({ length: rows }, (_, i) => `l2 ${i} more`));
    expect(t[t.length - 1]).toBe(`r2 ${rows - 1} more`);
  });

  it('a table (short cells on both sides of any gap) keeps row order', () => {
    const runs: TextRun[] = [];
    for (let i = 0; i < 8; i++) { runs.push(run(`name ${i}`, 170, 100 + i * 25, 90)); runs.push(run(`meta ${i}`, 352, 100 + i * 25, 120)); runs.push(run(`ref ${i}`, 600, 100 + i * 25, 150)); }
    expect(textLines(runs, 1.3).map((l) => l.text).slice(0, 3)).toEqual(['name 0', 'meta 0', 'ref 0']);
  });

  it('a slide with a short label beside its text keeps row order (no column split)', () => {
    const t = textLines([run('Title', 50, 50, 300), run('bullet one', 50, 150, 300), run('label', 700, 150, 80), run('bullet two', 50, 200, 300)], 0.5625).map((l) => l.text);
    expect(t).toEqual(['Title', 'bullet one', 'label', 'bullet two']);
  });

  it('splits two columns 300 units apart on one baseline', () => {
    const ls = textLines([run('Left column text', 50, 100, 200), run('Right column text', 550, 100, 200)], 1);
    expect(ls.map((l) => l.text)).toEqual(['Left column text', 'Right column text']);
  });

  it('inserts one space at a word gap and none between touching glyphs', () => {
    // hX = 20: a 0.3 em gap is 6 units.
    expect(textLines([run('depth', 100, 100, 50), run('map', 156, 100, 30)], 1)[0].text).toBe('depth map');
    expect(textLines([run('dep', 100, 100, 30), run('th', 130, 100, 20)], 1)[0].text).toBe('depth');
  });

  it('flags single-glyph equations as math, word lines not', () => {
    expect(textLines(glyphs('x−xʹ', 100, 300), 1)[0].math).toBe(true);
    expect(textLines([run('λ1 and λ2 are large', 100, 300, 200)], 1)[0].math).toBe(false);
  });

  it('numbers ids in reading order', () => {
    const ls = textLines([run('third', 50, 500, 60), run('first', 50, 100, 60), run('second', 400, 100, 60)], 1);
    expect(ls.map((l) => [l.id, l.text])).toEqual([['t1', 'first'], ['t2', 'second'], ['t3', 'third']]);
  });

  it('uses aspect to compare gaps in x units', () => {
    // On a portrait page (aspect 1.4) a run of h 20 is 28 x-units tall: a 30-unit gap stays one line.
    expect(textLines([run('a b', 100, 100, 30), run('c', 160, 100, 10)], 1.4)).toHaveLength(1);
    expect(textLines([run('a b', 100, 100, 30), run('c', 160, 100, 10)], 1)).toHaveLength(2);
  });
});
