// tests/geometry/unitCircle.test.ts — a founder live test (d/dx sin x, ?script=live-calc): on a unit
// circle, labels at and near P stacked on each other ("dx" on "Q", "rise" on "dx"; an angle's "x" placed
// among them, unseen by the others). Labels never overlap each other — angle and brace labels included,
// and labels that glide clear of a later stroke land clear of the other labels too.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Figures } from '../../src/geometry/resolve';
import { parseTag } from '../../src/script/parseTag';
import type { Action, InkAction, RawAction, Target } from '../../src/script/types';
import { buildElement } from '../../src/desk/elements';
import { Registry } from '../../src/desk/registry';
import { DEFAULTS, type Settings } from '../../src/settings/settings';
import { rng, type Rng } from '../../src/ink/agent/strokes';
import { overlapArea, placeClear } from '../../src/desk/nudge';
import { placeInset } from '../../src/desk/zoom';
import type { BuildEnv, DeskApi, TargetCtx } from '../../src/desk/types';

const SVG = 'http://www.w3.org/2000/svg';
const g = () => document.createElementNS(SVG, 'g') as SVGGElement;

/** The live answer's figure, verbatim (narration dropped). */
export const CALC_TAGS = [
  'sketch id=s near=p250 fit',
  'let on=s O=0,0 E=320,0 W=-320,0 N=0,-320 S=0,320 P=247,-169 Q=198,-225 R=198,-169 F=foot(P,O,E)',
  'circle on=s at=O r=300', 'line on=s from=W to=E weight=faint', 'line on=s from=S to=N weight=faint',
  'point on=s at=P "P" dir=e', 'line on=s from=O to=P', 'line on=s from=P to=F em id=ht', 'label id=ht "sin x" dir=e',
  'angle on=s at=O from=E to=P "x"',
  'point on=s at=Q "Q" dir=n', 'line on=s from=P to=Q id=arc', 'label id=arc "dx" dir=ne',
  'line on=s from=Q to=R em id=rise', 'line on=s from=R to=P dash', 'label id=rise "rise" dir=w',
  'angle on=s at=Q from=R to=P "x"',
];

function resolveAll(tags: string[]): Action[] {
  const f = new Figures({ mark: () => undefined });
  const raw = tags.map((t) => parseTag(t) as RawAction);
  raw.forEach((a) => f.note(a));
  return raw.map((a) => f.resolve(a)).filter((a): a is Action => !!a && typeof a !== 'string' && a.kind !== 'sketch');
}

async function play(actions: Action[], style: Settings['inkStyle'], seed = 7) {
  const layers = { highlight: g(), agent: g() };
  const ctx = (t: Target): TargetCtx => ({ target: t, layers, h: 700, scale: () => 0.6, toSpace: (p) => p, rectToSpace: (r) => r, runs: async () => [] });
  const desk = { addConnector: vi.fn() } as unknown as DeskApi;
  const r: Rng = rng(seed);
  const registry = new Registry();
  const e: BuildEnv = { ctx: async (t) => ctx(t), registry, settings: { ...DEFAULTS, inkStyle: style }, rng: () => (style === 'clean' ? null : r), desk };
  for (const a of actions) {
    const p = await buildElement(a as InkAction, e);
    if (typeof p === 'string') throw new Error(`${a.kind}: ${p}`);
    const done = p.draw(new AbortController().signal, { speed: 1 });
    await vi.advanceTimersByTimeAsync(5000);
    await done;
  }
  await vi.advanceTimersByTimeAsync(2000);
  return { registry, layers };
}

