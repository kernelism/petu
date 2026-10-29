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
import type { ColRef, DrawAction, InkAction, KitBlock, KitSource, KitVerb, Pt, RefAction, Target } from '../../script/types';
import { blockPart, isBlockRef, type BlockPart } from '../../script/pointExpr';
import { colRef, colStr } from '../../script/parseKit';
import type { BuildEnv, ElementPlan, Pace, TargetCtx } from '../types';
import type { Registry } from '../registry';
import { token } from '../../ink/agent/tokens';
import { prefersReducedMotion } from '../../ink/agent/animate';
import { MIN_TEXT_PX } from '../layout';
import * as C from './compute';
import type { VarFn } from '../expr';
import { Animations, tween, pause, easeOut, type Ctl } from './anim';
import { place, wrapPieces, type Box, type Pad, type Placed } from './layout';
import { kitText, svg, setAttrs, textWidth } from './text';

/** A reference waits this long for its block (still waiting on its own word) before it is skipped. */
export const KIT_WAIT_MS = 600;
/** Value changes (set) tween over this. */
export const SET_MS = 600;
/** A window glides to its next cell over at most this. */
export const GLIDE_MS = 320;

// ------------------------------------------------------------------------------------------------
// Metrics: everything is sized from the board's type (the slide's body size), in section units.

export type Metrics = { s: number; numPx: number; labelPx: number; num: number; label: number; cell: number; gap: number; opW: number; margin: number; top: number; u: (px: number) => number };

export function metrics(scale: number, bodyPx: number): Metrics {
  const s = Math.max(scale, 1e-3);
  // Numerals at the slide's body size, never under 13px, and growing with a wide board (to 20px).
  const numPx = Math.max(13, bodyPx * 0.9, Math.min(20, (1000 * s) / 50)), labelPx = Math.max(MIN_TEXT_PX, numPx * 0.82);
  const u = (px: number) => px / s;
  return { s, numPx, labelPx, num: u(numPx), label: u(labelPx), cell: u(numPx * 2.3), gap: u(numPx * 1.7), opW: u(numPx * 1.4), margin: 40, top: 32, u };
}

// ------------------------------------------------------------------------------------------------
// The store: this answer's blocks (per Registry, cleared with it).

type Win = { over: string; kernel?: string; spec: C.WinSpec; geo: { R: number; C: number; pr: number; pc: number; stride: number }; filled: boolean[][]; pos: [number, number] | null; calc: string | null; rect: Box | null; cur: [number, number] | null };
type Group = { pos: number; neg: number; members: Block[] };
/** Axes shared by line blocks (the first is the host; axes=v overlays onto v's). */
type Plot = { host: Block; dom: { x0: number; x1: number; y0: number; y1: number }; members: Block[]; axes: SVGGElement | null; xLabel?: string; yLabel?: string };

export type Block = {
  id: string;
  kind: 'grid' | 'bars' | 'scatter' | 'table' | 'calc' | 'fit';
  region: string;
  placed: Placed;
  m: Metrics;
  deps: string[];
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
  cellPx?: number;
  shade?: 'heat' | 'image';
  win?: Win;
  group?: Group;
  ghost?: number[];
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
  calc?: { of: string[]; reduce: C.Reduce; fn?: string; label?: string; win?: string; live?: boolean; lines: number; maxW: number };
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
      if (Number.isFinite(x)) this.consts[k.toLowerCase()] = x;
      else console.warn('[kit] const dropped:', `${k}=${v}`);
    }
  }
  anonId(): string { return `_k${++this.n}`; }
  get(id: string): Block | undefined { return this.blocks.get(id); }
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
  clear(): void { this.blocks.clear(); this.n = 0; this.consts = {}; }
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
  if ('vals' in src) return { full: src.vals.map((r) => r.slice()), deps: [] };
  if ('gen' in src) {
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
    const fn = formula(src.fn!, C.WIN_LETTERS.slice(0, n), consts);
    if (!fn) return 'bad fn';
    spec = { kind: 'fn', kr: src.win![0], kc: src.win![1], src: src.fn!, fn, ...extra };
  }
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
  return [];
}

