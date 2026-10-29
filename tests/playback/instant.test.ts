// The director's instant mode (the live gate's shadow board): no waiting on words, pans or layout
// timing; ink lands in its final state at once; skips are reported as usual.
import { describe, expect, it, vi } from 'vitest';
import { Director, type ActionTiming } from '../../src/playback/director';
import type { BuildElement, DeskApi, ElementPlan, RegionInfo } from '../../src/desk/types';
import type { ViewerApi } from '../../src/pdf/viewerApi';
import { DEFAULTS } from '../../src/settings/settings';
import { parseTag } from '../../src/script/parseTag';
import type { RawAction } from '../../src/script/types';

const SVG = 'http://www.w3.org/2000/svg';
const g = () => document.createElementNS(SVG, 'g') as SVGGElement;

describe('Director instant mode', () => {
  it('runs ink at once with a pre-aborted draw, and reports skips', async () => {
    const regions = new Map<string, RegionInfo>();
    const desk = {
      reset: async () => {}, addRegion: vi.fn(async (s) => { const r = { ...s, layers: { highlight: g(), agent: g() }, scale: () => 0.5, body: () => 16 } as RegionInfo; regions.set(s.id, r); return r; }),
      region: (id: string) => regions.get(id) ?? null, reveal: vi.fn(async () => true), isVisible: () => false, whenVisible: async () => true,
      frameBoth: async () => {}, scrollToPage: async () => {}, addConnector: () => 'unused', following: () => true, cancel: () => {}, abort: () => {},
      state: () => ({ split: 'none', stacked: false, following: true, sketching: false, column: { x: 0, w: 860 } }), subscribe: () => () => {},
    } as unknown as DeskApi;
    const layers = { highlight: g(), agent: g() };
    const viewer = { numPages: () => 3, currentPage: () => 1, spaceHeight: () => 1294, scale: () => 0.8, layers: () => layers, allLayers: () => [layers], textRuns: async () => [], ensureSize: async () => {} } as unknown as ViewerApi;
    const drawSignals: boolean[] = [];
    const build: BuildElement = async (a) => {
      if (a.kind === 'emph') return 'unknown id';
      const plan: ElementPlan = {
        target: (a as { region?: string }).region != null ? { region: (a as { region: string }).region } : { page: 1 }, bbox: { x: 0, y: 0, w: 10, h: 10 },
        draw: async (signal) => { drawSignals.push(signal.aborted); if (!signal.aborted) await new Promise((r) => setTimeout(r, 5000)); },
      };
      return plan;
    };
    const timings: ActionTiming[] = [];
    const d = new Director({ viewer: () => viewer, desk: () => desk, settings: () => DEFAULTS, onScrolledTo: () => {}, build, onTiming: (t) => { if (t.endedAt != null) timings.push(t); }, instant: true, units: false });
    const t0 = performance.now();
    const at = t0 + 60_000; // words a minute away: instant mode doesn't wait for them
    for (const body of ['sketch id=s', 'point on=s at=10,10 "A"', 'emph id=ghost', 'circle p=1 at=100,100 r=20']) d.run(parseTag(body) as RawAction, at);
    await d.idle();
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(drawSignals).toEqual([true, true]);
    expect(desk.reveal).not.toHaveBeenCalled();
    expect(timings.find((t) => t.action.kind === 'emph')?.skipped).toBe('unknown id');
    expect(timings.filter((t) => !t.skipped).map((t) => t.action.kind).sort()).toEqual(['circle', 'point', 'sketch']);
  });
});
