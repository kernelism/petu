// src/gate/engine.ts — the engine's numbers, rebuilt headlessly from the actions so far: every
// number the board shows (kit values computed with the kit's own computeSource / formula / reduce),
// named constants, plot curves, readouts ({{find}}), fitted lines, region geometry from `let` names
// (resolved by the app's Figures), and the ids drawn so far. No DOM. Layout boxes are not computed
// here (see layout.ts).
//
// Two users, one implementation: the commit gate replays a recorded answer beat by beat, and the
// script parser (src/script/parser.ts) applies every tag as it is parsed, so a {{val}} is said with
// the engine's value (`say`) and a {{contrast}} expands into the copy it draws (`expand`).
import { computeSource, formula, colIndex, splitParts, tokenCount, tokenMoves } from '../desk/kit/kit';
import * as C from '../desk/kit/compute';
import { normalize } from '../desk/kit/ops';
import { colRef } from '../script/parseKit';
import { blockPart } from '../script/pointExpr';
import type { FindAction, KitSource, MoveAction, RawAction, ValAction } from '../script/types';
import { Figures, type Grounding } from '../geometry/resolve';
import { curveOf, read, yAt, type Curve, type FitData, type Reading } from '../values/readout';
import { sayNumber } from '../values/say';
import { latestCharts } from '../agent/context/charts';
import { newScope, resolveData, type DataScope } from '../svgboard/data';
import { parseGroup } from '../svgboard/sanitize';

export type ValueSource = 'page' | 'question' | 'literal' | 'const' | 'computed' | 'derived';
export type Value = { v: number; source: ValueSource; /** block id, page, const name… */ of: string; beat: number; row?: { table: string; r: number; cells: number[] } };

type Block = {
  id: string; kind: string; vals?: number[][]; full?: number[][]; src?: KitSource; tab?: { heads: string[] }; computedCols?: Set<number>; region?: string;
  dp?: number; with?: Record<string, number>; action?: RawAction;
  data?: C.Pt[]; cols?: { id: string; x: number; y: number }; of?: string; pick?: [number, number];
  /** Stacked bars: each bar's parts (a bar not split is one part); full holds the totals. */
  parts?: number[][];
  /** Tokens: each mark's state (an index into `states`). */
  tok?: { states: string[]; st: number[] };
};

const ROW_VARS = ['i', ...C.WIN_LETTERS.slice(0, 12), ...C.WIN_LETTERS.slice(0, 12).map((l) => `p${l}`)];

/** A plot as a function of x, with its domain and axes group. */
export type PlotFn = { id: string; f: (x: number) => number; x0: number; x1: number; group: string };
/** Circles and lines resolved to region coordinates (for exact-geometry checks). */
export type Circle = { id: string; region: string; cx: number; cy: number; r: number };
export type Seg = { id: string; region: string; kind: string; a: { x: number; y: number }; b: { x: number; y: number } };
export type PointG = { id: string; region: string; x: number; y: number; text?: string };
type PlotSrc = Extract<RawAction, { kind: 'plot' }> & { id?: string; chart?: string; page?: number };

/**
 * What the caption shows for a {{val}} the engine cannot resolve: a neutral dash, never a guessed
 * number. The director records it as a skipped action and the gate fails its beat.
 */
export const UNBOUND_TEXT = '—';


export class GateState {
  readonly values: Value[] = [];
  /** Named numbers, lowercase (the expression language reads names lowercased). */
  readonly consts: Record<string, number> = {};
  /** When each constant was declared (the beat, or for the parser the tag index). */
  readonly declared = new Map<string, number>();
  readonly blocks = new Map<string, Block>();
  readonly ids = new Set<string>();
  readonly regions = new Set<string>();
  /** Engine plots by id, in order: their tag (curves are recomputed from the current constants). */
  readonly plotSrc = new Map<string, { a: PlotSrc; group: string }>();
  /** Named readouts ({{find}}), computed when read. */
  readonly finds = new Map<string, FindAction>();
  readonly circles: Circle[] = [];
  readonly segs: Seg[] = [];
  readonly points: PointG[] = [];
  readonly figures: Figures;
  /** The svg board's exact data (src/svgboard/data.ts): its constants are this state's, its data-val numbers are computed values. */
  readonly svg: DataScope = newScope();
  private svgGroups: Element[] = [];
  /** The id of the last shape or block apply() created (anonymous ones get `_n`). */
  lastId: string | undefined;
  private anon = 0;

