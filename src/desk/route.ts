// src/desk/route.ts
import type { SPt } from '../geometry/space';
import type { Stroke } from '../ink/agent/strokes';

type Rect = { x: number; y: number; w: number; h: number };

/**
 * Where a page has content: a coarse grid over the page (row-major, 1 = something is printed in
 * that cell). Resolution-independent, so one mask serves the page at any width.
 */
export type ContentMask = { cols: number; rows: number; cells: Uint8Array };

/** Clearance between a connector's ends and the things it joins. */
export const END_GAP = 6;
/** Samples along the whole path (spread by length). */
const SAMPLES = 48;
/** A detour costs this much more than leaving straight at the anchor's height. */
const TURN_COST = 12;
/** How much the element's height pulls the sideways run toward it. */
const PULL = 0.35;

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
// ------------------------------------------------------------------------------------------------
// Split layout: page → gutter → board.

export type GutterOpts = {
  /** The anchor's page, view px. */
  page: Rect;
  /** The x of the gutter's middle, between the page's right edge and the board. */
  gutterX: number;
  /** Whether page content touches a rect (view px). Unknown (page not rendered yet): treated as clear. */
  blocked?: (r: Rect) => boolean;
  /** The slides' visible band: the run along the page stays inside it. */
  band?: { y0: number; y1: number };
  /** Whether board content (other than the target) touches a rect (view px). Absent: the board is clear. */
  boardBlocked?: (r: Rect) => boolean;
  /** The board's visible rect (view px): the arrival stays inside it. */
  board?: Rect;
};

/** Half-width of the corridor a board run must keep clear. */
const BOARD_CLEAR = 4;
/** The farthest a top/bottom arrival runs above/below the target (view px). */
const BOARD_DETOUR_MAX = 600;

type Arrival = { kind: 'side'; y: number } | { kind: 'top' | 'bottom'; y: number; x: number; edge: number };

/**
 * How the connector enters the board to reach `to` from the gutter at `gx`: level into the
 * target's left edge at a clear height within its span (centre first, then outward); else level at
 * a clear height above (below) the target to over its left part, then down (up) into it; else
 * straight in at the centre (the old route).
 */
function boardArrival(to: Rect, gx: number, blocked: (r: Rect) => boolean, board?: Rect): Arrival {
  const c = BOARD_CLEAR, tx = to.x - END_GAP, cy = to.y + to.h / 2;
  const yMin = board ? board.y + c : -Infinity, yMax = board ? board.y + board.h - c : Infinity;
  const side = (y: number): Rect => ({ x: gx, y: y - c, w: Math.max(0, tx - gx), h: 2 * c });
  const half = Math.max(0, to.h / 2 - 2);
  for (let d = 0; d <= half; d += 2) {
    for (const y of d ? [cy - d, cy + d] : [cy]) if (y >= yMin && y <= yMax && !blocked(side(y))) return { kind: 'side', y };
  }
  // Over the target's left part first, then further right along its top (bottom).
  const x0 = to.x + Math.min(to.w * 0.25, 24);
  const xs = [x0];
  for (let x = to.x + 4; x <= to.x + to.w - 4; x += 8) if (Math.abs(x - x0) > 1) xs.push(x);
  let best: Arrival | null = null, bestCost = Infinity;
  for (const kind of ['top', 'bottom'] as const) {
    const sg = kind === 'top' ? -1 : 1;
    const edge = kind === 'top' ? to.y - END_GAP : to.y + to.h + END_GAP;
    for (const x of xs) {
      for (let k = 0; ; k++) {
        const h = edge + sg * (RADIUS + 2 + 2 * k);
        if (h < yMin || h > yMax || Math.abs(h - edge) > BOARD_DETOUR_MAX) break;
        // The drop only grows as the level run moves away: once blocked, it stays blocked.
        if (blocked({ x: x - c, y: Math.min(h, edge), w: 2 * c, h: Math.abs(edge - h) })) break;
        if (blocked({ x: gx, y: h - c, w: Math.max(0, x + c - gx), h: 2 * c })) continue;
        const cost = Math.abs(h - edge) + 0.5 * Math.abs(x - x0);
        if (cost < bestCost) { bestCost = cost; best = { kind, y: h, x, edge }; }
        break;
      }
    }
  }
  return best ?? { kind: 'side', y: cy };
}

/** The short vertical exit from an anchor to its run may pass the anchor's own figure, never further than this share of the page height. */
const HOOK_MAX = 0.3;
/** A hook that passes content costs this much more than a clear one. */
const HOOK_BLOCKED_COST = 400;
/** Gutter corners. */
const RADIUS = 10;

/**
 * A connector in the split layout: from the page anchor (`from`) to a board element (`to`), view px.
 * It leaves the anchor (straight out at its height, or by a short vertical exit), runs level to the
 * page's right edge along a band clear of page content, turns into the gutter, runs vertically there
 * to the element's height, and turns into the board to the element (clear of `boardBlocked`: into its
 * side at a clear height, else over/under other board content into its top/bottom) — rounded corners, no diagonal
 * across the slide. Null when no level run to the page edge is clear of content (the caller drops it).
 */
