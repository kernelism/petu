// Legible at the board's type size (founder rule: the final board reads on its own; text at the board's
// measured body size, never tiny). Evidence: draw run 5b74be89 D1 follow-up — `tokens n=12
// states=empty,S,I` reserved one 12-wide row per state (1327 units, wider than the section), so the
// scene camera zoomed out to its floor and the board ended as a thin row of grey dots with ~8 px labels.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildElement } from '../../src/desk/elements';
import { Registry } from '../../src/desk/registry';
import { DEFAULTS } from '../../src/settings/settings';
import { parseTag } from '../../src/script/parseTag';
import { kitStore } from '../../src/desk/kit/kit';
import { overviewCam, ZIN } from '../../src/desk/scene/camera';
import type { BuildEnv, DeskApi, TargetCtx } from '../../src/desk/types';
import type { InkAction, Target } from '../../src/script/types';

const SVG = 'http://www.w3.org/2000/svg';
const g = () => document.createElementNS(SVG, 'g') as SVGGElement;
const SCALE = 0.6, BODY = 16;
function env() {
  const layers = { highlight: g(), agent: g() };
  const ctx = (t: Target): TargetCtx => ({ target: t, layers, h: 700, scale: () => SCALE, body: () => BODY, toSpace: (p) => p, rectToSpace: (r) => r, runs: async () => [] });
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
const settle = async (e: BuildEnv) => { e.registry.settle(); await new Promise((r) => setTimeout(r, 30)); };
/** On-screen px of every text in a group (font-size is in section units). */
const textPx = (root: Element) => [...root.querySelectorAll('text')].filter((t) => t.textContent).map((t) => ({ s: t.textContent!, px: Number(t.getAttribute('font-size')) * SCALE }));
const marks = (root: Element) => [...root.querySelectorAll('circle')].map((c) => ({ x: Number(c.getAttribute('cx')), y: Number(c.getAttribute('cy')), r: Number(c.getAttribute('r')) }));
const distinct = (v: number[]) => new Set(v.map((x) => Math.round(x))).size;

describe('tokens read at the board’s type size', () => {
  beforeEach(() => { vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList); });
  afterEach(() => vi.restoreAllMocks());

  it('D1: twelve pockets with three states fit the section, in a compact grid of rows', async () => {
    const { e } = env();
    expect(await tag(e, 'tokens on=pk id=e n=12 states=empty,S,I "enzyme pockets"')).not.toBeTypeOf('string');
    const b = kitStore(e.registry).get('e')!;
    // the whole block fits the section's width at zoom 1 (no camera zoom-out needed)
    expect(b.placed.rect.w).toBeLessThanOrEqual(1000 - 2 * b.m.margin);
    const ms = marks(b.g!);
    expect(ms).toHaveLength(12);
    expect(distinct(ms.map((m) => m.y))).toBeGreaterThanOrEqual(2); // rows, not one thin line
    expect(distinct(ms.map((m) => m.x))).toBeLessThanOrEqual(6);
    // marks are sized from the type: at least the body size across on screen
    for (const m of ms) expect(2 * m.r * SCALE).toBeGreaterThanOrEqual(BODY);
    // every label (counts, state names, caption) at the board's body size or larger
    for (const t of textPx(b.g!)) expect(t.px, t.s).toBeGreaterThanOrEqual(BODY - 0.01);
  });

  it('D1: after every mark moves to one state the cluster stays a grid, labels stay legible', async () => {
    const { e } = env();
    await tag(e, 'tokens on=pk id=e n=12 states=empty,S,I "enzyme pockets"');
    await tag(e, 'set id=e[1:4] state=S');
    await tag(e, 'set id=e[5:8] state=I');
    await tag(e, 'set id=e[1:12] state=S');
    await settle(e);
    const b = kitStore(e.registry).get('e')!;
    const ms = marks(b.g!);
    expect(distinct(ms.map((m) => m.y))).toBeGreaterThanOrEqual(2);
    // inside the block's reserved body
    const { body } = b.placed;
    for (const m of ms) { expect(m.x).toBeGreaterThanOrEqual(body.x - 1e-6); expect(m.x).toBeLessThanOrEqual(body.x + body.w + 1e-6); expect(m.y).toBeLessThanOrEqual(body.y + body.h + 1e-6); }
    const t = textPx(b.g!);
    expect(t.map((x) => x.s)).toEqual(expect.arrayContaining(['12', 'S']));
    for (const x of t) expect(x.px, x.s).toBeGreaterThanOrEqual(BODY - 0.01);
  });

  it('many marks with several states still fit the section', async () => {
    const { e } = env();
    await tag(e, 'tokens on=s id=k n=120 states=a,b,c,d');
    const b = kitStore(e.registry).get('k')!;
    expect(b.placed.rect.w).toBeLessThanOrEqual(1000 - 2 * b.m.margin);
    for (const m of marks(b.g!)) expect(2 * m.r * SCALE).toBeGreaterThanOrEqual(BODY * 0.6);
  });
});

describe('other kit blocks fit the section at their type size', () => {
  beforeEach(() => { vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList); });
  afterEach(() => vi.restoreAllMocks());
  it('bars, a wide table and a histogram stay within the section width', async () => {
    const { e } = env();
    await tag(e, 'bars on=s id=v vals=1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16 labels=Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec,Q1,Q2,Q3,Q4');
    await tag(e, 'table on=t id=t cols=Q,P,TR,MR,CS,PS vals=1,2,3,4,5,6;7,8,9,10,11,12');
    await tag(e, 'grid on=h id=x size=50x10 fn="randn()" view=image');
    await tag(e, 'bars on=h id=hx hist=x bins=24 below=x');
    const st = kitStore(e.registry);
    for (const id of ['v', 't', 'x', 'hx']) {
      const b = st.get(id)!;
      expect(b.placed.rect.x, id).toBeGreaterThanOrEqual(-1e-6);
      expect(b.placed.rect.x + b.placed.rect.w, id).toBeLessThanOrEqual(1000 + 1e-6);
    }
  });
});

// Found, not fixed here: bars with 16 month-name labels (2000 units) and a table with six long
// headers (1370 units) are wider than the section; they need label/header wrapping.
describe.todo('bars with long labels and tables with long headers wrap to the section width');

describe('a small scene fills a sensible share of the board at the end', () => {
  const win = { w: 665, h: 700, s: 0.665 };
  it('zooms in on a sliver (never past ZIN), centred', () => {
    const ext = { x: 100, y: 150, w: 400, h: 150 };
    const c = overviewCam(ext, win);
    expect(c.z).toBeGreaterThan(1);
    expect(c.z).toBeLessThanOrEqual(ZIN);
    const vw = win.w / (win.s * c.z), vh = win.h / (win.s * c.z);
    expect(c.x + vw / 2).toBeCloseTo(ext.x + ext.w / 2);
    expect(c.y + vh / 2).toBeCloseTo(ext.y + ext.h / 2);
    // it now spans at least half the window's width, with air on both sides
    const px = ext.w * win.s * c.z;
    expect(px).toBeGreaterThanOrEqual(win.w * 0.5);
    expect(px).toBeLessThan(win.w * 0.9);
  });
  it('a scene that already fills the window stays at zoom 1', () => {
    expect(overviewCam({ x: 0, y: 0, w: 760, h: 560 }, win).z).toBe(1);
  });
});
