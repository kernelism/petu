// tests/geometry/tunnel.test.ts — a founder live test (chord tunnel, ?script=tunnel): a fit sketch with
// no axes. The chord's ends lie on the circle, nothing strays outside it, the arrows' labels show, and
// no label sits on a stroke (strokes drawn after a label included).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Figures } from '../../src/geometry/resolve';
import { parseTag } from '../../src/script/parseTag';
import type { Action, InkAction, RawAction, Target } from '../../src/script/types';
import { buildElement } from '../../src/desk/elements';
import { Registry } from '../../src/desk/registry';
import { DEFAULTS, type Settings } from '../../src/settings/settings';
import { rng, type Rng } from '../../src/ink/agent/strokes';
import { overlapArea, segHitsRect } from '../../src/desk/nudge';
import type { BuildEnv, DeskApi, TargetCtx } from '../../src/desk/types';
import type { SPt } from '../../src/geometry/space';

const SVG = 'http://www.w3.org/2000/svg';
const g = () => document.createElementNS(SVG, 'g') as SVGGElement;

const TAGS = [
  'sketch id=s near=p617 fit',
  'let on=s O=0,0 A=-300,-265 B=300,-265 M=mid(A,B) P=along(M,B,0.6) G=along(P,O,0.35) F=foot(G,A,B)',
  'circle on=s at=O r=400', 'line on=s from=A to=B', 'point on=s at=A "New York" dir=w', 'point on=s at=B "Tokyo" dir=e',
  'point on=s at=M "M" dir=n', 'point on=s at=O "O" dir=s', 'line on=s from=O to=M dash',
  'point on=s at=P "ball" dir=n', 'arrow on=s from=P to=G "gravity"', 'arrow on=s from=P to=F em "along tunnel"',
  'line on=s from=O to=B weight=secondary',
];

function resolveAll(tags: string[]): Action[] {
  const f = new Figures({ mark: () => undefined });
  const raw = tags.map((t) => parseTag(t) as RawAction);
  raw.forEach((a) => f.note(a));
  return raw.map((a) => f.resolve(a)).filter((a): a is Action => !!a && typeof a !== 'string' && a.kind !== 'sketch');
}

async function play(actions: Action[], style: Settings['inkStyle'], seed = 7) {
  const layers = { highlight: g(), agent: g() };
  const ctx = (t: Target): TargetCtx => ({
    target: t, layers, h: 700, scale: () => 0.6, toSpace: (p) => p, rectToSpace: (r) => r, runs: async () => [],
  });
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

type Circ = { at: SPt; rx: number; ry: number };
type Seg2 = { from: SPt; to: SPt };
const dist = (p: SPt, s: SPt[]) => Math.min(...s.slice(1).map((b, i) => {
  const a = s[i], dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}));

describe('the chord tunnel (founder live test)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('resolves: the chord ends are r from the centre in region units (one uniform scale)', () => {
    const as = resolveAll(TAGS);
    const c = as.find((a) => a.kind === 'circle') as unknown as Circ;
    const chord = as.find((a) => a.kind === 'line') as unknown as Seg2;
    expect(c.rx).toBeCloseTo(c.ry);
    // 300² + 265² = 400.28²: within a region unit of the radius
    for (const p of [chord.from, chord.to]) expect(Math.abs(Math.hypot(p.x - c.at.x, p.y - c.at.y) - c.rx)).toBeLessThan(1);
  });

  it('a data fit (per-axis scales) draws a circle as the ellipse its points land on', () => {
    const as = resolveAll(['sketch id=s near=p1 fit', 'axes on=s at=0,0 size=10,1', 'let on=s O=5,0.5 A=8,0.5 B=5,0.1', 'circle on=s at=O r=3', 'line on=s from=A to=O']);
    const c = as.find((a) => a.kind === 'circle') as unknown as Circ;
    const A = (as.find((a) => a.kind === 'line') as unknown as Seg2).from;
    expect(c.rx).not.toBeCloseTo(c.ry);
    expect(((A.x - c.at.x) / c.rx) ** 2 + ((A.y - c.at.y) / c.ry) ** 2).toBeCloseTo(1, 5);
  });

  for (const style of ['hand', 'live', 'clean'] as const) {
    it(`${style}: the circle passes within 1px of A and B and never strays outside r`, async () => {
      const as = resolveAll(TAGS);
      const { registry } = await play(as, style);
      const circle = registry.entries().find((e) => e.kind === 'circle')!;
      const chord = as.find((a) => a.kind === 'line') as unknown as Seg2;
      const ring = circle.strokes![0];
      const c = as.find((a) => a.kind === 'circle') as unknown as Circ;
      const px = 1 / 0.6; // 1 CSS px at the board's scale, in region units
      for (const p of [chord.from, chord.to]) expect(dist(p, ring)).toBeLessThanOrEqual(px);
      for (const q of ring) expect(Math.abs(Math.hypot(q.x - c.at.x, q.y - c.at.y) - c.rx)).toBeLessThanOrEqual(px);
    });

    it(`${style}: the arrows' labels are drawn, and no label sits on a stroke`, async () => {
      const { registry, layers } = await play(resolveAll(TAGS), style);
      const texts = [...layers.agent.querySelectorAll('text')].map((t) => t.textContent);
      for (const s of ['New York', 'Tokyo', 'M', 'O', 'ball', 'gravity', 'along tunnel']) expect(texts).toContain(s);
      const segs = registry.segments({ region: 's' });
      const ls = registry.labelBoxes();
      for (const [i, p] of ls.entries()) for (const q of ls.slice(i + 1)) expect(overlapArea(p.box, q.box), `${p.text} on ${q.text}`).toBe(0);
      for (const { text, box } of registry.labelBoxes()) {
        const hit = segs.filter((s) => segHitsRect(s, box, 0));
        expect(hit.length, `${text} sits on ${hit.length} stroke segments`).toBe(0);
      }
    });
  }

  it('dir= is the first choice when that side is clear; New York and Tokyo stay outside the circle', async () => {
    const as = resolveAll(TAGS);
    const { registry } = await play(as, 'hand');
    const c = as.find((a) => a.kind === 'circle') as unknown as Circ;
    const L = Object.fromEntries(registry.labelBoxes().map((l) => [l.text, l.box]));
    const A = (as.find((a) => a.kind === 'line') as unknown as Seg2).from;
    const B = (as.find((a) => a.kind === 'line') as unknown as Seg2).to;
    expect(L['New York'].x + L['New York'].w).toBeLessThanOrEqual(A.x); // west of A
    expect(L['Tokyo'].x).toBeGreaterThanOrEqual(B.x); // east of B
    for (const k of ['New York', 'Tokyo']) {
      const b = L[k];
      const far = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]].map(([x, y]) => Math.hypot(x - c.at.x, y - c.at.y));
      expect(Math.min(...far), k).toBeGreaterThan(c.rx);
    }
    expect(L['M'].y + L['M'].h).toBeLessThanOrEqual(A.y); // M: north, as asked
  });
});