  /**
   * `grounding`: page marks and calibrated charts. Without one (the live parser), charts come from the
   * latest grounding the app built (charts.ts latestCharts), so a chart plot's readouts are said at parse time.
   */
  constructor(private grounding: Grounding = latestCharts) { this.figures = new Figures(grounding, () => this.consts); }

  addValues(vs: number[], source: ValueSource, of: string, beat: number): void {
    for (const v of vs) if (Number.isFinite(v)) this.values.push({ v, source, of, beat });
  }

  /** Lookahead, as the director does at parse time (let names, fit extents). */
  note(a: RawAction): void { try { this.figures.note(a); } catch { /* ignore */ } }

  /** Applies a committed action (not skipped). Returns a skip reason when the offline engine can't apply it. */
  apply(a: RawAction, beat: number): string | undefined {
    this.lastId = undefined;
    const x = a as Record<string, unknown> & { id?: string; region?: string; page?: number };
    switch (a.kind) {
      case 'sketch': this.regions.add(a.id); return;
      case 'scroll': case 'clear': return;
      case 'let': this.note(a); return;
      case 'const': {
        for (const [k, src] of a.defs) {
          const f = formula(src, [], this.consts);
          const v = f ? f({}) : NaN;
          // A constant written as a number is the model's own literal; one written as a formula (T=2*v/g) is computed.
          const lit = /^[-−+]?\d*\.?\d+$/.test(src.trim());
          if (Number.isFinite(v)) {
            const key = k.toLowerCase();
            this.consts[key] = v; this.declared.set(key, beat); this.addValues([v], lit ? 'const' : 'computed', k, beat);
            // A formula constant follows the constants it reads when they change (as on the board: KitStore.setConst).
            this.derived = this.derived.filter(([d]) => d !== key);
            if (!lit) this.derived.push([key, src]);
          }
        }
        return;
      }
      case 'find': {
        this.finds.set(a.id, a);
        this.ids.add(a.id);
        const r = this.reading(a.id);
        if (typeof r === 'string') return r;
        this.addReading(a, r, beat);
        return;
      }
      case 'val': {
        const r = this.value(a.ref);
        return typeof r === 'string' ? r : undefined;
      }
      case 'contrast': {
        const e = this.expand(a);
        return typeof e === 'string' ? e : this.apply(e, beat);
      }
      case 'limit':
      case 'beforeafter': return this.move(a, beat);
      case 'tween': return this.tween(a, beat);
      case 'svg': return this.svgGroup(a.svg, beat);
    }
    if (a.kind === 'grid' || a.kind === 'bars' || a.kind === 'table' || a.kind === 'calc' || a.kind === 'scatter' || a.kind === 'fit' || a.kind === 'shares' || a.kind === 'tokens') return this.kit(a, beat);
    if ('ref' in a) return this.verb(a, beat);
    // A plot on a board section, or on a slide's calibrated chart (p=N on=#c1: data units, the chart's axes).
    if (a.kind === 'plot' && (x.region != null || (a as PlotSrc).chart)) { this.plot(a as PlotSrc); return; }
    // Plain shapes: resolve names for geometry checks.
    if (x.region != null) {
      const r = this.figures.resolve(a);
      if (typeof r === 'object' && r) {
        const g = r as unknown as Record<string, { x: number; y: number }> & { rx?: number; text?: string; kind: string };
        const id = x.id ?? `_${++this.anon}`;
        this.lastId = id;
        if (a.kind === 'circle' && g.at && g.rx != null) this.circles.push({ id, region: x.region, cx: g.at.x, cy: g.at.y, r: g.rx });
        if ((a.kind === 'line' || a.kind === 'arrow') && g.from && g.to) this.segs.push({ id, region: x.region, kind: a.kind, a: g.from, b: g.to });
        if (a.kind === 'point' && g.at) this.points.push({ id, region: x.region, x: g.at.x, y: g.at.y, text: g.text as unknown as string });
      }
    }
    if (x.id) this.ids.add(x.id);
    return;
  }

