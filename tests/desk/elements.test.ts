// tests/desk/elements.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildElement, REF_WAIT_MS, encloseRect } from '../../src/desk/elements';
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
  it('dash is construction: a faint dashed hairline in muted ink', async () => {
    const { e, layers } = env();
    await run(await buildElement({ kind: 'line', region: 'side', from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, dash: true }, e));
    const p = layers.agent.querySelector('path')!;
    expect(p.getAttribute('stroke-dasharray')).toBe('4 3.5');
    expect(p.getAttribute('stroke-width')).toBe('1');
    expect(p.getAttribute('stroke')).toBe('#6E6E73');
    expect(p.getAttribute('stroke-opacity')).toBe('0.7');
  });
  it('three line weights: primary by default, secondary and faint on request; em keeps the weight in the accent', async () => {
    const { e, layers } = env();
    const line = { kind: 'line', region: 'side', from: { x: 0, y: 0 }, to: { x: 100, y: 0 } } as const;
    await run(await buildElement(line, e));
    await run(await buildElement({ ...line, weight: 'secondary' }, e));
    await run(await buildElement({ ...line, weight: 'faint' }, e));
    await run(await buildElement({ ...line, weight: 'secondary', em: true }, e));
    const ps = [...layers.agent.querySelectorAll('path')].map((p) => [p.getAttribute('stroke-width'), p.getAttribute('stroke')]);
    expect(ps).toEqual([['2', '#1D1D1F'], ['1.25', '#3A3A3C'], ['1', '#6E6E73'], ['1.25', DEFAULTS.inkColor]]);
  });
  it('points are small dots', async () => {
    const { e, layers } = env();
    await run(await buildElement({ kind: 'point', region: 'side', at: { x: 100, y: 100 } }, e));
    expect(Number(layers.agent.querySelector('circle')!.getAttribute('r'))).toBeCloseTo(3 / 0.5);
  });
  it('labels: words in --ink-2 at a regular weight, symbols in the math italic in --ink; em is all accent', async () => {
    const { e, layers } = env();
    await run(await buildElement({ kind: 'label', region: 'side', at: { x: 100, y: 100 }, text: 'near' }, e));
    await run(await buildElement({ kind: 'point', region: 'side', at: { x: 500, y: 500 }, text: 'x′' }, e));
    await run(await buildElement({ kind: 'write', region: 'side', at: { x: 100, y: 600 }, text: 'x′ is on l′', size: 'l', em: true }, e));
    const [near, x, pay] = [...layers.agent.querySelectorAll('text')];
    expect([near.getAttribute('fill'), near.getAttribute('font-weight')]).toEqual(['#3A3A3C', '450']);
    const xs = x.querySelector('tspan')!;
    expect([xs.getAttribute('fill'), xs.getAttribute('font-style')]).toEqual(['#1D1D1F', 'italic']);
    expect(pay.getAttribute('fill')).toBe(DEFAULTS.inkColor);
    expect(pay.getAttribute('font-weight')).toBe('450');
    expect([...pay.querySelectorAll('tspan')].every((t) => (t.getAttribute('fill') ?? DEFAULTS.inkColor) === DEFAULTS.inkColor)).toBe(true);
  });
  it('region shades are opaque sheets behind all ink; outline adds a hairline; em is an accent tint', async () => {
    const { e, layers } = env();
    await run(await buildElement({ kind: 'line', region: 'side', from: { x: 0, y: 0 }, to: { x: 100, y: 0 } }, e));
    await run(await buildElement({ kind: 'shade', region: 'side', pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 80 }], outline: true }, e));
    await run(await buildElement({ kind: 'shade', region: 'side', pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 80 }], em: true }, e));
    const kids = [...layers.agent.children];
    expect(kids.map((k) => k.firstElementChild?.tagName.toLowerCase())).toEqual(['polygon', 'polygon', 'path']);
    const [sheet, tint] = kids.map((k) => k.firstElementChild!);
    expect([sheet.getAttribute('fill-opacity'), sheet.getAttribute('stroke'), sheet.getAttribute('stroke-width')]).toEqual(['1', '#8E8E93', '1']);
    expect([tint.getAttribute('fill'), tint.getAttribute('fill-opacity'), tint.getAttribute('stroke')]).toEqual([DEFAULTS.inkColor, '0.1', null]);
    expect(layers.highlight.children).toHaveLength(0);
  });
  it('a page shade stays a light tint in the highlight layer', async () => {
    const { e, layers } = env();
    await run(await buildElement({ kind: 'shade', page: 3, at: { x: 100, y: 100 }, rx: 20, ry: 20 }, e));
    expect(Number(layers.highlight.querySelector('ellipse')!.getAttribute('fill-opacity'))).toBeLessThan(0.2);
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
  it('a curve whose points loop back on themselves is skipped, an ordered one draws', async () => {
    const { e } = env();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const P = (xs: number[][]) => xs.map(([x, y]) => ({ x, y }));
    expect(await buildElement({ kind: 'curve', region: 'side', pts: P([[0, 300], [25, 230], [100, 300], [75, 370], [200, 300], [125, 230], [300, 300], [175, 370], [400, 300], [225, 230], [275, 370]]) }, e)).toBe('curve crosses itself');
    expect(typeof await buildElement({ kind: 'curve', region: 'side', pts: P([[0, 300], [25, 230], [50, 300], [75, 370], [100, 300]]) }, e)).not.toBe('string');
  });
  it('plot: on hand-drawn axes, or the engine graph without them', async () => {
    const { e } = env();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const plot: InkAction = { kind: 'plot', region: 'side', fn: '1/x', domain: [0.5, 5] };
    // no hand-drawn axes: the engine draws the graph on its own axes
    expect(typeof (await buildElement(plot, e))).not.toBe('string');
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
    const path = (vi.mocked(desk.addConnector).mock.results[0].value.group as SVGGElement).querySelector('path')!;
    expect(path.getAttribute('stroke-dasharray')).toBeNull(); // solid, not UI-chrome dashes
    expect(path.getAttribute('stroke-opacity')).toBeNull();
    expect(path.getAttribute('stroke-width')).toBe('1.25');
  });
  it('a connector ends in a small dot at its element end; at a point the point is the dot', async () => {
    const { e, desk } = env();
    const wire = () => {
      const svg = document.createElementNS(SVG, 'svg');
      const group = svg.appendChild(g()) as SVGGElement;
      vi.mocked(desk.addConnector).mockReturnValueOnce({ group, stroke: [{ x: 0, y: 0 }, { x: 10, y: 10 }], scale: 1 });
      return { svg, group };
    };
    const w1 = wire();
    await run(await buildElement({ kind: 'connect', from: { page: 3, quote: 'hello' }, to: { region: 'side', at: { x: 500, y: 300 } } }, e));
    const m = w1.group.querySelector('path')!.getAttribute('marker-end');
    expect(m).toMatch(/^url\(#desk-wire-dot-\d+\)$/);
    expect(w1.svg.querySelector(`marker${m!.slice(4, -1)} circle`)).not.toBeNull();
    const w2 = wire();
    await run(await buildElement({ kind: 'connect', from: { region: 'side', at: { x: 500, y: 300 } }, to: { page: 3, quote: 'hello' } }, e));
    expect(w2.group.querySelector('path')!.getAttribute('marker-start')).toMatch(/^url/);
    const w3 = wire();
    await run(await buildElement({ kind: 'point', region: 'side', at: { x: 271, y: 410 }, id: 'x' }, e));
    await run(await buildElement({ kind: 'connect', from: { page: 3, quote: 'hello' }, to: { region: 'side', ref: 'x' } }, e));
    expect(w3.group.querySelector('path')!.getAttribute('marker-end')).toBeNull();
    const to = vi.mocked(desk.addConnector).mock.calls[2][1];
    expect(to.r.x + to.r.w / 2).toBeCloseTo(271); // runs right up to the dot
  });
  it('a connector to a box (or any area element) ends at the box itself, not its first corner', async () => {
    const { e, desk } = env();
    await run(await buildElement({ kind: 'box', region: 'side', at: { x: 400, y: 200 }, w: 300, h: 200, id: 'bx' }, e));
    await run(await buildElement({ kind: 'connect', from: { page: 3, quote: 'hello' }, to: { region: 'side', ref: 'bx' } }, e));
    const to = vi.mocked(desk.addConnector).mock.calls[0][1].r;
    // The whole outline (the router picks the nearest edge's midpoint), not an 16px square at (400, 200).
    expect(to.w).toBeGreaterThan(250);
    expect(to.h).toBeGreaterThan(150);
    expect(to.x + to.w / 2).toBeCloseTo(550, -1);
    expect(to.y + to.h / 2).toBeCloseTo(300, -1);
    await run(await buildElement({ kind: 'circle', region: 'side', at: { x: 200, y: 500 }, rx: 60, ry: 40, id: 'ci' }, e));
    await run(await buildElement({ kind: 'connect', from: { page: 3, quote: 'hello' }, to: { region: 'side', ref: 'ci' } }, e));
    const c = vi.mocked(desk.addConnector).mock.calls[1][1].r;
    expect(c.x + c.w / 2).toBeCloseTo(200, -1);
    expect(c.y + c.h / 2).toBeCloseTo(500, -1);
  });
  it("a connector's arrival is an obstacle in its region: a later label is nudged clear of it", async () => {
    const { e, desk, layers } = env();
    // Wire frame px = 2 × region units (a region at scale 2, origin shared).
    const m = (k: number) => ({ a: k, b: 0, c: 0, d: k, e: 0, f: 0 });
    const group = g();
    (group as unknown as { getScreenCTM(): unknown }).getScreenCTM = () => m(1);
    (layers.agent as unknown as { getScreenCTM(): unknown }).getScreenCTM = () => ({ ...m(2), inverse: () => m(0.5) });
    // Arrives along y = 600 px (300 units), ending at x = 1000 px (500 units).
    vi.mocked(desk.addConnector).mockReturnValueOnce({ group, stroke: [{ x: 600, y: 600 }, { x: 800, y: 600 }, { x: 1000, y: 600 }], scale: 1 });
    await run(await buildElement({ kind: 'connect', from: { page: 3, quote: 'hello' }, to: { region: 'side', at: { x: 500, y: 300 } }, id: 'w' }, e));
    const boxes = e.registry.get('w')!.boxes;
    expect(boxes.length).toBeGreaterThan(0);
    for (const b of boxes) expect(b.x).toBeGreaterThan(440); // only the last stretch (64px = 32 units)
    await run(await buildElement({ kind: 'label', region: 'side', at: { x: 470, y: 300 }, text: 'here', id: 'lb' }, e));
    const lb = e.registry.get('lb')!.bbox;
    expect(boxes.some((b) => lb.x < b.x + b.w && b.x < lb.x + lb.w && lb.y < b.y + b.h && b.y < lb.y + lb.h)).toBe(false);
  });
  it('a connector with an id registers it, so it can be faded and emphasized', async () => {
    const { e, desk } = env();
    await run(await buildElement({ kind: 'point', region: 'side', at: { x: 271, y: 410 }, id: 'x' }, e));
    await run(await buildElement({ kind: 'connect', from: { page: 3, quote: 'hello' }, to: { region: 'side', ref: 'x' }, id: 'wire' }, e));
    const w = e.registry.get('wire')!;
    expect(w.kind).toBe('connect');
    expect(w.target).toEqual({ region: 'side' }); // revealed through its region end
    expect(w.boxes).toEqual([]); // without layout (jsdom) its arrival can't be mapped into the region: no obstacle
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
  it('math is left-aligned at `at`: never shifted back in per element (the section scales as a whole)', async () => {
    const { e, layers } = env();
    const p = await buildElement({ kind: 'math', region: 'side', at: { x: 950, y: 690 }, tex: 'x - x\' = \\frac{Bf}{z}', size: 'l' }, e);
    expect(typeof p).not.toBe('string');
    await run(p);
    const el = layers.agent.querySelector('.desk-math')!;
    const [x] = /translate\(([-\d.e]+) ([-\d.e]+)\)/.exec(el.getAttribute('transform')!)!.slice(1).map(Number);
    expect(x).toBe(950);
  });
  it('math, write and label keep their `at` y whatever the region scale (WebKit drift regression)', async () => {
    const mids: number[][] = [];
    for (const scale of [0.3, 0.518, 0.6, 1, 1.4]) {
      const { e } = env();
      const ctx = await e.ctx({ region: 'side' }) as TargetCtx;
      const e2 = { ...e, ctx: async () => ({ ...ctx, scale: () => scale }) };
      await run(await buildElement({ kind: 'math', region: 'side', at: { x: 50, y: 200 }, tex: 'z', size: 's', id: 'm' }, e2));
      await run(await buildElement({ kind: 'math', region: 'side', at: { x: 50, y: 470 }, tex: '2z', size: 's', id: 'm2' }, e2));
      await run(await buildElement({ kind: 'write', region: 'side', at: { x: 300, y: 350 }, text: "depth z, x'", size: 'm', id: 'w' }, e2));
      const mid = (id: string) => { const b = e2.registry.get(id)!.bbox; return b.y + b.h / 2; };
      mids.push([mid('m'), mid('m2'), mid('w')]);
    }
    for (const m of mids) {
      expect(m[0]).toBeCloseTo(200, 0);
      expect(m[1]).toBeCloseTo(470, 0);
      expect(m[2]).toBeCloseTo(350, 0);
    }
  });
  it('written text keeps its left edge at `at` and wraps under itself instead of running off the section', async () => {
    const { e, layers } = env();
    await run(await buildElement({ kind: 'write', region: 'side', at: { x: 500, y: 350 }, text: 'the match for x must lie somewhere along the epipolar line', size: 'm', id: 'w' }, e));
    const b = e.registry.get('w')!.bbox;
    const texts = [...layers.agent.querySelectorAll('text')];
    expect(texts.length).toBeGreaterThan(1);
    for (const t of texts) expect(Number(t.getAttribute('x'))).toBe(500);
    expect(b.x).toBe(500);
  });
  it('region text is sized from the slide body: m = body, never under 12px; math at the body size', async () => {
    const { e, layers } = env();
    const ctx0 = e.ctx;
    e.ctx = async (t) => { const c = await ctx0(t); return typeof c === 'string' || t.page != null ? c : { ...c, scale: () => 0.5, body: () => 20 }; };
    await run(await buildElement({ kind: 'write', region: 'side', at: { x: 100, y: 100 }, text: 'body', size: 'm' }, e));
    expect(Number(layers.agent.querySelector('text')!.getAttribute('font-size'))).toBeCloseTo(20 / 0.5);
    layers.agent.replaceChildren();
    e.ctx = async (t) => { const c = await ctx0(t); return typeof c === 'string' || t.page != null ? c : { ...c, scale: () => 0.5, body: () => 8 }; };
    await run(await buildElement({ kind: 'label', region: 'side', at: { x: 100, y: 100 }, text: 'tiny' }, e));
    expect(Number(layers.agent.querySelector('text')!.getAttribute('font-size'))).toBeCloseTo(12 / 0.5);
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

describe('anchored shapes enclose their glyphs', () => {
  it.each([[20, 20], [60, 30], [240, 30]])('an ellipse around a %i×%i rect contains every corner', (w, h) => {
    const { rx, ry } = encloseRect(w, h);
    for (const [cx, cy] of [[w / 2, h / 2], [-w / 2, h / 2], [w / 2, -h / 2], [-w / 2, -h / 2]]) {
      expect((cx / rx) ** 2 + (cy / ry) ** 2).toBeLessThanOrEqual(1);
    }
    expect(rx).toBeGreaterThanOrEqual(12);
    expect(ry).toBeGreaterThanOrEqual(12);
  });
  it('uses the smallest such ellipse plus 4', () => {
    expect(encloseRect(240, 30).rx).toBeCloseTo(240 / Math.SQRT2 + 4);
  });
});
