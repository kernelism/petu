// src/desk/kit/kit.ts
/**
 * Visual kit v1 (spec "Visual kit v1"): engine-rendered teaching blocks on the board.
 *
 *   blocks  grid (a matrix or table), bars (a vector), scatter (data on axes), calc (a live
 *           calculation line), fit (a line through a scatter)
 *   verbs   step / sweep (a window over a grid fills an output, cell by cell, with its expansion in
 *           a calc line), set (an input changes; everything computed from it follows, tweened),
 *           band (points within a distance of a fitted line), dist (a point's distance to it)
 *   parts   g[2,3] g[1:2,1:3] v[4] p[7]: points and boxes for emph, fade, box, arrow, connect…
 *
 * The model names data and operations; the engine lays the blocks out from the board's type size,
 * computes every number (compute.ts) and animates (anim.ts). A block's geometry is in section units,
 * fixed when it is built: the section scales as one picture.
 */
import type { SRect } from '../../geometry/space';
import type { ColRef, DrawAction, FindAction, InkAction, KitBlock, KitSource, KitVerb, Pt, RefAction, Target } from '../../script/types';
import { blockPart, isBlockRef, type BlockPart } from '../../script/pointExpr';
import { colRef, colStr } from '../../script/parseKit';
import type { BuildEnv, ElementPlan, Pace, SceneSpace, TargetCtx } from '../types';
import type { Registry } from '../registry';
import { token } from '../../ink/agent/tokens';
import { prefersReducedMotion } from '../../ink/agent/animate';
import { MIN_TEXT_PX } from '../layout';
import * as C from './compute';
import { breakPoles } from '../plot';
import type { VarFn } from '../expr';
import { Animations, tween, pause, easeOut, easeInOut, type Ctl } from './anim';
import { clearDown, place, wrapPieces, type Box, type Pad, type Placed } from './layout';
import { kitText, svg, setAttrs, textWidth } from './text';
import { applyOp, normalize } from './ops';
import { placeRel } from '../scene/place';
import { inkIn, pageInkOf } from '../pageInk';
import { anchorBox, sceneLink, sceneStore, setKitResolver, unclaimed } from '../scene/store';
import { curveOf, read, withConsts, type Curve, type FitData, type Reading } from '../../values/readout';

/** A reference waits this long for its block (still waiting on its own word) before it is skipped. */
export const KIT_WAIT_MS = 600;
/** Value changes (set) tween over this. */
export const SET_MS = 600;
/** A window glides to its next cell over at most this. */
export const GLIDE_MS = 320;

// ------------------------------------------------------------------------------------------------
// Metrics: everything is sized from the board's type (the slide's body size), in section units.

export type Metrics = { s: number; numPx: number; labelPx: number; num: number; label: number; /** The board's measured body size (units): no reading text under it. */ body: number; cell: number; gap: number; opW: number; margin: number; top: number; u: (px: number) => number };

/**
 * A label written as an id (`arms_out`, `total_revenue`) is shown with spaces ("arms out"). Only list
 * values (bar and part labels, table headers, grid row/column labels, token states) and only words of
 * two or more characters joined by underscores: `x_1`, `K_m`, `v_max` keep their subscript form.
 */
export function shown(s: string): string {
  return /^[\p{L}\p{N}]{2,}(?:_[\p{L}\p{N}]{2,})+$/u.test(s) ? s.replace(/_/g, ' ') : s;
}
const shownAll = (xs: string[] | undefined) => xs?.map(shown);

export function metrics(scale: number, bodyPx: number): Metrics {
  const s = Math.max(scale, 1e-3);
  // Numerals at the slide's body size, never under 13px, and growing with a wide board (to 20px).
  const numPx = Math.max(13, bodyPx * 0.9, Math.min(20, (1000 * s) / 50)), labelPx = Math.max(MIN_TEXT_PX, numPx * 0.82);
  const u = (px: number) => px / s;
  return { s, numPx, labelPx, num: u(numPx), label: u(labelPx), body: u(Math.max(MIN_TEXT_PX, Number.isFinite(bodyPx) ? bodyPx : 0)), cell: u(numPx * 2.3), gap: u(numPx * 1.7), opW: u(numPx * 1.4), margin: 40, top: 32, u };
}

// ------------------------------------------------------------------------------------------------
// The store: this answer's blocks (per Registry, cleared with it).

type Win = { over: string; kernel?: string; spec: C.WinSpec; geo: { R: number; C: number; pr: number; pc: number; stride: number }; filled: boolean[][]; pos: [number, number] | null; calc: string | null; rect: Box | null; cur: [number, number] | null };
type Group = { pos: number; neg: number; members: Block[] };
/** Axes shared by line blocks (the first is the host; axes=v overlays onto v's). */
type Plot = { host: Block; dom: { x0: number; x1: number; y0: number; y1: number }; members: Block[]; axes: SVGGElement | null; xLabel?: string; yLabel?: string; /** On a slide's calibrated chart: its axes are the slide's, the domain never moves. */ fixed?: boolean };

export type Block = {
  id: string;
  kind: 'grid' | 'bars' | 'scatter' | 'table' | 'calc' | 'fit' | 'shares' | 'tokens';
  region: string;
  /** Where it draws when not a board section (a chart plot on a page). */
  target?: Target;
  placed: Placed;
  m: Metrics;
  deps: string[];
  /** Bars: the bar's width when its slot is wider (a long label). */
  barW?: number;
  /** Moved in a scene (move id=… below=…): its group glides by this much; `placed` stays in the block's own (drawing) space. */
  shift?: { x: number; y: number };
  g: SVGGElement | null;
  ready: Promise<void>;
  markReady: () => void;
  em?: boolean;
  // grid / bars
  src?: KitSource;
  full?: C.Mat;
  vals?: C.Mat;
  dp?: number;
  cs?: number;
  /** An image grid's row height when its cells are not square (a long thin image); else cs. */
  ch?: number;
  cellPx?: number;
  shade?: 'heat' | 'image';
  win?: Win;
  group?: Group;
  ghost?: number[];
  /** Stacked bars: each bar's parts, bottom up (a bar not split is one part); vals hold the totals. */
  parts?: number[][];
  /** Tokens: the states' names and each mark's state; the cluster width (marks per row) and pitch. */
  tok?: { states: string[]; st: number[]; cols: number; pitch: number };
  /** image: a grid drawn as shaded pixels, no numerals; line: bars drawn as a curve on axes. */
  view?: 'image' | 'line';
  /** line: each value's x (numeric labels, the source's xs, else 1…n); the plot it is drawn on (its own, or its host's). */
  xs?: number[];
  plot?: Plot;
  // table: column lefts and widths, row height (units); which computed cells are filled
  tab?: { heads: string[]; xs: number[]; ws: number[]; rh: number; hh: number; filled: boolean[][] };
  /** table: how many columns the model wrote (literal), and whether it wrote fractions. */
  litCols?: number;
  litFrac?: boolean;
  // scatter (data rows may be NaN until a table's rows fill)
  data?: C.Pt[];
  cols?: { id: string; x: number; y: number };
  dom?: { x0: number; x1: number; y0: number; y1: number };
  fits?: Block[];
  // fit
  line?: C.Line;
  of?: string;
  pick?: [number, number];
  // calc
  calc?: { of: string[]; reduce: C.Reduce; fn?: string; q?: number; label?: string; win?: string; live?: boolean; lines: number; maxW: number };
  /** Rendering handles. */
  el: Record<string, unknown>;
};

export class KitStore {
  readonly anim = new Animations();
  private blocks = new Map<string, Block>();
  private waiters = new Map<string, ((b: Block) => void)[]>();
  private n = 0;

  /** Named numbers ({{const}}), lowercase as the expression language reads names; every kit formula may use them. */
  consts: Record<string, number> = {};
  /** Defines constants in order; each value may use the ones before it. A bad one is dropped (warned). */
  defineConsts(defs: [string, string][]): void {
    for (const [k, v] of defs) {
      const f = C.compileFn(v, Object.keys(this.consts));
      const x = f ? f(this.consts) : NaN;
      const key = k.toLowerCase();
      if (Number.isFinite(x)) {
        this.consts[key] = x;
        this.derived = this.derived.filter(([d]) => d !== key);
        if (!C.isPlainNumber(v)) this.derived.push([key, v]);
      } else console.warn('[kit] const dropped:', `${k}=${v}`);
    }
  }
  /** Constants written as formulas, in definition order: they follow the constants they read (C.rederive). */
  private derived: [string, string][] = [];
  /**
   * A constant takes a new value (a tween's frame, a limit, a beforeafter): the formula constants that
   * read it follow. Set directly, a formula constant becomes an input (it no longer follows its formula).
   */
  setConst(key: string, v: number): void {
    this.consts[key] = v;
    if (this.derived.some(([d]) => d === key)) this.derived = this.derived.filter(([d]) => d !== key);
    C.rederive(this.consts, this.derived, key);
  }
  /** Live geometry: called after constants changed (each frame of a tween, limit or beforeafter). */
  private constSubs = new Set<() => void>();
  onConsts(f: () => void): () => void { this.constSubs.add(f); return () => this.constSubs.delete(f); }
  constsChanged(): void { this.constSubs.forEach((f) => f()); }
  /** Live geometry's place on the board (target and box of what a constant moves), for a tween's framing. */
  liveBox?: (keys: string[]) => { target: Target; bbox: { x: number; y: number; w: number; h: number } } | null;
  /** The svg board's groups bound to constants (src/svgboard/element.ts), for a tween's framing. */
  svgBox?: (keys: string[]) => { target: Target; bbox: { x: number; y: number; w: number; h: number } } | null;
  /** Named readouts ({{find}}) of this answer, computed when read. */
  readonly finds = new Map<string, FindAction>();
  /** A plot's curve with the current constants (readouts compute on it, exactly as the value model does). */
  curve(id: string): Curve | undefined {
    const src = this.blocks.get(id)?.el.plotSrc as Extract<DrawAction, { kind: 'plot' }> | undefined;
    return src ? curveOf(src, this.consts) ?? undefined : undefined;
  }
  fitData(id: string): FitData | undefined {
    const f = this.blocks.get(id);
    const sc = f?.kind === 'fit' ? this.blocks.get(f.of!) : undefined;
    return f?.line && sc?.data ? { line: f.line, pts: sc.data.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) } : undefined;
  }
  reading(id: string): Reading | string {
    const a = this.finds.get(id);
    return a ? read(a, (x) => this.curve(x), (x) => this.fitData(x), this.consts) : `no readout ${id}`;
  }
  anonId(): string { return `_k${++this.n}`; }
  get(id: string): Block | undefined { return this.blocks.get(id); }
  /** Every block, in creation order. */
  all(): Block[] { return [...this.blocks.values()]; }
  add(b: Block): void {
    this.blocks.set(b.id, b);
    const w = this.waiters.get(b.id);
    if (w) { this.waiters.delete(b.id); w.forEach((f) => f(b)); }
  }
  wait(id: string, ms = KIT_WAIT_MS): Promise<Block | undefined> {
    const b = this.blocks.get(id);
    if (b) return Promise.resolve(b);
    return new Promise((resolve) => {
      const done = (x?: Block) => { clearTimeout(t); resolve(x); };
      const t = setTimeout(() => {
        const l = this.waiters.get(id);
        if (l) { const i = l.indexOf(done); if (i >= 0) l.splice(i, 1); }
        resolve(undefined);
      }, ms);
      this.waiters.set(id, [...(this.waiters.get(id) ?? []), done]);
    });
  }
  /** Blocks laid out in a section (fits live inside their scatter). */
  inRegion(region: string): Block[] { return [...this.blocks.values()].filter((b) => b.region === region && b.kind !== 'fit'); }
  /** Every block computed (directly or not) from `id`, in creation order. */
  dependents(id: string): Block[] {
    const out: Block[] = [];
    const hit = new Set([id]);
    for (const b of this.blocks.values()) if (b.deps.some((d) => hit.has(d))) { out.push(b); hit.add(b.id); }
    return out;
  }
  settle(): void { this.anim.settle(); }
  clear(): void { this.blocks.clear(); this.n = 0; this.consts = {}; this.derived = []; this.subs.clear(); this.finds.clear(); this.constSubs.clear(); }
  /** Board v2: things showing a block's values (a node's value, a link's weight) follow it. */
  private subs = new Map<string, Set<() => void>>();
  listen(id: string, f: () => void): void { const s = this.subs.get(id) ?? new Set(); s.add(f); this.subs.set(id, s); }
  notify(id: string): void { this.subs.get(id)?.forEach((f) => f()); }
}

export const kitStore = (r: Registry): KitStore => r.ext('kit', () => new KitStore());

// ------------------------------------------------------------------------------------------------
// Colors (tokens.css; fallbacks in tokens.ts).

const col = () => ({
  ink: token('--ink'), ink2: token('--ink-2'), cell: token('--kit-cell'), line: token('--kit-line'), edge: token('--kit-edge'),
  muted: token('--kit-muted'), bar: token('--kit-bar'), pos: token('--kit-pos'), neg: token('--kit-neg'), halo: token('--kit-halo'), dot: token('--kit-dot'),
});

