// src/script/types.ts
import type { ChartAxis } from '../agent/context/charts';
/**
 * Coordinates in scripts.
 * - On a page (`p=`): model coords, x 0–1000 across the page width, y 0–1000 down its height.
 * - In a sketch region (`on=<id>`, a section on the board): region-local coords, x 0–1000,
 *   y 0–700. These are already region space (no y scaling).
 */
export type Pt = { x: number; y: number };
/** A rect in a target's script coords (pages: model coords 0–1000 both axes). */
export type LiftRect = { x: number; y: number; w: number; h: number };

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
  /** `arc`: written as {{arc center= from= to=}}: the resolver draws it only when from and to are equally far from the centre (r = that distance). */
  | ({ kind: 'angle'; at: P; from: P; to: P; r?: number; text?: string; arc?: boolean } & W)
  /** Curly brace from `from` to `to`; its tip points to the left of the direction from → to. */
  | ({ kind: 'brace'; from: P; to: P; text?: string } & W)
  /** Region only. at = origin (bottom-left); the x axis runs w right, the y axis h up. */
  | ({ kind: 'axes'; at: P; w: number; h: number; xLabel?: string; yLabel?: string } & W)
  /** Region only. Plots fn(x) over domain into the axes `axes` (default: the latest axes in the region). */
  /**
   * A graph. With a hand-drawn {{axes}}: fn over a numeric domain, as before. Otherwise the engine
   * draws it with its own axes (ticks, one scale for every plot on them): fn= over domain=, or a
   * parametric curve x= y= over t=; ranges may be expressions over {{const}} names; "label" sits at
   * the curve's end (label=top: at its highest point); xlabel=/ylabel= name the axes.
   */
  | ({ kind: 'plot'; fn?: string; x?: string; y?: string; t?: [string, string]; domain?: [number, number]; domainSrc?: [string, string]; range?: [number, number]; axes?: string; dash?: boolean; label?: string; labelAt?: 'end' | 'top'; xLabel?: string; yLabel?: string; /** a contrast's copy: these constants differ */ with?: Record<string, number>; /** On a page: drawn on this calibrated chart's own axes (set by the resolver from `on=#cN`). */ onChart?: { x: ChartAxis; y: ChartAxis; rect: { x: number; y: number; w: number; h: number } } } & W)
  /** Region only. KaTeX. at = left edge, vertical middle (or the centre with `centered`). */
  | { kind: 'math'; at: P; tex: string; size: TextSize; centered?: boolean }
  /**
   * Region only: the slide's own figure lifted onto the board, a base to draw over and around.
   * `srcPage` + `src` (a page rect, model coords; or `srcMark`, a figure mark the resolver turns into
   * its rect); `at` its top-left in the section and `w` its width (region units); `h` keeps the
   * page's proportions (set by the resolver, which also fits it inside the section). Page marks
   * inside it (`#d1`, `#b2`) are points of the section afterwards.
   */
  | { kind: 'lift'; srcPage: number; src?: LiftRect; srcMark?: string; at?: P; w?: number; h?: number }
  /**
   * Page only: a short note beside what it annotates — a page mark (`annotate`, resolved to `rect`),
   * a quote (`quote`, `near`) or a point (`at`) — placed clear of the page's text and figures
   * (`avoid`, page model coords, from the grounding), with a leader line when it sits apart.
   */
  | { kind: 'annot'; text: string; annotate?: string; rect?: LiftRect; quote?: string; near?: P; at?: P; avoid?: LiftRect[] }
  | KitBlock<P>
  | SceneShape;

// ------------------------------------------------------------------------------------------------
// Board v2 (spec "Board v2: one connected scene"): things placed by relation in a scene, and the
// connections between them. src/desk/scene/scene.ts draws them.

/** Placement by relation: beside/under/… another element or part (the engine picks the offset). */
export type SceneRel = 'right' | 'left' | 'above' | 'below' | 'beside' | 'near';
export const SCENE_RELS: readonly SceneRel[] = ['right', 'left', 'above', 'below', 'beside', 'near'];
export type ScenePlace = { rel: SceneRel; of: string };
/** A value shown on a thing: a literal number, or a part of a block with values (live: it follows set). */
export type ValueRef = number | string;
export type SceneShape =
  /** A labelled thing (a chip), with an optional small value under it. */
  | { kind: 'node'; text: string; value?: ValueRef; place?: ScenePlace }
  /** A sequence of chips (parts f[1]…), with arrows between them when `arrows`; `values=` shows a block's values under them. */
  | { kind: 'flow'; items: string[]; arrows?: boolean; down?: boolean; values?: string; place?: ScenePlace }
  /** A relation from one thing (or part) to another. Weight (0–1, or a part with a value) sets thickness and strength; a whole flow as `to` with a vector weight fans out. */
  | { kind: 'link'; from: string; to: string; strength?: ValueRef; text?: string; plain?: boolean; dash?: boolean; showWeight?: boolean }
  /** Text placed by relation; with `annotate`, a callout with a leader line to that thing or part. */
  | { kind: 'note'; text: string; place?: ScenePlace; annotate?: string; /** a live value after the words (a block's part): it follows set */ value?: ValueRef }
  /** A loose outline around a set of things (a system boundary, a category), labelled on its edge; it follows them when they move. */
  | { kind: 'group'; of: string[]; text?: string }
  /** A bracket joining two things or parts (a pair: "equal and opposite"), labelled at its spine. */
  | { kind: 'pair'; from: string; to: string; text?: string }
  /** Things that become one: they glide together into a new chip (links to them follow it). */
  | { kind: 'merge'; of: string[]; text: string; place?: ScenePlace };
