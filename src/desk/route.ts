// src/desk/route.ts
import type { SPt } from '../geometry/space';
import type { Stroke } from '../ink/agent/strokes';

type Rect = { x: number; y: number; w: number; h: number };
/** The page edge a connector crosses: the side facing the region, and its coordinate. */
export type Edge = { side: 'right' | 'left' | 'bottom'; at: number };

/**
 * Where a page has content: a coarse grid over the page (row-major, 1 = something is printed in
 * that cell). Resolution-independent, so one mask serves the page in C and on the B card.
 */
export type ContentMask = { cols: number; rows: number; cells: Uint8Array };

export type RouteOpts = {
  /** The anchor's page in the same frame: the sideways run stays on it. */
  page?: Rect;
  /** Whether page content touches a frame rect. Without it the run leaves with a short vertical hook. */
  blocked?: (r: Rect) => boolean;
  /** Ink already drawn at the element's end (frame rects): the curve arrives the way that crosses least of it. */
  avoid?: Rect[];
};

/** Clearance between a connector's ends and the things it joins. */
export const END_GAP = 6;
/** Samples along the whole path (spread by length). */
const SAMPLES = 48;
/** The corner from the vertical exit into the sideways run. */
const CORNER = 14;
/** The short exit when nothing is known about the page: just off the anchor's own line. */
const HOOK = 14;
/** A detour costs this much more than leaving straight at the anchor's height. */
const TURN_COST = 12;
/** How much the element's height pulls the sideways run toward it. */
const PULL = 0.35;

/** Which page edge faces a region placed `mode` of the page (B: the card's right edge). */
export function edgeFor(mode: 'right' | 'left' | 'below' | 'b', page: Rect): Edge {
  if (mode === 'left') return { side: 'left', at: page.x };
  if (mode === 'below') return { side: 'bottom', at: page.y + page.h };
  return { side: 'right', at: page.x + page.w };
}

/** A blocked() test over a page's content mask; rects off the page are clear. */
export function maskBlocker(mask: ContentMask, page: Rect): (r: Rect) => boolean {
  const cw = page.w / mask.cols, ch = page.h / mask.rows;
  return (r) => {
    const c0 = Math.max(0, Math.floor((r.x - page.x) / cw)), c1 = Math.min(mask.cols - 1, Math.floor((r.x + r.w - page.x) / cw));
    const r0 = Math.max(0, Math.floor((r.y - page.y) / ch)), r1 = Math.min(mask.rows - 1, Math.floor((r.y + r.h - page.y) / ch));
    for (let row = r0; row <= r1; row++) for (let c = c0; c <= c1; c++) if (mask.cells[row * mask.cols + c]) return true;
    return false;
  };
}

// The router works in a canonical frame where the region is to the right (+x). Left mirrors x;
// below swaps the axes.
type Frame = { pt(p: SPt): SPt; back(p: SPt): SPt; rect(r: Rect): Rect; unrect(r: Rect): Rect; at(v: number): number };
const FRAMES: Record<Edge['side'], Frame> = {
  right: { pt: (p) => p, back: (p) => p, rect: (r) => r, unrect: (r) => r, at: (v) => v },
  left: {
    pt: (p) => ({ x: -p.x, y: p.y }), back: (p) => ({ x: -p.x, y: p.y }),
    rect: (r) => ({ x: -(r.x + r.w), y: r.y, w: r.w, h: r.h }), unrect: (r) => ({ x: -(r.x + r.w), y: r.y, w: r.w, h: r.h }),
    at: (v) => -v,
  },
  bottom: {
    pt: (p) => ({ x: p.y, y: p.x }), back: (p) => ({ x: p.y, y: p.x }),
    rect: (r) => ({ x: r.y, y: r.x, w: r.h, h: r.w }), unrect: (r) => ({ x: r.y, y: r.x, w: r.h, h: r.w }),
    at: (v) => v,
  },
};

