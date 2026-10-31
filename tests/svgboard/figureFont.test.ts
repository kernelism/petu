// @vitest-environment jsdom
// The board's text face (style.ts FONT_FIGURE): a figure's labels are set in the bundled serif, math
// faces stay the math font, and a model's app-chrome sans does not come through.
import { describe, it, expect } from 'vitest';
import { FONT_FIGURE, FONT_MATH, mapFont } from '../../src/svgboard/style';
import { sanitizeGroup } from '../../src/svgboard/sanitize';

describe('the figure face', () => {
  it('mapFont: math-ish faces → the math font; everything else (sans included) → the figure serif', () => {
    expect(mapFont('Times New Roman')).toBe(FONT_MATH);
    expect(mapFont('KaTeX_Math')).toBe(FONT_MATH);
    for (const f of ['Arial', 'Helvetica, sans-serif', 'system-ui', null]) expect(mapFont(f)).toBe(FONT_FIGURE);
    expect(FONT_FIGURE.startsWith('"Source Serif 4 Variable"')).toBe(true);
  });
  it('a label with no font of its own is set in it', () => {
    const r = sanitizeGroup('<g><text x="10" y="20">Demand</text><text x="10" y="60" font-family="Arial">Supply</text></g>', { ns: 'b', palette: { accent: '#7c3aed', hue: null }, minFont: 13, w: 1000, h: 700, ids: new Map(), doc: document });
    if (typeof r === 'string') throw new Error(r);
    expect(Array.from(r.el.querySelectorAll('text')).map((t) => t.getAttribute('font-family'))).toEqual([FONT_FIGURE, FONT_FIGURE]);
  });
});
