/**
 * Routes a connection between two things on the board (spec "Board v2" 2). Pure.
 * A connection is one quadratic curve from the edge of one box to the edge of the other. Its bend is
 * proportional to its length (a short link is nearly straight, a long one arcs gently), and it bends
 * to whichever side crosses the least content: things in one row are joined over the row (or under
 * it), anything else by a curve that swings clear of what lies between. Ends stop a little short of
 * the boxes. Labels go where they touch nothing (placeLabel); a weighted link is a ribbon that tapers
 * toward its source, never thicker than a capped width (ribbon).
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

const N = 32;
/** How much of the curve runs through content: the share of samples inside an obstacle (0–1). */
export function crossing(q: Route, obstacles: Box[], pad: number): number {
  let n = 0;
  for (let i = 1; i < N; i++) { const p = at(q, i / N); for (const o of obstacles) if (inside(p, o, pad)) { n++; break; } }
  return n / (N - 1);
}

/** The curve's length (sampled). */
export function length(q: Route): number {
  let L = 0, p = q.a;
  for (let i = 1; i <= 16; i++) { const r = at(q, i / 16); L += Math.hypot(r.x - p.x, r.y - p.y); p = r; }
  return L;
}

/**
 * The route from box `a` to box `b`, clear of `obstacles` (the ends' own boxes excluded by the
 * caller) as far as a single bend allows. `gap`: air at the ends; `pad`: clearance from content.
 * `avoid`: other links' paths (sampled points) it should not run along or cross if it can help it.
 */
export function routeLink(a: Box, b: Box, obstacles: Box[], gap: number, pad: number, avoid: P[][] = [], arc = false): Route {
  const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 }, cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const dx = cb.x - ca.x, dy = cb.y - ca.y;
  const cands: { q: Route; pref: number }[] = [];
  const hMax = Math.max(a.h, b.h);
  // In one row and far apart (a fan, a long hop over things between): an arc. Close neighbours are
  // joined nearly straight, whatever row they share.
  const facing = Math.abs(dx) - (a.w + b.w) / 2;
  // `arc`: the caller needs room over the link (its label does not fit beside a short straight one).
  const sameRow = Math.abs(dy) < hMax * 0.6 && facing > (arc ? 0 : hMax * 3);
  if (sameRow) {
    // Over the row (preferred) or under it, from the facing top (bottom) edges; the lift grows with
    // the span (proportional), so a short hop is a low arc and a long one never towers.
    for (const s of [-1, 1]) {
      const ya = s < 0 ? a.y - gap : a.y + a.h + gap, yb = s < 0 ? b.y - gap : b.y + b.h + gap;
      const xa = ca.x + Math.sign(dx) * a.w * 0.22, xb = cb.x - Math.sign(dx) * b.w * 0.22;
      const span = Math.abs(xb - xa);
      for (const [f, p] of [[0.22, 0], [0.34, 0.5], [0.5, 1.1]] as const) {
        const lift = Math.max(hMax * 0.5, Math.min(span * f, hMax * 3.5));
        cands.push({ q: { a: { x: xa, y: ya }, c: { x: (xa + xb) / 2, y: (ya + yb) / 2 + s * lift * 2 }, b: { x: xb, y: yb } }, pref: 0.1 + p + (s < 0 ? 0 : 0.9) });
      }
    }
  }
  const pa = exitPoint(a, cb, gap), pb = exitPoint(b, ca, gap);
  const L = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1;
  const n = { x: -(pb.y - pa.y) / L, y: (pb.x - pa.x) / L };
  // A gentle, length-proportional bend first (hand-drawn, not ruled); wider swings only to clear content.
  for (const k of [0.1, -0.1, 0, 0.2, -0.2, 0.32, -0.32, 0.48, -0.48, 0.7, -0.7]) {
    const m = { x: (pa.x + pb.x) / 2 + n.x * k * L, y: (pa.y + pb.y) / 2 + n.y * k * L };
    // Re-aim the ends at the control point so a bent link leaves its box on the bent side.
    const qa = exitPoint(a, m, gap), qb = exitPoint(b, m, gap);
    cands.push({ q: { a: qa, c: m, b: qb }, pref: (sameRow ? 0.4 : 0) + Math.abs(k) * 1.6 + (k === 0 ? 0.15 : 0) });
  }
  const near = (q: Route) => {
    if (!avoid.length) return 0;
    let hits = 0;
    const r = pad * 2.5;
    for (let i = 2; i < N - 1; i += 2) { const p = at(q, i / N); if (avoid.some((path) => path.some((s) => Math.abs(s.x - p.x) < r && Math.abs(s.y - p.y) < r))) hits++; }
    return hits / (N / 2);
  };
  let best = cands[0], bc = Infinity;
  for (const c of cands) { const v = crossing(c.q, obstacles, pad) * 40 + near(c.q) * 4 + c.pref; if (v < bc) { bc = v; best = c; } }
  return best.q;
}