  private get = (id: string) => this.blocks.get(id) as never;

  private kit(a: RawAction, beat: number): string | undefined {
    const k = a as unknown as Record<string, unknown> & { id?: string; region?: string; kind: string };
    const id = k.id ?? `_${++this.anon}`;
    this.ids.add(id);
    if (a.kind === 'tokens') {
      const n = tokenCount(a.n, this.consts);
      if (typeof n === 'string') return n;
      const states = a.states.length ? a.states : [''];
      this.blocks.set(id, { id, kind: 'tokens', full: [[n]], vals: [[n]], tok: { states, st: Array(n).fill(0) }, region: k.region });
      this.addValues([n], /^\d+$/.test(a.n) ? 'literal' : 'computed', id, beat);
      return;
    }
    if (a.kind === 'bars' && a.stack) {
      // Stacked: each bar the sum of its parts (formula parts over the constants).
      const parts = C.resolveCells(a.stack.vals, a.stack.cells, this.consts);
      if (typeof parts === 'string') return parts;
      const full = [parts.map((r) => r.reduce((s, v) => s + v, 0))];
      this.blocks.set(id, { id, kind: 'bars', vals: full, full, src: { vals: full }, parts, region: k.region, dp: k.dp as number | undefined, action: a });
      this.addValues([...parts.flat(), ...full[0]], a.stack.cells ? 'computed' : 'literal', id, beat);
      return;
    }
    if (a.kind === 'grid' || a.kind === 'bars') {
      const src = k.src as KitSource;
      const w = k.with as Record<string, number> | undefined;
      const got = computeSource(src, this.get, id, w ? { ...this.consts, ...w } : this.consts);
      if (typeof got === 'string') return got;
      this.blocks.set(id, { id, kind: a.kind, vals: got.full, full: got.full, src, region: k.region, dp: k.dp as number | undefined, ...(w ? { with: w } : {}), action: a });
      this.addValues(got.full.flat(), 'vals' in src ? 'literal' : 'computed', id, beat);
      return;
    }
    if (a.kind === 'shares') {
      // Parts of a whole, as the board shows them: the values normalised to sum to 1 (kit.ts).
      const src = k.src as KitSource;
      const got = computeSource(src, this.get, id, this.consts);
      if (typeof got === 'string') return got;
      const raw = got.full.flat();
      if (raw.some((v) => v < 0)) return 'shares need values of 0 or more';
      const vals = [normalize(raw)];
      if (vals[0].some((v) => !Number.isFinite(v))) return 'shares: the values sum to 0';
      this.blocks.set(id, { id, kind: 'shares', vals, full: vals, src, region: k.region, dp: k.dp as number | undefined, action: a });
      this.addValues(vals[0], 'computed', id, beat);
      return;
    }
    if (a.kind === 'table') {
      const lit = C.resolveCells(k.vals as number[][], k.cells as (string | null)[][] | undefined, this.consts);
      if (typeof lit === 'string') return lit;
      const vals = lit;
      this.blocks.set(id, { id, kind: 'table', vals, full: vals, tab: { heads: [...(k.heads as string[])] }, computedCols: new Set(), region: k.region, dp: k.dp as number | undefined });
      this.addValues(vals.flat(), 'literal', id, beat);
      return;
    }
    if (a.kind === 'calc') {
      const of = k.of as string[];
      const vs = of.map((o) => this.blocks.get(o)?.full);
      if (vs.some((v) => !v)) return 'unknown block';
      const xs = vs[0]!.flat(), ys = vs[1]?.flat();
      let v: number;
      const op = k.reduce as C.Reduce;
      if (k.fn) {
        const f = formula(String(k.fn), C.MAP_VARS, this.consts);
        if (!f) return 'bad fn';
        const st = C.stats(vs[0]!);
        const per = xs.map((x, i) => f({ x, ...(ys ? { y: ys[i] } : {}), mean: st.mean, sum: st.sum, min: st.min, max: st.max, norm: st.norm, std: st.std, n: st.n, i: i + 1 }));
        v = C.reduce(op === 'dot' || op === 'cos' ? 'sum' : op, per, undefined, undefined, undefined, k.q as number | undefined).value;
        this.addValues(per, 'computed', id, beat);
      } else v = C.reduce(op, xs, ys, undefined, undefined, k.q as number | undefined).value;
      this.blocks.set(id, { id, kind: 'calc', full: [[v]], vals: [[v]], region: k.region, dp: k.dp as number | undefined });
      this.addValues([v], 'computed', id, beat);
      // A mean shows its sum too.
      if (op === 'mean') this.addValues([xs.reduce((s, q) => s + q, 0)], 'computed', id, beat);
      return;
    }
    if (a.kind === 'scatter') {
      const data = k.data as C.Pt[] | undefined, cols = k.cols as Block['cols'];
      this.blocks.set(id, { id, kind: 'scatter', region: k.region, ...(data ? { data: data.map((p) => ({ ...p })) } : {}), ...(cols ? { cols } : {}) });
      return;
    }
    if (a.kind === 'fit') {
      this.blocks.set(id, { id, kind: 'fit', region: k.region, of: k.of as string, pick: k.pick as [number, number] | undefined });
      return this.fit(id) ? undefined : 'no line through those points';
    }
    this.blocks.set(id, { id, kind: a.kind, region: k.region });
    return;
  }

