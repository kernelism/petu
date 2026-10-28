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
import type { ColRef, KitBlock, KitReduce, KitSource, KitVerb, WinReduce, Pt } from './types';
import type { PtArg } from './pointExpr';
import { isBlockRef, NAME, normName } from './pointExpr';
import { parseVals, MAX_DIM } from '../desk/kit/compute';

const MAX_FN = 120;
const MAX_LABEL = 40;
const MAX_POINTS = 40;
const REDUCES = new Set<KitReduce>(['sum', 'mean', 'max', 'min', 'norm', 'count', 'dot', 'cos']);
const WIN_REDUCES = new Set<WinReduce>(['sum', 'mean', 'max', 'min']);
/** Operator glyphs between blocks; ASCII spellings map to the glyph. */
const GLYPHS: Record<string, string> = {
  '↓': '↓', '⊛': '⊛', '*': '⊛', '·': '·', '.': '·', '×': '×', x: '×', '=': '=', '→': '→', '->': '→', '−': '−', '-': '−', '+': '+', '÷': '÷', '/': '÷', '≈': '≈',
};

const eid = (s?: string) => { const n = s ? normName(s) : ''; return n && NAME.test(n) ? n : undefined; };
const num = (s?: string) => (s === undefined || s === '' ? undefined : Number.isFinite(Number(s.replace(/−/g, '-'))) ? Number(s.replace(/−/g, '-')) : undefined);
const list = (s?: string) => {
  if (s == null) return undefined;
  const xs = s.split(',').map((x) => x.trim());
  return xs.length && xs.length <= MAX_DIM && xs.every((x) => x.length && x.length <= MAX_LABEL) ? xs : null;
};
const fnOk = (s?: string) => (s && s.length <= MAX_FN ? s : undefined);

type Args = Record<string, string>;

/** right= / below= / op= / at=: where a block goes. Null when malformed. */
function place(args: Args, P: (s?: string) => PtArg | undefined): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  if (args.right != null && args.below != null) return null;
  for (const k of ['right', 'below'] as const) {
    if (args[k] == null) continue;
    const r = eid(args[k]);
    if (!r) return null;
    out[k] = r;
  }
  if (args.op != null) {
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

/** vals= / map= fn= / zip= fn= / over= (slide= | win= reduce=|fn=) / size= fn=: where a block's values come from. */
function source(args: Args, flags: Set<string>): KitSource | null {
  const given = ['vals', 'map', 'zip', 'over', 'size'].filter((k) => args[k] != null);
  if (given.length !== 1) return null;
  if (args.size != null) {
    const z = /^(\d{1,2})x(\d{1,2})$/i.exec(args.size), fn = fnOk(args.fn);
    if (!z || !fn) return null;
    const R = Number(z[1]), C = Number(z[2]);
    return R >= 1 && C >= 1 && R <= MAX_DIM && C <= MAX_DIM ? { gen: [R, C], fn } : null;
  }
  if (args.vals != null) { const cr = colRef(args.vals); if (cr) return { col: cr }; const v = parseVals(args.vals); return v ? { vals: v } : null; }
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
  const w = /^(\d{1,2})x(\d{1,2})$/i.exec(args.win ?? '');
  if (!w) return null;
  const win: [number, number] = [Number(w[1]), Number(w[2])];
  if (win[0] < 1 || win[1] < 1 || win[0] * win[1] > 26) return null;
  const r = args.reduce?.toLowerCase() as WinReduce | undefined;
  const fn = fnOk(args.fn);
  if ((r == null) === (fn == null) || (r && !WIN_REDUCES.has(r))) return null;
  return { ...common, win, ...(r ? { reduce: r } : { fn }) };
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
export function parseKitBlock(name: string, args: Args, quotes: string[], flags: Set<string>, P: (s?: string) => PtArg | undefined): KitBlock<PtArg> | null {
  const caption = quotes[0]?.trim() ? { caption: quotes[0].trim().slice(0, 80) } : {};
  const pl = name === 'fit' ? {} : place(args, P);
  if (!pl) return null;
  const dp = dpOf(args);
  if (!dp) return null;
  switch (name) {
    case 'grid': {
      const src = source(args, flags);
      const rows = list(args.rows), cols = list(args.cols);
      if (!src || rows === null || cols === null) return null;
      const sh = args.shade != null ? args.shade.toLowerCase() : flags.has('shade') ? 'heat' : undefined;
      if (sh != null && sh !== 'heat' && sh !== 'image') return null;
      return { kind: 'grid', src, ...(rows ? { rows } : {}), ...(cols ? { cols } : {}), ...(sh ? { shade: sh as 'heat' | 'image' } : {}), ...dp, ...caption, ...pl } as KitBlock<PtArg>;
    }
    case 'table': {
      const v = parseVals(args.vals);
      const heads = list(args.cols);
      if (!v || !heads || heads.length < v[0].length) return null;
      return { kind: 'table', vals: v, heads, ...dp, ...caption, ...pl } as KitBlock<PtArg>;
    }
    case 'bars': {
      const src = source(args, flags);
      const lf = colRef(args.labels);
      if (lf) { if (!src) return null; return { kind: 'bars', src, labelsFrom: lf, ...(args.ghost && eid(args.ghost) ? { ghost: eid(args.ghost) } : {}), ...dp, ...caption, ...pl } as KitBlock<PtArg>; }
      const labels = list(args.labels);
      const ghost = args.ghost != null ? eid(args.ghost) : undefined;
      if (!src || labels === null || (args.ghost != null && !ghost)) return null;
      if ('vals' in src && src.vals.length !== 1) return null; // a vector: one row
      if ('gen' in src && src.gen[0] !== 1) return null;
      return { kind: 'bars', src, ...(labels ? { labels } : {}), ...(ghost ? { ghost } : {}), ...dp, ...caption, ...pl } as KitBlock<PtArg>;
    }
    case 'scatter': {
      const two = args.pts?.split(',');
      const cx = two?.length === 2 ? colRef(two[0]) : null, cy = two?.length === 2 ? colRef(two[1]) : null;
      const d = cx && cy ? null : data(args.pts);
      if (!d && !(cx && cy && cx[0] === cy[0])) return null;
      const named = cx && cy ? { ...(cx[2] ? { xName: cx[2] } : {}), ...(cy[2] ? { yName: cy[2] } : {}) } : {};
      return { kind: 'scatter', ...(d ? { data: d } : { cols: { id: cx![0], x: cx![1], y: cy![1], ...named } }), ...(args.x ? { xLabel: args.x.slice(0, MAX_LABEL) } : {}), ...(args.y ? { yLabel: args.y.slice(0, MAX_LABEL) } : {}), ...caption, ...pl } as KitBlock<PtArg>;
    }
    case 'calc': {
      const of = (args.of ?? '').split(',').map((x) => eid(x.trim()));
      const r = (args.reduce ?? 'sum').toLowerCase() as KitReduce;
      if (!of.length || of.length > 2 || of.some((x) => !x) || !REDUCES.has(r)) return null;
      const pair = r === 'dot' || r === 'cos';
      const fn = args.fn != null ? fnOk(args.fn) : undefined;
      if (args.fn != null && !fn) return null;
      if (pair ? of.length !== 2 : of.length !== (fn ? of.length : 1)) return null;
      const label = quotes[0]?.trim() ? { label: quotes[0].trim().slice(0, MAX_LABEL) } : {};
      return { kind: 'calc', of: of as string[], reduce: r, ...(fn ? { fn } : {}), ...label, ...dp, ...pl } as KitBlock<PtArg>;
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