/** The curve as an SVG path. */
export const pathD = (q: Route) => `M${q.a.x.toFixed(2)} ${q.a.y.toFixed(2)} Q${q.c.x.toFixed(2)} ${q.c.y.toFixed(2)} ${q.b.x.toFixed(2)} ${q.b.y.toFixed(2)}`;

/** Sample points along the curve (for collision boxes). */
export const samples = (q: Route, n = 12): P[] => Array.from({ length: n + 1 }, (_, i) => at(q, i / n));

const area = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/**
 * Where a w × h label for route `q` goes (its box): beside the curve near its middle, on the side and
 * at the point where it touches nothing in `taken` (things, other labels) and not the curve itself.
 * The outer side of a bend is preferred (the label reads with the arc); then above; then nearer an end.
 */
export function placeLabel(q: Route, w: number, h: number, taken: Box[], gap: number): Box {
  const bend = { x: q.c.x - (q.a.x + q.b.x) / 2, y: q.c.y - (q.a.y + q.b.y) / 2 };
  const path = samples(q, 24).map((p) => ({ x: p.x - gap * 0.3, y: p.y - gap * 0.3, w: gap * 0.6, h: gap * 0.6 }));
  let best: { b: Box; cost: number } | null = null;
  for (const [t, tp] of [[0.5, 0], [0.4, 0.3], [0.6, 0.3], [0.3, 0.7], [0.7, 0.7], [0.22, 1.2], [0.78, 1.2]] as const) {
    const p = at(q, t), d = dirAt(q, t), dn = Math.hypot(d.x, d.y) || 1;
    const nx = -d.y / dn, ny = d.x / dn;
    for (const s of [1, -1]) {
      const ox = nx * s, oy = ny * s;
      // Distance from the curve to the label's centre: half its extent along the normal, plus air.
      const off = Math.abs(ox) * w / 2 + Math.abs(oy) * h / 2 + gap * 0.55;
      const b = { x: p.x + ox * off - w / 2, y: p.y + oy * off - h / 2, w, h };
      const outer = ox * bend.x + oy * bend.y > 0 ? 0 : 0.4, up = oy < 0 ? 0 : 0.2;
      const hit = [...taken, ...path].reduce((acc, r) => acc + area(b, r), 0) / Math.max(1, w * h);
      const cost = hit * 50 + tp + outer + up;
      if (!best || cost < best.cost) best = { b, cost };
    }
  }
  return best!.b;
}

/**
 * A weighted link as a filled ribbon: `w1` wide at the head end, tapering to `w0` at the source,
 * ending `stop` short of the tip (the arrowhead covers the rest), drawn up to `upto` (0–1, tracing).
 */
export function ribbon(q: Route, w0: number, w1: number, stop = 0, upto = 1): string {
  const L = length(q) || 1, tEnd = Math.max(0, Math.min(1, 1 - stop / L)) * upto;
  const n = 24, l: P[] = [], r: P[] = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * tEnd, p = at(q, t), d = dirAt(q, t), dn = Math.hypot(d.x, d.y) || 1;
    const w = (w0 + (w1 - w0) * (t / Math.max(1e-6, 1 - stop / L))) / 2;
    l.push({ x: p.x - (d.y / dn) * w, y: p.y + (d.x / dn) * w });
    r.push({ x: p.x + (d.y / dn) * w, y: p.y - (d.x / dn) * w });
  }
  const pts = [...l, ...r.reverse()];
  return `M${pts.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' L')}Z`;
}
