// @vitest-environment jsdom
// The legibility floor (founder 2026-10-31: dense lane boards read at 8–10 px). Every board text is at
// least LEGIBLE_PX on screen; a label the raise leaves no room moves (nudge, then a two-line wrap)
// instead of shrinking, and never onto a text or stroke it was clear of. A board drawn on the p6.4
// canvas (560 wide, units ≈ screen px) keeps its own sizes.
import { describe, expect, it } from 'vitest';
import { mountBoard, prepareGroup, type SvgBoard } from '../../src/svgboard/render';
import { core, groupGeometry, overlapArea, segHitsBox, type TextBox } from '../../src/svgboard/check';
import { inkBox, LEGIBLE_PX } from '../../src/svgboard/grammar';
import { BOARD_W } from '../../src/svgboard/wire';

const NS = 'http://www.w3.org/2000/svg';
let n = 0;
const board = (w: number, h: number): SvgBoard => {
  const svg = document.createElementNS(NS, 'svg');
  document.body.appendChild(svg);
  return mountBoard(svg.appendChild(document.createElementNS(NS, 'g')) as SVGGElement, { w, h }, `t${n++}`, '#7c3aed').board;
};
/** The 1440 lane: the section's 1000 units are 496 px. */
const LANE_PX = 496;
const draw = (b: SvgBoard, srcs: string[]) => {
  const ppu = (LANE_PX / 1000) * (1000 / b.w);
  const geos = srcs.map((src) => { const s = prepareGroup(b, src, 18, ppu); if (typeof s === 'string') throw new Error(s); b.root.appendChild(s.el); return groupGeometry(s.el, 0); });
  const texts = geos.flatMap((g) => g.texts), segs = geos.flatMap((g) => g.segs.filter((s) => !s.tiny));
  return { ppu, texts, segs };
};
const textHits = (ts: TextBox[]) => { let k = 0; for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) if (ts[i].el !== ts[j].el && overlapArea(inkBox(ts[i]), inkBox(ts[j])) > 0) k++; return k; };

describe('the legibility floor and its safety net', () => {
  it('a row of labels too tight for the floor: every label reads at ≥ LEGIBLE_PX, wrapped clear of its neighbours', () => {
    const b = board(1000, 400);
    const row = `<g id="tight"><text x="40" y="40" font-size="18">a heading with room</text><g font-size="17" text-anchor="middle">
      <text x="100" y="120">factors 0.25, 0.25</text><text x="260" y="120">factors 0.25, 0.25</text><text x="420" y="120">factors 0.25, 0.25</text></g></g>`;
    const { ppu, texts } = draw(b, [row]);
    for (const t of texts) expect(t.fs * ppu, t.text).toBeGreaterThanOrEqual(LEGIBLE_PX - 1e-6);
    expect(textHits(texts)).toBe(0);
    expect(b.root.querySelectorAll('tspan').length).toBeGreaterThan(0); // they broke into two lines, in their places
    for (const t of Array.from(b.root.querySelectorAll('text')).slice(1)) expect(t.getAttribute('y')).toBe('120');
  });

  it('a label raised past the canvas edge moves back inside', () => {
    const b = board(1000, 300);
    const { texts } = draw(b, ['<g id="edge"><line x1="100" y1="200" x2="900" y2="200" stroke="#222"/><text x="1000" y="150" text-anchor="end" font-size="16">a long label at the edge</text></g>']);
    const t = texts.find((x) => x.text.startsWith('a long'))!;
    expect(t.x + t.w).toBeLessThanOrEqual(1001);
  });

  it('a label pushed onto a stroke by the raise is nudged off it, not shrunk', () => {
    const b = board(1000, 300);
    const g = `<g id="bar"><rect x="300" y="105" width="400" height="60" fill="none" stroke="#222"/><text x="40" y="80" font-size="16">a subtitle</text><text x="500" y="98" text-anchor="middle" font-size="16">outlier</text></g>`;
    const { ppu, texts, segs } = draw(b, [g]);
    const t = texts.find((x) => x.text === 'outlier')!;
    expect(t.fs * ppu).toBeGreaterThanOrEqual(LEGIBLE_PX - 1e-6);
    expect(segs.some((s) => segHitsBox(s.a, s.b, core(t)))).toBe(false);
  });

  it('a model\'s own label on its curve (as written) is left where it is', () => {
    const b = board(1000, 400);
    const src = '<g id="curve"><path d="M50 300 L450 100" fill="none" stroke="#222"/><text x="240" y="208" font-size="28">on the line</text></g>';
    draw(b, [src]);
    expect(b.root.querySelector('text')!.getAttribute('x')).toBe('240');
  });

  it(`on the p6.4 canvas (${BOARD_W} wide) the model's 16–20 unit labels read at their own size, not raised`, () => {
    const b = board(BOARD_W, 300);
    const { ppu, texts } = draw(b, ['<g id="p"><text x="20" y="40" font-size="18">demand</text><text x="300" y="40" font-size="16">supply 120</text><line x1="20" y1="60" x2="540" y2="60" stroke="#222"/></g>']);
    for (const t of texts) { expect(t.fs * ppu).toBeGreaterThanOrEqual(LEGIBLE_PX); expect(t.fs * ppu).toBeLessThanOrEqual(18 * ppu * 1.02); }
  });
});
