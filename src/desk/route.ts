// src/desk/route.ts
import type { SPt } from '../geometry/space';
import type { Stroke } from '../ink/agent/strokes';

type Rect = { x: number; y: number; w: number; h: number };
/** The page edge a connector crosses: the side facing the region, and its coordinate. */
export type Edge = { side: 'right' | 'left' | 'bottom'; at: number };

/** Clearance between a connector's ends and the things it joins. */
export const END_GAP = 6;
const SAMPLES = 32;

/** Which page edge faces a region placed `mode` of the page (B: the card's right edge). */
export function edgeFor(mode: 'right' | 'left' | 'below' | 'b', page: Rect): Edge {
  if (mode === 'left') return { side: 'left', at: page.x };
  if (mode === 'below') return { side: 'bottom', at: page.y + page.h };
  return { side: 'right', at: page.x + page.w };
}

/**
 * A connector from an anchor on a page (`from`) to an element in a region (`to`), both in one
 * frame (desk px in C, stage px in B). It leaves the anchor toward the region's side, crosses the
 * page edge, and eases into the element: a cubic whose first control sits on the edge at the
 * anchor's height and whose second sits halfway past the edge at the element's height.
 */
export function routeConnector(from: Rect, to: Rect, edge: Edge): Stroke {
  const cy = (r: Rect) => r.y + r.h / 2, cx = (r: Rect) => r.x + r.w / 2;
  let p0: SPt, p3: SPt, c1: SPt, c2: SPt;
  if (edge.side === 'bottom') {
    p0 = { x: cx(from), y: from.y + from.h + END_GAP };
    p3 = { x: cx(to), y: to.y - END_GAP };
    c1 = { x: p0.x, y: Math.max(edge.at, p0.y + 40) };
    c2 = { x: p3.x, y: edge.at + (p3.y - edge.at) * 0.5 };
  } else {
    const s = edge.side === 'right' ? 1 : -1;
    p0 = { x: s > 0 ? from.x + from.w + END_GAP : from.x - END_GAP, y: cy(from) };
    p3 = { x: s > 0 ? to.x - END_GAP : to.x + to.w + END_GAP, y: cy(to) };
    c1 = { x: s > 0 ? Math.max(edge.at, p0.x + 40) : Math.min(edge.at, p0.x - 40), y: p0.y };
    c2 = { x: edge.at + (p3.x - edge.at) * 0.5, y: p3.y };
  }
  return Array.from({ length: SAMPLES + 1 }, (_, i) => {
    const t = i / SAMPLES, m = 1 - t;
    const a = m * m * m, b = 3 * m * m * t, c = 3 * m * t * t, d = t * t * t;
    return { x: a * p0.x + b * c1.x + c * c2.x + d * p3.x, y: a * p0.y + b * c1.y + c * c2.y + d * p3.y };
  });
}
