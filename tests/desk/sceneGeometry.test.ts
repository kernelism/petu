// Board v2 scene geometry: link routing, label placement, ribbons, placement by relation, lassos,
// brackets and the overview camera (all pure).
import { describe, expect, it } from 'vitest';
import { routeLink, crossing, placeLabel, ribbon, samples, at, type Route } from '../../src/desk/scene/route';
import { placeRel, type Box } from '../../src/desk/scene/place';
import { lassoPath, bracketPath } from '../../src/desk/scene/shapes';
import { overviewCam, ZOVER } from '../../src/desk/scene/camera';
import { parseTag } from '../../src/script/parseTag';

const hit = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
/** How far the control point sits from the chord's midpoint, relative to the chord. */
const bend = (q: Route) => Math.hypot(q.c.x - (q.a.x + q.b.x) / 2, q.c.y - (q.a.y + q.b.y) / 2) / Math.hypot(q.b.x - q.a.x, q.b.y - q.a.y);
const inPoly = (p: { x: number; y: number }, poly: { x: number; y: number }[]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};

describe('routeLink', () => {
  it('joins close neighbours in a row nearly straight (no stubby hump)', () => {
    const q = routeLink({ x: 0, y: 0, w: 80, h: 24 }, { x: 120, y: 4, w: 80, h: 24 }, [], 4, 3);
    expect(bend(q)).toBeLessThan(0.15);
    expect(q.a.x).toBeGreaterThan(80);
    expect(q.b.x).toBeLessThan(120);
  });

  it('arcs over a row when the things are far apart, the bend proportional (never towering)', () => {
    const q = routeLink({ x: 0, y: 100, w: 80, h: 24 }, { x: 600, y: 100, w: 80, h: 24 }, [], 4, 3);
    expect(q.c.y).toBeLessThan(100);
    // Apex height (half the control offset for a quadratic) at most 3.5 chip heights.
    expect(100 - at(q, 0.5).y).toBeLessThanOrEqual(24 * 3.5 + 4 + 0.01); // plus the end gap
  });

  it('bends around a thing that sits between its ends', () => {
    const a = { x: 0, y: 0, w: 60, h: 30 }, b = { x: 400, y: 0, w: 60, h: 30 }, block = { x: 180, y: -40, w: 100, h: 110 };
    const q = routeLink(a, b, [block], 4, 3);
    expect(crossing(q, [block], 3)).toBe(0);
  });

  it('keeps off another link when it can', () => {
    const a = { x: 0, y: 0, w: 60, h: 30 }, b = { x: 0, y: 300, w: 60, h: 30 };
    const straight = routeLink(a, b, [], 4, 3);
    const other = samples(straight, 16);
    const q = routeLink(a, b, [], 4, 3, [other]);
    expect(bend(q)).toBeGreaterThan(bend(straight));
  });
});

describe('placeLabel', () => {
  it('puts a label where it touches neither things nor the curve', () => {
    const q = routeLink({ x: 0, y: 0, w: 60, h: 30 }, { x: 300, y: 0, w: 60, h: 30 }, [], 4, 3);
    // Something sits right where the default spot (above the middle) would be.
    const mid = at(q, 0.5), blocker = { x: mid.x - 60, y: mid.y - 40, w: 120, h: 36 };
    const L = placeLabel(q, 50, 14, [blocker], 5);
    expect(hit(L, blocker)).toBe(false);
    for (const p of samples(q, 24)) expect(p.x > L.x && p.x < L.x + L.w && p.y > L.y && p.y < L.y + L.h).toBe(false);
  });

  it('keeps two labels on neighbouring links apart', () => {
    const q1 = routeLink({ x: 0, y: 0, w: 60, h: 30 }, { x: 300, y: 0, w: 60, h: 30 }, [], 4, 3);
    const L1 = placeLabel(q1, 60, 14, [], 5);
    const q2 = routeLink({ x: 0, y: 10, w: 60, h: 30 }, { x: 300, y: 10, w: 60, h: 30 }, [], 4, 3);
    const L2 = placeLabel(q2, 60, 14, [L1], 5);
    expect(hit(L1, L2)).toBe(false);
  });
});