  /** A scatter's points now (a table's columns as they stand). */
  private scatterPts(b: Block): C.Pt[] {
    if (b.data) return b.data;
    const t = b.cols ? this.blocks.get(b.cols.id) : undefined;
    return t?.full ? t.full.map((r) => ({ x: r[b.cols!.x], y: r[b.cols!.y] })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) : [];
  }

  /** A fit's line and its scatter's points (least squares, or through two picked points), as the board computes it. */
  fit(id: string): FitData | undefined {
    const f = this.blocks.get(id);
    const sc = f?.kind === 'fit' && f.of ? this.blocks.get(f.of) : undefined;
    if (!f || !sc || sc.kind !== 'scatter') return undefined;
    const pts = this.scatterPts(sc);
    const [i, j] = f.pick ?? [0, 0];
    const line = f.pick ? (pts[i - 1] && pts[j - 1] ? C.lineThrough(pts[i - 1], pts[j - 1]) : null) : C.lstsq(pts);
    return line ? { line, pts } : undefined;
  }

  /** A plot's curve with the current constants. */
  curve(id: string): Curve | undefined {
    const p = this.plotSrc.get(id);
    const a = p ? this.onChart(p.a) : undefined;
    return a ? curveOf(a, this.consts) ?? undefined : undefined;
  }

  /**
   * A chart plot as the board draws it: with no domain= it spans the chart's x axis (as the resolver
   * gives it). Undefined when the chart is not calibrated in the grounding (skip, never guess).
   */
  private onChart(a: PlotSrc): PlotSrc | undefined {
    if (!a.chart || a.domain || a.domainSrc || a.t) return a;
    const c = a.page != null ? this.grounding.mark(a.page, a.chart) : undefined;
    if (c?.kind !== 'chart') return undefined;
    return { ...a, domain: [Math.min(c.x.lo, c.x.hi), Math.max(c.x.lo, c.x.hi)] };
  }

  /** What a readout computed: not the input it was asked at (the level, the x), which the model chose. */
  private addReading(a: FindAction, r: Reading, beat: number): void {
    const vs = a.mode === 'level' ? [r.x] : a.mode === 'at' ? [r.y] : a.mode === 'slope' ? [r.v, r.y] : r.point ? [r.x, r.y] : [r.v];
    this.addValues(vs, 'computed', a.id, beat);
  }

  /** A readout's value now; a string says why it can't be read. */
  reading(id: string): Reading | string {
    const a = this.finds.get(id);
    if (!a) return `no readout ${id}`;
    return read(a, (x) => this.curve(x), (x) => this.fit(x), this.consts);
  }

