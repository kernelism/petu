// src/ink/student/gesture.ts — what a student's stroke means (spec "Student ink"): a gesture adds
// meaning, never alters the ink. Pure: points in the stroke's own isotropic units (a page's 0–1000
// across, y in the same units; a board section's units), no DOM, no subject.

export type Pt = { x: number; y: number };

/** The shape of one stroke. */
export type Shape =
  | { kind: 'dot' }
  | { kind: 'loop' }
  /** Straight; `flat`: within ~27° of horizontal (an underline). */
  | { kind: 'line'; flat: boolean }
  /** Shaft and head in one stroke: from the start to the tip. */
  | { kind: 'arrow'; from: Pt; to: Pt }
  /** A "V" (a head drawn on its own): its vertex. */
  | { kind: 'chevron'; tip: Pt }
  /** A question mark's curl (its dot may follow as a second stroke). */
  | { kind: 'hook' }
  | { kind: 'scribble' };

/** What a mark means: circle/lasso = this; underline = this phrase or line; arrow = a relation; ? = confused here; else a note. */
export type MarkKind = 'circle' | 'underline' | 'arrow' | 'confused' | 'note';

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
export const pathLen = (p: Pt[]) => { let l = 0; for (let i = 1; i < p.length; i++) l += dist(p[i - 1], p[i]); return l; };
export function bbox(p: Pt[]) {
  const xs = p.map((q) => q.x), ys = p.map((q) => q.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** `n` points evenly spaced along the path (angles and turning read the same at any pen speed). */
export function resample(p: Pt[], n = 32): Pt[] {
  if (p.length < 2) return p.slice();
  const L = pathLen(p);
  if (L === 0) return [p[0]];
  const step = L / (n - 1), out: Pt[] = [p[0]];
  let acc = 0;
  for (let i = 1; i < p.length && out.length < n; i++) {
    let a = p[i - 1];
    const b = p[i];
    let d = dist(a, b);
    while (acc + d >= step && out.length < n) {
      const t = (step - acc) / d;
      a = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
      out.push(a);
      d = dist(a, b);
      acc = 0;
    }
    acc += d;
  }
  while (out.length < n) out.push(p[p.length - 1]);
  return out;
}

/** Max distance of any point from the chord a→b, as a share of the chord. */
function bend(p: Pt[], a: Pt, b: Pt): number {
  const L = dist(a, b) || 1;
  let m = 0;
  for (const q of p) m = Math.max(m, Math.abs((b.x - a.x) * (a.y - q.y) - (a.x - q.x) * (b.y - a.y)) / L);
  return m / L;
}

/** Cumulative signed turning (radians) along resampled points; positive = clockwise on screen (y down). */
function turning(r: Pt[]): number[] {
  const out = [0];
  let acc = 0;
  for (let i = 2; i < r.length; i++) {
    const ax = r[i - 1].x - r[i - 2].x, ay = r[i - 1].y - r[i - 2].y;
    const bx = r[i].x - r[i - 1].x, by = r[i].y - r[i - 1].y;
    if ((!ax && !ay) || (!bx && !by)) { out.push(acc); continue; }
    acc += Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
    out.push(acc);
  }
  return out;
}

/** A dot is this small (units across; a page is 1000). */
export const DOT = 9;

/** The shape of one stroke. */
export function shapeOf(pts: Pt[]): Shape {
  if (!pts.length) return { kind: 'scribble' };
  const b = bbox(pts), span = Math.max(b.w, b.h), L = pathLen(pts);
  if (span <= DOT && L <= 3 * DOT) return { kind: 'dot' };
  const a = pts[0], z = pts[pts.length - 1];
  // A loop closes on itself (src/agent/moment.ts isLoop: ends within 25% of its length).
  if (pts.length >= 6 && L > 40 && span > 12 && dist(a, z) <= 0.25 * L) return { kind: 'loop' };
  const chord = dist(a, z);
  // Straight and never doubling back (a one-stroke arrow's head would otherwise pass as a bend < 10%).
  if (chord >= 15 && L <= 1.2 * chord && bend(pts, a, z) < 0.1) return { kind: 'line', flat: Math.abs(z.y - a.y) < 0.5 * Math.abs(z.x - a.x) };
  const r = resample(pts, 40);
  // One-stroke arrow: a straight shaft to the point farthest from the start, then a short head back.
  let k = 0;
  for (let i = 1; i < r.length; i++) if (dist(r[i], r[0]) > dist(r[k], r[0])) k = i;
  const shaft = dist(r[0], r[k]);
  const after = pathLen(r.slice(k));
  if (k >= 8 && k < r.length - 1 && shaft >= 30 && bend(r.slice(0, k + 1), r[0], r[k]) < 0.12 && after >= 0.08 * shaft && after <= 0.9 * shaft) {
    // The head turns back sharply (> 110° from the shaft's direction) and stays near the tip.
    const sx = (r[k].x - r[0].x) / shaft, sy = (r[k].y - r[0].y) / shaft;
    const q = r[Math.min(r.length - 1, k + 2)];
    const hx = q.x - r[k].x, hy = q.y - r[k].y, hl = Math.hypot(hx, hy) || 1;
    const back = (sx * hx + sy * hy) / hl;
    if (back < -0.34 && r.slice(k).every((p) => dist(p, r[k]) <= 0.5 * shaft)) return { kind: 'arrow', from: r[0], to: r[k] };
  }
  // A chevron: two straight legs meeting at a vertex, at 20°–130°.
  {
    let v = 0, vd = 0;
    for (let i = 1; i < r.length - 1; i++) {
      const d = Math.abs((z.x - a.x) * (a.y - r[i].y) - (a.x - r[i].x) * (z.y - a.y)) / (chord || 1);
      if (d > vd) { vd = d; v = i; }
    }
    if (chord >= 1 && v > 3 && v < r.length - 4) {
      const l1 = dist(r[0], r[v]), l2 = dist(r[v], r[r.length - 1]);
      const straight = bend(r.slice(0, v + 1), r[0], r[v]) < 0.15 && bend(r.slice(v), r[v], r[r.length - 1]) < 0.15;
      const ang = Math.acos(Math.max(-1, Math.min(1, ((r[0].x - r[v].x) * (z.x - r[v].x) + (r[0].y - r[v].y) * (z.y - r[v].y)) / ((l1 * l2) || 1))));
      if (straight && l1 > 6 && l2 > 6 && Math.max(l1, l2) <= 2.5 * Math.min(l1, l2) && ang > 0.35 && ang < 2.27) return { kind: 'chevron', tip: r[v] };
    }
  }
  // A question mark's curl: turns clockwise by ≥ 200° over its top, then heads down to finish below its start.
  const t = turning(r);
  const peak = Math.max(...t);
  const tail = r.slice(Math.floor(r.length * 0.75));
  const down = tail[tail.length - 1].y - tail[0].y > 0.5 * Math.abs(tail[tail.length - 1].x - tail[0].x);
  if (peak >= 3.5 && peak <= 7 && z.y - a.y > 0.3 * b.h && b.h >= 0.8 * b.w && down && chord > 0.3 * L) return { kind: 'hook' };
  return { kind: 'scribble' };
}

/** A stroke as the gesture reader sees it: its shape, points and when it was drawn (ms). */
export type Seen = { shape: Shape; pts: Pt[]; t: number };

/** Strokes of one gesture are drawn within this long of each other (a "?"'s dot, an arrow's head). */
export const JOIN_MS = 2500;

/**
 * A stroke that completes the one before it into one gesture: a dot under a hook's end makes a "?";
 * a chevron at one end of a line (or underline) makes an arrow to that end. Null: a gesture of its own.
 */
export function joins(prev: Seen, cur: Seen): { kind: 'confused' } | { kind: 'arrow'; from: Pt; to: Pt } | null {
  if (cur.t - prev.t > JOIN_MS) return null;
  if (prev.shape.kind === 'hook' && cur.shape.kind === 'dot') {
    const b = bbox(prev.pts), end = prev.pts[prev.pts.length - 1], c = bbox(cur.pts);
    const dot = { x: c.x + c.w / 2, y: c.y + c.h / 2 };
    if (dot.y > end.y && dot.y - end.y <= Math.max(0.8 * b.h, 30) && Math.abs(dot.x - end.x) <= Math.max(0.6 * b.w, 15)) return { kind: 'confused' };
    return null;
  }
  if (prev.shape.kind === 'line' && cur.shape.kind === 'chevron') {
    const a = prev.pts[0], z = prev.pts[prev.pts.length - 1], L = dist(a, z), tip = cur.shape.tip;
    const near = Math.max(0.3 * L, 20);
    if (dist(tip, z) <= near && dist(tip, z) <= dist(tip, a)) return { kind: 'arrow', from: a, to: z };
    if (dist(tip, a) <= near) return { kind: 'arrow', from: z, to: a };
  }
  return null;
}

/** A single stroke's meaning (a highlighter stroke is always "this phrase"). */
export function kindOf(shape: Shape, tool: 'pen' | 'highlighter' = 'pen'): MarkKind {
  if (tool === 'highlighter') return 'underline';
  switch (shape.kind) {
    case 'loop': return 'circle';
    case 'line': return shape.flat ? 'underline' : 'note';
    case 'arrow': return 'arrow';
    case 'hook': return 'confused';
    default: return 'note';
  }
}
