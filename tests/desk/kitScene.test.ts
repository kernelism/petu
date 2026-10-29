// Founder live test 2026-10-29 (physics, "why does a spinning skater speed up"): two small bar charts in a
// scene were parked at the board's far left, and labels written as ids showed as "arms_out".
// (A) a kit block opening an empty scene is composed into the board (centred across the window);
// (B) labels, headers and state names that come from list values show ids with spaces.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildElement } from '../../src/desk/elements';
import { Registry } from '../../src/desk/registry';
import { DEFAULTS } from '../../src/settings/settings';
import { ScriptParser } from '../../src/script/parser';
import { kitStore, shown } from '../../src/desk/kit/kit';
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
function env(scene = true) {
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
  await new Promise((r) => setTimeout(r, 30));
  return skips;
}
const texts = (root: Element) => [...root.querySelectorAll('text')].map((t) => t.textContent ?? '').filter(Boolean);
const SKATER = '{{scene id=sk near=p12}} {{const I=4 w=2 I2=2 w2=I*w/I2}} {{bars on=sk id=L vals=I*w,I2*w2 labels=arms_out,arms_in "angular momentum"}} Same spin. '
  + '{{bars on=sk id=K vals=0.5*I*w^2,0.5*I2*w2^2 labels=arms_out,arms_in below=L "rotational energy"}} Energy doubles. '
  + '{{split id=K[2] vals=0.5*I2*w2^2-0.5*I*w^2 "start" "muscle work"}} The extra is muscle work.';

describe('kit blocks in a small scene are composed into the board', () => {
  beforeEach(() => { vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList); });
  afterEach(() => vi.restoreAllMocks());
  it('the skater: the first chart opens centred across the window, the next follows under it', async () => {
    const { e } = env();
    expect(await play(e, SKATER)).toEqual([]);
    const st = kitStore(e.registry);
    const cx = (id: string) => { const r = st.get(id)!.placed.rect; return r.x + r.w / 2; };
    expect(Math.abs(cx('L') - (VIEW.x + VIEW.w / 2))).toBeLessThan(2);
    // not parked at the left: the composition's middle is in the window's middle third
    expect(cx('K')).toBeGreaterThan(VIEW.w / 3);
    expect(cx('K')).toBeLessThan((2 * VIEW.w) / 3);
  });
});

describe('labels written as ids show with spaces', () => {
  beforeEach(() => { vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList); });
  afterEach(() => vi.restoreAllMocks());
  it('shown(): words joined by underscores; subscripts stay', () => {
    expect(shown('arms_out')).toBe('arms out');
    expect(shown('total_revenue_per_unit')).toBe('total revenue per unit');
    for (const s of ['x_1', 'K_m', 'v_max', 'arms', 'a_b', '2_x']) expect(shown(s)).toBe(s === '2_x' ? '2_x' : s);
  });
  it('bar and part labels, table headers, grid labels and token states; ids still name them', async () => {
    const { e, layers } = env(false);
    expect(await play(e, SKATER.replace('{{scene id=sk near=p12}}', '').replaceAll('on=sk', 'on=s'))).toEqual([]);
    expect(await play(e, '{{table on=t id=t cols=unit_price,units_sold vals=2,10;3,8}} {{grid on=g id=G vals=1,2;3,4 rows=row_one,row_two cols=col_one,x_1}} {{tokens on=k id=k n=4 states=no_tax,with_tax}} {{set id=k[1:2] state=with_tax}} Two now.')).toEqual([]);
    const t = texts(layers.agent);
    for (const s of ['arms out', 'arms in', 'muscle work', 'unit price', 'units sold', 'row one', 'col one', 'x_1', 'no tax', 'with tax']) expect(t, s).toContain(s);
    expect(t.filter((s) => /[A-Za-z]{2}_[A-Za-z]{2}/.test(s))).toEqual([]);
    // references by id are untouched
    expect(kitStore(e.registry).get('k')!.tok!.states).toEqual(['no_tax', 'with_tax']);
  });
});