export const SCENE_KINDS = new Set(['node', 'flow', 'link', 'note', 'group', 'pair', 'merge']);

// ------------------------------------------------------------------------------------------------
// Visual kit v1: engine-rendered blocks and the verbs that animate them (src/desk/kit/). The model
// names data and operations; the engine lays out, computes every number and animates.

/** Where a block goes: right of / below another block (the engine picks the spacing), or at a top-left point. `op` is a glyph drawn between it and its neighbour. */
export type KitPlace<P = Pt> = { right?: string; below?: string; op?: string; at?: P; /** In a scene: placed by relation (left, above, beside, near too). */ rel?: ScenePlace; /** a contrast's copy: these constants differ */ with?: Record<string, number> };
export type WinReduce = 'sum' | 'mean' | 'max' | 'min';
/** Where a block's values come from: literals, or an operation the engine computes. */
export type KitSource =
  /** Literal values; `frac` when the model wrote fractions (1/9), shown as written. */
  | { vals: number[][]; frac?: boolean; /** formula cells over {{const}} names (null: literal), evaluated when built */ cells?: (string | null)[][] }
  /** map= / zip= read any block with values (grid, bars, table) or a table column `t.c`. */
  | { map: string; fn: string }
  | { zip: [string, string]; fn: string }
  /** A window sliding over block `over`: weights from block `slide` (sum of products), a reduction, or a fn of the window's cells (a b c … row-major). */
  | { over: string; slide?: string; win?: [number, number]; reduce?: WinReduce; fn?: string; same?: boolean; flip?: boolean; stride?: number }
  /** An R×C grid whose cells are fn(r, c) (1-based row and column). */
  | { gen: [number, number]; fn: string }
  /** A table's column (0-based index) as a vector: it follows the table as rows fill. */
  | { col: ColRef }
  /** A histogram of any block's values: counts in `bins` equal bins over their range, or over histogram `like`'s bins (one x scale). */
  | { hist: string; bins: number; like?: string }
  /** A standard operation the engine computes (src/desk/kit/ops.ts): softmax (t = temperature), normalize, l2, cumsum, rank, scale (t = factor), matmul (two blocks). */
  | { op: 'softmax' | 'normalize' | 'l2' | 'cumsum' | 'rank' | 'matmul' | 'scale'; of: string[]; t?: number };
/** A table column: [table, index] by letter, or [table, -1, header] by its header (resolved when the table is known). */
export type ColRef = [string, number, string?];
export type KitReduce = 'sum' | 'mean' | 'max' | 'min' | 'norm' | 'count' | 'dot' | 'cos' | 'wavg' | 'argmax' | 'quantile';
export type KitBlock<P = Pt> =
  /** view=image: cells as shaded pixels, no numerals (implied past 12 rows or columns). */
  | ({ kind: 'grid'; src: KitSource; rows?: string[]; cols?: string[]; shade?: 'heat' | 'image'; view?: 'image'; dp?: number; caption?: string } & KitPlace<P>)
  /** view=line: the values as a curve on axes (implied past 16 values); axes=v draws onto line v's axes (an overlay). */
  | ({ kind: 'bars'; src: KitSource; labels?: string[]; labelsFrom?: ColRef; ghost?: string; view?: 'line'; axes?: string; dp?: number; caption?: string;
      /** stack: each bar is the sum of its parts (rows of `vals=100;90,20`, ragged; formula cells over constants), on one scale. */
      stack?: { vals: number[][]; cells?: (string | null)[][] };
      /** The parts' names, by position (a stacked bar's segments, or a split's). */
      parts?: string[] } & KitPlace<P>)
  /** Data points, literal or two of a table's columns (x, y: 0-based), which appear as the rows fill. */
  | ({ kind: 'scatter'; data?: Pt[]; cols?: { id: string; x: number; y: number; xName?: string; yName?: string }; xLabel?: string; yLabel?: string; caption?: string; /** draw the points onto this line's or plot's axes */ axes?: string } & KitPlace<P>)
  /** A table: a header per column, rows of values; `col` adds computed columns that fill row by row. */
  | ({ kind: 'table'; vals: number[][]; cells?: (string | null)[][]; heads: string[]; frac?: boolean; dp?: number; caption?: string } & KitPlace<P>)
  /** A live calculation line: a reduction of one block (two for dot / cos), its expansion and result. */
  | ({ kind: 'calc'; of: string[]; reduce: KitReduce; fn?: string; /** quantile level */ q?: number; label?: string; dp?: number } & KitPlace<P>)
  /** A line through a scatter's data: least squares, or through two of its points (`pick`, 1-based). */
  | { kind: 'fit'; of: string; pick?: [number, number] }
  /** Shares of a whole: one bar split into parts that sum to 1 (any source; the engine normalises). `mix`: a blend, the values mixed in those shares, with its result. */
  | ({ kind: 'shares'; src: KitSource; labels?: string[]; mix?: string; dp?: number; caption?: string } & KitPlace<P>)
  /**
   * A count drawn as that many marks (coins, seats, molecules), each in one of `states` (the first at
   * the start). `set id=k[7:8] state=tax` (or `n=` how many) moves marks to another state's cluster;
   * the clusters' counts are readouts (`k.tax`). `n`: a number or a formula over constants.
   */
  | ({ kind: 'tokens'; n: string; states: string[]; caption?: string } & KitPlace<P>);
