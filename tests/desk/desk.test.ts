// tests/desk/desk.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Desk, GLIDE_MS, type DeskHost } from '../../src/desk/Desk';
import { computeLayout, frameFor, type Split } from '../../src/desk/layout';
import { Director } from '../../src/playback/director';
import { DEFAULTS } from '../../src/settings/settings';
import type { ViewerApi } from '../../src/pdf/viewerApi';
import type { BuildElement } from '../../src/desk/types';
import { dockPlacement } from '../../src/ui/layout';

/** A viewer stand-in: real layout math, no pdf.js. */
function fakeHost(W = 1440, H = 900, pages = 5) {
  const aspects = new Float64Array(pages).fill(9 / 16);
  const s = { W, H, top: 0, split: 'none' as Split };
  const cbs = { layout: new Set<() => void>(), scroll: new Set<() => void>(), user: new Set<() => void>() };
  const sub = (set: Set<() => void>) => (cb: () => void) => { set.add(cb); return () => { set.delete(cb); }; };
  const layout = () => computeLayout(frameFor(s.W, s.H, s.split, 9 / 16).page, aspects, s.H);
  const host: DeskHost & { s: typeof s; resize(W: number, H: number): void; user(): void; scroll(top: number): void } = {
    s,
    viewport: () => ({ W: s.W, H: s.H }),
    layout,
    scrollTop: () => s.top,
    maxScroll: () => Math.max(0, layout().total - s.H),
    aspect: () => 9 / 16,
    setSplit: vi.fn(async (split: Split) => { s.split = split; cbs.layout.forEach((f) => f()); }),
    glideTo: vi.fn(async (top: () => number) => { s.top = top(); cbs.scroll.forEach((f) => f()); }),
    cancelGlide: vi.fn(),
    scrollToPage: vi.fn(async () => {}),
    onLayout: sub(cbs.layout),
    onScroll: sub(cbs.scroll),
    onUserIntent: sub(cbs.user),
    resize(W: number, H: number) { s.W = W; s.H = H; cbs.layout.forEach((f) => f()); },
    user() { cbs.user.forEach((f) => f()); },
    scroll(top: number) { s.top = top; cbs.scroll.forEach((f) => f()); },
  };
  return host;
}
/** A host whose split glide takes its full time. */
const slowHost = (W = 1440, H = 900) => {
  const h = fakeHost(W, H);
  h.setSplit = vi.fn(async (split: Split, ms: number) => { await new Promise((r) => setTimeout(r, ms)); h.s.split = split; });
  return h;
};

const spec = (id: string, page = 2, o: object = {}) => ({ id, page, size: 'm' as const, ...o });
const flush = () => vi.advanceTimersByTimeAsync(10);
const boardOf = (stage: HTMLElement) => stage.querySelector('.desk-board') as HTMLElement;

