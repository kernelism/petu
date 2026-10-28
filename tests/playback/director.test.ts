// tests/playback/director.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Director, backlog, STAGGER_MS, ACTION_TIMEOUT_MS, LAND_MS, type ActionTiming } from '../../src/playback/director';
import type { ViewerApi } from '../../src/pdf/viewerApi';
import type { BuildElement, DeskApi, ElementPlan, RegionInfo } from '../../src/desk/types';
import { DEFAULTS } from '../../src/settings/settings';
import type { Action, InkAction } from '../../src/script/types';

const SVG = 'http://www.w3.org/2000/svg';
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const g = () => document.createElementNS(SVG, 'g') as SVGGElement;

function fakeViewer(over: Partial<ViewerApi> = {}): ViewerApi {
  const layers = { highlight: g(), agent: g() };
  return {
    numPages: () => 3, currentPage: () => 1, spaceHeight: () => 1294, scale: () => 0.8,
    layers: () => layers, allLayers: () => [layers], textRuns: async () => [],
    scrollToPage: vi.fn(async () => {}), ensureVisible: vi.fn(async () => false), isVisible: () => true,
    whenVisible: async () => true, ensureSize: async () => {}, cancelScroll: vi.fn(),
    deskHost: () => { throw new Error('the director never touches the desk host'); },
    ...over,
  };
}

function fakeDesk(over: Partial<DeskApi> = {}): DeskApi {
  const regions = new Map<string, RegionInfo>();
  return {
    reset: vi.fn(async (_ms: number, _opts?: { keepLanes?: boolean }) => { regions.clear(); }),
    addRegion: vi.fn(async (s) => { await wait(420); const r = { ...s, mode: 'right' as const, layers: { highlight: g(), agent: g() }, scale: () => 0.5 }; regions.set(s.id, r); return r; }),
    region: (id) => regions.get(id) ?? null,
    reveal: vi.fn(async () => { await wait(400); return true; }),
    isVisible: () => true,
    whenVisible: async () => true,
    frameBoth: vi.fn(async () => { await wait(300); }),
    scrollToPage: vi.fn(async () => { await wait(500); }),
    addConnector: vi.fn(() => 'unused'),
    following: () => true,
    cancel: vi.fn(),
    state: () => ({ mode: 'c', following: true, sketching: false, column: { x: 0, w: 860 } }),
    subscribe: () => () => {},
    ...over,
  };
}

/** A build that resolves at once; its draw takes `ms` (or ends on abort). Records when draw started. */
function fakeBuild(ms = 300, also = false) {
  const drawStarts = new Map<InkAction, number>();
  const aborted = new Set<InkAction>();
  const builtAt = new Map<InkAction, number>();
  const build: BuildElement = async (a) => {
    builtAt.set(a, performance.now());
    if (a.kind === 'emph' && a.ref === 'ghost') return 'unknown id';
    const target = a.kind === 'connect' || 'ref' in a ? { page: 1 } : a.region != null ? { region: a.region } : { page: a.page! };
    const plan: ElementPlan = {
      target, bbox: { x: 0, y: 0, w: 10, h: 10 },
      ...(also || a.kind === 'connect' ? { also: { target: { region: 'side' }, bbox: { x: 0, y: 0, w: 5, h: 5 } } } : {}),
      draw: (signal) => {
        drawStarts.set(a, performance.now());
        return new Promise<void>((r) => {
          const t = setTimeout(r, ms);
          signal.addEventListener('abort', () => { aborted.add(a); clearTimeout(t); r(); });
        });
      },
    };
    return plan;
  };
  return { build, drawStarts, aborted, builtAt };
}

function make(o: { viewer?: ViewerApi; desk?: DeskApi; build?: BuildElement } = {}) {
  const started = new Map<Action, number>();
  const ended = new Map<Action, ActionTiming>();
  const desk = o.desk ?? fakeDesk();
  const d = new Director({
    viewer: () => o.viewer ?? fakeViewer(),
    desk: () => desk,
    settings: () => DEFAULTS,
    onScrolledTo: () => {},
    build: o.build ?? fakeBuild().build,
    onTiming: (t) => {
      if (t.endedAt != null) ended.set(t.action, t);
      else if (!Number.isNaN(t.startedAt)) started.set(t.action, t.startedAt);
    },
  });
  return { d, started, ended, desk };
}

