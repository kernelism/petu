// tests/desk/kitEvidence.test.ts — draw-benchmark evidence (docs/superpowers/reference/evidence/failures.md,
// clusters C1, C3, C4, F, H): the verbatim failing tags, played as the app plays them (jsdom, reduced motion).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildElement } from '../../src/desk/elements';
import { Registry } from '../../src/desk/registry';
import { DEFAULTS } from '../../src/settings/settings';
import { ScriptParser } from '../../src/script/parser';
import { kitStore, samplePlot } from '../../src/desk/kit/kit';
import * as C from '../../src/desk/kit/compute';
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

/** Plays a script: parsed, consts defined, every action built and drawn in order. Returns skips and malformed tags. */
async function play(e: BuildEnv, script: string) {
  const p = new ScriptParser();
  let malformed = 0;
  const warn = console.warn;
  console.warn = (...a: unknown[]) => { if (String(a[0]).includes('malformed')) malformed++; };
  let ev;
  try { ev = [...p.push(script), ...p.end()]; } finally { console.warn = warn; }
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
  return { skips, malformed, actions: ev.filter((x) => x.type === 'action').length };
}

const finite = (xs: number[]) => xs.filter(Number.isFinite);

describe('C1: constants with digits, on every formula path', () => {
  beforeEach(() => { vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList); });
  afterEach(() => vi.restoreAllMocks());

  it('sonnet D1: Vmax*x/(K2+x) plots', async () => {
    const { e } = env();
    const r = await play(e, '{{const Vmax=10 Km=2 K2=4}} {{plot on=s id=a fn="Vmax*x/(Km+x)" domain=0,20 "no inhibitor"}} {{plot on=s fn="Vmax*x/(K2+x)" domain=0,20 axes=a label="with inhibitor" dash id=b}}');
    expect(r.skips).toEqual([]);
    expect(Math.max(...finite(kitStore(e.registry).get('b')!.vals![0]))).toBeCloseTo((10 * 20) / 24, 6);
  });
  it('opus-low D7: T0 plots', async () => {
    const { e } = env();
    const r = await play(e, '{{const T0=1}} {{plot on=s id=T fn="T0*(1+x^2/16+11*x^4/3072)" domain=0,2.5 "true period (series)"}} {{plot on=s id=T1 fn="T0+0*x" domain=0,2.5 axes=T "small-angle period"}}');
    expect(r.skips).toEqual([]);
  });
  it('founder report 223312: rate0 no longer empties the board', async () => {
    const { e } = env();
    const r = await play(e, '{{const rate0=5 add=5 k=0.4}} {{plot on=s id=a fn="rate0*exp(-k*x)" domain=0,10}} {{plot on=s id=b fn="(rate0+add)*exp(-k*x)" domain=0,10 axes=a}}');
    expect(r.skips).toEqual([]);
  });
  it('terra D6: generated bars with n10 in fn, and vals= cells that are constant formulas (C4)', async () => {
    const { e } = env();
    const r = await play(e, [
      '{{const mu=2 sigma=1 n10=10 n40=40 n160=160 z=1.96}}',
      '{{bars on=s id=means10 size=1x40 fn="mu+sigma*randn()/sqrt(n10)" view=line "n = 10"}}',
      '{{bars on=s id=means40 size=1x40 fn="mu+sigma*randn()/sqrt(n40)" view=line axes=means10 below=means10 "n = 40"}}',
      '{{bars on=s id=margins vals=z*sigma/sqrt(n10),z*sigma/sqrt(n40),z*sigma/sqrt(n160) labels="10","40","160" below=means40 "margin of error"}}',
    ].join(' '));
    expect(r.skips).toEqual([]);
    const m = kitStore(e.registry).get('margins')!.vals![0];
    expect(m[0]).toBeCloseTo(1.96 / Math.sqrt(10), 9);
    expect(m[2]).toBeCloseTo(1.96 / Math.sqrt(160), 9);
  });
  it('terra D7: bars vals=a with {{const a=30}}', async () => {
    const { e } = env();
    const r = await play(e, '{{const a=30}} {{bars on=p id=angle vals=a labels="amplitude (degrees)"}}');
    expect(r.skips).toEqual([]);
    expect(kitStore(e.registry).get('angle')!.vals).toEqual([[30]]);
  });
  it('a vals= cell naming no constant is a skip that says which name', async () => {
    const { e } = env();
    const r = await play(e, '{{bars on=s id=v vals=1,q*2}}');
    expect(r.skips.join()).toMatch(/q/);
  });
  it('haiku D6: a plot on hand-drawn axes sees the constants, and keeps its peak', async () => {
    const { e, layers } = env();
    const r = await play(e, [
      '{{const sig=1}} {{const n1=10}} {{const n3=160}}',
      '{{axes on=s at=100,500 size=600,300 x="sample mean" y="density" id=ax}}',
      '{{plot on=s id=p10 fn="exp(-x^2/(2*sig^2/n1))/sqrt(2*pi*sig^2/n1)" domain=-2,2 axes=ax "n = 10"}}',
      '{{plot on=s id=p160 fn="exp(-x^2/(2*sig^2/n3))/sqrt(2*pi*sig^2/n3)" domain=-2,2 axes=ax "n = 160"}}',
    ].join(' '));
    expect(r.skips).toEqual([]);
    // The n = 160 curve reaches the top of its axes (its peak is drawn, not cut as a "pole").
    const ys = [...layers.agent.querySelectorAll('path')].map((p) => [...(p.getAttribute('d') ?? '').matchAll(/[ML]\s*[-\d.]+[ ,]([-\d.]+)/g)].map((m) => Number(m[1]))).filter((v) => v.length > 50); // the two curves (97 samples), not the axes
    expect(ys.length).toBeGreaterThanOrEqual(2);
    for (const v of ys) expect(Math.min(...v)).toBeLessThan(500 - 300 * 0.95);
  });
});

