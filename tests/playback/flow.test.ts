// Flow across the document: pause/resume/seek/hold (scheduler), parts, journeys and unit highlights (director).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Scheduler, RESUME_GAP_MS, SEEK_LAG_MS } from '../../src/playback/scheduler';
import { PacedClock } from '../../src/playback/clock';
import { Director, JOURNEY_HOLD_MS, ARRIVAL_MS, type Journey } from '../../src/playback/director';
import { deriveParts, partAt, partTitle, partText, MIN_PART_WORDS, journeyBeat, returnTarget } from '../../src/playback/parts';
import { pageFrameTop, SAFE_TOP, STACK_PAD, frameFor } from '../../src/desk/layout';
import type { ParsedScript } from '../../src/playback/session';
import type { Action, InkAction, RawAction, ScriptEvent } from '../../src/script/types';
import type { ViewerApi } from '../../src/pdf/viewerApi';
import type { BuildElement, DeskApi, ElementPlan } from '../../src/desk/types';
import { DEFAULTS } from '../../src/settings/settings';
import type { TextRun } from '../../src/locate/locateQuote';
import { sectionFor, pageTitle } from '../../src/pdf/sections';
import { textLines } from '../../src/agent/context/textLines';

const w = (text: string): ScriptEvent => ({ type: 'word', text });
const words = (s: string) => s.split(' ').map(w);
const END: ScriptEvent = { type: 'end' };
const scroll = (page: number): ScriptEvent => ({ type: 'action', action: { kind: 'scroll', page } });

describe('Scheduler pause / resume / seek / hold', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => vi.useRealTimers());

  function make() {
    const log: string[] = [];
    const ats: number[] = [];
    const s = new Scheduler(new PacedClock(() => 170, () => Date.now(), () => 100), {
      onWord: (t, i) => log.push(`${Date.now()}:${t}#${i}`),
      onAction: (a, at) => { log.push(`${Date.now()}:<${a.kind}>`); ats.push(at); },
      onDone: () => log.push(`${Date.now()}:done`),
    });
    return { s, log, ats };
  }

  it('pauses at the current word and resumes from the next one after a breath', () => {
    const { s, log } = make();
    s.push([...words('a b c d e f.'), END]);
    vi.advanceTimersByTime(150); // a, b spoken
    expect(s.pause()).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(log).toEqual(['0:a#0', '100:b#1']);
    expect(s.isPaused()).toBe(true);
    s.resume();
    vi.advanceTimersByTime(5000);
    expect(log.slice(2, 4)).toEqual([`${5150 + RESUME_GAP_MS}:c#2`, `${5250 + RESUME_GAP_MS}:d#3`]);
    expect(log[log.length - 1]).toMatch(/done$/);
  });

  it('wordsBefore counts the words said before an action\'s word, however late the action is handled', () => {
    const { s, ats } = make();
    s.push([scroll(3), ...words('a b c.'), scroll(9), ...words('d e.'), END]);
    vi.advanceTimersByTime(1000); // everything spoken: the layout lane may run the opening scroll only now
    expect(s.wordsBefore(ats[0])).toBe(0); // the opening move: nothing said yet
    expect(s.wordsBefore(ats[1])).toBe(3);
  });

  it('keeps buffering while paused', () => {
    const { s, log } = make();
    s.push(words('one two,'));
    vi.advanceTimersByTime(50);
    s.pause();
    s.push([...words('three four.'), END]);
    vi.advanceTimersByTime(1000);
    expect(log).toEqual(['0:one#0']);
    s.resume();
    vi.advanceTimersByTime(2000);
    expect(log.map((l) => l.split(':')[1])).toEqual(['one#0', 'two,#1', 'three#2', 'four.#3', 'done']);
  });

  it('seeks forward: skipped words show at once, their actions fire fast (behind their word)', () => {
    const { s, log, ats } = make();
    s.push([...words('a b c.'), scroll(9), ...words('d e f.'), END]);
    vi.advanceTimersByTime(50);
    expect(s.seek(4)).toBe(true);
    expect(log).toEqual(['0:a#0', '50:<scroll>', '50:b#1', '50:c.#2', '50:d#3']);
    expect(ats[0]).toBe(50 - SEEK_LAG_MS);
    vi.advanceTimersByTime(RESUME_GAP_MS);
    expect(log[log.length - 1]).toBe(`${50 + RESUME_GAP_MS}:e#4`);
  });

  it('seeks back: the narration repeats from there, actions already fired do not fire again', () => {
    const { s, log } = make();
    s.push([...words('a b c.'), scroll(9), ...words('d e f.'), END]);
    vi.advanceTimersByTime(450); // a b c. <scroll> d e
    const fired = log.filter((l) => l.includes('<')).length;
    s.seek(1);
    vi.advanceTimersByTime(3000);
    expect(log.filter((l) => l.includes('<')).length).toBe(fired);
    const after = log.slice(log.findIndex((l) => l.startsWith('400:e')) + 1).map((l) => l.split(':')[1]);
    expect(after).toEqual(['b#1', 'c.#2', 'd#3', 'e#4', 'f.#5', 'done']);
  });

  it('hold: silence before the first word at or after `at`', () => {
    const { s, log } = make();
    s.push([...words('a b c d.'), END]);
    vi.advanceTimersByTime(10);
    s.hold(200, 800); // word c starts at 200 → 1000
    vi.advanceTimersByTime(3000);
    expect(log.slice(0, 4)).toEqual(['0:a#0', '100:b#1', '1000:c#2', '1100:d.#3']);
  });
});

