// src/desk/types.ts
import type { SPt, SRect } from '../geometry/space';
import type { PageLayers } from '../pdf/viewerApi';
import type { TextRun } from '../locate/locateQuote';
import type { Settings } from '../settings/settings';
import type { Rng, Stroke } from '../ink/agent/strokes';
import type { InkAction, Pt, RegionSize, Target } from '../script/types';
import type { Registry } from './registry';
import type { ContentMask } from './route';
import type { Split } from './layout';

/** Desk px: CSS px in the scroll content box (.pv-sizer), x from its left edge, y from its top. Pages live here. */
export type DeskRect = { x: number; y: number; w: number; h: number };
/** View px: CSS px in the viewport. The board and the connectors live here. */
export type ViewRect = { x: number; y: number; w: number; h: number };

/**
 * A sketch region: one section on the board. `page` is the slide it explains (its body text sets
 * the section's type size); `body` is that slide's body text height as a fraction of the page width.
 */
export type RegionSpec = { id: string; page: number; size: RegionSize; body?: number | null; /** Board v2: one 2-D scene with a camera, continued by later answers. */ scene?: boolean };

/**
 * Board v2 (spec "Board v2: one connected scene"): a scene section is an unbounded 2-D world (the
 * section's units, y down) seen through a camera that pans and zooms to frame the current action.
 * Elements claim room in it, so later ones are placed clear of them (src/desk/scene/place.ts). Claims
 * persist with the section across answers (a follow-up continues the scene).
 */
export type SceneClaim = { r: SRect; move(r: SRect): void; drop(): void; /** A label's or a connection's room: kept clear, never an anchor for "the last thing". */ minor?: boolean };
export type SceneSpace = {
  claim(r: SRect, minor?: boolean): SceneClaim;
  /** Every claimed rect (earlier answers' included). */
  rects(): SRect[];
  /** The camera's world rect now. */
  view(): SRect;
  /** The most recent thing's claim (where the explanation is; labels and links aside), or null. */
  last(): SRect | null;
  /** The union of every claim, or null. */
  extent(): SRect | null;
};
export type RegionInfo = {
  id: string;
  page: number;
  size: RegionSize;
  /** The section's own layers, viewBox 0 0 1000 700. */
  layers: PageLayers;
  /** CSS px per section unit, right now. */
  scale(): number;
  /** The slide's body text size in CSS px, right now: `size=m` board text renders at it. */
  body(): number;
  /** A scene section's world (absent for a plain section). */
  scene?: SceneSpace;
};

export type DeskState = {
  /** 'none' while reading; the board's ratio while it is open. */
  split: Split;
  /** The board sits under the slides (narrow window). */
  stacked: boolean;
  /** False after the student scrolled or zoomed during an answer (rule 6). */
  following: boolean;
  /** The board is open beside the slides: the app sets neighbouring pages back while an answer plays. */
  sketching: boolean;
  /** The slide column in view px (the dock centres under it). */
  column: { x: number; w: number };
  /** The board in view px, while open. */
  board?: ViewRect;
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
  /** Regions: the slide's body text in CSS px (board text is sized from it). Pages: absent. */
  body?(): number;
  /** A scene section: its world (placement by relation, claims). */
  scene?: SceneSpace;
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

/** Resolves an ink action into a plan. A string is a skip reason. Implemented in src/desk/elements.ts. */
export type BuildElement = (a: InkAction, env: BuildEnv) => Promise<ElementPlan | string>;

export type ConnectorEnd = { t: Target; r: SRect };
/** Called right before the Desk actually moves the view (a pan, the split glide), so ink in flight can land (rule 1). */
export type BeforeMove = () => Promise<void>;
/** A connector the Desk owns: it re-routes `group`'s path whenever either end moves. */
export type ConnectorHandle = { group: SVGGElement; stroke: Stroke; scale: number };

/** The desk, as the director sees it. Implemented by src/desk/Desk.ts. */
export interface DeskApi {
  /** A new answer (or {{clear}}): connectors fade out with the page marks, ids are freed, following resumes. The board stays. */
  reset(ms: number): Promise<void>;
  /** Appends a section to the board, opening it (the split) if needed. Resolves once it is drawable. A string is a skip reason. */
  addRegion(spec: RegionSpec, before?: BeforeMove): Promise<RegionInfo | string>;
  region(id: string): RegionInfo | null;
  /**
   * Rule 1/2: scrolls the slides (page targets) or the board (region targets) so the target-space
   * rect is on screen. Resolves whether it moved. Page ink is framed with the answer's earlier ink on
   * that page when they fit (see noteInk); `anchor` (target space) is the part a box taller than the
   * band keeps in view, e.g. the point a line starts from.
   */
  reveal(t: Target, r: SRect, before?: BeforeMove, anchor?: SRect): Promise<boolean>;
  /** Kit blocks need a section `h` units tall (it grows past 700; never shrinks). */
  growRegion?(id: string, h: number): void;
  /** A section's content spans x0–x1 (units): shift the whole group to centre it in the board. */
  centreRegion?(id: string, x0: number, x1: number): void;
  /** Ink is landing at this target-space rect: later page framing keeps it in view when it fits. */
  noteInk?(t: Target, r: SRect): void;
  /** The answer has ended: a scene it drew in is shown whole (Board v2 overview). */
  overview?(): Promise<void>;
  isVisible(t: Target, r: SRect): boolean;
  /** Resolves true as soon as the rect is on screen (mid-glide is fine), false after maxMs (default 1200). */
  whenVisible(t: Target, r: SRect, maxMs?: number): Promise<boolean>;
  /** Rule 3: brings both ends on screen (the slides and the board scroll independently). */
  frameBoth(a: ConnectorEnd, b: ConnectorEnd, before?: BeforeMove): Promise<void>;
  /** {{scroll}}: frames the page (or y on it) like ViewerApi.scrollToPage. */
  scrollToPage(page: number, y?: number): Promise<void>;
  /** `avoid`: ink already in the region end's target (its own space); the connector arrives the way that crosses least of it. */
  addConnector(from: ConnectorEnd, to: ConnectorEnd, avoid?: SRect[]): ConnectorHandle | string;
  /** Rule 6: false while the student has taken over the view. */
  following(): boolean;
  /** Stops a pan in flight (a stopped answer must not keep moving the view). */
  cancel(): void;
  /** A stopped answer: cancels pans and makes every desk move in flight bail. */
  abort(): void;
  state(): DeskState;
  subscribe(cb: (s: DeskState) => void): () => void;
}

// ------------------------------------------------------------------------------------------------
// The viewer's side (PdfViewer implements it; the Desk drives it).

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
  /** Re-lays out the pages for a split state, gliding the column over `ms` (0 = at once). Resolves once committed. */
  setSplit(split: Split, ms: number): Promise<void>;
  /** Glides scrollTop to `top()` (re-read every frame). Resolves on arrival, abort or the student taking over. */
  glideTo(top: () => number, maxMs?: number): Promise<void>;
  cancelGlide(): void;
  /** The viewer's own page framing (ViewerApi.scrollToPage semantics). */
  scrollToPage(page: number, y?: number): Promise<void>;
  onLayout(cb: () => void): () => void;
  onScroll(cb: () => void): () => void;
  /** The student scrolled or zoomed (wheel, touch, scroll keys, ctrl+wheel, pinch, a foreign scroll). */
  onUserIntent(cb: () => void): () => void;
  /** Where `page` has printed content (null until it has rendered): connectors route around it. */
  contentMask?(page: number): ContentMask | null;
}
