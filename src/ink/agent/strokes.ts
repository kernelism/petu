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
