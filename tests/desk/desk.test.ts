// tests/desk/desk.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Desk, type DeskHost } from '../../src/desk/Desk';
import { column, computeLayout, type Lanes } from '../../src/desk/layout';
import { Director } from '../../src/playback/director';
import { DEFAULTS } from '../../src/settings/settings';
import type { ViewerApi } from '../../src/pdf/viewerApi';
import type { BuildElement } from '../../src/desk/types';

/** A viewer stand-in: real layout math, no pdf.js. */
function fakeHost(W = 1440, H = 900, pages = 5) {
  const aspects = new Float64Array(pages).fill(9 / 16);
  const s = { W, H, top: 0, lanes: { left: 0, right: 0 } as Lanes, gaps: new Map<number, number>() as ReadonlyMap<number, number> };
  const cbs = { layout: new Set<() => void>(), scroll: new Set<() => void>(), user: new Set<() => void>(), card: new Set<() => void>() };
  const sub = (set: Set<() => void>) => (cb: () => void) => { set.add(cb); return () => { set.delete(cb); }; };
  const layer = document.createElement('div');
  const layout = () => computeLayout(column(s.W, s.lanes), aspects, s.gaps);
  const host: DeskHost & { s: typeof s; resize(W: number, H: number): void; user(): void } = {
    s,
    viewport: () => ({ W: s.W, H: s.H }),
    layout,
    scrollTop: () => s.top,
    maxScroll: () => Math.max(0, layout().total - s.H),
    aspect: () => 9 / 16,
    layer: () => layer,
    setColumn: vi.fn(async (lanes: Lanes, gaps: ReadonlyMap<number, number>) => { s.lanes = lanes; s.gaps = gaps; }),
    glideTo: vi.fn(async (top: () => number) => { s.top = top(); cbs.scroll.forEach((f) => f()); }),
    cancelGlide: vi.fn(),
    scrollToPage: vi.fn(async () => {}),
    setCard: vi.fn(async () => {}),
    onLayout: sub(cbs.layout),
    onScroll: sub(cbs.scroll),
    onUserIntent: sub(cbs.user),
    onCardClick: sub(cbs.card),
    resize(W: number, H: number) { s.W = W; s.H = H; cbs.layout.forEach((f) => f()); },
    user() { cbs.user.forEach((f) => f()); },
  };
  return host;
}

const spec = (id: string, page = 2, o: object = {}) => ({ id, page, size: 'm' as const, place: 'auto' as const, ...o });
const flush = () => vi.advanceTimersByTimeAsync(10);

