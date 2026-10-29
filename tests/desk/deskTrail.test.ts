// tests/desk/deskTrail.test.ts — the session trail's heads and the aside's inset on the board (v1 learner UX).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Desk, type DeskHost } from '../../src/desk/Desk';
import { computeLayout, frameFor, type Split } from '../../src/desk/layout';

/** A viewer stand-in: real layout math, no pdf.js (as tests/desk/desk.test.ts). */
function fakeHost(W = 1440, H = 900, pages = 5): DeskHost {
  const aspects = new Float64Array(pages).fill(9 / 16);
  const s = { W, H, top: 0, split: 'none' as Split };
  const none = () => () => {};
  const layout = () => computeLayout(frameFor(s.W, s.H, s.split, 9 / 16).page, aspects, s.H);
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
const spec = (id: string) => ({ id, page: 2, size: 'm' as const });
const head = () => { const e = document.createElement('div'); e.className = 'trail-head'; return e; };

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
});
