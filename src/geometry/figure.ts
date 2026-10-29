// src/geometry/figure.ts
import type { Pt } from '../script/types';
import { REGION_H, REGION_W } from '../script/types';
import { isLiteral, MAX_ABS, type PtArg, type PtExpr } from '../script/pointExpr';
import { evalConst } from './live';

/** Room kept around a fitted figure for labels (region units). */
export const FIT_MX = 80;
export const FIT_MY = 70;

/**
 * World → region: x·sx + dx, y·sy + dy. A geometric figure has one uniform scale (sx = sy = s: angles
 * and ratios are kept); a data figure (it has axes: x and y are different quantities) scales each axis
 * to fill the region. No magnification cap: labels are screen px whatever the scale, so a figure drawn in
 * small units (0–4) fills the region instead of collapsing to a sliver.
 */
export type Fit = { s: number; dx: number; dy: number; sx?: number; sy?: number };
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
  /** Resolved names. Definitions are first-wins and never change, so a resolved name stays resolved;
   *  misses and degenerate results are not kept (a later definition may fix them). Keeps resolution
   *  linear in the number of names (each name's chain is walked once). */
  private resolved = new Map<string, Pt>();
  private literals: Pt[] = [];
  private spans: { at: PtArg; offsets: Pt[] }[] = [];
  private fit: Fit | null;
  /** A data figure (axes were drawn in it): independent x and y scales. */
  private data = false;
  /** Points that landed outside the frozen frame and were clamped (eval metric). */
  outOfFrame = 0;
  /**
   * `consts`: the answer's named numbers right now. Live geometry (coordinates or `along`'s t written as
   * formulas over them) re-evaluates on every call, so a changed constant moves every point built from it.
   */
  constructor(readonly fitted: boolean, private marks: (id: string) => Pt | undefined = () => undefined, private consts: () => Record<string, number> = () => ({})) {
    this.fit = fitted ? null : IDENTITY;
  }
  /** Whether `p` depends on a constant (directly, or through the names and constructions it uses). */
  isLive(p: PtArg, seen = new Set<string>()): boolean {
    if (isLiteral(p)) return false;
    if ('ref' in p) {
      if (p.ref.startsWith('#') || seen.has(p.ref)) return false;
      const d = this.defs.get(p.ref);
      if (!d) return false;
      seen.add(p.ref);
      return this.isLive(d, seen);
    }
    if (p.fn === 'xy') return true;
    if (p.fn === 'along' && p.tSrc != null) return true;
    return p.args.some((a) => this.isLive(a, seen));
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
  /** Records an element's world-size reach from its anchor (a box's far corner, a circle's radii), for the fit's extent. */
  noteSpan(at: PtArg, offsets: Pt[]): void { this.spans.push({ at, offsets }); }
  has(name: string): boolean { return this.defs.has(name); }
  /** Marks this a data figure (it has axes): x and y scale independently when the fit freezes. */
  markData(): void { this.data = true; }

  /** World coords of a point argument. */
  world(p: PtArg, seen = new Set<string>()): Pt | Unresolved {
    if (isLiteral(p)) return p;
    return this.evalExpr(p, seen);
  }

  private evalExpr(e: PtExpr, seen: Set<string>): Pt | Unresolved {
    if ('ref' in e) {
      if (e.ref.startsWith('#')) return this.marks(e.ref) ?? { missing: e.ref };
      const hit = this.resolved.get(e.ref);
      if (hit) return hit;
      if (seen.has(e.ref)) return { degenerate: `cycle at ${e.ref}` };
      const d = this.defs.get(e.ref);
      if (!d) return { missing: e.ref };
      seen.add(e.ref);
      const r = this.world(d, seen);
      seen.delete(e.ref);
      // A live name is never cached: its place follows the constants.
      if ('x' in r && !this.isLive(d)) this.resolved.set(e.ref, r);
      return r;
    }
    if (e.fn === 'xy') {
      const x = evalConst(e.ex, this.consts()), y = evalConst(e.ey, this.consts());
      if (typeof x === 'string') return { degenerate: x };
      if (typeof y === 'string') return { degenerate: y };
      const p = { x, y };
      return inRange(p) ? p : { degenerate: `${e.ex},${e.ey} lands too far out` };
    }
    const pts: Pt[] = [];
    for (const a of e.args) {
      const r = this.evalExpr(a, seen);
      if (!('x' in r)) return r;
      pts.push(r);
    }
    const r = this.construct(e, pts);
    return 'x' in r && !inRange(r) ? { degenerate: `${e.fn}() lands too far out` } : r;
  }

  private construct(e: Exclude<PtExpr, { ref: string } | { fn: 'xy' }>, pts: Pt[]): Pt | Unresolved {
    switch (e.fn) {
      case 'mid': return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      case 'along': {
        const t = e.tSrc != null ? evalConst(e.tSrc, this.consts()) : e.t;
        if (typeof t === 'string') return { degenerate: t };
        return { x: pts[0].x + t * (pts[1].x - pts[0].x), y: pts[0].y + t * (pts[1].y - pts[0].y) };
      }
      case 'meet': return meet(pts[0], pts[1], pts[2], pts[3]) ?? { degenerate: 'parallel lines in meet()' };
      case 'foot': return foot(pts[0], pts[1], pts[2]) ?? { degenerate: 'zero-length line in foot()' };
    }
  }

  /** World bbox of everything known now: literals and every definition that resolves. */
  extent(): { x0: number; y0: number; x1: number; y1: number } | null {
    const pts = [...this.literals];
    for (const name of this.defs.keys()) { const r = this.world({ ref: name }); if ('x' in r) pts.push(r); }
    for (const sp of this.spans) {
      const a = this.world(sp.at);
      if ('x' in a) for (const o of sp.offsets) pts.push({ x: a.x + o.x, y: a.y + o.y });
    }
    const ok = pts.filter(inRange); // a far-out point would shrink the whole figure to a dot
    if (!ok.length) return null;
    pts.length = 0; pts.push(...ok);
    return {
      x0: Math.min(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)),
      x1: Math.max(...pts.map((p) => p.x)), y1: Math.max(...pts.map((p) => p.y)),
    };
  }

  /** Freezes the fit (idempotent). */
  freeze(): Fit {
    if (this.fit) return this.fit;
    this.fit = fitBox(this.extent(), this.data);
    return this.fit;
  }
  frozen(): boolean { return this.fit != null; }

  /** World → region coords (freezing the fit if needed), clamped to the region; counts clamps. */
  toLocal(p: Pt, h = REGION_H): Pt {
    const f = this.freeze();
    const x = p.x * (f.sx ?? f.s) + f.dx, y = p.y * (f.sy ?? f.s) + f.dy;
    const cx = Math.min(REGION_W, Math.max(0, x)), cy = Math.min(h, Math.max(0, y));
    if (Math.abs(cx - x) > 1 || Math.abs(cy - y) > 1) this.outOfFrame++;
    return { x: cx, y: cy };
  }
  /** A world length → region units (radii, axes sizes): along x, along y, or (no axis) the smaller scale. */
  scaleLen(n: number, axis?: 'x' | 'y'): number {
    const f = this.freeze();
    return n * (axis === 'x' ? f.sx ?? f.s : axis === 'y' ? f.sy ?? f.s : f.s);
  }
}