describe('Desk', () => {
  let stage: HTMLDivElement;
  beforeEach(() => { vi.useFakeTimers(); stage = document.createElement('div'); });
  afterEach(() => vi.useRealTimers());

  it('places a region beside its page on the desk layer, reserving a lane', async () => {
    const h = fakeHost();
    const d = new Desk(h, stage);
    const r = await d.addRegion(spec('side'));
    expect(typeof r).not.toBe('string');
    expect(h.setColumn).toHaveBeenCalledOnce();
    expect((r as { mode: string }).mode).toBe('right');
    const el = h.layer().querySelector('.desk-region') as HTMLElement;
    expect(el.classList.contains('is-shown')).toBe(true);
    const L = h.layout()!;
    expect(parseFloat(el.style.left)).toBeGreaterThan(L.pageX + L.pageW);
  });
  it('refuses a third region (rule 8) and a duplicate id', async () => {
    const d = new Desk(fakeHost(1920, 1080), stage);
    await d.addRegion(spec('a'));
    expect(await d.addRegion(spec('a'))).toBe('duplicate region id');
    await d.addRegion(spec('b'));
    expect(await d.addRegion(spec('c'))).toBe('max 2 regions per answer');
  });
  it('size l takes the stage (B) with its page on the card', async () => {
    const h = fakeHost();
    const d = new Desk(h, stage);
    await d.addRegion(spec('big', 3, { size: 'l' }));
    expect(d.state().mode).toBe('b');
    expect(d.state().card).toBe(3);
    expect(h.setCard).toHaveBeenCalledWith(expect.objectContaining({ page: 3 }), expect.any(Number));
    expect(stage.querySelector('.desk-region')).not.toBeNull();
  });
  it('resizing while in B refits the card at once; asking for the same stage again does not re-enter', async () => {
    const h = fakeHost();
    const d = new Desk(h, stage);
    await d.addRegion(spec('big', 3, { size: 'l' }));
    vi.mocked(h.setCard).mockClear();
    await d.resume();
    await d.reveal({ region: 'big' }, { x: 0, y: 0, w: 1000, h: 700 });
    expect(h.setCard).not.toHaveBeenCalled();
    h.resize(1280, 800);
    await flush();
    expect(d.state().mode).toBe('b');
    expect(h.setCard).toHaveBeenCalledWith(expect.objectContaining({ page: 3, rect: expect.objectContaining({ x: expect.any(Number) }) }), 0);
  });
  it('resizing moves a region between C and B with the same ink nodes (rule 7)', async () => {
    const h = fakeHost();
    const d = new Desk(h, stage);
    const r = (await d.addRegion(spec('side', 2, { place: 'right' }))) as { layers: { agent: SVGGElement } };
    const mark = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    r.layers.agent.appendChild(mark);
    h.resize(1024, 768);
    await flush();
    expect(d.region('side')!.mode).toBe('b');
    expect(stage.contains(r.layers.agent)).toBe(true);
    expect(r.layers.agent.contains(mark)).toBe(true);
    h.resize(1440, 900);
    await flush();
    expect(d.region('side')!.mode).toBe('right');
    expect(h.layer().contains(mark)).toBe(true);
  });
  it('reveal scrolls a region that is off screen; nothing moves when it is visible', async () => {
    const h = fakeHost();
    const d = new Desk(h, stage);
    await d.addRegion(spec('side', 4));
    const box = { x: 0, y: 0, w: 1000, h: 700 };
    expect(d.isVisible({ region: 'side' }, box)).toBe(false);
    expect(await d.reveal({ region: 'side' }, box)).toBe(true);
    expect(d.isVisible({ region: 'side' }, box)).toBe(true);
    expect(await d.reveal({ region: 'side' }, box)).toBe(false);
  });
  it('in B, pointing at another page swaps the card; a C region leaves B first (rule 2)', async () => {
    const h = fakeHost();
    const d = new Desk(h, stage);
    await d.addRegion(spec('big', 3, { size: 'l' }));
    await d.reveal({ page: 1 }, { x: 0, y: 0, w: 10, h: 10 });
    expect(d.state().card).toBe(1);
    await d.addRegion(spec('side', 1, { place: 'right' }));
    await d.reveal({ region: 'side' }, { x: 0, y: 0, w: 10, h: 10 });
    expect(d.state().mode).toBe('c');
  });
  it('frameBoth scrolls to both when they fit, else promotes the region to B (rule 3)', async () => {
    const h = fakeHost();
    const d = new Desk(h, stage);
    await d.addRegion(spec('side', 4));
    await d.frameBoth({ t: { page: 4 }, r: { x: 100, y: 100, w: 10, h: 10 } }, { t: { region: 'side' }, r: { x: 10, y: 10, w: 10, h: 10 } });
    expect(d.state().mode).toBe('c');
    expect(h.glideTo).toHaveBeenCalled();
    const tall = fakeHost(1440, 520);
    const d2 = new Desk(tall, stage);
    await d2.addRegion(spec('side', 2, { place: 'below' }));
    await d2.frameBoth({ t: { page: 2 }, r: { x: 100, y: 0, w: 10, h: 10 } }, { t: { region: 'side' }, r: { x: 10, y: 650, w: 10, h: 10 } });
    expect(d2.region('side')!.mode).toBe('b');
    expect(d2.state().card).toBe(2);
  });
  it('the student taking over stops all view moves until resume (rule 6)', async () => {
    const h = fakeHost();
    const d = new Desk(h, stage);
    d.follow.setAnswering(true);
    await d.addRegion(spec('side', 4));
    h.user();
    expect(d.following()).toBe(false);
    expect(await d.reveal({ region: 'side' }, { x: 0, y: 0, w: 1000, h: 700 })).toBe(false);
    expect(h.glideTo).not.toHaveBeenCalled();
    await d.resume();
    expect(d.following()).toBe(true);
    expect(h.glideTo).toHaveBeenCalledOnce();
  });
  it('a connector is routed on the desk and re-routed on relayout', async () => {
    const h = fakeHost();
    const d = new Desk(h, stage);
    await d.addRegion(spec('side', 2));
    const c = d.addConnector({ t: { page: 2 }, r: { x: 300, y: 200, w: 20, h: 20 } }, { t: { region: 'side' }, r: { x: 100, y: 100, w: 10, h: 10 } });
    expect(typeof c).not.toBe('string');
    const handle = c as { group: SVGGElement; stroke: { x: number }[] };
    const L = h.layout()!;
    expect(handle.stroke[0].x).toBeLessThan(L.pageX + L.pageW);
    expect(handle.stroke.at(-1)!.x).toBeGreaterThan(L.pageX + L.pageW);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    handle.group.appendChild(path);
    h.resize(1600, 900);
    await flush();
    expect(path.getAttribute('d')).toMatch(/^M/);
  });
  it('reset clears regions and wires, leaves B and collapses the lanes (rule 8)', async () => {
    const h = fakeHost();
    const d = new Desk(h, stage);
    await d.addRegion(spec('big', 3, { size: 'l' }));
    const p = d.reset(300);
    await vi.advanceTimersByTimeAsync(300);
    await p;
    expect(d.region('big')).toBeNull();
    expect(d.state().mode).toBe('c');
    expect(stage.querySelector('.desk-region')).toBeNull();
    expect(h.s.lanes).toEqual({ left: 0, right: 0 });
  });
  it('reset with keepLanes clears regions and leaves B but keeps the column, so the next sketch glides once', async () => {
    const h = fakeHost();
    const d = new Desk(h, stage);
    await d.addRegion(spec('side', 2, { place: 'right' }));
    await d.addRegion(spec('big', 3, { size: 'l' }));
    expect(d.state().mode).toBe('b');
    const lanes = { ...h.s.lanes };
    expect(lanes.right).toBeGreaterThan(0);
    vi.mocked(h.setColumn).mockClear();
    const p = d.reset(300, { keepLanes: true });
    await vi.advanceTimersByTimeAsync(300);
    await p;
    expect(d.region('side')).toBeNull();
    expect(d.region('big')).toBeNull();
    expect(d.state().mode).toBe('c');
    expect(h.layer().querySelector('.desk-region')).toBeNull();
    expect(stage.querySelector('.desk-region')).toBeNull();
    expect(h.setColumn).not.toHaveBeenCalled();
    expect(h.s.lanes).toEqual(lanes);
    // The new answer's first sketch on the same side: no glide back to center and out again.
    await d.addRegion(spec('next', 4, { place: 'right' }));
    expect(h.setColumn).not.toHaveBeenCalled();
    // A sketch on the other side glides straight from the current lanes to the new ones, once.
    const h2 = fakeHost();
    const d3 = new Desk(h2, document.createElement('div'));
    await d3.addRegion(spec('a', 2, { place: 'right' }));
    const p2 = d3.reset(300, { keepLanes: true });
    await vi.advanceTimersByTimeAsync(300);
    await p2;
    vi.mocked(h2.setColumn).mockClear();
    await d3.addRegion(spec('b', 2, { place: 'left' }));
    expect(h2.setColumn).toHaveBeenCalledOnce();
    expect(vi.mocked(h2.setColumn).mock.calls[0][0]).toEqual(expect.objectContaining({ right: 0 }));
    expect(h2.s.lanes.left).toBeGreaterThan(0);
  });
});

