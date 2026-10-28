// src/desk/nudge.ts
import type { SPt, SRect } from '../geometry/space';
import type { Compass } from '../script/types';

/** At most this many nudges, then accept (rule 5). */
export const MAX_NUDGES = 3;
/** Clearance kept from an obstacle after a nudge (target-space units). */
export const NUDGE_GAP = 4;
/** A label sits this far from its anchor, toward its compass direction. */
export const LABEL_OFFSET = 12;

const overlap = (a: SRect, b: SRect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

const clampTo = (r: SRect, b: SRect): SRect => ({
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
    for (const o of obstacles) { const a = overlap(r, o); if (a > most) { most = a; worst = o; } }
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
