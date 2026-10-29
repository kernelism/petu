// tests/desk/placement.test.ts — one placement authority (design 3.1, 3.9): in a scene, every kit block,
// calc line and engine plot claims its room in the scene's world, and nothing placed later lands on it.
// The scripts are the eval's cluttered answers (sol D3, D6), cut to their placement.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildElement } from '../../src/desk/elements';
import { Registry } from '../../src/desk/registry';
import { DEFAULTS } from '../../src/settings/settings';
import { ScriptParser } from '../../src/script/parser';
import { SceneStore } from '../../src/desk/scene/store';
import { kitStore, worldBox } from '../../src/desk/kit/kit';
import type { BuildEnv, DeskApi, RegionInfo, SceneClaim, SceneSpace, TargetCtx } from '../../src/desk/types';
import type { InkAction, RawAction, Target } from '../../src/script/types';
import type { SRect } from '../../src/geometry/space';

const SVG = 'http://www.w3.org/2000/svg';
const g = () => document.createElementNS(SVG, 'g') as SVGGElement;

function space(): SceneSpace & { all: SceneClaim[] } {
  const claims: SceneClaim[] = [];
  return {
    all: claims,
    claim(r: SRect, minor?: 'label' | 'line') {
      const c: SceneClaim = { r: { ...r }, minor, move(n) { c.r = { ...n }; }, drop() { const i = claims.indexOf(c); if (i >= 0) claims.splice(i, 1); } };
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
  const desk = {
    growRegion: vi.fn(), centreRegion: vi.fn(), addConnector: vi.fn(),
    region: (id: string) => ({ id, scene } as unknown as RegionInfo),
  } as unknown as DeskApi;
  const e: BuildEnv = { ctx: async (t) => ctx(t), registry: new Registry(), settings: DEFAULTS, rng: () => null, desk };
  return { e, scene };
}

async function play(e: BuildEnv, script: string) {
  const p = new ScriptParser();
  const skips: string[] = [];
  for (const x of [...p.push(script), ...p.end()]) {
    if (x.type !== 'action') continue;
    const a = x.action as RawAction;
    if (a.kind === 'sketch') continue;
    if (a.kind === 'const') { kitStore(e.registry).defineConsts(a.defs); continue; }
    const plan = await buildElement(a as InkAction, e);
    if (typeof plan === 'string') { skips.push(`${a.kind}: ${plan}`); continue; }
    await plan.draw(new AbortController().signal, { speed: 1 });
  }
  e.registry.settle();
  return skips;
}

const area = (a: SRect, b: SRect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
/** Every pair of kit blocks (tables, calc lines, plots, grids) in the section whose rooms overlap. */
function clashes(e: BuildEnv, region: string): string[] {
  const bs = kitStore(e.registry).inRegion(region);
  const out: string[] = [];
  for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
    const a = worldBox(bs[i], bs[i].placed.rect), b = worldBox(bs[j], bs[j].placed.rect);
    if (area(a, b) > 1) out.push(`${bs[i].id}(${bs[i].kind}) × ${bs[j].id}(${bs[j].kind})`);
  }
  return out;
}

describe('one placement authority in a scene', () => {
  beforeEach(() => { vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList); });
  afterEach(() => vi.restoreAllMocks());

  it('sol D6: a second table placed below the first never lands on the first table\'s calc line', async () => {
    const { e } = env();
    const skips = await play(e,
      '{{scene id=roots near=p1}}{{table on=roots id=variance cols=n,sum,mean vals=10;40;160}} a {{col id=variance.sum fn="a"}} b {{col id=variance.mean fn="b/a^2"}} c ' +
      '{{table on=roots id=interval cols=n,SE,width vals=10;40;160 below=variance}}{{col id=interval.SE fn="1/sqrt(a)"}} d {{const z=1.96}}{{col id=interval.width fn="2*z*b"}} e');
    expect(skips).toEqual([]);
    expect(clashes(e, 'roots')).toEqual([]);
  });

  it('sol D3: a table\'s columns share one live calc line (rewritten, never stacked), and a plot placed after it keeps clear', async () => {
    const { e } = env();
    const skips = await play(e,
      '{{scene id=s near=p1}}{{table on=s id=t cols=tax,Pb,Ps,Q vals=2;4}} a {{col id=t.Pb fn="(70+5*a)/10"}} b {{col id=t.Ps fn="b-a"}} c {{col id=t.Q fn="60-5*b"}} d ' +
      '{{plot on=s id=d fn="12-x/5" domain=10,30 xlabel="Q" ylabel="P" "D"}} e');
    expect(skips).toEqual([]);
    const calcs = kitStore(e.registry).inRegion('s').filter((b) => b.kind === 'calc');
    expect(calcs).toHaveLength(1);
    expect(clashes(e, 's')).toEqual([]);
  });

  it('a column added to a table widens its claim (later things keep clear of the new column)', async () => {
    const { e, scene } = env();
    await play(e, '{{scene id=s near=p1}}{{table on=s id=t cols=x vals=1;2;3}} a {{col id=t.y fn="a*2"}} b {{col id=t.z fn="b*2"}} c');
    const t = kitStore(e.registry).get('t')!;
    const claim = scene.all.find((c) => c.r.x === t.placed.rect.x && c.r.y === t.placed.rect.y)!;
    expect(claim.r.w).toBeCloseTo(t.placed.rect.w, 3);
  });
});

describe('a plain section: kit blocks keep clear of the other ink in it', () => {
  beforeEach(() => { vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList); });
  afterEach(() => vi.restoreAllMocks());

  it('a table placed after a hand-drawn figure goes under it, not over it', async () => {
    const { e } = env();
    // A plain sketch: no scene in its context.
    const layers = { highlight: g(), agent: g() };
    const ctx = (t: Target): TargetCtx => ({ target: t, layers, h: 700, scale: () => 0.6, body: () => 16, toSpace: (p) => p, rectToSpace: (r) => r, runs: async () => [] });
    e.ctx = async (t) => ctx(t);
    e.desk = { growRegion: vi.fn(), centreRegion: vi.fn(), addConnector: vi.fn(), region: () => null } as unknown as DeskApi;
    const skips = await play(e, '{{sketch id=a near=p1}}{{box on=a at=40,40 size=600,200}} a {{table on=a id=t cols=x,y vals=1,2;3,4}} b');
    expect(skips).toEqual([]);
    const t = kitStore(e.registry).get('t')!.placed.rect;
    const box = e.registry.entries().find((x) => x.kind === 'box')!.bbox;
    expect(area(t, box)).toBe(0);
  });
});