/** A block's default caption: its own id, when the model named it (anonymous ids stay unlabelled). */
const idCaption = (id?: string) => (id && !id.startsWith('_') ? id.replace(/_/g, ' ') : undefined);
/** A single-letter name (u, v, x′) is a variable: set in math italic, as on a board. */
export const isVarName = (s: string) => /^[A-Za-z][′']*$/.test(s);

// ------------------------------------------------------------------------------------------------
// Building: placement happens here (on the block's word), drawing in plan.draw.

const regionOf = (t: Target) => t.region!;
/** What a block will show once everything fills: a table column's computed values, else its values. */
function eventual(src: KitSource, shown: C.Mat, get: (id: string) => Block | undefined): C.Mat {
  if ('col' in src) { const t = get(src.col[0]); if (t?.full && src.col[1] >= 0) return [t.full.map((r) => r[src.col[1]])]; }
  return shown;
}
const fmtAll = (m: C.Mat, dp?: number, frac = false) => m.flat().map((v) => C.fmt(v, dp, frac));
/** Fractions only for values the model wrote as fractions (literal 1/9 weights), never for computed ones. */
const litFrac = (src?: KitSource) => !!src && 'vals' in src && !!src.frac;
const fracOf = (b: Block) => litFrac(b.src) && !b.win && C.fractions((b.vals ?? []).flat());

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
  const anchor = await anchorOf(store, a);
  // A neighbour that was skipped: the block still draws, in the default place (one skip never cascades).
  if ((a.right || a.below) && !anchor) { console.warn('[kit] unknown neighbour, placed below:', a.right ?? a.below); a = { ...a, right: undefined, below: undefined, op: undefined }; }
  // Defaults: a grid or bars is named on the board (its id, when it has no caption; tables and plots
  // name themselves by their headers and axes), and a computed block placed right of (below) its own
  // source reads as "source → result" (↓) unless op= says otherwise. An → between stacked blocks points down.
  if ((a.kind === 'grid' || a.kind === 'bars') && !a.caption && idCaption(a.id)) a = { ...a, caption: idCaption(a.id) };
  if ((a.kind === 'grid' || a.kind === 'bars') && (a.right || a.below) && a.op == null && anchor && sourceIds(a.src).includes(anchor.id)) a = { ...a, op: a.right ? '→' : '↓' };
  if (a.below && a.op === '→') a = { ...a, op: '↓' };
  const others = store.inRegion(region).map((b) => b.placed);
  const spacing = { gap: m.gap, opW: m.opW, margin: m.margin, top: m.top, width: 1000 };
  const P = (w: number, h: number, pad: Pad) => place(w, h, pad, { right: a.right, below: a.below, op: a.op, at: a.at as Pt | undefined }, anchor?.placed, others, spacing);
  const c = col();
  let b: Block;
  if (a.kind === 'grid' || a.kind === 'bars') {
    const got = computeSource(a.src, (x) => store.get(x), id, store.consts);
    if (typeof got === 'string') return got;
    if (a.kind === 'bars' && !got.win) got.full = asRow(got.full);
    const [R, Cn] = C.shape(got.full);
    if (a.kind === 'bars' && R !== 1) return 'bars need one row';
    // Too many cells for numerals: a grid shows as an image, a vector as a line.
    const image = a.kind === 'grid' && (a.view === 'image' || R > C.MAX_DIM || Cn > C.MAX_DIM);
    const line = a.kind === 'bars' && (a.view === 'line' || Cn > 16);
    const strs = image ? [] : fmtAll(got.full, a.dp, litFrac(a.src));
    const wide = Math.max(0, ...strs.map((s) => textWidth(s, m.numPx)));
    // Square cells, room for three digits at least, so a composition's cells come out one size.
    // An image's pixels share a side of about 13 numerals' height.
    let cellPx = image ? Math.min(m.numPx * 2.5, (m.numPx * 13) / Math.max(R, Cn)) : Math.max(m.numPx * 2.5, wide + m.numPx * 0.8);
    if (anchor?.cellPx && anchor.kind === a.kind) cellPx = image ? (anchor.view === 'image' ? anchor.cellPx : cellPx) : anchor.view === 'image' ? cellPx : Math.max(cellPx, anchor.cellPx);
    const cs = m.u(cellPx);
    const filled = got.win ? got.full.map((r) => r.map(() => false)) : null;
    const vals = filled ? got.full.map((r) => r.map(() => NaN)) : got.full.map((r) => r.slice());
    if (a.kind === 'grid') {
      const rows = image ? undefined : a.rows?.slice(0, R), cols = image ? undefined : a.cols?.slice(0, Cn);
      const pad: Pad = {
        l: rows ? m.u(Math.max(...rows.map((r) => textWidth(r, m.labelPx))) + m.labelPx * 0.8) : 0,
        t: cols ? m.label * 1.6 : 0, r: 0,
        b: a.caption ? m.label * 2 : 0,
      };
      const placed = P(Cn * cs, R * cs, pad);
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
      Object.assign(b, { src: a.src, full: got.full, vals, dp: a.dp, cs, cellPx, shade: image ? a.shade ?? 'image' : a.shade, em: a.em, ...(image ? { view: 'image' } : {}) });
      b.el.rows = rows; b.el.cols = cols; b.el.caption = a.caption;
    } else if (line) {
      const made = await makeLine(a as Extract<KitBlock, { kind: 'bars' }>, got, id, region, m, P, store);
      if (typeof made === 'string') return made;
      b = made;
    } else {
      const slot = cs, H = cs * 3.2;
      const ev = eventual(a.src, got.full, (x) => store.get(x));
      const lf = a.labelsFrom && a.labelsFrom[1] >= 0 ? store.get(a.labelsFrom[0]) : undefined;
      const labels = (lf?.full ? lf.full.map((r) => C.fmt(r[a.labelsFrom![1]], lf.dp)) : a.labels)?.slice(0, Cn);
      const neg = ev[0].some((v) => v < 0);
      const pad: Pad = { l: 0, t: m.label * 1.5, r: 0, b: (neg ? m.label * 1.4 : 0) + (labels ? m.label * 1.7 : 0) + (a.caption ? m.label * 1.9 : 0) + m.label * 0.4 };
      const placed = P(Cn * slot, H, pad);
      b = newBlock(id, 'bars', region, placed, m, got.deps);
      Object.assign(b, { src: a.src, full: got.full, vals, dp: a.dp, cs, cellPx, em: a.em });
      b.el.labels = labels; b.el.caption = a.caption;
      // One scale with the bars it sits beside when their ranges are alike (raw vs raw); its own otherwise.
      const ext = (v: number[]) => ({ pos: Math.max(0, ...v.filter(Number.isFinite)), neg: Math.max(0, ...v.filter(Number.isFinite).map((x) => -x)) });
      const mine = ext(ev[0]);
      b.full = ev;
      // Side by side (right=) is a comparison: one scale. Below is a new picture: its own.
      const g0 = anchor?.kind === 'bars' && a.right ? anchor.group : undefined;
      const span = (e: { pos: number; neg: number }) => e.pos + e.neg || 1;
      if (g0 && span(mine) / span(g0) < 4 && span(g0) / span(mine) < 4) {
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
    const R = a.vals.length, Cn = a.heads.length;
    const vals = a.vals.map((r) => [...r, ...Array(Cn - r.length).fill(NaN)]);
    const rh = m.num * 2, hh = m.label * 2.2;
    const ws = a.heads.map((h, j) => m.u(Math.max(textWidth(h, m.labelPx), ...vals.map((r) => textWidth(C.fmt(r[j], a.dp), m.numPx)), m.numPx * 2.2) + m.numPx * 1.8));
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
    const w = a.right ? m.cell * 7 : CHART_W, h = a.right ? m.cell * 4.6 : CHART_W * 0.58;
    const tickW = Math.max(...C.ticks(y0, y1).map((t) => textWidth(C.fmt(t), m.labelPx)));
    // Above the plot: the y label (left) and live readouts (right), never over the data.
    const pad: Pad = { l: m.u(tickW + m.labelPx * 0.9), t: m.label * 2, r: m.label * 0.6, b: m.label * 1.8 + (a.xLabel ? m.label * 1.5 : 0) + (a.caption ? m.label * 1.9 : 0) };
    const hp = host?.plot;
    b = newBlock(id, 'scatter', region, hp ? { body: { ...hp.host.placed.body }, rect: { ...hp.host.placed.rect } } : P(w, h, pad), m, []);
    Object.assign(b, { data, dom: hp ? { ...hp.dom } : { x0, x1, y0, y1 }, fits: [], em: a.em, cols: a.cols });
    if (hp) b.el.overlay = hp.host.id;
    if (a.cols) b.deps = [a.cols.id];
    b.el.xLabel = a.xLabel; b.el.yLabel = a.yLabel; b.el.caption = a.caption;
  } else {
    // calc
    const srcs = a.of.map((x) => store.get(x));
    if (srcs.some((x) => !x?.vals)) return `unknown block ${a.of.find((x, i) => !srcs[i]?.vals)}`;
    const left = Math.min(...srcs.map((s) => s!.placed.body.x));
    const at = a.at ?? (a.right || a.below ? undefined : { x: left, y: (others.length ? Math.max(...others.map((o) => o.rect.y + o.rect.h)) + m.gap * 0.8 : m.top) });
    const exp = calcExpansion({ of: a.of, reduce: a.reduce, fn: a.fn, label: a.label }, store, a.dp);
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
    b.calc = { of: a.of, reduce: a.reduce, fn: a.fn, label: a.label, lines, maxW };
    b.dp = a.dp; b.em = a.em;
  }
  return planFor(b, a.id, ctx, env, store, region, m, c);
}

/** Adds a built block to the answer and returns its plan: the section grows and recentres; draw renders it. */
function planFor(b: Block, aid: string | undefined, ctx: TargetCtx, env: BuildEnv, store: KitStore, region: string, m: Metrics, c: ReturnType<typeof col>): ElementPlan {
  store.add(b);
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
      else await drawCalc(b, store, c, env, pace, true);
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
  if (v) { t.setAttribute('font-style', 'italic'); t.setAttribute('font-family', 'KaTeX_Math, "STIX Two Math", "Cambria Math", "Times New Roman", serif'); }
  return t;
}

function drawOp(g: SVGGElement, b: Block, c: ReturnType<typeof col>) {
  const o = b.placed.op!;
  const t = kitText(g, o.x, o.y, o.glyph, { size: b.m.num * 1.45, fill: c.ink2 });
  t.setAttribute('font-family', 'KaTeX_Main, "STIX Two Math", "Cambria Math", serif');
}

// ------------------------------------------------------------------------------------------------
// grid

type GridEls = { cells: SVGRectElement[][]; texts: SVGTextElement[][]; over: SVGGElement; emph?: SVGRectElement; emCells?: [number, number][] };

function rangeOf(b: Block): [number, number] {
  const xs = (b.win ? b.full! : b.vals!).flat().filter(Number.isFinite);
  // An image spans its own range (dark = its lowest value), so its contrast is what the values make.
  if (b.view === 'image') return xs.length ? [Math.min(...xs), Math.max(...xs)] : [0, 1];
  return xs.length ? [Math.min(0, ...xs), Math.max(...xs)] : [0, 1];
}

async function drawGrid(b: Block, c: ReturnType<typeof col>, env: BuildEnv, k: Pace) {
  if (b.view === 'image') return drawImage(b, c, k);
  const g = b.g!, { body } = b.placed, cs = b.cs!, m = b.m;
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
  const g = b.g!, { body } = b.placed, cs = b.cs!, m = b.m;
  const [R, Cn] = C.shape(b.vals!);
  const frame = svg(g, 'g');
  const [lo, hi] = rangeOf(b);
  const ov = px(b, 0.5);
  const cells: SVGRectElement[][] = [], texts: SVGTextElement[][] = [];
  for (let r = 0; r < R; r++) {
    cells.push([]); texts.push([]);
    for (let q = 0; q < Cn; q++) {
      cells[r].push(svg(frame, 'rect', { x: body.x + q * cs, y: body.y + r * cs, width: cs + ov, height: cs + ov, fill: shadeOf(b.vals![r][q], b.shade, lo, hi, c).fill }));
      texts[r].push(document.createElementNS('http://www.w3.org/2000/svg', 'text'));
    }
  }
  svg(frame, 'rect', { x: body.x, y: body.y, width: body.w, height: body.h, fill: 'none', stroke: c.edge, ...hair(1) });
  const cap = b.el.caption as string | undefined;
  if (cap) caption(frame, body.x + body.w / 2, body.y + body.h + m.label * 1.2, cap, m, c);
  const over = svg(g, 'g', { class: 'kit-over' });
  b.el.grid = { cells, texts, over } satisfies GridEls;
  await appear(frame, 320, k);
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
  const cs = b.cs!, { body } = b.placed;
  return { x: body.x + c0 * cs, y: body.y + r0 * cs, w: (c1 - c0 + 1) * cs, h: (r1 - r0 + 1) * cs };
}

// ------------------------------------------------------------------------------------------------
// bars

type BarEls = { bars: SVGRectElement[]; vals: SVGTextElement[]; ghosts: SVGGElement; base: SVGLineElement; emBars: Set<number> };

/** Bar i's rect for value v in the block's current scale. */
function barRect(b: Block, i: number, v: number): Box {
  const { body } = b.placed, slot = b.cs!, w = slot * 0.62;
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
  if (cap) caption(labG, body.x + body.w / 2, below + (labels ? m.label * 2.5 : m.label * 1.1), cap, m, c);
  b.el.bars = { bars, vals, ghosts, base, emBars: new Set() } satisfies BarEls;
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
      setAttrs(e.bars[i], { x: r.x, y: r.y, width: r.w, height: Math.max(0, r.h), fill: e.emBars.has(i) ? token('--kit-accent') || c.bar : c.bar });
      const lab = Number.isFinite(v) ? (t >= 1 ? C.fmt(v, x.dp, fracOf(x)) : C.fmt(Number(cur.toFixed(x.dp ?? decimals(v))), x.dp ?? decimals(v))) : '';
      e.vals[i].textContent = lab;
      setAttrs(e.vals[i], { x: r.x + r.w / 2, y: cur >= 0 ? r.y - m.label * 0.7 : r.y + r.h + m.label * 0.7 });
    });
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

// A span lost in float noise (sin²+cos², 1 ± 1e-16) is flat: a step below one ulp would never advance the ticks.
const padDom = (lo: number, hi: number) => { const d = hi - lo > 1e-9 * Math.max(Math.abs(lo), Math.abs(hi)) ? hi - lo : Math.abs(hi) || 1; return [lo - d * 0.06, hi + d * 0.06] as const; };
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
    const w = beside ? m.cell * 7 : CHART_W, h = beside ? m.cell * 4.2 : CHART_W * 0.58;
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

/** A chart's default body width in section units (the section is 1000 wide): ~75% of the board with its labels. */
const CHART_W = 600;

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
  const K = store.consts;
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
  // A pole or a value outside range= breaks the curve there. The cap sits well above the bulk of
  // |y| (its 10–90% spread), not a multiple of the median: a peak, exp's tail or max(0,x)'s zero
  // half keep their shape; only a pole's spike is cut.
  const fin = ys.filter(Number.isFinite).map(Math.abs).sort((p, q) => p - q);
  const q = (p: number) => fin[Math.min(fin.length - 1, Math.floor(fin.length * p))] ?? 1;
  const cap = a.range ? null : Math.max(q(0.9) + 3 * (q(0.9) - q(0.1)), q(0.9) * 2, 1e-9);
  for (let i = 0; i < ys.length; i++) {
    const bad = !Number.isFinite(xs[i]) || !Number.isFinite(ys[i]) || (a.range ? ys[i] < a.range[0] || ys[i] > a.range[1] : Math.abs(ys[i]) > cap!);
    if (bad) { ys[i] = NaN; if (!Number.isFinite(xs[i])) xs[i] = i > 0 ? xs[i - 1] : 0; }
  }
  if (ys.filter(Number.isFinite).length < 2) return 'nothing to plot';
  const others = store.inRegion(region).map((b) => b.placed);
  const spacing = { gap: m.gap, opW: m.opW, margin: m.margin, top: m.top, width: 1000 };
  const P = (w: number, h: number, pad: Pad) => place(w, h, pad, {}, undefined, others, spacing);
  const b = await makeLineXY(id, region, m, P, store, xs, ys, a.axes, [], false, { x: a.xLabel, y: a.yLabel });
  if (typeof b === 'string') return b;
  b.em = a.em;
  b.el.caption = a.label;
  b.el.labelAt = a.labelAt;
  b.el.curve = true;
  return planFor(b, a.id, ctx, env, store, region, m, col());
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
function linePath(b: Block, ys: number[], upto = ys.length): string {
  const pl = b.plot!, xs = b.xs!;
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
  e.ghost.setAttribute('d', b.ghost ? linePath(b, b.ghost) : '');
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

/** End labels of a plot's lines never overlap: sorted by height, pushed apart by a line's height. */
function spreadLabels(pl: Plot) {
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
  if (pl.host === b || pl.axes) drawPlotAxes(pl, c);
  const ys = b.vals![0];
  const color = lineColor(b, c, accent);
  const ghost = svg(g, 'path', { d: '', fill: 'none', stroke: c.muted, 'stroke-dasharray': '4 4', ...hair(1.2) });
  const path = svg(g, 'path', { d: '', fill: 'none', stroke: color, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', ...hair(1.8) });
  const dots = ys.length <= 24 && !b.el.curve ? ys.map(() => svg(g, 'circle', { r: px(b, 2.6), fill: color, opacity: 0 })) : [];
  const name = (b.el.caption as string | undefined) ?? idCaption(b.id);
  const label = name ? kitText(g, 0, 0, name, { size: m.label, fill: color, anchor: 'start', halo: c.halo, opacity: 0 }) : null;
  if (label && isVarName(name!)) { label.setAttribute('font-style', 'italic'); label.setAttribute('font-family', 'KaTeX_Math, "STIX Two Math", "Cambria Math", "Times New Roman", serif'); }
  b.el.line = { path, ghost, dots, label, rings: svg(g, 'g') } satisfies LineEls;
  // Earlier lines on this plot: back to muted, and onto the (maybe widened) axes.
  for (const o of pl.members) if (o !== b && o.el.line) { const oc = lineColor(o, c, accent); const oe = o.el.line as LineEls; oe.path.setAttribute('stroke', oc); oe.dots.forEach((d) => d.setAttribute('fill', oc)); oe.label?.setAttribute('fill', oc); paintLine(o, o.vals![0], c); }
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
  const old = pl.dom, dom = domOf(pl.members.map((x) => ({ xs: x.xs!, ys: [...x.vals![0], ...(x.ghost ?? [])] })));
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
    target: { region: sc.region }, bbox: sc.placed.rect,
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
    target: { region: sc.region }, bbox: sc.placed.rect,
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
      env.registry.define({ kind: 'kit-dist', target: { region: sc.region }, bbox: union([{ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }]), boxes: [], anchor: mid, group: g });
      await appear(g, 260, k);
    },
  };
}

// ------------------------------------------------------------------------------------------------
// calc lines

/** A calc's expansion now, from its blocks' shown values. */
function calcExpansion(cd: { of: string[]; reduce: C.Reduce; fn?: string; label?: string }, store: KitStore, dp?: number): C.Expansion | string {
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
    return C.reduce(cd.reduce === 'dot' || cd.reduce === 'cos' ? 'sum' : cd.reduce, vals, undefined, dp, cd.reduce === 'sum' || cd.reduce === 'mean' ? shown.map((s) => (/[+−·/ ]/.test(s) ? s : s)) : undefined);
  }
  return C.reduce(cd.reduce, xs, ys, dp);
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
  const all = store.inRegion(out.region);
  const y = Math.max(...all.map((p) => p.placed.rect.y + p.placed.rect.h)) + m.gap * 0.9;
  const maxW = 1000 - m.margin - x;
  // Room for the longest expansion this window will show.
  let lines = 1;
  for (let r = 0; r < w.geo.R; r++) for (let q = 0; q < w.geo.C; q++) {
    const e = C.winCell(input.vals!, r, q, w.spec, out.dp);
    if (e) lines = Math.max(lines, wrapPieces(piecesOf(e), maxW, (s) => m.u(textWidth(s, m.numPx))).length);
  }
  const body = { x, y, w: maxW, h: lines * m.num * 1.55 };
  const cb = newBlock(store.anonId(), 'calc', out.region, { body, rect: { ...body } }, m, [out.id]);
  cb.calc = { of: [], reduce: 'sum', win: out.id, lines, maxW };
  cb.dp = out.dp;
  store.add(cb);
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
  const w = p.out.win!, [kr, kc] = C.winSize(w.spec), [r0, c0] = C.winOrigin(r, q, w.geo), cs = p.input.cs!;
  const { body } = p.input.placed;
  return { x: body.x + c0 * cs, y: body.y + r0 * cs, w: kc * cs, h: kr * cs };
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
  const w = p.out.win!, [kr, kc] = C.winSize(w.spec), [r0, c0] = C.winOrigin(r, q, w.geo), cs = p.input.cs!;
  const [R, Cn] = C.shape(p.input.vals!);
  const { body } = p.input.placed;
  for (let i = 0; i < kr; i++) for (let j = 0; j < kc; j++) {
    const rr = r0 + i, cc = c0 + j;
    if (rr >= 0 && cc >= 0 && rr < R && cc < Cn) continue;
    const x = body.x + cc * cs, y = body.y + rr * cs;
    svg(g, 'rect', { x, y, width: cs, height: cs, fill: c.cell, 'fill-opacity': 0.7, stroke: c.muted, 'stroke-dasharray': '2 3', ...hair(1) });
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
    target: { region: out.region }, bbox,
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
  const part = blockPart(v.ref);
  const id = part ? part.id : v.ref;
  const b = await store.wait(id);
  if (!b || (b.kind !== 'grid' && b.kind !== 'bars')) return `${id} has no values to set`;
  if (!b.src || !('vals' in b.src)) return `${id} is computed: set its inputs instead`;
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
    target: { region: b.region }, bbox,
    draw: async (signal) => {
      await b.ready;
      void store.anim.run([b.id, ...deps.map((d) => d.id)], async (ctl) => {
        if (signal.aborted) ctl.ff = true;
        b.src = { vals: next };
        const jobs: Promise<void>[] = [];
        if (b.kind === 'bars') { b.ghost = cur[0].slice(); b.full = next; jobs.push(setBarVals(b, next, SET_MS, ctl, c)); }
        else jobs.push(setGridVals(b, next, SET_MS, ctl, c));
        jobs.push(refreshDeps([b.id], store, SET_MS, ctl, env, c));
        await Promise.all(jobs);
      });
      await pause(Math.min(SET_MS, 300));
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
    if (!v || typeof v !== 'object' || !('ref' in v) || !v.ref || !isBlockRef(v.ref)) continue;
    const r = await resolvePart(v.ref, registry);
    if (typeof r === 'string') return r;
    if (a.kind === 'box' && k === 'at' && out.w === 0) {
      const p = r.b.m.u(3);
      Object.assign(out, { at: { x: r.box.x - p, y: r.box.y - p }, w: r.box.w + 2 * p, h: r.box.h + 2 * p });
    } else out[k] = { x: r.box.x + r.box.w / 2, y: r.box.y + r.box.h / 2 };
  }
  if (Array.isArray(out.pts)) {
    const ps = [];
    for (const v of out.pts as { ref?: string; x?: number }[]) {
      if (v && 'ref' in v && v.ref && isBlockRef(v.ref)) {
        const r = await resolvePart(v.ref, registry);
        if (typeof r === 'string') return r;
        ps.push({ x: r.box.x + r.box.w / 2, y: r.box.y + r.box.h / 2 });
      } else ps.push(v);
    }
    out.pts = ps;
  }
  return out as A;
}

/** Whether a ref action is the kit's: a kit verb, or emph / fade on a block or its part. */
export function isKitRef(a: RefAction, registry: Registry): boolean {
  if (a.kind === 'step' || a.kind === 'sweep' || a.kind === 'set' || a.kind === 'band' || a.kind === 'dist' || a.kind === 'col' || a.kind === 'level') return true;
  if (a.kind === 'emph' && a.where) return true;
  if (a.kind !== 'emph' && a.kind !== 'fade') return false;
  if (isBlockRef(a.ref)) return true;
  const b = kitStore(registry).get(a.ref);
  return !!b && (b.kind === 'grid' || b.kind === 'bars' || b.kind === 'scatter' || b.kind === 'table');
}

/** Builds a kit verb, or emph / fade on a block part. */
export async function buildKitRef(a: RefAction, env: BuildEnv): Promise<ElementPlan | string> {
  const store = kitStore(env.registry);
  switch (a.kind) {
    case 'step':
    case 'sweep': return stepOrSweep(a, env, store);
    case 'set': return setVerb(a, env, store);
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
    target: { region: b.region }, bbox: pad(box, b.m.u(8)),
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
  return typeof r === 'string' ? r : { t: { region }, r: r.box };
}

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
  const heads = tb.heads.map((h, j) => kitText(head, tb.xs[j] + tb.ws[j] / 2, body.y - tb.hh / 2, h, { size: m.label, fill: c.ink2 }));
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
  const deps = ids.flatMap((id) => store.dependents(id)).filter((d) => !seen.has(d.id) && seen.add(d.id));
  const jobs: Promise<void>[] = [];
  for (const d of deps) {
    if (d.kind === 'scatter') { jobs.push(refreshScatter(d, store, ms, ctl, c, env.settings.inkColor)); continue; }
    if (d.kind === 'calc' || d.kind === 'fit' || !d.src) continue;
    const got = computeSource(d.src, (x) => store.get(x), d.id, store.consts);
    if (typeof got === 'string') continue;
    if (d.kind === 'bars' && !d.win) got.full = asRow(got.full);
    if (!d.win && 'col' in d.src) { /* a table column: shows what has filled */ }
    else d.full = got.full;
    const shown = d.win ? got.full.map((row, r) => row.map((x, q) => (d.win!.filled[r][q] ? x : NaN))) : got.full;
    if (d.kind === 'bars' && d.el.bars) jobs.push(setBarVals(d, shown, ms, ctl, c));
    else if (d.kind === 'grid' && d.el.grid) jobs.push(setGridVals(d, shown, ms, ctl, c, d.win?.cur ?? null, env.settings.inkColor));
    else d.vals = shown;
  }
  await Promise.all(jobs);
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
// `pi` stays π: the row above's column i (rarely 9 columns wide) gives way to the constant.
const ROW_VARS = ['i', ...C.WIN_LETTERS.slice(0, 12), ...C.WIN_LETTERS.slice(0, 12).map((l) => `p${l}`).filter((v) => v !== 'pi')];

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
  // Its calc line under the table, room for the longest row.
  const x = t.placed.body.x;
  const others = store.inRegion(t.region).filter((o) => o !== t);
  const below = (o: Block) => o.placed.rect.y >= t.placed.rect.y + t.placed.rect.h - 1;
  const yBelow = Math.max(t.placed.rect.y + t.placed.rect.h, ...others.filter(below).map((o) => o.placed.rect.y + o.placed.rect.h));
  const maxW = 1000 - m.margin - x;
  const exps = full.map((_, r) => rowExp(v, fn, full, r, t.dp));
  const lines = Math.max(1, ...exps.map((e) => wrapPieces(piecesOf(e, tb.heads[j]), maxW, (s) => m.u(textWidth(s, m.numPx))).length));
  const body = { x, y: yBelow + m.gap * 0.7, w: Math.min(maxW, Math.max(...exps.map((e) => m.u(textWidth(piecesOf(e, tb.heads[j]).join(''), m.numPx))))), h: lines * m.num * 1.55 };
  const cb = newBlock(store.anonId(), 'calc', t.region, { body, rect: { ...body } }, m, []);
  cb.calc = { of: [], reduce: 'sum', live: true, label: tb.heads[j], lines, maxW };
  store.add(cb);
  grow(env, t.region, cb.placed.rect);
  const c = col(), accent = env.settings.inkColor;
  const dur = v.dur;
  return {
    target: { region: t.region }, bbox: union([t.placed.rect, cb.placed.rect]),
    draw: async (signal) => {
      await t.ready;
      cb.g = svg(t.g!.parentNode as SVGGElement, 'g', { class: 'kit-block', 'data-kit': 'calc' });
      cb.markReady();
      const e = t.el.table as TableEls;
      // A new column's header and cells.
      if (!e.heads[j]) {
        e.heads[j] = kitText(e.heads[0].parentNode as SVGGElement, tb.xs[j] + tb.ws[j] / 2, t.placed.body.y - tb.hh / 2, v.head, { size: m.label, fill: c.ink2 });
        const rule = (e.heads[0].parentNode as SVGGElement).querySelector('line');
        rule?.setAttribute('x2', String(t.placed.body.x + t.placed.body.w));
        e.texts.forEach((row, r) => { const cell = tabCell(t, r, j); row[j] = kitText(e.rows, cell.x + cell.w / 2, cell.y + cell.h / 2, '', { size: m.num, fill: c.ink }); });
      } else e.heads[j].textContent = tb.heads[j];
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
    target: { region: b.region }, bbox: { x: x0, y: y - m.label, w: x1 - x0 + labelW, h: 2 * m.label },
    draw: async (_s, k) => {
      await b.ready;
      const g = svg(b.g!, 'g');
      const ln = svg(g, 'line', { x1: x0, x2: x0, y1: y, y2: y, stroke: accent, 'stroke-dasharray': '5 4', ...hair(1.5) });
      if (v.label) kitText(g, x1 + m.label * 0.5, y, v.label, { size: m.label, fill: accent, anchor: 'start', halo: col().halo });
      env.registry.define({ kind: 'kit-level', target: { region: b.region }, bbox: { x: x0, y: y - m.label, w: x1 - x0 + labelW, h: 2 * m.label }, boxes: [{ x: x1, y: y - m.label, w: labelW, h: 2 * m.label }], anchor: { x: x1, y }, group: g });
      await tween(k.fadeMs != null ? 0 : 380 * k.speed, (t) => ln.setAttribute('x2', String(x0 + (x1 - x0) * t)));
    },
  };
}

/** emph where="x==7": every matching cell of a grid or table, counted out one by one. */
async function emphWhere(a: Extract<RefAction, { kind: 'emph' }>, env: BuildEnv, store: KitStore): Promise<ElementPlan | string> {
  const b = await store.wait(a.ref);
  if (!b || (b.kind !== 'grid' && b.kind !== 'table')) return 'where: a grid or a table';
  const fn = C.compileFn(a.where!, ['x', 'r', 'c']);
  if (!fn) return 'bad where';
  const hits: [number, number][] = [];
  b.vals!.forEach((row, r) => row.forEach((x, q) => { if (Number.isFinite(x) && fn({ x, r: r + 1, c: q + 1 })) hits.push([r, q]); }));
  if (!hits.length) return 'no cell matches';
  const accent = env.settings.inkColor;
  return {
    target: { region: b.region }, bbox: b.placed.rect,
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
