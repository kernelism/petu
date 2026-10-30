// Playback controls: pause/resume, replay, seek, speed (clock rate + Scheduler.respeed), ink that
// follows its word's live time, and the sentence/part helpers behind R, Shift+←/→ and the rail.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Scheduler, RESUME_GAP_MS } from '../../src/playback/scheduler';
import { PacedClock } from '../../src/playback/clock';
import { AnswerSession } from '../../src/playback/session';
import { Director } from '../../src/playback/director';
import { nextSentence, partProgress, replayTarget, sentenceStart, type Part } from '../../src/playback/parts';
import { DEFAULTS } from '../../src/settings/settings';
import type { Action, RawAction, ScriptEvent } from '../../src/script/types';
import type { ViewerApi } from '../../src/pdf/viewerApi';
import type { BuildElement, DeskApi, ElementPlan } from '../../src/desk/types';

const w = (text: string): ScriptEvent => ({ type: 'word', text });
const words = (s: string) => s.split(' ').map(w);
const END: ScriptEvent = { type: 'end' };
const CLEAR: ScriptEvent = { type: 'action', action: { kind: 'clear' } };

describe('PacedClock rate', () => {
  it('divides every word and pause by the playback speed', () => {
    let rate = 1;
    const c = new PacedClock(() => 170, () => 0, undefined, () => rate);
    const at1 = c.durationMs('elasticity.');
    rate = 1.5;
    expect(c.durationMs('elasticity.')).toBeCloseTo(at1 / 1.5, 6);
    rate = 0.75;
    expect(c.durationMs('elasticity.')).toBeCloseTo(at1 / 0.75, 6);
  });
  it('a bad rate plays at 1×', () => {
    const c = new PacedClock(() => 170, () => 0, () => 100, () => 0);
    expect(c.durationMs('a')).toBe(100);
  });
});

