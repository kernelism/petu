// src/script/types.ts
/**
 * Coordinates in scripts.
 * - On a page (`p=`): model coords, x 0–1000 across the page width, y 0–1000 down its height.
 * - In a sketch region (`on=<id>`, a section on the board): region-local coords, x 0–1000,
 *   y 0–700. These are already region space (no y scaling).
 */
export type Pt = { x: number; y: number };

/** A sketch region is 1000 × 700 local units. */
export const REGION_W = 1000;
export const REGION_H = 700;

/** Where an element draws: a PDF page, or a sketch region by id. Exactly one key is present. */
export type Target = { page: number; region?: never } | { region: string; page?: never };

export type TextSize = 's' | 'm' | 'l';
/** A sketch's size: `l` widens the board (split 0.4 : 0.6); `s` and `m` are the normal split. */
export type RegionSize = 's' | 'm' | 'l';
/** Where a label sits relative to its anchor. */
export type Compass = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/** One end of a connector: a page anchor (quote or coords) or a region element (id or coords). */
export type End =
  | { page: number; quote: string; near?: Pt }
  | { page: number; at: Pt }
  | { region: string; ref: string }
  | { region: string; at: Pt }
  /** A page box (a resolved figure, equation or image mark). */
  | { page: number; rect: { x: number; y: number; w: number; h: number } };

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
export type Shape<P = Pt> =
  | { kind: 'highlight'; quote: string; near?: P }
  | ({ kind: 'underline'; quote: string; near?: P } & W)
  | ({ kind: 'circle'; at: P; rx: number; ry: number; dash?: boolean } & W)
  | ({ kind: 'circle'; quote: string; near?: P; dash?: boolean } & W)
  | ({ kind: 'line'; from: P; to: P; dash?: boolean } & W)
  | ({ kind: 'arrow'; from: P; to: P; dash?: boolean } & W)
  /**
   * at = top-left corner (or the centre with `centered`); w in x units, h in y units. A kit region
   * reference (`at=g[1:2,1:3]`, w = h = 0) frames those cells.
   */
  | ({ kind: 'box'; at: P; w: number; h: number; centered?: boolean } & W)
  | ({ kind: 'box'; quote: string; near?: P } & W)
  | { kind: 'label'; at: P; text: string }
  /** Region only. at = left edge, vertical middle (or the centre with `centered`). */
  | { kind: 'write'; at: P; text: string; size: TextSize; centered?: boolean }
  /** A dot, plus an optional label placed toward `dir` (default ne) and nudged off other elements. */
  | { kind: 'point'; at: P; text?: string; dir?: Compass }
  /** Catmull-Rom curve through 2+ points. */
  | ({ kind: 'curve'; pts: P[]; dash?: boolean } & W)
  /**
   * A fill under the ink: a polygon (3+ points) or an ellipse. In a region: an opaque light sheet
   * (overlaps never muddy); `outline` adds a 1px hairline (a sheet like the slide's boxes); `em` is
   * a ~10% accent tint instead, without outline unless `outline` is given too. On a page: a light
   * multiply tint, so the slide shows through.
   */
  | { kind: 'shade'; pts: P[]; outline?: boolean }
  | { kind: 'shade'; at: P; rx: number; ry: number; outline?: boolean }
  /** Arc between the rays at→from and at→to (the smaller sweep). r in x units, default 30. */
  | ({ kind: 'angle'; at: P; from: P; to: P; r?: number; text?: string } & W)
  /** Curly brace from `from` to `to`; its tip points to the left of the direction from → to. */
  | ({ kind: 'brace'; from: P; to: P; text?: string } & W)
  /** Region only. at = origin (bottom-left); the x axis runs w right, the y axis h up. */
  | ({ kind: 'axes'; at: P; w: number; h: number; xLabel?: string; yLabel?: string } & W)
  /** Region only. Plots fn(x) over domain into the axes `axes` (default: the latest axes in the region). */
  | ({ kind: 'plot'; fn: string; domain: [number, number]; range?: [number, number]; axes?: string; dash?: boolean } & W)
  /** Region only. KaTeX. at = left edge, vertical middle (or the centre with `centered`). */
  | { kind: 'math'; at: P; tex: string; size: TextSize; centered?: boolean }
  | KitBlock<P>;

// ------------------------------------------------------------------------------------------------
// Visual kit v1: engine-rendered blocks and the verbs that animate them (src/desk/kit/). The model
// names data and operations; the engine lays out, computes every number and animates.

/** Where a block goes: right of / below another block (the engine picks the spacing), or at a top-left point. `op` is a glyph drawn between it and its neighbour. */
export type KitPlace<P = Pt> = { right?: string; below?: string; op?: string; at?: P };
export type WinReduce = 'sum' | 'mean' | 'max' | 'min';
/** Where a block's values come from: literals, or an operation the engine computes. */
export type KitSource =
  | { vals: number[][] }
  | { map: string; fn: string }
  | { zip: [string, string]; fn: string }
  /** A window sliding over block `over`: weights from block `slide` (sum of products), a reduction, or a fn of the window's cells (a b c … row-major). */
  | { over: string; slide?: string; win?: [number, number]; reduce?: WinReduce; fn?: string; same?: boolean; flip?: boolean; stride?: number }
  /** An R×C grid whose cells are fn(r, c) (1-based row and column). */
  | { gen: [number, number]; fn: string }
  /** A table's column (0-based index) as a vector: it follows the table as rows fill. */
  | { col: [string, number] };