  /**
   * The engine's value for a {{val}} reference: a readout (E, E.x, E.y), a constant, a calc's result,
   * a one-value block, or a part (v[2], g[1,2], t[3].c / t[3].price). A string says why not.
   */
  value(ref: string): { v: number; dp?: number } | string {
    const m = /^([^.[]+)(\[[^\]]+\])?(?:\.(.+))?$/.exec(ref);
    if (!m) return `bad reference ${ref}`;
    const [, id, idx, field] = m;
    if (this.finds.has(id) && !idx) {
      const r = this.reading(id);
      if (typeof r === 'string') return r;
      const v = field === 'x' ? r.x : field === 'y' ? r.y : field == null ? r.v : NaN;
      return Number.isFinite(v) ? { v } : `${ref}: no such value`;
    }
    const b = this.blocks.get(id);
    if (!b && !idx && !field && id.toLowerCase() in this.consts) return { v: this.consts[id.toLowerCase()] };
    if (!b) return `unknown ${id}`;
    // Tokens: k is how many marks; k.tax how many are in that state.
    if (b.tok && !idx) {
      if (field == null) return { v: b.tok.st.length };
      const j = b.tok.states.indexOf(field);
      return j < 0 ? `${id} has no state ${field}` : { v: b.tok.st.filter((s) => s === j).length };
    }
    const full = b.full;
    if (!full) return `${id} has no values`;
    const fin = (v: number | undefined) => (v != null && Number.isFinite(v) ? { v, dp: b.dp } : `${ref}: no value`);
    if (!idx) {
      if (field) return `${ref}: name a row (${id}[1].${field})`;
      const flat = full.flat();
      return flat.length === 1 ? fin(flat[0]) : `${id} has ${flat.length} values: name one (${id}[1])`;
    }
    const part = blockPart(`${id}${idx}`);
    if (!part || part.r0 !== part.r1 || part.c0 !== part.c1) return `${ref}: one cell`;
    if (b.kind === 'table') {
      if (part.one && !field) return `${ref}: name a column (${id}${idx}.b)`;
      const r = part.one ? part.c0 : part.r0;
      const j = part.one ? (/^[a-z]$/.test(field!) ? colIndex(b.tab!.heads, field!.charCodeAt(0) - 97) : colIndex(b.tab!.heads, -1, field)) : part.c0;
      if (j < 0) return `no column ${field} in ${id}`;
      return fin(full[r]?.[j]);
    }
    if (field) return `${ref}: no field ${field}`;
    // A stacked bar: [i] its total, [i,j] its j-th part.
    if (b.parts && !part.one) return fin(b.parts[part.r0]?.[part.c0]);
    if (part.one) { const flat = full.length === 1 ? full[0] : full.map((row) => row[0]); return fin(flat[part.c0]); }
    return fin(full[part.r0]?.[part.c0]);
  }

  /**
   * How a {{val}} is said: the caption text (the board's number format, or fmt= decimals; as=percent
   * multiplies by 100 and adds %; as=abs drops the sign) and its spoken form (for TTS). Null when the
   * engine has no such value: the caller shows UNBOUND_TEXT and the gate fails the beat.
   */
  say(a: ValAction): { said: string; spoken: string } | null {
    const r = this.value(a.ref);
    return typeof r === 'string' ? null : sayNumber(r.v, { fmt: a.fmt ?? r.dp, as: a.as });
  }

  /** {{contrast}} → the copy it draws: the same plot on the same axes, or the same block beside it, with one constant changed. */
  expand(a: Extract<MoveAction, { kind: 'contrast' }>): RawAction | string {
    const [k, src] = a.set;
    const key = k.toLowerCase();
    const f = formula(src, [], this.consts);
    const v = f ? f({}) : NaN;
    if (!Number.isFinite(v)) return `bad value ${src}`;
    if (!(key in this.consts)) return `no constant ${k}`;
    const id = a.id ?? `${a.ref}_2`;
    if (this.ids.has(id)) return `duplicate id ${id}`;
    const text = a.text ?? `${k} = ${C.fmt(v)}`;
    const p = this.plotSrc.get(a.ref);
    if (p) {
      const { id: _i, label: _l, labelAt: _t, em: _e, ...rest } = p.a as PlotSrc & { em?: boolean };
      void _i; void _l; void _t; void _e;
      return { ...rest, id, axes: a.ref, label: text, dash: true, with: { ...(p.a.with ?? {}), [key]: v } } as RawAction;
    }
    const b = this.blocks.get(a.ref);
    if (!b?.action || !b.src || 'vals' in b.src) return `${a.ref} is not a plot or a computed block`;
    const { id: _i, caption: _c, below: _b, at: _a, rel: _r, right: _x, op: _o, ...rest } = b.action as unknown as Record<string, unknown>;
    void _i; void _c; void _b; void _a; void _r; void _x; void _o;
    return { ...rest, id, right: a.ref, op: '', caption: text, with: { ...(b.with ?? {}), [key]: v } } as unknown as RawAction;
  }

