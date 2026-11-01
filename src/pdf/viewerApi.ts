import type { TextRun } from '../locate/locateQuote';
import type { DeskHost } from '../desk/types';

export type PageLayers = { highlight: SVGGElement; agent: SVGGElement };

/**
 * Who moves to a page. `answer`: the tutor (like scrollToPage; the page counts as acted on).
 * Anything else (`student`: the page field or a key; `back`: "Back to pN") is the student taking the
 * view: follow mode pauses mid-answer and the acted-on page is cleared.
 */
export type GoReason = 'answer' | 'student' | 'back';

export interface ViewerApi {
  numPages(): number;
  /** The page under the reading line (35% down): the indicator's when the tutor has no focus page. */
  currentPage(): number;
  /**
   * The page a question is asked about when nothing names one: the most visible page between the top
   * bar and the dock, the reading line's on a tie (src/desk/layout.ts mostVisiblePage). Optional so
   * test doubles need not stub it (callers fall back to currentPage()).
   */
  mostVisiblePage?(): number;
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
  /**
   * Shows `page` whole (framed as scrollToPage without y), clamped to the document. A far jump cuts
   * to just short of the page and glides the rest. Resolves when it lands (or is interrupted).
   */
  goToPage(page: number, opts?: { reason?: GoReason }): Promise<void>;
  /**
   * The page the tutor last acted on (scrolled to, revealed, or inked while it was in view), until
   * the student takes the view; null if none. The page slot carries `.is-acted` and the scroller
   * `.has-acted` (app.css sets the other pages back only then).
   */
  actedPage(): number | null;
  /** Called with the acted-on page whenever it changes. Returns the unsubscribe. */
  onActedChange(cb: (page: number | null) => void): () => void;
  /** The student's page zoom (1 = fitted to the column). */
  pageZoom(): number;
  /** Sets the page zoom (clamped), about the reading line. */
  setPageZoom(z: number): void;
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