function hex(c: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return [128, 128, 128];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const mix = (a: string, b: string, t: number) => {
  const A = hex(a), B = hex(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * Math.min(1, Math.max(0, t)))).join(',')})`;
};

/** A cell's fill and its numeral's color for a value, given the block's range. */
export function shadeOf(v: number, mode: 'heat' | 'image' | undefined, lo: number, hi: number, c: ReturnType<typeof col>): { fill: string; text: string } {
  if (!mode || !Number.isFinite(v)) return { fill: c.cell, text: c.ink };
  if (mode === 'image') {
    const t = hi > lo ? (v - lo) / (hi - lo) : 1;
    const gray = Math.round(58 + t * 192);
    return { fill: `rgb(${gray},${gray},${gray - 2})`, text: gray < 150 ? '#fff' : c.ink };
  }
  if (lo < 0) {
    const a = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
    return { fill: mix(c.cell, v < 0 ? c.neg : c.pos, (Math.abs(v) / a) * 0.55), text: c.ink };
  }
  const t = hi > 0 ? v / hi : 0;
  const gray = Math.round(250 - t * 172);
  return { fill: `rgb(${gray},${gray},${gray - 2})`, text: gray < 150 ? '#fff' : c.ink };
}

// ------------------------------------------------------------------------------------------------
// Values: a block's source, computed from the blocks it names.

type Env = { store: KitStore; registry: Registry };

/** The full values of a computed or literal source. A string is a skip reason. */
/** A kit formula over `names` plus the answer's constants ({{const}}); the names win over a constant of the same name. */
export function formula(src: string, names: readonly string[], consts: Record<string, number> = {}, rand?: () => number): VarFn | null {
  const ks = Object.keys(consts).filter((k) => !names.includes(k));
  const f = C.compileFn(src, [...names, ...ks], rand);
  return f && ks.length ? (e) => f({ ...consts, ...e }) : f;
}

/**
 * A histogram's data and bins: its source block's values (all of them, computed: a window's output
 * counts before it is swept), over their range, or over histogram `like`'s range and bin count (values
 * outside it fall in the end bins).
 */
export function histBins(src: { hist: string; bins: number; like?: string }, get: (id: string) => Block | undefined): { data: number[]; lo: number; hi: number; bins: number } | string {
  const of = (id: string) => { const cr = colRef(id); if (cr) { const t = get(cr[0]); return t?.kind === 'table' && cr[1] >= 0 ? (t.full ?? t.vals)!.map((r) => r[cr[1]]) : null; } const b = get(id); return (b?.full ?? b?.vals)?.flat() ?? null; };
  const data = of(src.hist)?.filter(Number.isFinite);
  if (!data) return `unknown block ${src.hist}`;
  if (!data.length) return `${src.hist} has no values yet`;
  if (src.like) {
    const h = get(src.like)?.src;
    if (!h || !('hist' in h)) return `${src.like} is not a histogram`;
    const r = histBins(h, get);
    return typeof r === 'string' ? r : { data, lo: r.lo, hi: r.hi, bins: r.bins };
  }
  let lo = Infinity, hi = -Infinity;
  for (const v of data) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (hi - lo < 1e-12) { lo -= 0.5; hi += 0.5; }
  return { data, lo, hi, bins: src.bins };
}

export function computeSource(src: KitSource, get: (id: string) => Block | undefined, seed?: string, consts: Record<string, number> = {}): { full: C.Mat; deps: string[]; win?: { spec: C.WinSpec; over: string; kernel?: string } } | string {
  // Noise (rand(), randn()) is seeded by the block's id: the same numbers on every build and replay.
  const rand = seed ? C.seededRand(seed) : undefined;
  // Any block with values is a source (a grid, bars, a table); `t.c` is a table's column, as a row.
  const valsOf = (id: string): C.Mat | null => {
    const cr = colRef(id);
    if (cr) { const t = get(cr[0]); return t?.kind === 'table' && cr[1] >= 0 && cr[1] < t.vals![0].length ? [t.vals!.map((r) => r[cr[1]])] : null; }
    const b = get(id);
    return b?.vals ? b.vals : null;
  };
  const dep = (id: string) => colRef(id)?.[0] ?? id;
  if ('hist' in src) {
    const r = histBins(src, get);
    if (typeof r === 'string') return r;
    const counts = Array(r.bins).fill(0);
    for (const v of r.data) counts[Math.min(r.bins - 1, Math.max(0, Math.floor(((v - r.lo) / (r.hi - r.lo)) * r.bins)))]++;
    return { full: [counts], deps: [dep(src.hist), ...(src.like ? [src.like] : [])] };
  }
  if ('vals' in src) {
    const full = C.resolveCells(src.vals, src.cells, consts);
    // A cell naming a block, not a constant: say what to write instead.
    const blk = typeof full === 'string' ? src.cells?.flat().find((c) => c != null && get(c)) : undefined;
    if (blk) return `vals=${blk} names a block, not a constant: use map=${blk} fn="x"`;
    return typeof full === 'string' ? full : { full, deps: [] };
  }
  if ('gen' in src) {
    const cells = src.gen[0] * src.gen[1];
    if (cells > C.MAX_CELLS) return `size=${src.gen[0]}x${src.gen[1]} is ${cells} cells; the limit is ${C.MAX_CELLS}`;
    const fn = formula(src.fn, ['r', 'c'], consts, rand);
    if (!fn) return 'bad fn';
    return { full: Array.from({ length: src.gen[0] }, (_, r) => Array.from({ length: src.gen[1] }, (_, c) => fn({ r: r + 1, c: c + 1 }))), deps: [] };
  }
  if ('col' in src) {
    const t = get(src.col[0]);
    if (!t || t.kind !== 'table') return `no table ${src.col[0]}`;
    if (src.col[1] < 0 || src.col[1] >= t.vals![0].length) return `no column ${src.col[2] ?? src.col[1]}`;
    return { full: [t.vals!.map((r) => r[src.col[1]])], deps: [t.id] };
  }
  if ('map' in src) {
    const a = valsOf(src.map);
    if (!a) return `unknown block ${src.map}`;
    const fn = formula(src.fn, C.MAP_VARS, consts, rand);
    return fn ? { full: C.mapMat(a, fn), deps: [dep(src.map)] } : 'bad fn';
  }
  if ('zip' in src) {
    const a = valsOf(src.zip[0]), b0 = valsOf(src.zip[1]);
    if (!a || !b0) return `unknown block ${!a ? src.zip[0] : src.zip[1]}`;
    const fn = formula(src.fn, C.MAP_VARS, consts, rand);
    if (!fn) return 'bad fn';
    // Two vectors of one length zip whatever their kinds (bars are a row, a column is a column).
    const b = asShapeOf(b0, a);
    const z = C.zipMat(a, b, fn);
    return z ? { full: z, deps: src.zip.map(dep) } : 'zip: blocks differ in shape';
  }
  if ('op' in src) {
    const ms = src.of.map(valsOf);
    const bad = src.of.find((_, i) => !ms[i]);
    if (bad) return `unknown block ${bad}`;
    const r = applyOp(src.op, ms[0]!, ms[1] ?? undefined, src.t);
    return typeof r === 'string' ? r : { full: r, deps: src.of.map(dep) };
  }
  const input = valsOf(src.over);
  if (!input) return `unknown block ${src.over}`;
  let spec: C.WinSpec;
  const extra = { ...(src.same ? { same: true } : {}), ...(src.stride ? { stride: src.stride } : {}) };
  if (src.slide) {
    const w = valsOf(src.slide);
    if (!w) return `unknown block ${src.slide}`;
    const ks = get(src.slide)?.src;
    spec = { kind: 'weights', w, ...(src.flip ? { flip: true } : {}), ...(ks && 'vals' in ks && ks.frac ? { frac: true } : {}), ...extra };
  } else if (src.reduce) spec = { kind: 'reduce', kr: src.win![0], kc: src.win![1], op: src.reduce, ...extra };
  else {
    const n = src.win![0] * src.win![1];
    if (n > C.WIN_LETTERS.length) return `win=${src.win![0]}x${src.win![1]} with fn= names its cells a…z: at most ${C.WIN_LETTERS.length} cells (use reduce=)`;
    const fn = formula(src.fn!, C.WIN_LETTERS.slice(0, n), consts);
    if (!fn) return 'bad fn';
    spec = { kind: 'fn', kr: src.win![0], kc: src.win![1], src: src.fn!, fn, ...extra };
  }
  const geo = C.winGeometry(input.length, input[0]?.length ?? 0, spec);
  if (geo && geo.R * geo.C * C.winSize(spec)[0] * C.winSize(spec)[1] > C.MAX_CELLS * 40) return `window work over ${C.MAX_CELLS * 40} cells; the limit is ${C.MAX_CELLS * 40}`;
  const full = C.winApply(input, spec);
  if (!full) return 'window larger than the grid';
  return { full, deps: [src.over, ...(src.slide ? [src.slide] : [])], win: { spec, over: src.over, kernel: src.slide } };
}

/** A vector `v` laid out like vector `like` (row ↔ column) when they have one length; otherwise `v`. */
function asShapeOf(v: C.Mat, like: C.Mat): C.Mat {
  const [R, Cn] = C.shape(v), [r, c] = C.shape(like);
  if (R === r && Cn === c) return v;
  const flat = v.flat();
  if ((R === 1 || Cn === 1) && (r === 1 || c === 1) && flat.length === r * c) return r === 1 ? [flat] : flat.map((x) => [x]);
  return v;
}

/** Bars draw any vector: a column (a grid's) lies down as a row. */
const asRow = (m: C.Mat): C.Mat => (m.length > 1 && m.every((r) => r.length === 1) ? [m.map((r) => r[0])] : m);

/**
 * A table column's index: by letter, or by header (exact, then ignoring case, spaces, _ and -); a
 * letter past the table's width falls back to a header of that name (cols=x,y: t.x is x). -1: none.
 */
export function colIndex(heads: readonly string[], idx: number, name?: string): number {
  if (name == null) {
    if (idx >= 0 && idx < heads.length) return idx;
    name = String.fromCharCode(97 + idx);
  }
  const k = heads.indexOf(name);
  if (k >= 0) return k;
  const loose = (x: string) => x.toLowerCase().replace(/[\s_\-]/g, '');
  return heads.findIndex((h) => loose(h) === loose(name!));
}

/** A parsed column ref against its table (waiting for the table only when it is not built yet). */
async function resolveCol(cr: ColRef, store: KitStore): Promise<ColRef> {
  const t = store.get(cr[0]) ?? (cr[2] != null ? await store.wait(cr[0]) : undefined);
  if (!t?.tab) return cr;
  const k = colIndex(t.tab.heads, cr[1], cr[2]);
  return k >= 0 ? [cr[0], k] : cr;
}
/** A column ref written as a string (map=t.Ed): by letter once resolved; anything else unchanged. */
async function resolveColStr(s: string, store: KitStore): Promise<string> {
  const cr = colRef(s);
  if (!cr) return s;
  const r = await resolveCol(cr, store);
  return r[2] == null && r[1] >= 0 && r[1] < 26 ? colStr(r) : s;
}
/** Every column a block reads, by header → by index (unknown headers stay, and the build skips with a reason). */
async function withColumns<T extends KitBlock>(a: T, store: KitStore): Promise<T> {
  if (a.kind === 'grid' || a.kind === 'bars') {
    let src = a.src;
    if ('col' in src) src = { col: await resolveCol(src.col, store) };
    else if ('map' in src) src = { ...src, map: await resolveColStr(src.map, store) };
    else if ('zip' in src) src = { ...src, zip: [await resolveColStr(src.zip[0], store), await resolveColStr(src.zip[1], store)] };
    const lf = a.kind === 'bars' && a.labelsFrom ? await resolveCol(a.labelsFrom, store) : undefined;
    return { ...a, src, ...(lf ? { labelsFrom: lf } : {}) };
  }
  if (a.kind === 'scatter' && a.cols) {
    const x = await resolveCol([a.cols.id, a.cols.x, a.cols.xName], store), y = await resolveCol([a.cols.id, a.cols.y, a.cols.yName], store);
    return { ...a, cols: { id: a.cols.id, x: x[1], y: y[1], ...(x[2] ? { xName: x[2] } : {}), ...(y[2] ? { yName: y[2] } : {}) } };
  }
  return a;
}

/** Ids a computed source reads from (a table column counts as its table). */
function sourceIds(src: KitSource): string[] {
  const t = (id: string) => colRef(id)?.[0] ?? id;
  if ('map' in src) return [t(src.map)];
  if ('zip' in src) return src.zip.map(t);
  if ('over' in src) return [src.over, ...(src.slide ? [src.slide] : [])];
  if ('op' in src) return src.of.map(t);
  return [];
}

/** A block's default caption: its own id, when the model named it (anonymous ids stay unlabelled). */
const idCaption = (id?: string) => (id && !id.startsWith('_') ? id.replace(/_/g, ' ') : undefined);
/** A single-letter name (u, v, x′) is a variable: set in math italic, as on a board. */
export const isVarName = (s: string) => /^[A-Za-z][′']*$/.test(s);

// ------------------------------------------------------------------------------------------------
// Building: placement happens here (on the block's word), drawing in plan.draw.

const regionOf = (t: Target) => t.region!;
/** A block's drawing target: its section, or the page of the chart it is drawn on. */
const tgtOf = (b: Block): Target => b.target ?? { region: b.region };
/** What a block will show once everything fills: a table column's computed values, else its values. */
function eventual(src: KitSource, shown: C.Mat, get: (id: string) => Block | undefined): C.Mat {
  if ('col' in src) { const t = get(src.col[0]); if (t?.full && src.col[1] >= 0) return [t.full.map((r) => r[src.col[1]])]; }
  return shown;
}
const fmtAll = (m: C.Mat, dp?: number, frac = false) => m.flat().map((v) => C.fmt(v, dp, frac));
/** Fractions only for values the model wrote as fractions (literal 1/9 weights), never for computed ones. */
const litFrac = (src?: KitSource) => !!src && 'vals' in src && !!src.frac;
const fracOf = (b: Block) => litFrac(b.src) && !b.win && C.fractions((b.vals ?? []).flat());
/**
 * A number as the kit shows it, for anything that displays a value outside its block (a scene
 * chip's value, a link's weight): the block's dp= and literal fractions when it comes from one,
 * else the kit's decimals (100, 2.5, 133.3). Shares read as percentages; a value that isn't finite shows nothing.
 */
export function kitNumber(v: number, b?: Pick<Block, 'kind' | 'dp' | 'src' | 'win' | 'vals'>): string {
  if (!Number.isFinite(v)) return '';
  if (b?.kind === 'shares') return `${Math.round(v * 100)}%`;
  return C.fmt(v, b?.dp, b ? fracOf(b as Block) : false);
}

function anchorOf(store: KitStore, a: { right?: string; below?: string }): Promise<Block | undefined> {
  const id = a.right ?? a.below;
  return id ? store.wait(id) : Promise.resolve(undefined);
}

/** Grows the section to hold a block (plus air). */
function grow(env: BuildEnv, region: string, rect: Box) {
  const need = rect.y + rect.h + 36;
  if (need > 700) env.desk.growRegion?.(region, need);
}

function newBlock(id: string, kind: Block['kind'], region: string, placed: Placed, m: Metrics, deps: string[]): Block {
  let markReady = () => {};
  const ready = new Promise<void>((r) => { markReady = r; });
  return { id, kind, region, placed, m, deps, g: null, ready, markReady, el: {} };
}

/** Builds a kit block tag into a plan. A string is a skip reason. */
export async function buildBlock(a0: KitBlock & { region?: string; page?: number; id?: string; em?: boolean }, ctx: TargetCtx, env: BuildEnv): Promise<ElementPlan | string> {
  let a = a0;
  if (a.region == null) return 'kit blocks live on the board';
  const store = kitStore(env.registry);
  const region = regionOf(ctx.target);
  const m = metrics(ctx.scale(), ctx.body?.() ?? 16);
  if (a.kind === 'fit') return buildFit(a, ctx, env, store, m);
  const id = a.id ?? store.anonId();
  if (a.id && store.get(a.id)) return 'duplicate id';
  a = await withColumns(a, store);
  let parts: number[][] | undefined;
  if (a.kind === 'bars' && a.stack) {
    // Stacked: each bar is the sum of its parts (formula parts over the constants), on one scale.
    const ps = C.resolveCells(a.stack.vals, a.stack.cells, withConsts(store.consts, a.with));
    if (typeof ps === 'string') return ps;
    parts = ps;
    a = Object.assign({}, a, { src: { vals: [ps.map((r) => (a.kind === 'bars' && a.stack?.side ? groupTop(r) : r.reduce((t, v) => t + v, 0)))] } });
  }
  // bars axes=<another bar chart> (not a line): one y scale for both, drawn as bars (a line has no bar axes to sit on).
  let shareScale: Block | undefined;
  if (a.kind === 'bars' && a.axes && !('hist' in a.src)) {
    const host = await store.wait(a.axes);
    if (host?.kind === 'bars' && !host.plot && host.group) { shareScale = host; a = { ...a, axes: undefined, view: undefined }; }
  }
  // In a scene, a neighbour may be any thing (a node, a note): the scene places by its box, so only a kit neighbour is waited for here.
  const anchor = ctx.scene && (a.right || a.below) && !store.get(a.right ?? a.below ?? '') && sceneStore(env.registry).get(a.right ?? a.below ?? '') ? undefined : await anchorOf(store, a);
  const sceneNeighbour = !!ctx.scene && !anchor && !!(a.right || a.below) && !!(await anchorBox(a.right ?? a.below!, env.registry, 0));
  // A neighbour that was skipped: the block still draws, in the default place (one skip never cascades).
  if ((a.right || a.below) && !anchor && !sceneNeighbour) { console.warn('[kit] unknown neighbour, placed below:', a.right ?? a.below); a = { ...a, right: undefined, below: undefined, op: undefined }; }
  // Defaults: a grid or bars is named on the board (its id, when it has no caption; tables and plots
  // name themselves by their headers and axes), and a computed block placed right of (below) its own
  // source reads as "source → result" (↓) unless op= says otherwise. An → between stacked blocks points down.
  if ((a.kind === 'grid' || a.kind === 'bars') && !a.caption && idCaption(a.id)) a = { ...a, caption: idCaption(a.id) };
  if ((a.kind === 'grid' || a.kind === 'bars') && (a.right || a.below) && a.op == null && anchor && sourceIds(a.src).includes(anchor.id)) a = { ...a, op: a.right ? '→' : '↓' };
  if (a.below && a.op === '→') a = { ...a, op: '↓' };
  const others = store.inRegion(region).map((b) => b.placed);
  const spacing = { gap: m.gap, opW: m.opW, margin: m.margin, top: m.top, width: 1000 };
  const scene = ctx.scene;
  // A scene: placed by relation among everything in the world (earlier answers' too), never stacked.
  const rel = a.rel ?? (a.right ? { rel: 'right' as const, of: a.right } : a.below ? { rel: 'below' as const, of: a.below } : undefined);
  const relBox = scene && rel ? await anchorBox(rel.of, env.registry) : null;
  const P = (w: number, h: number, pad: Pad): Placed => {
    if (a.at) return place(w, h, pad, { right: a.right, below: a.below, op: a.op, at: a.at as Pt | undefined }, anchor?.placed, others, spacing);
    if (!scene) return clearDown(place(w, h, pad, { right: a.right, below: a.below, op: a.op }, anchor?.placed, others, spacing), looseInk(env, ctx.target), m.gap);
    const taken = [...scene.rects(), ...unclaimed(env, ctx.target)];
    const r = placeRel(pad.l + w + pad.r, pad.t + h + pad.b, rel?.rel ?? null, relBox, taken, { gap: m.gap * 1.3, seed: id, view: scene.view(), last: scene.last() });
    // A kit block opening an empty scene is composed into the board: centred across the window (a
    // chart is the scene's centrepiece, not a chip in its corner); later things flow on from it.
    const v = scene.view();
    if (!relBox && !taken.length && v && r.w < v.w) r.x = v.x + (v.w - r.w) / 2;
    const body = { x: r.x + pad.l, y: r.y + pad.t, w, h };
    // In a scene an op is a relation, not a glyph in a gap: a link from the source, routed around
    // content, labelled with the glyph unless it is a plain arrow (drawn once the block is).
    if (a.op && a.op !== 'none' && relBox && rel) sceneOp = { from: rel.of, glyph: a.op };
    return { body, rect: r };
  };
  let sceneOp: { from: string; glyph: string } | null = null;
  const c = col();
  let b: Block;
  if (a.kind === 'grid' || a.kind === 'bars') {
    const got = computeSource(a.src, (x) => store.get(x), id, withConsts(store.consts, a.with));
    if (typeof got === 'string') return got;
    if (a.kind === 'bars' && !got.win) got.full = asRow(got.full);
    const [R, Cn] = C.shape(got.full);
    if (a.kind === 'bars' && R !== 1) return 'bars need one row';
    // Too many cells for numerals: a grid shows as an image, a vector as a line.
    const image = a.kind === 'grid' && (a.view === 'image' || R > C.MAX_DIM || Cn > C.MAX_DIM);
    const hist = a.kind === 'bars' && 'hist' in a.src ? histBins(a.src, (x) => store.get(x)) : undefined;
    if (typeof hist === 'string') return hist;
    const line = a.kind === 'bars' && !hist && (a.view === 'line' || Cn > 16);
    const strs = image ? [] : fmtAll(got.full, a.dp, litFrac(a.src));
    const wide = Math.max(0, ...strs.map((s) => textWidth(s, m.numPx)));
    // Square cells, room for three digits at least, so a composition's cells come out one size.
    // An image's pixels share a side of about 13 numerals' height.
    let cellPx = image ? Math.min(m.numPx * 2.5, (m.numPx * 13) / Math.max(R, Cn)) : Math.max(m.numPx * 2.5, wide + m.numPx * 0.8);
    if (anchor?.cellPx && anchor.kind === a.kind) cellPx = image ? (anchor.view === 'image' ? anchor.cellPx : cellPx) : anchor.view === 'image' ? cellPx : Math.max(cellPx, anchor.cellPx);
    let cs = m.u(cellPx);
    // An image keeps a readable shape: a long thin one (10×200 samples, 1000 draws × 10) gets taller
    // (wider) cells, so its short side is never under IMG_ASPECT of its long side; beside another image
    // of the same rows, it keeps that one's row height (rows line up).
    let ch = cs;
    if (image) {
      const W = Cn * cs, H = R * cs, short = Math.max(W, H) * IMG_ASPECT;
      if (H < short) ch = short / R;
      if (W < short) cs = short / Cn;
      if (anchor?.view === 'image' && anchor.ch && anchor.vals?.length === R) ch = anchor.ch;
    }
    const filled = got.win ? got.full.map((r) => r.map(() => false)) : null;
    const vals = filled ? got.full.map((r) => r.map(() => NaN)) : got.full.map((r) => r.slice());
    if (a.kind === 'grid') {
      const rows = image ? undefined : a.rows?.slice(0, R), cols = image ? undefined : a.cols?.slice(0, Cn);
      const pad: Pad = {
        l: rows ? m.u(Math.max(...rows.map((r) => textWidth(r, m.labelPx))) + m.labelPx * 0.8) : 0,
        t: cols ? m.label * 1.6 : 0, r: 0,
        b: a.caption ? m.label * 2 : 0,
      };
      const placed = P(Cn * cs, R * ch, pad);
      // A window's output right under its input: each output cell sits under its window's centre.
      if (got.win && a.below && anchor?.id === got.win.over && anchor.cs) {
        const [kr, kc] = C.winSize(got.win.spec);
        const g = C.winGeometry(anchor.vals!.length, anchor.vals![0].length, got.win.spec)!;
        void kr;
        if (g.stride === 1 && Math.abs(anchor.cs - cs) < 1e-6) {
          const dx = ((kc - 1) / 2 - g.pc) * cs;
          placed.body.x += dx; placed.rect.x += dx;
        }
      }
      b = newBlock(id, 'grid', region, placed, m, got.deps);
      Object.assign(b, { src: a.src, full: got.full, vals, dp: a.dp, cs, cellPx, shade: image ? a.shade ?? 'image' : a.shade, em: a.em, ...(image ? { view: 'image', ch } : {}) });
      b.el.rows = shownAll(rows); b.el.cols = shownAll(cols); b.el.caption = a.caption;
    } else if (line) {
      const made = await makeLine(a as Extract<KitBlock, { kind: 'bars' }>, got, id, region, m, P, store);
      if (typeof made === 'string') return made;
      b = made;
    } else {
      const ev = eventual(a.src, got.full, (x) => store.get(x));
      const lf = a.labelsFrom && a.labelsFrom[1] >= 0 ? store.get(a.labelsFrom[0]) : undefined;
      const labels = shownAll((lf?.full ? lf.full.map((r) => C.fmt(r[a.labelsFrom![1]], lf.dp)) : a.labels)?.slice(0, Cn));
      // A slot is as wide as its label (words never run into each other); the bar keeps its own width.
      // Grouped bars (stack.side): a slot holds its group's parts side by side.
      const side = !!(parts && a.kind === 'bars' && a.stack?.side);
      const per = side ? Math.max(...parts!.map((r) => r.length)) : 1;
      const labW = labels?.length ? m.u(Math.max(...labels.map((l) => textWidth(l, m.labelPx))) + m.labelPx * 0.9) : 0;
      // One height for every bar chart (not its numerals' width): charts that share a scale share it.
      const H0 = m.u(m.numPx * 2.5) * 3.2;
      // A histogram's bins touch, across a fixed width (one x scale for every histogram that shares its bins).
      const slot = hist ? HIST_W / Cn : Math.max(side ? cs * (0.55 * per + 0.45) : cs, labW);
      const neg = ev[0].some((v) => v < 0) || (parts?.flat().some((v) => v < 0) ?? false);
      // One scale with the bars it sits beside when their ranges are alike (raw vs raw); its own otherwise.
      const ext = (v: number[]) => ({ pos: Math.max(0, ...v.filter(Number.isFinite)), neg: Math.max(0, ...v.filter(Number.isFinite).map((x) => -x)) });
      const mine = ext(side ? parts!.flat() : ev[0]);
      // Side by side (right=) is a comparison: one scale. Below is a new picture: its own.
      // A histogram keeps its own count scale (axes= shares its bins, not its heights).
      const span = (e: { pos: number; neg: number }) => e.pos + e.neg || 1;
      const alike = (g: { pos: number; neg: number }) => span(mine) / span(g) < 4 && span(g) / span(mine) < 4;
      let g0 = hist ? undefined : shareScale?.group ?? (anchor?.kind === 'bars' && anchor.group && a.right && alike(anchor.group) ? anchor.group : undefined);
      // Members of one scale share one body height (the scale is height / range) and so one baseline.
      const H = hist ? HIST_W * 0.42 : g0 ? g0.members[0].placed.body.h : parts && !side ? H0 * 1.25 : H0;
      // Stacked bars name their parts on the right, beside the last bar's segments; grouped bars in a legend there.
      const partW = a.parts?.length ? m.u(Math.max(...a.parts.map((l) => textWidth(shown(l), m.labelPx))) + m.labelPx * (side ? 2.2 : 1.2)) : 0;
      const pad: Pad = { l: 0, t: m.label * 1.5, r: partW, b: (neg ? m.label * 1.4 : 0) + (labels || hist ? m.label * 1.7 : 0) + (a.caption ? m.label * 1.9 : 0) + m.label * 0.4 };
      let placed = P(Cn * slot, H, pad);
      // In a scene the block is placed among everything; beside bars it shares (right=, or a chart the
      // scene put in the same row), the bodies line up so the baselines are one line.
      if (scene && !hist && !a.at) {
        const row = g0 ? (anchor?.group === g0 ? anchor : g0.members[0]) : rel ? undefined : store.inRegion(region).find((o) => o.kind === 'bars' && o.group && !o.plot && o.view !== 'line' && !o.el.hist && alike(o.group)
          && o.placed.body.y < placed.body.y + placed.body.h && placed.body.y < o.placed.body.y + o.placed.body.h && Math.abs(o.placed.body.h - H) < 1e-6);
        if (row) {
          const dy = row.placed.body.y - placed.body.y;
          const moved = { body: { ...placed.body, y: placed.body.y + dy }, rect: { ...placed.rect, y: placed.rect.y + dy } };
          const R = row.placed.rect, inRow = (o: Box) => o.x >= R.x - 1 && o.y >= R.y - 1 && o.x + o.w <= R.x + R.w + 1 && o.y + o.h <= R.y + R.h + 1;
          const hits = [...scene.rects(), ...unclaimed(env, ctx.target)].some((o) => !inRow(o)
            && o.x < moved.rect.x + moved.rect.w && moved.rect.x < o.x + o.w && o.y < moved.rect.y + moved.rect.h && moved.rect.y < o.y + o.h);
          if (!hits) { placed = moved; g0 = row.group; }
        }
      }
      b = newBlock(id, 'bars', region, placed, m, got.deps);
      if (parts) b.parts = parts;
      if (side) b.el.side = true;
      if (a.parts) b.el.partNames = shownAll(a.parts);
      b.el.store = store;
      if (hist) { b.el.hist = { lo: hist.lo, hi: hist.hi }; b.barW = slot * 0.94; }
      Object.assign(b, { src: a.src, full: got.full, vals, dp: a.dp, cs: slot, cellPx, em: a.em, barW: side ? slot - cs * 0.45 : cs * 0.62 });
      b.el.labels = labels; b.el.caption = a.caption;
      b.full = ev;
      if (g0 && (shareScale || alike(g0))) {
        g0.pos = Math.max(g0.pos, mine.pos); g0.neg = Math.max(g0.neg, mine.neg); g0.members.push(b); b.group = g0;
      } else b.group = { ...mine, members: [b] };
      if (a.ghost) {
        const gb = store.get(a.ghost);
        if (gb?.vals && gb.vals[0].length === Cn) { b.ghost = gb.vals[0].slice(); const e = ext(b.ghost); b.group.pos = Math.max(b.group.pos, e.pos); b.group.neg = Math.max(b.group.neg, e.neg); }
      }
    }
    if (got.win && !line) {
      const input = store.get(got.win.over)!;
      const geo = C.winGeometry(input.vals!.length, input.vals![0].length, got.win.spec)!;
      b.win = { over: got.win.over, kernel: got.win.kernel, spec: got.win.spec, geo, filled: filled!, pos: null, calc: null, rect: null, cur: null };
    }
  } else if (a.kind === 'table') {
    const lit = C.resolveCells(a.vals, a.cells, withConsts(store.consts, a.with));
    if (typeof lit === 'string') return lit;
    const R = lit.length, Cn = a.heads.length;
    const vals = lit.map((r) => [...r, ...Array(Cn - r.length).fill(NaN)]);
    const rh = m.num * 2, hh = m.label * 2.2;
    const ws = a.heads.map((h, j) => m.u(Math.max(textWidth(shown(h), m.labelPx), ...vals.map((r) => textWidth(C.fmt(r[j], a.dp), m.numPx)), m.numPx * 2.2) + m.numPx * 1.8));
    const placed = P(ws.reduce((x, y) => x + y, 0), R * rh, { l: 0, t: hh, r: 0, b: a.caption ? m.label * 2 : m.label * 0.3 });
    b = newBlock(id, 'table', region, placed, m, []);
    const xs: number[] = [];
    ws.reduce((x, w) => { xs.push(x); return x + w; }, placed.body.x);
    Object.assign(b, { vals, full: vals.map((r) => r.slice()), dp: a.dp, em: a.em, src: { vals }, litCols: a.vals[0].length, litFrac: !!a.frac });
    b.tab = { heads: a.heads.slice(), xs, ws, rh, hh, filled: vals.map((r) => r.map((v) => Number.isFinite(v))) };
    b.el.caption = a.caption;
  } else if (a.kind === 'scatter') {
    let data = a.data, all = a.data;
    if (a.cols) {
      const t = await store.wait(a.cols.id);
      if (!t || t.kind !== 'table') return `no table ${a.cols.id}`;
      const n = t.vals![0].length;
      if (a.cols.x < 0 || a.cols.y < 0) return `no column ${a.cols.x < 0 ? a.cols.xName : a.cols.yName}`;
      if (a.cols.x >= n || a.cols.y >= n) return 'no such column';
      data = t.vals!.map((r) => ({ x: r[a.cols!.x], y: r[a.cols!.y] }));
      all = t.full!.map((r) => ({ x: r[a.cols!.x], y: r[a.cols!.y] }));
    }
    const fin = all!.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    if (fin.length < 2) return 'scatter needs two points';
    const xs = fin.map((p) => p.x), ys = fin.map((p) => p.y);
    const padd = (lo: number, hi: number) => { const d = hi - lo || Math.abs(hi) || 1; return [lo - d * 0.08, hi + d * 0.08]; };
    const [x0, x1] = padd(Math.min(...xs), Math.max(...xs)), [y0, y1] = padd(Math.min(...ys), Math.max(...ys));
    // A chart uses the board (about three quarters of its width), smaller beside another block.
    // axes=: the points go onto a line's or plot's axes (one scale with its curves), no axes of their own.
    const host = a.axes ? await store.wait(a.axes) : undefined;
    if (a.axes && !host?.plot) return `no line or plot ${a.axes} to put the points on`;
    const w = a.right ? Math.max(CHART_MIN.w, m.cell * 7) : CHART_W, h = a.right ? Math.max(CHART_MIN.h, m.cell * 4.6) : CHART_W * 0.58;
    const tickW = Math.max(...C.ticks(y0, y1).map((t) => textWidth(C.fmt(t), m.labelPx)));
    // Above the plot: the y label (left) and live readouts (right), never over the data.
    const pad: Pad = { l: m.u(tickW + m.labelPx * 0.9), t: m.label * 2, r: m.label * 0.6, b: m.label * 1.8 + (a.xLabel ? m.label * 1.5 : 0) + (a.caption ? m.label * 1.9 : 0) };
    const hp = host?.plot;
    b = newBlock(id, 'scatter', region, hp ? { body: { ...hp.host.placed.body }, rect: { ...hp.host.placed.rect } } : P(w, h, pad), m, []);
    Object.assign(b, { data, dom: hp ? { ...hp.dom } : { x0, x1, y0, y1 }, fits: [], em: a.em, cols: a.cols });
    if (hp) b.el.overlay = hp.host.id;
    if (a.cols) b.deps = [a.cols.id];
    b.el.xLabel = a.xLabel; b.el.yLabel = a.yLabel; b.el.caption = a.caption;
  } else if (a.kind === 'shares') {
    const got = computeSource(a.src, (x) => store.get(x), id, withConsts(store.consts, a.with));
    if (typeof got === 'string') return got;
    const raw = got.full.flat();
    if (raw.some((v) => v < 0)) return 'shares need values of 0 or more';
    const vals = [normalize(raw)];
    if (vals[0].some((v) => !Number.isFinite(v))) return 'shares: the values sum to 0';
    const labels = shownAll(a.labels?.slice(0, raw.length)) ?? sourceLabels(a.src, store);
    const W = Math.max(m.cell * 7.5, Math.min(m.cell * 13, raw.length * m.cell * 1.9)), H = m.cell * 0.82;
    const mix = a.mix ? store.get(a.mix) : undefined;
    if (a.mix && !mix?.vals) return `unknown block ${a.mix}`;
    const pad: Pad = { l: 0, t: m.label * 1.6, r: mix ? m.u(textWidth('= 00.00', m.numPx)) + m.gap * 0.6 : 0, b: m.label * 1.9 + (a.caption ? m.label * 1.8 : 0) };
    b = newBlock(id, 'shares', region, P(W, H, pad), m, [...got.deps, ...(mix ? [mix.id] : [])]);
    Object.assign(b, { src: a.src, full: vals, vals, dp: a.dp, em: a.em });
    b.el.labels = labels; b.el.caption = a.caption; b.el.mix = a.mix;
  } else if (a.kind === 'tokens') {
    const n = tokenCount(a.n, withConsts(store.consts, a.with));
    if (typeof n === 'string') return n;
    const states = a.states.length ? a.states : [''];
    // One cluster per state, side by side, each a compact grid (room for every mark in any one state);
    // marks and labels sized from the board's type, the whole block within the section's width.
    const { cols, pitch } = tokenGrid(n, states.length, m);
    const rows = Math.ceil(n / cols), T = tokenType(m);
    const W = (states.length * cols + (states.length - 1) * TOKEN_GAP) * pitch;
    const pad: Pad = { l: 0, t: T.label * 0.4, r: 0, b: T.num * 1.4 + (states[0] ? T.label * 1.3 : 0) + (a.caption ? T.label * 1.9 : 0) + T.label * 0.4 };
    b = newBlock(id, 'tokens', region, P(W, rows * pitch, pad), m, []);
    b.tok = { states, st: Array(n).fill(0), cols, pitch };
    Object.assign(b, { full: [[n]], vals: [[n]], em: a.em });
    b.el.caption = a.caption;
  } else {
    // calc
    const srcs = a.of.map((x) => store.get(x));
    if (srcs.some((x) => !x?.vals)) return `unknown block ${a.of.find((x, i) => !srcs[i]?.vals)}`;
    const left = Math.min(...srcs.map((s) => s!.placed.body.x));
    const at = a.at ?? (a.right || a.below ? undefined : { x: left, y: (others.length ? Math.max(...others.map((o) => o.rect.y + o.rect.h)) + m.gap * 0.8 : m.top) });
    const exp = calcExpansion({ of: a.of, reduce: a.reduce, fn: a.fn, q: a.q, label: a.label }, store, a.dp);
    if (typeof exp === 'string') return exp;
    const W = (x: string) => m.u(textWidth(x, m.numPx));
    const pieces = piecesOf(exp, a.label);
    const pitch = m.num * 1.55;
    const spec = { right: a.right, below: a.below, op: a.op, at: at as Pt | undefined };
    const first = place(Math.min(pieces.reduce((t, x) => t + W(x), 0), 1000 - 2 * m.margin), pitch, { l: 0, t: 0, r: 0, b: 0 }, spec, anchor?.placed, others, spacing);
    const maxW = Math.max(m.u(m.numPx * 8), 1000 - m.margin - first.body.x);
    const wrapped = wrapPieces(pieces, maxW, W);
    const lines = wrapped.length;
    const textW = Math.min(maxW, Math.max(...wrapped.map((l) => l.reduce((t, x) => t + W(x), 0))));
    const h = lines * pitch;
    // Beside a block: centred on its line, however many lines it wraps to.
    const y = a.right ? first.body.y + pitch / 2 - h / 2 : first.body.y;
    const body = { x: first.body.x, y, w: textW, h };
    const placed: Placed = { body, rect: { ...body }, ...(first.op ? { op: first.op } : {}) };
    b = newBlock(id, 'calc', region, placed, m, [...a.of]);
    b.calc = { of: a.of, reduce: a.reduce, fn: a.fn, q: a.q, label: a.label, lines, maxW };
    b.dp = a.dp; b.em = a.em;
  }
  if (sceneOp) b.el.sceneOp = sceneOp;
  if (a.with) b.el.with = a.with;
  return planFor(b, a.id, ctx, env, store, region, m, c);
}

/** Adds a built block to the answer and returns its plan: the section grows and recentres; draw renders it. */
function planFor(b: Block, aid: string | undefined, ctx: TargetCtx, env: BuildEnv, store: KitStore, region: string, m: Metrics, c: ReturnType<typeof col>): ElementPlan {
  store.add(b);
  b.el.accent = env.settings.inkColor;
  if (ctx.scene) { const claim = ctx.scene.claim(b.placed.rect); sceneStore(env.registry).put(b.id, { rect: b.placed.rect, claim, moved: new Set(), data: { kind: 'kit' } }); }
  // A chart plot draws on its page: no section to grow or centre.
  if (b.target && b.target.region == null) return chartPlan(b, aid, ctx, env, c);
  grow(env, region, b.placed.rect);
  const reach = (x: Block) => union([x.placed.rect, ...(x.placed.op ? [{ x: x.placed.op.x - x.m.opW / 2, y: x.placed.op.y - x.m.num, w: x.m.opW, h: 2 * x.m.num }] : [])]);
  const bbox = pad(union([b.placed.rect, ...(b.placed.op ? [{ x: b.placed.op.x - m.opW, y: b.placed.op.y - m.num, w: 2 * m.opW, h: 2 * m.num }] : [])]), m.u(8));
  // The composition sits centred on the board: the group shifts as it grows, its layout stays left-aligned.
  const all = union(store.inRegion(region).map(reach));
  env.desk.centreRegion?.(region, all.x, all.x + all.w);
  return {
    target: ctx.target,
    bbox,
    draw: async (signal, k) => {
      const g = svg(ctx.layers.agent, 'g', { class: 'kit-block', 'data-kit': b.kind });
      b.g = g;
      env.registry.define({ id: aid, kind: `kit-${b.kind}`, target: ctx.target, bbox: b.placed.rect, boxes: [b.placed.rect], anchor: { x: b.placed.body.x + b.placed.body.w, y: b.placed.body.y }, group: g, strokes: [outline(b.placed.body)] });
      b.markReady();
      const pace = signal.aborted ? { speed: 0, fadeMs: 0 } : k;
      if (b.placed.op) drawOp(g, b, c);
      if (b.kind === 'grid') await drawGrid(b, c, env, pace);
      else if (b.kind === 'bars') await drawBars(b, c, env, pace);
      else if (b.kind === 'scatter') {
        // A table's rows may have filled since the build.
        if (b.cols) { const t = store.get(b.cols.id); if (t) b.data = t.vals!.map((r) => ({ x: r[b.cols!.x], y: r[b.cols!.y] })); }
        await drawScatter(b, c, pace);
      }
      else if (b.kind === 'table') await drawTable(b, c, pace);
      else if (b.kind === 'shares') await drawShares(b, store, c, pace);
      else if (b.kind === 'tokens') await drawTokens(b, c, pace);
      else await drawCalc(b, store, c, env, pace, true);
      const so = b.el.sceneOp as { from: string; glyph: string } | undefined;
      if (so) await sceneLink(so.from, b.id, /^[→↓]$/.test(so.glyph) ? '' : so.glyph, ctx, env, pace);
    },
  };
}

const outline = (r: Box) => [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }, { x: r.x, y: r.y }];
const pad = (r: Box, p: number): Box => ({ x: r.x - p, y: r.y - p, w: r.w + 2 * p, h: r.h + 2 * p });
function union(rs: Box[]): Box {
  const x = Math.min(...rs.map((r) => r.x)), y = Math.min(...rs.map((r) => r.y));
  return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y };
}
const px = (b: Block, n: number) => b.m.u(n);
const hair = (w: number) => ({ 'stroke-width': w, 'vector-effect': 'non-scaling-stroke' });

/** Fades a group in (or appears at once when backlogged / reduced motion). */
async function appear(el: SVGElement, ms: number, k: Pace) {
  if (k.fadeMs != null || prefersReducedMotion()) { el.setAttribute('opacity', '1'); return; }
  el.setAttribute('opacity', '0');
  await tween(ms * k.speed, (t) => el.setAttribute('opacity', String(t)), undefined, easeOut);
}

/** A block's caption under it; a variable's name (u, v) in math italic, a shade darker. */
function caption(g: Element, x: number, y: number, cap: string, m: Metrics, c: ReturnType<typeof col>) {
  const v = isVarName(cap);
  const t = kitText(g, x, y, cap, { size: v ? m.label * 1.2 : m.label, fill: v ? c.ink2 : c.muted });
  t.setAttribute('data-kit-caption', '');
  if (v) { t.setAttribute('font-style', 'italic'); t.setAttribute('font-family', 'KaTeX_Math, "STIX Two Math", "Cambria Math", "Times New Roman", serif'); }
  return t;
}

/**
 * set id=b "…" on a block: its caption takes the new words. Once drawn is drawn: the old caption fades
 * out where it is and the new one fades in on the same spot with an accent flash (a line's name at its
 * end likewise). Words wider than the block squeeze to its room when a neighbour sits beside it.
 */
export async function setCaption(id: string, text: string, env: BuildEnv): Promise<ElementPlan | string> {
  const store = kitStore(env.registry);
  const b = await store.wait(id);
  if (!b) return `unknown block ${id}`;
  if (!b.el.caption) return `${id} has no caption to set (name it with "…" on its tag)`;
  const accent = env.settings.inkColor;
  return {
    target: tgtOf(b), bbox: pad(b.placed.rect, b.m.u(8)),
    draw: async (_signal, k) => {
      await b.ready;
      const c = col(), m = b.m;
      const still = k.fadeMs != null || prefersReducedMotion();
      b.el.caption = text;
      const olds = b.g ? [...b.g.querySelectorAll('[data-kit-caption]')] as SVGTextElement[] : [];
      const line = (b.el.line as LineEls | undefined)?.label ?? null;
      await tween(still ? 0 : 160 * k.speed, (x) => { olds.forEach((t) => t.setAttribute('opacity', String(1 - x))); line?.setAttribute('opacity', String(1 - x)); });
      // Room: the block's own width, or more where nothing else sits beside it.
      const r = b.placed.rect, w = m.u(textWidth(text, m.labelPx));
      const room = (cx: number, y: number) => {
        const want = { x: cx - w / 2, y: y - m.label, w, h: m.label * 2 };
        const others = [...store.inRegion(b.region).filter((o) => o !== b).map((o) => o.placed.rect), ...env.registry.obstacles({ region: b.region }, id, true).filter((o) => !(o.x >= r.x - 1 && o.y >= r.y - 1 && o.x + o.w <= r.x + r.w + 1 && o.y + o.h <= r.y + r.h + 1))];
        return others.some((o) => o.x < want.x + want.w && want.x < o.x + o.w && o.y < want.y + want.h && want.y < o.y + o.h) ? Math.max(r.w, 1) : Infinity;
      };
      const news = olds.map((o) => {
        const x = Number(o.getAttribute('x')), y = Number(o.getAttribute('y'));
        const t = caption(o.parentElement!, x, y, text, m, c);
        const fit = room(x, y);
        if (w > fit) setAttrs(t, { textLength: fit, lengthAdjust: 'spacingAndGlyphs' });
        setAttrs(t, { opacity: 0, fill: accent });
        o.remove();
        return { t, fill: isVarName(text) ? c.ink2 : c.muted };
      });
      if (line) { line.textContent = text; line.setAttribute('fill', accent); }
      await tween(still ? 0 : 240 * k.speed, (x) => { news.forEach((n) => n.t.setAttribute('opacity', String(x))); line?.setAttribute('opacity', String(x)); }, undefined, easeOut);
      await pause(still ? 0 : 500 * k.speed);
      news.forEach((n) => n.t.setAttribute('fill', n.fill));
      if (line) line.setAttribute('fill', lineColor(b, c, accent));
    },
  };
}

function drawOp(g: SVGGElement, b: Block, c: ReturnType<typeof col>) {
  const o = b.placed.op!;
  const t = kitText(g, o.x, o.y, o.glyph, { size: b.m.num * 1.45, fill: c.ink2 });
  t.setAttribute('font-family', 'KaTeX_Main, "STIX Two Math", "Cambria Math", serif');
}

// ------------------------------------------------------------------------------------------------
// grid

type GridEls = { cells: SVGRectElement[][]; texts: SVGTextElement[][]; over: SVGGElement; emph?: SVGRectElement; emCells?: [number, number][]; /** a decimated image: br×bc cells share one square, shaded by their mean */ bin?: { br: number; bc: number } };

function rangeOf(b: Block): [number, number] {
  const xs = (b.win ? b.full! : b.vals!).flat().filter(Number.isFinite);
  // An image spans its own range (dark = its lowest value), so its contrast is what the values make.
  if (b.view === 'image') return xs.length ? [Math.min(...xs), Math.max(...xs)] : [0, 1];
  return xs.length ? [Math.min(0, ...xs), Math.max(...xs)] : [0, 1];
}

async function drawGrid(b: Block, c: ReturnType<typeof col>, env: BuildEnv, k: Pace) {
  if (b.view === 'image') return drawImage(b, c, k);
  const g = b.g!, { body } = b.placed, cs = b.cs!, ch = b.ch ?? cs, m = b.m;
  const [R, Cn] = C.shape(b.vals!);
  const frame = svg(g, 'g');
  const [lo, hi] = rangeOf(b);
  const cells: SVGRectElement[][] = [], texts: SVGTextElement[][] = [];
  for (let r = 0; r < R; r++) {
    cells.push([]);
    for (let q = 0; q < Cn; q++) {
      const sh = shadeOf(b.vals![r][q], b.shade, lo, hi, c);
      cells[r].push(svg(frame, 'rect', { x: body.x + q * cs, y: body.y + r * cs, width: cs, height: cs, fill: sh.fill }));
    }
  }
  let d = '';
  for (let r = 1; r < R; r++) d += `M${body.x} ${body.y + r * cs}H${body.x + body.w}`;
  for (let q = 1; q < Cn; q++) d += `M${body.x + q * cs} ${body.y}V${body.y + body.h}`;
  if (d) svg(frame, 'path', { d, fill: 'none', stroke: c.line, ...hair(1) });
  svg(frame, 'rect', { x: body.x, y: body.y, width: body.w, height: body.h, fill: 'none', stroke: c.edge, rx: px(b, 1.5), ...hair(1.2) });
  const labels = svg(g, 'g');
  const rows = b.el.rows as string[] | undefined, cols = b.el.cols as string[] | undefined, cap = b.el.caption as string | undefined;
  rows?.forEach((s, r) => kitText(labels, body.x - m.label * 0.6, body.y + (r + 0.5) * cs, s, { size: m.label, fill: c.muted, anchor: 'end' }));
  cols?.forEach((s, q) => kitText(labels, body.x + (q + 0.5) * cs, body.y - m.label * 0.85, s, { size: m.label, fill: c.muted }));
  if (cap) caption(labels, body.x + body.w / 2, body.y + body.h + m.label * 1.2, cap, m, c);
  const numG = svg(g, 'g');
  for (let r = 0; r < R; r++) {
    texts.push([]);
    for (let q = 0; q < Cn; q++) {
      const sh = shadeOf(b.vals![r][q], b.shade, lo, hi, c);
      texts[r].push(kitText(numG, body.x + (q + 0.5) * cs, body.y + (r + 0.5) * cs, C.fmt(b.vals![r][q], b.dp, fracOf(b)), { size: m.num, fill: sh.text }));
    }
  }
  const over = svg(g, 'g', { class: 'kit-over' });
  b.el.grid = { cells, texts, over } satisfies GridEls;
  // Build up: the frame and labels, then the numerals row by row.
  texts.flat().forEach((t) => t.setAttribute('opacity', '0'));
  await appear(frame, 200, k);
  void appear(labels, 200, k);
  if (k.fadeMs != null || prefersReducedMotion()) { texts.flat().forEach((t) => t.setAttribute('opacity', '1')); return; }
  const row = Math.min(70, 420 / Math.max(1, R)) * k.speed;
  await Promise.all(texts.map((ts, r) => pause(r * row).then(() => tween(160 * k.speed, (t) => ts.forEach((x) => x.setAttribute('opacity', String(t)))))));
  void env;
}

/**
 * A grid as an image: one shaded square per cell (a hair of overlap, so no seams), no grid lines and
 * no numerals; a light frame and the caption. Its numerals exist (detached) so every verb works the same.
 */
async function drawImage(b: Block, c: ReturnType<typeof col>, k: Pace) {
  const g = b.g!, { body } = b.placed, cs = b.cs!, ch = b.ch ?? cs, m = b.m;
  const [R, Cn] = C.shape(b.vals!);
  const frame = svg(g, 'g');
  const [lo, hi] = rangeOf(b);
  const ov = px(b, 0.5);
  const cells: SVGRectElement[][] = [], texts: SVGTextElement[][] = [];
  // Computed in full, shown decimated: past MAX_IMG a side, a square shows the mean of br×bc cells.
  const br = Math.ceil(R / C.MAX_IMG), bc = Math.ceil(Cn / C.MAX_IMG);
  const bin = br > 1 || bc > 1 ? { br, bc } : undefined;
  const squares: SVGRectElement[][] = [], numerals: SVGTextElement[][] = [];
  for (let i = 0; i < Math.ceil(R / br); i++) {
    squares.push([]); numerals.push([]);
    for (let j = 0; j < Math.ceil(Cn / bc); j++) {
      const h = Math.min(br, R - i * br) * ch, w = Math.min(bc, Cn - j * bc) * cs;
      squares[i].push(svg(frame, 'rect', { x: body.x + j * bc * cs, y: body.y + i * br * ch, width: w + ov, height: h + ov, fill: shadeOf(binMean(b.vals!, i, j, br, bc), b.shade, lo, hi, c).fill }));
      numerals[i].push(document.createElementNS('http://www.w3.org/2000/svg', 'text'));
    }
  }
  for (let r = 0; r < R; r++) {
    cells.push([]); texts.push([]);
    for (let q = 0; q < Cn; q++) { cells[r].push(squares[Math.floor(r / br)][Math.floor(q / bc)]); texts[r].push(numerals[Math.floor(r / br)][Math.floor(q / bc)]); }
  }
  svg(frame, 'rect', { x: body.x, y: body.y, width: body.w, height: body.h, fill: 'none', stroke: c.edge, ...hair(1) });
  const cap = b.el.caption as string | undefined;
  if (cap) caption(frame, body.x + body.w / 2, body.y + body.h + m.label * 1.2, cap, m, c);
  const over = svg(g, 'g', { class: 'kit-over' });
  b.el.grid = { cells, texts, over, ...(bin ? { bin } : {}) } satisfies GridEls;
  await appear(frame, 320, k);
}

/** The mean of the finite values in bin (i, j) of br×bc cells; NaN when it has none. */
function binMean(v: C.Mat, i: number, j: number, br: number, bc: number): number {
  let s = 0, n = 0;
  for (let r = i * br; r < Math.min(v.length, (i + 1) * br); r++) for (let q = j * bc; q < Math.min(v[r].length, (j + 1) * bc); q++) if (Number.isFinite(v[r][q])) { s += v[r][q]; n++; }
  return n ? s / n : NaN;
}

/** Shows grid values (tweened from what is shown now over `ms`). Blank (NaN) cells stay empty. */
async function setGridVals(b: Block, next: C.Mat, ms: number, ctl: Ctl | undefined, c: ReturnType<typeof col>, accent?: [number, number] | null, accentColor?: string) {
  const els = b.el.grid as GridEls | undefined;
  const prev = b.vals!.map((r) => r.slice());
  b.vals = next.map((r) => r.slice());
  if (!els) return;
  const [lo, hi] = rangeOf(b);
  const dps = next.map((r) => r.map((v) => (b.dp != null ? b.dp : decimals(v))));
  await tween(ms, (t) => {
    next.forEach((row, r) => row.forEach((v, q) => {
      const p = prev[r][q];
      const blank = !Number.isFinite(v);
      const cur = blank ? NaN : Number.isFinite(p) ? p + (v - p) * t : v;
      const sh = shadeOf(cur, b.shade, lo, hi, c);
      els.cells[r][q].setAttribute('fill', sh.fill);
      const tx = els.texts[r][q];
      tx.textContent = blank ? '' : t >= 1 ? C.fmt(v, b.dp, fracOf(b)) : C.fmt(Number(cur.toFixed(dps[r][q])), dps[r][q]);
      const em = (accent && accent[0] === r && accent[1] === q) || els.emCells?.some(([a, z]) => a === r && z === q) || (b.el.whereHits as [number, number][] | undefined)?.some(([a, z]) => a === r && z === q);
      tx.setAttribute('fill', em ? accentColor ?? c.ink : sh.text);
      tx.setAttribute('font-weight', em ? '600' : '400');
      if (!Number.isFinite(p) && !blank) tx.setAttribute('opacity', String(t));
    }));
    // A decimated image: each square shows its cells' mean as they are now.
    if (els.bin) {
      const { br, bc } = els.bin;
      const cur = next.map((row, r) => row.map((v, q) => { const p = prev[r][q]; return !Number.isFinite(v) ? NaN : Number.isFinite(p) ? p + (v - p) * t : v; }));
      for (let i = 0; i * br < cur.length; i++) for (let j = 0; j * bc < cur[0].length; j++) els.cells[i * br][j * bc].setAttribute('fill', shadeOf(binMean(cur, i, j, br, bc), b.shade, lo, hi, c).fill);
    }
  }, ctl);
}
/** A numeral's resting look: emphasized cells keep the accent, others their shade's ink. */
function restCell(b: Block, r: number, q: number, c: ReturnType<typeof col>, accent: string) {
  const els = b.el.grid as GridEls;
  const tx = els.texts[r][q];
  const em = els.emCells?.some(([a, z]) => a === r && z === q) || (b.el.whereHits as [number, number][] | undefined)?.some(([a, z]) => a === r && z === q);
  const [lo, hi] = rangeOf(b);
  tx.setAttribute('fill', em ? accent : shadeOf(b.vals![r][q], b.shade, lo, hi, c).text);
  tx.setAttribute('font-weight', em ? '600' : '400');
}
const decimals = (v: number) => { const s = C.fmt(v); const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; };

/** Section box of a grid's cells r0–r1 × c0–c1 (0-based, inclusive). */
function cellBox(b: Block, r0: number, r1: number, c0: number, c1: number): Box {
  const cs = b.cs!, ch = b.ch ?? cs, { body } = b.placed;
  return { x: body.x + c0 * cs, y: body.y + r0 * ch, w: (c1 - c0 + 1) * cs, h: (r1 - r0 + 1) * ch };
}

// ------------------------------------------------------------------------------------------------
// bars

type BarEls = { bars: SVGRectElement[]; vals: SVGTextElement[]; ghosts: SVGGElement; base: SVGLineElement; emBars: Set<number>; /** stacked: per bar, its segments and their numerals; the part names */ segs?: { g: SVGGElement; rects: SVGRectElement[]; texts: SVGTextElement[] }[]; names?: SVGGElement };

/** Bar i's rect for value v in the block's current scale. */
function barRect(b: Block, i: number, v: number): Box {
  const { body } = b.placed, slot = b.cs!, w = b.barW ?? slot * 0.62;
  const gr = b.group!, span = gr.pos + gr.neg || 1, k = body.h / span;
  const base = body.y + gr.pos * k;
  const x = body.x + i * slot + (slot - w) / 2;
  const hgt = Number.isFinite(v) ? Math.abs(v) * k : 0;
  return v >= 0 ? { x, y: base - hgt, w, h: hgt } : { x, y: base, w, h: hgt };
}
const baseY = (b: Block) => { const gr = b.group!, span = gr.pos + gr.neg || 1; return b.placed.body.y + gr.pos * (b.placed.body.h / span); };

async function drawBars(b: Block, c: ReturnType<typeof col>, env: BuildEnv, k: Pace) {
  if (b.view === 'line') return drawLine(b, c, env, k);
  const g = b.g!, { body } = b.placed, m = b.m, n = b.vals![0].length;
  const ghosts = svg(g, 'g');
  const base = svg(g, 'line', { x1: body.x - px(b, 6), x2: body.x + body.w + px(b, 6), y1: baseY(b), y2: baseY(b), stroke: c.edge, ...hair(1) });
  const bars: SVGRectElement[] = [], vals: SVGTextElement[] = [];
  const barsG = svg(g, 'g'), valG = svg(g, 'g'), labG = svg(g, 'g');
  for (let i = 0; i < n; i++) {
    const r = barRect(b, i, 0);
    bars.push(svg(barsG, 'rect', { x: r.x, y: r.y, width: r.w, height: 0, fill: c.bar, 'fill-opacity': 0.85, rx: px(b, 1.5) }));
    vals.push(kitText(valG, r.x + r.w / 2, r.y, '', { size: m.label, fill: c.ink }));
  }
  const labels = b.el.labels as string[] | undefined, cap = b.el.caption as string | undefined;
  const negs = b.group!.neg > 0;
  const below = body.y + body.h + (negs ? m.label * 1.4 : 0);
  labels?.forEach((s, i) => kitText(labG, body.x + (i + 0.5) * b.cs!, below + m.label * 0.95, s, { size: m.label, fill: c.muted }));
  const hist = b.el.hist as { lo: number; hi: number } | undefined;
  if (hist) for (const t of C.ticks(hist.lo, hist.hi, 5)) {
    // The bins' value scale: a few round values under the bars.
    const x = body.x + ((t - hist.lo) / (hist.hi - hist.lo)) * body.w;
    svg(labG, 'line', { x1: x, x2: x, y1: below, y2: below + px(b, 4), stroke: c.edge, ...hair(1) });
    kitText(labG, x, below + m.label * 0.95, C.fmt(t), { size: m.label, fill: c.muted });
  }
  if (cap) caption(labG, body.x + body.w / 2, below + (labels || b.el.hist ? m.label * 2.5 : m.label * 1.1), cap, m, c);
  b.el.bars = { bars, vals, ghosts, base, emBars: new Set(), segs: [], names: svg(g, 'g') } satisfies BarEls;
  if (b.ghost) drawGhosts(b, b.ghost, c);
  await appear(labG, 160, k);
  const target = b.vals!.map((r) => r.slice());
  b.vals = [target[0].map(() => 0)];
  await setBarVals(b, target, k.fadeMs != null ? 0 : 420 * k.speed, undefined, c);
  void env;
}

function drawGhosts(b: Block, ghost: number[], c: ReturnType<typeof col>) {
  const els = b.el.bars as BarEls;
  els.ghosts.replaceChildren();
  ghost.forEach((v, i) => {
    if (!Number.isFinite(v)) return;
    const r = barRect(b, i, v);
    svg(els.ghosts, 'rect', { x: r.x, y: r.y, width: r.w, height: r.h, fill: 'none', stroke: c.muted, 'stroke-dasharray': '3 3', ...hair(1) });
  });
}

/** Tweens bars (and their value labels) to `next`; the group rescales when needed, and its other members follow. */
async function setBarVals(b: Block, next: C.Mat, ms: number, ctl: Ctl | undefined, c: ReturnType<typeof col>) {
  if (b.view === 'line') return setLineVals(b, next, ms, ctl, c);
  const els = b.el.bars as BarEls | undefined;
  const prev = b.vals![0].slice();
  b.vals = next.map((r) => r.slice());
  const gr = b.group!;
  const old = { pos: gr.pos, neg: gr.neg };
  const all = gr.members.flatMap((x) => [...(x.vals?.[0] ?? []), ...(x.full?.[0] ?? []), ...(x.ghost ?? [])]).filter(Number.isFinite);
  gr.pos = Math.max(0, ...all); gr.neg = Math.max(0, ...all.map((v) => -v));
  const rescale = old.pos !== gr.pos || old.neg !== gr.neg;
  const others = rescale ? gr.members.filter((x) => x !== b && x.el.bars) : [];
  const tgt = { pos: gr.pos, neg: gr.neg };
  if (!els) return;
  const m = b.m;
  const paint = (x: Block, vs: number[], from: number[], t: number) => {
    const e = x.el.bars as BarEls;
    vs.forEach((v, i) => {
      const f = Number.isFinite(from[i]) ? from[i] : 0;
      const cur = f + ((Number.isFinite(v) ? v : 0) - f) * t;
      const r = barRect(x, i, cur);
      const stacked = (x.parts?.[i]?.length ?? 0) > 1;
      setAttrs(e.bars[i], { x: r.x, y: r.y, width: r.w, height: Math.max(0, r.h), fill: e.emBars.has(i) ? token('--kit-accent') || c.bar : c.bar, 'fill-opacity': stacked ? 0 : 0.85 });
      const lab = Number.isFinite(v) ? (t >= 1 ? C.fmt(v, x.dp, fracOf(x)) : C.fmt(Number(cur.toFixed(x.dp ?? decimals(v))), x.dp ?? decimals(v))) : '';
      // A histogram of many bins reads by its shape: counts only when there are few.
      e.vals[i].textContent = (x.el.hist && vs.length > 10) || x.el.side ? '' : lab;
      setAttrs(e.vals[i], { x: r.x + r.w / 2, y: cur >= 0 ? r.y - m.label * 0.7 : r.y + r.h + m.label * 0.7 });
      if (x.parts) paintParts(x, i, r, t, c);
    });
    if (x.parts) (x.el.side ? paintLegend : paintPartNames)(x, c);
    const by = baseY(x);
    setAttrs(e.base, { y1: by, y2: by });
    if (x.ghost) drawGhosts(x, x.ghost, c);
  };
  await tween(ms, (t) => {
    gr.pos = old.pos + (tgt.pos - old.pos) * t; gr.neg = old.neg + (tgt.neg - old.neg) * t;
    paint(b, next[0], prev, t);
    for (const o of others) paint(o, o.vals![0], o.vals![0], 1);
  }, ctl);
  gr.pos = tgt.pos; gr.neg = tgt.neg;
}

/** A stacked bar's part tones, bottom up: the bar's own, then lighter (one accent stays free for emph). */
/** A group's height on the scale (grouped bars): its part of largest size, with its sign. */
const groupTop = (r: number[]) => r.reduce((t, v) => (Math.abs(v) > Math.abs(t) ? v : t), 0);

const partTone = (j: number, c: ReturnType<typeof col>) => (j === 0 ? c.bar : mix(c.bar, c.cell, Math.min(0.8, 0.42 + 0.2 * (j - 1))));

/**
 * Bar i's parts inside its rect r (a total at its current height): segments bottom up in proportion to
 * the parts (tweened from `el.partsFrom`), each with its value centred when it fits. A split in progress
 * (`el.splitT`) opens the gaps and turns the tones as it goes.
 */
function paintParts(b: Block, i: number, r: Box, t: number, c: ReturnType<typeof col>) {
  const e = b.el.bars as BarEls, m = b.m;
  const to = b.parts![i], from = (b.el.partsFrom as number[][] | undefined)?.[i];
  const ps = to.map((p, j) => { const f = from?.[j]; return f != null && Number.isFinite(f) ? f + (p - f) * t : p; });
  const s = (b.el.splitT as Map<number, number> | undefined)?.get(i) ?? 1;
  let seg = e.segs![i];
  if (!seg) { seg = { g: svg(e.bars[i].parentNode as SVGGElement, 'g'), rects: [], texts: [] }; e.segs![i] = seg; }
  while (seg.rects.length < ps.length) { seg.rects.push(svg(seg.g, 'rect', { rx: px(b, 1.5) })); seg.texts.push(kitText(seg.g, 0, 0, '', { size: m.label, fill: c.ink })); }
  seg.rects.slice(ps.length).forEach((x) => x.setAttribute('height', '0'));
  seg.texts.slice(ps.length).forEach((x) => { x.textContent = ''; });
  if (b.el.side) return paintSide(b, i, r, ps, to, t, seg, c);
  const sum = ps.reduce((a, v) => a + Math.max(0, v), 0) || 1;
  const gap = ps.length > 1 ? px(b, 2) * s : 0;
  let y = r.y + r.h;
  ps.forEach((p, j) => {
    const h = Math.max(0, (r.h * Math.max(0, p)) / sum - (j < ps.length - 1 ? gap : 0));
    y -= h;
    const tone = e.emBars.has(i) ? token('--kit-accent') || c.bar : mix(c.bar, partTone(j, c), s);
    setAttrs(seg.rects[j], { x: r.x, y, width: r.w, height: h, fill: tone, 'fill-opacity': 0.9 });
    // The part's value in the middle of its segment, when the segment holds it.
    const fits = ps.length > 1 && h > m.label * 1.15;
    seg.texts[j].textContent = fits ? C.fmt(t >= 1 ? to[j] : Number(p.toFixed(b.dp ?? 1)), b.dp) : '';
    setAttrs(seg.texts[j], { x: r.x + r.w / 2, y: y + h / 2, fill: j === 0 ? c.cell : c.ink, opacity: s });
    y -= j < ps.length - 1 ? gap : 0;
  });
}

/**
 * Grouped bars: group i's parts side by side across its bar's width, each from the baseline on the
 * block's (shared) scale, its value above it; tones by part, so a part reads the same in every group.
 * `r` is the group's envelope as it grows (the first draw rises from the baseline as one).
 */
function paintSide(b: Block, i: number, r: Box, ps: number[], to: number[], t: number, seg: { rects: SVGRectElement[]; texts: SVGTextElement[] }, c: ReturnType<typeof col>) {
  const e = b.el.bars as BarEls, m = b.m, n = ps.length;
  const full = barRect(b, i, groupTop(ps)).h;
  const fr = full > 0 ? Math.min(1, r.h / full) : 1;
  const gap = n > 1 ? Math.min(px(b, 3), r.w / n / 5) : 0, w = (r.w - gap * (n - 1)) / n;
  ps.forEach((p, j) => {
    const q = barRect(b, i, p), h = q.h * fr;
    const x = r.x + j * (w + gap), y = p >= 0 ? q.y + q.h - h : q.y;
    const tone = e.emBars.has(i) ? token('--kit-accent') || c.bar : partTone(j, c);
    setAttrs(seg.rects[j], { x, y, width: w, height: h, fill: tone, 'fill-opacity': 0.9 });
    seg.texts[j].textContent = C.fmt(t >= 1 ? to[j] : Number(p.toFixed(b.dp ?? 1)), b.dp);
    setAttrs(seg.texts[j], { x: x + w / 2, y: p >= 0 ? y - m.label * 0.7 : y + h + m.label * 0.7, fill: c.ink, opacity: 1 });
  });
}

/** Grouped bars' legend: a swatch and a name per part, right of the last group, from its top down. */
function paintLegend(b: Block, c: ReturnType<typeof col>) {
  const e = b.el.bars as BarEls, names = b.el.partNames as string[] | undefined;
  if (!names?.length || !e.names) return;
  e.names.replaceChildren();
  const { body } = b.placed, m = b.m, sw = m.label * 0.8;
  const x = body.x + body.w + m.label * 0.7;
  names.forEach((nm, j) => {
    const y = body.y + m.label * (0.6 + 1.5 * j);
    svg(e.names!, 'rect', { x, y: y - sw / 2, width: sw, height: sw, rx: px(b, 1.5), fill: partTone(j, c), 'fill-opacity': 0.9 });
    kitText(e.names!, x + sw + m.label * 0.45, y, nm, { size: m.label, fill: c.muted, anchor: 'start' });
  });
}

/** Part names beside the last bar that is split, each at its segment's middle (once, faded in by a split). */
function paintPartNames(b: Block, c: ReturnType<typeof col>) {
  const e = b.el.bars as BarEls, names = b.el.partNames as string[] | undefined;
  if (!names?.length || !e.names) return;
  let i = b.parts!.length - 1;
  while (i > 0 && b.parts![i].length < 2) i--;
  const seg = e.segs![i];
  if (!seg || b.parts![i].length < 2) return;
  const s = (b.el.splitT as Map<number, number> | undefined)?.get(i) ?? 1;
  e.names.replaceChildren();
  // Right of the bar; when a neighbouring block sits there (a split adds names after the layout), left of the block.
  const store = b.el.store as KitStore | undefined;
  const others = store ? store.inRegion(b.region).filter((o) => o !== b).map((o) => o.placed.rect) : [];
  const rx = Number(seg.rects[0].getAttribute('x')) + Number(seg.rects[0].getAttribute('width')) + b.m.label * 0.6;
  const wMax = Math.max(...names.map((nm) => b.m.u(textWidth(nm, b.m.labelPx))));
  const top = Math.min(...seg.rects.map((rc) => Number(rc.getAttribute('y')))), bot = b.placed.body.y + b.placed.body.h;
  const hit = others.some((o) => o.x < rx + wMax && o.x + o.w > rx && o.y < bot && o.y + o.h > top);
  const x = hit ? b.placed.body.x - b.m.label * 0.6 : rx;
  seg.rects.forEach((rc, j) => {
    const nm = names[j];
    const h = Number(rc.getAttribute('height'));
    if (!nm || !(h > 0)) return;
    kitText(e.names!, x, Number(rc.getAttribute('y')) + h / 2, nm, { size: b.m.label, fill: c.muted, anchor: hit ? 'end' : 'start', opacity: s });
  });
}

function barBox(b: Block, c0: number, c1: number): Box {
  const rs = [];
  for (let i = c0; i <= c1; i++) rs.push(barRect(b, i, b.vals![0][i]));
  const u = union(rs);
  return u.h > 0 ? u : { ...u, y: u.y - b.m.label, h: b.m.label * 2 };
}

// ------------------------------------------------------------------------------------------------
// line: a vector drawn as a curve on axes (view=line, or past 16 values). Lines on one plot share
// its axes (axes=v): before vs after, demand vs supply, a signal and its smoothing.

type LineEls = { path: SVGPathElement; ghost: SVGPathElement; dots: SVGCircleElement[]; label: SVGTextElement | null; rings: SVGGElement };

/** x of each value: numeric labels, else the source's own xs (a map keeps them; a window's output sits at its windows' centres), else 1…n. */
function lineXs(a: Extract<KitBlock, { kind: 'bars' }>, n: number, store: KitStore, win?: { spec: C.WinSpec; over: string }): number[] {
  const lf = a.labelsFrom && a.labelsFrom[1] >= 0 ? store.get(a.labelsFrom[0]) : undefined;
  const labs = lf?.full ? lf.full.map((r) => r[a.labelsFrom![1]]) : a.labels?.map(Number);
  if (labs && labs.length >= n && labs.slice(0, n).every(Number.isFinite)) return labs.slice(0, n);
  const srcId = sourceIds(a.src)[0];
  const sb = srcId ? store.get(srcId) : undefined;
  const base = sb?.xs ?? (sb?.vals ? sb.vals.flat().map((_, i) => i + 1) : undefined);
  if (base && win) {
    const [, kc] = C.winSize(win.spec), g = C.winGeometry(1, base.length, win.spec);
    if (g) return Array.from({ length: n }, (_, i) => {
      const at = i * g.stride - g.pc + (kc - 1) / 2, lo = Math.max(0, Math.min(base.length - 1, Math.floor(at))), hi = Math.min(base.length - 1, lo + 1);
      return base[lo] + (base[hi] - base[lo]) * (at - Math.floor(at));
    });
  }
  if (base && base.length === n) return base.slice();
  return Array.from({ length: n }, (_, i) => i + 1);
}

const padDom = (lo: number, hi: number) => { const d = hi - lo || Math.abs(hi) || 1; return [lo - d * 0.06, hi + d * 0.06] as const; };
function domOf(members: { xs: number[]; ys: number[] }[]): Plot['dom'] {
  const xs = members.flatMap((m) => m.xs), ys = members.flatMap((m) => m.ys.filter(Number.isFinite));
  const [y0, y1] = padDom(Math.min(...ys), Math.max(...ys));
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0, y1 };
}
function linePt(pl: Plot, x: number, y: number): { x: number; y: number } {
  const { body } = pl.host.placed, d = pl.dom;
  return { x: body.x + ((x - d.x0) / (d.x1 - d.x0 || 1)) * body.w, y: body.y + body.h - ((y - d.y0) / (d.y1 - d.y0 || 1)) * body.h };
}

async function makeLine(a: Extract<KitBlock, { kind: 'bars' }>, got: { full: C.Mat; deps: string[]; win?: { spec: C.WinSpec; over: string } }, id: string, region: string, m: Metrics, P: (w: number, h: number, pad: Pad) => Placed, store: KitStore): Promise<Block | string> {
  const ys = asRow(got.full)[0];
  if (ys.filter(Number.isFinite).length < 2) return 'a line needs two values';
  const xs = lineXs(a, ys.length, store, got.win);
  const b = await makeLineXY(id, region, m, P, store, xs, ys, a.axes, got.deps, !!a.right);
  if (typeof b === 'string') return b;
  Object.assign(b, { src: a.src, dp: a.dp, em: (a as { em?: boolean }).em });
  b.el.caption = a.caption;
  return b;
}

/** A line block from x and y values: on its own new axes, or onto line/plot `axes`' (the plot widens to hold it). */
async function makeLineXY(id: string, region: string, m: Metrics, P: (w: number, h: number, pad: Pad) => Placed, store: KitStore, xs: number[], ys: number[], axes: string | undefined, deps: string[], beside: boolean, labels: { x?: string; y?: string } = {}): Promise<Block | string> {
  const host = axes ? await store.wait(axes) : undefined;
  if (axes && !host?.plot) return `no line or plot ${axes} to share axes with`;
  const got = { deps };
  let b: Block;
  if (host?.plot) {
    const pl = host.plot;
    b = newBlock(id, 'bars', region, { body: { ...host.placed.body }, rect: { ...host.placed.rect } }, m, got.deps);
    b.plot = pl;
    pl.members.push(b);
    // The plot widens to hold the new line (its axes and lines redraw when it is drawn).
    pl.dom = domOf(pl.members.map((x) => ({ xs: x === b ? xs : x.xs!, ys: x === b ? ys : x.full![0] })));
  } else {
    // A chart uses the board: about three quarters of its width (smaller beside another block).
    const w = beside ? Math.max(CHART_MIN.w, m.cell * 7) : CHART_W, h = beside ? Math.max(CHART_MIN.h, m.cell * 4.2) : CHART_W * 0.58;
    const dom = domOf([{ xs, ys }]);
    const tickW = Math.max(...C.ticks(dom.y0, dom.y1).map((t) => textWidth(C.fmt(t), m.labelPx)));
    // Room on the right for each line's name at its end, above for the y label and readouts.
    const pad: Pad = { l: m.u(tickW + m.labelPx * 0.9), t: m.label * 2, r: m.label * 5, b: m.label * 1.9 + (labels.x ? m.label * 1.5 : 0) };
    b = newBlock(id, 'bars', region, P(w, h, pad), m, got.deps);
    b.plot = { host: b, dom, members: [b], axes: null, ...(labels.x ? { xLabel: labels.x } : {}), ...(labels.y ? { yLabel: labels.y } : {}) };
  }
  Object.assign(b, { full: [ys.slice()], vals: [ys.slice()], view: 'line', xs, group: { pos: 0, neg: 0, members: [] } });
  b.group!.members.push(b);
  return b;
}

/** An image's short side is at least this share of its long side (no slivers). */
const IMG_ASPECT = 0.3;
/** A histogram's body width (section units): every histogram on shared bins is this wide. */
const HIST_W = 520;
/** A chart's default body width in section units (the section is 1000 wide): ~75% of the board with its labels. */
const CHART_W = 600;
/** The smallest a chart's body gets, beside another block too (section units): its ticks, labels and readouts stay apart (design 3.3a). */
export const CHART_MIN = { w: 520, h: 300 };

/**
 * {{plot}} without hand-drawn axes: the engine samples fn= over domain= (or x=, y= over t=) with the
 * answer's constants, and draws it as a line on its own axes or onto another plot's (axes=), so curves
 * from one formula stay on one consistent scale.
 */
export async function buildKitPlot(a: Extract<DrawAction, { kind: 'plot' }> & { id?: string; em?: boolean }, ctx: TargetCtx, env: BuildEnv): Promise<ElementPlan | string> {
  if (a.region == null) return 'a graph lives on the board';
  const store = kitStore(env.registry);
  const region = regionOf(ctx.target);
  const m = metrics(ctx.scale(), ctx.body?.() ?? 16);
  const id = a.id ?? store.anonId();
  if (a.id && store.get(a.id)) return 'duplicate id';
  const K = withConsts(store.consts, a.with);
  const got = samplePlot(a, K);
  if (typeof got === 'string') return got;
  const { xs, ys } = got;
  if (ys.filter(Number.isFinite).length < 2) return 'nothing to plot';
  const others = store.inRegion(region).map((b) => b.placed);
  const spacing = { gap: m.gap, opW: m.opW, margin: m.margin, top: m.top, width: 1000 };
  const scene = ctx.scene;
  // In a scene a new chart is placed as every other thing is: by the scene, clear of all its claims
  // (chips, labels, links), flowing on from the last thing; never stacked from the section's top.
  const P = (w: number, h: number, pad: Pad): Placed => {
    if (!scene) return clearDown(place(w, h, pad, {}, undefined, others, spacing), looseInk(env, ctx.target), m.gap);
    const r = placeRel(pad.l + w + pad.r, pad.t + h + pad.b, null, null, [...scene.rects(), ...unclaimed(env, ctx.target)], { gap: m.gap * 1.3, seed: id, view: scene.view(), last: scene.last() });
    return { body: { x: r.x + pad.l, y: r.y + pad.t, w, h }, rect: r };
  };
  const b = await makeLineXY(id, region, m, P, store, xs, ys, a.axes, [], false, { x: a.xLabel, y: a.yLabel });
  if (typeof b === 'string') return b;
  b.em = a.em;
  b.el.caption = a.label;
  b.el.labelAt = a.labelAt;
  b.el.curve = true;
  // Its tag: readouts and moves recompute the curve from it with the current constants.
  b.el.plotSrc = a;
  b.el.store = store;
  if (a.dash) b.el.dash = true;
  return planFor(b, a.id, ctx, env, store, region, m, col());
}

/**
 * {{plot p=N on=#c1}}: a curve on a slide's calibrated chart, as a kit line whose axes are the slide's
 * own (fixed: the domain is the chart's, values off its y axis are cut). Being a kit block, readout
 * points, beforeafter, limit and contrast work on it as on a board plot. Null: a log axis (the
 * stroke path in elements.ts draws it).
 */
export function buildChartPlot(a: Extract<DrawAction, { kind: 'plot' }> & { id?: string; em?: boolean }, ctx: TargetCtx, env: BuildEnv): Promise<ElementPlan | string> | null {
  const ch = a.onChart;
  if (!ch || ch.x.log || ch.y.log || a.page == null) return null;
  return (async () => {
    const store = kitStore(env.registry);
    const id = a.id ?? store.anonId();
    if (a.id && store.get(a.id)) return 'duplicate id';
    const got = samplePlot(a, withConsts(store.consts, a.with));
    if (typeof got === 'string') return got;
    if (got.ys.filter(Number.isFinite).length < 2) return 'nothing to plot on the chart';
    const m = metrics(ctx.scale(), 15);
    // The chart's axis ends in this page's space: data (lo, hi) map linearly onto them.
    const lo = ctx.toSpace({ x: ch.x.p0, y: ch.y.p0 }), hi = ctx.toSpace({ x: ch.x.p1, y: ch.y.p1 });
    const body = { x: lo.x, y: hi.y, w: hi.x - lo.x, h: lo.y - hi.y };
    const region = `chart:${a.page}:${ch.rect.x},${ch.rect.y}`;
    const b = newBlock(id, 'bars', region, { body, rect: ctx.rectToSpace(ch.rect) }, m, []);
    b.target = ctx.target;
    // Every plot on one chart shares its (fixed) axes.
    const host = store.all().find((x) => x.region === region && x.plot?.host === x);
    b.plot = host?.plot ?? { host: b, dom: { x0: ch.x.lo, x1: ch.x.hi, y0: ch.y.lo, y1: ch.y.hi }, members: [], axes: null, fixed: true };
    b.plot.members.push(b);
    Object.assign(b, { full: [got.ys.slice()], vals: [got.ys.slice()], view: 'line', xs: got.xs, group: { pos: 0, neg: 0, members: [] }, em: a.em });
    b.group!.members.push(b);
    // The slide names its own curves: a chart plot is labelled only when the tag says so (never by its id).
    b.el.caption = a.label ?? '';
    b.el.labelAt = a.labelAt;
    b.el.curve = true;
    b.el.plotSrc = a;
    b.el.store = store;
    if (a.dash) b.el.dash = true;
    return planFor(b, a.id, ctx, env, store, region, m, col());
  })();
}

/** A chart plot's plan: drawn on the page's own layer (planFor's part for board sections does not apply). */
function chartPlan(b: Block, aid: string | undefined, ctx: TargetCtx, env: BuildEnv, c: ReturnType<typeof col>): ElementPlan {
  return {
    target: ctx.target,
    bbox: b.placed.rect,
    draw: async (signal, k) => {
      const g = svg(ctx.layers.agent, 'g', { class: 'kit-block', 'data-kit': 'chart-plot' });
      b.g = g;
      env.registry.define({ id: aid, kind: 'plot', target: ctx.target, bbox: b.placed.rect, boxes: [], anchor: { x: b.placed.body.x + b.placed.body.w, y: b.placed.body.y }, group: g });
      b.markReady();
      await drawLine(b, c, env, signal.aborted ? { speed: 0, fadeMs: 0 } : k);
    },
  };
}

/**
 * A plot's samples with these constants: fn= over domain= (or x=, y= over t=); a pole or a value
 * outside range= breaks the curve there (NaN). A string says why nothing can be drawn.
 */
export function samplePlot(a: Pick<Extract<DrawAction, { kind: 'plot' }>, 'fn' | 'x' | 'y' | 't' | 'domain' | 'domainSrc' | 'range'>, K: Record<string, number>): { xs: number[]; ys: number[] } | string {
  const val = (e: string) => { const f = formula(e, [], K); return f ? f({}) : NaN; };
  const N = 160;
  const xs: number[] = [], ys: number[] = [];
  if (a.x && a.y && a.t) {
    const t0 = val(a.t[0]), t1 = val(a.t[1]);
    if (!(Number.isFinite(t0) && Number.isFinite(t1) && t1 > t0)) return `bad t range ${a.t.join(',')}`;
    const fx = formula(a.x, ['t'], K), fy = formula(a.y, ['t'], K);
    if (!fx || !fy) return `bad formula ${!fx ? a.x : a.y}`;
    for (let i = 0; i <= N; i++) { const t = t0 + ((t1 - t0) * i) / N; xs.push(fx({ t })); ys.push(fy({ t })); }
  } else {
    const [s0, s1] = a.domainSrc ?? (a.domain ? [String(a.domain[0]), String(a.domain[1])] : ['', '']);
    const d0 = val(s0), d1 = val(s1);
    if (!(Number.isFinite(d0) && Number.isFinite(d1) && d1 > d0)) return `bad domain ${s0},${s1}`;
    const f = formula(a.fn ?? '', ['x'], K);
    if (!f) return `bad fn ${a.fn}`;
    for (let i = 0; i <= N; i++) { const x = d0 + ((d1 - d0) * i) / N; xs.push(x); ys.push(f({ x })); }
  }
  // A pole breaks the curve (found between neighbours: a narrow peak is kept whole); range= clips.
  if (!a.range && !(a.x && a.y && a.t)) { const f = formula(a.fn ?? '', ['x'], K)!; breakPoles((x) => f({ x }), xs, ys); }
  for (let i = 0; i < ys.length; i++) {
    const bad = !Number.isFinite(xs[i]) || !Number.isFinite(ys[i]) || (a.range ? ys[i] < a.range[0] || ys[i] > a.range[1] : false);
    if (bad) { ys[i] = NaN; if (!Number.isFinite(xs[i])) xs[i] = i > 0 ? xs[i - 1] : 0; }
  }
  return { xs, ys };
}

/** (Re)draws a plot's axes and ticks. */
function drawPlotAxes(pl: Plot, c: ReturnType<typeof col>) {
  const h = pl.host, { body } = h.placed, m = h.m, d = pl.dom;
  pl.axes?.remove();
  const ax = svg(h.g!, 'g');
  h.g!.insertBefore(ax, h.g!.firstChild);
  svg(ax, 'path', { d: `M${body.x} ${body.y - px(h, 4)}V${body.y + body.h}H${body.x + body.w + px(h, 4)}`, fill: 'none', stroke: c.edge, ...hair(1) });
  for (const t of C.ticks(d.x0, d.x1, 5)) {
    const x = linePt(pl, t, d.y0).x;
    svg(ax, 'line', { x1: x, x2: x, y1: body.y + body.h, y2: body.y + body.h + px(h, 4), stroke: c.edge, ...hair(1) });
    kitText(ax, x, body.y + body.h + m.label * 0.95, C.fmt(t), { size: m.label, fill: c.muted });
  }
  for (const t of C.ticks(d.y0, d.y1)) {
    const y = linePt(pl, d.x0, t).y;
    svg(ax, 'line', { x1: body.x - px(h, 4), x2: body.x, y1: y, y2: y, stroke: c.edge, ...hair(1) });
    kitText(ax, body.x - px(h, 7), y, C.fmt(t), { size: m.label, fill: c.muted, anchor: 'end' });
  }
  if (d.y0 < 0 && d.y1 > 0) { const y = linePt(pl, d.x0, 0).y; svg(ax, 'line', { x1: body.x, x2: body.x + body.w, y1: y, y2: y, stroke: c.line, ...hair(1) }); }
  if (pl.xLabel) kitText(ax, body.x + body.w, body.y + body.h + m.label * 2.3, pl.xLabel, { size: m.label, fill: c.ink2, anchor: 'end' });
  if (pl.yLabel) kitText(ax, body.x, body.y - m.label * 1.1, pl.yLabel, { size: m.label, fill: c.ink2, anchor: 'start' });
  pl.axes = ax;
}

/** The path through a line's first `upto` values (fractional: the last segment partly drawn). */
function linePath(b: Block, ys: number[], upto = ys.length, xs0?: number[]): string {
  const pl = b.plot!, xs = xs0 ?? b.xs!;
  let d = '', pen = false;
  const whole = Math.floor(upto);
  for (let i = 0; i < Math.min(ys.length, Math.ceil(upto)); i++) {
    if (!Number.isFinite(ys[i])) { pen = false; continue; }
    let x = xs[i], y = ys[i];
    if (i >= whole && i > 0 && Number.isFinite(ys[i - 1])) { const f = upto - whole; x = xs[i - 1] + (xs[i] - xs[i - 1]) * f; y = ys[i - 1] + (ys[i] - ys[i - 1]) * f; }
    const p = linePt(pl, x, y);
    d += `${pen ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
    pen = true;
  }
  return d;
}

