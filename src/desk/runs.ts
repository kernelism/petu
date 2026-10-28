// src/desk/runs.ts
import type { TextRun } from '../locate/locateQuote';

type Box = { x: number; y: number; width: number; height: number };

/** A rendered text's bbox (region space, from getBBox) → a text run. Region space is the script's coords: no scaling. */
export const measureToRun = (b: Box, text: string): TextRun => ({ text, rect: { x: b.x, y: b.y, w: b.width, h: b.height } });

/** Text runs for every text written into `root` (elements tagged `data-run`), in writing order. */
export function regionRuns(root: SVGGElement | null): TextRun[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<SVGTextElement>('text[data-run]')).map((t) => measureToRun(t.getBBox(), t.textContent ?? ''));
}
