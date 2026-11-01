// tests/playback/directorPage.test.ts — a board section without near= explains the answer's asked page
// (C5: Director.ask), then the page the answer scrolled to; not the reading line's page.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Director } from '../../src/playback/director';
import { DEFAULTS } from '../../src/settings/settings';
import type { ViewerApi } from '../../src/pdf/viewerApi';
import type { DeskApi, RegionSpec } from '../../src/desk/types';
import type { RawAction } from '../../src/script/types';

describe('the director\'s default page is the asked page', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => vi.useRealTimers());
  const g = () => document.createElementNS('http://www.w3.org/2000/svg', 'g') as SVGGElement;
  const setup = () => {
    const specs: RegionSpec[] = [];
    const desk = {
      reset: async () => {}, region: () => null, isVisible: () => true, whenVisible: async () => true, following: () => true,
      addRegion: vi.fn(async (s: RegionSpec) => { specs.push(s); return { ...s, layers: { highlight: g(), agent: g() }, scale: () => 0.5 }; }),
      scrollToPage: async () => {}, reveal: async () => false, frameBoth: async () => {}, addConnector: () => 'unused', cancel: () => {}, abort: () => {},
      state: () => ({ split: 'none', stacked: false, following: true, sketching: false, column: { x: 0, w: 860 } }), subscribe: () => () => {},
    } as unknown as DeskApi;
    const viewer = { numPages: () => 20, currentPage: () => 6, allLayers: () => [], textRuns: async () => [], spaceHeight: () => 562.5 } as unknown as ViewerApi;
    const d = new Director({ viewer: () => viewer, desk: () => desk, settings: () => DEFAULTS, onScrolledTo: () => {} });
    return { d, specs };
  };
  it('a section without near= explains the asked page, not the reading line\'s; after a scroll, the page scrolled to', async () => {
    const { d, specs } = setup();
    d.ask(12);
    d.run({ kind: 'sketch', id: 'a', size: 'm' } as RawAction, 0);
    await vi.advanceTimersByTimeAsync(500);
    d.run({ kind: 'scroll', page: 9 } as RawAction, performance.now());
    d.run({ kind: 'sketch', id: 'b', size: 'm' } as RawAction, performance.now());
    await vi.advanceTimersByTimeAsync(3000);
    expect(specs.map((s) => s.page)).toEqual([12, 9]);
  });
  it('none asked: the page in view, as before', async () => {
    const { d, specs } = setup();
    d.run({ kind: 'sketch', id: 'a', size: 'm' } as RawAction, 0);
    await vi.advanceTimersByTimeAsync(500);
    expect(specs[0].page).toBe(6);
  });
});
