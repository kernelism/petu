import type { SPt } from '../../geometry/space';

export type Stroke = SPt[];
export type Rng = () => number; // uniform in [-0.5, 0.5)

export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5;
  };
}

/** Smooth low-frequency wobble for hand style: two sines with random phase. */
function wobble(r: Rng, amp: number) {
  const p1 = r() * 6.28, p2 = r() * 6.28, f1 = 1.3 + r(), f2 = 2.7 + r();
  return (t: number) => amp * (0.6 * Math.sin(6.283 * f1 * t + p1) + 0.4 * Math.sin(6.283 * f2 * t + p2));
}

/** Counter-clockwise loop starting near 11 o'clock, sweeping ~375° so it closes just past its start. */
export function circleStroke(c: SPt, rx: number, ry: number, r: Rng | null): Stroke {
  const n = 72, start = -Math.PI / 2 - 0.45, sweep = Math.PI * 2 * 1.04;
  const wr = r ? wobble(r, 0.05) : () => 0;
  const drift = r ? r() * 0.06 : 0;
  const pts: Stroke = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = start - sweep * t;
    const k = 1 + wr(t) + drift * t;
    pts.push({ x: c.x + Math.cos(a) * rx * k * (r ? 1.06 : 1), y: c.y + Math.sin(a) * ry * k });
  }
  return pts;
}

export function lineStroke(a: SPt, b: SPt, r: Rng | null): Stroke {
  const n = 24, dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L, ny = dx / L;
  const w = r ? wobble(r, Math.min(2.2, L * 0.012)) : () => 0;
  const bow = r ? r() * L * 0.03 : 0;
  const pts: Stroke = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const off = i === 0 || i === n ? 0 : w(t) + bow * Math.sin(Math.PI * t);
    pts.push({ x: a.x + dx * t + nx * off, y: a.y + dy * t + ny * off });
  }
  return pts;
}

export function arrowStrokes(a: SPt, b: SPt, r: Rng | null): [Stroke, Stroke] {
  const shaft = lineStroke(a, b, r);
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const h = Math.min(22, Math.max(10, Math.hypot(b.x - a.x, b.y - a.y) * 0.18));
  const spread = 0.5 + (r ? r() * 0.1 : 0);
  const p1 = { x: b.x - h * Math.cos(ang - spread), y: b.y - h * Math.sin(ang - spread) };
  const p2 = { x: b.x - h * Math.cos(ang + spread), y: b.y - h * Math.sin(ang + spread) };
  return [shaft, [p1, { x: b.x, y: b.y }, p2]];
}

/** One clockwise stroke from the top-left corner, closing with a small overlap along the top edge. */
export function boxStroke(x: number, y: number, w: number, h: number, r: Rng | null): Stroke {
  const overlap = Math.min(10, w * 0.15);
  const legs: [SPt, SPt][] = [
    [{ x, y }, { x: x + w, y }],
    [{ x: x + w, y }, { x: x + w, y: y + h }],
    [{ x: x + w, y: y + h }, { x, y: y + h }],
    [{ x, y: y + h }, { x, y }],
    [{ x, y }, { x: x + overlap, y }],
  ];
  const pts: Stroke = [];
  legs.forEach(([p, q], i) => {
    const seg = lineStroke(p, q, r);
    pts.push(...(i === 0 ? seg : seg.slice(1)));
  });
  return pts;
}

// ------------------------------------------------------------------------------------------------
// Toolkit v2 (Lane B)

/** Uniform Catmull-Rom through `pts` (2+), `per` samples per segment; passes through every point. */
export function curveStroke(pts: SPt[], r: Rng | null, per = 16): Stroke {
  if (pts.length < 2) return pts.slice();
  const P = [pts[0], ...pts, pts[pts.length - 1]];
  const out: Stroke = [];
  for (let i = 1; i < P.length - 2; i++) {
    const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
    for (let k = i === 1 ? 0 : 1; k <= per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  if (!r) return out;
  // Hand style: a gentle wobble along the normal, zero at both ends.
  const w = wobble(r, 1.6);
  return out.map((p, i) => {
    if (i === 0 || i === out.length - 1) return p;
    const a = out[i - 1], b = out[i + 1], dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
    const o = w(i / (out.length - 1));
    return { x: p.x - (dy / L) * o, y: p.y + (dx / L) * o };
  });
}

/**
 * Whether a polyline crosses itself (two non-adjacent segments properly intersect). A closed path
 * (first point = last) may meet itself at its ends. A spline through points given out of order
 * loops back on itself; such a curve is skipped rather than drawn wrong.
 */
export function crossesItself(s: Stroke): boolean {
  const n = s.length - 1;
  if (n < 3) return false;
  const closed = Math.hypot(s[0].x - s[n].x, s[0].y - s[n].y) < 1e-6;
  const cross = (o: SPt, a: SPt, b: SPt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (closed && i === 0 && j === n - 1) continue;
      const [p, q, r, t] = [s[i], s[i + 1], s[j], s[j + 1]];
      const d1 = cross(r, t, p), d2 = cross(r, t, q), d3 = cross(p, q, r), d4 = cross(p, q, t);
      if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
    }
  }
  return false;
}

/** Arc of radius `rad` around `c` from the ray toward `a` to the ray toward `b`, the smaller way round. */
export function arcStroke(c: SPt, a: SPt, b: SPt, rad: number): Stroke {
  const a0 = Math.atan2(a.y - c.y, a.x - c.x);
  let d = Math.atan2(b.y - c.y, b.x - c.x) - a0;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const n = Math.max(6, Math.ceil(Math.abs(d) / 0.08));
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = a0 + (d * i) / n;
    return { x: c.x + Math.cos(t) * rad, y: c.y + Math.sin(t) * rad };
  });
}

