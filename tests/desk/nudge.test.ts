// tests/desk/nudge.test.ts
import { describe, it, expect } from 'vitest';
import { nudge, placeLabel, MAX_NUDGES, NUDGE_GAP } from '../../src/desk/nudge';

const B = { x: 0, y: 0, w: 1000, h: 700 };
const hit = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('nudge', () => {
  it('leaves a free label where it is', () => {
    const r = { x: 100, y: 100, w: 40, h: 20 };
    expect(nudge(r, [{ x: 300, y: 300, w: 10, h: 10 }], B)).toEqual(r);
  });
  it('moves off an overlapping element along the shortest axis, with a gap', () => {
    const r = nudge({ x: 100, y: 100, w: 40, h: 20 }, [{ x: 0, y: 112, w: 400, h: 4 }], B); // a thin horizontal line under it
    expect(r.x).toBe(100);
    expect(r.y + r.h).toBe(112 - NUDGE_GAP);
  });
  it('stays inside the bounds (picks another direction at an edge)', () => {
    const r = nudge({ x: 0, y: 0, w: 40, h: 20 }, [{ x: 0, y: 0, w: 30, h: 400 }], B);
    expect(r.x).toBeGreaterThanOrEqual(30 + NUDGE_GAP);
    expect(r.y).toBeGreaterThanOrEqual(0);
  });
  it('gives up after MAX_NUDGES and accepts', () => {
    // Obstacles tiled everywhere: no free spot.
    const obs = [];
    for (let x = 0; x < 1000; x += 50) for (let y = 0; y < 700; y += 50) obs.push({ x, y, w: 48, h: 48 });
    const r = nudge({ x: 500, y: 300, w: 40, h: 20 }, obs, B);
    expect(MAX_NUDGES).toBe(3);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.x + r.w).toBeLessThanOrEqual(1000);
  });
  it('clears two neighbours in a row', () => {
    const obs = [{ x: 90, y: 90, w: 60, h: 40 }, { x: 150, y: 90, w: 60, h: 40 }];
    const r = nudge({ x: 120, y: 100, w: 40, h: 20 }, obs, B);
    expect(obs.some((o) => hit(r, o))).toBe(false);
  });
});

describe('placeLabel', () => {
  it('puts the box toward its compass direction, growing away from the anchor', () => {
    const a = { x: 500, y: 300 };
    const ne = placeLabel(a, 30, 20, 'ne');
    expect(ne.x).toBeGreaterThan(500);
    expect(ne.y + ne.h).toBeLessThan(300);
    const w = placeLabel(a, 30, 20, 'w');
    expect(w.x + w.w).toBeLessThan(500);
    expect(w.y + w.h / 2).toBeCloseTo(300);
    const s = placeLabel(a, 30, 20, 's', 6);
    expect(s.y).toBe(300 + 12 + 6);
    expect(s.x + s.w / 2).toBeCloseTo(500);
  });
});

import { segHitsRect, placeClear, type Seg } from '../../src/desk/nudge';

describe('segHitsRect', () => {
  const r = { x: 10, y: 10, w: 20, h: 10 };
  it('detects crossing, touching (within pad) and inside', () => {
    expect(segHitsRect({ a: { x: 0, y: 15 }, b: { x: 50, y: 15 } }, r)).toBe(true); // through
    expect(segHitsRect({ a: { x: 15, y: 12 }, b: { x: 20, y: 18 } }, r)).toBe(true); // inside
    expect(segHitsRect({ a: { x: 0, y: 21 }, b: { x: 50, y: 21 } }, r, 2)).toBe(true); // within pad
    expect(segHitsRect({ a: { x: 0, y: 25 }, b: { x: 50, y: 25 } }, r, 2)).toBe(false);
  });
  it('handles parallel segments and ones that stop short', () => {
    expect(segHitsRect({ a: { x: 0, y: 0 }, b: { x: 50, y: 0 } }, r, 2)).toBe(false); // parallel, outside
    expect(segHitsRect({ a: { x: 0, y: 15 }, b: { x: 5, y: 15 } }, r, 2)).toBe(false); // short of the rect
    expect(segHitsRect({ a: { x: 20, y: 0 }, b: { x: 20, y: 50 } }, r)).toBe(true); // vertical through
    expect(segHitsRect({ a: { x: 5, y: 5 }, b: { x: 5, y: 5 } }, r, 0)).toBe(false); // a point outside
  });
});

describe('placeClear', () => {
  const anchor = { x: 300, y: 300 };
  const hits = (r: { x: number; y: number; w: number; h: number }, segs: Seg[]) => segs.some((s) => segHitsRect(s, r));
  it('moves a label off a horizontal line through its point (dir n)', () => {
    const segs: Seg[] = [{ a: { x: 100, y: 300 }, b: { x: 500, y: 300 } }];
    const r = placeClear(anchor, 20, 18, 'n', 3, segs, [], B);
    expect(hits(r, segs)).toBe(false);
    expect(r.y + r.h).toBeLessThanOrEqual(300); // the requested side is already clear
  });
  it('keeps the requested side when it is clear', () => {
    expect(placeClear(anchor, 20, 18, 'ne', 3, [], [], B)).toEqual(placeLabel(anchor, 20, 18, 'ne', 3));
  });
  it('at a ray crossing with NE and N both crossed, moves to a clear side', () => {
    const segs: Seg[] = [
      { a: { x: 300, y: 200 }, b: { x: 300, y: 400 } }, // vertical through the point (crosses N)
      { a: { x: 300, y: 300 }, b: { x: 400, y: 200 } }, // the NE ray
    ];
    const r = placeClear(anchor, 20, 18, 'ne', 3, segs, [], B);
    expect(hits(r, segs)).toBe(false);
    expect(placeLabel(anchor, 20, 18, 'ne', 3)).not.toEqual(r);
  });
  it('when everything is blocked returns the least-crossed side, inside the bounds', () => {
    const segs: Seg[] = [];
    for (let y = 0; y <= 700; y += 6) segs.push({ a: { x: 0, y }, b: { x: 1000, y } });
    const r = placeClear({ x: 2, y: 2 }, 30, 18, 'nw', 3, segs, [], B);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + r.w).toBeLessThanOrEqual(1000);
    expect(r.y + r.h).toBeLessThanOrEqual(700);
  });
});

