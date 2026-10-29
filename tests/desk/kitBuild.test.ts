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
  const centre = vi.fn();
  const desk = { growRegion: grow, centreRegion: centre, addConnector: vi.fn() } as unknown as DeskApi;
  const e: BuildEnv = { ctx: async (t) => ctx(t), registry: new Registry(), settings: DEFAULTS, rng: () => null, desk };
  return { e, layers, grow, centre };
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
    const outTexts = () => [...o.g!.querySelectorAll('text')].map((t) => t.textContent).filter((t) => t !== '=' && t !== 'o'); // its caption is its id
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
    expect(texts(layers.agent, '[data-kit] text').join(' ')).toContain('inside band: 4');
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

  it('a named block without a caption is captioned with its name; a single letter is a variable, in math italic', async () => {
    const { e, layers } = env();
    await tag(e, 'bars on=s id=u vals=1,2,3');
    await tag(e, 'bars on=s id=v vals=3,5,7 right=u');
    await tag(e, 'grid on=s id=sq_diff zip=u,v fn="(x-y)^2" below=u');
    await tag(e, 'grid on=s vals=1,2');
    await tag(e, 'bars on=s id=w vals=1,2 "given"');
    const all = [...layers.agent.querySelectorAll('[data-kit] text')];
    const cap = (s: string) => all.filter((t) => t.textContent === s);
    expect(cap('u')).toHaveLength(1);
    expect(cap('v')).toHaveLength(1);
    expect(cap('u')[0].getAttribute('font-style')).toBe('italic');
    expect(cap('sq diff')).toHaveLength(1);
    expect(cap('sq diff')[0].getAttribute('font-style')).toBeNull();
    expect(cap('given')).toHaveLength(1);
    expect(cap('w')).toHaveLength(0);
    // an anonymous block stays unlabelled
    expect(all.some((t) => /^_k/.test(t.textContent ?? ''))).toBe(false);
  });

  it('a computed block right of its source gets → by default; a plain neighbour gets no glyph; op= wins', async () => {
    const { e } = env();
    await tag(e, 'bars on=s id=u vals=1,2,3');
    await tag(e, 'bars on=s id=v vals=3,5,7 right=u');
    await tag(e, 'bars on=s id=d zip=u,v fn="(x-y)^2" right=v');
    await tag(e, 'bars on=s id=c map=u fn="x-mean" below=u');
    await tag(e, 'bars on=s id=n map=c fn="x/norm" right=c op==');
    await tag(e, 'bars on=s id=m map=n fn="2*x" right=n op=none');
    await tag(e, 'bars on=s id=q map=u fn="x+1" right=m');
    const st = kitStore(e.registry);
    const glyph = (id: string) => st.get(id)!.placed.op?.glyph;
    expect(glyph('v')).toBeUndefined();
    expect(glyph('d')).toBe('→');
    expect(glyph('c')).toBe('↓'); // below its own source: ↓
    expect(glyph('n')).toBe('=');
    expect(glyph('m')).toBeUndefined();
    expect(glyph('q')).toBeUndefined(); // right of a block it is not computed from
  });

  it('below its source: ↓ by default, op= wins, op=none suppresses, → stacked points down, a plain block below gets none', async () => {
    const { e } = env();
    await tag(e, 'bars on=s id=u vals=1,2,3');
    await tag(e, 'bars on=s id=a map=u fn="2*x" below=u');
    await tag(e, 'bars on=s id=b map=a fn="x+1" below=a op==');
    await tag(e, 'bars on=s id=c map=b fn="x+1" below=b op=none');
    await tag(e, 'bars on=s id=d map=c fn="x+1" below=c op=→');
    await tag(e, 'bars on=s id=f vals=4,5,6 below=d');
    await tag(e, 'grid on=s id=g vals=1,2;3,4');
    await tag(e, 'grid on=s id=h over=g win=1x2 reduce=sum below=g');
    const st = kitStore(e.registry);
    const glyph = (id: string) => st.get(id)!.placed.op?.glyph;
    expect(glyph('a')).toBe('↓');
    expect(glyph('b')).toBe('=');
    expect(glyph('c')).toBeUndefined();
    expect(glyph('d')).toBe('↓');
    expect(glyph('f')).toBeUndefined();
    expect(glyph('h')).toBe('↓');
    // the glyph sits between the two blocks, under the source
    const g = st.get('g')!, h = st.get('h')!;
    expect(h.placed.op!.y).toBeGreaterThan(g.placed.rect.y + g.placed.rect.h - 1);
    expect(h.placed.op!.y).toBeLessThan(h.placed.rect.y + 1);
  });

  it('a table column by its header: col fills it, map/zip/vals/scatter/labels/level read it; an unknown header appends', async () => {
    const { e } = env();
    await tag(e, 'table on=s id=t cols=P,Q,Ed vals=10,10;8,20;6,30');
    await tag(e, 'col id=t.Ed fn="abs((b-pb)/pb)" dur=0');
    await settle(e);
    const st = kitStore(e.registry);
    expect(st.get('t')!.vals!.map((r) => r[2])).toEqual([NaN, 1, 0.5]);
    expect(st.get('t')!.tab!.heads).toEqual(['P', 'Q', 'Ed']);
    await tag(e, 'bars on=s id=q vals=t.Q labels=t.P');
    expect(st.get('q')!.vals).toEqual([[10, 20, 30]]);
    await tag(e, 'bars on=s id=m map=t.q fn="x/10"'); // case-insensitive
    expect(st.get('m')!.vals).toEqual([[1, 2, 3]]);
    await tag(e, 'bars on=s id=z zip=t.P,t.Q fn="x*y"');
    expect(st.get('z')!.vals).toEqual([[100, 160, 180]]);
    await tag(e, 'scatter on=s id=d pts=t.P,t.Q');
    expect(st.get('d')!.data!.map((p) => [p.x, p.y])).toEqual([[10, 10], [8, 20], [6, 30]]);
    expect(typeof (await tag(e, 'level id=t.Q at=15 "15"'))).not.toBe('string');
    expect(await tag(e, 'level id=t.Nope at=15')).toMatch(/no column Nope/);
    expect(await tag(e, 'bars on=s id=n vals=t.Nope')).toMatch(/no column Nope/);
    // a header the table lacks: a new column under that name
    await tag(e, 'col id=t.R fn="a*b" dur=0');
    await settle(e);
    expect(st.get('t')!.tab!.heads).toEqual(['P', 'Q', 'Ed', 'R']);
    expect(st.get('t')!.vals!.map((r) => r[3])).toEqual([100, 160, 180]);
  });

  it('view=image: a generated noisy image, shaded pixels and no numerals; a window sweeps it into an image', async () => {
    const { e, layers } = env();
    await tag(e, 'grid on=s id=img size=24x24 fn="(c>12)*100+20*randn()" view=image');
    await tag(e, 'grid on=s id=k vals=1/9,1/9,1/9;1/9,1/9,1/9;1/9,1/9,1/9 right=img op=⊛');
    expect(await tag(e, 'grid on=s id=o over=img slide=k right=k op==')).not.toBeTypeOf('string');
    const st = kitStore(e.registry);
    const img = st.get('img')!, o = st.get('o')!;
    expect(img.view).toBe('image');
    expect(o.view).toBe('image'); // 22×22: past 12, an image by default
    expect(texts(layers.agent, '[data-kit="grid"] text').filter((t) => /\d/.test(t ?? '')).length).toBeLessThan(12); // only the kernel's numerals
    expect(layers.agent.querySelectorAll('[data-kit="grid"] rect').length).toBeGreaterThan(24 * 24);
    // the kernel keeps its literal fractions; a computed output never shows one
    expect(texts(layers.agent, '[data-kit="grid"] text')).toContain('1/9');
    // same noise on a rebuild (seeded by the id)
    const again = env();
    await tag(again.e, 'grid on=s id=img size=24x24 fn="(c>12)*100+20*randn()" view=image');
    expect(kitStore(again.e.registry).get('img')!.vals).toEqual(img.vals);
    await tag(e, 'sweep id=o dur=0.5');
    await new Promise((r) => setTimeout(r, 1200));
    await settle(e);
    expect(o.win!.filled.flat().every(Boolean)).toBe(true);
    expect(o.vals![0][0]).toBeCloseTo(o.full![0][0], 9);
    const calc = texts(layers.agent, '[data-kit="calc"] text').join(' ');
    expect(calc).not.toMatch(/\d+\/3\b/);
  });

  it('bars axes=<another bar chart>: drawn as bars on one y scale with it (C12m)', async () => {
    const { e } = env();
    await tag(e, 'bars on=toy id=kid vals=7,8 labels=before,after "coins the kid pays"');
    expect(typeof (await tag(e, 'bars on=toy id=shop vals=7,6 labels=before,after axes=kid right=kid "coins the shop keeps"'))).not.toBe('string');
    // one scale even when the ranges differ a lot (axes= says so; plain right= would not share past 4×)
    await tag(e, 'bars on=toy id=big vals=70,1 axes=kid right=shop');
    const st = kitStore(e.registry);
    expect(st.get('shop')!.view).toBeUndefined();
    expect(st.get('shop')!.group).toBe(st.get('kid')!.group);
    expect(st.get('big')!.group).toBe(st.get('kid')!.group);
    expect(st.get('kid')!.group!.pos).toBe(70);
  });
  it('view=line: a vector as a curve; a second line shares its axes; set moves it and leaves a ghost', async () => {
    const { e, layers } = env();
    await tag(e, 'bars on=s id=y size=1x40 fn="sin(c/5)+0.3*randn()" view=line "noisy"');
    await tag(e, 'bars on=s id=sm over=y win=1x5 reduce=mean axes=y "smoothed"');
    const st = kitStore(e.registry);
    const y = st.get('y')!, sm = st.get('sm')!;
    expect(y.view).toBe('line');
    expect(sm.plot).toBe(y.plot);
    expect(sm.vals![0].length).toBe(36);
    expect(sm.xs![0]).toBe(3); // a window's value sits at its centre
    expect(layers.agent.querySelectorAll('[data-kit="bars"] path').length).toBeGreaterThanOrEqual(4);
    const lbl = texts(layers.agent, '[data-kit="bars"] text');
    expect(lbl).toContain('noisy');
    expect(lbl).toContain('smoothed');
    // a long vector is a line by default; a short one stays bars
    await tag(e, 'bars on=s id=z size=1x30 fn="c"');
    expect(st.get('z')!.view).toBe('line');
    await tag(e, 'bars on=s id=w vals=1,2,3');
    expect(st.get('w')!.view).toBeUndefined();
    // a part of a line is its point; set tweens and widens the plot
    await tag(e, 'bars on=s id=d vals=3,5,4 labels=1,2,4 view=line');
    expect(st.get('d')!.xs).toEqual([1, 2, 4]);
    expect(typeof (await tag(e, 'emph id=d[2]'))).not.toBe('string');
    await tag(e, 'set id=d fn="x*3"');
    await settle(e);
    expect(st.get('d')!.vals).toEqual([[9, 15, 12]]);
    expect(st.get('d')!.plot!.dom.y1).toBeGreaterThan(15);
    expect(await tag(e, 'bars on=s id=q vals=1,2 axes=nope')).toMatch(/no line or plot nope/);
  });

  it('engine graphs: three trajectories from one formula and shared constants, one scale, apex labels', async () => {
    const { e, layers } = env();
    kitStore(e.registry).defineConsts([['v', '20'], ['g', '9.8']]);
    const traj = (id: string, deg: number, extra = '') => `plot on=s id=${id} x="v*cos(rad(${deg}))*t" y="v*sin(rad(${deg}))*t-g*t^2/2" t=0,2*v*sin(rad(${deg}))/g "${deg}°" label=top ${extra}`;
    expect(typeof (await tag(e, traj('p45', 45, 'xlabel=distance ylabel=height')))).not.toBe('string');
    await tag(e, traj('p30', 30, 'axes=p45'));
    await tag(e, traj('p60', 60, 'axes=p45'));
    const st = kitStore(e.registry);
    const top = (id: string) => Math.max(...st.get(id)!.vals![0].filter(Number.isFinite));
    const land = (id: string) => st.get(id)!.xs!.at(-1)!;
    expect(top('p60') / top('p30')).toBeCloseTo(3, 2); // sin²60 / sin²30
    expect(top('p45') / top('p30')).toBeCloseTo(2, 2);
    expect(land('p30')).toBeCloseTo(land('p60'), 6); // same range
    expect(land('p45')).toBeCloseTo(400 / 9.8, 6);
    expect(st.get('p30')!.plot).toBe(st.get('p45')!.plot); // one set of axes, one scale
    const lbl = texts(layers.agent, '[data-kit="bars"] text');
    for (const t of ['30°', '45°', '60°', 'distance', 'height']) expect(lbl).toContain(t);
    // fn= over a domain written with constants; a bad formula is a reason, not a crash
    expect(typeof (await tag(e, 'plot on=s id=r fn="v^2*sin(rad(2*x))/g" domain=0,90 "range"'))).not.toBe('string');
    expect(Math.max(...st.get('r')!.vals![0])).toBeCloseTo(400 / 9.8, 3);
    expect(await tag(e, 'plot on=s fn="q*x" domain=0,1')).toMatch(/bad fn/);
    // points onto a plot's axes: one scale with the curve
    await tag(e, 'scatter on=s id=pts pts=10,5 20,8 axes=r');
    expect(st.get('pts')!.placed.body).toEqual(st.get('r')!.placed.body);
    expect(st.get('pts')!.dom).toEqual(st.get('r')!.plot!.dom);
  });

  it('a letter past the width falls back to a header of that name (cols=x,y: t.y is y)', async () => {
    const { e } = env();
    await tag(e, 'table on=s id=t cols=x,y vals=1,2;3,4');
    await tag(e, 'bars on=s id=v vals=t.y');
    expect(kitStore(e.registry).get('v')!.vals).toEqual([[2, 4]]);
  });

  it('map and zip take any block as source: bars with a grid, a table column, a column grid with bars', async () => {
    const { e } = env();
    await tag(e, 'bars on=s id=u vals=1,2,3');
    await tag(e, 'grid on=s id=g vals=3,5,7');
    await tag(e, 'grid on=s id=col vals=1;1;1');
    await tag(e, 'table on=s id=t cols=a,b vals=1,10;2,20;3,30');
    const st = kitStore(e.registry);
    await tag(e, 'bars on=s id=d zip=u,g fn="y-x"');
    expect(st.get('d')!.vals).toEqual([[2, 3, 4]]);
    await tag(e, 'grid on=s id=e zip=u,t.b fn="x*y"');
    expect(st.get('e')!.vals).toEqual([[10, 40, 90]]);
    await tag(e, 'bars on=s id=f map=t.a fn="x^2"');
    expect(st.get('f')!.vals).toEqual([[1, 4, 9]]);
    expect(st.get('f')!.deps).toEqual(['t']);
    await tag(e, 'bars on=s id=h zip=u,col fn="x+y"');
    expect(st.get('h')!.vals).toEqual([[2, 3, 4]]);
    await tag(e, 'bars on=s id=k map=col fn="x*5"'); // a column lies down as bars
    expect(st.get('k')!.vals).toEqual([[5, 5, 5]]);
    // a set on the input still flows through
    await tag(e, 'set id=u fn="x+1"');
    await settle(e);
    expect(st.get('d')!.vals![0]).toEqual([1, 2, 3]);
  });

  it('the section is asked to centre the whole composition (every block and glyph), as it grows', async () => {
    const { e, centre } = env();
    await tag(e, 'bars on=s id=u vals=1,2,3');
    const st = kitStore(e.registry);
    const u = st.get('u')!;
    expect(centre).toHaveBeenLastCalledWith('s', u.placed.rect.x, u.placed.rect.x + u.placed.rect.w);
    await tag(e, 'bars on=s id=d map=u fn="2*x" right=u');
    const d = st.get('d')!;
    const [, x0, x1] = centre.mock.calls.at(-1)!;
    expect(x0).toBeCloseTo(u.placed.rect.x);
    expect(x1).toBeCloseTo(d.placed.rect.x + d.placed.rect.w);
    expect(x1 - x0).toBeLessThan(1000);
  });

  it('a block taller than the section grows it', async () => {
    const { e, grow } = env();
    await tag(e, 'grid on=s id=a vals=1;2;3;4;5;6;7;8;9;10;11;12');
    await tag(e, 'grid on=s id=b vals=1;2;3;4;5;6;7;8;9;10;11;12 below=a');
    expect(grow).toHaveBeenCalled();
    expect(grow.mock.calls.at(-1)![1]).toBeGreaterThan(700);
  });
});
