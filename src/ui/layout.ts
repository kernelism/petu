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
