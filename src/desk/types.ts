// src/desk/types.ts
import type { SPt, SRect } from '../geometry/space';
import type { PageLayers } from '../pdf/viewerApi';
import type { TextRun } from '../locate/locateQuote';
import type { Settings } from '../settings/settings';
import type { Rng, Stroke } from '../ink/agent/strokes';
import type { InkAction, Place, Pt, RegionSize, Target } from '../script/types';
import type { Registry } from './registry';

/**
 * Desk px: CSS px in the scroll content box (.pv-sizer), x from its left edge, y from its top.
 * Everything in C mode (pages, regions, connectors) lives in this frame, so it scrolls natively.
 */
export type DeskRect = { x: number; y: number; w: number; h: number };
/** Stage px: CSS px in the viewport. B mode (the takeover stage and the reference card) lives here. */
export type StageRect = { x: number; y: number; w: number; h: number };

/** Where a region sits: beside or below its page in the scroll content (C), or on the takeover stage (B). */
export type RegionMode = 'right' | 'left' | 'below' | 'b';
export type RegionSpec = { id: string; page: number; size: RegionSize; place: Place };
export type RegionInfo = {
  id: string;
  page: number;
  size: RegionSize;
  mode: RegionMode;
  /** The region's own layers, viewBox 0 0 1000 700. Same DOM nodes for the region's whole life (C↔B moves them). */
  layers: PageLayers;
  /** CSS px per region unit, right now. */
  scale(): number;
};

export type DeskMode = 'c' | 'b';
export type DeskState = {
  mode: DeskMode;
  /** False after the student scrolled or zoomed during an answer (rule 6). */
  following: boolean;
  /** A region sits beside or below a page (C): the app sets neighbouring pages back. */
  sketching: boolean;
  /** The page column in viewport px (the dock centers under it in C). */
  column: { x: number; w: number };
  /** In B: the B canvas in viewport px (the dock centers under it) and the page on the card. */
  canvas?: StageRect;
  card?: number;
};

/** What the drawing toolkit needs to draw into one target. */
export type TargetCtx = {
  target: Target;
  layers: PageLayers;
  /** Target space is 1000 × h. Page: h = 1000 · pageH / pageW. Region: 700. */
  h: number;
  /** CSS px per target-space unit, right now. */
  scale(): number;
  /** Script coords → target space. Pages scale y by h / 1000; regions are already in space. */
  toSpace(p: Pt): SPt;
  rectToSpace(r: { x: number; y: number; w: number; h: number }): SRect;
  /** Text runs in script coords (page: the PDF text layer; region: text written into it). */
  runs(): Promise<TextRun[]>;
};

/** How fast to draw: speed ≤ 1 compresses (backlog); fadeMs fades in instead of tracing. */
export type Pace = { speed: number; fadeMs?: number };

/** A resolved element, ready to draw on its word. */
export type ElementPlan = {
  target: Target;
  /** Target-space box that must be on screen before the first stroke (rule 1). */
  bbox: SRect;
  /** A connector's second end: both ends are framed together (rule 3). */
  also?: { target: Target; bbox: SRect };
  /** Draws and resolves when the ink has landed. A string is a skip reason. Aborting completes it at once. */
  draw(signal: AbortSignal, k: Pace): Promise<string | void>;
};

export type BuildEnv = {
  /** Resolves a target (ensures the page size is known). A string is a skip reason. */
  ctx(t: Target): Promise<TargetCtx | string>;
  registry: Registry;
  settings: Settings;
  /** A fresh seeded rng for hand style, or null for the other styles. */
  rng(): Rng | null;
  desk: DeskApi;
};

/** Resolves an ink action into a plan. A string is a skip reason. Implemented by Lane B (src/desk/elements.ts). */
export type BuildElement = (a: InkAction, env: BuildEnv) => Promise<ElementPlan | string>;