describe('labels never stack (unit circle, founder live test)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  for (const style of ['hand', 'live', 'clean'] as const) {
    it(`${style}: every label is drawn and registered, and no two overlap`, async () => {
      const { registry, layers } = await play(resolveAll(CALC_TAGS), style);
      const texts = [...layers.agent.querySelectorAll('text')].map((t) => t.textContent);
      for (const s of ['P', 'sin x', 'Q', 'dx', 'rise']) expect(texts).toContain(s);
      const ls = registry.labelBoxes();
      // both angle labels ("x") take part in placement like every other label
      expect(ls.map((l) => l.text).sort()).toEqual(['P', 'Q', 'dx', 'rise', 'sin x', 'x', 'x']);
      for (const [i, p] of ls.entries()) for (const q of ls.slice(i + 1)) expect(overlapArea(p.box, q.box), `${p.text} on ${q.text}`).toBe(0);
    });
  }

  it('placeClear: a clear spot farther out beats one on another label, even when every near side crosses a stroke', () => {
    const anchor = { x: 100, y: 100 };
    // strokes all around the anchor at the first ring; another label right where the first choice would go
    const segs = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => { const a = (k * Math.PI) / 4; return { a: { x: 100 + Math.cos(a) * 8, y: 100 + Math.sin(a) * 8 }, b: { x: 100 + Math.cos(a) * 40, y: 100 + Math.sin(a) * 40 } }; });
    const other = { x: 112, y: 76, w: 30, h: 14 };
    const r = placeClear(anchor, 20, 12, 'ne', 0, segs, [], { x: 0, y: 0, w: 400, h: 400 }, [], [other]);
    expect(overlapArea(r, other)).toBe(0);
  });

  it('zoom: grammar (region only; r > 0; scale clamped to 1.5–8, default 3)', () => {
    expect(parseTag('zoom on=s at=P r=60 scale=4')).toMatchObject({ kind: 'zoom', region: 's', r: 60, scale: 4 });
    expect(parseTag('zoom on=s at=P r=60 "near P"')).toMatchObject({ scale: 3, text: 'near P' });
    expect(parseTag('zoom on=s at=P r=60 scale=40')).toMatchObject({ scale: 8 });
    expect(parseTag('zoom p=3 at=500,500 r=60')).toBeNull();
    expect(parseTag('zoom on=s at=P')).toBeNull();
  });

  it('placeInset: beside the figure, inside the section, never over the detail', () => {
    const fig = { x: 200, y: 100, w: 500, h: 500 };
    const z = placeInset({ x: 650, y: 250 }, 30, 4, fig, [fig], { x: 0, y: 0, w: 1000, h: 700 }, 20, 210);
    expect(z.R).toBe(120);
    expect(z.C.x - z.R).toBeGreaterThanOrEqual(fig.x + fig.w); // right of the figure
    expect(z.C.x + z.R).toBeLessThanOrEqual(1000);
    // capped, and smaller still when that is what fits beside the figure (k follows R)
    const big = placeInset({ x: 650, y: 250 }, 80, 4, fig, [fig], { x: 0, y: 0, w: 1000, h: 700 }, 20, 210);
    expect(big.R).toBeLessThanOrEqual(210);
    expect(big.k).toBeCloseTo(big.R / 80);
    expect(overlapArea({ x: big.C.x - big.R, y: big.C.y - big.R, w: 2 * big.R, h: 2 * big.R }, fig)).toBe(0);
  });

  it('zoom on P: the inset copies the strokes near P, enlarged, and its labels are body size and clear of each other', async () => {
    const tags = [...CALC_TAGS, 'zoom on=s at=P r=80 scale=4'];
    const { registry, layers } = await play(resolveAll(tags), 'clean');
    const inset = layers.agent.querySelector('[data-zoom]')!;
    expect(inset).not.toBeNull();
    expect(inset.querySelectorAll('path').length).toBeGreaterThan(3);
    const ts = [...inset.querySelectorAll('text')];
    const words = ts.map((t) => t.textContent);
    for (const w of ['P', 'Q', 'dx', 'rise']) expect(words).toContain(w);
    // body size: the inset's labels are the same size as the figure's own
    const outside = [...layers.agent.querySelectorAll('text')].filter((t) => !inset.contains(t));
    expect(ts[0].getAttribute('font-size')).toBe(outside[0].getAttribute('font-size'));
    // the zoom's element keeps the inset's room (later labels keep off it), and the inset is within the section
    const z = registry.entries().find((e) => e.kind === 'zoom')!;
    const room = z.boxes[z.boxes.length - 1];
    expect(room.x).toBeGreaterThanOrEqual(0);
    expect(room.x + room.w).toBeLessThanOrEqual(1000);
    const ls = registry.labelBoxes();
    for (const [i, p] of ls.entries()) for (const q of ls.slice(i + 1)) expect(overlapArea(p.box, q.box), `${p.text} on ${q.text}`).toBe(0);
  });
});
