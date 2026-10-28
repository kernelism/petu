// src/agent/context/textLines.ts (T0: types only; Lane G adds the functions)
import type { TextRun } from '../../locate/locateQuote';
import type { PageRect } from '../../geometry/space';

/**
 * One visual line segment of text, as the model sees it and as the locator searches it: the page's
 * runs grouped by baseline band, sorted left to right, split at wide gaps (columns, figure labels).
 * Equation glyphs (one run per glyph, in arbitrary stream order) come out in reading order.
 */
export type TextLine = {
  id: string; // t1, t2, … in reading order
  text: string;
  rect: PageRect; // model coords
  runs: TextRun[];
  /** Mostly single-glyph runs: an equation (quote small parts; box with mark=). */
  math: boolean;
};