export type ConnectorEnd = { t: Target; r: SRect };
/** A connector the Desk owns: it re-routes `group`'s path on every relayout and C↔B switch. */
export type ConnectorHandle = { group: SVGGElement; stroke: Stroke; scale: number };

/** The desk, as the director sees it. Implemented by Lane C (src/desk/Desk.ts). */
export interface DeskApi {
  /** A new answer (or {{clear}}): fades regions and connectors out with the page marks, resumes following. */
  reset(ms: number): Promise<void>;
  /** Places a region (rules 7, 8). Resolves once it is drawable. A string is a skip reason. */
  addRegion(spec: RegionSpec): Promise<RegionInfo | string>;
  region(id: string): RegionInfo | null;
  /** Rule 1/2: moves the view (scroll, card swap, C↔B) so the target-space rect is on screen. Resolves whether it moved. */
  reveal(t: Target, r: SRect): Promise<boolean>;
  isVisible(t: Target, r: SRect): boolean;
  /** Resolves true as soon as the rect is on screen (mid-glide is fine), false after maxMs (default 1200). */
  whenVisible(t: Target, r: SRect, maxMs?: number): Promise<boolean>;
  /** Rule 3: frames both rects together; promotes the region end to B when they can't fit. */
  frameBoth(a: ConnectorEnd, b: ConnectorEnd): Promise<void>;
  /** {{scroll}}: leaves B, then frames the page (or y on it) like ViewerApi.scrollToPage. */
  scrollToPage(page: number, y?: number): Promise<void>;
  addConnector(from: ConnectorEnd, to: ConnectorEnd): ConnectorHandle | string;
  /** Rule 6: false while the student has taken over the view. */
  following(): boolean;
  /** Stops a pan in flight (a stopped answer must not keep moving the view). */
  cancel(): void;
  state(): DeskState;
  subscribe(cb: (s: DeskState) => void): () => void;
}

// ------------------------------------------------------------------------------------------------
// The viewer's side (Lane C implements it in PdfViewer; the Desk drives it).

/** Lanes reserved beside the page column: widest region + GAP_X on each side, or 0. */
export type Lanes = { left: number; right: number };
export type Column = { pageW: number; pageX: number };
/** Page geometry in desk px. */
export type PageLayout = Column & { tops: Float64Array; heights: Float64Array; total: number };

/** What the Desk needs from the viewer. Implemented by PdfViewer (ViewerApi.deskHost()). */
export interface DeskHost {
  viewport(): { W: number; H: number };
  /** The committed page layout in desk px (null before the first layout). */
  layout(): PageLayout | null;
  scrollTop(): number;
  maxScroll(): number;
  /** h / w of a page. */
  aspect(page: number): number;
  /** The desk layer: an absolutely positioned div inside .pv-sizer, above the pages. */
  layer(): HTMLDivElement;
  /** Re-lays out the pages for these lanes and below-gaps, gliding the column over `ms` (0 = at once). Resolves once committed. */
  setColumn(lanes: Lanes, gaps: ReadonlyMap<number, number>, ms: number): Promise<void>;
  /** Glides scrollTop to `top()` (re-read every frame). Resolves on arrival, abort or the student taking over. */
  glideTo(top: () => number, maxMs?: number): Promise<void>;
  cancelGlide(): void;
  /** The viewer's own page framing (ViewerApi.scrollToPage semantics). */
  scrollToPage(page: number, y?: number): Promise<void>;
  /** B: freezes the scroller and maps `page` into `rect` (stage px); null restores. Resolves after `ms`. */
  setCard(card: { page: number; rect: StageRect } | null, ms: number): Promise<void>;
  onLayout(cb: () => void): () => void;
  onScroll(cb: () => void): () => void;
  /** The student scrolled or zoomed (wheel, touch, scroll keys, ctrl+wheel, pinch, a foreign scroll). */
  onUserIntent(cb: () => void): () => void;
  onCardClick(cb: () => void): () => void;
}
