// tests/desk/pageInk.test.ts — the slide's painted content as an obstacle (design 3.3c): mask reads
// and the boxes placers take; a readout point's label keeps off its own plot's strokes.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { inkBoxes, inkIn, type PageInk } from '../../src/desk/pageInk';
import { buildElement } from '../../src/desk/elements';
import { Registry } from '../../src/desk/registry';
import { DEFAULTS } from '../../src/settings/settings';
import { ScriptParser } from '../../src/script/parser';
import { kitStore } from '../../src/desk/kit/kit';
import type { BuildEnv, DeskApi, TargetCtx } from '../../src/desk/types';
import type { InkAction, RawAction, Target } from '../../src/script/types';

/** A 10 × 10 mask over a 1000 × 1000 page with a printed label at cells (row 2, cols 3–4). */
function ink(): PageInk {
  const cells = new Uint8Array(100);
  cells[2 * 10 + 3] = 1; cells[2 * 10 + 4] = 1;
  return { cols: 10, rows: 10, cells, W: 1000, H: 1000 };
}

describe('page ink', () => {
  it('reads the share of a box the slide painted', () => {
    expect(inkIn(ink(), { x: 300, y: 200, w: 199, h: 99 })).toBe(1);
    expect(inkIn(ink(), { x: 600, y: 600, w: 100, h: 100 })).toBe(0);
    expect(inkIn(null, { x: 300, y: 200, w: 10, h: 10 })).toBe(0);
  });
  it('turns painted cells in an area into merged row boxes', () => {
    expect(inkBoxes(ink(), { x: 0, y: 0, w: 999, h: 999 })).toEqual([{ x: 300, y: 200, w: 200, h: 100 }]);
    expect(inkBoxes(ink(), { x: 600, y: 0, w: 300, h: 999 })).toEqual([]);
  });
});

const SVG = 'http://www.w3.org/2000/svg';
const g = () => document.createElementNS(SVG, 'g') as SVGGElement;

describe('a readout point label never sits on its plot\'s strokes', () => {
  beforeEach(() => { vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList); });
  afterEach(() => vi.restoreAllMocks());

  it('on a rising line the default north-east spot is crossed by the curve, so it goes to a clear side', async () => {
    const layers = { highlight: g(), agent: g() };
    const ctx = (t: Target): TargetCtx => ({ target: t, layers, h: 700, scale: () => 0.6, body: () => 16, toSpace: (p) => p, rectToSpace: (r) => r, runs: async () => [] });
    const desk = { growRegion: vi.fn(), centreRegion: vi.fn(), addConnector: vi.fn(), region: () => null } as unknown as DeskApi;
    const e: BuildEnv = { ctx: async (t) => ctx(t), registry: new Registry(), settings: DEFAULTS, rng: () => null, desk };
    const p = new ScriptParser();
    for (const x of [...p.push('{{sketch id=s near=p1}}{{plot on=s id=f fn="x" domain=0,10 "f"}} a {{find id=E of=f x=5}} b {{point on=s at=E "E"}} c'), ...p.end()]) {
      if (x.type !== 'action') continue;
      const a = x.action as RawAction;
      if (a.kind === 'sketch') continue;
      if (a.kind === 'find') { kitStore(e.registry).finds.set(a.id, a); continue; }
      const plan = await buildElement(a as InkAction, e);
      if (typeof plan !== 'string') await plan.draw(new AbortController().signal, { speed: 1 });
    }
    const label = [...layers.agent.querySelectorAll('text')].find((t) => t.textContent === 'E')!;
    expect(label).toBeTruthy();
    const dot = layers.agent.querySelector('circle')!;
    const cx = Number(dot.getAttribute('cx')), cy = Number(dot.getAttribute('cy'));
    // The line runs up-right through the dot: its label is not to the north-east (start-anchored, above).
    const lx = Number(label.getAttribute('x')), ly = Number(label.getAttribute('y'));
    expect(!(lx > cx && ly < cy && label.getAttribute('text-anchor') === 'start')).toBe(true);
  });
});
