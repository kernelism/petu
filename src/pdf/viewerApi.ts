import type { TextRun } from '../locate/locateQuote';

export type PageLayers = { highlight: SVGGElement; agent: SVGGElement };

export interface ViewerApi {
  numPages(): number;
  currentPage(): number;
  /** Page-space height for the page (1000 * h / w). */
  spaceHeight(page: number): number;
  /** CSS px per page-space unit (pageW / 1000). Pages share one scale; the board (page 0) has its own. */
  scale(page?: number): number;
  layers(page: number): PageLayers | null;
  allLayers(): PageLayers[];
  textRuns(page: number): Promise<TextRun[]>;
  /**
   * With `y`: scrolls so model-y (0–1000) on `page` sits ~28% from the viewport top.
   * Without: shows the whole page, centered between the top bar and the caption when it fits.
   */
  scrollToPage(page: number, y?: number): Promise<void>;
  /** Scrolls only if model-y on `page` is outside the middle 70% of the viewport (or under the window chrome). Returns whether it scrolled. */
  ensureVisible(page: number, y?: number): Promise<boolean>;
  /**
   * The viewer's column is about to animate to `width` CSS px over `ms` (a CSS transition on the
   * column). Pages scale by transform meanwhile and re-layout and re-render once at the end,
   * keeping the reading position. Resolves once the new layout is in place (safe for scroll math).
   */
  glideColumn(width: number, ms: number): Promise<void>;
}