describe('Desk: the board', () => {
  let stage: HTMLDivElement;
  beforeEach(() => { vi.useFakeTimers(); stage = document.createElement('div'); });
  afterEach(() => vi.useRealTimers());

  it('is closed while reading: the dock centres under the page column', () => {
    const h = fakeHost();
    const d = new Desk(h, stage);
    expect(d.state().split).toBe('none');
    expect(boardOf(stage).classList.contains('is-open')).toBe(false);
    expect(dockPlacement(1440, d.state()).x).toBe(720);
  });
  it('a first sketch opens it: one split glide, the slide column pinned left, a section appended', async () => {
    const h = fakeHost();
    const d = new Desk(h, stage);
    const r = await d.addRegion(spec('side'));
    expect(typeof r).not.toBe('string');
    expect(h.setSplit).toHaveBeenCalledOnce();
    expect(h.setSplit).toHaveBeenCalledWith('normal', GLIDE_MS);
    const s = d.state();
    const f = frameFor(1440, 900, 'normal', 9 / 16);
    expect(s.split).toBe('normal');
    expect(s.column).toEqual({ x: f.slides.x, w: f.slides.w });
    expect(s.board).toEqual(f.board);
    const board = boardOf(stage);
    expect(board.classList.contains('is-open')).toBe(true);
    expect(parseFloat(board.style.left)).toBe(f.board!.x);
    expect(board.querySelector('[data-petu-board] .desk-region.is-shown')).not.toBeNull();
    // A second sketch in the same answer appends without moving the slides again.
    await d.addRegion(spec('more'));
    expect(h.setSplit).toHaveBeenCalledOnce();
    const els = board.querySelectorAll<HTMLElement>('.desk-region');
    expect(els).toHaveLength(2);
    expect(parseFloat(els[1].style.top)).toBeGreaterThan(parseFloat(els[0].style.top) + parseFloat(els[0].style.height));
  });
  it('the dock follows the slide column from the glide\'s start', async () => {
    const h = slowHost();
    const d = new Desk(h, stage);
    const cols: number[] = [];
    d.subscribe((s) => cols.push(s.column.x));
    const a = d.addRegion(spec('side'));
    await flush();
    expect(d.state().column.x).toBe(frameFor(1440, 900, 'normal', 9 / 16).slides.x);
    await vi.advanceTimersByTimeAsync(GLIDE_MS + 50);
    await a;
    expect(cols[cols.length - 1]).toBe(frameFor(1440, 900, 'normal', 9 / 16).slides.x);
  });
  it('size=l widens the split; s and m are the normal split', async () => {
    const h = fakeHost();
    const d = new Desk(h, stage);
    await d.addRegion(spec('a', 2, { size: 's' }));
    expect(d.state().split).toBe('normal');
    await d.addRegion(spec('b', 2, { size: 'l' }));
    expect(h.setSplit).toHaveBeenLastCalledWith('wide', GLIDE_MS);
    expect(d.state().split).toBe('wide');
  });
  it('refuses a duplicate id, and has no cap on sections per answer', async () => {
    const d = new Desk(fakeHost(), stage);
    await d.addRegion(spec('a'));
    expect(await d.addRegion(spec('a'))).toBe('duplicate region id');
    for (const id of ['b', 'c', 'd', 'e']) expect(typeof (await d.addRegion(spec(id)))).toBe('object');
  });
  it('grows a section past 700 units for kit blocks, never shrinking it', async () => {
    const d = new Desk(fakeHost(), stage);
    await d.addRegion(spec('a'));
    const svg = stage.querySelector('.desk-region svg')!;
    d.growRegion('a', 900);
    expect(svg.getAttribute('viewBox')).toBe('0 0 1000 900');
    d.growRegion('a', 800);
    expect(svg.getAttribute('viewBox')).toBe('0 0 1000 900');
  });
  it('centres a section\'s content in the board: the whole group shifts, first at once, then gliding', async () => {
    const d = new Desk(fakeHost(), stage);
    await d.addRegion(spec('a'));
    const svgs = [...stage.querySelectorAll<SVGSVGElement>('.desk-region svg')];
    d.centreRegion('a', 40, 400); // content 40–400: its centre 220 goes to 500
    svgs.forEach((s) => { expect(s.style.transform).toBe('translateX(28.000%)'); expect(s.style.transition).toBe('none'); });
    d.centreRegion('a', 40, 960); // full width: back in place, gliding
    svgs.forEach((s) => { expect(s.style.transform).toBe(''); expect(s.style.transition).toBe(''); });
    d.centreRegion('a', 600, 900); // never pushed past the section's edge
    expect(svgs[0].style.transform).toBe('translateX(-25.000%)');
    // a viewBox change (growth) keeps the shift
    d.growRegion('a', 900);
    expect(svgs[0].style.transform).toBe('translateX(-25.000%)');
  });
  it('persists across answers: reset frees the ids and keeps the sections and the split', async () => {
    const h = fakeHost();
    const d = new Desk(h, stage);
    await d.addRegion(spec('side'));
    await d.reset(300);
    expect(d.region('side')).toBeNull();
    expect(d.state().split).toBe('normal');
    expect(h.setSplit).toHaveBeenCalledOnce();
    expect(await d.addRegion(spec('side'))).not.toBe('duplicate region id'); // a new answer's id
    expect(boardOf(stage).querySelectorAll('.desk-region')).toHaveLength(2);
    expect(h.setSplit).toHaveBeenCalledOnce();
  });
  it('a scene continues by its id: a follow-up naming the same scene draws on into it', async () => {
    const d = new Desk(fakeHost(), stage);
    const a = await d.addRegion(spec('s', 2, { scene: true }));
    if (typeof a === 'string') throw new Error(a);
    await d.reset(300);
    const b = await d.addRegion(spec('s', 3, { scene: true }));
    if (typeof b === 'string') throw new Error(b);
    expect(boardOf(stage).querySelectorAll('.desk-region')).toHaveLength(1);
    expect(b.scene).toBe(a.scene); // the same world
    // A repeated scene tag in one answer continues too (never a duplicate-id skip).
    const c = await d.addRegion(spec('s', 3, { scene: true }));
    expect(typeof c).not.toBe('string');
    expect(boardOf(stage).querySelectorAll('.desk-region')).toHaveLength(1);
  });
  it('a scene tag with a new id (a revision) starts a fresh section below; the old scene stays above, untouched', async () => {
    const d = new Desk(fakeHost(), stage);
    const a = await d.addRegion(spec('s', 2, { scene: true }));
    if (typeof a === 'string') throw new Error(a);
    const old = boardOf(stage).querySelector('.desk-region')!;
    const before = old.outerHTML;
    await d.reset(300);
    const b = await d.addRegion(spec('t', 2, { scene: true }));
    if (typeof b === 'string') throw new Error(b);
    const secs = boardOf(stage).querySelectorAll('.desk-region');
    expect(secs).toHaveLength(2);
    expect(secs[0]).toBe(old); // above, never erased
    expect(old.outerHTML).toBe(before);
    expect(b.scene).not.toBe(a.scene);
    // Within one answer too: a second scene with a new id is its own section.
    const c = await d.addRegion(spec('u', 2, { scene: true }));
    if (typeof c === 'string') throw new Error(c);
    expect(boardOf(stage).querySelectorAll('.desk-region')).toHaveLength(3);
    // After a revision, continuing the earlier scene by its id still finds it.
    await d.reset(300);
    const e = await d.addRegion(spec('s', 2, { scene: true }));
    if (typeof e === 'string') throw new Error(e);
    expect(e.scene).toBe(a.scene);
    expect(boardOf(stage).querySelectorAll('.desk-region')).toHaveLength(3);
  });
  it('a plain sketch never continues a scene, and a scene id never continues a plain sketch', async () => {
    const d = new Desk(fakeHost(), stage);
    await d.addRegion(spec('s', 2, { scene: true }));
    expect(await d.addRegion(spec('s'))).toBe('duplicate region id');
    await d.addRegion(spec('k'));
    await d.reset(300);
    const r = await d.addRegion(spec('k', 2, { scene: true }));
    if (typeof r === 'string') throw new Error(r);
    expect(r.scene).toBeDefined();
    expect(boardOf(stage).querySelectorAll('.desk-region')).toHaveLength(3);
  });
  it('dismiss: the board slides out, the slides glide back to centre, the sections go once it has left', async () => {
    const h = fakeHost();
    const d = new Desk(h, stage);
    await d.addRegion(spec('side'));
    await d.dismiss();
    expect(h.setSplit).toHaveBeenLastCalledWith('none', GLIDE_MS);
    expect(d.state().split).toBe('none');
    expect(boardOf(stage).classList.contains('is-open')).toBe(false);
    expect(dockPlacement(1440, d.state()).x).toBe(720);
    expect(boardOf(stage).querySelector('.desk-region')).not.toBeNull(); // still sliding out
    await vi.advanceTimersByTimeAsync(GLIDE_MS + 10);
    expect(boardOf(stage).querySelector('.desk-region')).toBeNull();
    // Opening again starts a fresh board.
    await d.addRegion(spec('next'));
    expect(boardOf(stage).querySelectorAll('.desk-region')).toHaveLength(1);
  });
  it('the close button calls onClose (the app stops a playing answer, then dismisses)', async () => {
    const onClose = vi.fn();
    const d = new Desk(fakeHost(), stage, { onClose });
    await d.addRegion(spec('side'));
    (stage.querySelector('.desk-board-close') as HTMLButtonElement).click();
    expect(onClose).toHaveBeenCalledOnce();
  });
  it('a narrow window stacks the board under the slides', async () => {
    const h = fakeHost(900, 800);
    const d = new Desk(h, stage);
    await d.addRegion(spec('side'));
    expect(d.state().stacked).toBe(true);
    expect(boardOf(stage).classList.contains('is-stacked')).toBe(true);
  });
  it('re-places the board on resize, and stacks or unstacks with the window', async () => {
    const h = fakeHost();
    const d = new Desk(h, stage);
    await d.addRegion(spec('side'));
    h.resize(900, 800);
    await flush();
    expect(d.state().stacked).toBe(true);
    expect(parseFloat(boardOf(stage).style.left)).toBe(frameFor(900, 800, 'normal', 9 / 16).board!.x);
    h.resize(1440, 900);
    await flush();
    expect(d.state().stacked).toBe(false);
  });
  it('region text scale and body size come from the slide: uniform scale, body px from the page width', async () => {
    const h = fakeHost();
    const d = new Desk(h, stage);
    const r = await d.addRegion(spec('side', 2, { body: 0.03 }));
    if (typeof r === 'string') throw new Error(r);
    const pageW = frameFor(1440, 900, 'normal', 9 / 16).page.pageW;
    expect(r.body()).toBeCloseTo(Math.min(36, 0.03 * pageW));
    expect(r.scale()).toBeGreaterThan(0);
  });
  it('reveal glides the slides to page ink that is off screen; nothing moves when it is visible', async () => {
    const h = fakeHost();
    const d = new Desk(h, stage);
    d.follow.setAnswering(true);
    const box = { x: 100, y: 100, w: 50, h: 50 };
    expect(await d.reveal({ page: 4 }, box)).toBe(true);
    expect(d.isVisible({ page: 4 }, box)).toBe(true);
    expect(await d.reveal({ page: 4 }, box)).toBe(false);
  });
  it('the student taking over stops every move until resume (rule 6)', async () => {
    const h = fakeHost();
    const d = new Desk(h, stage);
    d.follow.setAnswering(true);
    h.user();
    expect(d.following()).toBe(false);
    expect(await d.reveal({ page: 4 }, { x: 0, y: 0, w: 10, h: 10 })).toBe(false);
    expect(h.glideTo).not.toHaveBeenCalled();
    await d.resume();
    expect(d.following()).toBe(true);
    expect(h.glideTo).toHaveBeenCalled();
  });
  it('a board scroll by the student during an answer is taking over too', async () => {
    const d = new Desk(fakeHost(), stage);
    await d.addRegion(spec('side'));
    d.follow.setAnswering(true);
    const sc = stage.querySelector('[data-petu-board]')!;
    // A wheel that scrolls the board (it has room below).
    Object.defineProperty(sc, 'scrollHeight', { get: () => 2000 });
    Object.defineProperty(sc, 'clientHeight', { get: () => 800 });
    sc.dispatchEvent(new WheelEvent('wheel', { deltaY: 40 }));
    expect(d.following()).toBe(false);
  });
});

