// Ink follows a pause (founder report 2026-10-31: "When I started typing during an answer drawing, it
// still kept drawing while the voice speaking paused"). Typing in the bar, Space, the pause button and
// an aside pause the session; a group in flight must stand still mid-stroke, wait to start, and on
// resume go on from where it stood, still on its words.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { drawGroup, mountBoard, type SvgBoard } from '../../src/svgboard/render';
import { drawStrokes } from '../../src/ink/agent/animate';
import type { BeatWord } from '../../src/playback/pace';

const SVG = 'http://www.w3.org/2000/svg';
const LEN = 400;

function setup() {
  const st = document.createElement('style');
  st.textContent = 'line { stroke: #000; stroke-width: 1px; }';
  document.head.appendChild(st);
  const layer = document.createElementNS(SVG, 'g');
  document.body.appendChild(document.createElementNS(SVG, 'svg')).appendChild(layer);
  const b: SvgBoard = mountBoard(layer, { w: 1000, h: 700 }, 'b1', '#7c3aed').board;
  const g = document.createElementNS(SVG, 'g');
  g.innerHTML = '<line id="b1-one" x1="0" y1="0" x2="400" y2="0"/><line id="b1-two" x1="0" y1="50" x2="400" y2="50"/>';
  // jsdom has no layout: give the lines a length so they take the trace path.
  for (const l of Array.from(g.querySelectorAll('line'))) Object.assign(l, { getTotalLength: () => LEN, getPointAtLength: () => ({ x: 0, y: 0 }) });
  const [one, two] = Array.from(g.querySelectorAll('line')) as SVGLineElement[];
  return { b, g, one, two };
}

/** A narration of 8 words, 500 ms each, from now: a pause holds it, a resume moves its words later by the pause (Scheduler.resume). */
function narration() {
  const n = { paused: false, shift: performance.now(), since: 0 };
  const beat = (): BeatWord[] => Array.from({ length: 8 }, (_, i) => {
    const at = i * 500 + n.shift - performance.now();
    return { text: `word${i}`, inMs: Math.max(0, at), endMs: Math.max(0, at + 500) };
  });
  const pause = () => { n.paused = true; n.since = performance.now(); };
  const resume = () => { n.shift += performance.now() - n.since; n.paused = false; };
  return { n, beat, pause, resume, paused: () => n.paused };
}

const offset = (el: SVGElement) => el.style.strokeDashoffset;
/** When each line starts and finishes tracing (ms after the start), stepping 10 ms at a time. */
async function watch(one: SVGElement, two: SVGElement, until: number, at?: Record<number, () => void>) {
  const t: Record<string, number> = {};
  for (let ms = 0; ms <= until; ms += 10) {
    at?.[ms]?.();
    for (const [k, el] of [['one', one], ['two', two]] as const) {
      const o = offset(el);
      if (t[`${k}Start`] == null && o !== '' && Number(o) < LEN) t[`${k}Start`] = ms;
      if (t[`${k}End`] == null && t[`${k}Start`] != null && o === '') t[`${k}End`] = ms;
    }
    await vi.advanceTimersByTimeAsync(10);
  }
  return t;
}