describe('Scheduler controls', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => vi.useRealTimers());

  function make(rate: { v: number } = { v: 1 }) {
    const log: string[] = [];
    const fired: { kind: string; at: number; word?: number }[] = [];
    const clock = new PacedClock(() => 170, () => Date.now(), () => 100, () => rate.v);
    const s = new Scheduler(clock, {
      onWord: (t) => log.push(`${Date.now()}:${t}`),
      onAction: (a, at, word) => fired.push({ kind: a.kind, at, word }),
      onDone: () => log.push(`${Date.now()}:done`),
    });
    return { s, log, fired, rate, clock };
  }

  it('pause holds the narration at a word boundary for as long as it lasts; resume picks up the next word', () => {
    const { s, log } = make();
    s.push([...words('one two three four five.'), END]);
    vi.advanceTimersByTime(150); // one, two spoken
    expect(s.pause()).toBe(true);
    expect(s.position()).toBe(2);
    vi.advanceTimersByTime(10_000);
    expect(log).toEqual(['0:one', '100:two']);
    expect(s.resume()).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(log.slice(2)).toEqual([`${10150 + RESUME_GAP_MS}:three`, `${10250 + RESUME_GAP_MS}:four`, `${10350 + RESUME_GAP_MS}:five.`, `${10450 + RESUME_GAP_MS}:done`]);
  });

  it('replay seeks back to the sentence start and repeats it; fired actions do not fire again', () => {
    const { s, log, fired } = make();
    const evs = [...words('First one. Second'), CLEAR, ...words('sentence here.'), END];
    s.push(evs);
    vi.advanceTimersByTime(450); // First one. Second sentence here.  (pos 5 after 'here.')
    const all = ['First', 'one.', 'Second', 'sentence', 'here.'];
    expect(s.position()).toBe(5);
    const target = replayTarget(all, s.position());
    expect(target).toBe(2);
    s.seek(target);
    vi.advanceTimersByTime(1000);
    expect(log.map((l) => l.split(':')[1])).toEqual(['First', 'one.', 'Second', 'sentence', 'here.', 'Second', 'sentence', 'here.', 'done']);
    expect(fired.filter((f) => f.kind === 'clear')).toHaveLength(1);
  });

  it('a speed change re-times the words after the next one; actions fire on their words at the new pace', () => {
    const { s, log, fired, rate } = make();
    s.push([...words('a b c d'), CLEAR, ...words('e f.'), END]);
    vi.advanceTimersByTime(50); // a spoken at 0; b due at 100
    rate.v = 2;
    expect(s.respeed()).toBe(true);
    vi.advanceTimersByTime(1000);
    // b keeps its start (100); b lasts 50 now, so c 150, d 200, e 250 (the clear with it), f 300.
    expect(log).toEqual(['0:a', '100:b', '150:c', '200:d', '250:e', '300:f.', '350:done']);
    expect(fired.find((f) => f.kind === 'clear')!.at).toBe(250);
    expect(fired.find((f) => f.kind === 'clear')!.word).toBe(4);
  });

  it('respeed keeps a journey hold before the next word', () => {
    const { s, log, rate } = make();
    s.push([...words('a b c d.'), END]);
    vi.advanceTimersByTime(50);
    s.hold(100, 400); // b now at 500
    rate.v = 2;
    s.respeed();
    vi.advanceTimersByTime(2000);
    expect(log).toEqual(['0:a', '500:b', '550:c', '600:d.', '650:done']);
  });

  it('respeed while paused waits for the resume, which times the rest at the new pace', () => {
    const { s, log, rate } = make();
    s.push([...words('a b c.'), END]);
    vi.advanceTimersByTime(50);
    s.pause();
    rate.v = 0.5;
    expect(s.respeed()).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(log).toEqual(['0:a']);
    s.resume();
    vi.advanceTimersByTime(2000);
    expect(log).toEqual(['0:a', `${1050 + RESUME_GAP_MS}:b`, `${1250 + RESUME_GAP_MS}:c.`, `${1450 + RESUME_GAP_MS}:done`]);
  });

  it('liveStart: a word moves with pause (null) and speed, and is unknown before the stream reaches it', () => {
    const { s, rate } = make();
    s.push(words('a b c d,'));
    vi.advanceTimersByTime(50);
    expect(s.liveStart(3)).toBe(300);
    expect(s.liveStart(9)).toBeUndefined();
    rate.v = 2;
    s.respeed();
    expect(s.liveStart(3)).toBe(200); // b at 100, c 150, d 200
    s.pause();
    expect(s.liveStart(3)).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------
// Ink follows its word's live time (director)

const SVG = 'http://www.w3.org/2000/svg';
const g = () => document.createElementNS(SVG, 'g') as SVGGElement;

function viewer(): ViewerApi {
  const layers = { highlight: g(), agent: g() };
  return {
    numPages: () => 60, currentPage: () => 1, spaceHeight: () => 1000, scale: () => 1,
    layers: () => layers, allLayers: () => [layers], textRuns: async () => [],
    scrollToPage: vi.fn(async () => {}), ensureVisible: vi.fn(async () => false), isVisible: () => true,
    whenVisible: async () => true, ensureSize: async () => {}, cancelScroll: vi.fn(),
    goToPage: async () => {}, actedPage: () => null, onActedChange: () => () => {}, pageZoom: () => 1, setPageZoom: () => {},
    deskHost: () => { throw new Error('unused'); },
  };
}
function desk(): DeskApi {
  return {
    reset: vi.fn(async () => {}), addRegion: vi.fn(async () => 'unused'), region: () => null,
    reveal: vi.fn(async () => true), isVisible: () => true, whenVisible: async () => true, frameBoth: vi.fn(async () => {}),
    scrollToPage: vi.fn(async () => {}), addConnector: vi.fn(() => 'unused'),
    following: () => true, cancel: vi.fn(), abort: vi.fn(),
    state: () => ({ split: 'none', stacked: false, following: true, sketching: false, column: { x: 0, w: 860 } }),
    subscribe: () => () => {},
  } as unknown as DeskApi;
}

describe('ink on its word while the timeline moves', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => vi.useRealTimers());

  function director() {
    const drawn: number[] = [];
    const build: BuildElement = async () => ({ target: { page: 1 }, bbox: { x: 0, y: 0, w: 1, h: 1 }, draw: async () => { drawn.push(performance.now()); } } as ElementPlan);
    const d = new Director({ viewer, desk, settings: () => DEFAULTS, onScrolledTo: () => {}, build });
    return { d, drawn };
  }
  const CIRCLE = { kind: 'circle', page: 1, at: { x: 1, y: 1 }, r: 10 } as unknown as RawAction;

  it('ink fired ahead of its word waits through a pause and starts on the word when it is spoken', async () => {
    const { d, drawn } = director();
    let word: number | null = 450;
    d.run(CIRCLE, 450, () => word);
    await vi.advanceTimersByTimeAsync(100);
    word = null; // paused before the word
    await vi.advanceTimersByTimeAsync(3000);
    expect(drawn).toEqual([]);
    word = 4000; // resumed: the word is now due at 4000
    await vi.advanceTimersByTimeAsync(2000);
    expect(drawn).toHaveLength(1);
    expect(drawn[0]).toBeGreaterThanOrEqual(4000);
    expect(drawn[0]).toBeLessThan(4000 + 60);
  });

  it('a faster speed brings the ink forward with its word', async () => {
    const { d, drawn } = director();
    let word = 800;
    d.run(CIRCLE, 800, () => word);
    await vi.advanceTimersByTimeAsync(200);
    word = 500; // 2× from here
    await vi.advanceTimersByTimeAsync(1000);
    expect(drawn[0]).toBeGreaterThanOrEqual(500);
    expect(drawn[0]).toBeLessThan(560);
  });

  it('without a live time, ink starts at the time it fired with (a forward seek\'s fast-forward)', async () => {
    const { d, drawn } = director();
    d.run(CIRCLE, 300);
    await vi.advanceTimersByTimeAsync(1000);
    expect(drawn[0]).toBeGreaterThanOrEqual(300);
    expect(drawn[0]).toBeLessThan(320);
  });

  it('end to end: a session paused and sped up keeps its ink on its word', async () => {
    const { d, drawn } = director();
    const rate = { v: 1 };
    const spokenAt: Record<string, number> = {};
    const s = new AnswerSession({
      clock: new PacedClock(() => 170, () => performance.now(), () => 100, () => rate.v),
      onAction: (a, at, live) => d.run(a, at, live),
      onWord: (ws) => { spokenAt[ws[ws.length - 1]] = performance.now(); },
      onState: () => {},
    });
    async function* src() { yield 'one two three four five six {{circle p=1 at=1,1 r=10}} seven eight.'; }
    void s.start(src);
    await vi.advanceTimersByTimeAsync(150); // one, two spoken; seven due at 600; the circle fires at 150 (450ms lead)
    s.pause();
    await vi.advanceTimersByTimeAsync(2000);
    expect(drawn).toEqual([]);
    rate.v = 2;
    s.respeed();
    s.resume();
    await vi.advanceTimersByTimeAsync(3000);
    expect(drawn).toHaveLength(1);
    expect(Math.abs(drawn[0] - spokenAt['seven'])).toBeLessThan(60);
  });
});

