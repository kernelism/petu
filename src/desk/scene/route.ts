// src/desk/scene/route.ts
/**
 * Routes a connection between two things on the board (spec "Board v2" 2). Pure.
 * A connection is one quadratic curve from the edge of one box to the edge of the other. Things in
 * one row are joined by an arc over the row (or under it), its height growing with the distance, so
 * a fan of links from one thing reads like a hand-drawn diagram; anything else bends to whichever
 * side crosses the least content. Ends stop a little short of the boxes.
 */
import type { Box } from './place';

export type P = { x: number; y: number };
export type Route = { a: P; c: P; b: P };

const inside = (p: P, r: Box, pad: number) => p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;
export const at = (q: Route, t: number): P => ({
  x: (1 - t) ** 2 * q.a.x + 2 * (1 - t) * t * q.c.x + t * t * q.b.x,
  y: (1 - t) ** 2 * q.a.y + 2 * (1 - t) * t * q.c.y + t * t * q.b.y,
});
/** The curve's direction at t (unnormalised). */
export const dirAt = (q: Route, t: number): P => ({ x: 2 * (1 - t) * (q.c.x - q.a.x) + 2 * t * (q.b.x - q.c.x), y: 2 * (1 - t) * (q.c.y - q.a.y) + 2 * t * (q.b.y - q.c.y) });

/** Where the ray from a box's centre toward `to` leaves the box (plus `gap`). */
function exitPoint(r: Box, to: P, gap: number): P {
  const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  const dx = to.x - c.x, dy = to.y - c.y;
  if (!dx && !dy) return c;
  const tx = dx ? (r.w / 2 + gap) / Math.abs(dx) : Infinity, ty = dy ? (r.h / 2 + gap) / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty);
  return { x: c.x + dx * t, y: c.y + dy * t };
}

/** How much of the curve runs through content (samples inside obstacles). */
function cost(q: Route, obstacles: Box[], pad: number): number {
  let n = 0;
  for (let i = 2; i <= 22; i++) { const p = at(q, i / 24); for (const o of obstacles) if (inside(p, o, pad)) { n++; break; } }
  return n;
}

/**
 * The route from box `a` to box `b`, clear of `obstacles` (the ends' own boxes excluded by the
 * caller) as far as a single bend allows. `gap`: air at the ends; `pad`: clearance from content.
 */
export function routeLink(a: Box, b: Box, obstacles: Box[], gap: number, pad: number): Route {
  const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 }, cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const dx = cb.x - ca.x, dy = cb.y - ca.y;
  const cands: { q: Route; pref: number }[] = [];
  const sameRow = Math.abs(dy) < Math.max(a.h, b.h) * 0.6 && Math.abs(dx) > (a.w + b.w) / 2;
  if (sameRow) {
    // An arc over the row (preferred) or under it, from the facing top (bottom) edges.
    for (const s of [-1, 1]) {
      const ya = s < 0 ? a.y - gap : a.y + a.h + gap, yb = s < 0 ? b.y - gap : b.y + b.h + gap;
      const xa = ca.x + Math.sign(dx) * a.w * 0.18, xb = cb.x - Math.sign(dx) * b.w * 0.18;
      const lift = Math.min(Math.abs(xb - xa) * 0.42, Math.abs(xb - xa) * 0.18 + Math.max(a.h, b.h) * 2.2) + Math.max(a.h, b.h) * 0.4;
      cands.push({ q: { a: { x: xa, y: ya }, c: { x: (xa + xb) / 2, y: (ya + yb) / 2 + s * lift }, b: { x: xb, y: yb } }, pref: s < 0 ? 0 : 0.6 });
    }
  }
  const pa = exitPoint(a, cb, gap), pb = exitPoint(b, ca, gap);
  const L = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1;
  const n = { x: -(pb.y - pa.y) / L, y: (pb.x - pa.x) / L };
  for (const k of [0.12, -0.12, 0, 0.28, -0.28, 0.45, -0.45]) {
    const m = { x: (pa.x + pb.x) / 2 + n.x * k * L, y: (pa.y + pb.y) / 2 + n.y * k * L };
    // Re-aim the ends at the control point so a bent link leaves its box on the bent side.
    const qa = exitPoint(a, m, gap), qb = exitPoint(b, m, gap);
    cands.push({ q: { a: qa, c: m, b: qb }, pref: (sameRow ? 1 : 0) + Math.abs(k) * 1.5 + (k === 0 ? 0.25 : 0) });
  }
  let best = cands[0], bc = Infinity;
  for (const c of cands) { const v = cost(c.q, obstacles, pad) * 3 + c.pref; if (v < bc) { bc = v; best = c; } }
  return best.q;
}

/** The curve as an SVG path. */
export const pathD = (q: Route) => `M${q.a.x.toFixed(2)} ${q.a.y.toFixed(2)} Q${q.c.x.toFixed(2)} ${q.c.y.toFixed(2)} ${q.b.x.toFixed(2)} ${q.b.y.toFixed(2)}`;

/** Sample points along the curve (for collision boxes). */
export const samples = (q: Route, n = 12): P[] => Array.from({ length: n + 1 }, (_, i) => at(q, i / n));
