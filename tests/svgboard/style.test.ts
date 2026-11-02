// @vitest-environment jsdom
// The takeaway keeps its accent at rest: the prompt asks for it in the accent colour (SVG_TEACH) and the
// examples colour it so; before, every chromatic hue settled to ink and the finished board had none
// (live eval q2:D18, D19, D20: 'Midpoint elasticity: −3.0 both ways' in #7c3aed rendered black).
import { describe, expect, it } from 'vitest';
import { mountBoard, drawGroup } from '../../src/svgboard/render';
import { sanitizeGroup } from '../../src/svgboard/sanitize';
import { prepareText } from '../../src/svgboard/polish';
import { applyGrammar, newTypeState, typeScale } from '../../src/svgboard/grammar';
import { INK, mapColor, type Palette } from '../../src/svgboard/style';

const pal = (): Palette => ({ accent: '#7c3aed', hue: null });

describe('mapColor: one accent at rest', () => {
  it("text and strokes in the answer's first hue are the accent; other hues ink; pale fills a wash of ink", () => {
    const p = pal();
    expect(mapColor('#7c3aed', 'text', p)!.color).toBe('#7c3aed');
    expect(mapColor('#6d28d9', 'stroke', p)!.color).toBe('#7c3aed');
    expect(mapColor('#2563eb', 'text', p)!.color).toBe(INK.ink);
    expect(mapColor('#2563eb', 'stroke', p)!.color).toBe(INK.ink);
    expect(mapColor('#222', 'text', p)!.color).toBe(INK.ink);
    expect(mapColor('#c4b5fd', 'fill', p)!.color).toBe(INK.muted);
    expect(mapColor('#7c3aed', 'fill', p)!.color).toBe(INK.ink2);
  });

  it('the first hue seen is the accent, whichever it is (the settings accent replaces it)', () => {
    const p = pal();
    expect(mapColor('#dc2626', 'stroke', p)!.color).toBe('#7c3aed');
    expect(mapColor('#7c3aed', 'text', p)!.color).toBe(INK.ink);
  });
});

describe('the takeaway on a drawn board', () => {
  it('an accent text keeps the accent after its group settles; a #222 text is ink', async () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    svg.appendChild(layer); document.body.appendChild(svg);
    const { board } = mountBoard(layer, { w: 1000, h: 700 }, 'b1', '#7c3aed');
    const st = newTypeState(typeScale(16, 1, 1000));
    const r = sanitizeGroup(`<g id="e"><text x="500" y="200" font-size="18" fill="#222">midpoint 15</text><g fill="#7c3aed"><text x="500" y="500" font-size="21">elasticity −3.0</text></g></g>`,
      { ns: 'b1', palette: board.palette, minFont: st.scale.small, w: 1000, h: 700, ids: board.ids, doc: document, prepare: (g) => prepareText(g, st.scale.small, applyGrammar(g, st)) });
    if (typeof r === 'string') throw new Error(r);
    // Drawn at once (an aborted signal lands the final state and settles the live part).
    const done = new AbortController(); done.abort();
    await drawGroup(board, r.el as SVGGElement, 'e', { color: '#7c3aed', signal: done.signal });
    const by = (s: string) => Array.from(board.root.querySelectorAll('text')).find((t) => t.textContent === s)!;
    expect(by('elasticity −3.0').hasAttribute('data-live')).toBe(false);
    expect(by('elasticity −3.0').getAttribute('fill')).toBe('#7c3aed');
    expect(by('midpoint 15').getAttribute('fill')).toBe(INK.ink);
  });
});