export function routeGutter(from: Rect, to: Rect, o: GutterOpts): Stroke | null {
  const P = o.page, E = P.x + P.w, gx = o.gutterX;
  const T = { x: to.x - END_GAP, y: to.y + to.h / 2 };
  if (!(T.x > gx + 2) || !(gx > E)) return null;
  const clear = Math.max(4, Math.min(12, P.w * 0.012));
  const cx = from.x + from.w / 2, cy = from.y + from.h / 2;
  const top = from.y - END_GAP, bottom = from.y + from.h + END_GAP;
  const inSpan = (v: number) => v >= from.y && v <= from.y + from.h;
  const run = (v: number): Rect => {
    const x0 = inSpan(v) ? from.x + from.w + END_GAP : cx - clear;
    return { x: x0, y: v - clear, w: Math.max(0, E - x0), h: 2 * clear };
  };
  const hook = (v: number): Rect => (v < from.y
    ? { x: cx - clear / 2, y: v, w: clear, h: Math.max(0, top - v) }
    : { x: cx - clear / 2, y: bottom, w: clear, h: Math.max(0, v - bottom) });
  const y0 = Math.max(P.y + clear + 2, o.band?.y0 ?? -Infinity), y1 = Math.min(P.y + P.h - clear - 2, o.band?.y1 ?? Infinity);
  const hookMax = P.h * HOOK_MAX;
  let v = NaN, best = Infinity;
  for (let y = y0; y <= y1; y += 2) {
    const span = inSpan(y);
    if (!span && Math.abs(y - cy) - from.h / 2 > hookMax) continue;
    if (o.blocked?.(run(y))) continue;
    const cost = Math.abs(y - cy) + PULL * Math.abs(y - T.y) + (span ? 0 : TURN_COST) + (!span && o.blocked?.(hook(y)) ? HOOK_BLOCKED_COST : 0);
    if (cost < best) { best = cost; v = y; }
  }
  if (Number.isNaN(v)) return null;

  const segs: Seg[] = [];
  const corner = (a: SPt, c: SPt, b: SPt): Seg => ({ kind: 'cubic', a, c1: { x: a.x + (c.x - a.x) * 0.5523, y: a.y + (c.y - a.y) * 0.5523 }, c2: { x: b.x + (c.x - b.x) * 0.5523, y: b.y + (c.y - b.y) * 0.5523 }, b });
  const line = (a: SPt, b: SPt) => { if (Math.hypot(b.x - a.x, b.y - a.y) > 0.5) segs.push({ kind: 'line', a, b }); };
  // 1. Out of the anchor onto the run.
  let p: SPt;
  if (inSpan(v)) p = { x: from.x + from.w + END_GAP, y: v };
  else {
    const sg = v < cy ? -1 : 1;
    const start = { x: cx, y: sg < 0 ? top : bottom };
    const R = Math.max(0, Math.min(RADIUS, Math.abs(v - start.y), (E - cx) / 3));
    line(start, { x: cx, y: v - sg * R });
    p = { x: cx + R, y: v };
    if (R > 0.5) segs.push(corner({ x: cx, y: v - sg * R }, { x: cx, y: v }, p));
  }
  // 2. Level to the gutter, down (or up) the gutter, into the board: level into the target's side,
  // or level over it and down (up) into its top (bottom) when the board between is in the way.
  const arr: Arrival = o.boardBlocked ? boardArrival(to, gx, o.boardBlocked, o.board) : { kind: 'side', y: T.y };
  const yA = arr.y;
  const Rb = arr.kind === 'side' ? 0 : Math.max(0, Math.min(RADIUS, Math.abs(arr.edge - yA), (arr.x - gx) / 2));
  const levelEnd: SPt = { x: (arr.kind === 'side' ? T.x : arr.x) - Rb, y: yA };
  const dy = yA - v;
  if (Math.abs(dy) < 1.5) { line(p, levelEnd); }
  else {
    const sg = Math.sign(dy);
    const R = Math.max(0, Math.min(RADIUS, Math.abs(dy) / 2, gx - p.x, levelEnd.x - gx));
    line(p, { x: gx - R, y: v });
    segs.push(corner({ x: gx - R, y: v }, { x: gx, y: v }, { x: gx, y: v + sg * R }));
    line({ x: gx, y: v + sg * R }, { x: gx, y: yA - sg * R });
    segs.push(corner({ x: gx, y: yA - sg * R }, { x: gx, y: yA }, { x: gx + R, y: yA }));
    line({ x: gx + R, y: yA }, levelEnd);
  }
  if (arr.kind !== 'side') {
    const sg = arr.kind === 'top' ? 1 : -1;
    const turn = { x: arr.x, y: yA + sg * Rb };
    if (Rb > 0.5) segs.push(corner(levelEnd, { x: arr.x, y: yA }, turn));
    line(Rb > 0.5 ? turn : levelEnd, { x: arr.x, y: arr.edge });
  }
  // 3. Sampled by length, so the trace runs at an even pace.
  const lens = segs.map(segLen), total = lens.reduce((s, x) => s + x, 0) || 1;
  const out: SPt[] = [segs[0].a];
  segs.forEach((s, i) => {
    const n = s.kind === 'line' ? Math.max(1, Math.round((SAMPLES * lens[i]) / total)) : 6;
    for (let j = 1; j <= n; j++) out.push(segAt(s, j / n));
  });
  return out;
}