describe('charts and images keep a readable size (design 3.3a)', () => {
  beforeEach(() => { vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList); });
  afterEach(() => vi.restoreAllMocks());

  it('a long thin image (200 samples of 10 draws) is a strip, not a sliver; rows of an image beside it line up', async () => {
    const { e } = env();
    const skips = await play(e, '{{scene id=h near=p1}}{{grid on=h id=x size=10x200 fn="randn()" view=image "200 samples"}} a {{grid on=h id=y size=1000x10 fn="randn()" view=image below=x}} b {{grid on=h id=ym over=y win=1x10 reduce=mean right=y}} c');
    expect(skips).toEqual([]);
    const ratio = (id: string) => { const b = kitStore(e.registry).get(id)!.placed.body; return Math.min(b.w, b.h) / Math.max(b.w, b.h); };
    expect(ratio('x')).toBeGreaterThanOrEqual(0.29);
    expect(ratio('y')).toBeGreaterThanOrEqual(0.29);
    const y = kitStore(e.registry).get('y')!, ym = kitStore(e.registry).get('ym')!;
    expect(ym.placed.body.h).toBeCloseTo(y.placed.body.h, 3);
  });

  it('a line beside another block is never squeezed under 520 × 300 section units', async () => {
    const { e } = env();
    const skips = await play(e, '{{sketch id=a near=p1}}{{bars on=a id=v vals=1,2,3}} a {{bars on=a id=w map=v fn="x*x" view=line right=v}} b');
    expect(skips).toEqual([]);
    const b = kitStore(e.registry).get('w')!.placed.body;
    expect(b.w).toBeGreaterThanOrEqual(520);
    expect(b.h).toBeGreaterThanOrEqual(300);
  });
});

describe('scene re-routes are serial and ordered', () => {
  it('a batch drops every queued link\'s room first, then routes them in creation order, whatever order the hooks fired', async () => {
    const s = new SceneStore();
    const log: string[] = [];
    const job = (name: string) => { const order = s.nextOrder(); return { order, release: () => log.push(`release ${name}`), run: async () => { log.push(`run ${name}`); } }; };
    const a = job('a'), b = job('b');
    s.reroute(b); s.reroute(a); s.reroute(b);
    await s.idle();
    expect(log).toEqual(['release a', 'release b', 'run a', 'run b']);
  });
});
