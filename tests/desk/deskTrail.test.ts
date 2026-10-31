// tests/desk/deskTrail.test.ts — the session trail's heads and the aside's inset on the board (v1 learner UX).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Desk, type DeskHost } from '../../src/desk/Desk';
import { BOARD_HEAD, computeLayout, frameFor, type Split } from '../../src/desk/layout';

/** A viewer stand-in: real layout math, no pdf.js (as tests/desk/desk.test.ts). */
function fakeHost(W = 1440, H = 900, pages = 5): DeskHost {
  const aspects = new Float64Array(pages).fill(9 / 16);
  const s = { W, H, top: 0, split: 'none' as Split };
  const none = () => () => {};
  const layout = () => computeLayout(frameFor(s.W, s.H, s.split, 9 / 16, false).page, aspects, s.H);
  return {
    viewport: () => ({ W: s.W, H: s.H }),
    layout,
    scrollTop: () => s.top,
    maxScroll: () => Math.max(0, layout().total - s.H),
    aspect: () => 9 / 16,
    setSplit: vi.fn(async (split: Split) => { s.split = split; }),
    glideTo: vi.fn(async (top: () => number) => { s.top = top(); }),
    cancelGlide: vi.fn(),
    scrollToPage: vi.fn(async () => {}),
    onLayout: none,
    onScroll: none,
    onUserIntent: none,
  } as unknown as DeskHost;
}
const spec = (id: string, o: object = {}) => ({ id, page: 2, size: 'm' as const, ...o });
const head = () => { const e = document.createElement('div'); e.className = 'trail-head'; return e; };

/** jsdom has no layout: the board's scroller gets its real extent (content height over the board's height). */
function measurable(stage: HTMLElement) {
  const sc = stage.querySelector<HTMLElement>('[data-petu-board]')!;
  const content = sc.firstElementChild as HTMLElement;
  const board = stage.querySelector<HTMLElement>('.desk-board')!;
  Object.defineProperty(sc, 'clientHeight', { get: () => parseFloat(board.style.height) || 0 });
  Object.defineProperty(sc, 'scrollHeight', { get: () => Math.max(parseFloat(content.style.height) || 0, parseFloat(board.style.height) || 0) });
  Object.defineProperty(sc, 'clientWidth', { get: () => parseFloat(board.style.width) || 0 });
  Object.defineProperty(sc, 'scrollWidth', { get: () => parseFloat(board.style.width) || 0 });
  let top = 0;
  Object.defineProperty(sc, 'scrollTop', { get: () => top, set: (v: number) => { top = Math.max(0, Math.min(v, sc.scrollHeight - sc.clientHeight)); sc.dispatchEvent(new Event('scroll')); } });
  return sc;
}
/** Where an element sits in the board's view (px below the board's top edge). */
const inView = (el: HTMLElement, sc: HTMLElement) => parseFloat(el.style.top) - sc.scrollTop;
/** Lets every board glide run to its end. */
const settle = () => vi.advanceTimersByTimeAsync(1500);
/** Awaits a desk move whose glide runs on (fake) animation frames. */
const run = async <T,>(p: Promise<T>): Promise<T> => { await settle(); return p; };

