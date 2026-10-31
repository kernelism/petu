// @vitest-environment jsdom
// The board's visual grammar: size = structure (title / content / small), weight = importance (the
// title only), colour = time (ink at rest; the accent only while a part draws). The model's own sizes,
// weights and colours carry nothing.
import { describe, expect, it } from 'vitest';
import { sanitizeGroup } from '../../src/svgboard/sanitize';
import { prepareText } from '../../src/svgboard/polish';
import { resolveData, newScope } from '../../src/svgboard/data';
import { applyGrammar, isTickText, newTypeState, RAISE_MAX, TITLE_K, typeScale, type TypeState } from '../../src/svgboard/grammar';
import { INK } from '../../src/svgboard/style';

// Verbatim: the svg-ceiling card the founder flagged ("no text hierarchy"; four slightly different sizes and greys).
const CARD = `<g id="card">
  <rect x="680" y="70" width="290" height="190" rx="10" fill="#f6f3ff" stroke="#c4b5fd"/>
  <text x="700" y="108" font-size="20" fill="#555">at the cap</text>
  <text x="700" y="148" font-size="22" fill="#222">rent $600</text>
  <text x="700" y="186" font-size="22" fill="#7c3aed" font-weight="bold">shortage 80 flats</text>
  <text x="700" y="224" font-size="18" fill="#555">40 flats offered</text>
</g>`;
const MARKET = `<g id="market" data-const="a=1200 b=5 c=400 e=5">
  <g data-axes="ax" data-x="0,150" data-y="300,1300" data-box="110,50,500,440" data-frame="" data-ticks-x="0,50,100,150" data-ticks-y="400,800,1200"/>
  <text x="110" y="34" font-size="18" fill="#555">rent ($ a month)</text>
  <text x="610" y="545" font-size="18" fill="#555" text-anchor="end">flats</text>
  <path id="demand" data-fn="a-b*x" data-axes="ax" fill="none" stroke="#222"/>
  <text x="200" y="120" font-size="20" fill="#7c3aed">demand</text>
</g>`;
// A hand-drawn axis (no engine frame): its tick labels are found by geometry.
const HAND_AXIS = `<g id="h">
  <text x="500" y="40" font-size="26" font-weight="bold" fill="#111">Dough rises in steps</text>
  <line x1="100" y1="400" x2="800" y2="400" stroke="#333"/>
  <line x1="200" y1="400" x2="200" y2="408" stroke="#333"/>
  <text x="200" y="428" font-size="16" text-anchor="middle" fill="#888">45</text>
  <line x1="400" y1="400" x2="400" y2="408" stroke="#333"/>
  <text x="400" y="428" font-size="16" text-anchor="middle" fill="#888">90 min</text>
  <text x="300" y="200" font-size="18" fill="#222">+120</text>
  <text x="300" y="260" font-size="17" fill="#7c3aed">dough volume (ml)</text>
</g>`;

const SCALE = typeScale(16, 0.5); // body 16px → content 14.4px (the kit's numerals) on a board at half scale: 28.8 units
const run = (src: string, st: TypeState) => {
  const r = sanitizeGroup(src, { ns: 'b', palette: { accent: '#7c3aed', hue: null }, minFont: st.scale.small, w: 1000, h: 700, ids: new Map(), doc: document,
    prepare: (g) => { resolveData(g, newScope()); prepareText(g, st.scale.small, applyGrammar(g, st)); } });
  if (typeof r === 'string') throw new Error(r);
  return Array.from(r.el.querySelectorAll('text'));
};
const by = (ts: Element[], s: string) => ts.find((t) => t.textContent === s)!;
const size = (t: Element) => Number(t.getAttribute('font-size'));