export const KIT_BLOCKS = new Set(['grid', 'bars', 'scatter', 'table', 'calc', 'fit', 'shares', 'tokens']);

/**
 * Page drawings on a calibrated chart (`p=12 on=#c1`): their points are data coordinates on that
 * chart's axes; the resolver maps them onto the page (and drops `chart`).
 */
export type DrawAction<P = Pt> = Shape<P> & Target & Mark & { chart?: string };

/** Actions on an element drawn earlier in this answer (by id). */
export type RefAction =
  | { kind: 'label'; ref: string; text: string; dir?: Compass; em?: boolean }
  /** `where` (a kit grid or table): every cell whose value makes the fn true, x being the cell. */
  | { kind: 'emph'; ref: string; where?: string }
  /** Moves a point or label to `to`; in a scene, any thing to a new place by relation (links follow). */
  | { kind: 'move'; ref: string; to?: Pt; place?: ScenePlace }
  | { kind: 'fade'; ref: string }
  /** A scene chip that becomes several (parts ref[1]…), spreading from where it was. */
  | { kind: 'split'; ref: string; items: string[] }
  | KitVerb
  | MoveAction;

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
  | { kind: 'set'; ref: string; fn?: string; to?: number; vals?: number[][]; /** scene things: a new label, value or link weight */ text?: string; value?: ValueRef; weight?: ValueRef;
      /** tokens: the marks' new state, and how many (a formula; default: the marks named by the part) */ state?: string; count?: string }
  | { kind: 'band'; ref: string; w: number; label?: string }
  | { kind: 'dist'; ref: string; from: string }
  /** A computed column added to a table, filled row by row over `dur` seconds (a b c… this row's cells, pa pb… the row above's, i the row number). */
  | { kind: 'col'; ref: string; head: string; fn: string; dur?: number }
  /** A reference line at value `at` across bars, a scatter (y = at) or a table column (`t.c`), labelled. */
  | { kind: 'level'; ref: string; at: number; col?: number; colName?: string; label?: string }
  /**
   * {{split id=v[2] vals=8-t,t "kept" "tax"}}: one bar becomes stacked parts on its own scale (they must
   * sum to it; with one value fewer than the names, the first part is what remains). Formulas over constants.
   */
  | { kind: 'splitBar'; ref: string; vals: string[]; labels: string[] };
export const KIT_VERBS = new Set(['step', 'sweep', 'set', 'band', 'dist', 'col', 'level']);

export type ConnectAction = { kind: 'connect'; from: End; to: End; id?: string };

export type LayoutAction =
  | { kind: 'scroll'; page: number; y?: number }
  /**
   * Appends section `id` to the board. `page` (from `near=pN`) is the slide it explains (default: the
   * one in view); its body text sets the section's type size. `place=` is accepted and ignored.
   */
  | { kind: 'sketch'; id: string; page?: number; size: RegionSize; fit?: boolean; /** Board v2: one 2-D scene with a camera ({{scene}}). */ scene?: boolean }
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