describe('Desk: session trail and asides', () => {
  let stage: HTMLDivElement;
  beforeEach(() => { vi.useFakeTimers(); stage = document.createElement('div'); });
  afterEach(() => vi.useRealTimers());

  it('a head goes above the next section only, and takes room there', async () => {
    const d = new Desk(fakeHost(), stage);
    const h = head();
    d.headNext(h, 44);
    await d.addRegion(spec('a'));
    await d.addRegion(spec('b'));
    const [a] = [...stage.querySelectorAll<HTMLElement>('.desk-region')];
    expect(stage.contains(h)).toBe(true);
    expect(parseFloat(h.style.top)).toBeCloseTo(parseFloat(a.style.top) - 44, 3);
    expect(stage.querySelectorAll('.trail-head')).toHaveLength(1);
  });

  it('an aside tints its sections, steps the rest back, and collapses to its marker when it ends', async () => {
    const d = new Desk(fakeHost(), stage);
    await d.addRegion(spec('main'));
    d.setAside(true);
    const h = head();
    d.headNext(h, 40);
    await d.addRegion(spec('side'));
    const board = stage.querySelector('.desk-board') as HTMLElement;
    const [main, side] = [...stage.querySelectorAll<HTMLElement>('.desk-region')];
    expect(board.classList.contains('has-aside')).toBe(true);
    expect(side.classList.contains('is-aside')).toBe(true);
    expect(main.classList.contains('is-aside')).toBe(false);
    d.setAside(false);
    expect(board.classList.contains('has-aside')).toBe(false);
    expect(h.classList.contains('is-collapsed')).toBe(true);
    expect(parseFloat(side.style.height)).toBe(0);
    d.toggleAside(h);
    expect(h.classList.contains('is-collapsed')).toBe(false);
    expect(parseFloat(side.style.height)).toBeGreaterThan(0);
  });

  it('an answer\'s header lands whole under the board\'s head row, its first drawing below it (scene or sketch)', async () => {
    for (const [H, o] of [[900, { scene: true }], [560, {}], [1440, { scene: true }]] as const) {
      const st = document.createElement('div');
      const d = new Desk(fakeHost(1440, H), st);
      const sc = measurable(st);
      const board = st.querySelector<HTMLElement>('.desk-board')!;
      // An earlier answer above, so the new one lands lower on the board.
      d.follow.setAnswering(true);
      d.headNext(head(), 44);
      await d.addRegion(spec('first'));
      await settle();
      await d.reset(0);
      const h = head();
      d.headNext(h, 44);
      const p = d.addRegion(spec('next', o));
      await settle();
      await p;
      const sec = [...st.querySelectorAll<HTMLElement>('.desk-region')][1];
      // Never clipped or jammed against the top: the head sits where the first head of a fresh board does.
      expect(inView(h, sc)).toBeGreaterThanOrEqual(BOARD_HEAD - 0.5);
      expect(inView(sec, sc)).toBeCloseTo(inView(h, sc) + 44, 3);
      expect(inView(sec, sc)).toBeLessThan(parseFloat(board.style.height));
      // A scene's window fits the view under its head.
      if ('scene' in o) expect(inView(sec, sc) + parseFloat(sec.style.height)).toBeLessThanOrEqual(parseFloat(board.style.height) + 0.5);
    }
  });

  it('an aside lands its inset in view even if the student had scrolled away, follows it, and returns to the answer when it ends', async () => {
    const d = new Desk(fakeHost(1440, 700), stage);
    const sc = measurable(stage);
    const board = stage.querySelector<HTMLElement>('.desk-board')!;
    d.follow.setAnswering(true);
    d.headNext(head(), 44);
    await run(d.addRegion(spec('main')));
    await run(d.addRegion(spec('more')));
    await settle();
    // The answer's latest ink, low in its second section.
    const ink = { x: 100, y: 560, w: 300, h: 80 };
    await run(d.reveal({ region: 'more' }, ink));
    await settle();
    expect(d.isVisible({ region: 'more' }, ink)).toBe(true);
    // The student scrolls up to look (follow stops), then asks.
    sc.dispatchEvent(new WheelEvent('wheel', { deltaY: -200 }));
    sc.scrollTop = 0;
    expect(d.following()).toBe(false);
    d.setAside(true);
    expect(d.following()).toBe(true);
    const ah = head();
    d.headNext(ah, 40);
    const p = d.addRegion(spec('side'));
    await settle();
    await p;
    expect(inView(ah, sc)).toBeGreaterThanOrEqual(BOARD_HEAD - 0.5);
    expect(inView(ah, sc)).toBeLessThan(parseFloat(board.style.height) - 40);
    // Its ink further down is kept in view.
    const low = { x: 100, y: 620, w: 200, h: 60 };
    await run(d.reveal({ region: 'side' }, low));
    await settle();
    expect(d.isVisible({ region: 'side' }, low)).toBe(true);
    // Resume: the board goes back to where the answer was drawing.
    d.setAside(false);
    await settle();
    expect(d.isVisible({ region: 'more' }, ink)).toBe(true);
  });

  it('a student scroll during the aside is respected: no return glide when it ends', async () => {
    const d = new Desk(fakeHost(1440, 700), stage);
    const sc = measurable(stage);
    d.follow.setAnswering(true);
    await run(d.addRegion(spec('main')));
    await run(d.addRegion(spec('more')));
    await run(d.reveal({ region: 'more' }, { x: 0, y: 600, w: 100, h: 60 }));
    await settle();
    d.setAside(true);
    d.headNext(head(), 40);
    await run(d.addRegion(spec('side')));
    await settle();
    sc.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }));
    sc.scrollTop = 10;
    expect(d.following()).toBe(false);
    d.setAside(false);
    await settle();
    expect(sc.scrollTop).toBe(10);
  });
});

