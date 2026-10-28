// tests/desk/kitBuild.test.ts — kit blocks and verbs end to end in jsdom: what the board shows is computed by the engine.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildElement } from '../../src/desk/elements';
import { Registry } from '../../src/desk/registry';
import { DEFAULTS } from '../../src/settings/settings';
import { parseTag } from '../../src/script/parseTag';
import { kitStore } from '../../src/desk/kit/kit';
import type { BuildEnv, DeskApi, TargetCtx } from '../../src/desk/types';
import type { InkAction, Target } from '../../src/script/types';

const SVG = 'http://www.w3.org/2000/svg';
const g = () => document.createElementNS(SVG, 'g') as SVGGElement;

function env() {
  const layers = { highlight: g(), agent: g() };
  const ctx = (t: Target): TargetCtx => ({ target: t, layers, h: 700, scale: () => 0.6, body: () => 16, toSpace: (p) => p, rectToSpace: (r) => r, runs: async () => [] });
  const grow = vi.fn();
  const desk = { growRegion: grow, addConnector: vi.fn() } as unknown as DeskApi;
  const e: BuildEnv = { ctx: async (t) => ctx(t), registry: new Registry(), settings: DEFAULTS, rng: () => null, desk };
  return { e, layers, grow };
}
/** Parses, builds and draws one tag on its word; resolves once its draw returns (animations may run on). */
async function tag(e: BuildEnv, src: string) {
  const a = parseTag(src);
  if (!a) throw new Error(`malformed: ${src}`);
  const p = await buildElement(a as InkAction, e);
  if (typeof p === 'string') return p;
  await p.draw(new AbortController().signal, { speed: 1 });
  return p;
}
const settle = async (e: BuildEnv) => { e.registry.settle(); await new Promise((r) => setTimeout(r, 30)); };
const texts = (root: Element, sel = '[data-kit] text') => [...root.querySelectorAll(sel)].map((t) => t.textContent);