describe('board grammar', () => {
  it('has three sizes from the body size, the smallest never under 11px', () => {
    expect(SCALE.content).toBeCloseTo(28.8);
    expect(SCALE.title).toBeCloseTo(36);
    expect(SCALE.small).toBeCloseTo(23.616);
    expect(typeScale(16, 1, 1000).content).toBe(20);
    expect(typeScale(12, 1).small).toBe(11);
  });

  it('a card: every line one size, regular, ink; one pitch; the card holds them', () => {
    const st = newTypeState(SCALE);
    st.titled = true;
    const ts = run(CARD, st);
    // One size, raised toward the target (28.8) only as far as the proportion rule allows: RAISE_MAX × the model's median (20).
    expect(new Set(ts.map(size))).toEqual(new Set([Math.min(28.8, RAISE_MAX * 20)]));
    for (const t of ts) {
      expect(t.getAttribute('fill')).toBe(INK.ink);
      expect(t.getAttribute('font-weight')).toBe('400');
      expect(t.getAttribute('data-role')).toBe('content');
    }
    const ys = ts.map((t) => Number(t.getAttribute('y')));
    const steps = ys.slice(1).map((y, i) => y - ys[i]);
    for (const s of steps) expect(s).toBeCloseTo(1.7 * Math.min(28.8, RAISE_MAX * 20), 1);
    expect(ys[0] - 70).toBeGreaterThan(32);
    const rect = ts[0].ownerDocument.querySelector('rect') ?? ts[0].parentElement!.querySelector('rect')!;
    expect(70 + Number(rect.getAttribute('height'))).toBeGreaterThan(ys[ys.length - 1] + 20);
  });

  it('engine ticks are small; axis titles and curve labels are content; an axis title is never the board title', () => {
    const ts = run(MARKET, newTypeState(SCALE));
    expect(by(ts, '400').getAttribute('data-role')).toBe('small');
    expect(by(ts, '150').getAttribute('data-role')).toBe('small');
    expect(by(ts, 'rent ($ a month)').getAttribute('data-role')).toBe('content');
    expect(by(ts, 'flats').getAttribute('data-role')).toBe('content');
    expect(by(ts, 'demand').getAttribute('fill')).toBe(INK.ink);
  });

  it('hand-drawn ticks are found by geometry; the top heading is the title, semibold; a free number is content', () => {
    const ts = run(HAND_AXIS, newTypeState(SCALE));
    expect(by(ts, '45').getAttribute('data-role')).toBe('small');
    expect(by(ts, '90 min').getAttribute('data-role')).toBe('small');
    expect(by(ts, '+120').getAttribute('data-role')).toBe('content');
    const title = by(ts, 'Dough rises in steps');
    expect(title.getAttribute('data-role')).toBe('title');
    expect(title.getAttribute('font-weight')).toBe('600');
    expect(size(title)).toBeCloseTo(TITLE_K * Math.min(SCALE.content, RAISE_MAX * 18)); // title = 1.25 × content; content raised ≤ 1.3 × the model's median (18)
    expect(by(ts, 'dough volume (ml)').getAttribute('font-weight')).toBe('400');
  });

  it('verbatim svg-rent axes: start-anchored y labels left of the axis are small; the axis title is not the board title', () => {
    const ts = run(`<g id="ax">
<line x1="100" y1="80" x2="100" y2="560" stroke="#333" stroke-width="2"/>
<line x1="100" y1="560" x2="580" y2="560" stroke="#333" stroke-width="2"/>
<text x="20" y="70" font-size="16" fill="#333">Rent ($/mo)</text>
<text x="420" y="600" font-size="16" fill="#333">Apartments rented</text>
<text x="20" y="214" font-size="14">$1,200</text>
<text x="30" y="374" font-size="14">$800</text>
<text x="165" y="580" font-size="14">60</text>
</g>`, newTypeState(typeScale(14, 0.7)));
    expect(by(ts, '$1,200').getAttribute('data-role')).toBe('small');
    expect(by(ts, '$800').getAttribute('data-role')).toBe('small');
    expect(by(ts, '60').getAttribute('data-role')).toBe('small');
    expect(by(ts, 'Rent ($/mo)').getAttribute('data-role')).toBe('content');
  });

  it('a row label at the top is not a title (svg-session "year 1")', () => {
    const ts = run('<g><text x="40" y="40" font-size="20">year 1</text><text x="90" y="90" font-size="16">1000</text><rect x="130" y="70" width="80" height="30" fill="#ddd"/></g>', newTypeState(SCALE));
    expect(by(ts, 'year 1').getAttribute('data-role')).toBe('content');
  });

  it('one title per board: a later group never has one', () => {
    const st = newTypeState(SCALE);
    run(HAND_AXIS, st);
    const ts = run(HAND_AXIS.replace('id="h"', 'id="h2"'), st);
    expect(ts.some((t) => t.getAttribute('data-role') === 'title')).toBe(false);
  });

  it('model colours on marks become ink at rest (no random accent)', () => {
    const st = newTypeState(SCALE);
    const r = sanitizeGroup('<g><line x1="0" y1="0" x2="100" y2="0" stroke="#7c3aed"/><circle cx="5" cy="5" r="4" fill="#7c3aed"/></g>', { ns: 'b', palette: { accent: '#7c3aed', hue: null }, minFont: st.scale.small, w: 1000, h: 700, ids: new Map(), doc: document });
    if (typeof r === 'string') throw new Error(r);
    expect(r.el.querySelector('line')!.getAttribute('stroke')).toBe(INK.ink);
    expect(r.el.querySelector('circle')!.getAttribute('fill')).toBe(INK.ink2);
  });

  it('tick text: short numbers with a unit, not words', () => {
    for (const s of ['0', '1200', '$400', '−2.5', '90 min', '45°', '50%']) expect(isTickText(s)).toBe(true);
    for (const s of ['demand', 'rent $600', 'shortage 80 flats', 'x']) expect(isTickText(s)).toBe(false);
  });
});
