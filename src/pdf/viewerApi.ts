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
  /** The viewer's side of the desk (the split glide, scroll and user-intent events). */
  deskHost(): DeskHost;
  /**
   * Overview zoom of the whole surface (layout C, the lane, only; src/pdf/overview.ts): 1 = reading
   * size, 0.5–2. The setters are the reader's (they stop follow) and glide about the window's centre;
   * pinch, ⌘+wheel, Safari gestures, Z and ⌘± drive the same zoom. No-ops below the lane's width.
   * Optional so test doubles of the viewer need not stub them (the real viewer has them all).
   */
  overview?(): number;
  /** 'fit': the overview (50% until the desk can name the answer's extent). */
  setOverview?(z: number | 'fit'): void;
  stepOverview?(dir: 1 | -1): void;
  /** 100% ↔ fit (Z). */
  toggleOverview?(): void;
  onOverview?(cb: (z: number) => void): () => void;
}
