// @vitest-environment jsdom
// A group's parts draw over its own beat's words (review of fix/say-what-you-draw, 2026-10-31): a beat
// the gate has not closed yet is not guessed to run 6 s into the next beat, a one-word beat re-plans,
// and a part waiting for its word follows that word when the voice moves it.
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

describe('an svg group\'s parts stay inside their beat as its words are known', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => setTimeout(() => f(performance.now()), 16));
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); document.head.innerHTML = ''; document.body.innerHTML = ''; });

  it('a short beat still open when its group fires (the gate has not passed the next beat yet) ends its drawing with its words', async () => {
    const s = setup('<line data-k="a" x1="0" y1="0" x2="400" y2="0"/><line data-k="b" x1="0" y1="50" x2="400" y2="50"/><line data-k="c" x1="0" y1="90" x2="400" y2="90"/>');
    const t0 = performance.now();
    const text = 'it falls fast.';
    // 300 ms a word (ends at 900); the next {{beat}} passes the gate at 600 ms.
    const beat = (): BeatWord[] => { const el = performance.now() - t0; const ws = text.split(' ').map((w, i) => ({ text: w, inMs: Math.max(0, i * 300 - el), endMs: Math.max(0, (i + 1) * 300 - el) } as BeatWord)); if (el > 0) ws[0].sinceMs = el; if (el < 600) ws[ws.length - 1].open = true; return ws; };
    void drawGroup(s.b, s.g, 'fall', { signal: new AbortController().signal, stop: new AbortController().signal, color: '#000', beat });
    const t = await starts(s.g, 8000);
    // SPAN_MIN_MS 1200 + REST_MS 400: the next beat's words start by ~1300 ms.
    expect(Math.max(t.a, t.b, t.c)).toBeLessThan(1300);
  });
  it('a one-word beat that closes after its group started does not keep drawing over the next 6 s', async () => {
    const s = setup('<line data-k="a" x1="0" y1="0" x2="400" y2="0"/><line data-k="b" x1="0" y1="50" x2="400" y2="50"/><line data-k="c" x1="0" y1="90" x2="400" y2="90"/>');
    const t0 = performance.now();
    const beat = (): BeatWord[] => { const el = performance.now() - t0; return [{ text: 'Here.', inMs: 0, endMs: Math.max(0, 300 - el), ...(el < 200 ? { open: true } : {}), ...(el > 0 ? { sinceMs: el } : {}) }]; };
    void drawGroup(s.b, s.g, 'mark', { signal: new AbortController().signal, stop: new AbortController().signal, color: '#000', beat });
    const t = await starts(s.g, 8000);
    expect(Math.max(t.a, t.b, t.c)).toBeLessThan(1600);
  });

});