import type { PtArg, PtExpr } from './pointExpr';
type Ink = { id?: string; em?: boolean; weight?: Weight; dash?: boolean };
/** `{{let on=R A=x,y B=mid(A,C)}}`: names points without drawing anything. */
export type LetAction = { kind: 'let'; defs: [string, PtArg][]; /** names of data points on a page's calibrated chart */ chart?: string } & Target;
/** A shape on a page mark: `{{circle p=4 mark=#d3}}`, `{{line p=4 mark=#s2}}`, `{{box p=4 mark=#t12}}`. */
export type MarkShape = { kind: 'circle' | 'box' | 'highlight' | 'underline' | 'line' | 'arrow'; page: number; region?: never; mark: string } & Ink;
/** A ray: from A through B, to the frame edge (regions) or `len` × |AB| (pages default 1.5). */
export type RayShape = { kind: 'line' | 'arrow'; from: PtArg; through: PtArg; len?: number } & Target & Ink;
/** A connector end as written: also a page mark (`p4:#d3`, `p4:#s2.a`), resolved by the resolver. */
/** Before resolving: a page mark, or a section point named by a construction (`w:mid(A,B)`). */
export type RawEnd = End | { page: number; mark: string } | { region: string; at: PtExpr };
export type RawConnect = { kind: 'connect'; from: RawEnd; to: RawEnd; id?: string };
/**
 * {{const v=20 g=9.8 T=2*v/g}}: named numbers for every kit formula in this answer (plots, fn=, col).
 * Each value is an expression over the constants before it. Taken when parsed (like let); never timed.
 */
export type ConstAction = { kind: 'const'; defs: [string, string][] };

// ------------------------------------------------------------------------------------------------
// Gated beats, step 2 (src/values/*): numbers the narration states are bound to the engine's.

/** How a bound number is said: `fmt` decimals; `as=percent` (×100, "%"); `as=abs` (the magnitude: "falls by 12"). */
export type ValFormat = { fmt?: number; as?: 'percent' | 'abs' };
/**
 * {{val id=…}} in the narration: the engine's value, said as a word. ref: a block (`s`), a part
 * (`v[2]`, `o[1,2]`, `t[3].c` / `t[3].price`), a calc's result, a constant, a readout (`E`, `E.x`).
 * The parser resolves it against the value model (src/values/model.ts) when it is parsed: `said` is
 * the caption text, `spoken` the TTS form; both absent = unresolved (the caption shows `UNBOUND_TEXT`).
 */
/** `x`: a plot read at x (`{{val id=p.y x=0}}`), as `{{find … x=}}` would; the parser expands it into that find. */
export type ValAction = { kind: 'val'; ref: string; x?: string; said?: string; spoken?: string } & ValFormat;
/** What a readout finds on a plot (or a fit): see FindAction. */
export type FindMode = 'cross' | 'level' | 'max' | 'min' | 'at' | 'slope' | 'area' | 'inside' | 'residual';
/**
 * {{find id=E of=a,b}}: an engine readout, named. Draws nothing; `{{val id=E}}` says its value,
 * `at=E` places a point there (on the plot's own axes), `E.x` / `E.y` its coordinates.
 *   cross    of=a,b — where two plots on shared axes meet (n=2: the second crossing, left to right)
 *   level    of=a level=3 — where a reaches y = 3 (level=0: where it crosses the x axis)
 *   max/min  of=a — its highest / lowest point over its domain
 *   at       of=a x=2 — its value at x;  slope: of=a x=2 slope — its slope there
 *   area     of=a[,b] from=0 to=3 — the area under a (between a and b) over [from, to] (default: the domain)
 *   inside   of=f inside=2 — how many of a fit's points lie within 2 of its line
 *   residual of=f residual — the RMS distance of a fit's points to its line (residual=3: point 3's)
 * x=, level=, from=, to= may be formulas over {{const}} names.
 */
export type FindAction = { kind: 'find'; id: string; of: string[]; mode: FindMode; x?: string; level?: string; from?: string; to?: string; n?: number; w?: number; point?: number };
/**
 * Demonstration moves over existing engine plots and computed blocks; `set` holds the input that
 * changes (a {{const}} name and its new value).
 *   contrast    a second copy of `ref` with only that input different: a plot on the same axes, a
 *               block beside it (one scale); `id` names the copy (default `<ref>_2`).
 *   limit       the input sweeps toward its value over `dur` s; every plot and block using it follows,
 *               with a live readout of the input (and of readout `show`).
 *   beforeafter the input changes; `ref`'s old state stays as a dashed ghost and the difference is
 *               highlighted (the band between the curves, the bars or cells that changed).
 */
export type MoveAction =
  | { kind: 'contrast'; ref: string; set: [string, string]; id?: string; text?: string }
  | { kind: 'limit'; ref: string; set: [string, string]; dur?: number; show?: string }
  | { kind: 'beforeafter'; ref: string; set: [string, string]; text?: string };
export const MOVE_KINDS = new Set(['contrast', 'limit', 'beforeafter']);

export type RawAction = LayoutAction | (DrawAction<PtArg>) | RefAction | RawConnect | LetAction | MarkShape | RayShape | ConstAction | ValAction | FindAction;
