// src/ui/layout.ts
import type { DeskState } from '../desk/types';
import { sheetToWindowX, type OverviewViewState } from '../pdf/overview';

/** The dock is this wide at most, and never wider than its column. */
export const DOCK_MAX = 560;
/** From LARGE_W wide windows up the chrome takes its large step (ui.css `@media (min-width: 2000px)`): a wider dock. */
export const LARGE_W = 2000;
export const DOCK_MAX_LARGE = 680;

/** The dock's widest, for a window W px wide. */
export const dockMax = (W: number) => (W >= LARGE_W ? DOCK_MAX_LARGE : DOCK_MAX);
/** Layout C: the dock keeps this much of its column clear on each side. */
export const LANE_DOCK_AIR = 22;

/** The ask bar's + hangs this far left of the dock (its width and gap: ui.css .dock-new); 0 while it is hidden. */
export const newQuestionReserve = (W: number) => (W >= LARGE_W ? 44 : 40) + 12;

/**
 * The column the dock sits under: the slide column (the page column while reading, the slide column
 * pinned left in a split). In the lane (layout C) always the page column, never the lane: following
 * the pen made it jump between the two mid-answer and cover the lane's drawing (QA M4).
 */
export function dockColumn(W: number, s: DeskState | null): { x: number; w: number } {
  if (!s) return { x: 16, w: W - 32 };
  return s.lane && s.page ? s.page : s.column;
}

/**
 * Where the dock (caption + ask bar, one unit) sits: centred under dockColumn, as wide as it up to
 * dockMax(W). `reserveLeft`: room the + needs left of it (the dock moves or narrows to keep it in the window).
 */
export function dockPlacement(W: number, s: DeskState | null, view?: OverviewViewState, reserveRight = 0, reserveLeft = 0): { x: number; w: number } {
  const col = windowColumn(dockColumn(W, s), W, view);
  // The lane (layout C): centred under the page column, with air either side (mockups C1, C2).
  const inset = s?.lane ? 2 * LANE_DOCK_AIR : 0;
  let w = Math.max(0, Math.min(dockMax(W), col.w - inset));
  // The overview zoom can push the column half off the window: the dock keeps a readable width.
  w = Math.max(w, Math.min(DOCK_MIN, W - 2 * DOCK_EDGE));
  let x = col.x + col.w / 2;
  // Room for the + on the left, inside the dock's own column (in the lane it never hangs over the page): the
  // dock gives it up from its left side first (its right edge stays put), down to DOCK_MIN; past that it moves right.
  const short = Math.max(DOCK_EDGE, col.x + (s?.lane ? LANE_DOCK_AIR / 2 : 0)) + Math.max(0, reserveLeft) - (x - w / 2);
  if (short > 0) { const cut = Math.min(short, Math.max(0, w - DOCK_MIN)); w -= cut; x += cut / 2; }
  // One authority for the bottom band: the dock stays inside the window and clear of the control on its
  // right (the overview pill, `reserveRight` px from the right edge, when shown), narrowing if it must.
  const lo = DOCK_EDGE + Math.max(0, reserveLeft), hi = W - DOCK_EDGE - Math.max(0, reserveRight);
  if (hi - lo >= DOCK_MIN) w = Math.min(w, hi - lo);
  const right = hi - lo >= DOCK_MIN ? hi : W - DOCK_EDGE;
  x = Math.max(lo + w / 2, Math.min(right - w / 2, x));
  return { x, w };
}

/** The dock never comes closer to the window's sides than this; nor narrower than DOCK_MIN (room permitting). */
export const DOCK_EDGE = 16;
export const DOCK_MIN = 340;

/** A sheet column (layout px) as it shows in the window under the overview zoom, clipped to the window. */
export function windowColumn(col: { x: number; w: number }, W: number, view?: OverviewViewState): { x: number; w: number } {
  if (!view || (view.z === 1 && view.panX === 0)) return col;
  const a = Math.max(0, sheetToWindowX(col.x, W, view)), b = Math.min(W, sheetToWindowX(col.x + col.w, W, view));
  return b > a ? { x: a, w: b - a } : { x: Math.min(Math.max(a, 0), W), w: 0 };
}

/** The caption sits right on the ask bar: one unit, no gap (ui.css .caption bottom: 100%). */
const CAPTION_GAP = 0;
/** The question line above the narration: 18px line + 4px margin (ui.css .caption-q). */
const QUESTION_LINE = 22;
/** Framed content keeps this much air above the caption. */
const CAPTION_CLEAR = 12;

/**
 * Height of the window's bottom band the dock can cover, at its tallest (a question line plus two
 * narration lines over the ask bar), from measured parts: what framing must keep content above.
 */
export function dockReserve(m: { bottom: number; askbar: number; capPad: number; capLine: number }): number {
  return m.bottom + m.askbar + CAPTION_GAP + m.capPad + QUESTION_LINE + 2 * m.capLine + CAPTION_CLEAR;
}