/** Puts a line's path, dots and end label where its values say (on its plot's current axes). */
function paintLine(b: Block, ys: number[], c: ReturnType<typeof col>, upto = ys.length) {
  const e = b.el.line as LineEls | undefined;
  if (!e) return;
  e.path.setAttribute('d', linePath(b, ys, upto));
  e.ghost.setAttribute('d', b.ghost ? linePath(b, b.ghost, b.ghost.length, b.el.ghostXs as number[] | undefined) : '');
  e.dots.forEach((dot, i) => {
    const ok = Number.isFinite(ys[i]) && i < upto;
    const p = ok ? linePt(b.plot!, b.xs![i], ys[i]) : { x: 0, y: 0 };
    setAttrs(dot, { cx: p.x, cy: p.y, opacity: ok ? 1 : 0 });
  });
  if (e.label) {
    if (b.el.labelAt === 'top') {
      // At the curve's highest point, just above it.
      let k = 0;
      ys.forEach((v, i) => { if (Number.isFinite(v) && !(ys[k] >= v)) k = i; });
      const p = linePt(b.plot!, b.xs![k], ys[k]);
      setAttrs(e.label, { x: p.x, y: p.y - b.m.label * 0.9, 'text-anchor': 'middle', opacity: upto >= ys.length ? 1 : 0 });
    } else {
      let k = ys.length - 1;
      while (k > 0 && !Number.isFinite(ys[k])) k--;
      const p = linePt(b.plot!, b.xs![k], ys[k]);
      setAttrs(e.label, { x: p.x + b.m.label * 0.5, y: p.y, opacity: upto >= ys.length ? 1 : 0 });
    }
  }
  void c;
}

