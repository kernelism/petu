import type { Pt } from '../script/types';

/** Page space: overlay viewBox is 0 0 1000 H, with H = 1000 * pageHeight / pageWidth. */
export type SPt = { x: number; y: number };
export type SRect = { x: number; y: number; w: number; h: number };
/** Rect in model coords (both axes 0–1000). */
export type PageRect = { x: number; y: number; w: number; h: number };

export const spaceHeight = (pageW: number, pageH: number) => (1000 * pageH) / pageW;
export const toSpace = (p: Pt, H: number): SPt => ({ x: p.x, y: (p.y * H) / 1000 });
export const rectToSpace = (r: PageRect, H: number): SRect => ({ x: r.x, y: (r.y * H) / 1000, w: r.w, h: (r.h * H) / 1000 });
