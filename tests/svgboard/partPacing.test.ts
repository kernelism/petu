// Each part of an svg group draws on the words that name it (C6, founder 2026-10-31: "what it says and
// what it draws don't match"): its data-say, its id's words, its label's words and numbers ("37°" said
// as "thirty-seven"), in its own beat; the rest go next to their named neighbours in the group's order.
// Fake clock and a fake requestAnimationFrame; jsdom has no layout, so lines get a length by hand.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { drawGroup, mountBoard, type SvgBoard } from '../../src/svgboard/render';
import type { BeatWord } from '../../src/playback/pace';

const SVG = 'http://www.w3.org/2000/svg';
const LEN = 400;

function setup(inner: string) {
  const st = document.createElement('style');
  st.textContent = 'line { stroke: #000; stroke-width: 1px; }';
  document.head.appendChild(st);
  const layer = document.createElementNS(SVG, 'g');
  document.body.appendChild(document.createElementNS(SVG, 'svg')).appendChild(layer);
  const b: SvgBoard = mountBoard(layer, { w: 1000, h: 700 }, 'b1', '#7c3aed').board;
  const g = document.createElementNS(SVG, 'g');
  g.innerHTML = inner;
  for (const l of Array.from(g.querySelectorAll('line'))) Object.assign(l, { getTotalLength: () => LEN, getPointAtLength: () => ({ x: 0, y: 0 }) });
  return { b, g };
}

/** The narration, 300 ms a word from now. */
const narration = (text: string) => { const t0 = performance.now(); return (): BeatWord[] => text.split(' ').map((w, i) => ({ text: w, inMs: Math.max(0, t0 + i * 300 - performance.now()), endMs: Math.max(0, t0 + (i + 1) * 300 - performance.now()) })); };

/** When each element starts drawing (ms from the start). */
async function starts(g: SVGGElement, until: number): Promise<Record<string, number>> {
  const t: Record<string, number> = {};
  const els = Array.from(g.querySelectorAll('line,text')) as SVGElement[];
  for (let ms = 0; ms <= until; ms += 10) {
    for (const el of els) {
      const k = el.getAttribute('data-k')!;
      if (t[k] != null) continue;
      const on = el.tagName === 'line' ? el.style.strokeDashoffset !== '' && Number(el.style.strokeDashoffset) < LEN || el.style.strokeDashoffset === '' && el.style.strokeDasharray === '' && ms > 0 : el.style.opacity !== '0';
      if (on && ms > 0) t[k] = ms;
    }
    await vi.advanceTimersByTimeAsync(10);
  }
  return t;
}

describe('svg parts draw on the words that name them', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => setTimeout(() => f(performance.now()), 16));
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); document.head.innerHTML = ''; document.body.innerHTML = ''; });

  it('a label draws on its number said in words; a data-say part on its word; the rest in the group\'s order', async () => {
    const s = setup('<line data-k="water" x1="0" y1="0" x2="400" y2="0"/>'
      + '<text data-k="angle" x="10" y="10">37°</text>'
      + '<line data-k="aim" data-say="heading" x1="0" y1="50" x2="400" y2="50"/>');
    const beat = narration('first the water flows then the boat turns thirty-seven degrees and its heading points up the river to land');
    void drawGroup(s.b, s.g, 'ferry', { signal: new AbortController().signal, stop: new AbortController().signal, color: '#000', beat });
    const t = await starts(s.g, 7000);
    expect(t.water).toBeLessThan(100); // unnamed, first in the group: from the beat's start
    expect(Math.abs(t.angle - 8 * 300)).toBeLessThanOrEqual(40); // "thirty-seven" is word 8
    expect(Math.abs(t.aim - 12 * 300)).toBeLessThanOrEqual(40); // "heading" is word 12
  });
});
