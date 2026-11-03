// @vitest-environment jsdom
// The legibility floor (founder 2026-10-31: dense lane boards read at 8–10 px). Every board text is at
// least LEGIBLE_PX on screen; a label the raise leaves no room moves (nudge, then a two-line wrap)
// instead of shrinking, and never onto a text or stroke it was clear of. A board drawn on the p6.4
// canvas (560 wide, units ≈ screen px) keeps its own sizes.
import { describe, expect, it } from 'vitest';
import { mountBoard, prepareGroup, refreshData, type SvgBoard } from '../../src/svgboard/render';
import { core, groupGeometry, overlapArea, segHitsBox, type TextBox } from '../../src/svgboard/check';
import { inkBox, LEGIBLE_PX, RAISE_MAX } from '../../src/svgboard/grammar';
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

  it('a label placed by data up-left of its point on a falling line is nudged off the line through dx/dy (a re-resolve keeps it)', () => {
    // D19: "P 10, Q 10" at pt(hi,qh,ph) dx=-12 dy=-12, end-anchored, sat across its own demand line. The
    // model cannot see where the engine puts it, so every hit counts; x/y stay the point's.
    const b = board(1000, 400);
    const src = `<g id="dem" data-const="ph=5"><g data-axes="hi" data-x="0,20" data-y="0,10" data-box="100,100,400,200"/>
      <path data-fn="10-x/2" data-axes="hi" fill="none" stroke="#222" stroke-width="3"/>
      <circle data-at="pt(hi,10,ph)" r="5" fill="#222"/><text data-at="pt(hi,10,ph)" dx="-12" dy="-12" text-anchor="end" font-size="17">P 10, Q 10</text></g>`;
    const { texts, segs } = draw(b, [src]);
    const t = texts.find((x) => x.text === 'P 10, Q 10')!, el = b.root.querySelector('text[data-at]')!;
    expect(segs.some((s) => segHitsBox(s.a, s.b, inkBox(t)))).toBe(false); // clear, not just off core()'s slack
    expect([el.getAttribute('x'), el.getAttribute('y')]).toEqual(['300', '200']);
    expect([el.getAttribute('dx'), el.getAttribute('dy')]).not.toEqual(['-12', '-12']);
    const moved = [el.getAttribute('dx'), el.getAttribute('dy')];
    // A tween's frame (ph 5 → 4) re-resolves x/y from the data; the nudge rides along on dx/dy.
    const g = b.root.querySelector('g[data-const]') as SVGGElement;
    b.scope.consts.ph = 4; b.bound.push(g); refreshData(b);
    expect([el.getAttribute('x'), el.getAttribute('y'), el.getAttribute('dx'), el.getAttribute('dy')]).toEqual(['300', '220', ...moved]);
  });

  it('a label wider than its bar segment is placed whole beside the bar, in ink; the bar keeps its width (never wrapped, never grown)', () => {
    // The Bayes board (2026-11-02): "95 sick" in a narrow segment of a two-part bar (30 high: a solid mark). Wrapped
    // at words it read as "95" inside and "sick" hanging below; growing the segment would misstate the count.
    const b = board(BOARD_W, 300);
    const g = `<g id="bar"><rect x="35" y="100" width="50" height="30" fill="#7c3aed"/><rect x="85" y="100" width="365" height="30" fill="#ddd" stroke="#888"/>
      <text x="60" y="121" font-size="16" text-anchor="middle" fill="#fff">95 sick</text><text x="268" y="121" font-size="16" text-anchor="middle" fill="#222">495 healthy</text></g>`;
    const { texts } = draw(b, [g]);
    const t = texts.find((x) => x.text === '95 sick')!, el = t.el!;
    expect(el.querySelectorAll('tspan').length).toBe(0); // one line, one label
    const rects = Array.from(b.root.querySelectorAll('rect')).filter((r) => r.getAttribute('x') === '35');
    expect(rects.map((r) => [r.getAttribute('width'), r.getAttribute('height')])).toEqual([['50', '30']]);
    const ink = inkBox(t);
    expect(ink.y + ink.h <= 100 || ink.y >= 130).toBe(true); // wholly above or below the bar, not across its edge
    expect(Math.abs(t.x + t.w / 2 - 60)).toBeLessThan(30); // beside its own segment
    expect(el.getAttribute('fill')).not.toMatch(/fff|FFFFFE/i); // off the fill, not paper-on-paper
    expect(textHits(texts)).toBe(0);
  });

  it('a label that fits its shape stays in it', () => {
    const b = board(BOARD_W, 300);
    draw(b, ['<g id="bar"><rect x="35" y="100" width="160" height="55" fill="#7c3aed"/><text x="115" y="133" font-size="16" text-anchor="middle" fill="#fff">19 sick</text></g>']);
    const el = b.root.querySelector('text')!;
    expect([el.getAttribute('x'), el.getAttribute('y')]).toEqual(['115', '133']);
  });

  it('a frame owns the band its x numbers go in: an axis title written there moves out, and a later number on the axis lands clear at its own point', () => {
    // The price-ceiling board (2026-11-02): "rental units" written under the x axis, then "140" at the foot of a
    // dashed drop line (data-at on the axis, dy=22) was nudged into the gap between the axis and the title.
    const b = board(BOARD_W, 410);
    const eq = `<g id="eq" data-const="pc=6"><g data-axes="ax" data-x="0,180" data-y="0,20" data-box="80,65,360,260" data-frame=""/>
      <text x="345" y="354" font-size="16" fill="#222">rental units</text><path id="demand" data-fn="20-0.1*x" data-axes="ax" fill="none" stroke="#222"/></g>`;
    const gap = `<g id="gap"><circle data-name="qd" data-at="at(demand,y=pc)" r="5" fill="#222"/><line data-from="qd" data-to="pt(ax,(20-pc)/0.1,0)" stroke="#888" stroke-dasharray="5 4"/>
      <text data-at="pt(ax,(20-pc)/0.1,0)" dy="22" text-anchor="middle" font-size="16" data-val="(20-pc)/0.1" data-fmt="0">{}</text></g>`;
    const { texts } = draw(b, [eq, gap]);
    const title = texts.find((t) => t.text === 'rental units')!, n = texts.find((t) => t.text === '140')!;
    expect(inkBox(title).y).toBeGreaterThan(325 + 8 + 16); // below the band, not in it
    const el = n.el!;
    expect([el.getAttribute('dx'), el.getAttribute('dy')]).toEqual([null, '22']); // at its own point, unmoved
    expect(overlapArea(inkBox(title), inkBox(n))).toBe(0);
  });

  it("the engine's tick numbers count as obstacles: a model's text written on one (it could not see it) moves; the tick never does", () => {
    // Beside a y tick, as written: the pair "always" collided, so before neither moved.
    const y = `<g id="ya"><g data-axes="ay" data-x="0,100" data-y="0,10" data-box="80,40,400,180" data-frame="" data-ticks-y="0,5,10"/>
      <text x="72" y="130" font-size="16" text-anchor="end" dominant-baseline="middle">price</text></g>`;
    // Just above an x tick: the list rule (polish.ts) pushed the tick down under the text.
    const x = `<g id="xa"><g data-axes="ax" data-x="0,100" data-y="0,10" data-box="80,40,400,180" data-frame="" data-ticks-x="0,50,100"/>
      <text x="280" y="226" font-size="16" text-anchor="middle" dominant-baseline="hanging">quantity</text></g>`;
    for (const [src, tickText, word, at] of [[y, '5', 'price', ['70', '130']], [x, '50', 'quantity', ['280', '228']]] as const) {
      const bb = board(BOARD_W, 300);
      const { texts } = draw(bb, [src]);
      const tick = texts.find((t) => t.text === tickText && t.el!.hasAttribute('data-engine'))!, label = texts.find((t) => t.text === word)!;
      expect([tick.el!.getAttribute('x'), tick.el!.getAttribute('y')], word).toEqual(at);
      expect(overlapArea(inkBox(tick), inkBox(label)), word).toBe(0);
    }
  });

  it(`on the p6.4 canvas (${BOARD_W} wide) the model's 16–20 unit labels keep their ratio, raised by one factor of at most RAISE_MAX`, () => {
    const b = board(BOARD_W, 300);
    const { ppu, texts } = draw(b, ['<g id="p"><text x="20" y="40" font-size="18">demand</text><text x="300" y="40" font-size="16">supply 120</text><line x1="20" y1="60" x2="540" y2="60" stroke="#222"/></g>']);
    const d = texts.find((t) => t.text === 'demand')!, s = texts.find((t) => t.text === 'supply 120')!;
    for (const t of texts) expect(t.fs * ppu).toBeGreaterThanOrEqual(LEGIBLE_PX);
    expect(d.fs / s.fs).toBeCloseTo(18 / 16, 3);
    expect(s.fs).toBeGreaterThanOrEqual(16); expect(s.fs).toBeLessThanOrEqual(16 * RAISE_MAX + 1e-6);
  });
});