describe('Desk: connectors', () => {
  let stage: HTMLDivElement;
  beforeEach(() => { vi.useFakeTimers(); stage = document.createElement('div'); });
  afterEach(() => vi.useRealTimers());

  it('route from the page anchor through the gutter to the board, in the overlay above both', async () => {
    const h = fakeHost();
    const d = new Desk(h, stage);
    await d.addRegion(spec('side', 1));
    const c = d.addConnector({ t: { page: 1 }, r: { x: 300, y: 300, w: 20, h: 20 } }, { t: { region: 'side' }, r: { x: 300, y: 300, w: 10, h: 10 } });
    if (typeof c === 'string') throw new Error(c);
    const f = frameFor(1440, 900, 'normal', 9 / 16);
    const end = c.stroke[c.stroke.length - 1];
    expect(end.x).toBeGreaterThan(f.board!.x); // it arrives on the board
    expect(c.stroke[0].x).toBeLessThan(f.slides.x + f.slides.w); // from the slide
    const svg = stage.querySelector('.desk-wires .desk-wire') as SVGElement;
    expect(svg).not.toBeNull();
    expect(svg.classList.contains('is-hidden')).toBe(false);
  });
  it('a centred section: the connector lands where its element now is (shifted with the group)', async () => {
    const h = fakeHost();
    const d = new Desk(h, stage);
    await d.addRegion(spec('side', 1));
    const c = d.addConnector({ t: { page: 1 }, r: { x: 300, y: 300, w: 20, h: 20 } }, { t: { region: 'side' }, r: { x: 300, y: 300, w: 10, h: 10 } });
    if (typeof c === 'string') throw new Error(c);
    const before = c.stroke[c.stroke.length - 1].x;
    d.centreRegion('side', 40, 400); // the group moves 280 units right
    const after = c.stroke[c.stroke.length - 1].x;
    const s = d.region('side')!.scale();
    expect(after - before).toBeCloseTo(280 * s, 1);
  });
  it('fade while the page anchor is out of view, and return with it', async () => {
    const h = fakeHost();
    const d = new Desk(h, stage);
    await d.addRegion(spec('side', 1));
    d.addConnector({ t: { page: 1 }, r: { x: 300, y: 300, w: 20, h: 20 } }, { t: { region: 'side' }, r: { x: 300, y: 300, w: 10, h: 10 } });
    const svg = stage.querySelector('.desk-wire') as SVGElement;
    h.scroll(3000);
    await vi.advanceTimersByTimeAsync(40);
    expect(svg.classList.contains('is-hidden')).toBe(true);
    h.scroll(0);
    await vi.advanceTimersByTimeAsync(40);
    expect(svg.classList.contains('is-hidden')).toBe(false);
  });
  it('need a page end and a section of this answer; they fade out with the page marks on reset', async () => {
    const h = fakeHost();
    const d = new Desk(h, stage);
    expect(d.addConnector({ t: { page: 1 }, r: { x: 0, y: 0, w: 1, h: 1 } }, { t: { region: 'nope' }, r: { x: 0, y: 0, w: 1, h: 1 } })).toBe('connector needs a page and a region');
    await d.addRegion(spec('side', 1));
    d.addConnector({ t: { page: 1 }, r: { x: 300, y: 300, w: 20, h: 20 } }, { t: { region: 'side' }, r: { x: 300, y: 300, w: 10, h: 10 } });
    await d.reset(200);
    expect(stage.querySelector('.desk-wire')).not.toBeNull(); // fading
    await vi.advanceTimersByTimeAsync(250);
    expect(stage.querySelector('.desk-wire')).toBeNull();
  });
});

