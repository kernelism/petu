// Pointer on the board (founder report 2026-10-29: "the figure control using the pointer is buggy";
// "new diagrams below don't come into focus"). Each case is a root cause found in Chromium/WebKit/Gecko.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computeLayout, frameFor, type Split } from '../../src/desk/layout';
import { Desk, type DeskHost } from '../../src/desk/Desk';
import { wheelTakesOver, wheelPx } from '../../src/desk/follow';
import { REGION_H } from '../../src/script/types';

function fakeHost(W = 1440, H = 900, pages = 5) {
  const aspects = new Float64Array(pages).fill(9 / 16);
  const s = { W, H, top: 0, split: 'none' as Split };
  const layout = () => computeLayout(frameFor(s.W, s.H, s.split, 9 / 16).page, aspects, s.H);
  const none = () => () => {};
  const host: DeskHost = {
    viewport: () => ({ W: s.W, H: s.H }), layout, scrollTop: () => s.top,
    maxScroll: () => Math.max(0, layout().total - s.H), aspect: () => 9 / 16,
    setSplit: vi.fn(async (split: Split) => { s.split = split; }),
    glideTo: vi.fn(async (top: () => number) => { s.top = top(); }),
    cancelGlide: vi.fn(), scrollToPage: vi.fn(async () => {}),
    onLayout: none, onScroll: none, onUserIntent: none,
  };
  return host;
}
const scrollerOf = (stage: HTMLElement) => stage.querySelector('[data-petu-board]') as HTMLDivElement;
const wheel = (o: WheelEventInit) => new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 900, clientY: 300, ...o });

describe('wheelTakesOver: only a wheel that moves the view is the student taking over', () => {
  const el = { scrollTop: 0, scrollLeft: 0, scrollHeight: 2000, clientHeight: 800, scrollWidth: 600, clientWidth: 600 };
  it('a zero-delta wheel (Magic Mouse / trackpad brushed while the cursor moves) is not', () => {
    expect(wheelTakesOver(el, { deltaX: 0, deltaY: 0 })).toBe(false);
  });
  it('a wheel past the end, or sideways with no room, is not', () => {
    expect(wheelTakesOver(el, { deltaX: 0, deltaY: -4 })).toBe(false);
    expect(wheelTakesOver(el, { deltaX: 5, deltaY: 0 })).toBe(false);
  });
  it('a wheel that scrolls, or a pinch (ctrl / ⌘ + wheel), is', () => {
    expect(wheelTakesOver(el, { deltaX: 0, deltaY: 3 })).toBe(true);
    expect(wheelTakesOver(el, { deltaX: 0, deltaY: -2, ctrlKey: true })).toBe(true);
    expect(wheelTakesOver(el, { deltaX: 0, deltaY: 0, ctrlKey: true })).toBe(false);
  });
  it('wheelPx turns Firefox line/page deltas into px', () => {
    expect(wheelPx(3, 0)).toBe(3);
    expect(wheelPx(3, 1)).toBe(48);
    expect(wheelPx(1, 2, 700)).toBe(700);
  });
});

