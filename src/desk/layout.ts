// src/desk/layout.ts
import type { Column, DeskRect, Lanes, PageLayout, RegionMode, StageRect } from './types';

export type { Column, Lanes, PageLayout } from './types';
import type { Place, RegionSize } from '../script/types';

/**
 * Desk geometry, all pure. Desk px = CSS px in the scroll content (.pv-sizer): x from its left
 * edge (= the viewport's, there is no horizontal scroll), y from its top. Stage px = viewport px.
 */

export const TOP_PAD = 72;
export const BOTTOM_PAD = 200;
/** Between pages. */
export const PAGE_GAP = 24;
export const MAX_PAGE_W = 860;
/** Side margin total when no lane is reserved (32 each side). */
export const SIDE = 64;
export const MIN_PAGE_W = 200;
/** In C, a page narrower than this means the sketch doesn't fit beside it: B instead. */
export const C_MIN_PAGE_W = 520;
/** Page edge ↔ region. */
export const GAP_X = 32;
/** Region ↔ window edge, on the right. */
export const EDGE = 24;
/** Left content edge when a left lane exists: the canvas toolbar (16 + 44) plus 16. */
export const TOOLBAR_CLEAR = 76;
/** Between stacked regions, and around a region below its page. */
export const GAP_Y = 24;
/** Window chrome over the scroller: top bar above, caption + ask bar below. */
export const SAFE_TOP = 64;
export const SAFE_BOTTOM = 156;
export const REGION_ASPECT = 0.7;

export const band = (H: number) => Math.max(0, H - SAFE_TOP - SAFE_BOTTOM);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A region's width in CSS px (C mode). Height is 0.7 × width. `l` is always B. */
export function regionWidth(size: RegionSize, W: number): number {
  return Math.round(size === 's' ? clamp(0.26 * W, 340, 440) : clamp(0.36 * W, 420, 600));
}


/** The page column for a window `W` wide with lanes reserved (lane = widest region + GAP_X, or 0). */
export function column(W: number, lanes: Lanes): Column {
  if (!lanes.left && !lanes.right) {
    const pageW = Math.max(MIN_PAGE_W, Math.min(W - SIDE, MAX_PAGE_W));
    return { pageW, pageX: (W - pageW) / 2 };
  }
  // With lanes the column moves off center, so it must clear the canvas toolbar on the left.
  const lo = TOOLBAR_CLEAR;
  const hi = W - (lanes.right ? EDGE : SIDE / 2);
  const room = hi - lo;
  const pageW = Math.max(MIN_PAGE_W, Math.min(MAX_PAGE_W, room - lanes.left - lanes.right));
  const start = lo + Math.max(0, (room - lanes.left - pageW - lanes.right) / 2);
  return { pageW, pageX: start + lanes.left };
}


/** Page tops for a column, with extra room after some pages (regions placed below them). */
export function computeLayout(col: Column, aspects: Float64Array, gapsAfter: ReadonlyMap<number, number> = new Map()): PageLayout {
  const n = aspects.length;
  const tops = new Float64Array(n), heights = new Float64Array(n);
  let y = TOP_PAD;
  for (let i = 0; i < n; i++) {
    tops[i] = y;
    heights[i] = col.pageW * aspects[i];
    y += heights[i] + (gapsAfter.get(i + 1) ?? 0) + (i < n - 1 ? PAGE_GAP : 0);
  }
  return { ...col, tops, heights, total: y + BOTTOM_PAD };
}

/** 1-based page whose slot (including the gap below it) contains content-y `y`. */
export function pageAt(L: { tops: Float64Array }, y: number): number {
  let lo = 0, hi = L.tops.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (L.tops[mid] <= y) lo = mid; else hi = mid - 1;
  }
  return lo + 1;
}

// ------------------------------------------------------------------------------------------------
// Regions

export type RegionReq = { id: string; page: number; size: RegionSize; place: Place; /** Promoted by rule 3 for this answer. */ forceB?: boolean };
export type Placed = RegionReq & { mode: RegionMode };

/** Lanes reserved by C regions. */
export function lanesFor(placed: Placed[], W: number): Lanes {
  const w = (side: RegionMode) => Math.max(0, ...placed.filter((p) => p.mode === side).map((p) => regionWidth(p.size, W)));
  const l = w('left'), r = w('right');
  return { left: l ? l + GAP_X : 0, right: r ? r + GAP_X : 0 };
}

/** Extra room after pages that have regions below them. */
export function gapsFor(placed: Placed[], W: number, col: Column): Map<number, number> {
  const gaps = new Map<number, number>();
  for (const p of placed) {
    if (p.mode !== 'below') continue;
    const h = Math.min(regionWidth(p.size, W), col.pageW) * REGION_ASPECT;
    gaps.set(p.page, (gaps.get(p.page) ?? GAP_Y) + h + GAP_Y);
  }
  return gaps;
}

/**
 * Decides where each region goes, in request order (rule 7: re-run on every resize with the same
 * requests, so C↔B follows the window). `l` and promoted regions are B. `auto` tries right (left
 * first when the right lane already holds a region for the same page), then left, then below,
 * then B. An explicit place that doesn't fit falls back to B.
 */