describe('an svg group follows its answer\'s pause', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => setTimeout(() => f(performance.now()), 16));
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); document.head.innerHTML = ''; document.body.innerHTML = ''; });

  it('paused mid-stroke it stands still (1 s and 3 s in), then finishes on time relative to its words', async () => {
    // Unpaused: the baseline.
    let s = setup(), nar = narration();
    void drawGroup(s.b, s.g, 'grp', { signal: new AbortController().signal, color: '#000', beat: nar.beat, paused: nar.paused });
    const base = await watch(s.one, s.two, 6000);
    expect(base.oneStart).toBeLessThan(100);
    expect(base.twoStart).toBeGreaterThan(1500);
    document.body.innerHTML = '';

    // Paused 5 s halfway through the first line.
    s = setup(); nar = narration();
    const seen: Record<string, string> = {};
    void drawGroup(s.b, s.g, 'grp', { signal: new AbortController().signal, color: '#000', beat: nar.beat, paused: nar.paused });
    const PAUSE = 5000, AT = 800;
    const t = await watch(s.one, s.two, 12000, {
      [AT]: nar.pause,
      [AT + 40]: () => { seen.held = offset(s.one); },
      [AT + 1000]: () => { seen.at1s = offset(s.one); seen.two1s = offset(s.two); },
      [AT + 3000]: () => { seen.at3s = offset(s.one); },
      [AT + PAUSE]: nar.resume,
    });
    expect(Number(seen.held)).toBeGreaterThan(0);
    expect(Number(seen.held)).toBeLessThan(LEN);
    expect(seen.at1s).toBe(seen.held);
    expect(seen.at3s).toBe(seen.held);
    expect(seen.two1s).toBe(String(LEN)); // the next part has not started
    // Every time after the pause is later by the pause, within a frame or two.
    expect(Math.abs(t.oneEnd - (base.oneEnd + PAUSE))).toBeLessThanOrEqual(40);
    expect(Math.abs(t.twoStart - (base.twoStart + PAUSE))).toBeLessThanOrEqual(40);
    expect(Math.abs(t.twoEnd - (base.twoEnd + PAUSE))).toBeLessThanOrEqual(40);
  });

  it('a group that arrives while paused does not start until the resume', async () => {
    const s = setup(), nar = narration();
    nar.pause();
    const steps: number[] = [];
    void drawGroup(s.b, s.g, 'grp', { signal: new AbortController().signal, color: '#000', beat: nar.beat, paused: nar.paused, onStep: () => steps.push(performance.now()) });
    await vi.advanceTimersByTimeAsync(3000);
    expect(steps).toEqual([]); // nothing started: the board doesn't follow a part either
    expect(offset(s.one)).toBe(String(LEN));
    nar.resume();
    await vi.advanceTimersByTimeAsync(200);
    expect(steps.length).toBe(1);
    expect(Number(offset(s.one))).toBeLessThan(LEN);
  });

  it('a stop while paused lands the final state at once', async () => {
    const s = setup(), nar = narration(), stop = new AbortController();
    const done = drawGroup(s.b, s.g, 'grp', { signal: new AbortController().signal, stop: stop.signal, color: '#000', beat: nar.beat, paused: nar.paused });
    await vi.advanceTimersByTimeAsync(600);
    nar.pause();
    await vi.advanceTimersByTimeAsync(2000);
    expect(offset(s.one)).not.toBe('');
    stop.abort();
    await vi.advanceTimersByTimeAsync(60);
    expect(offset(s.one)).toBe('');
    expect(offset(s.two)).toBe('');
    await done;
  });
});

describe('page strokes follow the pause too', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => setTimeout(() => f(performance.now()), 16));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });

  it('a circle traced on the page stands still while paused and finishes after the resume', async () => {
    const g = document.body.appendChild(document.createElementNS(SVG, 'svg')).appendChild(document.createElementNS(SVG, 'g')) as SVGGElement;
    let paused = false, finished = false;
    const stroke = Array.from({ length: 20 }, (_, i) => ({ x: i * 30, y: 0 }));
    void drawStrokes(g, [stroke], { color: '#000', width: 2, mode: 'trace', scale: 1, paused: () => paused }).then(() => { finished = true; });
    await vi.advanceTimersByTimeAsync(200);
    paused = true;
    await vi.advanceTimersByTimeAsync(20);
    const d = g.querySelector('path')!.getAttribute('d');
    await vi.advanceTimersByTimeAsync(3000);
    expect(g.querySelector('path')!.getAttribute('d')).toBe(d);
    expect(finished).toBe(false);
    paused = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(finished).toBe(true);
  });
});
