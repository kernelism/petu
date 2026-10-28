// tests/desk/elements.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildElement, REF_WAIT_MS } from '../../src/desk/elements';
import { Registry } from '../../src/desk/registry';
import { DEFAULTS } from '../../src/settings/settings';
import type { BuildEnv, DeskApi, ElementPlan, TargetCtx } from '../../src/desk/types';
import type { InkAction, Target } from '../../src/script/types';

const SVG = 'http://www.w3.org/2000/svg';
const g = () => document.createElementNS(SVG, 'g') as SVGGElement;

function env(over: Partial<BuildEnv> = {}) {
  const layers = { highlight: g(), agent: g() };
  const region = (t: Target): TargetCtx => ({
    target: t, layers, h: 700, scale: () => 0.5, toSpace: (p) => p, rectToSpace: (r) => r,
    runs: async () => [{ text: 'hello world', rect: { x: 100, y: 100, w: 200, h: 20 } }],
  });
  const page = (t: Target): TargetCtx => ({ ...region(t), h: 1294, scale: () => 0.86, toSpace: (p) => ({ x: p.x, y: p.y * 1.294 }), rectToSpace: (r) => ({ ...r, y: r.y * 1.294, h: r.h * 1.294 }) });
  const desk = { addConnector: vi.fn(() => ({ group: g(), stroke: [{ x: 0, y: 0 }, { x: 10, y: 10 }], scale: 1 })) } as unknown as DeskApi;
  const e: BuildEnv = { ctx: async (t) => (t.region === 'nope' ? 'unknown region' : t.region ? region(t) : page(t)), registry: new Registry(), settings: DEFAULTS, rng: () => null, desk, ...over };
  return { e, layers, desk };
}
const run = async (p: ElementPlan | string) => {
  if (typeof p === 'string') return p;
  const done = p.draw(new AbortController().signal, { speed: 1 });
  await vi.advanceTimersByTimeAsync(3000);
  return done;
};