describe('Desk: pointer input never moves a drawing', () => {
  let stage: HTMLDivElement;
  beforeEach(() => { vi.useFakeTimers(); stage = document.createElement('div'); });
  afterEach(() => vi.useRealTimers());

  it('a plain wheel over a scene leaves its camera alone (the board scrolls); a pinch zooms it', async () => {
    const d = new Desk(fakeHost(), stage);
    measurable(stage);
    d.follow.setAnswering(true);
    await run(d.addRegion(spec('s', { scene: true })));
    await settle();
    const sec = stage.querySelector<HTMLElement>('.desk-region')!;
    const vb = () => sec.querySelector('svg')!.getAttribute('viewBox');
    const before = vb();
    for (const [dx, dy] of [[0.4, 0.6], [-3, 2], [0, -40], [12, 0]]) {
      const e = new WheelEvent('wheel', { deltaX: dx, deltaY: dy, clientX: 900, clientY: 300, cancelable: true, bubbles: true });
      sec.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(false);
    }
    expect(vb()).toBe(before);
    expect(d.following()).toBe(true);
    const pinch = new WheelEvent('wheel', { deltaY: -20, ctrlKey: true, clientX: 900, clientY: 300, cancelable: true, bubbles: true });
    sec.dispatchEvent(pinch);
    expect(pinch.defaultPrevented).toBe(true);
    expect(vb()).not.toBe(before);
  });

  it('a wheel that scrolls nothing (no delta, or the board at its end) is not the student taking over', async () => {
    const d = new Desk(fakeHost(), stage);
    const sc = measurable(stage);
    d.follow.setAnswering(true);
    await run(d.addRegion(spec('a')));
    await settle();
    sc.dispatchEvent(new WheelEvent('wheel', { deltaX: 0, deltaY: 0 }));
    sc.dispatchEvent(new WheelEvent('wheel', { deltaY: -30 })); // already at the top
    expect(d.following()).toBe(true);
  });
});

describe('Desk.forget: a trail replay plays its answer in place (founder report: replay listed answer 2 twice)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** Three answers on the board, each a head and its section(s); then answer 2 is replayed (twice). */
  async function session(host: DeskHost, st: HTMLDivElement) {
    const d = new Desk(host, st);
    const heads = [head(), head(), head()];
    for (const [i, h] of heads.entries()) {
      await d.reset(0);
      d.headNext(h, 44);
      const p1 = d.addRegion(spec(`a${i}`)); await settle(); await p1;
      if (i === 1) { const p2 = d.addRegion(spec('a1b')); await settle(); await p2; }
    }
    const replay = async () => {
      await d.reset(0);
      d.headNext(heads[1], 44);
      // Until the replay draws, its card stays where it was (never gone, never twice).
      expect(st.contains(heads[1]) || (host as { laneEl?: () => HTMLElement }).laneEl?.().contains(heads[1])).toBe(true);
      const p1 = d.addRegion(spec('a1')); await settle(); await p1;
      const p2 = d.addRegion(spec('a1b')); await settle(); await p2;
    };
    return { d, heads, replay };
  }

  for (const lane of [false, true]) {
    it(`replaying twice keeps one head and one copy of its drawing (${lane ? 'lane' : 'split board'})`, async () => {
      const st = document.createElement('div');
      const laneEl = document.createElement('div');
      const host = fakeHost();
      if (lane) (host as { laneEl?: () => HTMLElement }).laneEl = () => laneEl;
      const root = lane ? laneEl : st;
      const { heads, replay } = await session(host, st);
      expect(root.querySelectorAll('.desk-region')).toHaveLength(4);
      await replay();
      await replay();
      // One copy: four sections as before, each head on the board once, answer 2's head over its first section.
      expect(root.querySelectorAll('.desk-region')).toHaveLength(4);
      expect(root.querySelectorAll('.trail-head')).toHaveLength(3);
      for (const h of heads) expect(root.contains(h)).toBe(true);
      if (lane) {
        expect(root.querySelectorAll('.lane-group')).toHaveLength(3);
        // Its group holds its head and both its sections, once each.
        const g = heads[1].closest('.lane-item')!;
        expect(g.querySelectorAll('.desk-region')).toHaveLength(2);
        expect(g.querySelectorAll('.lane-thumb').length).toBeLessThanOrEqual(1);
      }
    });
  }

  it('an aside asked before the replay draws: the replay still replaces its card (one entry)', async () => {
    const st = document.createElement('div');
    const { d, heads } = await session(fakeHost(), st);
    await d.reset(0);
    d.headNext(heads[1], 44);
    d.setAside(true);
    const ah = head(); ah.classList.add('is-aside');
    d.headNext(ah, 40);
    const pa = d.addRegion(spec('side')); await settle(); await pa;
    d.setAside(false);
    expect(d.awaitsHead(heads[1])).toBe(true);
    d.headNext(heads[1], 44); // App's endAside puts the answer's head back in line
    const p1 = d.addRegion(spec('a1')); await settle(); await p1;
    expect(d.awaitsHead(heads[1])).toBe(false);
    expect(st.querySelectorAll('.trail-head:not(.is-aside)')).toHaveLength(3);
  });

  it('forgetting a head the desk does not hold is a no-op', async () => {
    const st = document.createElement('div');
    const { d } = await session(fakeHost(), st);
    d.forget(head());
    expect(st.querySelectorAll('.desk-region')).toHaveLength(4);
  });
});