describe('F: poles are found between neighbours, never by the ratio to the median', () => {
  it('a narrow peak on a wide domain keeps its peak (opus-low D6)', () => {
    const got = samplePlot({ fn: 'exp(-x^2/(2*s^2))/(s*sqrt(2*pi))', domain: [-5, 5] }, { s: 0.1 });
    if (typeof got === 'string') throw new Error(got);
    expect(Math.max(...finite(got.ys))).toBeCloseTo(1 / (0.1 * Math.sqrt(2 * Math.PI)), 6);
    expect(got.ys.every(Number.isFinite)).toBe(true);
  });
  it('a true pole still breaks the curve: 1/(x-1) over 0..2, and one not on a sample', () => {
    for (const fn of ['1/(x-1)', '1/(x-1.003)', '1/(x-1.003)^2', 'tan(x)']) {
      const got = samplePlot({ fn, domain: fn === 'tan(x)' ? [-3, 3] : [0, 2] }, {});
      if (typeof got === 'string') throw new Error(got);
      expect(got.ys.some((y) => !Number.isFinite(y)), fn).toBe(true);
      // no vertical line across the pole: the visible part stays modest
      expect(Math.max(...finite(got.ys).map(Math.abs)), fn).toBeLessThan(1e4);
    }
  });
  it('a smooth curve with a sign change keeps every sample (sin, a line through 0)', () => {
    for (const fn of ['sin(x)', 'x', 'x^3-x']) {
      const got = samplePlot({ fn, domain: [-3, 3] }, {});
      if (typeof got === 'string') throw new Error(got);
      expect(got.ys.every(Number.isFinite), fn).toBe(true);
    }
  });
});