describe('buildElement', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('a region line is neutral ink, registered under its id when it draws', async () => {
    const { e, layers } = env();
    const p = await buildElement({ kind: 'line', region: 'side', from: { x: 0, y: 0 }, to: { x: 100, y: 100 }, id: 'ray' }, e);
    expect(typeof p).not.toBe('string');
    expect(e.registry.get('ray')).toBeUndefined(); // not until its word
    await run(p);
    expect(e.registry.get('ray')?.kind).toBe('line');
    expect(layers.agent.querySelector('path')?.getAttribute('stroke')).toBe('#1D1D1F');
  });
  it('em uses the accent; pages always use the accent', async () => {
    const { e, layers } = env();
    await run(await buildElement({ kind: 'line', region: 'side', from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, em: true }, e));
    await run(await buildElement({ kind: 'line', page: 3, from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }, e));
    const strokes = [...layers.agent.querySelectorAll('path')].map((x) => x.getAttribute('stroke'));
    expect(strokes).toEqual([DEFAULTS.inkColor, DEFAULTS.inkColor]);
  });
  it('dash sets a dash pattern', async () => {
    const { e, layers } = env();
    await run(await buildElement({ kind: 'line', region: 'side', from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, dash: true }, e));
    expect(layers.agent.querySelector('path')?.getAttribute('stroke-dasharray')).toBe('7 6');
  });
  it('an unknown region is skipped', async () => {
    const { e } = env();
    expect(await buildElement({ kind: 'line', region: 'nope', from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }, e)).toBe('unknown region');
  });
  it('a point label is nudged off an element drawn earlier (rule 5)', async () => {
    const { e } = env();
    await run(await buildElement({ kind: 'line', region: 'side', from: { x: 0, y: 290 }, to: { x: 1000, y: 290 } }, e));
    await run(await buildElement({ kind: 'point', region: 'side', at: { x: 500, y: 300 }, text: 'C', dir: 'n', id: 'c' }, e));
    const label = e.registry.get('c')!.boxes[1];
    const line = { y1: 290 - 4, y2: 290 + 4 };
    expect(label.y + label.h <= line.y1 || label.y >= line.y2).toBe(true);
  });
  it('references wait briefly for their element, then skip with a warning (rule 4)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { e } = env();
    const p = buildElement({ kind: 'emph', ref: 'ghost' }, e);
    await vi.advanceTimersByTimeAsync(REF_WAIT_MS);
    expect(await p).toBe('unknown id');
    expect(warn).toHaveBeenCalled();
  });
  it('move translates a point and updates its anchor; lines do not move', async () => {
    const { e } = env();
    await run(await buildElement({ kind: 'point', region: 'side', at: { x: 100, y: 100 }, id: 'p' }, e));
    await run(await buildElement({ kind: 'move', ref: 'p', to: { x: 300, y: 200 } }, e));
    expect(e.registry.get('p')!.anchor).toEqual({ x: 300, y: 200 });
    expect(e.registry.get('p')!.group.getAttribute('transform')).toBe('translate(200 100)');
    await run(await buildElement({ kind: 'line', region: 'side', from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, id: 'l' }, e));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await buildElement({ kind: 'move', ref: 'l', to: { x: 3, y: 3 } }, e)).toBe('not movable');
  });
  it('fade dims and stops the element being an obstacle', async () => {
    const { e } = env();
    await run(await buildElement({ kind: 'point', region: 'side', at: { x: 100, y: 100 }, id: 'p' }, e));
    await run(await buildElement({ kind: 'fade', ref: 'p' }, e));
    expect(e.registry.get('p')!.group.style.opacity).toBe('0.25');
    expect(e.registry.obstacles({ region: 'side' })).toHaveLength(0);
  });
  it('plot needs axes and a valid fn', async () => {
    const { e } = env();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const plot: InkAction = { kind: 'plot', region: 'side', fn: '1/x', domain: [0.5, 5] };
    expect(await buildElement(plot, e)).toBe('no axes');
    await run(await buildElement({ kind: 'axes', region: 'side', at: { x: 100, y: 600 }, w: 600, h: 400, id: 'ax' }, e));
    const p = await buildElement(plot, e);
    expect(typeof p).not.toBe('string');
    const b = (p as ElementPlan).bbox;
    expect(b.x).toBeGreaterThanOrEqual(100 - 10);
    expect(b.x + b.w).toBeLessThanOrEqual(700 + 10);
    expect(await buildElement({ ...plot, fn: 'alert(1)' }, e)).toBe('bad fn');
  });
  it('connect frames both ends and hands routing to the desk', async () => {
    const { e, desk } = env();
    await run(await buildElement({ kind: 'point', region: 'side', at: { x: 271, y: 410 }, id: 'x' }, e));
    const p = await buildElement({ kind: 'connect', from: { page: 3, quote: 'hello' }, to: { region: 'side', ref: 'x' } }, e) as ElementPlan;
    expect(p.target).toEqual({ page: 3 });
    expect(p.also?.target).toEqual({ region: 'side' });
    await run(p);
    expect(desk.addConnector).toHaveBeenCalledOnce();
  });
  it('a connector with an id registers it, so it can be faded and emphasized', async () => {
    const { e, desk } = env();
    await run(await buildElement({ kind: 'point', region: 'side', at: { x: 271, y: 410 }, id: 'x' }, e));
    await run(await buildElement({ kind: 'connect', from: { page: 3, quote: 'hello' }, to: { region: 'side', ref: 'x' }, id: 'wire' }, e));
    const w = e.registry.get('wire')!;
    expect(w.kind).toBe('connect');
    expect(w.target).toEqual({ region: 'side' }); // revealed through its region end
    expect(w.boxes).toEqual([]); // not an obstacle for labels (it lives in desk px, not region space)
    const group = vi.mocked(desk.addConnector).mock.results[0].value.group as SVGGElement;
    expect(w.group).toBe(group);
    await run(await buildElement({ kind: 'fade', ref: 'wire' }, e));
    expect(group.style.opacity).toBe('0.25');
    const svg = document.createElementNS(SVG, 'svg');
    svg.appendChild(group);
    const em = await buildElement({ kind: 'emph', ref: 'wire' }, e);
    expect(typeof em).not.toBe('string');
    await run(em);
  });
  it('math placed near the right edge ends fully inside the region (rule 5)', async () => {
    const { e, layers } = env();
    const p = await buildElement({ kind: 'math', region: 'side', at: { x: 950, y: 690 }, tex: 'x - x\' = \\frac{Bf}{z}', size: 'l' }, e);
    expect(typeof p).not.toBe('string');
    await run(p);
    const fo = layers.agent.querySelector('foreignObject')!;
    const x = Number(fo.getAttribute('x')), y = Number(fo.getAttribute('y'));
    const w = Number(fo.getAttribute('width')), h = Number(fo.getAttribute('height'));
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x + w).toBeLessThanOrEqual(1000 + 2);
    expect(y + h).toBeLessThanOrEqual(700 + 2);
    const box = [...e.registry.obstacles({ region: 'side' })][0];
    expect(box.x + box.w).toBeLessThanOrEqual(1000);
  });
  it('written text near the edge stays inside the region (rule 5)', async () => {
    const { e, layers } = env();
    await run(await buildElement({ kind: 'write', region: 'side', at: { x: 980, y: 350 }, text: 'disparity', size: 'm', id: 'w' }, e));
    const b = e.registry.get('w')!.bbox;
    expect(b.x + b.w).toBeLessThanOrEqual(1000);
    expect(Number(layers.agent.querySelector('text')!.getAttribute('x'))).toBeCloseTo(b.x);
  });
  it('labels are sized for the scale at draw time, not build time', async () => {
    let k = 0.5;
    const { e, layers } = env();
    const ctx0 = e.ctx;
    e.ctx = async (t) => { const c = await ctx0(t); return typeof c === 'string' ? c : { ...c, scale: () => k }; };
    const p = await buildElement({ kind: 'label', page: 1, at: { x: 100, y: 100 }, text: 'A' }, e);
    k = 1;
    await run(p);
    expect(Number(layers.agent.querySelector('text')!.getAttribute('font-size'))).toBeCloseTo(15);
  });
  it('plot axes=<id> waits briefly for axes still waiting on their word', async () => {
    const { e } = env();
    const p = buildElement({ kind: 'plot', region: 'side', fn: '1/x', domain: [0.5, 5], axes: 'ax' }, e);
    await vi.advanceTimersByTimeAsync(100);
    await run(await buildElement({ kind: 'axes', region: 'side', at: { x: 100, y: 600 }, w: 600, h: 400, id: 'ax' }, e));
    expect(typeof (await p)).not.toBe('string');
  });
  it('a second move of the same id while the first is in flight lands on its own target', async () => {
    const { e } = env();
    await run(await buildElement({ kind: 'point', region: 'side', at: { x: 100, y: 100 }, id: 'p' }, e));
    const m1 = await buildElement({ kind: 'move', ref: 'p', to: { x: 300, y: 100 } }, e) as ElementPlan;
    const d1 = m1.draw(new AbortController().signal, { speed: 1 });
    await vi.advanceTimersByTimeAsync(200);
    const m2 = await buildElement({ kind: 'move', ref: 'p', to: { x: 400, y: 200 } }, e) as ElementPlan;
    const d2 = m2.draw(new AbortController().signal, { speed: 1 });
    await vi.advanceTimersByTimeAsync(2000);
    await Promise.all([d1, d2]);
    expect(e.registry.get('p')!.anchor).toEqual({ x: 400, y: 200 });
    expect(e.registry.get('p')!.group.getAttribute('transform')).toBe('translate(300 100)');
  });
});