describe('Desk under interruption', () => {
  let stage: HTMLDivElement;
  beforeEach(() => { vi.useFakeTimers(); stage = document.createElement('div'); });
  afterEach(() => vi.useRealTimers());

  it('a reset while the board opens is reported, not returned as a live region', async () => {
    const h = slowHost();
    const d = new Desk(h, stage);
    const a = d.addRegion(spec('side'));
    await vi.advanceTimersByTimeAsync(100);
    await d.reset(0);
    await vi.advanceTimersByTimeAsync(GLIDE_MS);
    expect(await a).toBe('desk reset');
    expect(d.state().split).toBe('normal'); // the board itself stays
  });
  it('reset never moves the slides (no split change), and resolves at once', async () => {
    const h = fakeHost();
    const d = new Desk(h, stage);
    let done = false;
    void d.reset(300).then(() => { done = true; });
    await Promise.resolve();
    expect(done).toBe(true);
    expect(h.setSplit).not.toHaveBeenCalled();
  });
  it('abort cancels the pans in flight', () => {
    const h = fakeHost();
    const d = new Desk(h, stage);
    d.abort();
    expect(h.cancelGlide).toHaveBeenCalled();
  });
  it('a region added while the student drives is where "Back to answer" returns', async () => {
    const h = fakeHost();
    const d = new Desk(h, stage);
    d.follow.setAnswering(true);
    h.user();
    await d.addRegion(spec('side', 4));
    expect(h.glideTo).not.toHaveBeenCalled();
    await d.resume();
    expect(d.following()).toBe(true);
  });
  it('opening the board frames the slide being explained (the viewer top-aligns it in a split); appending does not', async () => {
    const h = fakeHost();
    const d = new Desk(h, stage);
    await d.addRegion(spec('side', 3));
    expect(h.scrollToPage).toHaveBeenCalledWith(3);
    await d.addRegion(spec('more', 3));
    expect(h.scrollToPage).toHaveBeenCalledOnce();
  });
});

