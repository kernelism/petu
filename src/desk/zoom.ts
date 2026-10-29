// src/desk/zoom.ts
/**
 * A magnifier inset (`{{zoom on=s at=P r=60 scale=4}}`): a ring around a small detail and an enlarged
 * copy of everything inside it, in clear space beside the figure, joined by a thin line. Pure geometry
 * here (where the inset goes, how big, how a point maps into it); elements.ts draws it.
 */
import type { SPt, SRect } from '../geometry/space';
import { overlapArea } from './nudge';

/** The inset: centre C, radius R, magnification k (R = r·k, capped to fit the section). */
export type Inset = { c: SPt; r: number; C: SPt; R: number; k: number };

/** A point near the detail, where the inset shows it. */
export const toInset = (z: Inset, p: SPt): SPt => ({ x: z.C.x + (p.x - z.c.x) * z.k, y: z.C.y + (p.y - z.c.y) * z.k });

const sq = (p: SPt, r: number): SRect => ({ x: p.x - r, y: p.y - r, w: 2 * r, h: 2 * r });
const outside = (r: SRect, b: SRect) => r.w * r.h - overlapArea(r, b);

/**
 * Where the inset goes. Its radius is r·scale, capped at `maxR`, and smaller still (to 1.5×) when that
 * finds clear space the full size does not. Candidates: beside the figure's box (right, left, below, above, level with the
 * detail), then around the detail at growing distances; each scored by the ink and labels it would
 * cover, any part outside `bounds` (much worse), covering the detail's ring (worst) and its distance.
 */
export function placeInset(c: SPt, r: number, scale: number, figure: SRect, obstacles: SRect[], bounds: SRect, gap: number, maxR: number): Inset {
  const R0 = Math.max(r * 1.5, Math.min(r * scale, maxR));
  // A smaller inset in clear space beats a bigger one over the figure: try the full size, then smaller (never under 1.5×).
  let best: Inset | null = null, bestCost = Infinity;
  for (const f of [1, 0.85, 0.7, 0.55]) {
    const R = Math.max(r * 1.5, R0 * f);
    const got = bestAt(c, r, R, figure, obstacles, bounds, gap);
    const cost = got.cost + (R0 - R) * R0 * 0.3;
    if (cost < bestCost) { bestCost = cost; best = { c, r, C: got.C, R, k: R / r }; }
    if (R <= r * 1.5) break;
  }
  return best!;
}

function bestAt(c: SPt, r: number, R: number, figure: SRect, obstacles: SRect[], bounds: SRect, gap: number): { C: SPt; cost: number } {
  const ring = sq(c, r + gap);
  const clampY = (y: number) => Math.min(Math.max(y, bounds.y + R), bounds.y + bounds.h - R);
  const clampX = (x: number) => Math.min(Math.max(x, bounds.x + R), bounds.x + bounds.w - R);
  const cands: SPt[] = [
    { x: figure.x + figure.w + gap + R, y: c.y },
    { x: figure.x - gap - R, y: c.y },
    { x: c.x, y: figure.y + figure.h + gap + R },
    { x: c.x, y: figure.y - gap - R },
  ];
  for (const d of [r + R + gap * 2, r + R + gap * 5, r + R + gap * 10]) for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8;
    cands.push({ x: c.x + Math.cos(a) * d, y: c.y + Math.sin(a) * d });
  }
  let best = cands[0], bestCost = Infinity;
  for (const C0 of cands) {
    const C = { x: clampX(C0.x), y: clampY(C0.y) }, box = sq(C, R + gap);
    const cost = obstacles.reduce((n, o) => n + overlapArea(box, o), 0) + outside(sq(C, R), bounds) * 50 + overlapArea(box, ring) * 1e4 + Math.hypot(C.x - c.x, C.y - c.y) * 0.5;
    if (cost < bestCost) { bestCost = cost; best = C; }
  }
  return { C: best, cost: bestCost };
}
