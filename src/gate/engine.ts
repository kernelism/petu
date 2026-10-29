// src/gate/engine.ts — the engine state the commit gate checks a beat against, rebuilt headlessly
// from the actions committed so far: every number the board shows (kit values computed with the
// kit's own computeSource / formula / reduce), named constants, plot functions (for intersections),
// region geometry from `let` names (resolved by the app's Figures), and the ids drawn so far.
// No DOM. Layout boxes are not computed here (see layout.ts).
import { computeSource, formula, colIndex } from '../desk/kit/kit';
import * as C from '../desk/kit/compute';
import { colRef } from '../script/parseKit';
import { blockPart } from '../script/pointExpr';
import type { KitSource, RawAction } from '../script/types';
import { Figures, type Grounding } from '../geometry/resolve';
import { compileVars } from '../desk/expr';

export type ValueSource = 'page' | 'question' | 'literal' | 'const' | 'computed' | 'derived';
export type Value = { v: number; source: ValueSource; /** block id, page, const name… */ of: string; beat: number; row?: { table: string; r: number; cells: number[] } };

type Block = { id: string; kind: string; vals?: number[][]; full?: number[][]; src?: KitSource; tab?: { heads: string[] }; computedCols?: Set<number>; region?: string };

const ROW_VARS = ['i', ...C.WIN_LETTERS.slice(0, 12), ...C.WIN_LETTERS.slice(0, 12).map((l) => `p${l}`)];

/** A plot as a function of x (fn= plots only), with its domain and axes group. */
export type PlotFn = { id: string; f: (x: number) => number; x0: number; x1: number; group: string };
/** Circles and lines resolved to region coordinates (for exact-geometry checks). */
export type Circle = { id: string; region: string; cx: number; cy: number; r: number };
export type Seg = { id: string; region: string; kind: string; a: { x: number; y: number }; b: { x: number; y: number } };
export type PointG = { id: string; region: string; x: number; y: number; text?: string };

export class GateState {
  readonly values: Value[] = [];
  readonly consts: Record<string, number> = {};
  readonly blocks = new Map<string, Block>();
  readonly ids = new Set<string>();
  readonly regions = new Set<string>();
  readonly plots: PlotFn[] = [];
  readonly circles: Circle[] = [];
  readonly segs: Seg[] = [];
  readonly points: PointG[] = [];
  readonly figures: Figures;
  /** The id of the last shape or block apply() created (anonymous ones get `_n`). */
  lastId: string | undefined;
  private anon = 0;

  constructor(grounding: Grounding = { mark: () => undefined }) { this.figures = new Figures(grounding); }

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
          if (Number.isFinite(v)) { this.consts[k] = v; this.addValues([v], 'const', k, beat); }
        }
        return;
      }
    }
    if (a.kind === 'grid' || a.kind === 'bars' || a.kind === 'table' || a.kind === 'calc' || a.kind === 'scatter' || a.kind === 'fit') return this.kit(a, beat);
    if ('ref' in a) return this.verb(a, beat);
    if (a.kind === 'plot') this.plot(a as never);
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
    if (a.kind === 'grid' || a.kind === 'bars') {
      const src = k.src as KitSource;
      const got = computeSource(src, this.get, id, this.consts);
      if (typeof got === 'string') return got;
      this.blocks.set(id, { id, kind: a.kind, vals: got.full, full: got.full, src, region: k.region });
      this.addValues(got.full.flat(), 'vals' in src ? 'literal' : 'computed', id, beat);
      return;
    }
    if (a.kind === 'table') {
      const vals = (k.vals as number[][]).map((r) => r.slice());
      this.blocks.set(id, { id, kind: 'table', vals, full: vals, tab: { heads: [...(k.heads as string[])] }, computedCols: new Set(), region: k.region });
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
        v = C.reduce(op === 'dot' || op === 'cos' ? 'sum' : op, per).value;
        this.addValues(per, 'computed', id, beat);
      } else v = C.reduce(op, xs, ys).value;
      this.blocks.set(id, { id, kind: 'calc', full: [[v]], vals: [[v]], region: k.region });
      this.addValues([v], 'computed', id, beat);
      // A mean shows its sum too.
      if (op === 'mean') this.addValues([xs.reduce((s, q) => s + q, 0)], 'computed', id, beat);
      return;
    }
    this.blocks.set(id, { id, kind: a.kind, region: k.region });
    return;
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
    if (v.kind === 'set') {
      const part = blockPart(v.ref);
      const id = part?.id ?? v.ref;
      const b = this.blocks.get(id);
      if (!b?.full) return `unknown block ${id}`;
      if (v.vals) b.full = v.vals.map((r) => r.slice());
      else if (v.fn) {
        const f = formula(v.fn, C.MAP_VARS, this.consts);
        if (!f) return 'bad fn';
        b.full = C.mapMat(b.full, f);
      } else if (v.to != null && part) b.full[part.r0]![part.c0] = v.to;
      b.vals = b.full;
      if (b.src && 'vals' in b.src) b.src = { vals: b.full };
      this.addValues(b.full.flat(), 'computed', id, beat);
      // Dependents recompute.
      for (const d of this.blocks.values()) {
        if (!d.src || 'vals' in d.src) continue;
        const got = computeSource(d.src, this.get, d.id, this.consts);
        if (typeof got !== 'string') { d.full = got.full; d.vals = got.full; this.addValues(got.full.flat(), 'computed', d.id, beat); }
      }
      return;
    }
    return;
  }

  private plot(a: { id?: string; fn?: string; domain?: [number, number]; domainSrc?: [string, string]; axes?: string; region?: string }): void {
    if (!a.fn) return;
    let f: ((x: number) => number) | null = null;
    try { const g = compileVars(a.fn, ['x', ...Object.keys(this.consts)]); f = (x) => g({ ...this.consts, x }); } catch { f = null; }
    if (!f) return;
    const ev = (s: string) => { const g = formula(s, [], this.consts); return g ? g({}) : NaN; };
    const [x0, x1] = a.domain ?? (a.domainSrc ? [ev(a.domainSrc[0]), ev(a.domainSrc[1])] : [NaN, NaN]);
    if (!Number.isFinite(x0) || !Number.isFinite(x1)) return;
    const id = a.id ?? `_${++this.anon}`;
    const group = a.axes ? (this.plots.find((p) => p.id === a.axes)?.group ?? a.axes) : id;
    this.plots.push({ id, f, x0, x1, group });
  }

  /** Where plots on shared axes cross: (x, y) pairs. The engine doesn't show these; narration often names them. */
  intersections(): { x: number; y: number; a: string; b: string }[] {
    const out: { x: number; y: number; a: string; b: string }[] = [];
    for (let i = 0; i < this.plots.length; i++) for (let j = i + 1; j < this.plots.length; j++) {
      const p = this.plots[i], q = this.plots[j];
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