// ------------------------------------------------------------------------------------------------

describe('sentence and part helpers', () => {
  const ws = ['A', 'cat.', 'It', 'sat', 'down.', 'Then', 'it', 'left.'];
  it('sentenceStart finds the first word of the sentence a word is in', () => {
    expect(sentenceStart(ws, 0)).toBe(0);
    expect(sentenceStart(ws, 1)).toBe(0);
    expect(sentenceStart(ws, 3)).toBe(2);
    expect(sentenceStart(ws, 7)).toBe(5);
  });
  it('replayTarget: back to this sentence; right after its start, the sentence before', () => {
    expect(replayTarget(ws, 5)).toBe(2); // 'down.' just spoken: replay "It sat down."
    expect(replayTarget(ws, 4)).toBe(2);
    expect(replayTarget(ws, 3)).toBe(0); // one word in ("It"): pressing again steps back
    expect(replayTarget(ws, 1)).toBe(0);
    expect(replayTarget(ws, 0)).toBe(0);
  });
  it('nextSentence: the next sentence start, null when it has not streamed in', () => {
    expect(nextSentence(ws, 3)).toBe(5);
    expect(nextSentence(ws, 2)).toBe(5); // at a boundary: the one after the sentence about to start
    expect(nextSentence(ws, 6)).toBeNull();
  });
  it('partProgress against the words known so far', () => {
    const parts: Part[] = [{ start: 0, page: 1, back: false }, { start: 10, page: 5, back: false }];
    expect(partProgress(parts, 0, 5, 30)).toBe(0.5);
    expect(partProgress(parts, 1, 15, 30)).toBe(0.25);
    expect(partProgress(parts, 1, 40, 30)).toBe(1);
    expect(partProgress(parts, 3, 5, 30)).toBe(0);
  });
});

// Unused import guard for Action (keeps the type import honest in strict builds).
export type _A = Action;
