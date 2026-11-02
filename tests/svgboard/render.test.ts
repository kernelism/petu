// The words a group's part answers to (render.ts partNames), read before it is paced (pace.ts).
import { describe, it, expect } from 'vitest';
import { partNames } from '../../src/svgboard/render';
import { paceParts, type BeatWord } from '../../src/playback/pace';

const NS = 'http://www.w3.org/2000/svg';
/** A part as drawGroup sees it: the group's child, engine-inserted texts concatenated with no space. */
function el(svg: string): Element {
  const g = document.createElementNS(NS, 'g');
  g.innerHTML = svg;
  return g.firstElementChild!;
}
const ticks = ['0 m', '10 m', '20 m', '30 m', '40 m', '0', '5', '10', '15'].map((t) => `<text data-engine="" data-tick="">${t}</text>`).join('');

describe('svgboard: a part\'s names', () => {
  it('a frame answers to its id, never its tick numbers (D20: drawn last, on a spoken "30")', () => {
    expect(partNames(el(`<g data-axes="trajectory" data-frame="" data-ticks-x="0,10,20,30,40">${ticks}<path data-engine="" d="M0 0L0 9"/></g>`), 'n')).toEqual({ words: [] });
    expect(partNames(el(`<g id="n-plane" data-axes="p" data-ticks-y="0,5">${ticks}</g>`), 'n').label).toBeUndefined();
    expect(partNames(el(`<g id="n-plane" data-axes="p" data-ticks-y="0,5">${ticks}</g>`), 'n').words).toEqual(['plane']);
  });
  it('axes without an engine frame keep their label names', () => {
    expect(partNames(el(`<g data-axes="p"><text>price</text></g>`), 'n').label).toEqual(['price']);
  });
  it('texts are read one by one: no number fused across two of them', () => {
    expect(partNames(el(`<g>${ticks}</g>`), 'n').label).toEqual(['0', '10', '20', '30', '40', '0', '5', '10', '15']);
  });
  it('paced, a frame leads its curve: the curve on its word, the frame from the beat\'s start, not on a tick said later', () => {
    // "this line is the demand curve; at a price of 10 …": named at word 3, tick "10" at word 7.
    const w: BeatWord[] = 'this line is the demand curve; at a price of 10 buyers want 30 units'.split(' ').map((text, i) => ({ text, inMs: i * 300, endMs: (i + 1) * 300 }));
    const frame = partNames(el(`<g data-axes="d" data-frame="" data-ticks-x="0,10,20,30">${ticks}</g>`), 'n');
    const curve = partNames(el('<path id="n-demand" data-axes="d"/>'), 'n');
    const t = paceParts([{ ...frame, naturalMs: 300 }, { ...curve, naturalMs: 300 }], w)!;
    expect(t.map((x) => x.i)).toEqual([0, 1]);
    expect(t[0].at).toBe(0);
    expect(t[1].at).toBe(4 * 300);
  });
});