export function placeAll(reqs: RegionReq[], W: number, H: number): Placed[] {
  const out: Placed[] = [];
  for (const r of reqs) {
    if (r.size === 'l' || r.forceB) { out.push({ ...r, mode: 'b' }); continue; }
    const rightTaken = out.some((p) => p.mode === 'right' && p.page === r.page);
    const order: RegionMode[] = r.place === 'auto' ? (rightTaken ? ['left', 'right', 'below'] : ['right', 'left', 'below']) : [r.place];
    const mode = order.find((m) => fits({ ...r, mode: m }, out, W, H)) ?? 'b';
    out.push({ ...r, mode });
  }
  return out;
}

function fits(p: Placed, others: Placed[], W: number, H: number): boolean {
  const w = regionWidth(p.size, W), h = w * REGION_ASPECT;
  if (h > band(H)) return false;
  if (p.mode === 'below') return w <= column(W, lanesFor(others, W)).pageW;
  return column(W, lanesFor([...others, p], W)).pageW >= C_MIN_PAGE_W;
}

/** Desk rects of the C regions for a page layout. B regions are absent (see stageLayout). */
export function regionRects(placed: Placed[], L: PageLayout, W: number): Map<string, DeskRect> {
  const out = new Map<string, DeskRect>();
  const bottom = { left: -Infinity, right: -Infinity };
  const belowY = new Map<number, number>();
  for (const p of placed) {
    if (p.mode === 'b') continue;
    const i = p.page - 1;
    if (p.mode === 'below') {
      const w = Math.min(regionWidth(p.size, W), L.pageW), h = w * REGION_ASPECT;
      const y = belowY.get(p.page) ?? L.tops[i] + L.heights[i] + GAP_Y;
      out.set(p.id, { x: L.pageX + (L.pageW - w) / 2, y, w, h });
      belowY.set(p.page, y + h + GAP_Y);
      continue;
    }
    const w = regionWidth(p.size, W), h = w * REGION_ASPECT;
    const x = p.mode === 'right' ? L.pageX + L.pageW + GAP_X : L.pageX - GAP_X - w;
    // Beside its page, vertically centered on it when shorter; never overlapping the region above.
    const y = Math.max(L.tops[i] + Math.max(0, (L.heights[i] - h) / 2), bottom[p.mode] + GAP_Y);
    out.set(p.id, { x, y, w, h });
    bottom[p.mode] = y + h;
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
// B: the takeover stage

export type Stage = { canvas: StageRect; card: StageRect; region: StageRect };

/** The B stage for a W × H window and a card page of aspect h/w. */
export function stageLayout(W: number, H: number, aspect: number): Stage {
  const canvas = { x: TOOLBAR_CLEAR, y: SAFE_TOP, w: Math.max(0, W - TOOLBAR_CLEAR - EDGE), h: band(H) };
  let cw = clamp(0.24 * canvas.w, 220, 340);
  if (cw * aspect > canvas.h * 0.6) cw = (canvas.h * 0.6) / aspect;
  const card = { x: canvas.x + 16, y: canvas.y + 16, w: cw, h: cw * aspect };
  const x0 = card.x + card.w + 40, x1 = canvas.x + canvas.w - 16, y0 = canvas.y + 8, y1 = canvas.y + canvas.h - 8;
  const w = Math.max(0, Math.min(x1 - x0, (y1 - y0) / REGION_ASPECT)), h = w * REGION_ASPECT;
  return { canvas, card, region: { x: x0 + (x1 - x0 - w) / 2, y: y0 + (y1 - y0 - h) / 2, w, h } };
}

// ------------------------------------------------------------------------------------------------
// Visibility and framing (rules 1–3), in desk px against a scroll position.

export type View = { top: number; H: number; max: number };

/** Whether a desk rect is on screen clear of the chrome. A rect taller than the band counts when its top is in the band's top 15%. */
export function inView(r: DeskRect, v: View): boolean {
  const lo = v.top + SAFE_TOP, hi = v.top + v.H - SAFE_BOTTOM;
  if (r.h <= hi - lo) return r.y >= lo - 1 && r.y + r.h <= hi + 1;
  return r.y >= lo - 1 && r.y <= lo + (hi - lo) * 0.15;
}

/** Whether the rects fit on screen together. */
export function fitTogether(rs: DeskRect[], H: number): boolean {
  const y1 = Math.min(...rs.map((r) => r.y)), y2 = Math.max(...rs.map((r) => r.y + r.h));
  return y2 - y1 <= band(H);
}

/** Scroll top that centers rect `r` in the band (top-aligned when taller), clamped to [0, max]. A rect that isn't finite stays at `v.top`. */
export function frameTop(r: DeskRect, v: { H: number; max: number; top?: number }): number {
  if (!Number.isFinite(r.y) || !Number.isFinite(r.h)) return v.top ?? 0;
  const b = band(v.H);
  const t = r.h <= b ? r.y - SAFE_TOP - (b - r.h) / 2 : r.y - SAFE_TOP;
  return clamp(t, 0, Math.max(0, v.max));
}
