// The new teaching moves drawn end to end in jsdom (design 3.5, 3.6, 3.7): stacked bars and a split,
// tokens moving between states, a histogram. What the board shows is the engine's numbers.
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
  const desk = { growRegion: vi.fn(), centreRegion: vi.fn(), addConnector: vi.fn() } as unknown as DeskApi;
  const e: BuildEnv = { ctx: async (t) => ctx(t), registry: new Registry(), settings: DEFAULTS, rng: () => null, desk };
  return { e, layers };
}
async function tag(e: BuildEnv, src: string) {
  const a = parseTag(src);
  if (!a) throw new Error(`malformed: ${src}`);
  if (a.kind === 'const') { kitStore(e.registry).defineConsts(a.defs); return; }
  const p = await buildElement(a as InkAction, e);
  if (typeof p === 'string') return p;
  await p.draw(new AbortController().signal, { speed: 1 });
  return p;
}
const settle = async (e: BuildEnv) => { e.registry.settle(); await new Promise((r) => setTimeout(r, 30)); };
const texts = (root: Element) => [...root.querySelectorAll('text')].map((t) => t.textContent).filter(Boolean);

describe('new teaching moves on the board', () => {
  beforeEach(() => { vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList); });
  afterEach(() => vi.restoreAllMocks());

  it('stacked bars: one scale, totals above, parts inside, names beside', async () => {
    const { e } = env();
    expect(await tag(e, 'bars on=s id=bill vals=100;90,20 labels=before,after parts=room,tax stack')).not.toBeTypeOf('string');
    const b = kitStore(e.registry).get('bill')!;
    expect(b.vals![0]).toEqual([100, 110]);
    const t = texts(b.g!);
    for (const s of ['100', '110', '90', '20', 'room', 'tax', 'before', 'after']) expect(t, s).toContain(s);
    // set one part: the total follows
    await tag(e, 'set id=bill[2,2] to=30');
    await settle(e);
    expect(b.vals![0]).toEqual([100, 120]);
    expect(texts(b.g!)).toContain('120');
  });

  it('split: a bar divides into parts that sum to it (the first is what remains)', async () => {
    const { e } = env();
    await tag(e, 'const t=2');
    await tag(e, 'bars on=s id=pay vals=7,8 labels=before,after');
    expect(await tag(e, 'split id=pay[2] vals=t "seller" "tax"')).not.toBeTypeOf('string');
    await settle(e);
    const b = kitStore(e.registry).get('pay')!;
    expect(b.parts![1]).toEqual([6, 2]);
    const t = texts(b.g!);
    for (const s of ['6', '2', 'seller', 'tax', '8']) expect(t, s).toContain(s);
    expect(await tag(e, 'split id=pay[1] vals=5,1 "a" "b"')).toMatch(/sum to 6, not 7/);
  });

  it('tokens: counted out, then marks move to another cluster; the counts follow', async () => {
    const { e } = env();
    await tag(e, 'const t=2');
    expect(await tag(e, 'tokens on=s id=k n=8 states=seller,tax "coins"')).not.toBeTypeOf('string');
    const b = kitStore(e.registry).get('k')!;
    expect(b.g!.querySelectorAll('circle')).toHaveLength(8);
    expect(texts(b.g!)).toEqual(expect.arrayContaining(['8', 'seller', 'coins']));
    await tag(e, 'set id=k state=tax n=t');
    await settle(e);
    const t = texts(b.g!);
    expect(t).toEqual(expect.arrayContaining(['6', 'seller', '2', 'tax']));
    // the moved marks sit right of the others (their own cluster)
    const xs = [...b.g!.querySelectorAll('circle')].map((c) => Number(c.getAttribute('cx')));
    expect(Math.min(xs[6], xs[7])).toBeGreaterThan(Math.max(...xs.slice(0, 6)));
  });
});

describe('histogram (3.7)', () => {
  beforeEach(() => { vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList); });
  afterEach(() => vi.restoreAllMocks());
  it('parses hist= bins= axes=', () => {
    expect(parseTag('bars on=s id=h hist=m bins=20 "means"')).toMatchObject({ kind: 'bars', src: { hist: 'm', bins: 20 }, caption: 'means' });
    expect(parseTag('bars on=s id=h2 hist=m2 axes=h below=h')).toMatchObject({ src: { hist: 'm2', bins: 12, like: 'h' } });
    expect(parseTag('bars on=s id=h hist=m bins=1')).toBeNull();
  });
  it('counts any block’s values in bins; axes= shares the bins (one x scale, its own heights)', async () => {
    const { e } = env();
    await tag(e, 'grid on=s id=x size=200x10 fn="randn()" view=image');
    await tag(e, 'grid on=s id=m over=x win=1x10 reduce=mean right=x');
    expect(await tag(e, 'bars on=s id=h1 hist=x bins=16 below=x "single draws"')).not.toBeTypeOf('string');
    expect(await tag(e, 'bars on=s id=h2 hist=m axes=h1 below=h1 "means of 10"')).not.toBeTypeOf('string');
    const st = kitStore(e.registry);
    const h1 = st.get('h1')!, h2 = st.get('h2')!;
    expect(h1.vals![0].reduce((a, b) => a + b, 0)).toBe(2000);
    expect(h2.vals![0]).toHaveLength(16);
    expect(h2.vals![0].reduce((a, b) => a + b, 0)).toBe(200);
    expect(h1.view).toBeUndefined(); // bars, not a line, past 16 values
    expect(h2.placed.body.w).toBeCloseTo(h1.placed.body.w);
    expect(h2.placed.body.x).toBeCloseTo(h1.placed.body.x);
    // the means pile into fewer, middle bins
    const spread = (v: number[]) => v.filter((c) => c > 0).length;
    expect(spread(h2.vals![0])).toBeLessThan(spread(h1.vals![0]));
  });
});