const line = (x = 0): InkAction => ({ kind: 'line', page: 1, from: { x, y: 0 }, to: { x: 900, y: 900 } });
const rline = (region = 'side'): InkAction => ({ kind: 'line', region, from: { x: 0, y: 0 }, to: { x: 100, y: 100 } });
const sketch: Action = { kind: 'sketch', id: 'side', page: 1, size: 'm', place: 'auto' };

describe('Director timing (unchanged guarantees)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('compresses ink that runs behind its word', () => {
    expect(backlog(0)).toEqual({ speed: 1 });
    expect(backlog(400).speed).toBeCloseTo(0.5);
    expect(backlog(1000)).toEqual({ speed: 0.35 });
    expect(backlog(1300)).toEqual({ speed: 0.35, fadeMs: 120 });
  });
  it('ink actions sharing a word start together, staggered in order', async () => {
    const { d, started } = make();
    const a = line(1), b = line(2), c = line(3);
    d.run(a, 0); d.run(b, 0); d.run(c, 0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(started.get(a)).toBeLessThan(5);
    expect(started.get(b)).toBeCloseTo(STAGGER_MS, -1);
    expect(started.get(c)).toBeCloseTo(2 * STAGGER_MS, -1);
  });
  it('ink does not wait for earlier ink: each starts on its own word', async () => {
    const { d, started } = make({ build: fakeBuild(700).build });
    const a = line(1), b = line(2);
    d.run(a, 0); d.run(b, 200);
    await vi.advanceTimersByTimeAsync(2000);
    expect(started.get(b)! - 200).toBeLessThan(20);
  });
  it('an action that arrives ahead of its word starts on the word', async () => {
    const { d, started } = make();
    const a = line();
    d.run(a, 450);
    await vi.advanceTimersByTimeAsync(1000);
    expect(started.get(a)! - 450).toBeGreaterThanOrEqual(0);
    expect(started.get(a)! - 450).toBeLessThan(20);
  });
  it('a hung build times out without blocking the next action', async () => {
    const hang: BuildElement = (a) => (a.kind === 'highlight' ? new Promise(() => {}) : fakeBuild().build(a, {} as never));
    const { d, started, ended } = make({ build: hang });
    const hung: Action = { kind: 'highlight', page: 1, quote: 'x' };
    const next = line();
    d.run(hung, 0); d.run(next, 100);
    await vi.advanceTimersByTimeAsync(ACTION_TIMEOUT_MS + 200);
    expect(started.get(next)! - 100).toBeLessThan(20);
    expect(ended.get(hung)?.skipped).toBe('timeout');
  });
});

describe('Director timing (carried over from the old suite)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('ink waits for the layout queued before it, but only until its target is on screen', async () => {
    let visible: () => void = () => {};
    const desk = fakeDesk({
      scrollToPage: vi.fn(() => wait(600)),
      whenVisible: () => new Promise<boolean>((r) => { visible = () => r(true); }),
    });
    const { d, started, ended } = make({ desk });
    const scroll: Action = { kind: 'scroll', page: 2 };
    const a = line();
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
    const { d, started } = make();
    const s1: Action = { kind: 'scroll', page: 2 }, s2: Action = { kind: 'scroll', page: 3 };
    d.run(s1, 0); d.run(s2, 0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(started.get(s2)! - started.get(s1)!).toBeGreaterThanOrEqual(500);
  });
  it('idle() resolves once every action has finished; stop() resolves it and cancels pans', async () => {
    const { d, desk } = make();
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
    expect(desk.cancel).toHaveBeenCalled();
  });
  it('begin() holds the first action until the old ink has faded', async () => {
    const { d, started } = make();
    void d.begin(300);
    const a = line();
    d.run(a, 0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(started.get(a)).toBeGreaterThanOrEqual(300);
  });
  it('ink far behind its word is drawn with a fade-in pace', async () => {
    const paces: { speed: number; fadeMs?: number }[] = [];
    const build: BuildElement = async () => ({ target: { page: 1 }, bbox: { x: 0, y: 0, w: 1, h: 1 }, draw: async (_s, k) => { paces.push(k); } });
    const { d } = make({ build });
    await vi.advanceTimersByTimeAsync(2000);
    d.run(line(), 0); // 2s late
    await vi.advanceTimersByTimeAsync(400);
    expect(paces).toEqual([{ speed: 0.35, fadeMs: 120 }]);
  });
});

