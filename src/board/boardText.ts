import type { TextRun } from '../locate/locateQuote';
import type { PageLayers } from '../pdf/viewerApi';
import type { SPt } from '../geometry/space';
import type { InkStyle } from '../ink/agent/marks';

/** Board space is a fixed 1000 × 700 sheet. */
export const BOARD_W = 1000;
export const BOARD_H = 700;

/** Board ink is dark by default; `em` shapes use the accent ink color. */
export const BOARD_INK = '#1D1D1F';

export type WriteOpts = { style: InkStyle; signal?: AbortSignal };

/** What the director and the viewer passthrough need from the board. */
export type BoardHandle = {
  layers(): PageLayers | null;
  textRuns(): TextRun[];
  /** CSS px per board-space unit. */
  scale(): number;
  write(at: SPt, text: string, size: 's' | 'm' | 'l', o: WriteOpts): Promise<void>;
};

type Box = { x: number; y: number; width: number; height: number };

/** A rendered board text's bounding box (board space, from getBBox) → a text run in model coords. */
export function measureToRun(bbox: Box, text: string): TextRun {
  const k = 1000 / BOARD_H;
  return { text, rect: { x: bbox.x, y: bbox.y * k, w: bbox.width, h: bbox.height * k } };
}

/** Text runs for every written text in `root`, in writing order (elements tagged `data-run`). */
export function boardRuns(root: SVGGElement | null): TextRun[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<SVGTextElement>('text[data-run]')).map((t) => measureToRun(t.getBBox(), t.textContent ?? ''));
}