/** A plot's lines, newest in ink, earlier ones (unless em) set back in the muted tone. */
function lineColor(b: Block, c: ReturnType<typeof col>, accent: string): string {
  if (b.em) return accent;
  const ms = b.plot!.members.filter((x) => !x.em);
  return b === ms[ms.length - 1] ? c.ink : c.muted;
}

/** Each line of a plot in its colour (the newest in ink, earlier ones muted), but `skip`. */
function recolorLines(pl: Plot, c: ReturnType<typeof col>, accent: string, skip?: Block) {
  for (const o of pl.members) if (o !== skip && o.el.line) { const oc = lineColor(o, c, accent); const oe = o.el.line as LineEls; oe.path.setAttribute('stroke', oc); oe.dots.forEach((d) => d.setAttribute('fill', oc)); oe.label?.setAttribute('fill', oc); }
}

/** End labels of a plot's lines never overlap: sorted by height, pushed apart by a line's height. */
function spreadLabels(pl: Plot) {
  const st = pl.host.el.store as KitStore | undefined;
  if (st) void placeReadoutPts(pl, st);
  const ls = pl.members.map((x) => (x.el.line as LineEls | undefined)?.label).filter((l): l is SVGTextElement => !!l && l.getAttribute('text-anchor') !== 'middle');
  if (ls.length < 2) return;
  const h = pl.host.m.label * 1.25;
  const ys = ls.map((l) => ({ l, y: Number(l.getAttribute('y')) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ys.length; i++) if (ys[i].y - ys[i - 1].y < h) ys[i].y = ys[i - 1].y + h;
  // keep the group centred on where it was
  const shift = (ys.reduce((s, x) => s + x.y, 0) - ys.reduce((s, x) => s + Number(x.l.getAttribute('y')), 0)) / ys.length;
  ys.forEach((x) => x.l.setAttribute('y', String(x.y - shift)));
}

async function drawLine(b: Block, c: ReturnType<typeof col>, env: BuildEnv, k: Pace) {
  const pl = b.plot!, g = b.g!, m = b.m, accent = env.settings.inkColor;
  if (pl.host !== b) await pl.host.ready;
  if (!pl.fixed && (pl.host === b || pl.axes)) drawPlotAxes(pl, c);
  const ys = b.vals![0];
  const color = lineColor(b, c, accent);
  const ghost = svg(g, 'path', { d: '', fill: 'none', stroke: c.muted, 'stroke-dasharray': '4 4', ...hair(1.2) });
  const path = svg(g, 'path', { d: '', fill: 'none', stroke: color, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', ...(b.el.dash ? { 'stroke-dasharray': '6 5' } : {}), ...hair(1.8) });
  const dots = ys.length <= 24 && !b.el.curve ? ys.map(() => svg(g, 'circle', { r: px(b, 2.6), fill: color, opacity: 0 })) : [];
  const name = (b.el.caption as string | undefined) ?? idCaption(b.id);
  const label = name ? kitText(g, 0, 0, name, { size: m.label, fill: color, anchor: 'start', halo: c.halo, opacity: 0 }) : null;
  if (label && isVarName(name!)) { label.setAttribute('font-style', 'italic'); label.setAttribute('font-family', 'KaTeX_Math, "STIX Two Math", "Cambria Math", "Times New Roman", serif'); }
  b.el.line = { path, ghost, dots, label, rings: svg(g, 'g') } satisfies LineEls;
  // Earlier lines on this plot: back to muted, and onto the (maybe widened) axes.
  recolorLines(pl, c, accent, b);
  for (const o of pl.members) if (o !== b && o.el.line) paintLine(o, o.vals![0], c);
  // The line draws in from the left.
  const fast = k.fadeMs != null || prefersReducedMotion();
  await tween(fast ? 0 : Math.min(1400, 300 + ys.length * 25) * k.speed, (t) => paintLine(b, ys, c, 1 + t * (ys.length - 1)));
  for (const o of pl.members) if (o.el.line) paintLine(o, o.vals![0], c);
  spreadLabels(pl);
}

/** Tweens a line to new values; the plot widens if they need it (its axes and other lines follow). */
async function setLineVals(b: Block, next: C.Mat, ms: number, ctl: Ctl | undefined, c: ReturnType<typeof col>) {
  const prev = b.vals![0].slice(), to = asRow(next)[0];
  b.vals = [to.slice()];
  b.full = [to.slice()];
  const pl = b.plot!;
  const old = pl.dom, dom = pl.fixed ? old : domOf(pl.members.map((x) => ({ xs: x.xs!, ys: [...x.vals![0], ...(x.ghost ?? [])] })));
  const moved = dom.y0 !== old.y0 || dom.y1 !== old.y1 || dom.x0 !== old.x0 || dom.x1 !== old.x1;
  if (!b.el.line) { pl.dom = dom; return; }
  await tween(ms, (t) => {
    if (moved) pl.dom = { x0: old.x0 + (dom.x0 - old.x0) * t, x1: old.x1 + (dom.x1 - old.x1) * t, y0: old.y0 + (dom.y0 - old.y0) * t, y1: old.y1 + (dom.y1 - old.y1) * t };
    paintLine(b, to.map((v, i) => (Number.isFinite(prev[i]) && Number.isFinite(v) ? prev[i] + (v - prev[i]) * t : v)), c);
    if (moved) for (const o of pl.members) if (o !== b) paintLine(o, o.vals![0], c);
  }, ctl);
  pl.dom = dom;
  if (moved && pl.axes) drawPlotAxes(pl, c);
  for (const o of pl.members) paintLine(o, o.vals![0], c);
  spreadLabels(pl);
}

/** Section box around a line's points c0…c1. */
function lineBox(b: Block, c0: number, c1: number): Box {
  const r = px(b, 6);
  const ps = [];
  for (let i = c0; i <= c1; i++) if (Number.isFinite(b.vals![0][i])) ps.push(linePt(b.plot!, b.xs![i], b.vals![0][i]));
  if (!ps.length) return b.placed.body;
  return union(ps.map((q) => ({ x: q.x - r, y: q.y - r, w: 2 * r, h: 2 * r })));
}

// ------------------------------------------------------------------------------------------------
// scatter, fit, band, dist

type ScatterEls = { pts: SVGCircleElement[]; layer: SVGGElement; marks: SVGGElement; clipId: string };
let clips = 0;

function toPlot(b: Block, p: C.Pt): { x: number; y: number } {
  const { body } = b.placed, d = b.dom!;
  return { x: body.x + ((p.x - d.x0) / (d.x1 - d.x0)) * body.w, y: body.y + body.h - ((p.y - d.y0) / (d.y1 - d.y0)) * body.h };
}

async function drawScatter(b: Block, c: ReturnType<typeof col>, k: Pace) {
  const g = b.g!, { body } = b.placed, m = b.m, d = b.dom!;
  const axes = svg(g, 'g');
  if (b.el.overlay) axes.setAttribute('display', 'none'); // on a plot's axes: they are already drawn
  svg(axes, 'path', { d: `M${body.x} ${body.y - px(b, 4)}V${body.y + body.h}H${body.x + body.w + px(b, 4)}`, fill: 'none', stroke: c.edge, ...hair(1) });
  for (const t of C.ticks(d.x0, d.x1)) {
    const x = toPlot(b, { x: t, y: d.y0 }).x;
    svg(axes, 'line', { x1: x, x2: x, y1: body.y + body.h, y2: body.y + body.h + px(b, 4), stroke: c.edge, ...hair(1) });
    kitText(axes, x, body.y + body.h + m.label * 0.95, C.fmt(t), { size: m.label, fill: c.muted });
  }
  for (const t of C.ticks(d.y0, d.y1)) {
    const y = toPlot(b, { x: d.x0, y: t }).y;
    svg(axes, 'line', { x1: body.x - px(b, 4), x2: body.x, y1: y, y2: y, stroke: c.edge, ...hair(1) });
    kitText(axes, body.x - px(b, 7), y, C.fmt(t), { size: m.label, fill: c.muted, anchor: 'end' });
  }
  const xl = b.el.xLabel as string | undefined, yl = b.el.yLabel as string | undefined, cap = b.el.caption as string | undefined;
  if (xl) kitText(axes, body.x + body.w, body.y + body.h + m.label * 2.3, xl, { size: m.label, fill: c.ink2, anchor: 'end' });
  if (yl) kitText(axes, body.x, body.y - m.label * 1.1, yl, { size: m.label, fill: c.ink2, anchor: 'start' });
  if (cap) caption(axes, body.x + body.w / 2, body.y + body.h + m.label * (xl ? 3.7 : 2.4), cap, m, c);
  const clipId = `kit-clip-${++clips}`;
  const cp = svg(svg(g, 'defs'), 'clipPath', { id: clipId });
  svg(cp, 'rect', { x: body.x, y: body.y, width: body.w, height: body.h });
  const layer = svg(g, 'g', { 'clip-path': `url(#${clipId})` });
  const marks = svg(g, 'g');
  const r = px(b, 4.2);
  const pts = b.data!.map((p) => { const ok = Number.isFinite(p.x) && Number.isFinite(p.y); const q = ok ? toPlot(b, p) : { x: body.x, y: body.y }; return svg(g, 'circle', { cx: q.x, cy: q.y, r, ...ptLook(b, c), opacity: 0, ...(ok ? {} : { 'data-off': '' }), ...hair(1.3) }); });
  b.el.scatter = { pts, layer, marks, clipId } satisfies ScatterEls;
  await appear(axes, 200, k);
  const fast = k.fadeMs != null || prefersReducedMotion();
  const step = fast ? 0 : Math.min(40, 500 / pts.length) * k.speed;
  const on = pts.filter((p) => !p.hasAttribute('data-off'));
  await Promise.all(on.map((p, i) => pause(i * step).then(() => tween(fast ? 0 : 140, (t) => p.setAttribute('opacity', String(t))))));
}

/** Data points are open circles; a table's rows (a trajectory) are filled dots. */
const ptLook = (b: Block, c: ReturnType<typeof col>) => (b.cols ? { fill: c.ink, stroke: 'none' } : { fill: c.cell, stroke: c.dot });

/** A table-driven scatter follows its table: rows that have filled pop in (the newest in the accent, briefly). */
async function refreshScatter(b: Block, store: KitStore, ms: number, ctl: Ctl | undefined, c: ReturnType<typeof col>, accent: string) {
  const t = b.cols ? store.get(b.cols.id) : undefined;
  if (!t || !b.el.scatter) return;
  const se = b.el.scatter as ScatterEls;
  b.data = t.vals!.map((r) => ({ x: r[b.cols!.x], y: r[b.cols!.y] }));
  const fresh: SVGCircleElement[] = [];
  b.data.forEach((p, i) => {
    const el = se.pts[i];
    if (!el || !el.hasAttribute('data-off') || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    const q = toPlot(b, p);
    el.removeAttribute('data-off');
    setAttrs(el, { cx: q.x, cy: q.y, fill: accent });
    fresh.push(el);
  });
  if (!fresh.length) return;
  se.pts.forEach((el) => { if (!el.hasAttribute('data-off') && !fresh.includes(el)) setAttrs(el, ptLook(b, c)); });
  await tween(Math.min(ms, 200), (k) => fresh.forEach((el) => el.setAttribute('opacity', String(k))), ctl);
}

/** A convex polygon clipped to a data box (Sutherland–Hodgman). */
export function clipPoly(ps: C.Pt[], d: { x0: number; x1: number; y0: number; y1: number }): C.Pt[] {
  const edges: [(p: C.Pt) => boolean, (a: C.Pt, b: C.Pt) => C.Pt][] = [
    [(p) => p.x >= d.x0, (a, b) => ({ x: d.x0, y: a.y + ((b.y - a.y) * (d.x0 - a.x)) / (b.x - a.x) })],
    [(p) => p.x <= d.x1, (a, b) => ({ x: d.x1, y: a.y + ((b.y - a.y) * (d.x1 - a.x)) / (b.x - a.x) })],
    [(p) => p.y >= d.y0, (a, b) => ({ x: a.x + ((b.x - a.x) * (d.y0 - a.y)) / (b.y - a.y), y: d.y0 })],
    [(p) => p.y <= d.y1, (a, b) => ({ x: a.x + ((b.x - a.x) * (d.y1 - a.y)) / (b.y - a.y), y: d.y1 })],
  ];
  let out = ps;
  for (const [inside, cut] of edges) {
    const src = out;
    out = [];
    src.forEach((cur, i) => {
      const prev = src[(i + src.length - 1) % src.length];
      if (inside(cur)) { if (!inside(prev)) out.push(cut(prev, cur)); out.push(cur); }
      else if (inside(prev)) out.push(cut(prev, cur));
    });
  }
  return out;
}

/** The segment of line l inside the scatter's data box (data coords); null when it misses it. */
function clipLine(l: C.Line, d: { x0: number; x1: number; y0: number; y1: number }): [C.Pt, C.Pt] | null {
  const ps: C.Pt[] = [];
  const add = (p: C.Pt) => { if (p.x >= d.x0 - 1e-9 && p.x <= d.x1 + 1e-9 && p.y >= d.y0 - 1e-9 && p.y <= d.y1 + 1e-9 && !ps.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 1e-9)) ps.push(p); };
  if (Math.abs(l.b) > 1e-12) for (const x of [d.x0, d.x1]) add({ x, y: -(l.a * x + l.c) / l.b });
  if (Math.abs(l.a) > 1e-12) for (const y of [d.y0, d.y1]) add({ x: -(l.b * y + l.c) / l.a, y });
  if (ps.length < 2) return null;
  ps.sort((p, q) => p.x - q.x || p.y - q.y);
  return [ps[0], ps[ps.length - 1]];
}

async function buildFit(a: Extract<KitBlock, { kind: 'fit' }> & { id?: string; em?: boolean }, ctx: TargetCtx, env: BuildEnv, store: KitStore, m: Metrics): Promise<ElementPlan | string> {
  const sc = await store.wait(a.of);
  if (!sc || sc.kind !== 'scatter') return `no scatter ${a.of}`;
  const pts = sc.data!;
  let line: C.Line | null;
  if (a.pick) {
    const [i, j] = a.pick;
    if (i > pts.length || j > pts.length) return 'pick out of range';
    line = C.lineThrough(pts[i - 1], pts[j - 1]);
  } else line = C.lstsq(pts);
  if (!line) return 'no line through those points';
  const seg = clipLine(line, sc.dom!);
  if (!seg) return 'line misses the plot';
  const id = a.id ?? store.anonId();
  if (a.id && store.get(a.id)) return 'duplicate id';
  const b = newBlock(id, 'fit', sc.region, sc.placed, m, [sc.id]);
  Object.assign(b, { line, of: sc.id, pick: a.pick, em: a.em });
  store.add(b);
  const c = col();
  return {
    target: ctx.target, bbox: sc.placed.rect,
    draw: async (signal, k) => {
      await sc.ready;
      const se = sc.el.scatter as ScatterEls;
      // A new line replaces the last hypothesis: its band and marks go, its line dims.
      for (const f of sc.fits!) { (f.el.band as SVGElement | undefined)?.remove(); f.el.band = undefined; (f.g as SVGElement | null)?.setAttribute('opacity', '0.22'); }
      se.marks.replaceChildren();
      se.pts.forEach((p) => setAttrs(p, { fill: c.cell, stroke: c.dot }));
      sc.fits!.push(b);
      const g = svg(se.layer, 'g');
      b.g = g;
      const [p, q] = seg.map((s) => toPlot(sc, s));
      const color = a.em ? env.settings.inkColor : c.ink;
      const path = svg(g, 'line', { x1: p.x, y1: p.y, x2: p.x, y2: p.y, stroke: color, ...hair(1.8), 'stroke-linecap': 'round' });
      env.registry.define({ id: a.id, kind: 'kit-fit', target: ctx.target, bbox: union([{ x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), w: Math.abs(q.x - p.x), h: Math.abs(q.y - p.y) }]), boxes: [], anchor: q, group: g, strokes: [[p, q]] });
      b.markReady();
      if (a.pick) a.pick.forEach((i) => { const o = toPlot(sc, pts[i - 1]); svg(se.marks, 'circle', { cx: o.x, cy: o.y, r: px(sc, 9), fill: 'none', stroke: color, ...hair(1.4) }); });
      const ms = signal.aborted || k.fadeMs != null ? 0 : 450 * k.speed;
      await tween(ms, (t) => setAttrs(path, { x2: p.x + (q.x - p.x) * t, y2: p.y + (q.y - p.y) * t }));
      if (!a.pick) {
        // Least squares: its equation, engine-computed, at the line's right end.
        const lab = kitText(se.marks, q.x - px(sc, 4), q.y - m.label * 1.1, C.lineLabel(line!), { size: m.label, fill: color, anchor: 'end', halo: c.halo });
        await appear(lab, 200, k);
      }
    },
  };
}

async function band(v: Extract<KitVerb, { kind: 'band' }>, env: BuildEnv, store: KitStore): Promise<ElementPlan | string> {
  const f = await store.wait(v.ref);
  if (!f || f.kind !== 'fit') return `no fitted line ${v.ref}`;
  const sc = store.get(f.of!)!;
  const ins = new Set(C.inliers(sc.data!, f.line!, v.w));
  const c = col();
  return {
    target: tgtOf(sc), bbox: sc.placed.rect,
    draw: async (signal, k) => {
      await f.ready;
      const se = sc.el.scatter as ScatterEls, l = f.line!, d = sc.dom!;
      // The band: the line's ±w strip, clipped to the plot (the layer's clip path).
      const big = Math.hypot(d.x1 - d.x0, d.y1 - d.y0) * 4;
      const foot = C.footOn({ x: (d.x0 + d.x1) / 2, y: (d.y0 + d.y1) / 2 }, l);
      const dir = { x: -l.b, y: l.a };
      const corner = (s: number, o: number) => ({ x: foot.x + dir.x * s * big + l.a * o * v.w, y: foot.y + dir.y * s * big + l.b * o * v.w });
      // The strip clipped to the plot in data space (its box then measures as what shows).
      const poly = clipPoly([corner(-1, 1), corner(1, 1), corner(1, -1), corner(-1, -1)], d).map((q) => toPlot(sc, q));
      const accent = env.settings.inkColor;
      (f.el.band as SVGElement | undefined)?.remove();
      const bandEl = svg(se.layer, 'polygon', { points: poly.map((p) => `${p.x},${p.y}`).join(' '), fill: f.em ? accent : c.ink, 'fill-opacity': f.em ? 0.12 : 0.06 });
      se.layer.insertBefore(bandEl, se.layer.firstChild);
      f.el.band = bandEl;
      await appear(bandEl, 240, signal.aborted ? { speed: 0, fadeMs: 0 } : k);
      se.pts.forEach((p, i) => setAttrs(p, ins.has(i) ? { fill: f.em ? accent : c.ink, stroke: 'none' } : { fill: c.cell, stroke: c.dot }));
      // The count is a readout above the plot, right-aligned to it (never over the data); it says what
      // it counts. The band's own name, if given, labels the band at its edge.
      (sc.el.readout as SVGElement | undefined)?.remove();
      (f.el.bandLabel as SVGElement | undefined)?.remove();
      const m = sc.m, { body } = sc.placed;
      if (v.label && Math.abs(l.b) > 1e-9) {
        const x = d.x0 + (d.x1 - d.x0) * 0.97, yl = -(l.a * x + l.c) / l.b;
        const s = l.b < 0 ? -1 : 1; // the edge above the line in data terms
        const q = toPlot(sc, { x: x + s * l.a * v.w, y: yl + s * l.b * v.w });
        if (q.y > body.y && q.y < body.y + body.h) f.el.bandLabel = kitText(se.marks, q.x, q.y - m.label * 0.7, v.label, { size: m.label, fill: f.em ? accent : c.ink2, anchor: 'end', halo: c.halo });
      }
      const t = kitText(se.marks, body.x + body.w, body.y - m.label * 1.0, 'inside band: ', { size: m.num, fill: c.ink, anchor: 'end', halo: c.halo });
      const n = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
      n.textContent = String(ins.size);
      setAttrs(n, { fill: accent, 'font-weight': 600 });
      t.appendChild(n);
      sc.el.readout = t;
      await appear(t, 200, k);
    },
  };
}

async function dist(v: Extract<KitVerb, { kind: 'dist' }>, env: BuildEnv, store: KitStore): Promise<ElementPlan | string> {
  const f = await store.wait(v.ref);
  if (!f || f.kind !== 'fit') return `no fitted line ${v.ref}`;
  const part = blockPart(v.from);
  const sc = store.get(f.of!)!;
  if (!part || part.id !== sc.id || part.c0 >= sc.data!.length) return 'dist: not a point of the line\'s scatter';
  const p = sc.data![part.c0];
  const foot = C.footOn(p, f.line!), dv = C.distTo(p, f.line!);
  const c = col();
  return {
    target: tgtOf(sc), bbox: sc.placed.rect,
    draw: async (_s, k) => {
      await f.ready;
      const se = sc.el.scatter as ScatterEls, m = sc.m;
      const a = toPlot(sc, p), b = toPlot(sc, foot);
      const g = svg(se.marks, 'g');
      svg(g, 'line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: c.ink2, 'stroke-dasharray': '3 3', ...hair(1.2) });
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const L = Math.hypot(b.x - a.x, b.y - a.y) || 1, nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L;
      const off = m.label * 1.1;
      kitText(g, mid.x + nx * off, mid.y + ny * off, C.fmt(dv), { size: m.label, fill: c.ink, halo: c.halo });
      env.registry.define({ kind: 'kit-dist', target: tgtOf(sc), bbox: union([{ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }]), boxes: [], anchor: mid, group: g });
      await appear(g, 260, k);
    },
  };
}

// ------------------------------------------------------------------------------------------------
// One placement authority: in a scene every block, calc line and plot holds a claim in the scene's
// world (SceneSpace), and everything placed later is placed clear of all of them.

const sceneOf = (env: BuildEnv, region: string) => env.desk.region?.(region)?.scene;

/** A plain section's ink that is not a kit block (kit blocks are placed among themselves by place()): kit blocks are placed clear of it. */
const looseInk = (env: BuildEnv, t: Target): Box[] => env.registry.entries().filter((e) => !e.faded && e.target.region === t.region && !e.kind.startsWith('kit-')).flatMap((e) => e.boxes);

/** Claims a block's room in its scene (world space): later things keep clear of it. */
function claimRoom(b: Block, env: BuildEnv): void {
  const scene = sceneOf(env, b.region);
  if (!scene) return;
  const r = worldBox(b, b.placed.rect);
  sceneStore(env.registry).put(b.id, { rect: r, claim: scene.claim(r), moved: new Set(), data: { kind: 'kit' } });
}

/** A block's room changed size (a table grew a column, a calc line a wider expansion): its claim follows. */
function roomMoved(b: Block, env: BuildEnv): void {
  const th = sceneStore(env.registry).get(b.id);
  if (!th?.claim) return;
  const r = worldBox(b, b.placed.rect);
  th.claim.move(r);
  if (b.shift) th.rect = r;
}

/**
 * Where a line that belongs under block `owner` goes in a scene: `body` (owner's drawing space) when it
 * is clear of every claim, else the nearest room below the owner the scene finds (placeRel).
 */
function clearOf(owner: Block, body: Box, scene: SceneSpace, m: Metrics, env: BuildEnv): Box {
  const own = sceneStore(env.registry).get(owner.id)?.claim?.r;
  const taken = scene.rects().filter((r) => r !== own);
  const w = worldBox(owner, body);
  if (!taken.some((r) => overlapsBox(w, r, m.gap * 0.25))) return body;
  const r = placeRel(w.w, w.h, 'below', worldBox(owner, owner.placed.rect), taken, { gap: m.gap * 0.7, seed: `${owner.id}:calc`, view: scene.view() });
  const sx = owner.shift?.x ?? 0, sy = owner.shift?.y ?? 0;
  return { x: r.x - sx, y: r.y - sy, w: body.w, h: body.h };
}
const overlapsBox = (a: Box, b: Box, p: number) => a.x - p < b.x + b.w && b.x < a.x + a.w + p && a.y - p < b.y + b.h && b.y < a.y + a.h + p;

// ------------------------------------------------------------------------------------------------
// calc lines

/** A calc's expansion now, from its blocks' shown values. */
function calcExpansion(cd: { of: string[]; reduce: C.Reduce; fn?: string; q?: number; label?: string }, store: KitStore, dp?: number): C.Expansion | string {
  const vs = cd.of.map((id) => store.get(id)?.vals);
  if (vs.some((v) => !v)) return 'unknown block';
  const xs = vs[0]!.flat(), ys = vs[1]?.flat();
  if (ys && ys.length !== xs.length) return 'calc: blocks differ in size';
  if (cd.fn) {
    const f = formula(cd.fn, C.MAP_VARS, store.consts);
    if (!f) return 'bad fn';
    const st = C.stats(vs[0]!);
    const env = (i: number) => ({ x: xs[i], ...(ys ? { y: ys[i] } : {}), mean: st.mean, sum: st.sum, min: st.min, max: st.max, norm: st.norm, std: st.std, n: st.n, i: i + 1 });
    const vals = xs.map((_, i) => f(env(i)));
    const shown = xs.map((_, i) => C.substitute(cd.fn!, env(i), dp));
    return C.reduce(cd.reduce === 'dot' || cd.reduce === 'cos' ? 'sum' : cd.reduce, vals, undefined, dp, cd.reduce === 'sum' || cd.reduce === 'mean' ? shown.map((s) => (/[+−·/ ]/.test(s) ? s : s)) : undefined, cd.q);
  }
  return C.reduce(cd.reduce, xs, ys, dp, undefined, cd.q);
}

const piecesOf = (e: C.Expansion, label?: string) => [...(label ? [`${label} = `] : []), ...e.parts, e.result];

/** Renders a calc line (lines of pieces, the result in the accent); `write` reveals it piece by piece. */
async function drawCalc(b: Block, store: KitStore, c: ReturnType<typeof col>, env: BuildEnv, k: Pace, write: boolean, exp?: C.Expansion) {
  const cd = b.calc!;
  const e = exp ?? (cd.win || cd.live ? null : calcExpansion(cd, store, b.dp));
  if (typeof e === 'string') return;
  const g = b.g!;
  const old = b.el.text as SVGGElement | undefined;
  const tg = svg(g, 'g');
  if (e) {
    const m = b.m, { body } = b.placed;
    const pieces = piecesOf(e, cd.label);
    const lines = wrapPieces(pieces, cd.maxW, (s) => m.u(textWidth(s, m.numPx)));
    const pitch = m.num * 1.55;
    const spans: SVGTSpanElement[] = [];
    lines.forEach((ln, li) => {
      const t = kitText(tg, body.x, body.y + pitch * (li + 0.5), '', { size: m.num, fill: c.ink, anchor: 'start', halo: c.halo });
      ln.forEach((p) => {
        const s = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        s.textContent = p;
        const last = li === lines.length - 1 && p === ln[ln.length - 1];
        if (last) setAttrs(s, { fill: env.settings.inkColor, 'font-weight': 600 });
        t.appendChild(s);
        spans.push(s);
      });
    });
    if (write && k.fadeMs == null && !prefersReducedMotion()) {
      spans.forEach((s) => s.setAttribute('fill-opacity', '0'));
      const each = Math.min(110, 900 / spans.length) * k.speed;
      old?.remove();
      for (const s of spans) { await pause(each); s.setAttribute('fill-opacity', '1'); }
    }
  }
  old?.remove();
  b.el.text = tg;
}

// ------------------------------------------------------------------------------------------------
// windows: step and sweep

type Parts = { input: Block; kernel?: Block; out: Block; calc: Block };

/** The window's calc line under the composition (made on the first step or sweep, at build). */
function ensureWinCalc(out: Block, store: KitStore, env: BuildEnv): Block | string {
  const w = out.win!;
  if (w.calc) return store.get(w.calc)!;
  const input = store.get(w.over)!, kernel = w.kernel ? store.get(w.kernel) : undefined;
  const m = out.m;
  const parts = [input, kernel, out].filter((x): x is Block => !!x);
  const x = Math.min(...parts.map((p) => p.placed.body.x));
  const scene = sceneOf(env, out.region);
  // A plain section: under everything in it. A scene: under the composition, clear of every claim.
  const all = scene ? parts : store.inRegion(out.region);
  const y = Math.max(...all.map((p) => p.placed.rect.y + p.placed.rect.h)) + m.gap * 0.9;
  const maxW = 1000 - m.margin - x;
  // Room for the longest expansion this window will show.
  let lines = 1;
  for (let r = 0; r < w.geo.R; r++) for (let q = 0; q < w.geo.C; q++) {
    const e = C.winCell(input.vals!, r, q, w.spec, out.dp);
    if (e) lines = Math.max(lines, wrapPieces(piecesOf(e), maxW, (s) => m.u(textWidth(s, m.numPx))).length);
  }
  // In a scene the line takes the room its longest expansion needs, not the whole row to the margin.
  let longest = 0;
  if (scene) for (let r = 0; r < w.geo.R; r++) for (let q = 0; q < w.geo.C; q++) {
    const e = C.winCell(input.vals!, r, q, w.spec, out.dp);
    if (e) longest = Math.max(longest, ...wrapPieces(piecesOf(e), maxW, (s) => m.u(textWidth(s, m.numPx))).map((l) => m.u(textWidth(l.join(''), m.numPx))));
  }
  let body = { x, y, w: scene ? Math.max(longest, m.u(m.numPx * 4)) : maxW, h: lines * m.num * 1.55 };
  if (scene) body = clearOf(input, body, scene, m, env);
  const cb = newBlock(store.anonId(), 'calc', out.region, { body, rect: { ...body } }, m, [out.id]);
  cb.calc = { of: [], reduce: 'sum', win: out.id, lines, maxW };
  cb.dp = out.dp;
  if (input.shift) cb.shift = { ...input.shift };
  store.add(cb);
  claimRoom(cb, env);
  grow(env, out.region, cb.placed.rect);
  // The line runs to the margin: re-centre the section with it, so a composition centred earlier never pushes it off the board.
  const span = union(store.inRegion(out.region).map((b) => b.placed.rect));
  env.desk.centreRegion?.(out.region, span.x, span.x + span.w);
  w.calc = cb.id;
  return cb;
}

function winParts(out: Block, store: KitStore): Parts | null {
  const w = out.win!;
  const input = store.get(w.over), calc = w.calc ? store.get(w.calc) : undefined;
  if (!input?.g || !calc) return null;
  return { input, kernel: w.kernel ? store.get(w.kernel) : undefined, out, calc };
}

/** Where the window sits (input's section units) when it makes output (r, c). */
function winRect(p: Parts, r: number, q: number): Box {
  const w = p.out.win!, [kr, kc] = C.winSize(w.spec), [r0, c0] = C.winOrigin(r, q, w.geo), cs = p.input.cs!, ch = p.input.ch ?? cs;
  const { body } = p.input.placed;
  return { x: body.x + c0 * cs, y: body.y + r0 * ch, w: kc * cs, h: kr * ch };
}

/** Moves the window to output (r, c) and fills it: the overlay glides, the calc line shows its expansion, the cell fills in the accent. */
async function winGo(p: Parts, r: number, q: number, ctl: Ctl, glideMs: number, c: ReturnType<typeof col>, env: BuildEnv, also: [number, number][] = []) {
  const w = p.out.win!, accent = env.settings.inkColor;
  const inEls = p.input.el.grid as GridEls, outEls = p.out.el.grid as GridEls;
  const pin = (b: Block) => px(b, 1.5);
  // The overlay (window on the input, frame on the kernel, frame on the output cell): made on first use.
  let o = p.out.el.winEls as { win: SVGRectElement; ghosts: SVGGElement; kf?: SVGRectElement; of: SVGRectElement } | undefined;
  const to = winRect(p, r, q);
  const oc = cellBox(p.out, r, r, q, q);
  if (!o) {
    const ghosts = svg(inEls.over, 'g');
    const img = p.input.view === 'image';
    const win = svg(inEls.over, 'rect', { x: to.x - pin(p.input), y: to.y - pin(p.input), width: to.w + 2 * pin(p.input), height: to.h + 2 * pin(p.input), fill: img ? 'none' : accent, 'fill-opacity': 0.08, stroke: accent, rx: px(p.input, img ? 1 : 3), ...hair(img ? 1.6 : 2.2) });
    const kf = p.kernel?.el.grid ? svg((p.kernel.el.grid as GridEls).over, 'rect', { ...frameAt(p.kernel.placed.body, pin(p.kernel)), fill: 'none', stroke: accent, rx: px(p.kernel, 3), ...hair(2.2) }) : undefined;
    const of = svg(outEls.over, 'rect', { ...frameAt(oc, pin(p.out)), fill: 'none', stroke: accent, rx: px(p.out, 3), ...hair(2.2) });
    o = { win, ghosts, kf, of };
    p.out.el.winEls = o;
    [win, kf, of].forEach((e) => e?.setAttribute('opacity', '0'));
    w.rect = to;
    await tween(ctl.ff ? 0 : 180, (t) => [win, kf, of].forEach((e) => e?.setAttribute('opacity', String(t))), ctl);
  } else {
    const from = w.rect ?? to, fo = { x: Number(o.of.getAttribute('x')), y: Number(o.of.getAttribute('y')) };
    const ofTo = frameAt(oc, pin(p.out));
    o.ghosts.replaceChildren();
    await tween(glideMs, (t) => {
      const x = from.x + (to.x - from.x) * t, y = from.y + (to.y - from.y) * t;
      setAttrs(o!.win, { x: x - pin(p.input), y: y - pin(p.input) });
      setAttrs(o!.of, { x: fo.x + (ofTo.x - fo.x) * t, y: fo.y + (ofTo.y - fo.y) * t });
    }, ctl);
    w.rect = to;
  }
  // Padding cells the window covers outside the grid: dashed, zero.
  drawPadding(p, r, q, o.ghosts, c);
  const e = C.winCell(p.input.vals!, r, q, w.spec, p.out.dp);
  if (!e) return;
  w.pos = [r, q];
  await drawCalc(p.calc, { get: () => undefined } as unknown as KitStore, c, env, { speed: 1, fadeMs: 0 }, false, e);
  w.filled[r][q] = true;
  const next = p.out.vals!.map((row) => row.slice());
  next[r][q] = p.out.full![r][q];
  // A sweep over a large image fills a run of cells per step (`also`).
  for (const [i, j] of also) { w.filled[i][j] = true; next[i][j] = p.out.full![i][j]; }
  const prevCur = w.cur;
  w.cur = [r, q];
  await setGridVals(p.out, next, ctl.ff || p.out.view === 'image' ? 0 : 160, ctl, c, [r, q], accent);
  if (prevCur && (prevCur[0] !== r || prevCur[1] !== q)) restCell(p.out, prevCur[0], prevCur[1], c, accent);
}
const frameAt = (r: Box, p: number) => ({ x: r.x - p, y: r.y - p, width: r.w + 2 * p, height: r.h + 2 * p });

function drawPadding(p: Parts, r: number, q: number, g: SVGGElement, c: ReturnType<typeof col>) {
  const w = p.out.win!, [kr, kc] = C.winSize(w.spec), [r0, c0] = C.winOrigin(r, q, w.geo), cs = p.input.cs!, ch = p.input.ch ?? cs;
  const [R, Cn] = C.shape(p.input.vals!);
  const { body } = p.input.placed;
  for (let i = 0; i < kr; i++) for (let j = 0; j < kc; j++) {
    const rr = r0 + i, cc = c0 + j;
    if (rr >= 0 && cc >= 0 && rr < R && cc < Cn) continue;
    const x = body.x + cc * cs, y = body.y + rr * ch;
    svg(g, 'rect', { x, y, width: cs, height: ch, fill: c.cell, 'fill-opacity': 0.7, stroke: c.muted, 'stroke-dasharray': '2 3', ...hair(1) });
    if (p.input.view !== 'image') kitText(g, x + cs / 2, y + cs / 2, '0', { size: p.input.m.num, fill: c.muted });
  }
}

/** Ends a sweep: the window and frames fade, the last cell goes back to ink, the calc line steps back. */
async function winDone(p: Parts, ctl: Ctl, c: ReturnType<typeof col>, accent: string) {
  const o = p.out.el.winEls as { win: SVGRectElement; ghosts: SVGGElement; kf?: SVGRectElement; of: SVGRectElement } | undefined;
  const els = [o?.win, o?.ghosts, o?.kf, o?.of].filter((e) => !!e) as SVGElement[];
  await tween(ctl.ff ? 0 : 260, (t) => els.forEach((e) => e.setAttribute('opacity', String(1 - t))), ctl);
  els.forEach((e) => e.remove());
  p.out.el.winEls = undefined;
  p.out.win!.rect = null;
  const cur = p.out.win!.cur;
  if (cur) {
    p.out.win!.cur = null;
    restCell(p.out, cur[0], cur[1], c, accent);
  }
  (p.calc.el.text as SVGElement | undefined)?.setAttribute('opacity', '0.5');
}

async function stepOrSweep(v: Extract<KitVerb, { kind: 'step' | 'sweep' }>, env: BuildEnv, store: KitStore): Promise<ElementPlan | string> {
  const part = v.kind === 'step' ? blockPart(v.ref) : null;
  const id = part ? part.id : v.ref;
  const out = await store.wait(id);
  if (!out?.win) return `${id} is not a window's output`;
  const w = out.win;
  let target: [number, number] | null = null;
  if (part) {
    // One index on a one-row output is its column.
    const r = w.geo.R === 1 && part.r0 === 0 ? 0 : part.r0, q = part.c0;
    if (r >= w.geo.R || q >= w.geo.C) return 'step outside the output';
    target = [r, q];
  }
  const calc = ensureWinCalc(out, store, env);
  if (typeof calc === 'string') return calc;
  const input = store.get(w.over)!;
  const bbox = union([input.placed.rect, out.placed.rect, calc.placed.rect, ...(w.kernel ? [store.get(w.kernel)!.placed.rect] : [])]);
  const c = col();
  return {
    target: tgtOf(out), bbox,
    draw: async (signal) => {
      await Promise.all([out.ready, input.ready, w.kernel ? store.get(w.kernel)?.ready : null]);
      calc.g ??= svg(out.g!.parentNode as SVGGElement, 'g', { class: 'kit-block', 'data-kit': 'calc' });
      calc.markReady();
      const p = winParts(out, store);
      if (!p) return 'window not drawn';
      // The narration goes on: the sweep runs on its own; this resolves once the first cell is under way.
      let first!: () => void;
      const started = new Promise<void>((r) => { first = r; });
      void store.anim.run([out.id], async (ctl) => {
        if (signal.aborted) ctl.ff = true;
        if (target) { first(); await winGo(p, target[0], target[1], ctl, GLIDE_MS, c, env); return; }
        const order = C.sweepOrder(w.filled);
        // At most ~120 window moves: past that (a large image), each move fills a run of cells.
        const per = Math.max(1, Math.ceil(order.length / 120));
        const runs: [number, number][][] = [];
        for (let i = 0; i < order.length; i += per) runs.push(order.slice(i, i + per));
        const slot = C.sweepStepMs(runs.length, v.kind === 'sweep' ? v.dur : undefined);
        const glide = per > 1 ? 0 : Math.min(GLIDE_MS, slot * 0.4);
        for (const [i, run] of runs.entries()) {
          if (i === 0) first();
          const t0 = performance.now();
          const [r, q] = run[run.length - 1];
          await winGo(p, r, q, ctl, prefersReducedMotion() ? 0 : glide, c, env, run.slice(0, -1));
          await pause(slot - (performance.now() - t0), ctl);
        }
        first();
        await winDone(p, ctl, c, env.settings.inkColor);
      }).finally(() => first());
      await Promise.race([started, new Promise((r) => setTimeout(r, 400))]);
    },
  };
}

// ------------------------------------------------------------------------------------------------
// set: an input changes; everything computed from it follows.

async function setVerb(v: Extract<KitVerb, { kind: 'set' }>, env: BuildEnv, store: KitStore): Promise<ElementPlan | string> {
  if (v.text != null && v.vals == null && v.fn == null && v.to == null) return v.value != null || v.weight != null || blockPart(v.ref) ? `${v.ref}: a block takes a "caption" or new values` : setCaption(v.ref, v.text, env);
  const part = blockPart(v.ref);
  const id = part ? part.id : v.ref;
  const b = await store.wait(id);
  if (b?.kind === 'tokens') return setTokenVerb(b, v, part, env, store);
  if (v.state != null) return `${id} has no marks to change (state= is for tokens)`;
  if (!b || (b.kind !== 'grid' && b.kind !== 'bars' && b.kind !== 'shares')) return `${id} has no values to set`;
  if (!b.src || !('vals' in b.src)) return `${id} is computed: set its inputs instead`;
  if (b.parts) return setParts(b, v, part, env, store);
  const cur = b.src.vals;
  let next: C.Mat;
  if (v.vals) {
    if (!C.sameShape(v.vals, cur)) return 'set: shape differs';
    next = v.vals;
  } else if (v.fn) {
    const f = formula(v.fn, C.MAP_VARS, store.consts);
    if (!f) return 'bad fn';
    const all = C.mapMat(cur, f);
    next = part ? cur.map((row, r) => row.map((x, q) => (inPart(part, r, q, b) ? all[r][q] : x))) : all;
  } else {
    if (!part) return 'set to= needs a cell';
    next = cur.map((row, r) => row.map((x, q) => (inPart(part, r, q, b) ? v.to! : x)));
  }
  if (next.flat().some((x) => !Number.isFinite(x))) return 'set: not a number';
  const deps = store.dependents(b.id);
  const c = col();
  const bbox = union([b.placed.rect, ...deps.filter((d) => d.region === b.region).map((d) => d.placed.rect)]);
  return {
    target: tgtOf(b), bbox,
    draw: async (signal) => {
      await b.ready;
      void store.anim.run([b.id, ...deps.map((d) => d.id)], async (ctl) => {
        if (signal.aborted) ctl.ff = true;
        b.src = { vals: next };
        const jobs: Promise<void>[] = [];
        if (b.kind === 'shares') jobs.push(setShares(b, [normalize(next.flat())], store, SET_MS, ctl, c));
        else if (b.kind === 'bars') { b.ghost = cur[0].slice(); b.full = next; jobs.push(setBarVals(b, next, SET_MS, ctl, c)); }
        else jobs.push(setGridVals(b, next, SET_MS, ctl, c));
        jobs.push(refreshDeps([b.id], store, SET_MS, ctl, env, c));
        await Promise.all(jobs);
        store.notify(b.id);
      });
      await pause(Math.min(SET_MS, 300));
    },
  };
}

/**
 * A split's parts for a bar of value `total`: every part given (they must sum to it), or all but the
 * first (the first is what remains). Formulas over the constants. A string says why not.
 */
export function splitParts(a: { vals: string[]; labels: string[] }, total: number, consts: Record<string, number>): number[] | string {
  const vs = a.vals.map((e) => { const f = formula(e, [], consts); return f ? f({}) : NaN; });
  const bad = a.vals.find((_, i) => !Number.isFinite(vs[i]));
  if (bad != null) return `split: ${bad} is not a number`;
  const rest = a.labels.length === vs.length + 1;
  const parts = rest ? [total - vs.reduce((s, v) => s + v, 0), ...vs] : vs;
  const sum = parts.reduce((s, v) => s + v, 0);
  if (Math.abs(sum - total) > 1e-6 * Math.max(1, Math.abs(total))) return `split: the parts sum to ${C.fmt(sum)}, not ${C.fmt(total)}`;
  if (parts.some((p) => p < 0) && total >= 0) return 'split: a part is negative';
  return parts;
}

// ------------------------------------------------------------------------------------------------
// Tokens: a count as that many marks, in clusters by state; a set moves marks between clusters.

type TokenEls = { marks: SVGCircleElement[]; labels: SVGGElement; at: { x: number; y: number }[] };

/** Where each mark sits for these states (clusters left to right in state order, centred), and each cluster's label spot and count. */
function tokenLayout(b: Block, st: number[]): { at: { x: number; y: number }[]; groups: { x: number; count: number; j: number }[] } {
  const t = b.tok!, { body } = b.placed, gap = t.pitch * TOKEN_GAP;
  const counts = t.states.map((_, j) => st.filter((s) => s === j).length);
  const used = counts.map((c, j) => ({ c, j })).filter((g) => g.c > 0);
  const widths = used.map((g) => Math.min(g.c, t.cols) * t.pitch);
  const total = widths.reduce((s, w) => s + w, 0) + gap * (used.length - 1);
  let x = body.x + (body.w - total) / 2;
  const origin = new Map<number, number>();
  const groups = used.map((g, k) => { origin.set(g.j, x); const out = { x: x + widths[k] / 2, count: g.c, j: g.j }; x += widths[k] + gap; return out; });
  const seen = t.states.map(() => 0);
  const at = st.map((s) => {
    const k = seen[s]++;
    return { x: origin.get(s)! + (k % t.cols) * t.pitch + t.pitch / 2, y: body.y + Math.floor(k / t.cols) * t.pitch + t.pitch / 2 };
  });
  return { at, groups };
}

/** Gap between state clusters, in mark pitches. */
const TOKEN_GAP = 1.4;
/** A tokens block's type: counts and state names at the board's body size or larger (the final board reads on its own). */
function tokenType(m: Metrics): { num: number; label: number } {
  return { num: Math.max(m.num, m.body), label: Math.max(m.label, m.body) };
}
/**
 * Marks per row and the mark pitch for n marks in `states` clusters: a compact grid (rows, never one
 * thin line), the columns that leave fewest empty slots at about √n; marks a little larger than the
 * type. Too wide for the section: taller clusters first, then smaller marks.
 */
export function tokenGrid(n: number, states: number, m: Metrics): { cols: number; pitch: number } {
  const root = Math.ceil(Math.sqrt(n));
  let cols = n <= 5 ? n : root;
  if (n > 5) for (let c = root; c <= Math.min(n, root * 2); c++) if (c * Math.ceil(n / c) - n < cols * Math.ceil(n / cols) - n) cols = c;
  let pitch = tokenType(m).num * 2;
  const maxW = 1000 - 2 * m.margin;
  const width = (c: number, p: number) => (states * c + (states - 1) * TOKEN_GAP) * p;
  while (width(cols, pitch) > maxW && cols > Math.max(1, Math.ceil(root / 2))) cols--;
  if (width(cols, pitch) > maxW) pitch = maxW / (states * cols + (states - 1) * TOKEN_GAP);
  return { cols, pitch };
}

/** Each cluster's count (the engine's) over its state's name, under the marks. */
function paintTokenLabels(b: Block, groups: { x: number; count: number; j: number }[], c: ReturnType<typeof col>, opacity = 1) {
  const e = b.el.tok as TokenEls, m = tokenType(b.m), { body } = b.placed;
  e.labels.replaceChildren();
  const y = body.y + body.h + m.num * 0.85;
  for (const g of groups) {
    kitText(e.labels, g.x, y, String(g.count), { size: m.num, fill: c.ink, opacity });
    const name = b.tok!.states[g.j];
    if (name) kitText(e.labels, g.x, y + m.label * 1.3, shown(name), { size: m.label, fill: c.muted, opacity });
  }
}

async function drawTokens(b: Block, c: ReturnType<typeof col>, k: Pace) {
  const g = b.g!, t = b.tok!, r = t.pitch * 0.34;
  const { at, groups } = tokenLayout(b, t.st);
  const markG = svg(g, 'g');
  const marks = at.map((p, i) => svg(markG, 'circle', { cx: p.x, cy: p.y, r, fill: partTone(t.st[i], c), opacity: 0 }));
  b.el.tok = { marks, labels: svg(g, 'g'), at } satisfies TokenEls;
  const cap = b.el.caption as string | undefined;
  const T = tokenType(b.m);
  if (cap) caption(g, b.placed.body.x + b.placed.body.w / 2, b.placed.body.y + b.placed.body.h + T.num * 1.4 + (t.states[0] ? T.label * 2.4 : T.label * 1.1), cap, { ...b.m, label: T.label }, c);
  // Counted out one by one (quickly), then the count.
  const fast = k.fadeMs != null || prefersReducedMotion();
  const each = fast ? 0 : Math.min(90, 900 / marks.length) * k.speed;
  for (const mk of marks) { mk.setAttribute('opacity', '1'); if (each) await pause(each); }
  paintTokenLabels(b, groups, c);
}

/** Marks glide to their new clusters and take the new state's tone; the counts follow. */
async function setTokens(b: Block, st: number[], ms: number, ctl: Ctl | undefined, c: ReturnType<typeof col>) {
  const e = b.el.tok as TokenEls | undefined, t = b.tok!;
  const before = t.st.slice();
  t.st = st;
  b.full = [[st.length]]; b.vals = b.full;
  if (!e) return;
  const { at, groups } = tokenLayout(b, st);
  const from = e.at.map((p) => ({ ...p }));
  const old = tokenLayout(b, before).groups;
  await tween(ms, (k) => {
    const q = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; // ease in-out: a glide, not a jump
    e.marks.forEach((mk, i) => {
      // A moving mark lifts a little on its way (it travels, it does not slide through its neighbours).
      const lift = before[i] !== st[i] ? Math.sin(Math.PI * q) * t.pitch * 0.45 : 0;
      setAttrs(mk, { cx: from[i].x + (at[i].x - from[i].x) * q, cy: from[i].y + (at[i].y - from[i].y) * q - lift, fill: before[i] === st[i] ? partTone(st[i], c) : mix(partTone(before[i], c), partTone(st[i], c), q) });
    });
    if (k < 0.5) paintTokenLabels(b, old, c, 1 - 2 * k); else paintTokenLabels(b, groups, c, 2 * k - 1);
  }, ctl);
  e.at = at;
  paintTokenLabels(b, groups, c);
}

/** Most marks a tokens block draws (a count beyond it is a bar or a grid). */
export const MAX_TOKENS = 120;

/** A tokens block's count: a whole number from a literal or a formula over the constants. */
export function tokenCount(src: string, consts: Record<string, number>): number | string {
  const f = formula(src, [], consts);
  const n = f ? f({}) : NaN;
  if (!Number.isFinite(n)) return `tokens: n=${src} is not a number`;
  const k = Math.round(n);
  if (Math.abs(n - k) > 1e-9 || k < 1) return `tokens: n=${src} is not a whole count`;
  return k > MAX_TOKENS ? `tokens: ${k} marks is more than ${MAX_TOKENS} (use bars or a grid)` : k;
}

/**
 * Which marks a `set … state=` moves: the part's marks (k[7:8]), or `n=` of them (a formula), taken
 * from the end among those not already in that state. Returns every mark's new state.
 */
export function tokenMoves(tok: { states: string[]; st: number[] }, v: { state?: string; count?: string }, part: BlockPart | null, consts: Record<string, number>): number[] | string {
  const j = tok.states.indexOf(v.state ?? '');
  if (j < 0) return `no state ${v.state} (states: ${tok.states.join(', ')})`;
  const st = tok.st.slice();
  if (part && !part.one) return 'tokens: name marks as k[7:8]';
  if (v.count != null) {
    const n = tokenCount(v.count, consts);
    if (typeof n === 'string') return n;
    const lo = part ? part.c0 : 0, hi = part ? part.c1 : st.length - 1;
    const free = [];
    for (let i = hi; i >= lo; i--) if (st[i] !== j) free.push(i);
    if (n > free.length) return `tokens: only ${free.length} marks can move to ${v.state}`;
    free.slice(0, n).forEach((i) => { st[i] = j; });
    return st;
  }
  if (!part) return 'set: name the marks (k[7:8]) or how many (n=)';
  if (part.c1 >= st.length || part.c0 < 0) return `tokens: there are ${st.length} marks`;
  for (let i = part.c0; i <= part.c1; i++) st[i] = j;
  return st;
}

/** set on tokens: the named marks (or n= of them) take another state, gliding to its cluster. */
function setTokenVerb(b: Block, v: Extract<KitVerb, { kind: 'set' }>, part: BlockPart | null, env: BuildEnv, store: KitStore): ElementPlan | string {
  if (v.state == null) return `${b.id} is a count of marks: set id=${b.id}[1:2] state=…`;
  // From the state the earlier sets will have left (they may still be drawing).
  const st = tokenMoves({ states: b.tok!.states, st: (b.el.tokNext as number[] | undefined) ?? b.tok!.st }, v, part, store.consts);
  if (typeof st === 'string') return st;
  b.el.tokNext = st;
  const c = col();
  void env;
  return {
    target: tgtOf(b), bbox: pad(b.placed.rect, b.m.u(8)),
    draw: async (signal, k) => {
      await b.ready;
      await store.anim.run([b.id], async (ctl) => {
        if (signal.aborted || k.fadeMs != null) ctl.ff = true;
        await setTokens(b, st, prefersReducedMotion() ? 0 : SET_MS * 1.6, ctl, c);
        store.notify(b.id);
      });
    },
  };
}

/** set on stacked bars: one part (`v[i,j] to=`; its total follows), or the totals (vals=, fn=; parts keep their proportions). */
function setParts(b: Block, v: Extract<KitVerb, { kind: 'set' }>, part: BlockPart | null, env: BuildEnv, store: KitStore): ElementPlan | string {
  const old = b.vals![0].slice(), from = b.parts!.map((r) => r.slice());
  const parts = b.parts!.map((r) => r.slice());
  if (v.to != null && part && !part.one) { if (parts[part.r0]?.[part.c0] == null) return 'set: no such part'; parts[part.r0][part.c0] = v.to; }
  else {
    let next: number[];
    if (v.vals) next = v.vals.flat();
    else if (v.fn) { const f = formula(v.fn, C.MAP_VARS, store.consts); if (!f) return 'bad fn'; next = C.mapMat([old], f)[0]; }
    else if (v.to != null && part?.one) { next = old.slice(); next[part.c0] = v.to; }
    else return 'set: name a part (v[2,1]) or give values';
    if (next.length !== old.length) return 'set: shape differs';
    next.forEach((t, i) => { parts[i] = parts[i].map((p) => (old[i] ? (p * t) / old[i] : t / parts[i].length)); });
  }
  if (parts.flat().some((x) => !Number.isFinite(x))) return 'set: not a number';
  const totals = [parts.map((r) => (b.el.side ? groupTop(r) : r.reduce((t, x) => t + x, 0)))];
  const deps = store.dependents(b.id), c = col();
  return {
    target: tgtOf(b), bbox: b.placed.rect,
    draw: async (signal) => {
      await b.ready;
      void store.anim.run([b.id, ...deps.map((d) => d.id)], async (ctl) => {
        if (signal.aborted) ctl.ff = true;
        b.src = { vals: totals }; b.full = totals; b.parts = parts; b.el.partsFrom = from;
        await Promise.all([setBarVals(b, totals, SET_MS, ctl, c), refreshDeps([b.id], store, SET_MS, ctl, env, c)]);
        b.el.partsFrom = undefined;
        store.notify(b.id);
      });
      await pause(Math.min(SET_MS, 300));
    },
  };
}

/** {{split id=v[i] vals=… "a" "b"}}: bar i divides into its parts in place: gaps open, tones turn, values and names fade in. */
async function splitVerb(v: Extract<KitVerb, { kind: 'splitBar' }>, env: BuildEnv, store: KitStore): Promise<ElementPlan | string> {
  const part = blockPart(v.ref);
  const b = await store.wait(part?.id ?? v.ref);
  if (!b || b.kind !== 'bars' || b.view === 'line' || !b.vals) return `no bars ${part?.id ?? v.ref}`;
  const totals = b.vals[0];
  const i = part ? (part.one ? part.c0 : -1) : totals.length === 1 ? 0 : -1;
  if (i < 0 || i >= totals.length) return `split: name one bar (${b.id}[1])`;
  const got = splitParts(v, (b.full ?? b.vals)[0][i], store.consts);
  if (typeof got === 'string') return got;
  const c = col();
  return {
    target: tgtOf(b), bbox: b.placed.rect,
    draw: async (signal, k) => {
      await b.ready;
      await store.anim.run([b.id], async (ctl) => {
        if (signal.aborted || k.fadeMs != null) ctl.ff = true;
        b.parts = b.parts ?? totals.map((x) => [x]);
        b.parts[i] = got;
        if (v.labels.length) b.el.partNames = shownAll(v.labels);
        const st = (b.el.splitT as Map<number, number> | undefined) ?? new Map<number, number>();
        b.el.splitT = st;
        // Room for the names on the right (the block was laid out without them): they sit past its body.
        const e = b.el.bars as BarEls;
        await tween(prefersReducedMotion() ? 0 : SET_MS * 1.2, (t) => { st.set(i, easeOut(t)); paintParts(b, i, barRect(b, i, b.vals![0][i]), 1, c); setAttrs(e.bars[i], { 'fill-opacity': 0 }); paintPartNames(b, c); }, ctl);
        st.set(i, 1);
        paintParts(b, i, barRect(b, i, b.vals![0][i]), 1, c);
        paintPartNames(b, c);
        store.notify(b.id);
      });
    },
  };
}

function inPart(p: BlockPart, r: number, q: number, b: Block): boolean {
  const oneRow = b.vals!.length === 1;
  if (oneRow && p.r0 === 0 && p.r1 === 0) return r === 0 && q >= p.c0 && q <= p.c1;
  return r >= p.r0 && r <= p.r1 && q >= p.c0 && q <= p.c1;
}

// ------------------------------------------------------------------------------------------------
// Parts as places: boxes and points for emph, fade, box, arrows, connectors.

/** Section box of a block part (or the block's body); null when out of range. */
export function partBox(b: Block, p: BlockPart | null): Box | null {
  if (!p) return b.placed.body;
  if (b.kind === 'grid') {
    const [R, Cn] = C.shape(b.vals!);
    if (p.r1 >= R || p.c1 >= Cn) return null;
    return cellBox(b, p.r0, p.r1, p.c0, p.c1);
  }
  if (b.kind === 'table') {
    const [R, Cn] = C.shape(b.vals!);
    // One index on a table is a row (t[3]: the third row, every column).
    if (p.one) p = { ...p, r0: p.c0, r1: p.c1, c0: 0, c1: Cn - 1 };
    if (p.r1 >= R || p.c1 >= Cn) return null;
    return union([tabCell(b, p.r0, p.c0), tabCell(b, p.r1, p.c1)]);
  }
  if (b.kind === 'bars') {
    const n = b.vals![0].length;
    if (p.c1 >= n) return null;
    return b.view === 'line' ? lineBox(b, p.c0, p.c1) : barBox(b, p.c0, p.c1);
  }
  if (b.kind === 'shares') {
    if (p.c1 >= b.vals![0].length) return null;
    return union([shareSeg(b, p.c0), shareSeg(b, p.c1)]);
  }
  if (b.kind === 'scatter') {
    const n = b.data!.length;
    if (p.c1 >= n) return null;
    const ps = b.data!.slice(p.c0, p.c1 + 1).map((d) => toPlot(b, d));
    const r = px(b, 6);
    return union(ps.map((q) => ({ x: q.x - r, y: q.y - r, w: 2 * r, h: 2 * r })));
  }
  return b.placed.body;
}

/** Resolves a part reference (`g[2,3]`) to its block and box. */
export async function resolvePart(ref: string, registry: Registry): Promise<{ b: Block; box: Box; part: BlockPart | null } | string> {
  const store = kitStore(registry);
  const rd = store.finds.get(ref);
  if (rd) {
    // A readout: its point on the plot's axes (computed now, with the constants as they stand).
    const pb = await store.wait(rd.of[0]);
    if (!pb) return `unknown plot ${rd.of[0]}`;
    await Promise.race([pb.ready, new Promise((r) => setTimeout(r, KIT_WAIT_MS))]);
    const r = store.reading(ref);
    if (typeof r === 'string') return r;
    if (!r.point || !pb.plot) return `${ref} is a number, not a point`;
    const p = linePt(pb.plot, r.x, r.y), d = px(pb, 4);
    return { b: pb, box: { x: p.x - d, y: p.y - d, w: 2 * d, h: 2 * d }, part: null };
  }
  const part = blockPart(ref);
  const b = await store.wait(part ? part.id : ref);
  if (!b) return `unknown block ${part ? part.id : ref}`;
  await Promise.race([b.ready, new Promise((r) => setTimeout(r, KIT_WAIT_MS))]);
  const box = partBox(b, part);
  const norm = b.kind === 'table' && part?.one ? { ...part, r0: part.c0, r1: part.c1, c0: 0, c1: b.vals![0].length - 1, one: false } : part;
  return box ? { b, box, part: norm } : `${ref} is outside ${b.id}`;
}

/** Replaces kit part references in an action's points with their centres (a box with w = 0 frames the part). */
export async function resolveKitPoints<A extends InkAction>(a: A, registry: Registry): Promise<A | string> {
  const out: Record<string, unknown> = { ...a };
  for (const k of ['at', 'from', 'to'] as const) {
    const v = out[k] as { ref?: string } | undefined;
    if (!v || typeof v !== 'object' || !('ref' in v) || !v.ref || !(isBlockRef(v.ref) || kitStore(registry).finds.has(v.ref))) continue;
    const r = await resolvePart(v.ref, registry);
    if (typeof r === 'string') return r;
    if (a.kind === 'box' && k === 'at' && out.w === 0) {
      const p = r.b.m.u(3);
      const wb = worldBox(r.b, r.box);
      Object.assign(out, { at: { x: wb.x - p, y: wb.y - p }, w: wb.w + 2 * p, h: wb.h + 2 * p });
    } else { const wb = worldBox(r.b, r.box); out[k] = { x: wb.x + wb.w / 2, y: wb.y + wb.h / 2 }; }
  }
  if (Array.isArray(out.pts)) {
    const ps = [];
    for (const v of out.pts as { ref?: string; x?: number }[]) {
      if (v && 'ref' in v && v.ref && isBlockRef(v.ref)) {
        const r = await resolvePart(v.ref, registry);
        if (typeof r === 'string') return r;
        const wb = worldBox(r.b, r.box);
        ps.push({ x: wb.x + wb.w / 2, y: wb.y + wb.h / 2 });
      } else ps.push(v);
    }
    out.pts = ps;
  }
  return out as A;
}

/** Whether a ref action is the kit's: a kit verb, or emph / fade on a block or its part. */
export function isKitRef(a: RefAction, registry: Registry): boolean {
  if (a.kind === 'step' || a.kind === 'sweep' || a.kind === 'set' || a.kind === 'band' || a.kind === 'dist' || a.kind === 'col' || a.kind === 'level') return true;
  if (a.kind === 'limit' || a.kind === 'beforeafter' || a.kind === 'contrast' || a.kind === 'splitBar' || a.kind === 'tween') return true;
  if (a.kind === 'emph' && a.where) return true;
  if (a.kind !== 'emph' && a.kind !== 'fade') return false;
  if (isBlockRef(a.ref)) return true;
  const b = kitStore(registry).get(a.ref);
  return !!b && (b.kind === 'grid' || b.kind === 'bars' || b.kind === 'scatter' || b.kind === 'table' || b.kind === 'shares');
}

/** Builds a kit verb, or emph / fade on a block part. */
export async function buildKitRef(a: RefAction, env: BuildEnv): Promise<ElementPlan | string> {
  const store = kitStore(env.registry);
  switch (a.kind) {
    case 'step':
    case 'sweep': return stepOrSweep(a, env, store);
    case 'set': return setVerb(a, env, store);
    case 'splitBar': return splitVerb(a, env, store);
    case 'limit': return limitMove(a, env, store);
    case 'tween': return tweenMove(a, env, store);
    case 'beforeafter': return beforeAfter(a, env, store);
    case 'contrast': return 'contrast: its copy is made when the script is parsed';
    case 'band': return band(a, env, store);
    case 'dist': return dist(a, env, store);
    case 'level': {
      if (a.colName == null) return levelVerb(a, env, store);
      const r = await resolveCol([a.ref, -1, a.colName], store);
      return r[2] == null ? levelVerb({ ...a, col: r[1], colName: undefined }, env, store) : `no column ${a.colName}`;
    }
    case 'col': {
      // `t.c` or `t.Header` fills that column (declared empty in the table); a header the table does
      // not have yet appends a column under that name; a bare id appends a column.
      const cr = colRef(a.ref);
      if (!cr) return colVerb(a, env, store);
      const r = await resolveCol(cr, store);
      return r[2] == null ? colVerb({ ...a, ref: r[0] }, env, store, r[1]) : colVerb({ ...a, ref: r[0], head: a.head || r[2] }, env, store);
    }
    case 'emph': if (a.where) return emphWhere(a, env, store); // falls through
    // eslint-disable-next-line no-fallthrough
    case 'fade': return emphFade(a, env);
  }
  return 'not a kit verb';
}

/**
 * emph on a part: a persistent accent frame (cells: their numerals turn accent too), which glides to
 * the next part emphasized on that block; on a whole block, the frame comes and goes. Bars and points
 * turn accent. fade dims the part.
 */
async function emphFade(a: Extract<RefAction, { kind: 'emph' | 'fade' }>, env: BuildEnv): Promise<ElementPlan | string> {
  const r = await resolvePart(a.ref, env.registry);
  if (typeof r === 'string') return r;
  const { b, box, part } = r;
  const c = col(), accent = env.settings.inkColor;
  return {
    target: tgtOf(b), bbox: pad(box, b.m.u(8)),
    draw: async (_signal, k) => {
      if (a.kind === 'fade') { await fadePart(b, part, k); return; }
      if (b.kind === 'bars' && b.view === 'line' && part) {
        const e = b.el.line as LineEls;
        for (let i = part.c0; i <= part.c1; i++) {
          if (!Number.isFinite(b.vals![0][i])) continue;
          const q = linePt(b.plot!, b.xs![i], b.vals![0][i]);
          svg(e.rings, 'circle', { cx: q.x, cy: q.y, r: px(b, 7), fill: 'none', stroke: accent, ...hair(1.6) });
          e.dots[i]?.setAttribute('fill', accent);
        }
        return;
      }
      if (b.kind === 'shares' && part) {
        const e = b.el.shares as ShareEls;
        for (let i = part.c0; i <= part.c1; i++) { e.em.add(i); paintShares(b, c, accent); }
        return;
      }
      if (b.kind === 'bars' && part) {
        const e = b.el.bars as BarEls;
        for (let i = part.c0; i <= part.c1; i++) { e.emBars.add(i); e.bars[i].setAttribute('fill', accent); e.vals[i].setAttribute('fill', accent); }
        return;
      }
      if (b.kind === 'scatter' && part) {
        const e = b.el.scatter as ScatterEls;
        for (let i = part.c0; i <= part.c1; i++) { setAttrs(e.pts[i], { fill: accent, stroke: 'none' }); svg(e.marks, 'circle', { cx: e.pts[i].getAttribute('cx')!, cy: e.pts[i].getAttribute('cy')!, r: px(b, 9), fill: 'none', stroke: accent, ...hair(1.4) }); }
        return;
      }
      const host = b.kind === 'grid' ? (b.el.grid as GridEls).over : b.kind === 'table' ? (b.el.table as TableEls).over : b.g!;
      const p = px(b, 2);
      const to = frameAt(box, p);
      if (!part) {
        const f = svg(host, 'rect', { ...to, fill: 'none', stroke: accent, rx: px(b, 3), ...hair(2), opacity: 0 });
        await tween(200 * k.speed, (t) => f.setAttribute('opacity', String(t)));
        await pause(900);
        await tween(400, (t) => f.setAttribute('opacity', String(1 - t)));
        f.remove();
        return;
      }
      const els = (b.kind === 'table' ? b.el.table : b.el.grid) as GridEls;
      const prevEm = els.emCells ?? [];
      els.emCells = [];
      for (let i = part.r0; i <= part.r1; i++) for (let j = part.c0; j <= part.c1; j++) els.emCells.push([i, j]);
      const [lo, hi] = rangeOf(b);
      for (const [i, j] of prevEm) { const t = els.texts[i][j]; t.setAttribute('fill', b.kind === 'table' ? c.ink : shadeOf(b.vals![i][j], b.shade, lo, hi, c).text); t.setAttribute('font-weight', '400'); }
      for (const [i, j] of els.emCells) { const t = els.texts[i][j]; t.setAttribute('fill', accent); t.setAttribute('font-weight', '600'); }
      if (els.emph) {
        const f = els.emph, from = { x: +f.getAttribute('x')!, y: +f.getAttribute('y')!, w: +f.getAttribute('width')!, h: +f.getAttribute('height')! };
        await tween(GLIDE_MS * k.speed, (t) => setAttrs(f, { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, width: from.w + (to.width - from.w) * t, height: from.h + (to.height - from.h) * t }));
      } else {
        els.emph = svg(els.over, 'rect', { ...to, fill: accent, 'fill-opacity': 0.06, stroke: accent, rx: px(b, 3), ...hair(2), opacity: 0 });
        await tween(220 * k.speed, (t) => els.emph!.setAttribute('opacity', String(t)));
      }
    },
  };
}

async function fadePart(b: Block, part: BlockPart | null, k: Pace) {
  const dim: Element[] = [];
  if (!part) dim.push(b.g!);
  else if (b.kind === 'grid' || b.kind === 'table') { const e = (b.kind === 'table' ? b.el.table : b.el.grid) as GridEls; for (let i = part.r0; i <= part.r1; i++) for (let j = part.c0; j <= part.c1; j++) dim.push(e.texts[i][j], ...(e.cells ? [e.cells[i][j]] : [])); }
  else if (b.kind === 'bars' && b.view === 'line') { const e = b.el.line as LineEls; for (let i = part.c0; i <= part.c1; i++) if (e.dots[i]) dim.push(e.dots[i]); }
  else if (b.kind === 'bars') { const e = b.el.bars as BarEls; for (let i = part.c0; i <= part.c1; i++) dim.push(e.bars[i], e.vals[i]); }
  else if (b.kind === 'scatter') { const e = b.el.scatter as ScatterEls; for (let i = part.c0; i <= part.c1; i++) dim.push(e.pts[i]); }
  await tween(300 * k.speed, (t) => dim.forEach((d) => d.setAttribute('opacity', String(1 - 0.7 * t))));
}

/** A connector end on a kit part: its box. */
export async function kitEndBox(region: string, ref: string, registry: Registry): Promise<{ t: Target; r: SRect } | string> {
  const r = await resolvePart(ref, registry);
  return typeof r === 'string' ? r : { t: { region }, r: worldBox(r.b, r.box) };
}

/** A box in a block's drawing space → the scene's world (a moved block's group is shifted). */
export const worldBox = (b: Block, box: Box): Box => (b.shift ? { ...box, x: box.x + b.shift.x, y: box.y + b.shift.y } : box);

// ------------------------------------------------------------------------------------------------
// table: a header per column, rows of values, computed columns that fill row by row.

type TableEls = { texts: SVGTextElement[][]; heads: SVGTextElement[]; over: SVGGElement; rows: SVGGElement; hl?: SVGRectElement; cur?: [number, number] };

const tabCell = (b: Block, r: number, j: number): Box => ({ x: b.tab!.xs[j], y: b.placed.body.y + r * b.tab!.rh, w: b.tab!.ws[j], h: b.tab!.rh });
const tabStr = (b: Block, r: number, j: number) => {
  const v = b.vals![r][j];
  const frac = !!b.litFrac && j < (b.litCols ?? 0) && C.fractions(b.full!.map((row) => row[j]));
  return Number.isFinite(v) ? C.fmt(v, b.dp, frac) : b.tab!.filled[r][j] ? '—' : '';
};

async function drawTable(b: Block, c: ReturnType<typeof col>, k: Pace) {
  const g = b.g!, { body } = b.placed, m = b.m, tb = b.tab!;
  const [R, Cn] = C.shape(b.vals!);
  const head = svg(g, 'g');
  const over = svg(g, 'g');
  const heads = tb.heads.map((h, j) => kitText(head, tb.xs[j] + tb.ws[j] / 2, body.y - tb.hh / 2, shown(h), { size: m.label, fill: c.ink2 }));
  svg(head, 'line', { x1: body.x, x2: body.x + body.w, y1: body.y - px(b, 1), y2: body.y - px(b, 1), stroke: c.edge, ...hair(1) });
  const cap = b.el.caption as string | undefined;
  if (cap) caption(head, body.x + body.w / 2, body.y + body.h + m.label * 1.2, cap, m, c);
  const rows = svg(g, 'g');
  const texts: SVGTextElement[][] = [];
  for (let r = 0; r < R; r++) {
    texts.push([]);
    for (let j = 0; j < Cn; j++) {
      const cell = tabCell(b, r, j);
      texts[r].push(kitText(rows, cell.x + cell.w / 2, cell.y + cell.h / 2, tabStr(b, r, j), { size: m.num, fill: c.ink, opacity: 0 }));
    }
  }
  b.el.table = { texts, heads, over, rows } satisfies TableEls;
  await appear(head, 200, k);
  if (k.fadeMs != null || prefersReducedMotion()) { texts.flat().forEach((t) => t.setAttribute('opacity', '1')); return; }
  const each = Math.min(70, 420 / Math.max(1, R)) * k.speed;
  await Promise.all(texts.map((ts, r) => pause(r * each).then(() => tween(160 * k.speed, (t) => ts.forEach((x) => x.setAttribute('opacity', String(t)))))));
}

/** Writes table values now shown (blank and filled cells), the current cell in the accent. */
function paintTable(b: Block, c: ReturnType<typeof col>, accent: string, cur?: [number, number] | null) {
  const e = b.el.table as TableEls | undefined;
  if (!e) return;
  b.vals!.forEach((row, r) => row.forEach((_, j) => {
    const t = e.texts[r][j];
    t.textContent = tabStr(b, r, j);
    t.setAttribute('opacity', '1');
    const on = cur && cur[0] === r && cur[1] === j;
    const blank = !Number.isFinite(b.vals![r][j]);
    setAttrs(t, { fill: on ? accent : blank ? c.muted : c.ink, 'font-weight': on ? 600 : 400 });
  }));
}

/** Refreshes everything computed from `ids` (in creation order), over `ms`. */
async function refreshDeps(ids: string[], store: KitStore, ms: number, ctl: Ctl | undefined, env: BuildEnv, c: ReturnType<typeof col>) {
  const seen = new Set<string>();
  return refreshBlocks(ids.flatMap((id) => store.dependents(id)).filter((d) => !seen.has(d.id) && seen.add(d.id)), store, ms, ctl, env, c);
}

/** Recomputes these blocks (in creation order) and tweens them to their new values over `ms`; calc lines follow. */
async function refreshBlocks(deps: Block[], store: KitStore, ms: number, ctl: Ctl | undefined, env: BuildEnv, c: ReturnType<typeof col>) {
  const jobs: Promise<void>[] = [];
  for (const d of deps) {
    if (d.kind === 'scatter') { jobs.push(refreshScatter(d, store, ms, ctl, c, env.settings.inkColor)); continue; }
    if (d.kind === 'calc' || d.kind === 'fit' || !d.src) continue;
    const got = computeSource(d.src, (x) => store.get(x), d.id, withConsts(store.consts, d.el.with as Record<string, number> | undefined));
    if (typeof got === 'string') continue;
    if (d.kind === 'shares') { const nv = [normalize(got.full.flat())]; if (nv[0].every(Number.isFinite)) jobs.push(setShares(d, nv, store, ms, ctl, c)); continue; }
    if (d.kind === 'bars' && !d.win) got.full = asRow(got.full);
    if (!d.win && 'col' in d.src) { /* a table column: shows what has filled */ }
    else d.full = got.full;
    const shown = d.win ? got.full.map((row, r) => row.map((x, q) => (d.win!.filled[r][q] ? x : NaN))) : got.full;
    if (d.kind === 'bars' && d.el.bars) jobs.push(setBarVals(d, shown, ms, ctl, c));
    else if (d.kind === 'grid' && d.el.grid) jobs.push(setGridVals(d, shown, ms, ctl, c, d.win?.cur ?? null, env.settings.inkColor));
    else d.vals = shown;
  }
  await Promise.all(jobs);
  deps.forEach((d) => store.notify(d.id));
  for (const d of deps) {
    if (d.kind !== 'calc' || !d.g || d.calc!.live) continue;
    if (d.calc!.win) {
      const out = store.get(d.calc!.win)!, pos = out.win?.pos;
      const inp = out.win ? store.get(out.win.over) : undefined;
      const e = pos && inp ? C.winCell(inp.vals!, pos[0], pos[1], out.win!.spec, out.dp) : null;
      if (e) await drawCalc(d, store, c, env, { speed: 1, fadeMs: 0 }, false, e);
    } else await drawCalc(d, store, c, env, { speed: 1, fadeMs: 0 }, false);
    const res = (d.el.text as SVGGElement | undefined)?.querySelectorAll('tspan');
    const last = res?.[res.length - 1];
    if (last) await tween(ctl?.ff ? 0 : 260, (t) => last.setAttribute('fill-opacity', String(0.3 + 0.7 * t)), ctl);
  }
}

/** The env a table fn sees on row r: a b c… its cells, pa pb… the row above's, i the row number. */
function rowEnv(b: Block, vals: C.Mat, r: number): Record<string, number> {
  const env: Record<string, number> = { i: r + 1 };
  vals[r].forEach((v, j) => { env[C.WIN_LETTERS[j]] = v; env[`p${C.WIN_LETTERS[j]}`] = r > 0 ? vals[r - 1][j] : NaN; });
  return env;
}
const ROW_VARS = ['i', ...C.WIN_LETTERS.slice(0, 12), ...C.WIN_LETTERS.slice(0, 12).map((l) => `p${l}`)];

async function colVerb(v: Extract<KitVerb, { kind: 'col' }>, env: BuildEnv, store: KitStore, col0?: number): Promise<ElementPlan | string> {
  const t = await store.wait(v.ref);
  if (!t || t.kind !== 'table') return `no table ${v.ref}`;
  const fn = formula(v.fn, ROW_VARS, store.consts);
  if (!fn) return 'bad fn';
  const tb = t.tab!, m = t.m;
  const [R, Cn] = C.shape(t.full!);
  let j = col0 ?? Cn;
  if (j > Cn) return 'no such column';
  if (j === Cn) {
    // A new column at the right edge.
    const w = m.u(Math.max(textWidth(v.head, m.labelPx), m.numPx * 2.2) + m.numPx * 1.8);
    tb.xs.push(t.placed.body.x + t.placed.body.w); tb.ws.push(w); tb.heads.push(v.head);
    t.placed.body.w += w; t.placed.rect.w += w;
    t.vals!.forEach((r) => r.push(NaN)); t.full!.forEach((r) => r.push(NaN)); tb.filled.forEach((r) => r.push(false));
  } else if (v.head) tb.heads[j] = v.head;
  // Every value now (rows read the cells to their left and the row above, as they will be shown).
  const full = t.full!;
  for (let r = 0; r < R; r++) full[r][j] = fn(rowEnv(t, full, r));
  // A wider table holds more room in its section.
  roomMoved(t, env);
  // Its calc line under the table, room for the longest row: one live line per table, rewritten by
  // every column (a second column's working replaces the first's, never stacks under it).
  const x = t.placed.body.x;
  const maxW = 1000 - m.margin - x;
  const exps = full.map((_, r) => rowExp(v, fn, full, r, t.dp));
  const lines = Math.max(1, ...exps.map((e) => wrapPieces(piecesOf(e, shown(tb.heads[j])), maxW, (s) => m.u(textWidth(s, m.numPx))).length));
  const textW = Math.min(maxW, Math.max(...exps.map((e) => m.u(textWidth(piecesOf(e, shown(tb.heads[j])).join(''), m.numPx)))));
  const prev = t.el.colCalc ? store.get(t.el.colCalc as string) : undefined;
  let cb: Block;
  if (prev?.calc) {
    cb = prev;
    cb.placed.body.w = cb.placed.rect.w = Math.max(cb.placed.body.w, textW);
    cb.placed.body.h = cb.placed.rect.h = Math.max(cb.placed.body.h, lines * m.num * 1.55);
    cb.calc = { ...cb.calc!, label: shown(tb.heads[j]), lines: Math.max(cb.calc!.lines ?? 1, lines) };
    roomMoved(cb, env);
  } else {
    const others = store.inRegion(t.region).filter((o) => o !== t);
    const below = (o: Block) => o.placed.rect.y >= t.placed.rect.y + t.placed.rect.h - 1;
    const scene = sceneOf(env, t.region);
    // A plain section: under the table and whatever already sits under it. A scene: right under the
    // table when that is clear of every claim, else wherever the scene finds room below it.
    const yBelow = scene ? t.placed.rect.y + t.placed.rect.h : Math.max(t.placed.rect.y + t.placed.rect.h, ...others.filter(below).map((o) => o.placed.rect.y + o.placed.rect.h));
    let body = { x, y: yBelow + m.gap * 0.7, w: textW, h: lines * m.num * 1.55 };
    if (scene) body = clearOf(t, body, scene, m, env);
    cb = newBlock(store.anonId(), 'calc', t.region, { body, rect: { ...body } }, m, []);
    cb.calc = { of: [], reduce: 'sum', live: true, label: shown(tb.heads[j]), lines, maxW };
    if (t.shift) cb.shift = { ...t.shift };
    store.add(cb);
    claimRoom(cb, env);
    t.el.colCalc = cb.id;
  }
  grow(env, t.region, cb.placed.rect);
  const c = col(), accent = env.settings.inkColor;
  const dur = v.dur;
  return {
    target: tgtOf(t), bbox: union([t.placed.rect, cb.placed.rect]),
    draw: async (signal) => {
      await t.ready;
      if (!cb.g) cb.g = svg(t.g!.parentNode as SVGGElement, 'g', { class: 'kit-block', 'data-kit': 'calc' });
      cb.markReady();
      const e = t.el.table as TableEls;
      // A new column's header and cells.
      if (!e.heads[j]) {
        e.heads[j] = kitText(e.heads[0].parentNode as SVGGElement, tb.xs[j] + tb.ws[j] / 2, t.placed.body.y - tb.hh / 2, shown(v.head), { size: m.label, fill: c.ink2 });
        const rule = (e.heads[0].parentNode as SVGGElement).querySelector('line');
        rule?.setAttribute('x2', String(t.placed.body.x + t.placed.body.w));
        e.texts.forEach((row, r) => { const cell = tabCell(t, r, j); row[j] = kitText(e.rows, cell.x + cell.w / 2, cell.y + cell.h / 2, '', { size: m.num, fill: c.ink }); });
      } else e.heads[j].textContent = shown(tb.heads[j]);
      let first!: () => void;
      const started = new Promise<void>((r) => { first = r; });
      void store.anim.run([t.id], async (ctl) => {
        if (signal.aborted) ctl.ff = true;
        const slot = C.sweepStepMs(R, dur ?? Math.min(6, Math.max(1.5, R * 0.7)));
        const hl = svg(e.over, 'rect', { x: t.placed.body.x, y: t.placed.body.y, width: t.placed.body.w, height: tb.rh, fill: accent, 'fill-opacity': 0.08, rx: px(t, 3), opacity: 0 });
        for (let r = 0; r < R; r++) {
          const t0 = performance.now();
          if (r === 0) first();
          const y0 = Number(hl.getAttribute('y')), y1 = t.placed.body.y + r * tb.rh;
          if (r === 0) { hl.setAttribute('y', String(y1)); await tween(ctl.ff ? 0 : 150, (k) => hl.setAttribute('opacity', String(k)), ctl); }
          else await tween(Math.min(GLIDE_MS, slot * 0.35), (k) => hl.setAttribute('y', String(y0 + (y1 - y0) * k)), ctl);
          t.vals![r][j] = full[r][j];
          tb.filled[r][j] = true;
          paintTable(t, c, accent, [r, j]);
          await drawCalc(cb, store, c, env, { speed: 1, fadeMs: 0 }, false, exps[r]);
          await refreshDeps([t.id], store, Math.min(slot * 0.6, 360), ctl, env, c);
          await pause(slot - (performance.now() - t0), ctl);
        }
        first();
        paintTable(t, c, accent, null);
        // The newest point goes back to ink with the row highlight.
        for (const d of store.dependents(t.id)) if (d.kind === 'scatter' && d.el.scatter) (d.el.scatter as ScatterEls).pts.forEach((el) => { if (!el.hasAttribute('data-off')) setAttrs(el, ptLook(d, c)); });
        await tween(ctl.ff ? 0 : 260, (k) => hl.setAttribute('opacity', String(1 - k)), ctl);
        hl.remove();
        (cb.el.text as SVGElement | undefined)?.setAttribute('opacity', '0.5');
      }).finally(() => first());
      await Promise.race([started, new Promise((r) => setTimeout(r, 400))]);
    },
  };
}

/** Row r's expansion of a column fn: the fn with the row's values substituted, and its value. */
function rowExp(v: { fn: string }, fn: import('../expr').VarFn, full: C.Mat, r: number, dp?: number): C.Expansion {
  const env = rowEnv({} as Block, full, r);
  const value = fn(env);
  const div = Number.isFinite(value) ? C.divisionStep(v.fn, env, ROW_VARS, dp) : null;
  return { parts: [C.substitute(v.fn, env, dp), ' = ', ...(div ? [div] : [])], result: Number.isFinite(value) ? C.fmt(value, dp) : '—', value };
}

/** A reference line at a value: across bars, a scatter (y = at), or between a table column's rows where it crosses. */
async function levelVerb(v: Extract<KitVerb, { kind: 'level' }>, env: BuildEnv, store: KitStore): Promise<ElementPlan | string> {
  const b = await store.wait(v.ref);
  if (!b) return `unknown block ${v.ref}`;
  let y: number, x0: number, x1: number;
  const { body } = b.placed, m = b.m;
  if (b.kind === 'bars' && b.view === 'line') {
    const pl = b.plot!;
    if (v.at < pl.dom.y0 || v.at > pl.dom.y1) return 'level outside the plot';
    y = linePt(pl, pl.dom.x0, v.at).y; x0 = pl.host.placed.body.x; x1 = x0 + pl.host.placed.body.w;
  } else if (b.kind === 'bars') {
    const gr = b.group!, span = gr.pos + gr.neg || 1;
    y = baseY(b) - (v.at * body.h) / span; x0 = body.x - px(b, 6); x1 = body.x + body.w + px(b, 6);
  } else if (b.kind === 'scatter') {
    const d = b.dom!;
    if (v.at < d.y0 || v.at > d.y1) return 'level outside the plot';
    y = toPlot(b, { x: d.x0, y: v.at }).y; x0 = body.x; x1 = body.x + body.w;
  } else if (b.kind === 'table' && v.col != null) {
    const col0 = b.full!.map((r) => r[v.col!]);
    let k = -1;
    for (let r = 0; r + 1 < col0.length; r++) {
      const a0 = col0[r] - v.at, a1 = col0[r + 1] - v.at;
      if (Number.isFinite(a0) && Number.isFinite(a1) && a0 * a1 < 0) { k = r; break; }
    }
    if (k < 0) return 'the column never crosses that value';
    y = body.y + (k + 1) * b.tab!.rh; x0 = body.x; x1 = body.x + body.w;
  } else return 'level: bars, a scatter or a table column';
  const accent = env.settings.inkColor;
  const labelW = v.label ? m.u(textWidth(v.label, m.labelPx)) + m.label : 0;
  return {
    target: tgtOf(b), bbox: { x: x0, y: y - m.label, w: x1 - x0 + labelW, h: 2 * m.label },
    draw: async (_s, k) => {
      await b.ready;
      const g = svg(b.g!, 'g');
      const ln = svg(g, 'line', { x1: x0, x2: x0, y1: y, y2: y, stroke: accent, 'stroke-dasharray': '5 4', ...hair(1.5) });
      if (v.label) kitText(g, x1 + m.label * 0.5, y, v.label, { size: m.label, fill: accent, anchor: 'start', halo: col().halo });
      env.registry.define({ kind: 'kit-level', target: tgtOf(b), bbox: { x: x0, y: y - m.label, w: x1 - x0 + labelW, h: 2 * m.label }, boxes: [{ x: x1, y: y - m.label, w: labelW, h: 2 * m.label }], anchor: { x: x1, y }, group: g });
      await tween(k.fadeMs != null ? 0 : 380 * k.speed, (t) => ln.setAttribute('x2', String(x0 + (x1 - x0) * t)));
    },
  };
}

/**
 * Names a where= condition may use besides x (the value), r, c and i (its row, column, index): the
 * answer's constants, its readouts ({{find}} E is its value) and one-value blocks (a calc's result),
 * so a highlight selects by the engine's own threshold (`where="x<=q"`), never by hand.
 */
function whereVars(store: KitStore): Record<string, number> {
  const out: Record<string, number> = { ...store.consts };
  for (const id of store.finds.keys()) { const r = store.reading(id); if (typeof r !== 'string' && Number.isFinite(r.v)) out[id.toLowerCase()] = r.v; }
  for (const b of store.all()) {
    const e = b.kind === 'calc' && b.calc && !b.calc.win && !b.calc.live ? calcExpansion(b.calc, store, b.dp) : null;
    const xs = e && typeof e !== 'string' ? [e.value] : b.vals?.flat();
    if (b.kind !== 'table' && xs?.length === 1 && Number.isFinite(xs[0])) out[b.id.toLowerCase()] = xs[0];
  }
  for (const k of ['x', 'r', 'c', 'i']) delete out[k];
  return out;
}

/** emph where="x==7": every matching cell of a grid or table (counted out one by one), bar or share part. */
async function emphWhere(a: Extract<RefAction, { kind: 'emph' }>, env: BuildEnv, store: KitStore): Promise<ElementPlan | string> {
  const b = await store.wait(a.ref);
  if (!b || (b.kind !== 'grid' && b.kind !== 'table' && b.kind !== 'bars' && b.kind !== 'shares')) return 'where: a grid, a table, bars or shares';
  const fn = formula(a.where!, ['x', 'r', 'c', 'i'], whereVars(store));
  if (!fn) return 'bad where';
  const hits: [number, number][] = [];
  b.vals!.forEach((row, r) => row.forEach((x, q) => { if (Number.isFinite(x) && fn({ x, r: r + 1, c: q + 1, i: q + 1 })) hits.push([r, q]); }));
  if (!hits.length) return 'no cell matches';
  const accent = env.settings.inkColor;
  if (b.kind === 'bars' || b.kind === 'shares') return emphWhereVector(b, hits.map(([, q]) => q), accent);
  return {
    target: tgtOf(b), bbox: b.placed.rect,
    draw: async (_s, k) => {
      await b.ready;
      const over = b.kind === 'grid' ? (b.el.grid as GridEls).over : (b.el.table as TableEls).over;
      (b.el.where as SVGGElement | undefined)?.remove();
      const prev = (b.el.whereHits as [number, number][] | undefined) ?? [];
      b.el.whereHits = hits;
      const c = col();
      for (const [r, q] of prev) {
        if (b.kind === 'grid') restCell(b, r, q, c, accent);
        else setAttrs((b.el.table as TableEls).texts[r][q], { fill: c.ink, 'font-weight': 400 });
      }
      const g = svg(over, 'g');
      b.el.where = g;
      const each = k.fadeMs != null || prefersReducedMotion() ? 0 : Math.min(120, 1400 / hits.length) * k.speed;
      for (const [r, q] of hits) {
        const box = b.kind === 'grid' ? cellBox(b, r, r, q, q) : tabCell(b, r, q);
        svg(g, 'rect', { x: box.x, y: box.y, width: box.w, height: box.h, fill: accent, 'fill-opacity': 0.16 });
        const tx = b.kind === 'grid' ? (b.el.grid as GridEls).texts[r][q] : (b.el.table as TableEls).texts[r][q];
        setAttrs(tx, { fill: accent, 'font-weight': 600 });
        await pause(each);
      }
    },
  };
}

/** where= on a vector: exactly the matching bars (points on a line, parts of a share) take the accent; an earlier where's marks go. */
function emphWhereVector(b: Block, hits: number[], accent: string): ElementPlan {
  return {
    target: tgtOf(b), bbox: b.placed.rect,
    draw: async (_s, k) => {
      await b.ready;
      const c = col();
      const prev = (b.el.whereIdx as number[] | undefined) ?? [];
      b.el.whereIdx = hits;
      const each = k.fadeMs != null || prefersReducedMotion() ? 0 : Math.min(120, 1400 / hits.length) * k.speed;
      if (b.kind === 'shares') {
        const e = b.el.shares as ShareEls;
        prev.forEach((i) => e.em.delete(i));
        for (const i of hits) { e.em.add(i); paintShares(b, c, accent); await pause(each); }
        paintShares(b, c, accent);
        return;
      }
      if (b.view === 'line') {
        const e = b.el.line as LineEls;
        (b.el.whereRings as SVGGElement | undefined)?.remove();
        const g = svg(e.rings, 'g');
        b.el.whereRings = g;
        prev.forEach((i) => e.dots[i]?.setAttribute('fill', lineColor(b, c, accent)));
        for (const i of hits) {
          const q = linePt(b.plot!, b.xs![i], b.vals![0][i]);
          svg(g, 'circle', { cx: q.x, cy: q.y, r: px(b, 7), fill: 'none', stroke: accent, ...hair(1.6) });
          e.dots[i]?.setAttribute('fill', accent);
          await pause(each);
        }
        return;
      }
      const e = b.el.bars as BarEls;
      for (const i of prev) { e.emBars.delete(i); e.bars[i]?.setAttribute('fill', c.bar); e.vals[i]?.setAttribute('fill', c.ink); }
      for (const i of hits) { e.emBars.add(i); e.bars[i]?.setAttribute('fill', accent); e.vals[i]?.setAttribute('fill', accent); await pause(each); }
    },
  };
}

// ------------------------------------------------------------------------------------------------
// shares: one bar split into parts that sum to 1 (Board v2); a blend shows the values mixed in them.

type ShareEls = { segs: SVGRectElement[]; labs: SVGTextElement[]; pcts: SVGTextElement[]; mix: SVGTextElement | null; em: Set<number> };

/** Labels for a share's parts from its source: a bars block's labels, or a table's rows (none otherwise). */
function sourceLabels(src: KitSource, store: KitStore): string[] | undefined {
  const id = 'op' in src ? src.of[0] : 'map' in src ? src.map : undefined;
  const b = id ? store.get(id) : undefined;
  return (b?.el.labels as string[] | undefined) ?? undefined;
}

/** Segment i's box: widths in proportion to the shares. */
function shareSeg(b: Block, i: number): Box {
  const { body } = b.placed, vs = b.vals![0];
  let x = body.x;
  for (let j = 0; j < i; j++) x += vs[j] * body.w;
  return { x, y: body.y, w: vs[i] * body.w, h: body.h };
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

function paintShares(b: Block, c: ReturnType<typeof col>, accent: string) {
  const e = b.el.shares as ShareEls, m = b.m, vs = b.vals![0];
  const big = vs.indexOf(Math.max(...vs));
  let up = false;
  vs.forEach((v, i) => {
    const r = shareSeg(b, i);
    const em = e.em.has(i);
    // Shades alternate so neighbouring parts read apart; an emphasised part takes the accent.
    setAttrs(e.segs[i], { x: r.x, y: r.y, width: Math.max(0, r.w), height: r.h, fill: em ? accent : i % 2 ? c.cell : c.bar, 'fill-opacity': em ? 0.85 : i % 2 ? 1 : 0.55 + 0.35 * (i === big ? 1 : 0) });
    const lab = (b.el.labels as string[] | undefined)?.[i];
    const inside = r.w > m.u(textWidth(`${lab ?? ''} ${pct(v)}`, m.labelPx)) + m.label * 0.6;
    // A part too thin for its words labels itself above or below the bar, alternating, so neighbours never collide.
    const y = inside ? r.y + r.h / 2 : (up = !up) ? r.y - m.label * 0.75 : r.y + r.h + m.label * 0.8;
    setAttrs(e.labs[i], { x: r.x + r.w / 2, y, fill: em ? (inside ? '#fff' : accent) : inside && i % 2 === 0 && v > 0.15 ? c.ink : c.ink2, 'font-size': m.label * (v < 0.03 ? 0.85 : 1) });
    e.labs[i].textContent = v < 0.005 ? '' : lab ? `${lab} ${pct(v)}` : pct(v);
  });
}

async function drawShares(b: Block, store: KitStore, c: ReturnType<typeof col>, k: Pace) {
  const g = b.g!, { body } = b.placed, m = b.m, n = b.vals![0].length;
  const frame = svg(g, 'rect', { x: body.x, y: body.y, width: body.w, height: body.h, fill: 'none', stroke: c.edge, rx: m.u(3), ...hair(1) });
  const segG = svg(g, 'g'), labG = svg(g, 'g');
  const segs: SVGRectElement[] = [], labs: SVGTextElement[] = [];
  for (let i = 0; i < n; i++) { segs.push(svg(segG, 'rect', { x: body.x, y: body.y, width: 0, height: body.h, stroke: '#fff', ...hair(1) })); labs.push(kitText(labG, body.x, body.y, '', { size: m.label, fill: c.ink })); }
  segG.insertBefore(frame, null);
  const cap = b.el.caption as string | undefined;
  if (cap) caption(labG, body.x + body.w / 2, body.y + body.h + m.label * 2.2, cap, m, c);
  const mix = b.el.mix ? kitText(labG, body.x + body.w + m.gap * 0.5, body.y + body.h / 2, '', { size: m.num, fill: (b.el.accent as string | undefined) ?? c.ink, anchor: 'start' }) : null;
  b.el.shares = { segs, labs, pcts: [], mix, em: new Set() } satisfies ShareEls;
  const target = b.vals!.map((r) => r.slice());
  b.vals = [target[0].map(() => 1 / n)];
  await setShares(b, target, store, k.fadeMs != null ? 0 : 520 * k.speed, undefined, c);
}

/** The blend's result: Σ share × value of the mixed block. */
function mixValue(b: Block, store: KitStore): number {
  const v = store.get(b.el.mix as string)?.vals?.flat() ?? [];
  const w = b.vals![0];
  return v.length === w.length ? w.reduce((s, x, i) => s + x * v[i], 0) : NaN;
}

async function setShares(b: Block, next: C.Mat, store: KitStore, ms: number, ctl: Ctl | undefined, c: ReturnType<typeof col>) {
  const from = b.vals![0].slice(), to = next[0];
  const e = b.el.shares as ShareEls | undefined;
  b.full = next.map((r) => r.slice());
  if (!e) { b.vals = next.map((r) => r.slice()); return; }
  const accent = (b.el.accent as string | undefined) ?? c.ink;
  await tween(ms, (t) => {
    b.vals = [to.map((v, i) => from[i] + (v - from[i]) * t)];
    paintShares(b, c, accent);
    if (e.mix) e.mix.textContent = `= ${C.fmt(mixValue(b, store), b.dp ?? 2)}`;
  }, ctl);
  b.vals = next.map((r) => r.slice());
  paintShares(b, c, accent);
  if (e.mix) e.mix.textContent = `= ${C.fmt(mixValue(b, store), b.dp ?? 2)}`;
  store.notify(b.id);
}

setKitResolver(async (ref, r) => {
  const res = await resolvePart(ref, r);
  return typeof res === 'string' ? null : worldBox(res.b, res.box);
});

// ------------------------------------------------------------------------------------------------
// Demonstration moves (gated beats, step 2): a constant changes and everything drawn from it follows.
// contrast is expanded by the parser into a copy of the plot / block (src/gate/engine.ts expand).

type MoveV = Extract<RefAction, { kind: 'limit' | 'beforeafter' }>;
/** Default duration of a limit sweep (s). */
export const LIMIT_S = 3;

/** Plots drawn from the answer's constants that follow `key` (a contrast's copy that fixed it does not). */
const constPlots = (store: KitStore, key: string) => store.all().filter((b) => {
  const src = b.el.plotSrc as Extract<DrawAction, { kind: 'plot' }> | undefined;
  return !!src && !(src.with && key in src.with);
});
/** Computed blocks (a contrast's copy that fixed `key` keeps its own). */
const constBlocks = (store: KitStore, key: string) => store.all().filter((b) => b.src && !('vals' in b.src) && b.kind !== 'scatter' && (b.el.with as Record<string, number> | undefined)?.[key] == null);

/** Resamples a plot with the current constants; null when it no longer evaluates. */
function resample(b: Block, store: KitStore): { xs: number[]; ys: number[] } | null {
  const src = b.el.plotSrc as Extract<DrawAction, { kind: 'plot' }>;
  const got = samplePlot(src, withConsts(store.consts, src.with));
  return typeof got === 'string' ? null : got;
}

/** The plot domain that holds every member's values (and ghosts) for the constant at each of `vs`. */
function domFor(pl: Plot, store: KitStore, key: string, vs: number[]): Plot['dom'] {
  const keep = store.consts[key];
  const members: { xs: number[]; ys: number[] }[] = [];
  for (const v of vs) {
    store.setConst(key, v);
    for (const b of pl.members) { const s = b.el.plotSrc ? resample(b, store) : null; members.push(s ?? { xs: b.xs!, ys: b.vals![0] }); }
  }
  store.setConst(key, keep);
  for (const b of pl.members) if (b.ghost) members.push({ xs: (b.el.ghostXs as number[] | undefined) ?? b.xs!, ys: b.ghost });
  return domOf(members.filter((m) => m.ys.some(Number.isFinite)));
}

const valueOf = (src: string, consts: Record<string, number>) => { const f = formula(src, [], consts); return f ? f({}) : NaN; };

/** The readout above the watched block: the input's value (and a named readout's), live. */
function moveReadout(w: Block, text: string, c: ReturnType<typeof col>, accent: string): SVGTextElement {
  const host = w.plot?.host ?? w, m = host.m, { body } = host.placed;
  (host.el.moveReadout as SVGElement | undefined)?.remove();
  // On a slide's chart the space above the plot holds the slide's own curve labels: inside its top-left corner instead.
  const t = w.plot?.fixed
    ? kitText(host.g!, body.x + m.label * 0.8, body.y + m.label * 0.9, text, { size: m.num, fill: accent, anchor: 'start', halo: c.halo })
    : kitText(host.g!, body.x + body.w, body.y - m.label * 1.0, text, { size: m.num, fill: accent, anchor: 'end', halo: c.halo });
  host.el.moveReadout = t;
  return t;
}

/** limit: the constant sweeps to its new value; every plot and computed block drawn from it follows, with a live readout. */
async function limitMove(v: Extract<MoveV, { kind: 'limit' }>, env: BuildEnv, store: KitStore): Promise<ElementPlan | string> {
  const [name, src] = v.set, key = name.toLowerCase();
  if (!(key in store.consts)) return `no constant ${name}`;
  const w = await store.wait(v.ref);
  if (!w) return `unknown ${v.ref}`;
  const from = store.consts[key], to = valueOf(src, store.consts);
  if (!Number.isFinite(to)) return `bad value ${src}`;
  const plots = constPlots(store, key), blocks = constBlocks(store, key);
  if (!plots.length && !blocks.length) return `nothing is drawn from ${name}`;
  const c = col(), accent = env.settings.inkColor;
  const host = w.plot?.host ?? w;
  const label = (x: number) => {
    const r = v.show ? store.reading(v.show) : null;
    return `${name} = ${C.fmt(x)}${r && typeof r !== 'string' ? ` · ${v.show} = ${C.fmt(r.v)}` : ''}`;
  };
  return {
    target: tgtOf(host), bbox: host.placed.rect,
    draw: async (signal) => {
      await w.ready;
      let first!: () => void;
      const started = new Promise<void>((r) => { first = r; });
      const ids = [...plots, ...blocks].map((b) => b.id).concat(`const:${key}`);
      void store.anim.run(ids, async (ctl) => {
        if (signal.aborted) ctl.ff = true;
        const t = moveReadout(w, label(from), c, accent);
        // One frame for the whole sweep: the axes settle first, so the curves move on fixed axes.
        const pls = [...new Set(plots.map((b) => b.plot!))];
        const vs = Array.from({ length: 13 }, (_, i) => from + ((to - from) * i) / 12);
        for (const pl of pls) {
          if (pl.fixed) continue; // the slide's own axes
          const old = pl.dom, d = domFor(pl, store, key, vs);
          await tween(prefersReducedMotion() ? 0 : 280, (k) => {
            pl.dom = { x0: old.x0 + (d.x0 - old.x0) * k, x1: old.x1 + (d.x1 - old.x1) * k, y0: old.y0 + (d.y0 - old.y0) * k, y1: old.y1 + (d.y1 - old.y1) * k };
            if (pl.axes) drawPlotAxes(pl, c);
            for (const b of pl.members) paintLine(b, b.vals![0], c);
          }, ctl);
        }
        first();
        let last = 0;
        const frame = (x: number, force = false) => {
          store.setConst(key, x);
          store.constsChanged();
          for (const b of plots) { const s = resample(b, store); if (s) { b.xs = s.xs; b.vals = [s.ys]; b.full = [s.ys.slice()]; paintLine(b, s.ys, c); } }
          for (const pl of pls) void placeReadoutPts(pl, store);
          const now = performance.now();
          if (blocks.length && (force || now - last > 90)) { last = now; void refreshBlocks(blocks, store, 0, undefined, env, c); }
          t.textContent = label(x);
        };
        await tween(ctl.ff ? 0 : (v.dur ?? LIMIT_S) * 1000, (k) => frame(from + (to - from) * k), ctl);
        frame(to, true);
        for (const pl of pls) spreadLabels(pl);
        plots.forEach((b) => store.notify(b.id));
      }).finally(() => first());
      await Promise.race([started, new Promise((r) => setTimeout(r, 600))]);
    },
  };
}

/** Default duration of one leg of a tween (s). */
export const TWEEN_S = 3;
const EASE = { linear: (t: number) => Math.min(1, Math.max(0, t)), inout: easeInOut, out: easeOut } as const;

/**
 * tween: constants glide to new values (TweenAction). Each frame every plot and computed block drawn
 * from the constants repaints and live geometry re-resolves (KitStore.constsChanged); `repeat` and
 * `yoyo` make it an oscillation. Never blocks the narration: draw resolves once the motion is under way.
 */
async function tweenMove(v: Extract<RefAction, { kind: 'tween' }>, env: BuildEnv, store: KitStore): Promise<ElementPlan | string> {
  const keys = v.sets.map(([k]) => k.toLowerCase());
  const missing = v.sets.find(([k]) => !(k.toLowerCase() in store.consts));
  if (missing) return `no constant ${missing[0]}`;
  const from = keys.map((k) => store.consts[k]);
  const to = v.sets.map(([, src]) => valueOf(src, store.consts));
  const bad = to.findIndex((x) => !Number.isFinite(x));
  if (bad >= 0) return `bad value ${v.sets[bad][1]}`;
  const plots = [...new Set(keys.flatMap((k) => constPlots(store, k)))], blocks = [...new Set(keys.flatMap((k) => constBlocks(store, k)))];
  const live = store.liveBox?.(keys) ?? store.svgBox?.(keys) ?? null;
  if (!plots.length && !blocks.length && !live) return `nothing is drawn from ${v.sets.map(([k]) => k).join(', ')}`;
  const host = plots[0]?.plot?.host ?? plots[0] ?? blocks[0];
  const c = col();
  return {
    target: live ? live.target : tgtOf(host!), bbox: live ? live.bbox : host!.placed.rect,
    draw: async (signal) => {
      let first!: () => void;
      const started = new Promise<void>((r) => { first = r; });
      void store.anim.run(keys.map((k) => `const:${k}`), async (ctl) => {
        if (signal.aborted) ctl.ff = true;
        const pls = [...new Set(plots.map((b) => b.plot!))];
        first();
        let last = 0;
        const frame = (k: number, force = false) => {
          keys.forEach((key, i) => store.setConst(key, from[i] + (to[i] - from[i]) * k));
          for (const b of plots) { const s = resample(b, store); if (s) { b.xs = s.xs; b.vals = [s.ys]; b.full = [s.ys.slice()]; paintLine(b, s.ys, c); } }
          for (const pl of pls) void placeReadoutPts(pl, store);
          const now = performance.now();
          if (blocks.length && (force || now - last > 90)) { last = now; void refreshBlocks(blocks, store, 0, undefined, env, c); }
          store.constsChanged();
        };
        const legs = (v.repeat ?? 1) * (v.yoyo ? 2 : 1), ms = (v.dur ?? TWEEN_S) * 1000;
        for (let leg = 0; leg < legs && !ctl.ff; leg++) {
          const back = !!v.yoyo && leg % 2 === 1;
          await tween(ms, (t) => frame(back ? 1 - t : t), ctl, EASE[v.ease ?? 'inout']);
        }
        frame(v.yoyo ? 0 : 1, true);
        for (const pl of pls) spreadLabels(pl);
        plots.forEach((b) => store.notify(b.id));
      }).finally(() => first());
      await Promise.race([started, new Promise((r) => setTimeout(r, 600))]);
    },
  };
}

/** beforeafter: the constant changes; the watched plot or block keeps its old state as a dashed ghost and the difference is marked. */
async function beforeAfter(v: Extract<MoveV, { kind: 'beforeafter' }>, env: BuildEnv, store: KitStore): Promise<ElementPlan | string> {
  const [name, src] = v.set, key = name.toLowerCase();
  if (!(key in store.consts)) return `no constant ${name}`;
  const w = await store.wait(v.ref);
  if (!w) return `unknown ${v.ref}`;
  const from = store.consts[key], to = valueOf(src, store.consts);
  if (!Number.isFinite(to)) return `bad value ${src}`;
  const plots = constPlots(store, key), blocks = constBlocks(store, key);
  if (!plots.includes(w) && !blocks.includes(w)) return `${v.ref} is not drawn from ${name}`;
  const c = col(), accent = env.settings.inkColor;
  const host = w.plot?.host ?? w;
  return {
    target: tgtOf(host), bbox: host.placed.rect,
    draw: async (signal, k) => {
      await w.ready;
      const ms = signal.aborted || k.fadeMs != null ? 0 : SET_MS * 1.4;
      await store.anim.run([...plots, ...blocks].map((b) => b.id), async (ctl) => {
        if (signal.aborted) ctl.ff = true;
        const before = w.vals!.map((r) => r.slice()), beforeXs = w.xs?.slice();
        // On a slide's chart the curve that changes is the one in ink (traced curves are drawn in any order).
        if (w.plot?.fixed && w.plot.members.includes(w)) { const ms = w.plot.members; ms.splice(ms.indexOf(w), 1); ms.push(w); recolorLines(w.plot, c, accent); }
        // The snapshot: the watched thing's old state stays, dashed and muted.
        w.ghost = before[0].slice();
        if (beforeXs) w.el.ghostXs = beforeXs;
        store.setConst(key, to);
        store.constsChanged();
        const jobs: Promise<void>[] = [];
        for (const b of plots) { const s = resample(b, store); if (s) { b.xs = s.xs; b.full = [s.ys.slice()]; jobs.push(setLineVals(b, [s.ys], ms, ctl, c)); } }
        if (blocks.length) jobs.push(refreshBlocks(blocks, store, ms, ctl, env, c));
        for (const pl of new Set(plots.map((b) => b.plot!))) jobs.push(Promise.resolve(placeReadoutPts(pl, store, ms, ctl)));
        await Promise.all(jobs);
        const m = host.m;
        (w.el.diff as SVGElement | undefined)?.remove();
        const g = svg(host.g!, 'g');
        w.el.diff = g;
        if (w.view === 'line' && w.plot) {
          // The difference: the band between the old and the new curve.
          const ys = w.vals![0], xs = w.xs!, gx = beforeXs ?? xs;
          const same = gx.length === xs.length && gx.every((x, i) => Math.abs(x - xs[i]) < 1e-9);
          if (same) {
            const ok = xs.map((_, i) => Number.isFinite(ys[i]) && Number.isFinite(before[0][i]));
            const top = xs.flatMap((x, i) => (ok[i] ? [linePt(w.plot!, x, ys[i])] : []));
            const bot = xs.flatMap((x, i) => (ok[i] ? [linePt(w.plot!, x, before[0][i])] : []));
            const pts = [...top, ...bot.reverse()];
            if (pts.length > 3) {
              const band = svg(g, 'polygon', { points: pts.map((p) => `${p.x},${p.y}`).join(' '), fill: accent, 'fill-opacity': 0, stroke: 'none' });
              g.parentNode?.insertBefore(g, g.parentNode.firstChild);
              const op = w.plot.fixed ? 0.09 : 0.13; // lighter over a slide's own shading
              await tween(ms ? 320 : 0, (t) => band.setAttribute('fill-opacity', String(op * t)), ctl);
            }
          }
          // The ghost is named by the old value, at its end (on a slide's chart the curve ends hold the
          // slide's own labels, and the readout already says old → new).
          let i = before[0].length - 1;
          while (i > 0 && !Number.isFinite(before[0][i])) i--;
          const p = linePt(w.plot, gx[i], before[0][i]);
          if (!w.plot.fixed) kitText(host.g!, p.x + m.label * 0.5, p.y + m.label * 1.1, v.text ?? `${name} = ${C.fmt(from)}`, { size: m.label, fill: c.muted, anchor: 'start', halo: c.halo });
          spreadLabels(w.plot);
        } else if (w.kind === 'grid' && w.el.grid) {
          // The cells that changed, tinted.
          w.vals!.forEach((row, r) => row.forEach((x, q) => {
            if (Math.abs(x - before[r]?.[q]) > 1e-9) { const b = cellBox(w, r, r, q, q); svg(g, 'rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill: accent, 'fill-opacity': 0.16 }); }
          }));
        } else if (w.kind === 'bars' && w.el.bars) {
          // Ghost bars show the old values; the changed ones are accented.
          const e = w.el.bars as BarEls;
          w.vals![0].forEach((x, i) => { if (Math.abs(x - before[0][i]) > 1e-9) e.emBars.add(i); });
          await setBarVals(w, w.vals!, 0, ctl, c);
        }
        moveReadout(w, `${name}: ${C.fmt(from)} → ${C.fmt(to)}`, c, accent);
      });
    },
  };
}

// ------------------------------------------------------------------------------------------------
// Readout points: {{point on=s at=E "label"}} where E is a {{find}}. The kit draws them on the plot's
// own layer (a dot, faint drop lines to both axes, the label beside it) and re-places them whenever
// the plot redraws: a widened axis, a limit sweep, a beforeafter. They always sit where E is now.

type ReadoutPt = { ref: string; dot: SVGCircleElement; drops: SVGPathElement; label: SVGTextElement | null; at: { x: number; y: number } | null; /** The label's width (units) and where it sits now. */ lw?: number; side?: number; box?: Box };

/** Whether a region point names a readout (`at=E`). */
export function isReadoutPoint(a: InkAction, registry: Registry): boolean {
  const at = (a as { at?: { ref?: string } }).at;
  const onBoard = (a as { region?: string }).region != null || !!(a as { onChart?: unknown }).onChart;
  return a.kind === 'point' && onBoard && !!at && typeof at === 'object' && 'ref' in at && !!at.ref && kitStore(registry).finds.has(at.ref);
}

function readoutXY(store: KitStore, ref: string): { pl: Plot; x: number; y: number } | null {
  const rd = store.finds.get(ref), pb = rd ? store.get(rd.of[0]) : undefined;
  const r = store.reading(ref);
  if (!pb?.plot || typeof r === 'string' || !r.point) return null;
  const p = linePt(pb.plot, r.x, r.y);
  return { pl: pb.plot, x: p.x, y: p.y };
}

function paintReadoutPt(o: ReadoutPt, pl: Plot, x: number, y: number) {
  const { body } = pl.host.placed, m = pl.host.m;
  setAttrs(o.dot, { cx: x, cy: y });
  // Drop lines to the axes: where the reading is on each scale.
  const inside = x >= body.x - 1 && x <= body.x + body.w + 1 && y >= body.y - 1 && y <= body.y + body.h + 1;
  o.drops.setAttribute('d', inside ? `M${body.x} ${y}H${x}V${body.y + body.h}` : '');
  o.at = { x, y };
  if (o.label) {
    const at = readoutLabelAt(o, pl, x, y, inside);
    setAttrs(o.label, { x: at.x, y: at.y, 'text-anchor': at.anchor });
  }
}

/** Where a readout point's label goes around it: NE first; then the side that touches the fewest strokes (its plot's lines, its own drop lines, other readout labels) and, on a slide's chart, the least of what the slide painted (its printed labels and curves). */
const LABEL_SIDES: { dx: number; dy: number; anchor: 'start' | 'end' | 'middle' }[] = [
  { dx: 0.55, dy: -0.75, anchor: 'start' }, { dx: -0.55, dy: -0.75, anchor: 'end' }, { dx: 0.55, dy: 0.95, anchor: 'start' }, { dx: -0.55, dy: 0.95, anchor: 'end' },
  { dx: 0.75, dy: 0, anchor: 'start' }, { dx: -0.75, dy: 0, anchor: 'end' }, { dx: 0, dy: -1.15, anchor: 'middle' }, { dx: 0, dy: 1.3, anchor: 'middle' },
];
function readoutLabelAt(o: ReadoutPt, pl: Plot, x: number, y: number, drops: boolean): { x: number; y: number; anchor: string } {
  const m = pl.host.m, L = m.label, lw = o.lw ?? m.u(textWidth(o.label?.textContent ?? '', m.labelPx));
  const { body } = pl.host.placed;
  const segs: { a: Pt; b: Pt }[] = [];
  for (const b of pl.members) {
    const ys = b.vals?.[0], xs = b.xs;
    if (!ys || !xs) continue;
    let prev: Pt | null = null;
    for (let i = 0; i < ys.length; i++) {
      const p = Number.isFinite(ys[i]) ? linePt(pl, xs[i], ys[i]) : null;
      if (p && prev) segs.push({ a: prev, b: p });
      prev = p;
    }
  }
  if (drops) segs.push({ a: { x: body.x, y }, b: { x, y } }, { a: { x, y }, b: { x, y: body.y + body.h } });
  // A board plot's own axes (and the zero line), and its tick labels left of and under the body.
  if (!pl.fixed) {
    const y0 = pl.dom.y0 < 0 && pl.dom.y1 > 0 ? linePt(pl, pl.dom.x0, 0).y : null;
    segs.push({ a: { x: body.x, y: body.y }, b: { x: body.x, y: body.y + body.h } }, { a: { x: body.x, y: body.y + body.h }, b: { x: body.x + body.w, y: body.y + body.h } }, ...(y0 != null ? [{ a: { x: body.x, y: y0 }, b: { x: body.x + body.w, y: y0 } }] : []));
  }
  const ticks = pl.fixed ? 0 : 1;
  const others = ((pl.host.el.readoutPts as ReadoutPt[] | undefined) ?? []).filter((q) => q !== o && q.box).map((q) => q.box!);
  const ink = pl.fixed ? pageInkOf(pl.host.g) : null;
  let best = 0, bestCost = Infinity, bestBox: Box | null = null;
  LABEL_SIDES.forEach((sd, i) => {
    const ax = x + sd.dx * L, cy = y + sd.dy * L;
    const bx = sd.anchor === 'start' ? ax : sd.anchor === 'end' ? ax - lw : ax - lw / 2;
    const box = { x: bx, y: cy - L * 0.55, w: lw, h: L * 1.1 };
    const hits = segs.filter((sg) => segCrossesBox(sg.a, sg.b, box)).length;
    const outside = ticks && (box.x < body.x || box.y + box.h > body.y + body.h) ? 2 : 0;
    const cost = hits * 3 + outside + inkIn(ink, box) * 12 + others.filter((r) => overlapsBox(r, box, 0)).length * 5 + i * 0.05 - (o.side === i ? 0.04 : 0);
    if (cost < bestCost) { bestCost = cost; best = i; bestBox = box; }
  });
  o.side = best;
  o.box = bestBox!;
  const sd = LABEL_SIDES[best];
  return { x: x + sd.dx * L, y: y + sd.dy * L, anchor: sd.anchor };
}

/** Whether segment a–b passes through box r (an end inside, or crossing one of its edges). */
function segCrossesBox(a: Pt, b: Pt, r: Box): boolean {
  const inR = (p: Pt) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  if (inR(a) || inR(b)) return true;
  const cross = (p: Pt, q: Pt, u: Pt, v: Pt) => {
    const d = (q.x - p.x) * (v.y - u.y) - (q.y - p.y) * (v.x - u.x);
    if (Math.abs(d) < 1e-12) return false;
    const t = ((u.x - p.x) * (v.y - u.y) - (u.y - p.y) * (v.x - u.x)) / d, s2 = ((u.x - p.x) * (q.y - p.y) - (u.y - p.y) * (q.x - p.x)) / d;
    return t >= 0 && t <= 1 && s2 >= 0 && s2 <= 1;
  };
  const c = [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];
  return c.some((u, i) => cross(a, b, u, c[(i + 1) % 4]));
}

/** Re-places a plot's readout points at their readouts now (over `ms`, from where they were). */
function placeReadoutPts(pl: Plot, store: KitStore, ms = 0, ctl?: Ctl): Promise<void> | void {
  const os = (pl.host.el.readoutPts as ReadoutPt[] | undefined) ?? [];
  const moves = os.flatMap((o) => { const p = readoutXY(store, o.ref); return p ? [{ o, from: o.at ?? p, to: p }] : []; });
  if (!moves.length) return;
  if (ms <= 0) { moves.forEach(({ o, to }) => paintReadoutPt(o, pl, to.x, to.y)); return; }
  return tween(ms, (t) => moves.forEach(({ o, from, to }) => paintReadoutPt(o, pl, from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t)), ctl);
}

/** Builds a point at a readout on its plot's axes. */
export async function buildReadoutPoint(a: Extract<InkAction, { kind: 'point' }>, env: BuildEnv): Promise<ElementPlan | string> {
  const store = kitStore(env.registry);
  const ref = (a.at as unknown as { ref: string }).ref;
  const rd = store.finds.get(ref)!;
  const pb = await store.wait(rd.of[0]);
  if (!pb?.plot) return `unknown plot ${rd.of[0]}`;
  await Promise.race([pb.ready, new Promise((r) => setTimeout(r, KIT_WAIT_MS))]);
  const r = store.reading(ref);
  if (typeof r === 'string') return r;
  if (!r.point) return `${ref} is a number, not a point`;
  const pl = pb.plot, host = pl.host, m = host.m;
  const p = linePt(pl, r.x, r.y), rad = px(host, 3.6);
  const text = a.text;
  const lw = text ? m.u(textWidth(text, m.labelPx)) : 0;
  const dot = { x: p.x - rad, y: p.y - rad, w: 2 * rad, h: 2 * rad };
  const lab = text ? { x: p.x + m.label * 0.55, y: p.y - m.label * 1.3, w: lw, h: m.label * 1.1 } : null;
  const c = col(), color = a.em ? env.settings.inkColor : c.ink;
  return {
    target: tgtOf(host), bbox: union([dot, ...(lab ? [lab] : [])]),
    draw: async (_s, k) => {
      await host.ready;
      const g = svg(host.g!, 'g', { opacity: 0 });
      const o: ReadoutPt = {
        ref, at: null,
        drops: svg(g, 'path', { d: '', fill: 'none', stroke: c.muted, 'stroke-dasharray': '3 3', ...hair(1) }),
        dot: svg(g, 'circle', { r: rad, fill: color }),
        label: text ? kitText(g, 0, 0, text, { size: m.label, fill: color, anchor: 'start', halo: c.halo }) : null,
        lw,
      };
      if (o.label && isVarName(text!)) { o.label.setAttribute('font-style', 'italic'); o.label.setAttribute('font-family', 'KaTeX_Math, "STIX Two Math", "Cambria Math", "Times New Roman", serif'); }
      paintReadoutPt(o, pl, p.x, p.y);
      host.el.readoutPts = [...((host.el.readoutPts as ReadoutPt[] | undefined) ?? []), o];
      env.registry.define({ id: a.id, kind: 'point', target: tgtOf(host), bbox: union([dot, ...(lab ? [lab] : [])]), boxes: [dot, ...(lab ? [lab] : [])], anchor: p, group: g });
      await appear(g, 260, k);
    },
  };
}