/** The arc's bisector direction (unit), for placing an angle's label. */
export function bisector(c: SPt, a: SPt, b: SPt): SPt {
  const u = (p: SPt) => { const dx = p.x - c.x, dy = p.y - c.y, L = Math.hypot(dx, dy) || 1; return { x: dx / L, y: dy / L }; };
  const ua = u(a), ub = u(b), sx = ua.x + ub.x, sy = ua.y + ub.y, L = Math.hypot(sx, sy);
  return L < 1e-6 ? { x: -ua.y, y: ua.x } : { x: sx / L, y: sy / L };
}

/**
 * A curly brace from `a` to `b` as one stroke (a → tip → b). The tip sits `depth` from the chord's
 * middle, to the left of the direction a → b (y down: left of east is north). Two quadratic halves
 * each, the classic shape (q = 0.6 sets how sharp the curls are).
 */
export function braceStroke(a: SPt, b: SPt, depth: number, q = 0.6, per = 10): Stroke {
  const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const t = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
  const n = { x: t.y, y: -t.x };
  const at = (u: number, v: number): SPt => ({ x: a.x + t.x * u + n.x * v, y: a.y + t.y * u + n.y * v });
  const quad = (p0: SPt, c: SPt, p1: SPt, from = 0): Stroke => {
    const out: Stroke = [];
    for (let k = from; k <= per; k++) {
      const s = k / per, m = 1 - s;
      out.push({ x: m * m * p0.x + 2 * m * s * c.x + s * s * p1.x, y: m * m * p0.y + 2 * m * s * c.y + s * s * p1.y });
    }
    return out;
  };
  // Half from one end to the tip, u measured from that end toward the middle. Its two quadratics
  // meet at (L/4, depth/2) with a shared tangent, and arrive at the tip vertically (the cusp).
  const half = (sign: 1 | -1): Stroke => {
    const U = (u: number) => (sign === 1 ? u : L - u);
    const p0 = at(U(0), 0), c1 = at(U(0), q * depth), mid = at(U(L / 4), depth / 2);
    const c2 = at(U(L / 2), (1 - q) * depth), tip = at(U(L / 2), depth);
    return [...quad(p0, c1, mid), ...quad(mid, c2, tip, 1)];
  };
  return [...half(1), ...half(-1).reverse().slice(1)];
}

/**
 * A bracket beside the segment a → b, on `side` (1: left of a → b, y down; −1: right): a spine `gap +
 * tick` away from the segment, end ticks reaching back toward it (stopping `gap` short, so the bracket
 * never touches what it measures) and a small notch pointing out at the middle. One stroke.
 */
export function bracketStroke(a: SPt, b: SPt, o: { gap: number; tick: number; notch: number; side: 1 | -1 }): Stroke {
  const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const t = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
  const n = { x: t.y * o.side, y: -t.x * o.side };
  const at = (u: number, v: number): SPt => ({ x: a.x + t.x * u + n.x * v, y: a.y + t.y * u + n.y * v });
  const sp = o.gap + o.tick, w = Math.min(o.notch, L / 6);
  return [at(0, o.gap), at(0, sp), at(L / 2 - w, sp), at(L / 2, sp + o.notch), at(L / 2 + w, sp), at(L, sp), at(L, o.gap)];
}

/** The unit normal pointing to `side` of a → b (as bracketStroke uses it). */
export function sideNormal(a: SPt, b: SPt, side: 1 | -1): SPt {
  const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: ((b.y - a.y) / L) * side, y: (-(b.x - a.x) / L) * side };
}

/**
 * Which side of a → b a bracket goes: the one whose strip (as long as the segment, `reach` deep) holds
 * less: boxes it overlaps (by area) and stroke segments crossing it. Ties: left of a → b (1).
 */
export function bracketSide(a: SPt, b: SPt, reach: number, boxes: { x: number; y: number; w: number; h: number }[], segs: { a: SPt; b: SPt }[]): 1 | -1 {
  const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const t = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
  const cost = (side: 1 | -1) => {
    const n = sideNormal(a, b, side);
    // Local coords (u along, v out): inside the strip when 0 ≤ u ≤ L and 2 < v ≤ reach.
    const local = (p: SPt) => ({ u: (p.x - a.x) * t.x + (p.y - a.y) * t.y, v: (p.x - a.x) * n.x + (p.y - a.y) * n.y });
    const inside = (p: SPt) => { const q = local(p); return q.u >= 0 && q.u <= L && q.v > 2 && q.v <= reach; };
    let c = 0;
    for (const r of boxes) {
      // Sample the box: the share of its points inside the strip, weighted by the box's size (capped at the strip's).
      let hit = 0;
      for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) if (inside({ x: r.x + (r.w * i) / 4, y: r.y + (r.h * j) / 4 })) hit++;
      c += (hit / 25) * Math.min(r.w * r.h, L * reach);
    }
    for (const sg of segs) for (let k = 0; k <= 4; k++) if (inside({ x: sg.a.x + ((sg.b.x - sg.a.x) * k) / 4, y: sg.a.y + ((sg.b.y - sg.a.y) * k) / 4 })) c += reach * 2;
    return c;
  };
  const l = cost(1), r = cost(-1);
  return r < l ? -1 : 1;
}

/** A small round dot (as a short closed loop), for points. */
export function dotStroke(c: SPt, rad: number): Stroke {
  return Array.from({ length: 17 }, (_, i) => {
    const t = -Math.PI / 2 + (i / 16) * Math.PI * 2;
    return { x: c.x + Math.cos(t) * rad, y: c.y + Math.sin(t) * rad };
  });
}