describe('Director on the desk', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('sketch is a layout step: region ink waits for it, then starts on its word', async () => {
    const { d, started, desk } = make();
    const a = rline();
    d.run(sketch, 0);
    d.run(a, 450);
    await vi.advanceTimersByTimeAsync(1000);
    expect(desk.addRegion).toHaveBeenCalledOnce();
    expect(started.get(a)! - 450).toBeGreaterThanOrEqual(0);
    expect(started.get(a)! - 450).toBeLessThan(20);
  });
  it('region ink is built on its word (text written just before is measurable); page ink ahead of it', async () => {
    const fb = fakeBuild();
    const { d } = make({ build: fb.build });
    const r = rline(), p = line();
    d.run(sketch, 0);
    d.run(r, 600); d.run(p, 600 + STAGGER_MS * 5);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fb.builtAt.get(r)).toBeGreaterThanOrEqual(600);
    expect(fb.builtAt.get(p)).toBeLessThan(600);
  });
  it('ink into an unknown region is skipped (rule 4)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const desk = fakeDesk({ region: () => null });
    const { d, ended } = make({ desk, build: (a, env) => env.ctx({ region: 'nope' }).then((c) => (typeof c === 'string' ? c : fakeBuild().build(a, env))) });
    const a = rline('nope');
    d.run(a, 0);
    await vi.advanceTimersByTimeAsync(500);
    expect(ended.get(a)?.skipped).toBe('unknown region');
  });
  it('a third sketch is skipped when the desk refuses it (rule 8)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const desk = fakeDesk({ addRegion: vi.fn(async () => 'max 2 regions per answer') });
    const { d, ended } = make({ desk });
    d.run(sketch, 0);
    await vi.advanceTimersByTimeAsync(100);
    expect(ended.get(sketch)?.skipped).toBe('max 2 regions per answer');
  });
  it('reveals an off-screen element through the layout lane before drawing (rules 1, 2)', async () => {
    const desk = fakeDesk({ isVisible: () => false, whenVisible: () => wait(200).then(() => true) });
    const { d, started } = make({ desk });
    const a = line();
    d.run(a, 0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(desk.reveal).toHaveBeenCalledOnce();
    expect(started.get(a)).toBeGreaterThanOrEqual(200);
    expect(started.get(a)).toBeLessThan(260);
  });
  it('lands ink in flight before the view moves: no stroke is split across a pan (rule 1)', async () => {
    const fb = fakeBuild(700);
    const order: string[] = [];
    const desk = fakeDesk({ scrollToPage: vi.fn(async () => { order.push(`pan@${performance.now()}`); }) });
    const { d } = make({ desk, build: fb.build });
    const a = line();
    d.run(a, 0);
    await vi.advanceTimersByTimeAsync(100);
    d.run({ kind: 'scroll', page: 2 }, 100);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fb.aborted.has(a)).toBe(true); // completed at once…
    expect(order[0]).toBe(`pan@${100 + LAND_MS}`); // …LAND_MS after the pan was due, then the pan
  });
  it('while the student drives, nothing pans and ink starts on its word anyway (rule 6)', async () => {
    const desk = fakeDesk({ following: () => false, isVisible: () => false, whenVisible: () => new Promise(() => {}) });
    const { d, started } = make({ desk });
    const a = line();
    d.run({ kind: 'scroll', page: 2 }, 0);
    d.run(a, 300);
    await vi.advanceTimersByTimeAsync(1000);
    expect(desk.reveal).not.toHaveBeenCalled();
    expect(started.get(a)! - 300).toBeLessThan(20);
  });
  it('a connector frames both ends before it draws (rule 3)', async () => {
    const fb = fakeBuild();
    const { d, desk } = make({ build: fb.build });
    const c: Action = { kind: 'connect', from: { page: 1, at: { x: 1, y: 1 } }, to: { region: 'side', ref: 'x' } };
    d.run(c, 0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(desk.frameBoth).toHaveBeenCalledOnce();
    expect(fb.drawStarts.get(c as InkAction)).toBeGreaterThanOrEqual(300);
  });
  it('references are built on their word and skip when unknown (rule 4)', async () => {
    const fb = fakeBuild();
    const { d, ended } = make({ build: fb.build });
    const e: Action = { kind: 'emph', ref: 'ghost' };
    d.run(e, 500);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fb.builtAt.get(e as InkAction)).toBeGreaterThanOrEqual(500);
    expect(ended.get(e)?.skipped).toBe('unknown id');
  });
  it('begin clears the registry but leaves the desk until the new answer first acts (rule 8)', async () => {
    const { d, desk } = make();
    d.registry.define({ id: 'x', kind: 'point', target: { region: 'side' }, bbox: { x: 0, y: 0, w: 1, h: 1 }, boxes: [], anchor: { x: 0, y: 0 }, group: g() });
    void d.begin(300);
    expect(d.registry.get('x')).toBeUndefined();
    await vi.advanceTimersByTimeAsync(400);
    expect(desk.reset).not.toHaveBeenCalled();
  });
  it('the new answer\'s first ink resets the desk, then draws on its word', async () => {
    const { d, desk, started } = make();
    void d.begin(300);
    await vi.advanceTimersByTimeAsync(400);
    const a = line();
    d.run(a, 400 + 450);
    await vi.advanceTimersByTimeAsync(1000);
    expect(desk.reset).toHaveBeenCalledOnce();
    expect(desk.reset).toHaveBeenCalledWith(300);
    expect(started.get(a)! - 850).toBeGreaterThanOrEqual(0);
    expect(started.get(a)! - 850).toBeLessThan(20);
    d.run(line(5), 1500);
    await vi.advanceTimersByTimeAsync(1000);
    expect(desk.reset).toHaveBeenCalledOnce(); // only the first action resets
  });
  it('a first scroll resets the desk before it pans', async () => {
    const order: string[] = [];
    const desk = fakeDesk({ reset: vi.fn(async () => { order.push('reset'); }), scrollToPage: vi.fn(async () => { order.push('scroll'); }) });
    const { d } = make({ desk });
    void d.begin(300);
    d.run({ kind: 'scroll', page: 2 }, 0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(desk.reset).toHaveBeenCalledWith(300);
    expect(order).toEqual(['reset', 'scroll']);
  });
  it('a first sketch keeps the lanes: it resets with keepLanes right before placing its region', async () => {
    const order: string[] = [];
    const desk = fakeDesk({
      reset: vi.fn(async () => { order.push('reset'); }),
      addRegion: vi.fn(async (s) => { order.push('add'); return { ...s, mode: 'right' as const, layers: { highlight: g(), agent: g() }, scale: () => 0.5 }; }),
    });
    const { d } = make({ desk });
    void d.begin(300);
    d.run(sketch, 0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(desk.reset).toHaveBeenCalledOnce();
    expect(desk.reset).toHaveBeenCalledWith(300, { keepLanes: true });
    expect(order).toEqual(['reset', 'add']);
  });
  it('an answer that ends or is stopped without actions leaves the desk as is', async () => {
    const { d, desk } = make();
    void d.begin(300);
    await vi.advanceTimersByTimeAsync(400);
    await d.idle();
    d.stop();
    d.run(line(), 500);
    await vi.advanceTimersByTimeAsync(1000);
    expect(desk.reset).not.toHaveBeenCalled();
  });
  it('stop cancels a pan in flight', () => {
    const { d, desk } = make();
    d.stop();
    expect(desk.cancel).toHaveBeenCalled();
  });
});