  /** Formula constants, in definition order (lowercase name, source): they follow the constants they read. */
  private derived: [string, string][] = [];
  private setConst(key: string, v: number): void {
    this.consts[key] = v;
    this.derived = this.derived.filter(([d]) => d !== key);
    C.rederive(this.consts, this.derived, key);
  }
  /** tween: each constant ends on its target (a yoyo ends where it started); everything drawn from them follows. */
  private tween(a: Extract<RawAction, { kind: 'tween' }>, beat: number): string | undefined {
    const vals: [string, number][] = [];
    for (const [k, src] of a.sets) {
      const key = k.toLowerCase();
      if (!(key in this.consts)) return `no constant ${k}`;
      const f = formula(src, [], this.consts);
      const v = f ? f({}) : NaN;
      if (!Number.isFinite(v)) return `bad value ${src}`;
      vals.push([key, a.yoyo ? this.consts[key] : v]);
    }
    for (const [key, v] of vals) { this.setConst(key, v); this.addValues([v], 'const', key, beat); }
    this.recompute(beat);
    this.svgAgain(beat);
    for (const [id, f] of this.finds) { const r = this.reading(id); if (typeof r !== 'string') this.addReading(f, r, beat); }
    return;
  }

  /**
   * An svg group: its data-const constants join this state's (as a {{const}} would), its frames and
   * curves are resolved, and every data-val it shows is a computed value the narration may say.
   */
  private svgGroup(src: string, beat: number): string | undefined {
    const g = parseGroup(src);
    if (typeof g === 'string') return g;
    this.svg.consts = this.consts;
    this.svg.define = (defs) => { this.apply({ kind: 'const', defs } as RawAction, beat); };
    this.svg.values.length = 0;
    const probs = resolveData(g, this.svg);
    this.addValues(this.svg.values.map((v) => v.v), 'computed', 'svg', beat);
    if (this.svg.values.length || g.querySelector('[data-at],[data-fn],[data-param],[data-between]')) this.svgGroups.push(g);
    return probs.length ? probs.map((p) => p.detail).join('; ') : undefined;
  }

  /** The svg board after a constant moved: its data-val readouts say their new values. */
  private svgAgain(beat: number): void {
    if (!this.svgGroups.length) return;
    this.svg.consts = this.consts;
    this.svg.values.length = 0;
    for (const g of this.svgGroups) resolveData(g, this.svg);
    this.addValues(this.svg.values.map((v) => v.v), 'computed', 'svg', beat);
  }

  /** limit / beforeafter: the constant takes its new value; every plot, readout and computed block follows. */
  private move(a: Extract<MoveAction, { kind: 'limit' | 'beforeafter' }>, beat: number): string | undefined {
    const [k, src] = a.set;
    const key = k.toLowerCase();
    if (!(key in this.consts)) return `no constant ${k}`;
    if (!this.plotSrc.has(a.ref) && !this.blocks.has(a.ref)) return `unknown ${a.ref}`;
    const f = formula(src, [], this.consts);
    const v = f ? f({}) : NaN;
    if (!Number.isFinite(v)) return `bad value ${src}`;
    this.setConst(key, v);
    this.addValues([v], 'const', k, beat);
    this.recompute(beat);
    for (const [id, f] of this.finds) { const r = this.reading(id); if (typeof r !== 'string') this.addReading(f, r, beat); }
    return;
  }

