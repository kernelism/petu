import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Director, backlog, STAGGER_MS, ACTION_TIMEOUT_MS, BOARD_INK_WAIT_MS, type ActionTiming } from '../../src/playback/director';
import type { ViewerApi } from '../../src/pdf/viewerApi';
import type { TextRun } from '../../src/locate/locateQuote';
import { DEFAULTS, type Settings } from '../../src/settings/settings';
import type { Action } from '../../src/script/types';

const SVG = 'http://www.w3.org/2000/svg';
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const g = () => document.createElementNS(SVG, 'g') as SVGGElement;

function fakeViewer(over: Partial<ViewerApi> = {}) {
  const layers = { highlight: g(), agent: g() };
  const runs: TextRun[] = [{ text: 'hello world', rect: { x: 100, y: 100, w: 200, h: 20 } }];
  const v: ViewerApi = {
    numPages: () => 3,
    currentPage: () => 1,
    spaceHeight: () => 1294,
    scale: () => 0.8,
    layers: () => layers,
    allLayers: () => [layers],
    textRuns: async () => runs,
    scrollToPage: vi.fn(() => wait(500)),
    ensureVisible: vi.fn(async () => false),
    isVisible: () => true,
    whenVisible: async () => true,
    ensureSize: async () => {},
    cancelScroll: vi.fn(),
    glideColumn: async () => {},
    ...over,
  };
  return v;
}

const circle = (x = 100): Action => ({ kind: 'circle', page: 1, at: { x, y: 100 }, rx: 20, ry: 20 });
const line = (): Action => ({ kind: 'line', page: 1, from: { x: 0, y: 0 }, to: { x: 900, y: 900 } });

function make(v: ViewerApi, extra: Partial<ConstructorParameters<typeof Director>[0]> = {}, settings: Partial<Settings> = {}) {
  const started = new Map<Action, number>();
  const ended = new Map<Action, ActionTiming>();
  const d = new Director({
    viewer: () => v,
    settings: () => ({ ...DEFAULTS, ...settings }),
    onScrolledTo: () => {},
    onTiming: (t) => {
      if (t.endedAt != null) ended.set(t.action, t);
      else if (!Number.isNaN(t.startedAt)) started.set(t.action, t.startedAt);
    },
    ...extra,
  });
  return { d, started, ended };
}