/**
 * The fit of a world box into the region, centred, with label margins: one uniform scale, or (`data`)
 * each axis its own, so data whose x and y ranges differ fills the region. A flat extent (a horizontal
 * segment) takes the other axis's scale; a single point is not scaled.
 */
export function fitBox(b: { x0: number; y0: number; x1: number; y1: number } | null, data = false): Fit {
  if (!b) return IDENTITY;
  const w = b.x1 - b.x0, h = b.y1 - b.y0;
  let sx = w > 1e-6 ? (REGION_W - 2 * FIT_MX) / w : Infinity;
  let sy = h > 1e-6 ? (REGION_H - 2 * FIT_MY) / h : Infinity;
  const s = Number.isFinite(Math.min(sx, sy)) ? Math.min(sx, sy) : 1; // a single point: no scaling
  if (!data || !Number.isFinite(sx) || !Number.isFinite(sy)) { sx = s; sy = s; }
  const out: Fit = { s, dx: REGION_W / 2 - sx * (b.x0 + w / 2), dy: REGION_H / 2 - sy * (b.y0 + h / 2) };
  return sx !== s || sy !== s ? { ...out, sx, sy } : out;
}

const inRange = (p: Pt) => Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) <= MAX_ABS && Math.abs(p.y) <= MAX_ABS;
/** A crossing farther than this many segment lengths from BOTH segments is treated as parallel. */
export const MEET_MAX_T = 20;

/**
 * Where line AB crosses line CD; null when they are parallel, nearly parallel (the crossing lies
 * more than MEET_MAX_T lengths of AB from A and of CD from C), or out of range.
 */
export function meet(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const r = { x: b.x - a.x, y: b.y - a.y }, s = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * s.y - r.y * s.x;
  const scale = Math.hypot(r.x, r.y) * Math.hypot(s.x, s.y);
  if (!scale || Math.abs(den) < 1e-9 * scale) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
  if (Math.min(Math.abs(t), Math.abs(u)) > MEET_MAX_T) return null;
  const p = { x: a.x + t * r.x, y: a.y + t * r.y };
  return inRange(p) ? p : null;
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