  /** Every computed block again, in creation order (an input or a constant changed). */
  private recompute(beat: number): void {
    for (const d of this.blocks.values()) {
      if (!d.src || 'vals' in d.src) continue;
      const got = computeSource(d.src, this.get, d.id, d.with ? { ...this.consts, ...d.with } : this.consts);
      if (typeof got === 'string') continue;
      const full = d.kind === 'shares' ? [normalize(got.full.flat())] : got.full;
      if (full.flat().some((v) => !Number.isFinite(v))) continue;
      d.full = full; d.vals = full; this.addValues(full.flat(), 'computed', d.id, beat);
    }
  }

  private verb(a: RawAction, beat: number): string | undefined {
    const v = a as unknown as { kind: string; ref: string; fn?: string; head?: string; to?: number; vals?: number[][] };
    if (v.kind === 'col') {
      const cr = colRef(v.ref);
      const tid = cr ? cr[0] : v.ref;
      const t = this.blocks.get(tid);
      if (!t || t.kind !== 'table' || !t.full) return `no table ${tid}`;
      const f = formula(String(v.fn), ROW_VARS, this.consts);
      if (!f) return 'bad fn';
      const width = t.full[0]?.length ?? 0;
      let j = width;
      if (cr) { const k = colIndex(t.tab!.heads, cr[1], cr[2]); if (k >= 0) j = k; else t.tab!.heads.push(v.head || cr[2] || ''); }
      else t.tab!.heads.push(v.head ?? '');
      for (const row of t.full) while (row.length <= j) row.push(NaN);
      for (let r = 0; r < t.full.length; r++) {
        const env: Record<string, number> = { i: r + 1 };
        t.full[r].forEach((c, q) => { env[C.WIN_LETTERS[q]] = c; env[`p${C.WIN_LETTERS[q]}`] = r > 0 ? t.full![r - 1][q] : NaN; });
        t.full[r][j] = f(env);
      }
      t.computedCols!.add(j);
      for (let r = 0; r < t.full.length; r++) {
        const val = t.full[r][j];
        if (Number.isFinite(val)) this.values.push({ v: val, source: 'computed', of: `${tid}.${t.tab!.heads[j] ?? j}`, beat, row: { table: tid, r, cells: t.full[r].slice() } });
      }
      return;
    }
    if (v.kind === 'splitBar') return this.split(a as Extract<RawAction, { kind: 'splitBar' }>, beat);
    if (v.kind === 'set') {
      const part = blockPart(v.ref);
      const id = part?.id ?? v.ref;
      const b = this.blocks.get(id);
      if (!b?.full) return `unknown block ${id}`;
      if (b.parts) return this.setParts(b, v, part, beat);
      if (b.tok) {
        const got = tokenMoves(b.tok, v as { state?: string; count?: string }, part, this.consts);
        if (typeof got === 'string') return got;
        b.tok.st = got;
        this.addValues(b.tok.states.map((_, j) => got.filter((s) => s === j).length), 'computed', id, beat);
        return;
      }
      // A share block's inputs are its raw values (the board normalises what it shows).
      if (b.kind === 'shares' && b.src && 'vals' in b.src) b.full = b.src.vals.map((r) => r.slice());
      if (v.vals) b.full = v.vals.map((r) => r.slice());
      else if (v.fn) {
        const f = formula(v.fn, C.MAP_VARS, this.consts);
        if (!f) return 'bad fn';
        b.full = C.mapMat(b.full, f);
      } else if (v.to != null && part) b.full[part.r0]![part.c0] = v.to;
      if (b.src && 'vals' in b.src) b.src = { vals: b.full.map((r) => r.slice()) };
      // A share block shows its new values as parts of the whole.
      if (b.kind === 'shares') { const n = [normalize(b.full.flat())]; if (n[0].every(Number.isFinite)) b.full = n; }
      b.vals = b.full;
      this.addValues(b.full.flat(), 'computed', id, beat);
      this.recompute(beat);
      return;
    }
    return;
  }

