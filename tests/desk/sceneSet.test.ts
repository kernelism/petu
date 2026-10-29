// tests/desk/sceneSet.test.ts — relabelling a scene thing in place: a node, a flow's part, a merged chip.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildElement } from '../../src/desk/elements';
import { Registry } from '../../src/desk/registry';
import { DEFAULTS } from '../../src/settings/settings';
import { ScriptParser } from '../../src/script/parser';
import { sceneStore } from '../../src/desk/scene/store';
import type { BuildEnv, DeskApi, SceneClaim, SceneSpace, TargetCtx } from '../../src/desk/types';
import type { InkAction, RawAction, Target } from '../../src/script/types';
import type { SRect } from '../../src/geometry/space';

const SVG = 'http://www.w3.org/2000/svg';
const g = () => document.createElementNS(SVG, 'g') as SVGGElement;

function space(): SceneSpace {
  const claims: SceneClaim[] = [];
  return {
    claim(r: SRect, minor?: 'label' | 'line') {
      const c: SceneClaim = { r, minor, move(n) { c.r = n; }, drop() { claims.splice(claims.indexOf(c), 1); } };
      claims.push(c);
      return c;
    },
    rects: () => claims.map((c) => c.r),
    view: () => ({ x: 0, y: 0, w: 1000, h: 700 }),
    last: () => claims.filter((c) => !c.minor).at(-1)?.r ?? null,
    extent: () => null,
  };
}

function env() {
  const layers = { highlight: g(), agent: g() };
  const scene = space();
  const ctx = (t: Target): TargetCtx => ({ target: t, layers, h: 700, scale: () => 0.6, body: () => 16, toSpace: (p) => p, rectToSpace: (r) => r, runs: async () => [], scene });
  const desk = { growRegion: vi.fn(), centreRegion: vi.fn(), addConnector: vi.fn() } as unknown as DeskApi;
  const e: BuildEnv = { ctx: async (t) => ctx(t), registry: new Registry(), settings: DEFAULTS, rng: () => null, desk };
  return { e, layers };
}

async function play(e: BuildEnv, script: string) {
  const p = new ScriptParser();
  const skips: string[] = [];
  for (const x of [...p.push(script), ...p.end()]) {
    if (x.type !== 'action') continue;
    const a = x.action as RawAction;
    if (a.kind === 'sketch') continue;
    const plan = await buildElement(a as InkAction, e);
    if (typeof plan === 'string') { skips.push(`${a.kind}: ${plan}`); continue; }
    await plan.draw(new AbortController().signal, { speed: 1 });
  }
  e.registry.settle();
  return skips;
}

const label = (e: BuildEnv, id: string, i: number) => {
  const chips = sceneStore(e.registry).get(id)!.data!.chips as SVGRectElement[];
  return chips[i].parentElement!.querySelector('text')!.textContent;
};
const chipW = (e: BuildEnv, id: string, i: number) => Number((sceneStore(e.registry).get(id)!.data!.chips as SVGRectElement[])[i].getAttribute('width'));

describe('set relabels a scene thing in place', () => {
  beforeEach(() => { vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList); });
  afterEach(() => vi.restoreAllMocks());

  it('a flow part: only that chip takes the new words', async () => {
    const { e } = env();
    const skips = await play(e, '{{scene id=s near=p1}} {{flow on=s id=flow "A" "B" "C" arrows}} {{set id=flow[2] "I"}}');
    expect(skips).toEqual([]);
    expect([0, 1, 2].map((i) => label(e, 'flow', i))).toEqual(['A', 'I', 'C']);
    expect((sceneStore(e.registry).get('flow')!.data!.text as string[])[1]).toBe('I');
  });

  it('a node: the label changes, the chip widens for longer words and its room follows', async () => {
    const { e } = env();
    const skips = await play(e, '{{scene id=s near=p1}} {{node on=s id=a "x"}} {{set id=a "a much longer label"}}');
    expect(skips).toEqual([]);
    expect(label(e, 'a', 0)).toBe('a much longer label');
    const t = sceneStore(e.registry).get('a')!;
    expect(t.rect.w).toBeGreaterThanOrEqual(chipW(e, 'a', 0) - 1e-6);
    expect(t.claim!.r).toEqual(t.rect);
  });

  it('a flow part between neighbours never grows into them: its words squeeze instead', async () => {
    const { e } = env();
    await play(e, '{{scene id=s near=p1}} {{flow on=s id=f "A" "B" "C"}} {{set id=f[2] "a far longer label than the room allows"}}');
    const parts = sceneStore(e.registry).get('f')!.parts!;
    expect(parts[1].x + parts[1].w).toBeLessThan(parts[2].x);
    expect(parts[0].x + parts[0].w).toBeLessThan(parts[1].x);
    const chips = sceneStore(e.registry).get('f')!.data!.chips as SVGRectElement[];
    expect(chips[1].parentElement!.querySelector('text')!.getAttribute('textLength')).not.toBeNull();
  });

  it('a range of parts and a merged chip take a label too', async () => {
    const { e } = env();
    const skips = await play(e, '{{scene id=s near=p1}} {{flow on=s id=f "A" "B" "C"}} {{set id=f[1:2] "z"}} {{node on=s id=a "a"}} {{node on=s id=b "b"}} {{merge on=s id=m of=a,b "ab"}} {{set id=m "both"}}');
    expect(skips).toEqual([]);
    expect([0, 1, 2].map((i) => label(e, 'f', i))).toEqual(['z', 'z', 'C']);
    expect(label(e, 'm', 0)).toBe('both');
  });

  it('a whole flow or a part outside it is skipped with a reason, never a silent no-op', async () => {
    const { e } = env();
    const skips = await play(e, '{{scene id=s near=p1}} {{flow on=s id=f "A" "B"}} {{set id=f "x"}} {{set id=f[5] "x"}}');
    expect(skips).toHaveLength(2);
    expect(skips[0]).toMatch(/part of f/);
    expect(skips[1]).toMatch(/outside f/);
  });
});
