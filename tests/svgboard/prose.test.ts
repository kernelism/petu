// @vitest-environment jsdom
// Prose on the board (src/svgboard/prose.ts): a sentence, or lines of words stacked under each other,
// is removed before a group is checked or drawn; labels, numbers, titles and short stacks stay.
import { describe, expect, it } from 'vitest';
import { stripProse, wordCount, WORDS_LINE } from '../../src/svgboard/prose';
import { parseGroup, sanitizeGroup } from '../../src/svgboard/sanitize';
import { groupGeometry } from '../../src/svgboard/check';
import { SVG_EXAMPLES } from '../../server/prompt/svgExamples';
import { prepareText } from '../../src/svgboard/polish';

const parse = (src: string): Element => { const g = parseGroup(src); if (typeof g === 'string') throw new Error(g); return g; };
/** The script's top-level groups (a nested <g> or a self-closing one never ends the group early). */
const topGroups = (script: string): string[] => {
  const out: string[] = []; let buf = '', depth = 0;
  for (const line of script.split('\n')) {
    if (!depth && !/^<g\b/.test(line)) continue;
    buf += `${line}\n`;
    depth += (line.match(/<g\b/g) ?? []).length - (line.match(/<g\b[^>]*\/>/g) ?? []).length - (line.match(/<\/g>/g) ?? []).length;
    if (!depth) { out.push(buf.trim()); buf = ''; }
  }
  return out;
};
const texts = (g: Element) => Array.from(g.querySelectorAll('text')).map((t) => (t.textContent ?? '').replace(/\s+/g, ' ').trim());

// Verbatim from the founder's 2026-10-31 14:23 answer (Opus): the figure's labels, and four purple lines of a sentence beside it.
const OPUS_SMOOTH = `<g id="smooth"> <text x="20" y="262" font-size="16" fill="#888">average</text> <text x="20" y="280" font-size="16" fill="#888">then keep</text> <g stroke="#222" stroke-width="1.5" fill="#999"> <rect x="100" y="250" width="50" height="40"/><rect x="150" y="250" width="50" height="40"/><rect x="200" y="250" width="50" height="40"/><rect x="250" y="250" width="50" height="40"/> </g> <text x="200" y="312" font-size="16" text-anchor="middle" fill="#222">0.5 each: true gray</text> <text x="330" y="200" font-size="18" fill="#7c3aed">detail too fine</text> <text x="330" y="224" font-size="18" fill="#7c3aed">for the new grid</text> <text x="330" y="248" font-size="18" fill="#7c3aed">must be blurred away</text> <text x="330" y="272" font-size="18" fill="#7c3aed">before sampling</text> </g>`;
// Verbatim from the 14:21 answer (Terra): a one-line sentence in the accent colour under the figure.
const TERRA_SMOOTH = `<g id="smooth" data-const="a=1/4 b=1/2 c=3/4"> <text x="20" y="245" font-size="16" fill="#222">smoothed, then retained</text> <g id="averages" stroke="#222" stroke-width="1.5"> <rect x="100" y="257" width="48" height="40" fill="#ddd"/><rect x="148" y="257" width="48" height="40" fill="#888"/> </g> <g font-size="16" text-anchor="middle" fill="#222"><text x="124" y="282" data-val="a" data-fmt="0.00">{}</text><text x="172" y="282" data-val="c" data-fmt="0.00">{}</text></g> <text x="314" y="272" font-size="16" fill="#222">neighbor weights</text> <text x="314" y="294" font-size="16" fill="#222">¼, ½, ¼</text> <text x="20" y="334" font-size="18" fill="#7c3aed">Smooth first: weaken detail before it aliases.</text> </g>`;

describe('prose on the board', () => {
  it('counts words as runs of letters: numbers, units and symbols never count', () => {
    expect(wordCount('crossing: 150 s, not 120 s')).toBe(2);
    expect(wordCount('0.5 each: true gray')).toBe(3);
    expect(wordCount('¼, ½, ¼')).toBe(0);
    expect(wordCount('Smooth first: weaken detail before it aliases.')).toBe(WORDS_LINE);
  });

  it("removes the founder's four stacked lines and keeps the figure's labels", () => {
    const g = parse(OPUS_SMOOTH);
    const gone = stripProse(g);
    expect(gone).toEqual(['detail too fine', 'for the new grid', 'must be blurred away', 'before sampling']);
    expect(texts(g)).toEqual(['average', 'then keep', '0.5 each: true gray']);
    expect(g.querySelectorAll('rect').length).toBe(4);
  });

  it('removes a one-line sentence, keeps the labels, the numbers and a two-line stack', () => {
    const g = parse(TERRA_SMOOTH);
    expect(stripProse(g)).toEqual(['Smooth first: weaken detail before it aliases.']);
    expect(texts(g)).toEqual(['smoothed, then retained', '{}', '{}', 'neighbor weights', '¼, ½, ¼']);
  });

  it('keeps a title that is a sentence (the largest text, above every other) and a short stacked list', () => {
    const g = parse(`<g id="t"><text x="20" y="26" font-size="20">Why the ferry aims upstream and still lands late</text>
      <text x="28" y="98" font-size="16">0 min</text><text x="28" y="120" font-size="16">45 min</text><text x="28" y="142" font-size="16">90 min</text><text x="28" y="164" font-size="16">135 min</text>
      <text x="300" y="98" font-size="16">heading</text><text x="300" y="120" font-size="16">2.5 m/s</text><text x="300" y="142" font-size="16">across the river</text></g>`);
    expect(stripProse(g)).toEqual([]);
    expect(texts(g).length).toBe(8);
  });

  it('removes a sentence written as positioned tspans', () => {
    const g = parse(`<g id="s"><rect x="10" y="10" width="200" height="90" fill="none" stroke="#222"/><text x="20" y="30" font-size="16"><tspan x="20" dy="0">detail too fine for</tspan><tspan x="20" dy="20">the new grid must</tspan><tspan x="20" dy="20">be blurred away first</tspan></text><text x="20" y="130" font-size="16">kept label</text></g>`);
    expect(stripProse(g).length).toBe(1);
    expect(texts(g)).toEqual(['kept label']);
  });

  it("leaves every group of the prompt's own examples untouched", () => {
    for (const ex of SVG_EXAMPLES) {
      const groups = topGroups(ex.script);
      expect(groups.length, ex.title).toBeGreaterThan(2);
      for (const src of groups) {
        const g = parse(src);
        expect(stripProse(g), `${ex.title}: ${src.slice(0, 40)}`).toEqual([]);
      }
    }
  });

  it('the sanitizer notes what it removed, and the gate checks the same geometry', () => {
    const s = sanitizeGroup(OPUS_SMOOTH, { ns: 'b', palette: { accent: '#7c3aed', hue: null }, minFont: 16, w: 560, h: 330, ids: new Map(), prepare: (g) => prepareText(g, 16) });
    if (typeof s === 'string') throw new Error(s);
    expect(s.notes.filter((n) => n.startsWith('prose removed'))).toHaveLength(4);
    expect(texts(s.el)).toEqual(['average', 'then keep', '0.5 each: true gray']);
    expect(s.el.hasAttribute('data-prose-removed')).toBe(false);
    const geo = groupGeometry(OPUS_SMOOTH, 16);
    expect(geo.texts.map((t) => t.text)).toEqual(['average', 'then keep', '0.5 each: true gray']);
  });
});
