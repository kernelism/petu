// src/geometry/figure.ts
import type { Pt } from '../script/types';
import { REGION_H, REGION_W } from '../script/types';
import { isLiteral, type PtArg, type PtExpr } from '../script/pointExpr';

/** Room kept around a fitted figure for labels (region units). */
export const FIT_MX = 80;
export const FIT_MY = 70;
/** A fitted figure is never blown up more than this (a tiny figure stays modest). */
export const FIT_MAX_SCALE = 4;

export type Fit = { s: number; dx: number; dy: number };
const IDENTITY: Fit = { s: 1, dx: 0, dy: 0 };
export type Unresolved = { missing: string } | { degenerate: string };

/**
 * Named points of one target (a region, or a page) for one answer. Definitions come from parsed tags
 * (lookahead: the director registers them as soon as they are parsed, long before their word), so a
 * reference resolves whenever its definition was streamed earlier. First definition wins.
 *
 * A fitted region maps world coords to region coords with one uniform scale (angles and ratios are
 * kept), frozen the first time anything in the region is built: from every point parsed by then.
 */
export class Figure {
  private defs = new Map<string, PtArg>();
  private literals: Pt[] = [];
  private fit: Fit | null;
  /** Points that landed outside the frozen frame and were clamped (eval metric). */
  outOfFrame = 0;
  constructor(readonly fitted: boolean, private marks: (id: string) => Pt | undefined = () => undefined) {
    this.fit = fitted ? null : IDENTITY;
  }

  /** Declares `name` (no-op, with a warning result, when it exists). */
  define(name: string, p: PtArg): boolean {
    if (this.defs.has(name)) return false;
    this.defs.set(name, p);
    if (isLiteral(p)) this.literals.push(p);
    return true;
  }
  /** Records a literal coordinate used by any element, for the fit's extent. */
  note(p: PtArg): void { if (isLiteral(p)) this.literals.push(p); }
  has(name: string): boolean { return this.defs.has(name); }

  /** World coords of a point argument. */
  world(p: PtArg, seen = new Set<string>()): Pt | Unresolved {
    if (isLiteral(p)) return p;
    return this.evalExpr(p, seen);
  }

  private evalExpr(e: PtExpr, seen: Set<string>): Pt | Unresolved {
    if ('ref' in e) {
      if (e.ref.startsWith('#')) return this.marks(e.ref) ?? { missing: e.ref };
      if (seen.has(e.ref)) return { degenerate: `cycle at ${e.ref}` };
      const d = this.defs.get(e.ref);
      if (!d) return { missing: e.ref };
      seen.add(e.ref);
      const r = this.world(d, seen);
      seen.delete(e.ref);
      return r;
    }
    const pts: Pt[] = [];
    for (const a of e.args) {
      const r = this.evalExpr(a, seen);
      if (!('x' in r)) return r;
      pts.push(r);
    }
    switch (e.fn) {
      case 'mid': return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      case 'along': return { x: pts[0].x + e.t * (pts[1].x - pts[0].x), y: pts[0].y + e.t * (pts[1].y - pts[0].y) };
      case 'meet': return meet(pts[0], pts[1], pts[2], pts[3]) ?? { degenerate: 'parallel lines in meet()' };
      case 'foot': return foot(pts[0], pts[1], pts[2]) ?? { degenerate: 'zero-length line in foot()' };
    }
  }

  /** World bbox of everything known now: literals and every definition that resolves. */
  extent(): { x0: number; y0: number; x1: number; y1: number } | null {
    const pts = [...this.literals];
    for (const name of this.defs.keys()) { const r = this.world({ ref: name }); if ('x' in r) pts.push(r); }
    if (!pts.length) return null;
    return {
      x0: Math.min(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)),
      x1: Math.max(...pts.map((p) => p.x)), y1: Math.max(...pts.map((p) => p.y)),
    };
  }

  /** Freezes the fit (idempotent). */
  freeze(): Fit {
    if (this.fit) return this.fit;
    this.fit = fitBox(this.extent());
    return this.fit;
  }
  frozen(): boolean { return this.fit != null; }

  /** World → region coords (freezing the fit if needed), clamped to the region; counts clamps. */
  toLocal(p: Pt, h = REGION_H): Pt {
    const f = this.freeze();
    const x = p.x * f.s + f.dx, y = p.y * f.s + f.dy;
    const cx = Math.min(REGION_W, Math.max(0, x)), cy = Math.min(h, Math.max(0, y));
    if (Math.abs(cx - x) > 1 || Math.abs(cy - y) > 1) this.outOfFrame++;
    return { x: cx, y: cy };
  }
  /** A world length → region units (radii, axes sizes). */
  scaleLen(n: number): number { return n * this.freeze().s; }
}

/** The uniform fit of a world box into the region, centred, with label margins. */
export function fitBox(b: { x0: number; y0: number; x1: number; y1: number } | null): Fit {
  if (!b) return IDENTITY;
  const w = b.x1 - b.x0, h = b.y1 - b.y0;
  const sx = w > 1e-6 ? (REGION_W - 2 * FIT_MX) / w : Infinity;
  const sy = h > 1e-6 ? (REGION_H - 2 * FIT_MY) / h : Infinity;
  const s = Number.isFinite(Math.min(sx, sy)) ? Math.min(sx, sy, FIT_MAX_SCALE) : 1; // a single point: no scaling
  return { s, dx: REGION_W / 2 - s * (b.x0 + w / 2), dy: REGION_H / 2 - s * (b.y0 + h / 2) };
}

export function meet(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const r = { x: b.x - a.x, y: b.y - a.y }, s = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * s.y - r.y * s.x;
  const scale = Math.hypot(r.x, r.y) * Math.hypot(s.x, s.y);
  if (!scale || Math.abs(den) < 1e-9 * scale) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  return { x: a.x + t * r.x, y: a.y + t * r.y };
}

export function foot(p: Pt, a: Pt, b: Pt): Pt | null {
  const d = { x: b.x - a.x, y: b.y - a.y };
  const L = d.x * d.x + d.y * d.y;
  if (!L) return null;
  const t = ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / L;
  return { x: a.x + t * d.x, y: a.y + t * d.y };
}

/**
 * A ray from `a` through `b`, extended to the box [0,W]×[0,H] inset by `inset`: the far end.
 * Null when a == b. (`a` itself may be outside; the end is where the ray leaves the box.)
 */
export function rayEnd(a: Pt, b: Pt, W: number, H: number, inset = 12): Pt | null {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (!dx && !dy) return null;
  let t = Infinity;
  const lo = inset, hx = W - inset, hy = H - inset;
  if (dx > 0) t = Math.min(t, (hx - a.x) / dx); else if (dx < 0) t = Math.min(t, (lo - a.x) / dx);
  if (dy > 0) t = Math.min(t, (hy - a.y) / dy); else if (dy < 0) t = Math.min(t, (lo - a.y) / dy);
  t = Math.max(t, 1); // never shorter than a → b
  return { x: a.x + t * dx, y: a.y + t * dy };
}
