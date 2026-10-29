// src/desk/nudge.ts
import type { SPt, SRect } from '../geometry/space';
import type { Compass } from '../script/types';

/** At most this many nudges, then accept (rule 5). */
export const MAX_NUDGES = 3;
/** Clearance kept from an obstacle after a nudge (target-space units). */
export const NUDGE_GAP = 4;
/** A label sits this far from its anchor, toward its compass direction. */
export const LABEL_OFFSET = 12;

export const overlapArea = (a: SRect, b: SRect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

export const clampTo = (r: SRect, b: SRect): SRect => ({
  ...r,
  x: Math.min(Math.max(r.x, b.x), b.x + b.w - r.w),
  y: Math.min(Math.max(r.y, b.y), b.y + b.h - r.h),
});

/**
 * Moves `box` off the obstacle it overlaps most, along the axis that needs the smallest move,
 * up to MAX_NUDGES times, staying inside `bounds`. Then accepts wherever it is.
 */
export function nudge(box: SRect, obstacles: SRect[], bounds: SRect): SRect {
  let r = clampTo(box, bounds);
  for (let n = 0; n < MAX_NUDGES; n++) {
    let worst: SRect | null = null, most = 0;
    for (const o of obstacles) { const a = overlapArea(r, o); if (a > most) { most = a; worst = o; } }
    if (!worst) return r;
    const o = worst;
    const moves = [
      { dx: o.x - (r.x + r.w) - NUDGE_GAP, dy: 0 },
      { dx: o.x + o.w - r.x + NUDGE_GAP, dy: 0 },
      { dx: 0, dy: o.y - (r.y + r.h) - NUDGE_GAP },
      { dx: 0, dy: o.y + o.h - r.y + NUDGE_GAP },
    ].sort((a, b) => Math.abs(a.dx) + Math.abs(a.dy) - (Math.abs(b.dx) + Math.abs(b.dy)));
    // The smallest move that stays inside the bounds; if none does, the smallest one, clamped.
    const inside = moves.find((m) => {
      const c = { ...r, x: r.x + m.dx, y: r.y + m.dy };
      return c.x >= bounds.x && c.y >= bounds.y && c.x + c.w <= bounds.x + bounds.w && c.y + c.h <= bounds.y + bounds.h;
    }) ?? moves[0];
    r = clampTo({ ...r, x: r.x + inside.dx, y: r.y + inside.dy }, bounds);
  }
  return r;
}

const DIRS: Record<Compass, SPt> = {
  n: { x: 0, y: -1 }, ne: { x: 1, y: -1 }, e: { x: 1, y: 0 }, se: { x: 1, y: 1 },
  s: { x: 0, y: 1 }, sw: { x: -1, y: 1 }, w: { x: -1, y: 0 }, nw: { x: -1, y: -1 },
};

/**
 * Where a w × h label box goes for an anchor and a compass direction: offset by LABEL_OFFSET
 * (and `clear`, the anchor's own radius) toward `dir`, aligned so the box grows away from the anchor.
 */
export function placeLabel(anchor: SPt, w: number, h: number, dir: Compass = 'ne', clear = 0): SRect {
  const d = DIRS[dir];
  const off = LABEL_OFFSET + clear;
  const k = d.x && d.y ? Math.SQRT1_2 : 1;
  const cx = anchor.x + d.x * off * k, cy = anchor.y + d.y * off * k;
  const x = d.x > 0 ? cx : d.x < 0 ? cx - w : cx - w / 2;
  const y = d.y > 0 ? cy : d.y < 0 ? cy - h : cy - h / 2;
  return { x, y, w, h };
}

/** A label's box before it is rendered: ~0.56 em per character, 1.2 em tall (jsdom has no getBBox). */
export function estimateTextBox(text: string, size: number): { w: number; h: number } {
  return { w: Math.max(1, Array.from(text).length) * size * 0.56, h: size * 1.2 };
}

/** Segments of the target's strokes (registry entries' `strokes`), for exact label tests. */
export type Seg = { a: SPt; b: SPt };
/** Does segment s cross or touch rect r (padded by `pad`)? Liang–Barsky clip. */
export function segHitsRect(s: Seg, r: SRect, pad = 2): boolean {
  const x0 = r.x - pad, y0 = r.y - pad, x1 = r.x + r.w + pad, y1 = r.y + r.h + pad;
  let t0 = 0, t1 = 1;
  const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
    return true;
  };
  return clip(-dx, s.a.x - x0) && clip(dx, x1 - s.a.x) && clip(-dy, s.a.y - y0) && clip(dy, y1 - s.a.y);
}
const ORDER: Record<Compass, Compass[]> = {
  n: ['n', 'ne', 'nw', 'e', 'w', 'se', 'sw', 's'], ne: ['ne', 'n', 'e', 'nw', 'se', 'w', 's', 'sw'],
  e: ['e', 'ne', 'se', 'n', 's', 'nw', 'sw', 'w'], se: ['se', 'e', 's', 'ne', 'sw', 'n', 'w', 'nw'],
  s: ['s', 'se', 'sw', 'e', 'w', 'ne', 'nw', 'n'], sw: ['sw', 's', 'w', 'se', 'nw', 'e', 'n', 'ne'],
  w: ['w', 'sw', 'nw', 's', 'n', 'se', 'ne', 'e'], nw: ['nw', 'w', 'n', 'sw', 'ne', 's', 'e', 'se'],
};
/** A closed shape's outline (a circle's or box's stroke, a shade's polygon), target space. */
export type Outline = SPt[];