type Seg = { kind: 'line'; a: SPt; b: SPt } | { kind: 'cubic'; a: SPt; c1: SPt; c2: SPt; b: SPt };
const cubicAt = (s: Extract<Seg, { kind: 'cubic' }>, t: number): SPt => {
  const m = 1 - t, a = m * m * m, b = 3 * m * m * t, c = 3 * m * t * t, d = t * t * t;
  return { x: a * s.a.x + b * s.c1.x + c * s.c2.x + d * s.b.x, y: a * s.a.y + b * s.c1.y + c * s.c2.y + d * s.b.y };
};
const segAt = (s: Seg, t: number): SPt => (s.kind === 'line' ? { x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t } : cubicAt(s, t));
const segLen = (s: Seg) => {
  let L = 0, p = s.a;
  for (let i = 1; i <= 12; i++) { const q = segAt(s, i / 12); L += Math.hypot(q.x - p.x, q.y - p.y); p = q; }
  return L;
};
/** The final ease: an S from (x0, y) level to the element, tangent-level at both ends. */
const ease = (a: SPt, b: SPt): Seg => {
  const mx = a.x + (b.x - a.x) * 0.5;
  return { kind: 'cubic', a, c1: { x: mx, y: a.y }, c2: { x: mx, y: b.y }, b };
};

/**
 * A connector from an anchor on a page (`from`) to an element in a region (`to`), both in one
 * frame (desk px in C, stage px in B). It leaves the anchor, runs sideways along a clear band of
 * the page to its edge, crosses it once, and eases into the element:
 * - straight out at the anchor's height when that line to the edge is clear;
 * - else up or down to the nearest clear horizontal band (the element's height breaks ties), round
 *   a small corner, then sideways;
 * - without content info, a short vertical hook off the anchor's own line toward the element;
 * - when no band is clear, straight out at the anchor's height.
 * The ease starts as early on the page as the content allows, so the curve stays long and calm.
 */
