// @vitest-environment jsdom
// Text keeps to the room the model's drawing gives it (founder 2026-10-30, the lane: labels as tall as
// the boxes they label, sitting on the drawing's strokes and on each other). The grammar's sizes are a
// target: a text is raised toward it only as far as it stays clear of the strokes and texts it was
// clear of at the model's own size; never below the model's own size.
import { describe, expect, it } from 'vitest';
import { sanitizeGroup } from '../../src/svgboard/sanitize';
import { prepareText } from '../../src/svgboard/polish';
import { resolveData, newScope } from '../../src/svgboard/data';
import { applyGrammar, LEGIBLE_PX, newTypeState, RAISE_MAX, typeScale, type TypeState } from '../../src/svgboard/grammar';
import { core, groupGeometry, overlapArea, segHitsBox } from '../../src/svgboard/check';
import { inkBox } from '../../src/svgboard/grammar';

const run = (src: string, st: TypeState) => {
  const r = sanitizeGroup(src, { ns: 'b', palette: { accent: '#7c3aed', hue: null }, minFont: Math.min(st.scale.small, LEGIBLE_PX / 0.5), w: 1000, h: 720, ids: new Map(), doc: document,
    prepare: (g) => { resolveData(g, newScope()); prepareText(g, Math.min(st.scale.small, LEGIBLE_PX / 0.5), applyGrammar(g, st)); } });
  if (typeof r === 'string') throw new Error(r);
  return r.el;
};
/** Text-on-text and text-on-stroke collisions of a prepared group. */
const collisions = (g: Element) => {
  const geo = groupGeometry(g, 0);
  let n = 0;
  for (let i = 0; i < geo.texts.length; i++) {
    for (let j = i + 1; j < geo.texts.length; j++) if (overlapArea(inkBox(geo.texts[i]), inkBox(geo.texts[j])) > 0) n++;
    if (geo.segs.some((s) => !s.tiny && segHitsBox(s.a, s.b, core(geo.texts[i])))) n++;
  }
  return n;
};

// Synthetic, shaped like the founder's dense lane board (lec06): pairs of 60-unit cells with digits,
// a centred label under each pair 220 units apart, a value under that.
const DENSE = `<g id="dense">
  <text x="40" y="38" font-size="24">From one rule to the next</text>
  <text x="40" y="78" font-size="18">first row: three neighbouring pairs</text>
  <g fill="none" stroke="#222" stroke-width="2">
    <rect x="90" y="100" width="60" height="55"/><rect x="150" y="100" width="60" height="55"/>
    <rect x="310" y="100" width="60" height="55"/><rect x="370" y="100" width="60" height="55"/>
    <rect x="530" y="100" width="60" height="55"/><rect x="590" y="100" width="60" height="55"/>
  </g>
  <g font-size="21" text-anchor="middle">
    <text x="120" y="135">1</text><text x="180" y="135">2</text><text x="340" y="135">2</text>
    <text x="400" y="135">3</text><text x="560" y="135">3</text><text x="620" y="135">4</text>
  </g>
  <g font-size="17" text-anchor="middle">
    <text x="150" y="181">factors 0.5, 0.5</text><text x="370" y="181">factors 0.5, 0.5</text><text x="590" y="181">factors 0.5, 0.5</text>
  </g>
  <g font-size="19" text-anchor="middle"><text x="150" y="208">1.5</text><text x="370" y="208">2.5</text><text x="590" y="208">3.5</text></g>
  <text x="40" y="245" font-size="18">second row: the same pairs again</text>
</g>`;
// Labels beside small glyphs (the founder's lec07 board: "mark", "peak", "ridge" over their strokes).
const GLYPHS = `<g id="glyphs">
  <rect x="60" y="60" width="300" height="200" fill="none" stroke="#222"/>
  <text x="70" y="52" font-size="16">image A</text>
  <path d="M120 200 L140 160 L160 200" fill="none" stroke="#222"/><text x="125" y="222" font-size="14">peak</text>
  <path d="M220 200 L260 180 L300 200" fill="none" stroke="#222"/><text x="240" y="222" font-size="14">ridge</text>
  <circle cx="200" cy="110" r="10" fill="none" stroke="#222"/><text x="215" y="114" font-size="14">mark</text>
</g>`;
const SPARSE = `<g id="sparse"><circle cx="300" cy="300" r="80" fill="none" stroke="#222"/><text x="420" y="300" font-size="16">one label</text></g>`;

// The lane at 1440: ~500 px for 1000 units; slide body 18 px → the grammar's content target 16.2 px = 32.4 units.
const LANE = (): TypeState => ({ ...newTypeState(typeScale(18, 0.5, 500)), floor: LEGIBLE_PX / 0.5 });

describe('text keeps to the room the drawing gives it', () => {
  it('a dense board: no text runs into another text or a stroke it was clear of', () => {
    const g = run(DENSE, LANE());
    expect(collisions(g)).toBe(0);
    // Proportion: no text is set more than a little above what the model wrote for it.
    const label = Array.from(g.querySelectorAll('text')).find((t) => t.textContent === 'factors 0.5, 0.5')!;
    expect(Number(label.getAttribute('font-size'))).toBeLessThanOrEqual(21 * RAISE_MAX + 1e-6);
  });

  it('labels beside small glyphs stay off them and off the box edge', () => {
    const g = run(GLYPHS, LANE());
    expect(collisions(g)).toBe(0);
  });

  it('a sparse board is raised the whole way the proportion rule allows (room allows it)', () => {
    const st = LANE();
    const g = run(SPARSE, st);
    // The model's 16 is under the legibility floor (10 px = 20 units): raised to it, then by RAISE_MAX.
    expect(Number(g.querySelector('text')!.getAttribute('font-size'))).toBeCloseTo(Math.min(st.scale.content, 20 * RAISE_MAX), 1);
  });

  it('a later group never sets content larger than an earlier, tighter one', () => {
    const st = LANE();
    const a = run(DENSE, st);
    const b = run(SPARSE.replace('sparse', 'sp2').replace('cy="300"', 'cy="500"').replace('y="300"', 'y="500"'), st);
    const fa = Math.max(...Array.from(a.querySelectorAll('text[data-role="content"]')).map((t) => Number(t.getAttribute('font-size'))));
    expect(Number(b.querySelector('text')!.getAttribute('font-size'))).toBeLessThanOrEqual(fa + 1e-6);
  });
});
