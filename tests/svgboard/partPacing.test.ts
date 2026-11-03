// Each part of an svg group draws on the words that name it (C6, founder 2026-10-31: "what it says and
// what it draws don't match"): its data-say, its id's words, its label's words and numbers ("37°" said
// as "thirty-seven"), in its own beat; the rest go next to their named neighbours in the group's order.
// Fake clock and a fake requestAnimationFrame; jsdom has no layout, so lines get a length by hand.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { drawGroup, mountBoard, prepareGroup, GROUP_MAX_MS, type SvgBoard } from '../../src/svgboard/render';
import { checkGroups, newBoardState } from '../../src/svgboard/check';
import { ACTION_TIMEOUT_MS } from '../../src/playback/director';
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

  it('the director\'s land() (the view about to move) does not land the parts still to come in the beat', async () => {
    const s = setup('<line data-k="water" x1="0" y1="0" x2="400" y2="0"/><line data-k="aim" data-say="heading" x1="0" y1="50" x2="400" y2="50"/>');
    const beat = narration('the water flows east all morning then the heading turns up the river and on');
    const step = new AbortController();
    const done = drawGroup(s.b, s.g, 'ferry', { signal: step.signal, stop: new AbortController().signal, color: '#000', beat });
    await vi.advanceTimersByTimeAsync(300);
    step.abort(); // a scroll 0.3 s in: land() aborts the step
    await vi.advanceTimersByTimeAsync(20);
    await done; // the step hands back at once
    const aim = s.g.querySelector('[data-k="aim"]') as SVGElement;
    expect(aim.style.strokeDashoffset).toBe(String(LEN)); // not landed: it waits for "heading"
    const t = await starts(s.g, 3000);
    expect(Math.abs(t.aim + 320 - 8 * 300)).toBeLessThanOrEqual(40); // "heading" is word 8 (watched from 0.32 s on)
  });

  it('a readout draws on its value said, not on a word it shares with its neighbours or on its id (D18, D9)', async () => {
    // As prepareGroup leaves them: data-val resolved into the text, its template kept in data-tpl.
    const s = setup('<line data-k="mark" x1="0" y1="0" x2="400" y2="0"/>'
      + '<text data-k="qbase" id="b1-qbase" data-val="qm" data-tpl="midpoint {}">midpoint 15</text>'
      + '<text data-k="qmid" id="b1-qmid" data-val="dq/qm" data-tpl="midpoint change: +{}%">midpoint change: +66.7%</text>'
      + '<text data-k="factor" id="b1-factor" data-val="1+f" data-tpl="×{} per 2 blocks">×1.5 per 2 blocks</text>');
    // "midpoint" is word 1, 15 word 3, the template's own 2 word 7, 66.7 word 12, 1.5 word 18, "factors" (the id's word) 21.
    const beat = narration('the midpoint is 15 here and over 2 blocks the change is 66.7 percent so each multiplies by 1.5 and the factors go on to the end');
    void drawGroup(s.b, s.g, 'midpoint', { signal: new AbortController().signal, stop: new AbortController().signal, color: '#000', beat });
    const t = await starts(s.g, 8000);
    expect(Math.abs(t.qbase - 3 * 300)).toBeLessThanOrEqual(40);
    expect(Math.abs(t.qmid - 12 * 300)).toBeLessThanOrEqual(40);
    expect(Math.abs(t.factor - 18 * 300)).toBeLessThanOrEqual(40);
  });

  it('a readout said with its affixes ("$85", "11.8%", "100 units": values/quantity.ts) draws on that word', async () => {
    const s = setup('<line data-k="mark" x1="0" y1="0" x2="400" y2="0"/>'
      + '<text data-k="keeps" id="b1-keeps" data-val="85" data-tpl="hotel keeps ${}">hotel keeps $85</text>'
      + '<text data-k="share" id="b1-share" data-val="11.8" data-tpl="+{}%">+11.8%</text>'
      + '<text data-k="qty" id="b1-qty" data-val="100" data-tpl="{} units">100 units</text>');
    // As the parser now says them: "$85" word 4, "11.8%" word 10, "100" word 15.
    const beat = narration('so the hotel keeps $85 and the guest share is 11.8% while sales stay at 100 units for the rest of it');
    void drawGroup(s.b, s.g, 'tax', { signal: new AbortController().signal, stop: new AbortController().signal, color: '#000', beat });
    const t = await starts(s.g, 8000);
    expect(Math.abs(t.keeps - 4 * 300)).toBeLessThanOrEqual(40);
    expect(Math.abs(t.share - 10 * 300)).toBeLessThanOrEqual(40);
    expect(Math.abs(t.qty - 15 * 300)).toBeLessThanOrEqual(40);
  });

  it('a stop still lands everything at once', async () => {
    const s = setup('<line data-k="water" x1="0" y1="0" x2="400" y2="0"/><line data-k="aim" data-say="heading" x1="0" y1="50" x2="400" y2="50"/>');
    const stop = new AbortController();
    void drawGroup(s.b, s.g, 'ferry', { signal: new AbortController().signal, stop: stop.signal, color: '#000', beat: narration('the water flows east all morning then the heading turns up the river and on') });
    await vi.advanceTimersByTimeAsync(300);
    stop.abort();
    await vi.advanceTimersByTimeAsync(40);
    expect((s.g.querySelector('[data-k="aim"]') as SVGElement).style.strokeDashoffset).toBe('');
  });

  it('a group at pen speed fits under the director\'s step timeout', () => {
    expect(GROUP_MAX_MS).toBeLessThan(ACTION_TIMEOUT_MS);
  });

  it('a data-say passes the gate\'s check and the board\'s preparation, and reaches the drawing', () => {
    const src = '<g id="aim"><line data-say="heading" x1="0" y1="50" x2="400" y2="50" stroke="#222"/><text x="10" y="80" font-size="20">37°</text></g>';
    const r = checkGroups([src], newBoardState());
    expect(r.flags).toEqual([]);
    expect(r.notes.join(' ')).not.toMatch(/say/);
    const s = setup('');
    const g = prepareGroup(s.b, src, 16, 1);
    expect(typeof g).not.toBe('string');
    expect((g as { el: Element }).el.querySelector('line')!.getAttribute('data-say')).toBe('heading');
  });
});
