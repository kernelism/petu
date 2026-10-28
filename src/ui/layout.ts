// src/ui/layout.ts
import type { DeskState } from '../desk/types';

/** The dock is this wide at most, and never wider than its column. */
export const DOCK_MAX = 560;

/**
 * Where the dock (caption + ask bar, one unit) sits: centred under the slide column (the page
 * column while reading, the slide column pinned left in a split), as wide as it up to DOCK_MAX.
 */
export function dockPlacement(W: number, s: DeskState | null): { x: number; w: number } {
  const col = s ? s.column : { x: 16, w: W - 32 };
  return { x: col.x + col.w / 2, w: Math.max(0, Math.min(DOCK_MAX, col.w)) };
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