describe('Director', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => vi.useRealTimers());

  it('compresses ink that runs behind its word', () => {
    expect(backlog(0)).toEqual({ speed: 1 });
    expect(backlog(400).speed).toBeCloseTo(0.5);
    expect(backlog(1000)).toEqual({ speed: 0.35 });
    expect(backlog(1300)).toEqual({ speed: 0.35, fadeMs: 120 });
  });

  it('ink actions sharing a word start together, staggered in order', async () => {
    const { d, started } = make(fakeViewer());
    const a = circle(100), b = circle(300), c = line();
    const t0 = performance.now();
    d.run(a, t0); d.run(b, t0); d.run(c, t0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(started.get(a)! - t0).toBeLessThan(5);
    expect(started.get(b)! - t0).toBeCloseTo(STAGGER_MS, -1);
    expect(started.get(c)! - t0).toBeCloseTo(2 * STAGGER_MS, -1);
  });

  it('ink does not wait for earlier ink: each starts on its own word', async () => {
    const { d, started } = make(fakeViewer());
    const long = line(), next = circle();
    d.run(long, 0);
    d.run(next, 200); // the line takes ~700ms to draw
    await vi.advanceTimersByTimeAsync(2000);
    expect(started.get(long)).toBeLessThan(5);
    expect(started.get(next)! - 200).toBeLessThan(20);
  });

  it('an action that arrives ahead of its word starts on the word', async () => {
    const { d, started } = make(fakeViewer());
    const a = circle();
    d.run(a, 450);
    await vi.advanceTimersByTimeAsync(1000);
    expect(started.get(a)! - 450).toBeGreaterThanOrEqual(0);
    expect(started.get(a)! - 450).toBeLessThan(20);
  });

  it('ink waits for the layout queued before it, but only until its target is on screen', async () => {
    let visible: () => void = () => {};
    const v = fakeViewer({
      scrollToPage: vi.fn(() => wait(600)),
      whenVisible: () => new Promise<boolean>((r) => { visible = () => r(true); }),
    });
    const { d, started, ended } = make(v);
    const scroll: Action = { kind: 'scroll', page: 2 };
    const a = circle();
    d.run(scroll, 0);
    d.run(a, 0);
    await vi.advanceTimersByTimeAsync(250);
    expect(started.has(a)).toBe(false);
    visible();
    await vi.advanceTimersByTimeAsync(20);
    expect(started.get(a)! - 250).toBeLessThan(20); // mid-glide
    expect(ended.has(scroll)).toBe(false);
  });

  it('layout actions run one after another', async () => {
    const v = fakeViewer();
    const { d, started } = make(v);
    const s1: Action = { kind: 'scroll', page: 2 }, s2: Action = { kind: 'scroll', page: 3 };
    d.run(s1, 0); d.run(s2, 0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(started.get(s2)! - started.get(s1)!).toBeGreaterThanOrEqual(500);
  });

  it('reveals an off-screen target through the layout lane before drawing', async () => {
    const v = fakeViewer({ isVisible: () => false, whenVisible: () => wait(200).then(() => true), ensureVisible: vi.fn(() => wait(450).then(() => true)) });
    const { d, started } = make(v);
    const a = circle();
    d.run(a, 0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(v.ensureVisible).toHaveBeenCalledTimes(1);
    expect(started.get(a)).toBeGreaterThanOrEqual(200);
    expect(started.get(a)).toBeLessThan(260);
  });

  it('board ink waits at most BOARD_INK_WAIT_MS for the board to open', async () => {
    const openBoard = vi.fn(() => wait(420));
    const b = { layers: () => ({ highlight: g(), agent: g() }), textRuns: () => [], scale: () => 1, write: vi.fn(async () => {}) };
    const { d, started } = make(fakeViewer(), { openBoard, board: () => b });
    const write: Action = { kind: 'write', page: 0, at: { x: 10, y: 10 }, text: 'hi', size: 'm' };
    d.run({ kind: 'board' }, 0);
    d.run(write, 0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(started.get(write)).toBeLessThanOrEqual(BOARD_INK_WAIT_MS + 5);
    expect(b.write).toHaveBeenCalledTimes(1);
  });

  it('a hung text lookup times out without blocking the next action', async () => {
    const v = fakeViewer({ textRuns: () => new Promise<TextRun[]>(() => {}) });
    const { d, started, ended } = make(v);
    const hung: Action = { kind: 'highlight', page: 1, quote: 'hello' };
    const next = circle();
    d.run(hung, 0);
    d.run(next, 100);
    await vi.advanceTimersByTimeAsync(500);
    expect(started.get(next)! - 100).toBeLessThan(20);
    await vi.advanceTimersByTimeAsync(ACTION_TIMEOUT_MS);
    expect(ended.get(hung)?.skipped).toBe('timeout');
  });

  it('idle() resolves once every action has finished; stop() resolves it and cancels glides', async () => {
    const v = fakeViewer();
    const { d } = make(v);
    let idle = false;
    d.run(line(), 0);
    d.run({ kind: 'scroll', page: 2 }, 0);
    void d.idle().then(() => { idle = true; });
    await vi.advanceTimersByTimeAsync(300);
    expect(idle).toBe(false);
    await vi.advanceTimersByTimeAsync(1500);
    expect(idle).toBe(true);

    let idle2 = false;
    d.run({ kind: 'scroll', page: 3 }, performance.now());
    void d.idle().then(() => { idle2 = true; });
    await vi.advanceTimersByTimeAsync(50);
    d.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(idle2).toBe(true);
    expect(v.cancelScroll).toHaveBeenCalled();
  });

  it('begin() holds the first action until the old ink has faded', async () => {
    const { d, started } = make(fakeViewer());
    void d.begin(300);
    const a = circle();
    d.run(a, 0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(started.get(a)).toBeGreaterThanOrEqual(300);
  });

  it('ink far behind its word fades in quickly instead of tracing', async () => {
    const { d, ended } = make(fakeViewer());
    const a = line();
    vi.setSystemTime(0);
    await vi.advanceTimersByTimeAsync(2000);
    d.run(a, 0); // 2s late
    await vi.advanceTimersByTimeAsync(400);
    const t = ended.get(a)!;
    expect(t.endedAt! - t.startedAt).toBeLessThan(200);
  });
});
