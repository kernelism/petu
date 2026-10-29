// src/script/parseKit.ts
/**
 * The visual kit's tags (spec "Visual kit v1"). Blocks draw into a board section (`on=s`); verbs act
 * on a block drawn earlier (`id=`). Values are literals; everything computed is named, never written:
 *
 *   {{grid on=s id=a vals=0,0,9;0,0,9 shade cols=t1,t2,t3 "caption"}}
 *   {{grid on=s id=k vals=1,0,-1 right=a op=⊛}}       placed right of a, a ⊛ between them
 *   {{grid on=s id=o over=a slide=k right=k op==}}      a window of k's weights sliding over a (sum of products)
 *   {{grid on=s id=m over=a win=1x3 reduce=mean}}       a 1×3 window, its mean;  win=2x2 fn="(d-c)/(b-a)"
 *   {{grid on=s id=d zip=a,b fn="(x-y)^2"}}             element-wise;  map=a fn="x-mean"
 *   {{bars on=s id=v vals=3,5,2 labels=a,b,c}}  {{scatter on=s id=p pts=1,2 2,3 x="hours" y="score"}}
 *   {{calc on=s of=d reduce=sum "total"}}  {{calc on=s of=u,v reduce=dot}}  {{fit on=s id=f of=p pick=2,7}}
 *   {{step id=o[1,2]}}  {{sweep id=o dur=6}}  {{set id=b fn="x+20"}}  {{band id=f w=0.5}}  {{dist from=p[4] to=f}}
 */
import { SCENE_RELS, type ColRef, type KitBlock, type KitReduce, type KitSource, type KitVerb, type ScenePlace, type WinReduce, type Pt } from './types';
import type { PtArg } from './pointExpr';
import { isBlockRef, NAME, normName } from './pointExpr';
import { parseCells, parseVals, MAX_LIT } from '../desk/kit/compute';
import { applyOp, VEC_OPS, type VecOp } from '../desk/kit/ops';
import { valueRef } from './parseScene';

const MAX_FN = 120;
const MAX_LABEL = 40;
const MAX_POINTS = 40;
const REDUCES = new Set<KitReduce>(['sum', 'mean', 'max', 'min', 'norm', 'count', 'dot', 'cos', 'wavg', 'argmax', 'quantile']);
const OPS = new Set(['softmax', 'normalize', 'l2', 'cumsum', 'rank', 'matmul', 'scale']);
const WIN_REDUCES = new Set<WinReduce>(['sum', 'mean', 'max', 'min']);
/** Operator glyphs between blocks; ASCII spellings map to the glyph. */
const GLYPHS: Record<string, string> = {
  '↓': '↓', '⊛': '⊛', '*': '⊛', '·': '·', '.': '·', '×': '×', x: '×', '=': '=', '→': '→', '->': '→', '−': '−', '-': '−', '+': '+', '÷': '÷', '/': '÷', '≈': '≈',
};

/** An element id; a hyphen reads as an underscore (id=row-column is row_column everywhere). */
const eid = (s?: string) => { const n = s ? normName(s.trim().replace(/-/g, '_')) : ''; return n && NAME.test(n) ? n : undefined; };
const num = (s?: string) => (s === undefined || s === '' ? undefined : Number.isFinite(Number(s.replace(/−/g, '-'))) ? Number(s.replace(/−/g, '-')) : undefined);
const list = (s?: string) => {
  if (s == null) return undefined;
  const xs = s.split(',').map((x) => x.trim());
  return xs.length && xs.length <= MAX_LIT && xs.every((x) => x.length && x.length <= MAX_LABEL) ? xs : null;
};
const fnOk = (s?: string) => (s && s.length <= MAX_FN ? s : undefined);

/** One of right= left= above= below= beside= near= (an id or a part): where a thing goes in a scene. Undefined when none; null when malformed or more than one. */
export function sceneRel(args: Args): ScenePlace | null | undefined {
  const given = SCENE_RELS.filter((k) => args[k] != null);
  if (!given.length) return undefined;
  if (given.length > 1) return null;
  const v = args[given[0]].trim();
  const of = isBlockRef(v) ? v : eid(v);
  return of ? { rel: given[0], of } : null;
}

type Args = Record<string, string>;

