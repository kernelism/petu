// tests/desk/boardSnapshot.test.ts — a saved question's board taken off the desk and put back as it was
// (the ask bar's +, a pick in the session list), in the split board and the lane, across a resize.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Desk, type DeskHost } from '../../src/desk/Desk';
import { computeLayout, frameFor, type Split } from '../../src/desk/layout';

/** A viewer stand-in (as tests/desk/deskTrail.test.ts); `lane` gives it the lane layer (layout C). */
function fakeHost(W = 1440, H = 900, lane = false) {
  const aspects = new Float64Array(5).fill(9 / 16);
  const s = { W, H, top: 0, split: 'none' as Split };
  const laneEl = document.createElement('div');
  const none = () => () => {};
  const layout = () => computeLayout(frameFor(s.W, s.H, s.split, 9 / 16, lane).page, aspects, s.H);
  const host = {
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
    ...(lane ? { laneEl: () => laneEl } : {}),
  } as unknown as DeskHost;
  return { host, s, laneEl };
}
const spec = (id: string, o: object = {}) => ({ id, page: 2, size: 'm' as const, ...o });
const head = (t: string) => { const e = document.createElement('div'); e.className = 'trail-head'; e.textContent = t; return e; };
const settle = () => vi.advanceTimersByTimeAsync(1500);
const regions = (root: Element) => [...root.querySelectorAll<HTMLElement>('.desk-region')];

describe('Desk: takeBoard / putBoard', () => {
  let stage: HTMLDivElement;
  beforeEach(() => { vi.useFakeTimers(); stage = document.createElement('div'); });
  afterEach(() => vi.useRealTimers());

  it('split board: everything leaves and the board slides out; the same nodes come back, laid out for the window as it is now', async () => {
    const { host, s } = fakeHost(1000, 800);
    const d = new Desk(host, stage);
    const h1 = head('q1'), h2 = head('follow-up');
    d.headNext(h1, 44);
    const a = d.addRegion(spec('a')); await settle(); await a;
    await d.reset(0);
    d.headNext(h2, 44);
    const b = d.addRegion(spec('b')); await settle(); await b;
    const before = regions(stage);
    expect(before).toHaveLength(2);
    expect(d.state().split).not.toBe('none');

    const snap = d.takeBoard();
    await settle();
    expect(snap).not.toBeNull();
    expect(regions(stage)).toHaveLength(0);
    expect(stage.contains(h1) || stage.contains(h2)).toBe(false);
    expect(d.state().split).toBe('none');
    expect(host.setSplit).toHaveBeenLastCalledWith('none', expect.any(Number));
    expect(d.takeBoard()).toBeNull(); // nothing left to take

    // The window changes while it is saved: it comes back laid out for the new one.
    s.W = 1100;
    const p = d.putBoard(snap!); await settle(); await p;
    expect(regions(stage)).toEqual(before);
    expect(stage.contains(h1) && stage.contains(h2)).toBe(true);
    expect(d.state().split).toBe('normal');
    const [ra, rb] = regions(stage);
    expect(parseFloat(rb.style.top)).toBeGreaterThan(parseFloat(ra.style.top));
    expect(parseFloat(h2.style.top)).toBeCloseTo(parseFloat(rb.style.top) - 44, 3);
    const w = parseFloat(ra.style.width);
    expect(w).toBeGreaterThan(0);
  });

  it('a new answer after a put draws below the restored board (a follow-up continues it)', async () => {
    const { host } = fakeHost(1000, 800);
    const d = new Desk(host, stage);
    d.headNext(head('q1'), 44);
    const a = d.addRegion(spec('a')); await settle(); await a;
    const snap = d.takeBoard()!;
    await settle();
    const p = d.putBoard(snap); await settle(); await p;
    await d.reset(0);
    d.headNext(head('more'), 44);
    const c = d.addRegion(spec('c')); await settle(); await c;
    const [ra, rc] = regions(stage);
    expect(rc.dataset.id ?? 'c').toBeTruthy();
    expect(parseFloat(rc.style.top)).toBeGreaterThan(parseFloat(ra.style.top));
  });

  it('the lane: its groups leave the lane and come back in order; nothing opens or glides', async () => {
    const { host, laneEl } = fakeHost(1440, 900, true);
    const d = new Desk(host, stage);
    d.follow.setAnswering(true);
    d.headNext(head('q1'), 44);
    await d.addRegion(spec('a'));
    await d.overview();
    await d.reset(0);
    d.headNext(head('f1'), 44);
    await d.addRegion(spec('b'));
    const groups = [...laneEl.querySelectorAll('.lane-group')];
    expect(groups).toHaveLength(2);
    // The second answer is still playing (sticky): taking the board docks it first.
    const snap = d.takeBoard()!;
    expect(laneEl.querySelectorAll('.lane-group, .desk-region, .trail-head')).toHaveLength(0);
    expect(d.state().lane).toBe(true);
    expect(host.setSplit).not.toHaveBeenCalled();
    await d.putBoard(snap);
    expect([...laneEl.querySelectorAll('.lane-group')]).toEqual(groups);
    expect(regions(laneEl)).toHaveLength(2);
    expect(laneEl.querySelector('.lane-group.is-live')).toBeNull();
    expect(laneEl.querySelectorAll('.trail-head')).toHaveLength(2);
  });

  it('keepOpen: the split board stays open for the board that comes back next', async () => {
    const { host } = fakeHost(1000, 800);
    const d = new Desk(host, stage);
    const a = d.addRegion(spec('a')); await settle(); await a;
    (host.setSplit as ReturnType<typeof vi.fn>).mockClear();
    d.takeBoard(true);
    expect(host.setSplit).not.toHaveBeenCalled();
  });
});
