// tests/desk/kitMoves.test.ts — readout points and demonstration moves on the board (jsdom, reduced motion).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildElement } from '../../src/desk/elements';
import { Registry } from '../../src/desk/registry';
import { DEFAULTS } from '../../src/settings/settings';
import { ScriptParser } from '../../src/script/parser';
import { kitStore } from '../../src/desk/kit/kit';
import type { BuildEnv, DeskApi, TargetCtx } from '../../src/desk/types';
import type { InkAction, RawAction, Target } from '../../src/script/types';

const SVG = 'http://www.w3.org/2000/svg';
const g = () => document.createElementNS(SVG, 'g') as SVGGElement;

function env() {
  const layers = { highlight: g(), agent: g() };
  const ctx = (t: Target): TargetCtx => ({ target: t, layers, h: 700, scale: () => 0.6, body: () => 16, toSpace: (p) => p, rectToSpace: (r) => r, runs: async () => [] });
  const desk = { growRegion: vi.fn(), centreRegion: vi.fn(), addConnector: vi.fn() } as unknown as DeskApi;
  const e: BuildEnv = { ctx: async (t) => ctx(t), registry: new Registry(), settings: DEFAULTS, rng: () => null, desk };
  return { e, layers };
}

/** Runs a script as the app does: parsed (val words, contrast expanded), then every action built and drawn in order. */
async function play(e: BuildEnv, script: string) {
  const p = new ScriptParser();
  const ev = [...p.push(script), ...p.end()];
  const skips: string[] = [];
  const st = kitStore(e.registry);
  for (const x of ev) {
    if (x.type !== 'action') continue;
    const a = x.action as RawAction;
    if (a.kind === 'const') { st.defineConsts(a.defs); continue; }
    if (a.kind === 'find') { st.finds.set(a.id, a); continue; }
    if (a.kind === 'val' || a.kind === 'sketch') continue;
    const plan = await buildElement(a as InkAction, e);
    if (typeof plan === 'string') { skips.push(`${a.kind}: ${plan}`); continue; }
    await plan.draw(new AbortController().signal, { speed: 1 });
  }
  e.registry.settle();
  await new Promise((r) => setTimeout(r, 30));
  return { words: ev.flatMap((x) => (x.type === 'word' ? [x.text] : [])), skips };
}

const MARKET = '{{const tax=0}} {{plot on=s id=d fn="12-x/5" domain=0,50}} {{plot on=s id=u fn="2+tax+x/10" domain=0,50 axes=d}} {{find id=E of=d,u}} {{point on=s at=E "E"}} meet at {{val id=E}}';

describe('readouts and moves on the board', () => {
  beforeEach(() => { vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList); });
  afterEach(() => vi.restoreAllMocks());

  it('a point at a readout sits on the plot where the engine computed it, with drop lines', async () => {
    const { e } = env();
    const r = await play(e, MARKET);
    expect(r.skips).toEqual([]);
    expect(r.words).toEqual(['meet', 'at', '5.33']);
    const st = kitStore(e.registry);
    const reading = st.reading('E');
    expect(reading).toMatchObject({ x: expect.closeTo(100 / 3, 6) });
    const dot = st.get('d')!.g!.querySelector('circle[r]') as SVGCircleElement;
    const pl = st.get('d')!.plot!, { body } = pl.host.placed, d = pl.dom;
    expect(Number(dot.getAttribute('cx'))).toBeCloseTo(body.x + ((100 / 3 - d.x0) / (d.x1 - d.x0)) * body.w, 3);
  });

  it('beforeafter: the constant changes, a ghost keeps the old curve, the band between is shaded, the point follows', async () => {
    const { e } = env();
    await play(e, MARKET);
    const st = kitStore(e.registry);
    const dot = st.get('d')!.g!.querySelector('circle[r]') as SVGCircleElement;
    const cx0 = Number(dot.getAttribute('cx'));
    const r = await play(e, '{{beforeafter of=u tax=1.5}} now {{val id=E}}');
    expect(r.skips).toEqual([]);
    expect(st.consts.tax).toBe(1.5);
    const u = st.get('u')!;
    expect(u.ghost?.length).toBe(u.vals![0].length);
    expect(u.vals![0][0]).toBeCloseTo(3.5, 6);
    expect(u.ghost![0]).toBeCloseTo(2, 6);
    expect(st.get('d')!.g!.querySelector('polygon')).not.toBeNull();
    expect(Number(dot.getAttribute('cx'))).toBeLessThan(cx0); // the crossing moved left
    expect([...st.get('d')!.g!.querySelectorAll('text')].map((t) => t.textContent)).toContain('tax: 0 → 1.5');
  });

  it('limit: everything drawn from the constant lands on its value, with a live readout', async () => {
    const { e } = env();
    const r = await play(e, '{{const k=1}} {{plot on=s id=v fn="9.8/k*(1-exp(-k*x))" domain=0,6}} {{find id=end of=v x=6}} {{bars on=s id=b size=1x3 fn="k*c" below=v}} {{limit of=v k=0.05 dur=1 show=end}}');
    expect(r.skips).toEqual([]);
    await new Promise((res) => setTimeout(res, 60));
    const st = kitStore(e.registry);
    expect(st.consts.k).toBeCloseTo(0.05, 9);
    const v = st.get('v')!;
    expect(v.vals![0][v.vals![0].length - 1]).toBeCloseTo((9.8 / 0.05) * (1 - Math.exp(-0.3)), 6);
    expect(st.get('b')!.vals![0][2]).toBeCloseTo(0.15, 9);
    expect([...v.g!.querySelectorAll('text')].map((t) => t.textContent).some((t) => /^k = 0\.05 · end = 50\.8/.test(t ?? ''))).toBe(true);
  });

  it('contrast: a plot copy shares the axes; a block copy sits beside on one scale', async () => {
    const { e } = env();
    const r = await play(e, '{{const k=2}} {{plot on=s id=p fn="k*x" domain=0,3}} {{contrast of=p k=4}} {{bars on=s id=b size=1x3 fn="k*c" below=p}} {{contrast of=b k=3}}');
    expect(r.skips).toEqual([]);
    const st = kitStore(e.registry);
    expect(st.get('p_2')!.plot).toBe(st.get('p')!.plot);
    expect(st.get('p_2')!.vals![0].at(-1)).toBeCloseTo(12, 6);
    const b = st.get('b')!, b2 = st.get('b_2')!;
    expect(b2.placed.body.x).toBeGreaterThan(b.placed.body.x + b.placed.body.w);
    expect(b2.group).toBe(b.group);
    expect(b2.vals![0]).toEqual([3, 6, 9]);
  });
});
