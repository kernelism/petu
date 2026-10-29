/**
 * Board v2 outlines (spec "Board v2" 4). Pure.
 * - lasso: a loose closed curve around a set of boxes (a system boundary). It hugs the set's convex
 *   outline with air that varies around the loop (seeded by id: asymmetric, hand-drawn, identical on
 *   replay), never a box.
 * - bracket: a square bracket joining two boxes on the side that crosses the least content, with its
 *   label beside the spine.
 */
import { hash01, type Box } from './place';
import type { P } from './route';

/** Convex hull (monotone chain), counter-clockwise in screen coordinates. */
export function hull(ps: P[]): P[] {
  const pts = [...ps].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o: P, a: P, b: P) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo: P[] = [], up: P[] = [];
  for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of pts.slice().reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

/**
 * A lasso around `boxes`: every box lies inside it with at least `pad` air. Returns the closed path
 * (cubic Béziers through the loop's points, Catmull-Rom), its points, and where its label goes (just
 * outside the loop's top edge, left of centre).
 */
export function lassoPath(boxes: Box[], pad: number, seed: string): { d: string; pts: P[]; label: P; bbox: Box } {
  // Each box as a rounded ring of points (corners pulled in, edge middles out): the hull of them is a soft outline.
  const ring: P[] = [];
  boxes.forEach((b, i) => {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2, rx = b.w / 2 + pad, ry = b.h / 2 + pad;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      // A superellipse (n = 4): close to the box at its corners, round between them.
      const c = Math.cos(a), s = Math.sin(a);
      const e = 0.5;
      const jitter = 1 + 0.18 * (hash01(`${seed}:${i}:${k}`) - 0.3);
      ring.push({ x: cx + rx * Math.sign(c) * Math.abs(c) ** e * jitter, y: cy + ry * Math.sign(s) * Math.abs(s) ** e * jitter });
    }
  });
  let h = hull(ring);
  // Thin the loop to an even spacing so the spline reads as one stroke, not a polygon.
  const segL = h.map((p, i) => Math.hypot(h[(i + 1) % h.length].x - p.x, h[(i + 1) % h.length].y - p.y));
  const per = segL.reduce((s, x) => s + x, 0);
  const M = Math.max(12, Math.min(40, Math.round(per / Math.max(1e-6, pad * 1.1))));
  const even: P[] = [];
  for (let k = 0, i = 0, start = 0; k < M; k++) {
    const dist = (k / M) * per;
    while (i < h.length - 1 && start + segL[i] < dist) { start += segL[i]; i++; }
    const a = h[i], b = h[(i + 1) % h.length], t = segL[i] ? (dist - start) / segL[i] : 0;
    even.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  h = even;
  const n = h.length;
  let d = `M${h[0].x.toFixed(2)} ${h[0].y.toFixed(2)}`;
  for (let i = 0; i < n; i++) {
    const p0 = h[(i - 1 + n) % n], p1 = h[i], p2 = h[(i + 1) % n], p3 = h[(i + 2) % n];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 }, c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C${c1.x.toFixed(2)} ${c1.y.toFixed(2)} ${c2.x.toFixed(2)} ${c2.y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  const xs = h.map((p) => p.x), ys = h.map((p) => p.y);
  const bbox = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  // The label: over the loop's top edge, a third of the way across (asymmetric; reads as a name tag).
  const lx = bbox.x + bbox.w * 0.3;
  const top = h.filter((p) => Math.abs(p.x - lx) < bbox.w * 0.2).reduce((m, p) => Math.min(m, p.y), bbox.y);
  return { d: d + 'Z', pts: h, label: { x: lx, y: top }, bbox };
}

export type Side = 'right' | 'left' | 'above' | 'below';

const hits = (r: Box, obstacles: Box[]) => obstacles.reduce((s, o) => s + Math.max(0, Math.min(r.x + r.w, o.x + o.w) - Math.max(r.x, o.x)) * Math.max(0, Math.min(r.y + r.h, o.y + o.h) - Math.max(r.y, o.y)), 0);

/**
 * A bracket joining boxes `a` and `b`: short ticks out of each box's facing side to a spine `gap`
 * beyond the further of the two, with the label's anchor beside the spine's middle. The spine runs on
 * the side across their separation (stacked things are joined on their right or left; things in a row
 * above or below), whichever crosses less content.
 */
export function bracketPath(a: Box, b: Box, obstacles: Box[], gap: number, lab?: { w: number; h: number }): { pts: P[]; label: P; side: Side; rail: Box } {
  const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 }, cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const stacked = Math.abs(cb.y - ca.y) > Math.abs(cb.x - ca.x);
  const sides: Side[] = stacked ? ['right', 'left'] : ['above', 'below'];
  let best: { pts: P[]; label: P; side: Side; rail: Box; cost: number } | null = null;
  for (const side of sides) {
    let pts: P[], label: P, rail: Box;
    if (side === 'right' || side === 'left') {
      const s = side === 'right' ? 1 : -1;
      const ex = (r: Box) => (s > 0 ? r.x + r.w + gap * 0.3 : r.x - gap * 0.3);
      const X = s > 0 ? Math.max(a.x + a.w, b.x + b.w) + gap : Math.min(a.x, b.x) - gap;
      pts = [{ x: ex(a), y: ca.y }, { x: X, y: ca.y }, { x: X, y: cb.y }, { x: ex(b), y: cb.y }];
      label = { x: X + s * gap * 0.5, y: (ca.y + cb.y) / 2 };
      rail = { x: Math.min(X, ex(a), ex(b)), y: Math.min(ca.y, cb.y), w: Math.abs(X - (s > 0 ? Math.min(ex(a), ex(b)) : Math.max(ex(a), ex(b)))), h: Math.abs(cb.y - ca.y) };
    } else {
      const s = side === 'below' ? 1 : -1;
      const ey = (r: Box) => (s > 0 ? r.y + r.h + gap * 0.3 : r.y - gap * 0.3);
      const Y = s > 0 ? Math.max(a.y + a.h, b.y + b.h) + gap : Math.min(a.y, b.y) - gap;
      pts = [{ x: ca.x, y: ey(a) }, { x: ca.x, y: Y }, { x: cb.x, y: Y }, { x: cb.x, y: ey(b) }];
      label = { x: (ca.x + cb.x) / 2, y: Y + s * gap * 0.6 };
      rail = { x: Math.min(ca.x, cb.x), y: Math.min(Y, ey(a), ey(b)), w: Math.abs(cb.x - ca.x), h: Math.abs(Y - (s > 0 ? Math.min(ey(a), ey(b)) : Math.max(ey(a), ey(b)))) };
    }
    const railCost = hits({ ...rail, x: rail.x - 1, y: rail.y - 1, w: rail.w + 2, h: rail.h + 2 }, obstacles) + (side === sides[0] ? 0 : 1);
    // The label slides along the spine (middle first) to where it touches nothing.
    const along = side === 'right' || side === 'left' ? [0, -0.3, 0.3] : [0, -0.32, 0.32, -0.5, 0.5];
    for (const f of along) {
      const L = side === 'right' || side === 'left' ? { x: label.x, y: label.y + f * Math.abs(cb.y - ca.y) } : { x: label.x + f * Math.max(Math.abs(cb.x - ca.x), lab?.w ?? 0), y: label.y };
      const box = lab ? (side === 'right' ? { x: L.x, y: L.y - lab.h / 2, ...lab } : side === 'left' ? { x: L.x - lab.w, y: L.y - lab.h / 2, ...lab } : { x: L.x - lab.w / 2, y: L.y - lab.h / 2, ...lab }) : null;
      const cost = railCost + (box ? (hits(box, obstacles) / Math.max(1, box.w * box.h)) * 20 : 0) + Math.abs(f) * 0.6;
      if (!best || cost < best.cost) best = { pts, label: L, side, rail, cost };
    }
  }
  return best!;
}