/** Is p inside the closed polygon (even-odd)? */
export function inPoly(p: SPt, poly: Outline): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Distance from p to the polygon's boundary (its closing edge included). */
export function distToOutline(p: SPt, poly: Outline): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i], dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

/** Does rect r reach into the polygon's interior (a corner or its centre inside, a vertex inside it, or an edge through it)? */
export function rectInPoly(r: SRect, poly: Outline): boolean {
  const pts = [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x, y: r.y + r.h }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x + r.w / 2, y: r.y + r.h / 2 }];
  if (pts.some((p) => inPoly(p, poly))) return true;
  if (poly.some((p) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h)) return true;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if (segHitsRect({ a: poly[j], b: poly[i] }, r, 0)) return true;
  return false;
}

/**
 * The closed shapes a point label is about: those the anchor sits on, or inside or outside of
 * within `tol` of their edge (a point on a circle, a corner of a box). A point deep inside a shape
 * (a centre) is not on it: its label may stay inside.
 */
export function shapesAt(anchor: SPt, outlines: Outline[], tol: number): Outline[] {
  return outlines.filter((o) => o.length >= 3 && distToOutline(anchor, o) <= tol);
}

/** The compass direction closest to a vector (y down). */
function compassOf(v: SPt): Compass {
  const dirs: Compass[] = ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'];
  const a = Math.atan2(v.y, v.x);
  return dirs[(Math.round(a / (Math.PI / 4)) + 8) % 8];
}

/**
 * The requested side if it is clear of every stroke and box; else the nearest clear compass side
 * (at 1× then 1.8× the offset); else the least-bad side, nudged. Labels stay inside `bounds`.
 * `outlines`: closed shapes on the target. When the anchor sits on one (shapesAt), its label goes
 * outside it: a side that reaches into the shape is not clear, and the fallback sides start from
 * the one pointing away from the shape's interior. `labels` (other labels) are as hard as strokes; with
 * any, the search reaches farther out before settling for the least-bad side.
 */
export function placeClear(anchor: SPt, w: number, h: number, dir: Compass, clear: number, segs: Seg[], boxes: SRect[], bounds: SRect, outlines: Outline[] = [], labels: SRect[] = []): SRect {
  const on = shapesAt(anchor, outlines, LABEL_OFFSET + clear);
  // `labels`: other labels' boxes. Text on text is as unreadable as text on a stroke.
  // Text on text is never accepted while any spot is free of it: a label on another costs more than any number of strokes crossed.
  const cost = (r: SRect) => labels.filter((o) => overlapArea(r, o) > 0).length * 1e12 + segs.filter((s) => segHitsRect(s, r)).length * 1e6 + on.filter((o) => rectInPoly(r, o)).length * 1e6 + boxes.reduce((n, o) => n + overlapArea(r, o), 0);
  let order = ORDER[dir];
  if (on.length) {
    // Away from the interior: from the shapes' centre (their vertices' mean) through the anchor.
    const pts = on.flat(), cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const out = Math.hypot(anchor.x - cx, anchor.y - cy) > 1e-6 ? compassOf({ x: anchor.x - cx, y: anchor.y - cy }) : dir;
    order = [dir, ...ORDER[out].filter((d) => d !== dir)];
  }
  let best: SRect | null = null, bestCost = Infinity;
  for (const k of on.length || labels.length ? [1, 1.8, 2.6, 3.4] : [1, 1.8]) for (const d of order) {
    const r = clampTo(placeLabel(anchor, w, h, d, clear + (k - 1) * LABEL_OFFSET), bounds);
    const c = cost(r);
    if (c === 0) return r;
    if (c < bestCost) { bestCost = c; best = r; }
  }
  // Still on another label: farther out (to 6× the offset) for the nearest spot free of labels.
  for (let k = 4.2; bestCost >= 1e12 && k <= 6; k += 0.8) for (const d of order) {
    const r = clampTo(placeLabel(anchor, w, h, d, clear + (k - 1) * LABEL_OFFSET), bounds);
    const c = cost(r);
    if (c < bestCost) { bestCost = c; best = r; }
  }
  // The nudge moves off boxes only: it never pushes a label onto another one.
  const n = nudge(best!, boxes, bounds);
  return labels.some((o) => overlapArea(n, o) > 0) && !labels.some((o) => overlapArea(best!, o) > 0) ? best! : n;
}