describe('ribbon', () => {
  it('tapers toward its source and is capped at its head width', () => {
    const q: Route = { a: { x: 0, y: 0 }, c: { x: 100, y: 0 }, b: { x: 200, y: 0 } };
    const d = ribbon(q, 1, 4);
    const ys = [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
    const at0 = ys.filter((p) => Math.abs(p.x) < 1).map((p) => Math.abs(p.y));
    const at1 = ys.filter((p) => Math.abs(p.x - 200) < 1).map((p) => Math.abs(p.y));
    expect(Math.max(...at0)).toBeCloseTo(0.5, 1);
    expect(Math.max(...at1)).toBeCloseTo(2, 1);
    expect(d.endsWith('Z')).toBe(true);
  });
});

describe('placeRel', () => {
  it('prefers a spot whose line back to the anchor crosses nothing', () => {
    const anchor = { x: 0, y: 0, w: 80, h: 30 };
    // A wall right of the anchor: placing "right" would put the link through it.
    const wall = { x: 100, y: -200, w: 20, h: 430 };
    const r = placeRel(60, 30, 'near', anchor, [anchor, wall], { gap: 30, seed: 'x' });
    expect(hit(r, wall)).toBe(false);
    expect(r.x + r.w <= wall.x || r.x >= wall.x + wall.w || r.y + r.h <= wall.y || r.y >= wall.y + wall.h).toBe(true);
    const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    expect(c.x).toBeLessThan(wall.x); // below or left of the anchor, not across the wall
  });

  it('grows a scene that is already wider than the window downward', () => {
    const view = { x: 0, y: 0, w: 600, h: 800 };
    const row = [{ x: 0, y: 0, w: 260, h: 30 }, { x: 320, y: 0, w: 260, h: 30 }];
    const r = placeRel(80, 30, 'near', row[1], row, { gap: 30, seed: 's', view });
    expect(r.y).toBeGreaterThan(30);
  });

  it('starts an empty scene in from the window corner', () => {
    const r = placeRel(80, 30, null, null, [], { gap: 20, seed: 's', view: { x: 0, y: 0, w: 1000, h: 1000 } });
    expect(r.y).toBeGreaterThanOrEqual(140);
    expect(r.x).toBeGreaterThanOrEqual(80);
  });
});

describe('lassoPath', () => {
  it('encloses every member with air and is not a box', () => {
    const boxes = [{ x: 0, y: 0, w: 80, h: 30 }, { x: 140, y: 20, w: 80, h: 30 }, { x: 60, y: 90, w: 80, h: 30 }];
    const { pts, d } = lassoPath(boxes, 12, 'g');
    for (const b of boxes) for (const p of [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x, y: b.y + b.h }, { x: b.x + b.w, y: b.y + b.h }]) expect(inPoly(p, pts)).toBe(true);
    expect(d.startsWith('M')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect(pts.length).toBeGreaterThan(8);
  });

  it('is asymmetric and identical on replay (seeded)', () => {
    const boxes = [{ x: 0, y: 0, w: 100, h: 40 }];
    expect(lassoPath(boxes, 10, 'a').d).toBe(lassoPath(boxes, 10, 'a').d);
    expect(lassoPath(boxes, 10, 'a').d).not.toBe(lassoPath(boxes, 10, 'b').d);
  });

  it('a tighter outline nests inside a looser one', () => {
    const boxes = [{ x: 0, y: 0, w: 80, h: 30 }, { x: 120, y: 0, w: 80, h: 30 }];
    const outer = lassoPath(boxes, 30, 'o').pts, inner = lassoPath([boxes[1]], 10, 'i').pts;
    for (const p of inner) expect(inPoly(p, outer)).toBe(true);
  });
});

describe('bracketPath', () => {
  it('joins stacked things on their side, things in a row above or below', () => {
    expect(['right', 'left']).toContain(bracketPath({ x: 0, y: 0, w: 80, h: 30 }, { x: 0, y: 100, w: 80, h: 30 }, [], 20).side);
    expect(['above', 'below']).toContain(bracketPath({ x: 0, y: 0, w: 80, h: 30 }, { x: 200, y: 0, w: 80, h: 30 }, [], 20).side);
  });

  it('takes the side, and the spot for its label, that crosses no content', () => {
    const a = { x: 0, y: 0, w: 80, h: 30 }, b = { x: 0, y: 100, w: 80, h: 30 };
    const right = { x: 85, y: -20, w: 200, h: 170 };
    const br = bracketPath(a, b, [right], 20, { w: 60, h: 14 });
    expect(br.side).toBe('left');
    const above = { x: -50, y: -60, w: 400, h: 50 };
    const r2 = bracketPath({ x: 0, y: 0, w: 60, h: 30 }, { x: 200, y: 0, w: 60, h: 30 }, [above], 20, { w: 60, h: 14 });
    expect(r2.side).toBe('below');
  });
});

describe('overviewCam', () => {
  const win = { w: 700, h: 800, s: 0.7 };
  it('centres a small scene at zoom 1 (the composition uses the whole window)', () => {
    const ext = { x: 50, y: 40, w: 300, h: 200 };
    const c = overviewCam(ext, win);
    expect(c.z).toBe(1);
    const vw = win.w / win.s, vh = win.h / win.s;
    expect(c.x + vw / 2).toBeCloseTo(ext.x + ext.w / 2);
    expect(c.y + vh / 2).toBeCloseTo(ext.y + ext.h / 2);
  });

  it('zooms out to fit a large scene, never below the readable floor', () => {
    expect(overviewCam({ x: 0, y: 0, w: 1400, h: 900 }, win).z).toBeLessThan(1);
    expect(overviewCam({ x: 0, y: 0, w: 9000, h: 9000 }, win).z).toBe(ZOVER);
  });
});

describe('scene grammar: group, pair, merge, split', () => {
  it('parses each', () => {
    expect(parseTag('group on=s id=g of=a,b,f[2] "System 1"')).toMatchObject({ kind: 'group', of: ['a', 'b', 'f[2]'], text: 'System 1', region: 's', id: 'g' });
    expect(parseTag('pair on=s from=a to=b "equal and opposite"')).toMatchObject({ kind: 'pair', from: 'a', to: 'b', text: 'equal and opposite' });
    expect(parseTag('merge on=s id=m of=a,b "both" below=c')).toMatchObject({ kind: 'merge', of: ['a', 'b'], text: 'both', place: { rel: 'below', of: 'c' } });
    expect(parseTag('split id=a "x" "y"')).toEqual({ kind: 'split', ref: 'a', items: ['x', 'y'] });
  });

  it('rejects malformed ones', () => {
    for (const t of ['group on=s of=a,a', 'group on=s', 'group on=s of=a right=b', 'pair on=s from=a to=a', 'pair on=s from=a', 'merge on=s of=a "x"', 'merge on=s of=a,b', 'split id=a "x"', 'split "x" "y"', 'group p=3 of=a,b']) expect(parseTag(t), t).toBeNull();
  });
});
