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