describe('kit blocks on the board', () => {
  beforeEach(() => { vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList); });
  afterEach(() => vi.restoreAllMocks());

  it('patch ⊛ kernel = output: placed in a row, the output empty until stepped, then filled by the engine', async () => {
    const { e, layers } = env();
    await tag(e, 'grid on=s id=img vals=10,10,90,90;10,10,90,90;10,10,90,90 shade "patch"');
    await tag(e, 'grid on=s id=k vals=-1,0,1;-1,0,1;-1,0,1 right=img op=⊛');
    await tag(e, 'grid on=s id=o over=img slide=k right=k op==');
    const st = kitStore(e.registry);
    const [img, k, o] = ['img', 'k', 'o'].map((id) => st.get(id)!);
    expect(k.placed.body.x).toBeGreaterThan(img.placed.body.x + img.placed.body.w);
    expect(o.placed.body.x).toBeGreaterThan(k.placed.body.x + k.placed.body.w);
    // bodies centred on one line
    const mid = (b: typeof img) => b.placed.body.y + b.placed.body.h / 2;
    expect(mid(k)).toBeCloseTo(mid(img));
    expect(mid(o)).toBeCloseTo(mid(img));
    expect(texts(layers.agent, '[data-kit] text').filter((t) => t === '⊛' || t === '=')).toEqual(['⊛', '=']);
    const outTexts = () => [...o.g!.querySelectorAll('text')].map((t) => t.textContent).filter((t) => t !== '=');
    expect(outTexts().every((t) => t === '')).toBe(true);
    await tag(e, 'step id=o[1,1]');
    await settle(e);
    expect(outTexts()).toEqual(['240', '']);
    // the calc line shows the expansion and the engine's result
    const calc = [...layers.agent.querySelectorAll('[data-kit="calc"] text')].map((t) => t.textContent).join(' ');
    expect(calc).toContain('(−1)·10 + 0·10 + 1·90');
    expect(calc).toMatch(/= 240$/);
    await tag(e, 'sweep id=o dur=0');
    await settle(e);
    expect(outTexts()).toEqual(['240', '240']); // both windows straddle the edge: (−1)·10 + 1·90 per row
  });

  it('set: an input changes and everything computed from it follows', async () => {
    const { e, layers } = env();
    await tag(e, 'bars on=s id=u vals=2,4,3,5');
    await tag(e, 'bars on=s id=v vals=3,5,4,6 right=u');
    await tag(e, 'calc on=s of=u,v fn="(x-y)^2" reduce=sum "SSD"');
    await tag(e, 'bars on=s id=nv map=v fn="(x-mean)/std" below=u');
    const before = [...kitStore(e.registry).get('nv')!.vals![0]];
    const calcText = () => [...layers.agent.querySelectorAll('[data-kit="calc"] text')].map((t) => t.textContent).join(' ');
    expect(calcText()).toMatch(/SSD = .* = 4$/);
    await tag(e, 'set id=v fn="2*x+3"');
    await settle(e);
    expect(kitStore(e.registry).get('v')!.vals![0]).toEqual([9, 13, 11, 15]);
    expect(calcText()).toMatch(/= 294$/);
    // a normalized shape does not move under a brightness and contrast change
    kitStore(e.registry).get('nv')!.vals![0].forEach((x, i) => expect(x).toBeCloseTo(before[i], 9));
  });

  it('a table column fills row by row; a scatter and bars follow the table', async () => {
    const { e } = env();
    await tag(e, 'table on=s id=t cols=t,y,v vals=0;1;2;3;4');
    await tag(e, 'col id=t.b fn="20*a-5*a^2" dur=0');
    await settle(e);
    await tag(e, 'scatter on=s id=p pts=t.a,t.b right=t');
    await tag(e, 'col id=t.c fn="20-10*a" dur=0');
    await tag(e, 'bars on=s id=w vals=t.c labels=t.a right=p');
    await settle(e);
    const st = kitStore(e.registry);
    expect(st.get('t')!.vals!.map((r) => r[1])).toEqual([0, 15, 20, 15, 0]);
    expect(st.get('w')!.vals![0]).toEqual([20, 10, 0, -10, -20]);
    expect(st.get('p')!.data!.map((d) => d.y)).toEqual([0, 15, 20, 15, 0]);
  });

  it('a table column with the row above (pa, pb): the first row has none', async () => {
    const { e, layers } = env();
    await tag(e, 'table on=s id=d cols=P,Q,E vals=10,10;8,20;6,30');
    await tag(e, 'col id=d.c fn="abs((b-pb)/pb)" dur=0');
    await settle(e);
    expect(kitStore(e.registry).get('d')!.vals!.map((r) => r[2])).toEqual([NaN, 1, 0.5]);
    expect(texts(layers.agent, '[data-kit="table"] text')).toContain('—');
  });

  it('a generated grid, cells counted where a condition holds', async () => {
    const { e, layers } = env();
    await tag(e, 'grid on=s id=s size=6x6 fn="r+c"');
    await tag(e, 'emph id=s where="x==7"');
    await tag(e, 'calc on=s of=s fn="x==7" reduce=count "P(sum = 7)"');
    expect([...layers.agent.querySelectorAll('[data-kit="calc"] text')].map((t) => t.textContent).join('')).toBe('P(sum = 7) = 6/36');
  });

  it('scatter: a line through two points, a band, its count; a least-squares line carries its equation', async () => {
    const { e, layers } = env();
    await tag(e, 'scatter on=s id=d pts=1,1 2,2 3,3 4,4 2,4');
    await tag(e, 'fit on=s id=f of=d pick=1,4');
    await tag(e, 'band id=f w=0.2 "inside"');
    expect(texts(layers.agent, '[data-kit] text').join(' ')).toContain('inside: 4');
    await tag(e, 'fit on=s id=g of=d');
    await settle(e);
    expect(texts(layers.agent, '[data-kit] text').join(' ')).toMatch(/y = /);
  });

  it('parts resolve to places: an arrow between cells, a box around cells, unknown parts skip', async () => {
    const { e, layers } = env();
    await tag(e, 'grid on=s id=a vals=1,2;3,4');
    expect(typeof (await tag(e, 'box on=s at=a[1:2,1:1]'))).toBe('object');
    expect(await tag(e, 'arrow on=s from=a[1,1] to=a[3,3]')).toMatch(/outside/);
    expect(await tag(e, 'emph id=zz[1,1]')).toMatch(/unknown block/);
    expect(layers.agent.querySelectorAll('path').length).toBeGreaterThan(0);
  });

  it('a block taller than the section grows it', async () => {
    const { e, grow } = env();
    await tag(e, 'grid on=s id=a vals=1;2;3;4;5;6;7;8;9;10;11;12');
    await tag(e, 'grid on=s id=b vals=1;2;3;4;5;6;7;8;9;10;11;12 below=a');
    expect(grow).toHaveBeenCalled();
    expect(grow.mock.calls.at(-1)![1]).toBeGreaterThan(700);
  });
});