describe('Desk under interruption', () => {
  let stage: HTMLDivElement;
  beforeEach(() => { vi.useFakeTimers(); stage = document.createElement('div'); });
  afterEach(() => vi.useRealTimers());
  /** A host whose column glide takes its ms, like the viewer's. */
  const slowHost = (W = 1440, H = 900) => {
    const h = fakeHost(W, H);
    h.setColumn = vi.fn(async (lanes: Lanes, gaps: ReadonlyMap<number, number>, ms: number) => {
      await new Promise((r) => setTimeout(r, ms));
      h.s.lanes = lanes; h.s.gaps = gaps;
    });
    return h;
  };

  it('a reset during frameBoth\'s promotion to B does not enter B for the region it cleared (H1)', async () => {
    const h = slowHost(1440, 600);
    const d = new Desk(h, stage);
    const a = d.addRegion(spec('side', 2, { place: 'below' }));
    await vi.advanceTimersByTimeAsync(500);
    await a;
    expect(d.region('side')!.mode).toBe('below');
    const f = d.frameBoth({ t: { page: 2 }, r: { x: 100, y: 0, w: 10, h: 10 } }, { t: { region: 'side' }, r: { x: 10, y: 650, w: 10, h: 10 } });
    await vi.advanceTimersByTimeAsync(100);
    const r = d.reset(300, { keepLanes: true });
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.all([f, r]);
    expect(d.state().mode).toBe('c');
    expect(h.setCard).not.toHaveBeenCalledWith(expect.objectContaining({ page: 2 }), expect.anything());
  });
  it('a region reset while its lanes glide is reported, not returned as null (H1)', async () => {
    const h = slowHost();
    const d = new Desk(h, stage);
    const a = d.addRegion(spec('side', 2, { place: 'right' }));
    await vi.advanceTimersByTimeAsync(100);
    const r = d.reset(0, { keepLanes: true });
    await vi.advanceTimersByTimeAsync(1000);
    await r;
    expect(await a).toBe('desk reset');
  });
  it('abort() with no regions collapses lanes kept by reset(keepLanes) (low)', async () => {
    const h = fakeHost();
    const d = new Desk(h, stage);
    await d.addRegion(spec('side', 2, { place: 'right' }));
    const r = d.reset(300, { keepLanes: true });
    await vi.advanceTimersByTimeAsync(300);
    await r;
    expect(h.s.lanes.right).toBeGreaterThan(0);
    d.abort();
    await flush();
    expect(h.s.lanes).toEqual({ left: 0, right: 0 });
  });
  it('reset with nothing to leave does not hold for the fade (M4)', async () => {
    const h = fakeHost();
    const d = new Desk(h, stage);
    await d.addRegion(spec('side', 2, { place: 'right' }));
    let done = false;
    void d.reset(300, { keepLanes: true }).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(5);
    expect(done).toBe(true);
    expect(h.layer().querySelector('.desk-region')).not.toBeNull(); // still fading
    await vi.advanceTimersByTimeAsync(300);
    expect(h.layer().querySelector('.desk-region')).toBeNull();
    const d2 = new Desk(fakeHost(), document.createElement('div'));
    let done2 = false;
    void d2.reset(300, { keepLanes: true }).then(() => { done2 = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(done2).toBe(true);
  });
  it('a wire whose ends are not both on screen is hidden, not left at a stale spot (M3)', async () => {
    const h = fakeHost();
    const d = new Desk(h, stage);
    await d.addRegion(spec('a', 2, { size: 'l' }));
    const c = d.addConnector({ t: { page: 2 }, r: { x: 300, y: 200, w: 20, h: 20 } }, { t: { region: 'a' }, r: { x: 100, y: 100, w: 10, h: 10 } });
    expect(typeof c).not.toBe('string');
    const svg = stage.querySelector('.desk-wire') as SVGSVGElement;
    expect(svg.style.display).toBe('');
    await d.addRegion(spec('b', 3, { size: 'l' })); // b on the stage, page 3 on the card: page 2 is off screen
    expect(svg.style.display).toBe('none');
    await d.reveal({ page: 2 }, { x: 0, y: 0, w: 10, h: 10 }); // page 2 back on the card, but region a is not on the stage
    expect(d.state().card).toBe(2);
    expect(svg.style.display).toBe('none');
    await d.reveal({ region: 'a' }, { x: 0, y: 0, w: 10, h: 10 });
    expect(svg.style.display).toBe('');
  });
  it('a card swap repositions the B region for the new card (M3)', async () => {
    const h = fakeHost();
    const aspects: Record<number, number> = { 3: 9 / 16, 1: 1.4 };
    h.aspect = (p: number) => aspects[p] ?? 9 / 16;
    const d = new Desk(h, stage);
    await d.addRegion(spec('big', 3, { size: 'l' }));
    const el = stage.querySelector('.desk-region') as HTMLElement;
    const before = el.style.left;
    await d.reveal({ page: 1 }, { x: 0, y: 0, w: 10, h: 10 });
    expect(d.state().card).toBe(1);
    expect(el.style.left).not.toBe(before);
  });
  it('a region added while the student drives is where "Back to answer" returns (low)', async () => {
    const h = fakeHost();
    const d = new Desk(h, stage);
    d.follow.setAnswering(true);
    h.user();
    await d.addRegion(spec('big', 3, { size: 'l' }));
    expect(d.state().mode).toBe('c');
    await d.resume();
    expect(d.state().mode).toBe('b');
    expect(d.state().card).toBe(3);
  });
});

describe('Director on a real Desk', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => vi.useRealTimers());

  it('a new answer\'s first sketch after the old answer\'s regions draws its first ink on its word (M4)', async () => {
    const h = fakeHost();
    h.setColumn = vi.fn(async (lanes: Lanes, gaps: ReadonlyMap<number, number>, ms: number) => {
      await new Promise((r) => setTimeout(r, ms));
      h.s.lanes = lanes; h.s.gaps = gaps;
    });
    const desk = new Desk(h, document.createElement('div'));
    const old = desk.addRegion(spec('old', 1, { place: 'right' }));
    await vi.advanceTimersByTimeAsync(500);
    await old;
    let inkAt = NaN;
    const build: BuildElement = async () => ({ target: { region: 'next' }, bbox: { x: 0, y: 0, w: 10, h: 10 }, draw: async () => { inkAt = performance.now(); } });
    const viewer = { numPages: () => 5, allLayers: () => [] } as unknown as ViewerApi;
    const d = new Director({ viewer: () => viewer, desk: () => desk, settings: () => DEFAULTS, onScrolledTo: () => {}, build });
    const t0 = performance.now();
    void d.begin(300);
    // The scheduler fires the sketch 450ms ahead of its word; its region's first ink is on that word.
    d.run({ kind: 'sketch', id: 'next', page: 1, size: 'm', place: 'left' }, t0 + 450);
    d.run({ kind: 'line', region: 'next', from: { x: 0, y: 0 }, to: { x: 100, y: 100 } }, t0 + 450);
    await vi.advanceTimersByTimeAsync(2000);
    expect(inkAt - (t0 + 450)).toBeGreaterThanOrEqual(0);
    expect(inkAt - (t0 + 450)).toBeLessThan(40);
  });
});