/** right= / below= / op= / at=: where a block goes. Null when malformed. */
function place(args: Args, P: (s?: string) => PtArg | undefined): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  if (args.right != null && args.below != null) return null;
  // Board v2: left / above / beside / near another thing (a scene places it; a plain section stacks it below).
  const rel = sceneRel(args);
  if (rel === null) return null;
  if (rel && rel.rel !== 'right' && rel.rel !== 'below') {
    if (args.right != null || args.below != null || args.at != null) return null;
    out.rel = rel;
    out.below = rel.of;
    if (args.op != null) return null;
    return out;
  }
  for (const k of ['right', 'below'] as const) {
    if (args[k] == null) continue;
    const r = eid(args[k]);
    if (!r) return null;
    out[k] = r;
  }
  if (args.op != null && !OPS.has(args.op.trim().toLowerCase())) {
    // op=none: no glyph (a computed block beside its source otherwise gets →).
    const g = args.op.trim().toLowerCase() === 'none' ? '' : GLYPHS[args.op.trim()];
    if (g == null || (out.right == null && out.below == null)) return null;
    out.op = g;
  }
  if (args.at != null) {
    if (out.right != null || out.below != null) return null;
    const p = P(args.at);
    if (!p) return null;
    out.at = p;
  }
  return out;
}

/**
 * `t.c`: a column of table t, by letter (a is the first) or by its header (`t.price`, `t.Ed`).
 * A letter gives [t, index]; a header gives [t, -1, header], resolved against the table when it builds.
 */
