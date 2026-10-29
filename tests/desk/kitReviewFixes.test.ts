// tests/desk/kitReviewFixes.test.ts — regressions from a code review of the kit (plots, constants, tables, lines).
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
  const p = await buildElement(a as InkAction, e);
  if (typeof p === 'string') return p;
  await p.draw(new AbortController().signal, { speed: 1 });
  return p;
}
const ys = (e: BuildEnv, id: string) => kitStore(e.registry).get(id)!.vals![0];
const maxY = (e: BuildEnv, id: string) => Math.max(...ys(e, id).filter(Number.isFinite));

describe('kit review fixes', () => {
  beforeEach(() => { vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList); });
  afterEach(() => vi.restoreAllMocks());

  it('the pole cap keeps peaks, fast growth and a zero half; it still cuts a pole', async () => {
    const { e } = env();
    await tag(e, 'plot on=s id=bell fn="exp(-x^2)" domain=-5,5');
    expect(maxY(e, 'bell')).toBeCloseTo(1, 2);
    await tag(e, 'plot on=s id=relu fn="max(0,x)" domain=-5,5');
    expect(maxY(e, 'relu')).toBeCloseTo(5, 6);
    await tag(e, 'plot on=s id=ex fn="exp(x)" domain=0,10');
    expect(maxY(e, 'ex')).toBeCloseTo(Math.exp(10), 0);
    await tag(e, 'plot on=s id=one fn="sin(x)^2+cos(x)^2" domain=0,6');
    expect(ys(e, 'one').every(Number.isFinite)).toBe(true);
    await tag(e, 'plot on=s id=inv fn="1/x" domain=-5,5');
    expect(maxY(e, 'inv')).toBeLessThan(16);
    expect(ys(e, 'inv').filter(Number.isFinite).length).toBeGreaterThan(140);
  });

  it('pi in a column formula is π, not the row above\'s column i', async () => {
    const { e } = env();
    await tag(e, 'table on=s id=t cols=r vals=1;2;3');
    await tag(e, 'col id=t fn="pi*a^2" "area"');
    const t = kitStore(e.registry).get('t')!;
    expect(t.full!.map((r) => r[1])).toEqual([Math.PI, 4 * Math.PI, 9 * Math.PI]);
  });
});