const script = (events: ScriptEvent[]): ParsedScript => {
  const out: ParsedScript = { words: [], acts: [], ended: false };
  for (const e of events) {
    if (e.type === 'word') out.words.push(e.text);
    else if (e.type === 'action') out.acts.push({ action: e.action, word: out.words.length });
    else out.ended = true;
  }
  return out;
};
const n = (k: number, tag = 'w') => words(Array.from({ length: k }, (_, i) => `${tag}${i}`).join(' '));

describe('deriveParts', () => {
  it('splits at journeys; the short lead-in joins the first part; a return is "back"', () => {
    const s = script([...n(5), scroll(42), ...n(30), scroll(3), ...n(20), END]);
    const parts = deriveParts(s, 3);
    expect(parts).toEqual([{ start: 0, page: 42, back: false }, { start: 35, page: 3, back: true }]);
    expect(partTitle(parts[1], 3)).toBe('Back to p3');
    expect(partTitle(parts[0], 3, 'Confidence intervals')).toBe('Confidence intervals');
    expect(partTitle(parts[0], 3)).toBe('Page 42');
    expect(partAt(parts, 0)).toBe(0);
    expect(partAt(parts, 34)).toBe(0);
    expect(partAt(parts, 35)).toBe(1);
    expect(partText(s, parts, 1).split(' ')).toHaveLength(20);
  });

  it('adjacent pages continue the part; a long lead-in is its own part', () => {
    const s = script([...n(MIN_PART_WORDS + 3), scroll(4), ...n(20), scroll(10), ...n(20), END]);
    expect(deriveParts(s, 3).map((p) => p.page)).toEqual([3, 10]);
  });

  it('a glance (a few words on another page) folds into the part before it', () => {
    const s = script([...n(20), scroll(40), ...n(3), scroll(3), ...n(20), END]);
    expect(deriveParts(s, 3)).toEqual([{ start: 0, page: 3, back: false }]);
  });

  it('while streaming, the last part stays even if it is short so far', () => {
    const s = script([...n(20), scroll(40), ...n(2)]);
    expect(deriveParts(s, 3).map((p) => p.page)).toEqual([3, 40]);
  });

  it('no journey: one part', () => {
    expect(deriveParts(script([...n(50), END]), 7)).toEqual([{ start: 0, page: 7, back: false }]);
  });

  it('an answer that opens by moving to its page is one part on that page', () => {
    expect(deriveParts(script([scroll(3), ...n(50), END]), 1)).toEqual([{ start: 0, page: 3, back: false }]);
  });
});

describe('journey beat and the way back', () => {
  it('a journey needs a far page and words already said: the opening move frames the answer', () => {
    expect(journeyBeat(1, 3, 0)).toBe(false);
    expect(journeyBeat(1, 3, 12)).toBe(true);
    expect(journeyBeat(3, 4, 12)).toBe(false);
  });

  it('"Back to pN" is the page asked on, once the answer has moved on to a later part and the view left it', () => {
    // Opened on p1, the answer moved to p3 before speaking: one part, no way back offered.
    const opening = deriveParts(script([scroll(3), ...n(50), END]), 1);
    expect(returnTarget(1, 3, partAt(opening, 49))).toBeNull();
    // Asked on p9, a journey to p2: offered while p2 plays, gone once the view is back on p9.
    const flow = deriveParts(script([...n(24), scroll(2), ...n(30), scroll(9), ...n(20), END]), 9);
    expect(returnTarget(9, 9, 0)).toBeNull();
    expect(returnTarget(9, 2, partAt(flow, 30))).toBe(9);
    expect(returnTarget(9, 9, partAt(flow, 70))).toBeNull();
    // The student scrolled away during the first part: not the answer's journey, no pill.
    expect(returnTarget(9, 5, 0)).toBeNull();
  });
});