  /** {{split}}: bar i of a bars block becomes parts that sum to it. */
  private split(a: Extract<RawAction, { kind: 'splitBar' }>, beat: number): string | undefined {
    const part = blockPart(a.ref);
    const b = this.blocks.get(part?.id ?? a.ref);
    if (!b?.full || b.kind !== 'bars') return `no bars ${part?.id ?? a.ref}`;
    const totals = b.full.flat();
    const i = part ? (part.one ? part.c0 : -1) : totals.length === 1 ? 0 : -1;
    if (i < 0 || i >= totals.length) return `split: name one bar (${b.id}[1])`;
    const got = splitParts(a, totals[i], this.consts);
    if (typeof got === 'string') return got;
    b.parts = b.parts ?? totals.map((v) => [v]);
    b.parts[i] = got;
    this.addValues(got, 'computed', b.id, beat);
    return;
  }

  /** set on a stacked bar: one part (to=), or the totals (vals=, fn=; the parts keep their proportions). */
  private setParts(b: Block, v: { to?: number; vals?: number[][]; fn?: string }, part: ReturnType<typeof blockPart>, beat: number): string | undefined {
    const parts = b.parts!;
    if (v.to != null && part && !part.one) { if (parts[part.r0]?.[part.c0] == null) return 'set: no such part'; parts[part.r0][part.c0] = v.to; }
    else {
      const old = b.full!.flat();
      let next: number[];
      if (v.vals) next = v.vals.flat();
      else if (v.fn) { const f = formula(v.fn, C.MAP_VARS, this.consts); if (!f) return 'bad fn'; next = C.mapMat([old], f)[0]; }
      else if (v.to != null && part?.one) { next = old.slice(); next[part.c0] = v.to; }
      else return 'set: name a part or give values';
      if (next.length !== old.length) return 'set: shape differs';
      next.forEach((t, i) => { parts[i] = parts[i].map((p) => (old[i] ? (p * t) / old[i] : t / parts[i].length)); });
    }
    b.full = [parts.map((r) => r.reduce((s, x) => s + x, 0))];
    b.vals = b.full; b.src = { vals: b.full };
    this.addValues([...parts.flat(), ...b.full[0]], 'computed', b.id, beat);
    this.recompute(beat);
    return;
  }

  private plot(a: PlotSrc): void {
    if (!a.fn && !(a.x && a.y && a.t)) return;
    const id = a.id ?? `_${++this.anon}`;
    // Plots on one calibrated chart share its axes.
    const group = a.axes ? (this.plotSrc.get(a.axes)?.group ?? a.axes) : a.chart ? `${a.page}:${a.chart}` : id;
    this.plotSrc.set(id, { a, group });
    this.ids.add(id);
    this.lastId = id;
  }

  /** Engine plots as functions of x with the current constants (fn= plots exactly, parametric ones along their first pass). */
  get plots(): PlotFn[] {
    const out: PlotFn[] = [];
    for (const [id, p] of this.plotSrc) {
      const c = this.curve(id);
      if (c) out.push({ id, f: c.f ?? ((x) => yAt(c, x)), x0: c.x0, x1: c.x1, group: p.group });
    }
    return out;
  }

  /** Where plots on shared axes cross: (x, y) pairs. The engine doesn't show these; narration often names them. */
  intersections(): { x: number; y: number; a: string; b: string }[] {
    const out: { x: number; y: number; a: string; b: string }[] = [];
    const plots = this.plots;
    for (let i = 0; i < plots.length; i++) for (let j = i + 1; j < plots.length; j++) {
      const p = plots[i], q = plots[j];
      if (p.group !== q.group) continue;
      const lo = Math.max(p.x0, q.x0), hi = Math.min(p.x1, q.x1);
      if (!(hi > lo)) continue;
      const d = (x: number) => p.f(x) - q.f(x);
      const N = 400;
      for (let k = 0; k < N; k++) {
        let a = lo + ((hi - lo) * k) / N, b = lo + ((hi - lo) * (k + 1)) / N;
        let da = d(a), db = d(b);
        if (!Number.isFinite(da) || !Number.isFinite(db) || da * db > 0 || (da === 0 && k > 0)) continue;
        for (let it = 0; it < 50; it++) { const m = (a + b) / 2, dm = d(m); if (da * dm <= 0) { b = m; db = dm; } else { a = m; da = dm; } }
        const x = (a + b) / 2;
        out.push({ x, y: p.f(x), a: p.id, b: q.id });
      }
    }
    return out;
  }
}