describe('Desk: pinch, wheel and press on the board', () => {
  let stage: HTMLDivElement;
  beforeEach(() => { vi.useFakeTimers(); stage = document.createElement('div'); document.body.appendChild(stage); });
  afterEach(() => { stage.remove(); vi.useRealTimers(); });

  async function open() {
    const d = new Desk(fakeHost(), stage);
    d.follow.setAnswering(true);
    const r = await d.addRegion({ id: 's', page: 2, size: 'm' });
    if (typeof r === 'string') throw new Error(r);
    return d;
  }

  it('a pinch (ctrl+wheel) zooms the board, never the browser page, and stops following', async () => {
    const d = await open();
    const e = wheel({ deltaY: -10, ctrlKey: true });
    scrollerOf(stage).dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(d.zoom()).toBeGreaterThan(1);
    expect(d.zoom()).toBeLessThan(1.2); // continuous, not a whole step per event
    expect(d.following()).toBe(false);
    const out = wheel({ deltaY: 400, metaKey: true });
    scrollerOf(stage).dispatchEvent(out);
    expect(out.defaultPrevented).toBe(true);
    expect(d.zoom()).toBeLessThan(1);
    expect(d.zoom()).toBeGreaterThan(0.7); // one event's step is capped
  });

  it('a zero-delta plain wheel neither scrolls, zooms nor stops following', async () => {
    const d = await open();
    const e = wheel({ deltaY: 0 });
    scrollerOf(stage).dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(d.zoom()).toBe(1);
    expect(d.following()).toBe(true);
  });

  it('a Safari pinch (gesture events) zooms the board by its scale and is prevented', async () => {
    const d = await open();
    const ge = (type: string, scale: number) => Object.assign(new Event(type, { bubbles: true, cancelable: true }), { scale, clientX: 900, clientY: 300 });
    const start = ge('gesturestart', 1), change = ge('gesturechange', 1.25);
    scrollerOf(stage).dispatchEvent(start);
    scrollerOf(stage).dispatchEvent(change);
    expect(start.defaultPrevented && change.defaultPrevented).toBe(true);
    expect(d.zoom()).toBeCloseTo(1.25);
    // A ctrl+wheel during the gesture does not zoom twice.
    scrollerOf(stage).dispatchEvent(wheel({ deltaY: -10, ctrlKey: true }));
    expect(d.zoom()).toBeCloseTo(1.25);
    scrollerOf(stage).dispatchEvent(ge('gestureend', 1.25));
  });

  it('zooming with the control is the student taking over: follow stops (no fight with the next reveal)', async () => {
    const d = await open();
    (stage.querySelector('.desk-zoom-in') as HTMLButtonElement).click();
    expect(d.following()).toBe(false);
  });

  it('the pen overlay forwards its wheel: a plain wheel scrolls the board by hand, a pinch zooms', async () => {
    const d = await open();
    const sc = scrollerOf(stage);
    sc.scrollBy = vi.fn();
    const e = wheel({ deltaY: 3, deltaMode: 1 });
    d.wheel(e);
    expect(e.defaultPrevented).toBe(true);
    expect(sc.scrollBy).toHaveBeenCalledWith({ top: 48, left: 0 });
    d.wheel(wheel({ deltaY: -10, ctrlKey: true }));
    expect(d.zoom()).toBeGreaterThan(1);
  });

  it('a press on a drawing starts no selection; a press on a word does (select-to-ask)', async () => {
    await open();
    const layer = stage.querySelector('.desk-region .desk-region-ink g')!;
    const shape = layer.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'rect'));
    const word = layer.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'text'));
    const down = (t: Element) => { const e = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }); t.dispatchEvent(e); return e.defaultPrevented; };
    expect(down(shape)).toBe(true);
    expect(down(word)).toBe(false);
  });
});

describe('Desk: an svg board section', () => {
  let stage: HTMLDivElement;
  beforeEach(() => { vi.useFakeTimers(); stage = document.createElement('div'); });
  afterEach(() => vi.useRealTimers());

  it('is as tall as its canvas from the start (lands once, head on top), and grows past the kit cap', async () => {
    const d = new Desk(fakeHost(), stage);
    const r = await d.addRegion({ id: 'svgb1', page: 2, size: 'l', svg: true, h: 1500 });
    if (typeof r === 'string') throw new Error(r);
    const sec = stage.querySelector('.desk-region') as HTMLElement;
    const h1500 = parseFloat(sec.style.height);
    expect(h1500 / r.scale()).toBeCloseTo(1500, 0);
    d.growRegion('svgb1', 5 * REGION_H);
    expect(parseFloat(sec.style.height) / r.scale()).toBeCloseTo(5 * REGION_H, 0);
  });
  it('kit sections keep their cap', async () => {
    const d = new Desk(fakeHost(), stage);
    const r = await d.addRegion({ id: 'k', page: 2, size: 'm' });
    if (typeof r === 'string') throw new Error(r);
    d.growRegion('k', 6 * REGION_H);
    const sec = stage.querySelector('.desk-region') as HTMLElement;
    expect(parseFloat(sec.style.height) / r.scale()).toBeCloseTo(4 * REGION_H, 0);
  });
});