describe('H: numeric helpers', () => {
  beforeEach(() => { vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList); });
  afterEach(() => vi.restoreAllMocks());

  it('the true pendulum period as an engine plot (terra/sonnet D7)', async () => {
    const { e } = env();
    const r = await play(e, '{{plot on=s id=T fn="2/pi*integral(1/sqrt(1-sin(rad(x)/2)^2*sin(t)^2), 0, pi/2)" domain=0,150 "T/T₀"}} {{find id=a of=T x=60}}');
    expect(r.skips).toEqual([]);
    const v = kitStore(e.registry).get('T')!.vals![0];
    expect(v[0]).toBeCloseTo(1, 9);
    expect(Math.max(...finite(v))).toBeCloseTo(1.7622, 3); // 150°
  });
  it('quantile: the ceil(q·n)-th smallest value (a value of the data)', () => {
    const xs = [0.1, 0.3, 0.45, 0.2, 0.7, 0.5, 0.85, 0.15, 0.6, 0.35];
    expect(C.reduce('quantile', xs, undefined, undefined, undefined, 0.8).value).toBe(0.6);
    expect(C.reduce('quantile', xs, undefined, undefined, undefined, 0.5).value).toBe(0.35);
    expect(C.reduce('quantile', xs, undefined, undefined, undefined, 1).value).toBe(0.85);
    expect(C.reduce('quantile', xs, undefined, undefined, undefined, 0).value).toBe(0.1);
  });
  it('calc reduce=quantile q=0.8 on the board (haiku D11)', async () => {
    const { e, layers } = env();
    const r = await play(e, '{{bars on=s id=sc vals=0.1,0.3,0.45,0.2,0.7,0.5,0.85,0.15,0.6,0.35}} {{calc on=s id=q of=sc reduce=quantile q=0.8 "q hat"}}');
    expect(r.skips).toEqual([]);
    const calc = [...layers.agent.querySelectorAll('[data-kit="calc"] text')].map((t) => t.textContent).join(' ');
    expect(calc).toContain('0.6');
    expect(calc).toMatch(/8/);
  });
});

describe('C3: big computed data is computed in full, shown decimated', () => {
  beforeEach(() => { vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList); });
  afterEach(() => vi.restoreAllMocks());

  it('sol D6: 1000 samples of 10 and 40, their means over 1x40 windows, a mean of all 10000', async () => {
    const { e, layers } = env();
    const r = await play(e, [
      '{{grid on=roots id=sample10 size=1000x10 fn="2+randn()" view=image}}',
      '{{grid on=roots id=means10 over=sample10 win=1x10 reduce=mean right=sample10}}',
      '{{grid on=roots id=sample40 size=1000x40 fn="2+randn()" view=image below=sample10}}',
      '{{grid on=roots id=means40 over=sample40 win=1x40 reduce=mean right=sample40}}',
      '{{calc on=roots of=sample10 reduce=mean "mean of all"}}',
    ].join(' '));
    expect(r.malformed).toBe(0);
    expect(r.skips).toEqual([]);
    const st = kitStore(e.registry);
    expect(C.shape(st.get('sample10')!.full!)).toEqual([1000, 10]);
    expect(C.shape(st.get('means40')!.full!)).toEqual([1000, 1]);
    // the full mean of 40 normal draws: its spread is about 1/sqrt(40)
    expect(C.stats(st.get('means40')!.full!).std).toBeGreaterThan(0.12);
    expect(C.stats(st.get('means40')!.full!).std).toBeLessThan(0.2);
    // the narration-visible count is the full one
    const calc = [...layers.agent.querySelectorAll('[data-kit="calc"] text')].map((t) => t.textContent).join(' ');
    expect(calc).toContain('10000');
    // shown decimated: no more than ~48 squares a side
    const rects = st.get('sample40')!.g!.querySelectorAll('rect').length;
    expect(rects).toBeLessThanOrEqual(48 * 40 + 4);
  });
  it('sol D7: a 22-row table with 18 columns builds, every row kept', async () => {
    const { e } = env();
    const r = await play(e, '{{table on=pendulum id=t cols=A,a,b,c,d,e,f,h,i,j,k,l,m,n,o,p,q,R vals=0;10;20;30;40;50;60;70;80;90;100;110;120;130;140;150;160;170;175;178;179;179.9}} {{col id=t.R fn="cos(rad(A)/2)"}}');
    expect(r.malformed).toBe(0);
    expect(r.skips).toEqual([]);
    const t = kitStore(e.registry).get('t')!;
    expect(t.full!.length).toBe(22);
    expect(t.full![21][17]).toBeCloseTo(Math.cos((179.9 * Math.PI) / 360), 9);
  });
  it('past the hard limit: a reason that names the limit', async () => {
    const { e } = env();
    const r = await play(e, '{{grid on=s id=big size=2000x2000 fn="1"}}');
    expect(r.malformed).toBe(0);
    expect(r.skips.join()).toMatch(/200000/);
  });
  it('a fn window still names its cells a…z: past 26 cells, a reason', async () => {
    const { e } = env();
    const r = await play(e, '{{grid on=s id=x size=2x40 fn="c"}} {{grid on=s id=y over=x win=1x30 fn="a+b"}}');
    expect(r.malformed).toBe(0);
    expect(r.skips.join()).toMatch(/26/);
  });
});