describe('page framing', () => {
  const page = { top: 2000, h: 500 };
  it('split: the page top sits on the board top (SAFE_TOP), with no sliver of the page above', () => {
    for (const split of ['normal', 'wide'] as const) {
      expect(page.top - pageFrameTop(page, 1440, 900, split, 0.5625)).toBe(SAFE_TOP);
      expect(page.top - pageFrameTop(page, 2560, 1440, split, 0.5625)).toBe(SAFE_TOP);
    }
    // Stacked (narrow window): the page's slot padding is skipped too.
    expect(frameFor(700, 900, 'normal', 0.5625).stacked).toBe(true);
    expect(page.top - pageFrameTop(page, 700, 900, 'normal', 0.5625)).toBe(SAFE_TOP + STACK_PAD);
  });
  it('reading: a page that fits is centred between the chrome', () => {
    expect(page.top - pageFrameTop(page, 1440, 900, 'none', 0.5625)).toBeGreaterThan(SAFE_TOP);
  });
});

describe('section labels', () => {
  it('takes the deepest bookmark at or before the page', () => {
    const bm = [{ title: '8 Inference', page: 400, depth: 0 }, { title: '8.1 Confidence intervals', page: 420, depth: 1 }, { title: '8.2 Tests', page: 440, depth: 1 }];
    expect(sectionFor(bm, 422)).toBe('8.1 Confidence intervals');
    expect(sectionFor(bm, 410)).toBe('8 Inference');
    expect(sectionFor(bm, 3)).toBeUndefined();
  });
  it('else the page title: the tallest line near the top', () => {
    const r = (text: string, y: number, h: number): TextRun => ({ text, rect: { x: 50, y, w: 400, h } });
    expect(pageTitle(textLines([r('3', 20, 12), r('The Law of Demand', 50, 34), r('- Other things equal', 150, 20)], 1))).toBe('The Law of Demand');
    expect(pageTitle([])).toBeUndefined();
  });
});

// ------------------------------------------------------------------------------------------------

const SVG = 'http://www.w3.org/2000/svg';
const g = () => document.createElementNS(SVG, 'g') as SVGGElement;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function viewer(page: () => number, runs: TextRun[] = []): ViewerApi {
  const layers = { highlight: g(), agent: g() };
  return {
    numPages: () => 60, currentPage: page, spaceHeight: () => 1000, scale: () => 1,
    layers: () => layers, allLayers: () => [layers], textRuns: async () => runs,
    scrollToPage: vi.fn(async () => {}), ensureVisible: vi.fn(async () => false), isVisible: () => true,
    whenVisible: async () => true, ensureSize: async () => {}, cancelScroll: vi.fn(),
    goToPage: async () => {}, actedPage: () => null, onActedChange: () => () => {}, pageZoom: () => 1, setPageZoom: () => {},
    deskHost: () => { throw new Error('unused'); },
  };
}
function desk(onScroll: (p: number) => void): DeskApi {
  return {
    reset: vi.fn(async () => {}), addRegion: vi.fn(async () => 'unused'), region: () => null,
    reveal: vi.fn(async () => true), isVisible: () => true, whenVisible: async () => true, frameBoth: vi.fn(async () => {}),
    scrollToPage: vi.fn(async (p: number) => { await wait(500); onScroll(p); }), addConnector: vi.fn(() => 'unused'),
    following: () => true, cancel: vi.fn(), abort: vi.fn(),
    state: () => ({ split: 'none', stacked: false, following: true, sketching: false, column: { x: 0, w: 860 } }),
    subscribe: () => () => {},
  } as unknown as DeskApi;
}

