// tests/desk/glideFocus.test.ts — the page in frame follows what the tutor showed (C5). An answer does
// {{scroll p=6}} then {{highlight p=12 …}}: the desk glides to p12 itself (Desk.reveal → host.glideTo),
// and the viewer's focus page (shownPage = focus ?? center, the next question's page) must follow it.
// The viewer side is the real steeredGlide; the steer/shown bookkeeping mirrors PdfViewer's.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Desk, type DeskHost } from '../../src/desk/Desk';
import { computeLayout, frameFor, SAFE_TOP, type Split } from '../../src/desk/layout';
import { Director } from '../../src/playback/director';
import { currentPageOf, steeredGlide } from '../../src/pdf/PdfViewer';
import { DEFAULTS } from '../../src/settings/settings';
import type { ViewerApi } from '../../src/pdf/viewerApi';
import type { BuildElement } from '../../src/desk/types';
import type { RawAction } from '../../src/script/types';

/** A viewer stand-in: real layout math, PdfViewer's focus rule (steer sets it; shown = focus ?? center). */
function viewerHost(W = 1440, H = 900, pages = 20) {
  const aspects = new Float64Array(pages).fill(9 / 16);
  const s = { top: 0, split: 'none' as Split, focus: null as number | null };
  const scroll = new Set<() => void>();
  const layout = () => computeLayout(frameFor(W, H, s.split, 9 / 16, false).page, aspects, H);
  const center = () => currentPageOf(layout(), s.top, H, 1);
  const steer = (p: number) => { s.focus = p; };
  const move = (top: number) => { s.top = Math.max(0, top); scroll.forEach((f) => f()); };
  const host: DeskHost = {
    viewport: () => ({ W, H }), layout, scrollTop: () => s.top, maxScroll: () => Math.max(0, layout().total - H), aspect: () => 9 / 16,
    setSplit: async (split: Split) => { s.split = split; },
    glideTo: vi.fn(steeredGlide(steer, async (top: () => number) => move(top()))),
    cancelGlide: () => {},
    // ViewerApi.scrollToPage: a move to another page steers to it.
    scrollToPage: vi.fn(async (p: number) => { steer(p); move(layout().tops[p - 1] - SAFE_TOP); }),
    onLayout: () => () => {}, onScroll: (cb: () => void) => { scroll.add(cb); return () => { scroll.delete(cb); }; }, onUserIntent: () => () => {},
  } as unknown as DeskHost;
  const viewer = { numPages: () => pages, currentPage: center, allLayers: () => [], textRuns: async () => [], spaceHeight: () => 562.5 } as unknown as ViewerApi;
  return { host, viewer, s, shown: () => s.focus ?? center() };
}

describe('the page in frame follows the desk\'s glides', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => vi.useRealTimers());

  it('{{scroll p=6}} then {{highlight p=12}}: shownPage ends at 12', async () => {
    const v = viewerHost();
    const desk = new Desk(v.host, document.createElement('div'));
    desk.follow.setAnswering(true);
    const build: BuildElement = async () => ({ target: { page: 12 }, bbox: { x: 100, y: 300, w: 400, h: 40 }, draw: async () => {} });
    const d = new Director({ viewer: () => v.viewer, desk: () => desk, settings: () => DEFAULTS, onScrolledTo: () => {}, build });
    const t0 = performance.now();
    d.run({ kind: 'scroll', page: 6 }, t0);
    await vi.advanceTimersByTimeAsync(1500);
    expect(v.shown()).toBe(6);
    d.run({ kind: 'highlight', page: 12, quote: 'the rate' } as RawAction, performance.now());
    await vi.advanceTimersByTimeAsync(3000);
    // The desk glided to p12 (not through scrollToPage) and said which page it showed.
    expect(v.host.scrollToPage).toHaveBeenCalledTimes(1);
    expect(v.host.glideTo).toHaveBeenCalledWith(expect.any(Function), 450, 12);
    expect(v.viewer.currentPage()).toBe(12);
    expect(v.shown()).toBe(12);
  });

  it('a glide that names no page (the lane, a trail head) leaves the focus alone', async () => {
    const v = viewerHost();
    v.s.focus = 6;
    await v.host.glideTo(() => 4000, 450);
    expect(v.shown()).toBe(6);
  });
});
