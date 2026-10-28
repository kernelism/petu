/** Model coordinates: x 0–1000 across page width, y 0–1000 down page height. */
export type Pt = { x: number; y: number };

/** The board is page 0: a blank 1000 × 700 sheet (model y 0–1000 maps to space y 0–700). */
export const BOARD_PAGE = 0;

/**
 * Anchored forms (`quote`) are preferred: they resolve against the PDF text layer, so they are
 * pixel-exact. `near` disambiguates repeated text (pick the occurrence closest to that point).
 * Coordinate forms are for free-space drawing on figures.
 */
export type Action =
  | { kind: 'scroll'; page: number; y?: number }
  | { kind: 'highlight'; page: number; quote: string; near?: Pt }
  | { kind: 'underline'; page: number; quote: string; near?: Pt }
  /** rx, ry are in width units (1000 = page width) so `r` gives a true circle. */
  | { kind: 'circle'; page: number; at: Pt; rx: number; ry: number; em?: boolean }
  | { kind: 'circle'; page: number; quote: string; near?: Pt; em?: boolean }
  | { kind: 'line'; page: number; from: Pt; to: Pt; em?: boolean }
  | { kind: 'arrow'; page: number; from: Pt; to: Pt; em?: boolean }
  /** at = top-left corner; w in x units, h in y units. */
  | { kind: 'box'; page: number; at: Pt; w: number; h: number; em?: boolean }
  | { kind: 'box'; page: number; quote: string; near?: Pt; em?: boolean }
  | { kind: 'label'; page: number; at: Pt; text: string }
  /** Opens the board (side by side with the PDF). */
  | { kind: 'board' }
  /** Writes text on the board. `at` = left edge, vertical middle of the text. */
  | { kind: 'write'; page: number; at: Pt; text: string; size: 's' | 'm' | 'l' }
  | { kind: 'clear' };

export type ScriptEvent =
  | { type: 'word'; text: string }
  | { type: 'action'; action: Action }
  | { type: 'end' };