import { inPoly, distToOutline, rectInPoly, shapesAt, type Outline } from '../../src/desk/nudge';
import { estimateTextBox } from '../../src/desk/nudge';

describe('placeClear: a point label goes outside the closed shape it sits on', () => {
  const ring = (cx: number, cy: number, rx: number, ry = rx, n = 64): Outline => Array.from({ length: n }, (_, i) => ({ x: cx + rx * Math.cos((i / n) * 2 * Math.PI), y: cy + ry * Math.sin((i / n) * 2 * Math.PI) }));
  const segsOf = (o: Outline): Seg[] => o.map((p, i) => ({ a: p, b: o[(i + 1) % o.length] }));
  const circle = ring(500, 350, 200);
  const { w, h } = estimateTextBox('A', 16);
  it('geometry: inside, distance to the edge, a rect reaching in', () => {
    expect(inPoly({ x: 500, y: 350 }, circle)).toBe(true);
    expect(inPoly({ x: 750, y: 350 }, circle)).toBe(false);
    expect(distToOutline({ x: 500, y: 350 }, circle)).toBeCloseTo(200, 0);
    expect(distToOutline({ x: 500, y: 550 }, circle)).toBeLessThan(1);
    expect(rectInPoly({ x: 490, y: 340, w: 20, h: 20 }, circle)).toBe(true); // fully inside
    expect(rectInPoly({ x: 690, y: 340, w: 30, h: 20 }, circle)).toBe(true); // across the edge
    expect(rectInPoly({ x: 720, y: 340, w: 30, h: 20 }, circle)).toBe(false);
    expect(shapesAt({ x: 500, y: 550 }, [circle], 15)).toHaveLength(1);
    expect(shapesAt({ x: 500, y: 350 }, [circle], 15)).toHaveLength(0); // the centre is not on it
  });
  it('a point at the bottom of a big circle: the NE label (inside, clear of the stroke) moves below it', () => {
    const anchor = { x: 500, y: 550 }, segs = segsOf(circle);
    const before = placeClear(anchor, w, h, 'ne', 3, segs, [], B); // without outlines: accepted inside
    expect(rectInPoly(before, circle)).toBe(true);
    const r = placeClear(anchor, w, h, 'ne', 3, segs, [], B, [circle]);
    expect(rectInPoly(r, circle)).toBe(false);
    expect(r.y).toBeGreaterThanOrEqual(550); // away from the interior: below
    expect(Math.hypot(r.x + r.w / 2 - anchor.x, r.y + r.h / 2 - anchor.y)).toBeLessThan(45); // still near its point
    expect(segs.some((s) => segHitsRect(s, r))).toBe(false);
  });
  it('around the circle, every label lands outside it and clear of its stroke', () => {
    for (let i = 0; i < 16; i++) {
      const t = (i / 16) * 2 * Math.PI, anchor = { x: 500 + 200 * Math.cos(t), y: 350 + 200 * Math.sin(t) };
      for (const dir of ['ne', 'n', 'sw', 'e'] as const) {
        const r = placeClear(anchor, w, h, dir, 3, segsOf(circle), [], B, [circle]);
        expect(rectInPoly(r, circle), `${i} ${dir}`).toBe(false);
      }
    }
  });
  it('the requested side is kept when it is already outside (unchanged output)', () => {
    const anchor = { x: 700, y: 350 };
    expect(placeClear(anchor, w, h, 'e', 3, segsOf(circle), [], B, [circle])).toEqual(placeClear(anchor, w, h, 'e', 3, segsOf(circle), [], B));
  });
  it('a box corner and a shade polygon; still clear of other ink', () => {
    const box: Outline = [{ x: 300, y: 200 }, { x: 600, y: 200 }, { x: 600, y: 450 }, { x: 300, y: 450 }];
    const other = { x: 600, y: 140, w: 60, h: 50 }; // something already drawn up and to the right
    const r = placeClear({ x: 600, y: 200 }, w, h, 'sw', 3, segsOf(box), [other], B, [box]);
    expect(rectInPoly(r, box)).toBe(false);
    expect(overlap(r, other)).toBe(0);
    const tri: Outline = [{ x: 100, y: 600 }, { x: 400, y: 600 }, { x: 250, y: 350 }];
    const r2 = placeClear({ x: 250, y: 600 }, w, h, 'n', 3, [], [], B, [tri]); // a shade has no strokes
    expect(rectInPoly(r2, tri)).toBe(false);
    expect(r2.y).toBeGreaterThanOrEqual(600);
  });
  it('a point deep inside (a centre) keeps its label inside', () => {
    const r = placeClear({ x: 500, y: 350 }, w, h, 'ne', 3, segsOf(circle), [], B, [circle]);
    expect(r).toEqual(placeLabel({ x: 500, y: 350 }, w, h, 'ne', 3));
  });
});
const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
