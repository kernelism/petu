import { describe, expect, it } from 'vitest';
import { Figures, onLift, placeLift, type Grounding } from '../../src/geometry/resolve';
import { parseTag } from '../../src/script/parseTag';
import type { RawAction } from '../../src/script/types';

// A chart whose x axis runs 0–60 over page x 113–525 and y axis 0–14 over page y 804–254.
const chart = { kind: 'chart' as const, rect: { x: 113, y: 254, w: 412, h: 550 }, x: { lo: 0, hi: 60, p0: 113, p1: 525 }, y: { lo: 0, hi: 14, p0: 804, p1: 254 } };
const ground: Grounding = {
  mark(page, id) {
    if (page === 12 && id === '#c1') return chart;
    if (page === 12 && id === '#d1') return { kind: 'dot', at: { x: 319, y: 529 } }; // data (30, 7)
    if (page === 4 && id === '#g1') return { kind: 'figure', rect: { x: 138, y: 518, w: 113, h: 143 } };
    if (page === 4 && id === '#b1') return { kind: 'box', rect: { x: 50, y: 568, w: 38, h: 43 } };
    if (page === 4 && id === '#e2') return { kind: 'equation', rect: { x: 600, y: 300, w: 200, h: 60 } };
    return undefined;
  },
  aspect: (p) => (p === 4 || p === 12 ? 0.7 : undefined),
  obstacles: (p) => (p === 4 ? [{ x: 50, y: 150, w: 400, h: 20 }] : []),
};
const tag = (s: string) => parseTag(s) as RawAction;
const run = (fs: Figures, ...ss: string[]) => { const as = ss.map(tag); as.forEach((a) => fs.note(a)); return as.map((a) => fs.resolve(a)); };

describe('drawing on a calibrated chart', () => {
  it('maps data coordinates through the chart axes', () => {
    const [l] = run(new Figures(ground), 'line p=12 on=#c1 from=0,12 to=60,0');
    expect(l).toEqual({ kind: 'line', page: 12, from: { x: 113, y: expect.closeTo(332.6, 1) }, to: { x: 525, y: 804 } });
  });
  it('names on a chart are data points; page marks on it read back as data', () => {
    const [, p, ln] = run(new Figures(ground), 'let p=12 on=#c1 E=30,7', 'point p=12 on=#c1 at=E "E"', 'line p=12 on=#c1 from=#d1 to=60,7');
    expect(p).toMatchObject({ at: { x: expect.closeTo(319, 1), y: expect.closeTo(529, 1) } });
    expect((ln as { from: { x: number } }).from.x).toBeCloseTo(319, 0);
  });
  it('a chart plot gets the chart axes, its domain and range', () => {
    const [pl] = run(new Figures(ground), 'plot p=12 on=#c1 fn="12-x/5"') as Record<string, unknown>[];
    expect(pl).toMatchObject({ kind: 'plot', page: 12, domain: [0, 60], range: [0, 14], onChart: { rect: chart.rect } });
    expect(pl.chart).toBeUndefined();
  });
  it('an unknown chart is skipped, never guessed', () => {
    expect(run(new Figures(ground), 'line p=12 on=#c2 from=0,1 to=2,3')[0]).toBe('unknown chart #c2');
    expect(run(new Figures(ground), 'line p=3 on=#c1 from=0,1 to=2,3')[0]).toBe('unknown chart #c1');
  });
  it('log axes map in log10 and refuse values ≤ 0', () => {
    const g: Grounding = { mark: (_p, id) => (id === '#c1' ? { ...chart, x: { lo: 1, hi: 1000, p0: 100, p1: 400, log: true } } : undefined) };
    const [a, b] = run(new Figures(g), 'point p=1 on=#c1 at=10,0', 'point p=1 on=#c1 at=0,0');
    expect((a as { at: { x: number } }).at.x).toBeCloseTo(200, 6);
    expect(b).toMatch(/log axis/);
  });
});

describe('lifting a page region onto the board', () => {
  it('places it inside the section, keeping the page proportions', () => {
    const l = placeLift({ x: 138, y: 518, w: 113, h: 143 }, 0.7);
    expect(l.h / l.w).toBeCloseTo((143 * 0.7) / 113, 6);
    expect(l.at.y + l.h).toBeLessThanOrEqual(700);
    expect(l.at.x).toBeGreaterThanOrEqual(0);
    expect(l.at.x + l.w).toBeLessThanOrEqual(1000);
    const big = placeLift({ x: 0, y: 0, w: 100, h: 900 }, 1, { x: 800, y: 600 }, 900);
    expect(big.at.x + big.w).toBeLessThanOrEqual(1000);
    expect(big.at.y + big.h).toBeLessThanOrEqual(700 + 1e-9);
  });
  it('resolves to its page rect and place; marks inside it become points of the section', () => {
    const [lift, arrow, out] = run(new Figures(ground), 'lift p=4 mark=#g1 on=s id=e', 'arrow on=s from=100,100 to=#g1', 'point on=s at=#b1');
    const L = lift as { src: unknown; at: { x: number; y: number }; w: number; h: number };
    expect(L.src).toEqual({ x: 138, y: 518, w: 113, h: 143 });
    expect((arrow as { to: { x: number; y: number } }).to).toEqual({ x: expect.closeTo(L.at.x + L.w / 2, 6), y: expect.closeTo(L.at.y + L.h / 2, 6) });
    expect(out).toBe('unknown point #b1'); // #b1 is not on the lifted figure
    const pl = { page: 4, src: { x: 50, y: 500, w: 300, h: 170 }, at: { x: 100, y: 50 }, w: 600, h: 238 };
    expect(onLift(pl, { x: 69, y: 589.5 }, 0.7)).toEqual({ x: 138, y: expect.closeTo(50 + 89.5 * 0.7 * 2, 6) });
  });
  it('skips an unknown mark, an ungrounded page and a fitted sketch', () => {
    expect(run(new Figures(ground), 'lift p=4 mark=#g9 on=s')[0]).toBe('unknown mark #g9');
    expect(run(new Figures(ground), 'lift p=7 box=0,0,100,100 on=s')[0]).toBe('page 7 is not grounded');
    expect(run(new Figures(ground), 'sketch id=f fit', 'lift p=4 mark=#g1 on=f')[1]).toMatch(/plain sketch/);
  });
});

describe('page notes', () => {
  it('resolve a mark to its rect and carry what they must not cover', () => {
    expect(run(new Figures(ground), 'note p=4 "slope" annotate=#e2')[0]).toEqual({ kind: 'annot', page: 4, text: 'slope', rect: { x: 600, y: 300, w: 200, h: 60 }, avoid: [{ x: 50, y: 150, w: 400, h: 20 }] });
    expect(run(new Figures(ground), 'note p=4 "?" annotate=#e9')[0]).toBe('unknown mark #e9');
    expect(run(new Figures(ground), 'note p=12 on=#c1 at=30,7 "E"')[0]).toMatchObject({ kind: 'annot', at: { x: expect.closeTo(319, 1), y: expect.closeTo(529, 1) } });
  });
});