const COLREF = /^([A-Za-z][A-Za-z0-9_]{0,23})\.([^\s.,;=[\](){}"]{1,24})$/;
export const colRef = (s?: string): ColRef | null => {
  const m = s ? COLREF.exec(s.trim()) : null;
  if (!m) return null;
  return /^[a-z]$/.test(m[2]) ? [normName(m[1]), m[2].charCodeAt(0) - 97] : [normName(m[1]), -1, m[2]];
};
/** A column ref as one string: `t.c` (by letter) or `t.Header`. */
export const colStr = (cr: ColRef) => `${cr[0]}.${cr[2] ?? String.fromCharCode(97 + cr[1])}`;

/** A source block for map= / zip=: a block id, or a table column `t.c` / `t.Header`. */
const srcRef = (s?: string) => { const cr = colRef(s); return cr ? colStr(cr) : eid(s); };

/** What the parser knows when a tag is parsed (absent: nothing, e.g. lint and tests). */
export type ParseCtx = { isConst?(name: string): boolean };

/**
 * Slips whose intent is unambiguous, rewritten before the source is read:
 * - `vals=<block id>` (not a number, not a constant's name) is `map=<id> fn="x"`: that block's values;
 * - `op=<one-block op> vals=<literals>` is the op over those literals (shares normalise anyway).
 * Returns the source, or undefined to read the args as written.
 */
function slipSource(kind: string, args: Args, ctx: ParseCtx | undefined): KitSource | null | undefined {
  const v = args.vals?.trim();
  const op = args.op?.trim().toLowerCase();
  if (v == null || ['map', 'zip', 'over', 'size', 'of'].some((k) => args[k] != null)) return undefined;
  if (op && OPS.has(op)) {
    const lit = parseVals(v);
    if (!lit || op === 'matmul' || !VEC_OPS.has(op as VecOp)) return null;
    if (kind === 'shares' && op === 'normalize') return { vals: lit };
    const t = num(args.t);
    if (args.t != null && !(t != null && t > 0)) return null;
    const r = applyOp(op as VecOp, lit, undefined, t ?? undefined);
    return typeof r === 'string' || !r.flat().every(Number.isFinite) ? null : { vals: r };
  }
  const id = /^[A-Za-z][A-Za-z0-9_-]*$/.test(v) ? eid(v) : undefined;
  if (!id || parseVals(v) || ctx?.isConst?.(id)) return undefined;
  return { map: id, fn: 'x' };
}

/** vals= / map= fn= / zip= fn= / over= (slide= | win= reduce=|fn=) / size= fn=: where a block's values come from. */
function source(args: Args, flags: Set<string>, kind = '', ctx?: ParseCtx): KitSource | null {
  const slip = slipSource(kind, args, ctx);
  if (slip !== undefined) return slip;
  // op=softmax of=v (t=2): a standard operation the engine computes (src/desk/kit/ops.ts).
  const op = args.op?.trim().toLowerCase();
  if (op && OPS.has(op)) {
    if (['vals', 'map', 'zip', 'over', 'size'].some((k) => args[k] != null)) return null;
    const of = (args.of ?? '').split(',').map((x) => srcRef(x.trim()));
    const t = num(args.t);
    if (!of.length || of.some((x) => !x) || of.length !== (op === 'matmul' ? 2 : 1) || (args.t != null && !(t != null && t > 0))) return null;
    return { op: op as Extract<KitSource, { op: string }>['op'], of: of as string[], ...(t != null ? { t } : {}) };
  }
  const given = ['vals', 'map', 'zip', 'over', 'size'].filter((k) => args[k] != null);
  if (given.length !== 1) return null;
  if (args.size != null) {
    // Any size parses; the engine computes it in full, or skips it with a reason naming MAX_CELLS.
    const z = /^(\d{1,6})x(\d{1,6})$/i.exec(args.size), fn = fnOk(args.fn);
    if (!z || !fn) return null;
    const R = Number(z[1]), C = Number(z[2]);
    return R >= 1 && C >= 1 ? { gen: [R, C], fn } : null;
  }
  if (args.vals != null) { const cr = colRef(args.vals); if (cr) return { col: cr }; const v = parseCells(args.vals); return v ? { vals: v.vals, ...(v.cells ? { cells: v.cells } : {}), ...(args.vals.includes('/') ? { frac: true } : {}) } : null; }
  if (args.map != null) { const m = srcRef(args.map), fn = fnOk(args.fn); return m && fn ? { map: m, fn } : null; }
  if (args.zip != null) {
    const ids = args.zip.split(',').map((x) => srcRef(x.trim()));
    const fn = fnOk(args.fn);
    return ids.length === 2 && ids[0] && ids[1] && fn ? { zip: [ids[0], ids[1]], fn } : null;
  }
  const over = eid(args.over);
  if (!over) return null;
  const same = flags.has('same') || args.pad === 'same';
  const flip = flags.has('flip');
  const stride = num(args.stride);
  if (stride != null && !(Number.isInteger(stride) && stride >= 1 && stride <= 4)) return null;
  const common = { over, ...(same ? { same: true } : {}), ...(stride && stride > 1 ? { stride } : {}) };
  if (args.slide != null) {
    const k = eid(args.slide);
    if (!k || args.win != null) return null;
    return { ...common, slide: k, ...(flip ? { flip: true } : {}) };
  }
  // A window of any size parses (a fn window names its cells a…z: the engine says so past 26).
  const w = /^(\d{1,4})x(\d{1,4})$/i.exec(args.win ?? '');
  if (!w) return null;
  const win: [number, number] = [Number(w[1]), Number(w[2])];
  if (win[0] < 1 || win[1] < 1) return null;
  const r = args.reduce?.toLowerCase() as WinReduce | undefined;
  const fn = fnOk(args.fn);
  if ((r == null) === (fn == null) || (r && !WIN_REDUCES.has(r))) return null;
  return { ...common, win, ...(r ? { reduce: r } : { fn }) };
}

/**
 * Stacked bars' parts: `100;90,20` (a row per bar; literal or formula cells). Undefined: not stacked
 * (one row, or rectangular rows without the flag); null: malformed.
 */
function stackOf(s: string | undefined, flag: boolean): { vals: number[][]; cells?: (string | null)[][]; side?: boolean } | null | undefined {
  if (s == null) return flag ? null : undefined;
  const rows = s.split(';').map((r) => r.trim()).filter(Boolean);
  const got = rows.map((r) => parseCells(r));
  if (got.some((g) => !g || g.vals.length !== 1)) return flag || rows.length > 1 ? null : undefined;
  const lens = new Set(got.map((g) => g!.vals[0].length));
  if (!flag && (rows.length < 2 || lens.size < 2)) return undefined;
  const vals = got.map((g) => g!.vals[0]);
  const named = got.some((g) => g!.cells);
  return { vals, ...(named ? { cells: got.map((g) => g!.cells?.[0] ?? g!.vals[0].map(() => null)) } : {}) };
}

/** {{split id=v[2] vals=8-t,t "kept" "tax"}}: a bar into parts (formulas over constants, split at top-level commas). */
export function parseSplitBar(args: Args, quotes: string[]): KitVerb | null {
  const ref = args.id != null ? (isBlockRef(args.id) ? args.id : eid(args.id)) : undefined;
  const raw = args.vals ?? '';
  const vals: string[] = [];
  let d = 0, cur = '';
  for (const ch of raw) { if (ch === '(') d++; else if (ch === ')') d--; if (ch === ',' && d === 0) { vals.push(cur.trim()); cur = ''; } else cur += ch; }
  vals.push(cur.trim());
  const labels = quotes.map((q) => q.trim()).filter(Boolean).map((q) => q.slice(0, MAX_LABEL));
  if (!ref || vals.some((v) => !v || v.length > MAX_FN) || labels.length > 8) return null;
  const n = Math.max(vals.length, labels.length);
  if (n < 2 || (labels.length && labels.length !== vals.length && labels.length !== vals.length + 1)) return null;
  return { kind: 'splitBar', ref, vals, labels };
}

/** Scatter data: `pts=1,2 2,3.5 …` (any finite numbers, at least two points). */
function data(s?: string): Pt[] | null {
  if (!s) return null;
  const out: Pt[] = [];
  for (const t of s.trim().split(/\s+/)) {
    const [a, b, ...rest] = t.split(',').map((v) => Number(v.replace(/−/g, '-')));
    if (rest.length || !Number.isFinite(a) || !Number.isFinite(b)) return null;
    out.push({ x: a, y: b });
  }
  return out.length >= 2 && out.length <= MAX_POINTS ? out : null;
}

const dpOf = (args: Args) => {
  const d = num(args.dp);
  return d == null ? {} : Number.isInteger(d) && d >= 0 && d <= 4 ? { dp: d } : null;
};

/** A kit block tag (target and id/em are added by the caller). Null when malformed. */
export function parseKitBlock(name: string, args: Args, quotes: string[], flags: Set<string>, P: (s?: string) => PtArg | undefined, ctx?: ParseCtx): KitBlock<PtArg> | null {
  const caption = quotes[0]?.trim() ? { caption: quotes[0].trim().slice(0, 80) } : {};
  const pl = name === 'fit' ? {} : place(args, P);
  if (!pl) return null;
  const dp = dpOf(args);
  if (!dp) return null;
  switch (name) {
    case 'grid': {
      const src = source(args, flags, name, ctx);
      const rows = list(args.rows), cols = list(args.cols);
      if (!src || rows === null || cols === null) return null;
      const sh = args.shade != null ? args.shade.toLowerCase() : flags.has('shade') ? 'heat' : undefined;
      if (sh != null && sh !== 'heat' && sh !== 'image') return null;
      const view = args.view?.toLowerCase();
      if (view != null && view !== 'image' && view !== 'numbers') return null;
      return { kind: 'grid', src, ...(rows ? { rows } : {}), ...(cols ? { cols } : {}), ...(sh ? { shade: sh as 'heat' | 'image' } : {}), ...(view === 'image' ? { view } : {}), ...dp, ...caption, ...pl } as KitBlock<PtArg>;
    }
    case 'table': {
      const got = parseCells(args.vals);
      const v = got?.vals;
      const heads = list(args.cols);
      if (!v || !heads || heads.length < v[0].length) return null;
      return { kind: 'table', vals: v, ...(got!.cells ? { cells: got!.cells } : {}), heads, ...(args.vals!.includes('/') ? { frac: true } : {}), ...dp, ...caption, ...pl } as KitBlock<PtArg>;
    }
    case 'bars': {
      // Stacked: each bar the sum of its parts (rows of vals=, any lengths). Rows of different lengths
      // can only be meant this way, so they imply `stack`.
      // Rectangular rows that name their parts (`vals=17,17;15,19 parts=supplied,demanded`) can only be
      // grouped bars: a group per row, a bar per part, side by side on one baseline (`stack.side`).
      const side = !flags.has('stack') && args.parts != null && (args.vals?.includes(';') ?? false);
      const st = stackOf(args.vals, flags.has('stack') || side);
      if (st === null) return null;
      if (st && side && new Set(st.vals.map((r) => r.length)).size === 1) st.side = true;
      if (st) {
        const labels = list(args.labels), parts = list(args.parts);
        if (labels === null || parts === null || ['map', 'zip', 'over', 'size', 'axes', 'view'].some((k) => args[k] != null)) return null;
        return { kind: 'bars', src: { vals: [st.vals.map(() => 0)] }, stack: st, ...(labels ? { labels } : {}), ...(parts ? { parts } : {}), ...dp, ...caption, ...pl } as KitBlock<PtArg>;
      }
      // A histogram of any block's values; axes= another histogram shares its bins (one x scale).
      if (args.hist != null) {
        const of = srcRef(args.hist), bins = args.bins != null ? num(args.bins) : 12, like = args.axes != null ? eid(args.axes) : undefined;
        if (!of || bins == null || !Number.isInteger(bins) || bins < 2 || bins > 60 || (args.axes != null && !like) || ['vals', 'map', 'zip', 'over', 'size'].some((k) => args[k] != null)) return null;
        const labels = list(args.labels);
        if (labels) return null;
        return { kind: 'bars', src: { hist: of, bins, ...(like ? { like } : {}) }, ...dp, ...caption, ...pl } as KitBlock<PtArg>;
      }
      const src = source(args, flags, name, ctx);
      const view = args.view?.toLowerCase();
      if (view != null && view !== 'line' && view !== 'bars') return null;
      const axes = args.axes != null ? eid(args.axes) : undefined;
      if (args.axes != null && !axes) return null;
      const lv = { ...(view === 'line' || axes ? { view: 'line' } : {}), ...(axes ? { axes } : {}) };
      const lf = colRef(args.labels);
      if (lf) { if (!src) return null; return { kind: 'bars', src, labelsFrom: lf, ...(args.ghost && eid(args.ghost) ? { ghost: eid(args.ghost) } : {}), ...lv, ...dp, ...caption, ...pl } as KitBlock<PtArg>; }
      const labels = list(args.labels);
      const ghost = args.ghost != null ? eid(args.ghost) : undefined;
      if (!src || labels === null || (args.ghost != null && !ghost)) return null;
      if ('vals' in src && src.vals.length !== 1) return null; // a vector: one row
      if ('gen' in src && src.gen[0] !== 1) return null;
      return { kind: 'bars', src, ...(labels ? { labels } : {}), ...(ghost ? { ghost } : {}), ...lv, ...dp, ...caption, ...pl } as KitBlock<PtArg>;
    }
    case 'scatter': {
      const two = args.pts?.split(',');
      const cx = two?.length === 2 ? colRef(two[0]) : null, cy = two?.length === 2 ? colRef(two[1]) : null;
      const d = cx && cy ? null : data(args.pts);
      if (!d && !(cx && cy && cx[0] === cy[0])) return null;
      const named = cx && cy ? { ...(cx[2] ? { xName: cx[2] } : {}), ...(cy[2] ? { yName: cy[2] } : {}) } : {};
      return { kind: 'scatter', ...(d ? { data: d } : { cols: { id: cx![0], x: cx![1], y: cy![1], ...named } }), ...(args.x ? { xLabel: args.x.slice(0, MAX_LABEL) } : {}), ...(args.y ? { yLabel: args.y.slice(0, MAX_LABEL) } : {}), ...(eid(args.axes) ? { axes: eid(args.axes) } : {}), ...caption, ...pl } as KitBlock<PtArg>;
    }
    case 'calc': {
      const of = (args.of ?? '').split(',').map((x) => eid(x.trim()));
      const r = (args.reduce ?? 'sum').toLowerCase() as KitReduce;
      if (!of.length || of.length > 2 || of.some((x) => !x) || !REDUCES.has(r)) return null;
      const pair = r === 'dot' || r === 'cos' || r === 'wavg';
      const fn = args.fn != null ? fnOk(args.fn) : undefined;
      if (args.fn != null && !fn) return null;
      if (pair ? of.length !== 2 : of.length !== (fn ? of.length : 1)) return null;
      const label = quotes[0]?.trim() ? { label: quotes[0].trim().slice(0, MAX_LABEL) } : {};
      // quantile: q= is its level in [0, 1] (a percent such as q=90 reads as 0.9); median by default.
      let q = num(args.q);
      if (q != null && q > 1 && q <= 100) q /= 100;
      if (args.q != null && (r !== 'quantile' || q == null || q < 0 || q > 1)) return null;
      return { kind: 'calc', of: of as string[], reduce: r, ...(fn ? { fn } : {}), ...(r === 'quantile' ? { q: q ?? 0.5 } : {}), ...label, ...dp, ...pl } as KitBlock<PtArg>;
    }
    case 'shares':
    case 'blend': {
      // blend of=w,v: the values of v mixed in w's shares (w's values, normalised), with the result.
      let src: KitSource | null;
      let mix: string | undefined;
      if (name === 'blend') {
        const of = (args.of ?? '').split(',').map((x) => eid(x.trim()));
        if (of.length !== 2 || !of[0] || !of[1]) return null;
        src = { op: 'normalize', of: [of[0]] }; mix = of[1];
      } else src = source(args, flags, name, ctx);
      const labels = list(args.labels);
      if (!src || labels === null) return null;
      return { kind: 'shares', src, ...(labels ? { labels } : {}), ...(mix ? { mix } : {}), ...dp, ...caption, ...pl } as KitBlock<PtArg>;
    }
    case 'tokens': {
      // n= a count (a number or a formula over constants); states= the clusters' names, the first holds every mark at the start.
      const n = args.n?.trim();
      const states = list(args.states ?? args.state);
      if (!n || n.length > MAX_FN || states === null || (states && new Set(states).size !== states.length)) return null;
      return { kind: 'tokens', n, states: states ?? [], ...caption, ...pl } as KitBlock<PtArg>;
    }
    case 'fit': {
      const of = eid(args.of);
      if (!of) return null;
      if (args.pick == null) return { kind: 'fit', of };
      const p = args.pick.split(',').map(Number);
      if (p.length !== 2 || !p.every((v) => Number.isInteger(v) && v >= 1) || p[0] === p[1]) return null;
      return { kind: 'fit', of, pick: [p[0], p[1]] };
    }
  }
  return null;
}

/** A kit verb tag. Null when malformed. */
export function parseKitVerb(name: string, args: Args, quotes: string[], _flags: Set<string>): KitVerb | null {
  const ref = args.id != null ? (isBlockRef(args.id) ? args.id : eid(args.id)) : undefined;
  switch (name) {
    case 'step':
      return ref && isBlockRef(ref) ? { kind: 'step', ref } : null;
    case 'sweep': {
      const dur = num(args.dur);
      if (!ref || isBlockRef(ref) || (args.dur != null && !(dur != null && dur >= 0 && dur <= 30))) return null;
      return { kind: 'sweep', ref, ...(dur != null ? { dur } : {}) };
    }
    case 'set': {
      if (!ref) return null;
      // tokens: marks change state (the part names them, or n= how many).
      if (args.state != null) {
        const st = args.state.trim(), count = args.n?.trim();
        if (!st || st.length > MAX_LABEL || args.to != null || args.fn != null || args.vals != null || (count != null && (!count || count.length > MAX_FN))) return null;
        return { kind: 'set', ref, state: st, ...(count ? { count } : {}) };
      }
      // Board v2: a scene thing changes in place: a new label ("text"), value= or a link's strength=.
      if (quotes[0]?.trim() || args.value != null || args.strength != null) {
        if (args.to != null || args.fn != null || args.vals != null) return null;
        const value = valueRef(args.value), weight = valueRef(args.strength);
        if (value === null || weight === null) return null;
        return { kind: 'set', ref, ...(quotes[0]?.trim() ? { text: quotes[0].trim().slice(0, 60) } : {}), ...(value != null ? { value } : {}), ...(weight != null ? { weight } : {}) };
      }
      const to = num(args.to), fn = fnOk(args.fn), vals = args.vals != null ? parseVals(args.vals) : undefined;
      const n = [args.to != null, args.fn != null, args.vals != null].filter(Boolean).length;
      if (n !== 1 || (args.to != null && to == null) || (args.fn != null && !fn) || vals === null) return null;
      return { kind: 'set', ref, ...(to != null ? { to } : {}), ...(fn ? { fn } : {}), ...(vals ? { vals } : {}) };
    }
    case 'band': {
      const w = num(args.w);
      if (!ref || isBlockRef(ref) || !(w != null && w > 0)) return null;
      return { kind: 'band', ref, w, ...(quotes[0]?.trim() ? { label: quotes[0].trim().slice(0, MAX_LABEL) } : {}) };
    }
    case 'col': {
      const cr = colRef(args.id);
      const r = cr ? colStr(cr) : ref;
      const head = quotes[0]?.trim() ?? '', fn = fnOk(args.fn), dur = num(args.dur);
      if (!r || isBlockRef(r) || (!head && !cr) || head.length > MAX_LABEL || !fn || (args.dur != null && !(dur != null && dur >= 0 && dur <= 30))) return null;
      return { kind: 'col', ref: r, head, fn, ...(dur != null ? { dur } : {}) };
    }
    case 'level': {
      const at = num(args.at), cr = colRef(args.id);
      const r = cr ? cr[0] : ref;
      if (!r || (r && isBlockRef(r)) || at == null) return null;
      return { kind: 'level', ref: r, at, ...(cr ? { col: cr[1], ...(cr[2] ? { colName: cr[2] } : {}) } : {}), ...(quotes[0]?.trim() ? { label: quotes[0].trim().slice(0, MAX_LABEL) } : {}) };
    }
    case 'dist': {
      const line = eid(args.to), from = args.from;
      return line && from && isBlockRef(from) ? { kind: 'dist', ref: line, from } : null;
    }
  }
  return null;
}