describe('Director journeys', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  function make(start = 3, spoken = 10) {
    let page = start;
    const journeys: Journey[] = [];
    const holds: [number, number][] = [];
    const drawn: number[] = [];
    const build: BuildElement = async (a) => ({ target: { page: (a as { page: number }).page }, bbox: { x: 0, y: 0, w: 1, h: 1 }, draw: async () => { drawn.push(performance.now()); } } as ElementPlan);
    const d = new Director({
      viewer: () => viewer(() => page), desk: () => desk((p) => { page = p; }), settings: () => DEFAULTS, onScrolledTo: () => {}, build,
      onJourney: (j) => journeys.push(j), hold: (at, ms) => holds.push([at, ms]), spoken: () => spoken,
    });
    return { d, journeys, holds, drawn };
  }

  it('a move to a page that is not adjacent is a journey: announced, held, and ink waits for the arrival beat', async () => {
    const { d, journeys, holds, drawn } = make(3);
    d.run({ kind: 'scroll', page: 42 }, 450);
    d.run({ kind: 'circle', page: 42, at: { x: 1, y: 1 }, r: 10 } as unknown as RawAction, 450);
    await vi.advanceTimersByTimeAsync(3000);
    expect(journeys).toEqual([{ from: 3, to: 42, at: 450 }]);
    expect(holds).toEqual([[450, JOURNEY_HOLD_MS]]);
    expect(drawn[0]).toBeGreaterThanOrEqual(500 + ARRIVAL_MS);
    // The ink fired before the hold moves with its word: it lands on the word as now spoken.
    expect(drawn[0]).toBeGreaterThanOrEqual(450 + JOURNEY_HOLD_MS);
    expect(drawn[0]).toBeLessThan(450 + JOURNEY_HOLD_MS + 50);
  });

  it('the opening move (before the first word) is no journey: no route, no hold, no arrival rest', async () => {
    const { d, journeys, holds, drawn } = make(1, 0);
    d.run({ kind: 'scroll', page: 3 }, 450);
    d.run({ kind: 'circle', page: 3, at: { x: 1, y: 1 }, r: 10 } as unknown as RawAction, 450);
    await vi.advanceTimersByTimeAsync(3000);
    expect(journeys).toEqual([]);
    expect(holds).toEqual([]);
    expect(drawn[0]).toBeLessThan(500 + ARRIVAL_MS);
  });

  it('a journey frames its page like any scroll (the desk\'s scrollToPage: the viewer\'s pageFrameTop)', async () => {
    const calls: unknown[][] = [];
    let page = 3;
    const dk = desk((p) => { page = p; });
    (dk.scrollToPage as ReturnType<typeof vi.fn>).mockImplementation(async (...args: unknown[]) => { calls.push(args); page = args[0] as number; });
    const d = new Director({ viewer: () => viewer(() => page), desk: () => dk, settings: () => DEFAULTS, onScrolledTo: () => {}, hold: () => {}, spoken: () => 10 });
    d.run({ kind: 'scroll', page: 42 }, 0);
    await vi.advanceTimersByTimeAsync(2000);
    d.run({ kind: 'scroll', page: 43 }, performance.now());
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls).toEqual([[42, undefined], [43, undefined]]);
  });

  it('an adjacent page is not a journey', async () => {
    const { d, journeys, holds } = make(3);
    d.run({ kind: 'scroll', page: 4 }, 0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(journeys).toEqual([]);
    expect(holds).toEqual([]);
  });

  it('a seek\'s fast-forwarded scroll travels without a beat', async () => {
    const { d, journeys } = make(3);
    await vi.advanceTimersByTimeAsync(5000);
    const t = performance.now();
    d.run({ kind: 'scroll', page: 42 }, t - 1500);
    await vi.advanceTimersByTimeAsync(2000);
    expect(journeys).toEqual([]);
  });
});

describe('Director unit highlights', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  const run = (text: string, x: number, y: number, w: number, h = 20): TextRun => ({ text, rect: { x, y, w, h } });
  const runs = [
    run('We reject the null when the statistic is extreme. To decide, compare the', 50, 100, 880),
    run('p-value and the significance level alpha. A small p-value is evidence', 50, 128, 860),
  ];

  function make(units?: boolean) {
    const built: InkAction[] = [];
    const order: string[] = [];
    const build: BuildElement = async (a) => {
      built.push(a);
      return { target: { page: 1 }, bbox: { x: 0, y: 0, w: 1, h: 1 }, draw: async () => { order.push(`${a.kind}:${(a as { quote: string }).quote}`); } } as ElementPlan;
    };
    const d = new Director({ viewer: () => viewer(() => 1, runs), desk: () => desk(() => {}), settings: () => DEFAULTS, onScrolledTo: () => {}, build, ...(units === false ? { units } : {}) });
    return { d, built, order };
  }

  it('a fragment is marked as its sentence (line by line), then the quoted words again; the id stays on the quote', async () => {
    const { d, order, built } = make();
    const hl: Action = { kind: 'highlight', page: 1, quote: 'compare the p-value and', id: 'cmp' } as Action;
    d.run(hl, 0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(order).toEqual(['highlight:to decide, compare the', 'highlight:pvalue and the significance level alpha.', 'highlight:compare the p-value and']);
    expect(built.filter((a) => 'id' in a && (a as { id?: string }).id === 'cmp')).toHaveLength(1);
  });

  it('an underlined fragment underlines the unit and highlights the words', async () => {
    const { d, order } = make();
    d.run({ kind: 'underline', page: 1, quote: 'is evidence against' } as unknown as Action, 0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(order[0]).toMatch(/^underline:a small pvalue is evidence/);
    expect(order[order.length - 1]).toBe('highlight:is evidence against');
  });

  it('a term stays as quoted; units can be turned off', async () => {
    const a = make();
    a.d.run({ kind: 'highlight', page: 1, quote: 'alpha' } as Action, 0);
    await vi.advanceTimersByTimeAsync(500);
    expect(a.order).toEqual(['highlight:alpha']);
    const b = make(false);
    b.d.run({ kind: 'highlight', page: 1, quote: 'compare the p-value and' } as Action, 0);
    await vi.advanceTimersByTimeAsync(500);
    expect(b.order).toEqual(['highlight:compare the p-value and']);
  });
});