export function routeConnector(from: Rect, to: Rect, edge: Edge, o: RouteOpts = {}): Stroke {
  const F = FRAMES[edge.side];
  const A = F.rect(from), B = F.rect(to), E = F.at(edge.at);
  const P = o.page ? F.rect(o.page) : null;
  const blocked = o.blocked ? (r: Rect) => o.blocked!(F.unrect(r)) : null;
  const cy = A.y + A.h / 2, cx = A.x + A.w / 2;
  const p3 = { x: B.x - END_GAP, y: B.y + B.h / 2 };
  /** Clearance around the run, scaled with the page (a small B card gets a tighter one). */
  const clear = o.page ? Math.max(4, Math.min(12, o.page.w * 0.012)) : 6;
  const inSpan = (y: number) => y >= A.y && y <= A.y + A.h;
  /** The sideways run from the anchor to the edge at height y, padded by the clearance. */
  const run = (y: number): Rect => {
    const x0 = inSpan(y) ? A.x + A.w + END_GAP : cx - clear;
    return { x: x0, y: y - clear, w: Math.max(0, E - x0), h: 2 * clear };
  };

  // 1. The band.
  let y = cy;
  if (blocked && P) {
    let best = NaN, bestCost = Infinity;
    if (!blocked(run(cy))) best = cy;
    else {
      for (let v = P.y + clear + 2; v <= P.y + P.h - clear - 2; v += 2) {
        if (blocked(run(v))) continue;
        const cost = Math.abs(v - cy) + PULL * Math.abs(v - p3.y) + (inSpan(v) ? 0 : TURN_COST);
        if (cost < bestCost) { bestCost = cost; best = v; }
      }
    }
    if (!Number.isNaN(best)) y = best;
  } else if (Math.abs(p3.y - cy) > A.h / 2 + 2) {
    y = cy + Math.sign(p3.y - cy) * (A.h / 2 + HOOK);
  }

  // 2. The exit and the sideways run.
  const segs: Seg[] = [];
  let h0: SPt;
  if (inSpan(y)) {
    h0 = { x: A.x + A.w + END_GAP, y };
  } else {
    const up = y < A.y;
    const p0 = { x: cx, y: up ? A.y - END_GAP : A.y + A.h + END_GAP };
    const dy = Math.abs(y - p0.y), sg = up ? -1 : 1;
    const R = Math.max(0, Math.min(CORNER, dy, (E - cx) / 3));
    const k = R * 0.5523;
    if (dy - R > 0.5) segs.push({ kind: 'line', a: p0, b: { x: cx, y: y - sg * R } });
    const c0 = { x: cx, y: y - sg * R };
    h0 = { x: cx + R, y };
    if (R > 0.5) segs.push({ kind: 'cubic', a: c0, c1: { x: cx, y: c0.y + sg * k }, c2: { x: h0.x - k, y }, b: h0 });
  }

  // 3. The ease into the element. It arrives from the side, or, when the band is below (above) the
  //    element and the side approach would run over the sketch's own ink, from under (over) it.
  //    Each starts as far back on the page as stays clear of page content, so the curve stays calm.
  const arrivals: ((a: SPt) => Seg)[] = [(a) => ease(a, p3)];
  const cxB = B.x + B.w / 2;
  if (cxB > E + 2 * END_GAP) {
    if (y > B.y + B.h + END_GAP) {
      const pb = { x: cxB, y: B.y + B.h + END_GAP };
      arrivals.push((a) => ({ kind: 'cubic', a, c1: { x: a.x + (pb.x - a.x) * 0.55, y: a.y }, c2: { x: pb.x, y: pb.y + (a.y - pb.y) * 0.55 }, b: pb }));
    } else if (y < B.y - END_GAP) {
      const pa = { x: cxB, y: B.y - END_GAP };
      arrivals.push((a) => ({ kind: 'cubic', a, c1: { x: a.x + (pa.x - a.x) * 0.55, y: a.y }, c2: { x: pa.x, y: pa.y + (a.y - pa.y) * 0.55 }, b: pa }));
    }
  }
  const avoid = (o.avoid ?? []).map(F.rect);
  const span = Math.max(0, E - h0.x);
  const leads = blocked ? [0.7, 0.5, 0.35, 0.2, 0.1, 0] : [0.35];
  /** The latest start on the page whose curve stays clear of page content (the edge when none does). */
  const startFor = (arr: (a: SPt) => Seg) => {
    for (const f of leads) {
      const sx = Math.max(h0.x, E - span * f);
      if (!blocked) return sx;
      const c = arr({ x: sx, y });
      let ok = true;
      for (let i = 1; i <= 16 && ok; i++) {
        const q = segAt(c, i / 16);
        if (q.x >= E) break;
        if (blocked({ x: q.x - clear, y: q.y - clear, w: 2 * clear, h: 2 * clear })) ok = false;
      }
      if (ok) return sx;
    }
    return Math.max(h0.x, E);
  };
  /** How much of a final curve runs over the sketch's ink (its last few px, at the element, don't count). */
  const overInk = (c: Seg) => {
    let n = 0;
    for (let i = 1; i < 32; i++) {
      const q = segAt(c, i / 32);
      if (Math.hypot(q.x - c.b.x, q.y - c.b.y) < 14) continue;
      if (avoid.some((b) => q.x > b.x - 2 && q.x < b.x + b.w + 2 && q.y > b.y - 2 && q.y < b.y + b.h + 2)) n++;
    }
    return n;
  };
  let final: Seg | null = null, start = E, bestHits = Infinity;
  for (const arr of arrivals) {
    const sx = startFor(arr), c = arr({ x: sx, y }), hits = avoid.length ? overInk(c) : 0;
    if (hits < bestHits) { bestHits = hits; final = c; start = sx; } // ties keep the side arrival
  }
  if (start - h0.x > 0.5) segs.push({ kind: 'line', a: h0, b: { x: start, y } });
  segs.push(final!);

  // 4. Sample by length, so the trace runs at an even pace.
  const lens = segs.map(segLen), total = lens.reduce((s, v) => s + v, 0) || 1;
  const out: SPt[] = [segs[0].a];
  segs.forEach((s, i) => {
    const n = s.kind === 'line' ? Math.max(1, Math.round((SAMPLES * lens[i]) / total / 2)) : Math.max(8, Math.round((SAMPLES * lens[i]) / total));
    for (let j = 1; j <= n; j++) out.push(segAt(s, j / n));
  });
  return out.map(F.back);
}