export type KitReduce = 'sum' | 'mean' | 'max' | 'min' | 'norm' | 'count' | 'dot' | 'cos';
export type KitBlock<P = Pt> =
  | ({ kind: 'grid'; src: KitSource; rows?: string[]; cols?: string[]; shade?: 'heat' | 'image'; dp?: number; caption?: string } & KitPlace<P>)
  | ({ kind: 'bars'; src: KitSource; labels?: string[]; labelsFrom?: [string, number]; ghost?: string; dp?: number; caption?: string } & KitPlace<P>)
  /** Data points, literal or two of a table's columns (x, y: 0-based), which appear as the rows fill. */
  | ({ kind: 'scatter'; data?: Pt[]; cols?: { id: string; x: number; y: number }; xLabel?: string; yLabel?: string; caption?: string } & KitPlace<P>)
  /** A table: a header per column, rows of values; `col` adds computed columns that fill row by row. */
  | ({ kind: 'table'; vals: number[][]; heads: string[]; dp?: number; caption?: string } & KitPlace<P>)
  /** A live calculation line: a reduction of one block (two for dot / cos), its expansion and result. */
  | ({ kind: 'calc'; of: string[]; reduce: KitReduce; fn?: string; label?: string; dp?: number } & KitPlace<P>)
  /** A line through a scatter's data: least squares, or through two of its points (`pick`, 1-based). */
  | { kind: 'fit'; of: string; pick?: [number, number] };
export const KIT_BLOCKS = new Set(['grid', 'bars', 'scatter', 'table', 'calc', 'fit']);

export type DrawAction<P = Pt> = Shape<P> & Target & Mark;

/** Actions on an element drawn earlier in this answer (by id). */
export type RefAction =
  | { kind: 'label'; ref: string; text: string; dir?: Compass; em?: boolean }
  /** `where` (a kit grid or table): every cell whose value makes the fn true, x being the cell. */
  | { kind: 'emph'; ref: string; where?: string }
  | { kind: 'move'; ref: string; to: Pt }
  | { kind: 'fade'; ref: string }
  | KitVerb;

/**
 * Kit verbs on a block drawn earlier (ref = its id, or a part: `g[2,3]`, `g[1:2,1:3]`, `v[4]`, 1-based).
 * step: the window that makes output cell ref glides there, the calc line shows its expansion, the cell fills.
 * sweep: the window visits every unfilled output cell over `dur` seconds. set: an input changes (tweened);
 * everything computed from it follows. band: the points within `w` of a fitted line. dist: a point's
 * distance to a fitted line.
 */
export type KitVerb =
  | { kind: 'step'; ref: string }
  | { kind: 'sweep'; ref: string; dur?: number }
  | { kind: 'set'; ref: string; fn?: string; to?: number; vals?: number[][] }
  | { kind: 'band'; ref: string; w: number; label?: string }
  | { kind: 'dist'; ref: string; from: string }
  /** A computed column added to a table, filled row by row over `dur` seconds (a b c… this row's cells, pa pb… the row above's, i the row number). */
  | { kind: 'col'; ref: string; head: string; fn: string; dur?: number }
  /** A reference line at value `at` across bars, a scatter (y = at) or a table column (`t.c`), labelled. */
  | { kind: 'level'; ref: string; at: number; col?: number; label?: string };
export const KIT_VERBS = new Set(['step', 'sweep', 'set', 'band', 'dist', 'col', 'level']);

export type ConnectAction = { kind: 'connect'; from: End; to: End; id?: string };

export type LayoutAction =
  | { kind: 'scroll'; page: number; y?: number }
  /**
   * Appends section `id` to the board. `page` (from `near=pN`) is the slide it explains (default: the
   * one in view); its body text sets the section's type size. `place=` is accepted and ignored.
   */
  | { kind: 'sketch'; id: string; page?: number; size: RegionSize; fit?: boolean }
  | { kind: 'clear' };

export type Action = LayoutAction | DrawAction | RefAction | ConnectAction;
export type InkAction = Exclude<Action, LayoutAction>;

export type ScriptEvent =
  | { type: 'word'; text: string }
  | { type: 'action'; action: RawAction }
  | { type: 'end' };

/** The target an action draws into, when it has exactly one (refs and connectors don't). */
export function targetOf(a: Action): Target | null {
  if ('ref' in a || a.kind === 'connect' || a.kind === 'sketch' || a.kind === 'scroll' || a.kind === 'clear') return null;
  return a.region != null ? { region: a.region } : { page: a.page! };
}

// ------------------------------------------------------------------------------------------------
// Agent v2: relational geometry and page marks. The parser emits RawAction; the director resolves
// it (src/geometry/resolve.ts) into an Action with plain points just before building it.

import type { PtArg } from './pointExpr';
type Ink = { id?: string; em?: boolean; weight?: Weight; dash?: boolean };
/** `{{let on=R A=x,y B=mid(A,C)}}`: names points without drawing anything. */
export type LetAction = { kind: 'let'; defs: [string, PtArg][] } & Target;
/** A shape on a page mark: `{{circle p=4 mark=#d3}}`, `{{line p=4 mark=#s2}}`, `{{box p=4 mark=#t12}}`. */
export type MarkShape = { kind: 'circle' | 'box' | 'highlight' | 'underline' | 'line' | 'arrow'; page: number; region?: never; mark: string } & Ink;
/** A ray: from A through B, to the frame edge (regions) or `len` × |AB| (pages default 1.5). */
export type RayShape = { kind: 'line' | 'arrow'; from: PtArg; through: PtArg; len?: number } & Target & Ink;
/** A connector end as written: also a page mark (`p4:#d3`, `p4:#s2.a`), resolved by the resolver. */
export type RawEnd = End | { page: number; mark: string };
export type RawConnect = { kind: 'connect'; from: RawEnd; to: RawEnd; id?: string };
export type RawAction = LayoutAction | (DrawAction<PtArg>) | RefAction | RawConnect | LetAction | MarkShape | RayShape;
