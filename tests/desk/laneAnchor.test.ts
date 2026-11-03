// tests/desk/laneAnchor.test.ts — the lane board opens beside the page the answer explains (its asked
// page, Director.ask → the section's page) when that page is in view, not beside whatever page lies
// under a line 12% down the band. The two named different pages at 26–57% of scroll positions once the
// asked page became the most visible one (diag lane.ts).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Desk, type DeskHost } from '../../src/desk/Desk';
import { computeLayout, frameFor, laneAnchorAt, mostVisiblePage, pageAt, safeBottom, SAFE_TOP, type Split } from '../../src/desk/layout';

function laneHost(lane: HTMLElement, top: number, W = 1440, H = 900, pages = 8) {
  const aspects = new Float64Array(pages).fill(9 / 16);
  const s = { split: 'none' as Split };
  const none = () => () => {};
  const layout = () => computeLayout(frameFor(W, H, s.split, 9 / 16, true).page, aspects, H);
  return {
    viewport: () => ({ W, H }), layout, scrollTop: () => top, maxScroll: () => Math.max(0, layout().total - H), aspect: () => 9 / 16,
    setSplit: vi.fn(async (split: Split) => { s.split = split; }), glideTo: vi.fn(async () => {}), cancelGlide: vi.fn(), scrollToPage: vi.fn(async () => {}),
    onLayout: none, onScroll: none, onUserIntent: none, laneEl: () => lane,
  } as unknown as DeskHost;
}

/** The band and the old anchor line at scroll `top`. */
const band = (host: DeskHost, top: number) => {
  const { H } = host.viewport();
  return { lo: top + SAFE_TOP, hi: top + H - safeBottom(), line: top + SAFE_TOP + 0.12 * (H - SAFE_TOP - safeBottom()), H };
};

async function opened(top: number, page: number) {
  const lane = document.createElement('div'), stage = document.createElement('div');
  document.body.append(lane, stage);
  const host = laneHost(lane, top);
  const d = new Desk(host, stage);
  const p = d.addRegion({ id: 'b', page, size: 'l', svg: true, h: 600 });
  await vi.advanceTimersByTimeAsync(1500);
  if (typeof (await p) === 'string') throw new Error('no region');
  const g = (d as unknown as { groups: { anchor: { page: number; y: number } }[] }).groups[0];
  return { host, anchor: g.anchor };
}

describe('the lane board\'s anchor is the asked page when it is in view', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => vi.useRealTimers());

  it('p1 under the 12% line, p2 most visible and asked: the board opens beside p2, level with its top in view', async () => {
    const lane = document.createElement('div');
    const host = laneHost(lane, 0);
    const L = host.layout()!;
    // A scroll position where the old line names p1 while p2 has more on screen (the asked page).
    let top = 0;
    for (; top < L.tops[2]; top += 2) { const b = band(host, top); if (pageAt(L, b.line) === 1 && mostVisiblePage(L, b.lo, b.hi, top + 0.35 * b.H) === 2) break; }
    expect(top).toBeLessThan(L.tops[2]);
    const { anchor } = await opened(top, 2);
    expect(anchor.page).toBe(2);
    expect(anchor.y).toBe(0); // p2's top is below the old line: the anchor is its first line in view
  });

  it('the asked page scrolled out of view: the reading line\'s page, as before', async () => {
    const { anchor } = await opened(0, 6);
    expect(anchor.page).toBe(1);
  });
});

describe('laneAnchorAt', () => {
  const L = { tops: Float64Array.from([0, 324, 648]), heights: Float64Array.from([300, 300, 300]) };
  it('the page in the band, at the line clamped into its visible part', () => {
    expect(laneAnchorAt(L, 100, 700, 150, 2)).toEqual({ page: 2, y: 324 });
    expect(laneAnchorAt(L, 100, 700, 150, 1)).toEqual({ page: 1, y: 150 });
    expect(laneAnchorAt(L, 400, 1000, 450, 2)).toEqual({ page: 2, y: 450 });
  });
  it('a page out of the band, or out of range: the page under the line', () => {
    expect(laneAnchorAt(L, 100, 600, 150, 3)).toEqual({ page: 1, y: 150 });
    expect(laneAnchorAt(L, 100, 600, 150, 9)).toEqual({ page: 1, y: 150 });
  });
});

describe('"Back to answer" in the lane', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => vi.useRealTimers());

  it('returns to the latest page mark, not the sticky drawing the pen is in', async () => {
    const lane = document.createElement('div'), stage = document.createElement('div');
    document.body.append(lane, stage);
    const host = laneHost(lane, 0);
    const d = new Desk(host, stage);
    const p = d.addRegion({ id: 'b', page: 1, size: 'l', svg: true, h: 600 });
    await vi.advanceTimersByTimeAsync(1500);
    await p;
    const inner = d as unknown as { inked: { page: number; r: object }[]; last: { t: object; r: object } };
    inner.inked = [{ page: 6, r: { x: 100, y: 200, w: 300, h: 20 } }];
    inner.last = { t: { region: 'b' }, r: { x: 0, y: 0, w: 100, h: 100 } };
    d.follow.setAnswering(true);
    d.follow.userTookOver();
    vi.mocked(host.glideTo).mockClear();
    await d.resume();
    expect(d.following()).toBe(true);
    expect(host.glideTo).toHaveBeenCalledTimes(1);
    expect(vi.mocked(host.glideTo).mock.calls[0][2]).toBe(6);
  });
});

describe('the desk tells its layout when the lane turns on', () => {
  it('a subscriber hears lane: true on the first layout pass, before any answer', () => {
    const lane = document.createElement('div'), stage = document.createElement('div');
    document.body.append(lane, stage);
    let layout: () => void = () => {};
    const host = { ...laneHost(lane, 0), onLayout: (f: () => void) => { layout = f; return () => {}; } } as unknown as DeskHost;
    const d = new Desk(host, stage);
    const heard: boolean[] = [];
    d.subscribe((s) => heard.push(!!s.lane));
    (d as unknown as { wasLane: boolean }).wasLane = false;
    layout();
    expect(heard).toContain(true);
    expect(d.state().lane).toBe(true);
  });
});

describe('replaying an answer whose board later answers drew on', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => vi.useRealTimers());

  it('keeps the follow-up on the board; the replay draws afresh beside it', async () => {
    const lane = document.createElement('div'), stage = document.createElement('div');
    document.body.append(lane, stage);
    const d = new Desk(laneHost(lane, 0), stage);
    const head = (t: string) => { const e = document.createElement('div'); e.className = 'trail-head'; e.textContent = t; return e; };
    const h1 = head('1'), h2 = head('2');
    const add = async (o: object) => { const p = d.addRegion({ id: 'b', page: 1, size: 'l', svg: true, h: 400, ...o }); await vi.advanceTimersByTimeAsync(1500); return p; };
    d.headNext(h1, 36);
    await add({});
    await d.reset(0);
    // The follow-up extends answer 1's svg: its head rides mid-drawing in answer 1's group.
    d.headNext(h2, 36);
    await add({ extend: true });
    expect(h2.isConnected).toBe(true);
    await d.reset(0);
    // Answer 1 replays: its head waits for the replay's first section, which takes it.
    d.headNext(h1, 36);
    expect(typeof (await add({}))).not.toBe('string');
    expect(h1.isConnected).toBe(true);
    expect(h2.isConnected).toBe(true);
    expect(lane.querySelectorAll('.lane-group').length + stage.querySelectorAll('.lane-group').length).toBeGreaterThanOrEqual(2);
  });
});
