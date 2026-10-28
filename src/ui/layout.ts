// src/ui/layout.ts
import type { DeskState } from '../desk/types';

/** The dock is this wide at most, and keeps 16px from its column's edges. */
export const DOCK_MAX = 560;

/**
 * Where the dock (caption + ask bar) sits: centered under the page column in C (the window's
 * center when no lane is reserved), under the canvas on the B stage.
 */
export function dockPlacement(W: number, s: DeskState | null): { x: number; w: number } {
  const col = !s ? { x: 0, w: W } : s.mode === 'b' && s.canvas ? s.canvas : s.column;
  return { x: col.x + col.w / 2, w: Math.max(0, Math.min(DOCK_MAX, col.w - 32)) };
}

/** The caption sits this far above the ask bar (ui.css: bottom: calc(100% + 6px)). */
const CAPTION_GAP = 6;
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
