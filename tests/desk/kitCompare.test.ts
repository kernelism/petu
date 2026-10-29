// Founder live test 2026-10-29 (econ, rent ceiling: `?script=live-econ`): two bar charts meant to be
// compared ("demanded 19" beside "supplied 15") stood on different baselines, offset in a scene.
// Bars side by side are one chart: one baseline, one value scale. And the model's grouped bars
// (`vals=17,17;15,19 parts=supplied,demanded`: a group per row, a bar per part) draw side by side.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildElement } from '../../src/desk/elements';
import { Registry } from '../../src/desk/registry';
import { DEFAULTS } from '../../src/settings/settings';
import { ScriptParser } from '../../src/script/parser';
import { parseTag } from '../../src/script/parseTag';
import { tokenize } from '../../src/script/tokenize';
import { GateState } from '../../src/gate/engine';
import { kitStore } from '../../src/desk/kit/kit';
import type { BuildEnv, DeskApi, SceneClaim, SceneSpace, TargetCtx } from '../../src/desk/types';
import type { InkAction, RawAction, Target } from '../../src/script/types';
import type { SRect } from '../../src/geometry/space';

const SVG = 'http://www.w3.org/2000/svg';
const g = () => document.createElementNS(SVG, 'g') as SVGGElement;
const VIEW = { x: 0, y: 0, w: 1000, h: 700 };

function space(): SceneSpace {
  const claims: SceneClaim[] = [];
  return {
    claim(r: SRect, minor?: 'label' | 'line') {
      const c: SceneClaim = { r, minor, move(n) { c.r = n; }, drop() { claims.splice(claims.indexOf(c), 1); } };
      claims.push(c);
      return c;
    },
    rects: () => claims.map((c) => c.r),
    view: () => VIEW,
    last: () => claims.filter((c) => !c.minor).at(-1)?.r ?? null,
    extent: () => null,
  };
}
function env(scene: boolean) {
  const layers = { highlight: g(), agent: g() };
  const sp = space();
  const ctx = (t: Target): TargetCtx => ({ target: t, layers, h: 700, scale: () => 0.6, body: () => 16, toSpace: (p) => p, rectToSpace: (r) => r, runs: async () => [], ...(scene ? { scene: sp } : {}) });
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
    if (a.kind === 'sketch' || a.kind === 'connect') continue;
    if (a.kind === 'const') { kitStore(e.registry).defineConsts(a.defs); continue; }
    const plan = await buildElement(a as InkAction, e);
    if (typeof plan === 'string') { skips.push(`${a.kind}: ${plan}`); continue; }
    await plan.draw(new AbortController().signal, { speed: 1 });
  }
  e.registry.settle();
  await new Promise((r) => setTimeout(r, 700));
  return skips;
}
const num = (el: Element, k: string) => Number(el.getAttribute(k));
/** Each drawn bar of a block: its rect's bottom (the baseline it stands on) and its height per unit. */
function bars(e: BuildEnv, id: string) {
  const b = kitStore(e.registry).get(id)!;
  const els = b.el.bars as { bars: SVGRectElement[]; segs?: { rects: SVGRectElement[] }[] };
  const rects = b.parts && b.el.side ? els.segs!.flatMap((s) => s.rects) : els.bars;
  const vals = b.parts && b.el.side ? b.parts.flat() : b.vals![0];
  return rects.map((r, i) => ({ x: num(r, 'x'), w: num(r, 'width'), bottom: num(r, 'y') + num(r, 'height'), perUnit: num(r, 'height') / vals[i] }));
}

describe('bars beside bars: one chart', () => {
  beforeEach(() => { vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList); });
  afterEach(() => vi.restoreAllMocks());
  // The second block's numerals are wider (more digits): its cells, and so its body, came out taller.
  const TWO = (on: string) => `{{bars on=${on} id=d vals=19 labels=demanded "wanted, thousands"}} Demand. `
    + `{{bars on=${on} id=q vals=15.25 labels=supplied right=d "offered, thousands"}} Supply.`;
  for (const scene of [false, true]) {
    it(`right= shares the baseline and the value scale (${scene ? 'scene' : 'sketch'})`, async () => {
      const { e } = env(scene);
      expect(await play(e, (scene ? '{{scene id=s near=p88}} ' : '') + TWO('s'))).toEqual([]);
      const [a] = bars(e, 'd'), [b] = bars(e, 'q');
      expect(Math.abs(a.bottom - b.bottom)).toBeLessThan(0.5);
      expect(Math.abs(a.perUnit - b.perUnit) / a.perUnit).toBeLessThan(0.01);
      expect(b.x).toBeGreaterThan(a.x + a.w); // beside, not under
    });
  }
});

describe('grouped bars: a group per row, a bar per part', () => {
  beforeEach(() => { vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList); });
  afterEach(() => vi.restoreAllMocks());
  const TAG = 'bars on=s id=m vals=17,17;15,19 labels=market $600,ceiling $500 parts=supplied,demanded "thousands of units"';
  it('list values written with spaces are read whole (labels=market $600,ceiling $500; states=housed,shut out)', () => {
    expect(tokenize(TAG)!.args.labels).toBe('market $600,ceiling $500');
    expect(tokenize('tokens on=s id=h n=19 states=housed,shut out "households" below=gap')!.args.states).toBe('housed,shut out');
    expect(tokenize('set id=h[16:19] state=shut out')!.args.state).toBe('shut out');
    // flags stay flags
    expect([...tokenize('bars on=s id=b vals=1;2,3 labels=a,b stack')!.flags]).toEqual(['stack']);
  });
  it('rectangular rows with parts= parse as grouped bars (side by side); the value model reads parts', () => {
    expect(parseTag(TAG)).toMatchObject({ kind: 'bars', stack: { vals: [[17, 17], [15, 19]], side: true }, labels: ['market $600', 'ceiling $500'], parts: ['supplied', 'demanded'] });
    const st = new GateState();
    st.apply(parseTag(TAG) as RawAction, 0);
    expect(st.value('m[2,2]')).toMatchObject({ v: 19 });
    // Without parts= rectangular rows stay malformed (a bar chart is one row).
    expect(parseTag('bars on=s id=b vals=1,2;3,4')).toBeNull();
  });
  it('draws every part as its own bar on one baseline and scale; set moves one bar', async () => {
    const { e } = env(true);
    expect(await play(e, `{{scene id=s near=p88}} {{${TAG}}} Market and ceiling.`)).toEqual([]);
    const bs = bars(e, 'm');
    expect(bs).toHaveLength(4);
    for (const x of bs) { expect(Math.abs(x.bottom - bs[0].bottom)).toBeLessThan(0.5); expect(Math.abs(x.perUnit - bs[0].perUnit) / bs[0].perUnit).toBeLessThan(0.01); }
    // left to right, never overlapping
    for (let i = 1; i < 4; i++) expect(bs[i].x).toBeGreaterThanOrEqual(bs[i - 1].x + bs[i - 1].w - 0.01);
    expect(await play(e, '{{set id=m[2,1] to=12}} {{set id=m[2,2] to=23}} Lower ceiling.')).toEqual([]);
    const after = bars(e, 'm');
    expect(after[2].perUnit * 12).toBeCloseTo(after[0].perUnit * 12, 1);
    const segs = (kitStore(e.registry).get('m')!.el.bars as { segs: { rects: SVGRectElement[] }[] }).segs;
    expect(num(segs[1].rects[1], 'height') / num(segs[0].rects[0], 'height')).toBeCloseTo(23 / 17, 1);
  });
});
