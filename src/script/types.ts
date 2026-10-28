// src/script/types.ts
/**
 * Coordinates in scripts.
 * - On a page (`p=`): model coords, x 0–1000 across the page width, y 0–1000 down its height.
 * - In a sketch region (`on=<id>`): region-local coords, x 0–1000, y 0–700. These are already
 *   region space (no y scaling).
 */
export type Pt = { x: number; y: number };

/** A sketch region is 1000 × 700 local units. */
export const REGION_W = 1000;
export const REGION_H = 700;

/** Where an element draws: a PDF page, or a sketch region by id. Exactly one key is present. */
export type Target = { page: number; region?: never } | { region: string; page?: never };

export type TextSize = 's' | 'm' | 'l';
export type RegionSize = 's' | 'm' | 'l';
export type Place = 'auto' | 'right' | 'left' | 'below';
/** Where a label sits relative to its anchor. */
export type Compass = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/** One end of a connector: a page anchor (quote or coords) or a region element (id or coords). */
export type End =
  | { page: number; quote: string; near?: Pt }
  | { page: number; at: Pt }
  | { region: string; ref: string }
  | { region: string; at: Pt };

/** Any drawn element can be named (`id=`) and accented (`em`). */
export type Mark = { id?: string; em?: boolean };

/**
 * Line hierarchy for stroked elements: `primary` (main geometry), `secondary` (rays, sight lines,
 * axes, dimension marks), `faint` (construction). Absent: the renderer's per-kind default
 * (dash → faint; axes, angle, brace → secondary; everything else → primary).
 */
export type Weight = 'primary' | 'secondary' | 'faint';
type W = { weight?: Weight };

/**
 * Anchored forms (`quote`) are preferred on pages: they resolve against the text layer, so they are
 * pixel-exact. `near` disambiguates repeated text. Radii (`r`, `rx`, `ry`) are in x units.
 */
export type Shape =
  | { kind: 'highlight'; quote: string; near?: Pt }
  | ({ kind: 'underline'; quote: string; near?: Pt } & W)
  | ({ kind: 'circle'; at: Pt; rx: number; ry: number; dash?: boolean } & W)
  | ({ kind: 'circle'; quote: string; near?: Pt; dash?: boolean } & W)
  | ({ kind: 'line'; from: Pt; to: Pt; dash?: boolean } & W)
  | ({ kind: 'arrow'; from: Pt; to: Pt; dash?: boolean } & W)
  /** at = top-left corner; w in x units, h in y units. */
  | ({ kind: 'box'; at: Pt; w: number; h: number } & W)
  | ({ kind: 'box'; quote: string; near?: Pt } & W)
  | { kind: 'label'; at: Pt; text: string }
  /** Region only. at = left edge, vertical middle. */
  | { kind: 'write'; at: Pt; text: string; size: TextSize }
  /** A dot, plus an optional label placed toward `dir` (default ne) and nudged off other elements. */
  | { kind: 'point'; at: Pt; text?: string; dir?: Compass }
  /** Catmull-Rom curve through 2+ points. */
  | ({ kind: 'curve'; pts: Pt[]; dash?: boolean } & W)
  /**
   * A fill under the ink: a polygon (3+ points) or an ellipse. In a region: an opaque light sheet
   * (overlaps never muddy); `outline` adds a 1px hairline (a sheet like the slide's boxes); `em` is
   * a ~10% accent tint instead, without outline unless `outline` is given too. On a page: a light
   * multiply tint, so the slide shows through.
   */
  | { kind: 'shade'; pts: Pt[]; outline?: boolean }
  | { kind: 'shade'; at: Pt; rx: number; ry: number; outline?: boolean }
  /** Arc between the rays at→from and at→to (the smaller sweep). r in x units, default 30. */
  | ({ kind: 'angle'; at: Pt; from: Pt; to: Pt; r?: number; text?: string } & W)
  /** Curly brace from `from` to `to`; its tip points to the left of the direction from → to. */
  | ({ kind: 'brace'; from: Pt; to: Pt; text?: string } & W)
  /** Region only. at = origin (bottom-left); the x axis runs w right, the y axis h up. */
  | ({ kind: 'axes'; at: Pt; w: number; h: number; xLabel?: string; yLabel?: string } & W)
  /** Region only. Plots fn(x) over domain into the axes `axes` (default: the latest axes in the region). */
  | ({ kind: 'plot'; fn: string; domain: [number, number]; range?: [number, number]; axes?: string; dash?: boolean } & W)
  /** Region only. KaTeX. at = left edge, vertical middle. */
  | { kind: 'math'; at: Pt; tex: string; size: TextSize };

export type DrawAction = Shape & Target & Mark;

/** Actions on an element drawn earlier in this answer (by id). */
export type RefAction =
  | { kind: 'label'; ref: string; text: string; dir?: Compass; em?: boolean }
  | { kind: 'emph'; ref: string }
  | { kind: 'move'; ref: string; to: Pt }
  | { kind: 'fade'; ref: string };

export type ConnectAction = { kind: 'connect'; from: End; to: End; id?: string };

export type LayoutAction =
  | { kind: 'scroll'; page: number; y?: number }
  /** Reserves region `id` next to page `page`. */
  | { kind: 'sketch'; id: string; page: number; size: RegionSize; place: Place }
  | { kind: 'clear' };

export type Action = LayoutAction | DrawAction | RefAction | ConnectAction;
export type InkAction = Exclude<Action, LayoutAction>;

export type ScriptEvent =
  | { type: 'word'; text: string }
  | { type: 'action'; action: Action }
  | { type: 'end' };

/** The target an action draws into, when it has exactly one (refs and connectors don't). */
export function targetOf(a: Action): Target | null {
  if ('ref' in a || a.kind === 'connect' || a.kind === 'sketch' || a.kind === 'scroll' || a.kind === 'clear') return null;
  return a.region != null ? { region: a.region } : { page: a.page! };
}