describe('Director on a real Desk', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => vi.useRealTimers());

  const viewer = { numPages: () => 5, currentPage: () => 2, allLayers: () => [], textRuns: async () => [], spaceHeight: () => 562.5 } as unknown as ViewerApi;

  it('a sketch-first answer: the first section ink starts within 150ms of the split glide', async () => {
    const h = slowHost();
    const desk = new Desk(h, document.createElement('div'));
    let inkAt = NaN;
    const build: BuildElement = async () => ({ target: { region: 's' }, bbox: { x: 200, y: 450, w: 100, h: 100 }, draw: async () => { inkAt = performance.now(); } });
    const d = new Director({ viewer: () => viewer, desk: () => desk, settings: () => DEFAULTS, onScrolledTo: () => {}, build });
    void d.begin(300);
    const t0 = performance.now();
    d.run({ kind: 'sketch', id: 's', page: 3, size: 'm' }, t0);
    d.run({ kind: 'point', region: 's', at: { x: 240, y: 500 } }, t0);
    await vi.advanceTimersByTimeAsync(3000);
    expect(h.setSplit).toHaveBeenCalledOnce();
    expect(inkAt - (t0 + GLIDE_MS)).toBeLessThan(150);
  });
  it('a second answer\'s sketch appends to the open board: no glide, ink on its word', async () => {
    const h = slowHost();
    const desk = new Desk(h, document.createElement('div'));
    const first = desk.addRegion(spec('old', 1));
    await vi.advanceTimersByTimeAsync(GLIDE_MS + 50);
    await first;
    let inkAt = NaN;
    const build: BuildElement = async () => ({ target: { region: 'next' }, bbox: { x: 0, y: 0, w: 10, h: 10 }, draw: async () => { inkAt = performance.now(); } });
    const d = new Director({ viewer: () => viewer, desk: () => desk, settings: () => DEFAULTS, onScrolledTo: () => {}, build });
    const t0 = performance.now();
    void d.begin(300);
    d.run({ kind: 'sketch', id: 'next', size: 'm' }, t0 + 450); // no near=: the slide in view
    d.run({ kind: 'line', region: 'next', from: { x: 0, y: 0 }, to: { x: 100, y: 100 } }, t0 + 450);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.setSplit).toHaveBeenCalledOnce();
    expect(inkAt - (t0 + 450)).toBeGreaterThanOrEqual(0);
    expect(inkAt - (t0 + 450)).toBeLessThan(40);
    expect(desk.region('next')!.page).toBe(2);
  });
});
