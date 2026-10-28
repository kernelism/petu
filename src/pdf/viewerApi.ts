import type { TextRun } from '../locate/locateQuote';
import type { DeskHost } from '../desk/types';

export type PageLayers = { highlight: SVGGElement; agent: SVGGElement };

export interface ViewerApi {
  numPages(): number;
  currentPage(): number;
  /** Page-space height for the page (1000 * h / w). */
  spaceHeight(page: number): number;
  /** CSS px per page-space unit (pageW / 1000). Pages share one scale. */
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
  /** Whether model-y on `page` is on screen now, clear of the window chrome. */
  isVisible(page: number, y?: number): boolean;
  /**
   * Resolves true as soon as model-y on `page` is on screen (mid-glide is fine: ink may start while
   * the page is still moving), or false after `maxMs`.
   */
  whenVisible(page: number, y?: number, maxMs?: number): Promise<boolean>;
  /** Resolves once `page`'s true size is in the layout, so spaceHeight() and scroll math are exact. */
  ensureSize(page: number): Promise<void>;
  /** Stops a programmatic glide in flight (a stopped answer must not keep scrolling). */
  cancelScroll(): void;
  /** The viewer's side of the desk (lanes, the desk layer, B's card transform, user-intent events). */
  deskHost(): DeskHost;
}
