import { SCENE_KINDS } from '../script/types';
// src/geometry/resolve.ts
import { REGION_H, type Action, type End, type Pt, type RawAction, type RawEnd, type Target } from '../script/types';
import { isBlockRef, isLiteral, type PtArg } from '../script/pointExpr';
import { Figure, rayEnd } from './figure';
import type { PageRect } from './space';
import { chartToPage, type ChartAxis } from '../agent/context/charts';

type LiftRaw = Extract<RawAction, { kind: 'lift' }>;

/** What the grounding knows about one page mark (model coords). */
export type GroundMark =
  | { kind: 'dot'; at: Pt }
  | { kind: 'line' | 'arrow'; from: Pt; to: Pt }
  | { kind: 'box' | 'image' | 'figure' | 'equation'; rect: PageRect }
  | { kind: 'text'; rect: PageRect; text: string }
  /** A calibrated chart (`#c1`): page drawings on it take data coordinates. */
  | { kind: 'chart'; rect: PageRect; x: ChartAxis; y: ChartAxis };
export type Grounding = {
  mark(page: number, id: string): GroundMark | undefined;
  /** A page's h / w, when the page is grounded (lifts keep the page's proportions). */
  aspect?(page: number): number | undefined;
  /** What a page note must not cover: the page's text lines and figure marks (model coords). */
  obstacles?(page: number): PageRect[];
};

/** Pages: a ray without `len` stops at 1.5 × |AB| (a page has no frame to run to). */
export const PAGE_RAY_LEN = 1.5;
/** Padding around a mark that a circle or box encloses (page x units). */
export const MARK_PAD = 6;

/** A target, or a page's calibrated chart (its own figure: world coords are data values). */
type FigKey = Target & { chart?: string };
const key = (t: FigKey) => (t.region != null ? `r:${t.region}` : t.chart ? `c:${t.page}:${t.chart}` : `p:${t.page}`);
const tgt = (a: { page?: number; region?: string; chart?: string }): FigKey => (a.region != null ? { region: a.region } : { page: a.page!, ...(a.chart ? { chart: a.chart } : {}) });

/** A lift's place in its section: the source rect on page `page`, its top-left `at` and size in the section. */
export type LiftPlace = { page: number; src: PageRect; at: Pt; w: number; h: number };
/** Default lift width (section units), its top, and the most height it takes: the section is 1000 × 700. */
const LIFT_W = 520, LIFT_TOP = 60, LIFT_MAX_H = 600;
/**
 * Where a lift goes: `w` (default LIFT_W) at `at` (default: centred, near the top), its height from
 * the page's proportions, shrunk (uniformly) to stay inside the section.
 */
export function placeLift(src: PageRect, aspect: number, at?: Pt, w0?: number): { at: Pt; w: number; h: number } {
  const ratio = (src.h * aspect) / src.w; // section h per section w
  let w = w0 ?? Math.min(LIFT_W, LIFT_MAX_H / ratio);
  const x = at ? Math.max(0, Math.min(at.x, 990)) : null, y = at ? Math.max(0, Math.min(at.y, REGION_H - 10)) : LIFT_TOP;
  w = Math.min(w, 1000 - (x ?? 0), (REGION_H - y) / ratio);
  return { at: { x: x ?? (1000 - w) / 2, y }, w, h: w * ratio };
}
/** Page point → its place on a lift (null outside the lifted rect, with a little slack). */
export function onLift(l: LiftPlace, p: Pt, aspect: number): Pt | null {
  const s = 2;
  if (p.x < l.src.x - s || p.x > l.src.x + l.src.w + s || p.y < l.src.y - s || p.y > l.src.y + l.src.h + s) return null;
  const k = l.w / l.src.w;
  return { x: l.at.x + (p.x - l.src.x) * k, y: l.at.y + (p.y - l.src.y) * aspect * k };
}
/** Page (model coords) → data on a chart: the inverse of chartToPage. */
function pageToData(c: { x: ChartAxis; y: ChartAxis }, p: Pt): Pt | null {
  const inv = (a: ChartAxis, q: number) => {
    const t = (q - a.p0) / (a.p1 - a.p0);
    return a.log ? 10 ** (Math.log10(a.lo) + t * (Math.log10(a.hi) - Math.log10(a.lo))) : a.lo + t * (a.hi - a.lo);
  };
  const x = inv(c.x, p.x), y = inv(c.y, p.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}
/** A mark's point: a dot, a line's end (`.a`/`.b`) or middle, a box's centre. */
function markPoint(m: Exclude<GroundMark, { kind: 'chart' }>, end?: string): Pt {
  if (m.kind === 'dot') return m.at;
  if ('from' in m) return end === 'a' ? m.from : end === 'b' ? m.to : mid(m.from, m.to);
  return { x: m.rect.x + m.rect.w / 2, y: m.rect.y + m.rect.h / 2 };
}
/** A mark's extent on its page. */
function markRect(m: GroundMark): PageRect {
  if (m.kind === 'dot') return { x: m.at.x - 4, y: m.at.y - 4, w: 8, h: 8 };
  if ('from' in m) return boxOf2(m.from, m.to);
  return m.rect;
}
const ptFields = ['at', 'from', 'to', 'near'] as const;

/**
 * Per-answer geometry state: one Figure per page and region. `note` runs on every action as soon as
 * it is parsed (lookahead: definitions and the fit's extent); `resolve` runs when the action is
 * built, and returns a plain Action, null (a `let`: nothing to draw), or a skip reason.
 */
export class Figures {
  private figs = new Map<string, Figure>();
  private fitted = new Set<string>();
  /** Element ids per target (`r:s:X`): a connector end naming one waits for that element. */
  private elements = new Set<string>();
  /** Readout names ({{find}}): points the kit places on their plot when built (like a block's part). */
  private readouts = new Set<string>();
  constructor(private ground: Grounding) {}

  clear(): void { this.figs.clear(); this.fitted.clear(); this.elements.clear(); this.readouts.clear(); this.lifts.clear(); }

  figure(t: FigKey): Figure {
    const k = key(t);
    let f = this.figs.get(k);
    if (!f) {
      const page = t.page, chart = t.chart, region = t.region;
      f = new Figure(this.fitted.has(k), (id) => {
        const [base, end] = id.split('.');
        // A section: a page mark on a figure lifted into it (the latest lift that holds it).
        if (region != null) return this.throughLift(region, base, end);
        if (page == null) return undefined;
        const m = this.ground.mark(page, base);
        if (!m || m.kind === 'chart') return undefined;
        const p = markPoint(m, end);
        if (!chart) return p;
        // On a chart, a page mark is the data point under it.
        const c = this.ground.mark(page, chart);
        return c?.kind === 'chart' ? pageToData(c, p) ?? undefined : undefined;
      });
      this.figs.set(k, f);
    }
    return f;
  }

  /** Lifts per section, in stream order (each placed once, when first needed). */
  private lifts = new Map<string, LiftRaw[]>();
  private placed = new WeakMap<object, LiftPlace | string>();
  /** A lift's place, or why it cannot be placed (unknown mark, page not grounded). */
  liftPlace(a: LiftRaw): LiftPlace | string {
    const got = this.placed.get(a);
    if (got) return got;
    let out: LiftPlace | string;
    const aspect = this.ground.aspect?.(a.srcPage);
    const m = a.srcMark ? this.ground.mark(a.srcPage, a.srcMark) : undefined;
    if (a.srcMark && !m) out = `unknown mark ${a.srcMark}`;
    else if (!aspect) out = `page ${a.srcPage} is not grounded`;
    else {
      const src = m ? markRect(m) : a.src!;
      const at = a.at && isLiteral(a.at) ? a.at : undefined;
      out = src.w > 0 && src.h > 0 ? { page: a.srcPage, src, ...placeLift(src, aspect, at, a.w) } : 'empty lift';
    }
    // Not grounded yet: tried again next time (the grounding may arrive after the tag is parsed).
    if (typeof out !== 'string' || !out.endsWith('not grounded')) this.placed.set(a, out);
    return out;
  }
  private throughLift(region: string, base: string, end?: string): Pt | undefined {
    for (const l of [...(this.lifts.get(region) ?? [])].reverse()) {
      const pl = this.liftPlace(l);
      if (typeof pl === 'string') continue;
      const m = this.ground.mark(pl.page, base);
      if (!m || m.kind === 'chart') continue;
      const p = onLift(pl, markPoint(m, end), this.ground.aspect?.(pl.page) ?? 1);
      if (p) return p;
    }
    return undefined;
  }

  /** Lookahead: called for every parsed action, in stream order. */
  note(a: RawAction): void {
    if (a.kind === 'find') { this.readouts.add(a.id); return; }
    if (a.kind === 'sketch') { if (a.fit) this.fitted.add(`r:${a.id}`); return; }
    if (a.kind === 'let') { const f = this.figure(tgt(a)); for (const [n, p] of a.defs) f.define(n, p); return; }
    if (a.kind === 'lift' && a.region != null) { const ls = this.lifts.get(a.region) ?? []; ls.push(a); this.lifts.set(a.region, ls); }
    if (!('page' in a) && !('region' in a)) return;
    if (a.kind === 'scroll' || 'ref' in a || 'mark' in a || SCENE_KINDS.has(a.kind)) return;
    const f = this.figure(tgt(a as { page?: number; region?: string }));
    const x = a as Record<string, unknown>;
    for (const k of [...ptFields, 'through'] as const) if (x[k]) f.note(x[k] as PtArg);
    if (Array.isArray(x.pts)) for (const p of x.pts as PtArg[]) f.note(p);
    // Sized elements reach past their anchor: a fitted region frames all of them, not just their anchors.
    if (f.fitted && x.at) {
      const n = (k: string) => (typeof x[k] === 'number' ? (x[k] as number) : undefined);
      const w = n('w'), h = n('h'), rx = n('rx') ?? n('r'), ry = n('ry') ?? n('r');
      if (a.kind === 'box' && w != null && h != null) f.noteSpan(x.at as PtArg, [{ x: w, y: h }]);
      else if (a.kind === 'axes' && w != null && h != null) f.noteSpan(x.at as PtArg, [{ x: w, y: -h }]);
      else if ((a.kind === 'circle' || a.kind === 'shade') && rx != null && ry != null) f.noteSpan(x.at as PtArg, [{ x: -rx, y: -ry }, { x: rx, y: ry }]);
    }
    // Named elements are named points: a point at its centre, a line at its ends.
    const id = x.id as string | undefined;
    if (id) this.elements.add(`${key(tgt(a as { page?: number; region?: string }))}:${id}`);
    if (id && a.kind === 'point') f.define(id, x.at as PtArg);
    if (id && (a.kind === 'line' || a.kind === 'arrow') && x.to) { f.define(`${id}.a`, x.from as PtArg); f.define(`${id}.b`, x.to as PtArg); }
  }

  resolve(a: RawAction): Action | null | string {
    if (a.kind === 'let') return null;
    if (a.kind === 'sketch' || a.kind === 'scroll' || a.kind === 'clear' || 'ref' in a || SCENE_KINDS.has(a.kind)) return a as Action;
    if (a.kind === 'connect') {
      // Page marks resolve here; quotes, ids and coords resolve in the toolkit.
      const named = (e: RawEnd) => 'ref' in e && !this.elements.has(`r:${e.region}:${e.ref}`) && this.figure({ region: e.region }).has(e.ref);
      if (!('mark' in a.from) && !('mark' in a.to) && !named(a.from) && !named(a.to)) return a as Action;
      const from = this.markEnd(a.from), to = this.markEnd(a.to);
      if (typeof from === 'string') return from;
      if (typeof to === 'string') return to;
      return { ...a, from, to };
    }
    if ('mark' in a) return this.markShape(a);
    if (a.kind === 'lift') {
      if (this.fitted.has(`r:${a.region}`)) return 'lift needs a plain sketch (not fit)';
      const pl = this.liftPlace(a as LiftRaw);
      if (typeof pl === 'string') return pl;
      const { srcMark: _m, ...rest } = a;
      return { ...rest, src: pl.src, at: pl.at, w: pl.w, h: pl.h } as Action;
    }
    const t = tgt(a as { page?: number; region?: string; chart?: string });
    const f = this.figure(t);
    const h = t.region != null ? REGION_H : 1000;
    // A chart's data → page map (the chart must be calibrated in this page's grounding).
    const ch = t.chart != null ? this.ground.mark(t.page!, t.chart) : undefined;
    if (t.chart != null && ch?.kind !== 'chart') return `unknown chart ${t.chart}`;
    const chart = ch?.kind === 'chart' ? ch : undefined;
    const local = (p: PtArg): Pt | string => {
      // A kit block's part (g[2,3]): its place exists only once the block is laid out, so the kit resolves it when built.
      if (t.region != null && !isLiteral(p) && 'ref' in p && (isBlockRef(p.ref) || (this.readouts.has(p.ref) && !f.has(p.ref)))) return p as unknown as Pt;
      const w = f.world(p);
      if (!('x' in w)) return 'missing' in w ? `unknown point ${w.missing}` : w.degenerate;
      if (chart) {
        const q = chartToPage(chart, w);
        return q ? { x: clamp(q.x, 1000), y: clamp(q.y, 1000) } : `${w.x},${w.y} is off ${t.chart}'s log axis`;
      }
      return t.region != null ? f.toLocal(w, h) : { x: clamp(w.x, 1000), y: clamp(w.y, 1000) };
    };
    const out: Record<string, unknown> = { ...a };
    delete out.chart;
    if (chart && a.kind === 'plot') {
      // On the chart's own axes: the domain defaults to its x axis; values off its y axis are cut.
      const xs = [chart.x.lo, chart.x.hi].sort((p, q) => p - q), ys = [chart.y.lo, chart.y.hi].sort((p, q) => p - q);
      out.onChart = { x: chart.x, y: chart.y, rect: chart.rect };
      if (!a.domainSrc && !a.domain && !a.t) out.domain = xs;
      if (!a.range) out.range = ys;
    }
    if (a.kind === 'annot') {
      if (a.annotate) {
        const m = this.ground.mark(a.page!, a.annotate);
        if (!m) return `unknown mark ${a.annotate}`;
        out.rect = markRect(m);
        delete out.annotate;
      }
      const avoid = this.ground.obstacles?.(a.page!);
      if (avoid?.length) out.avoid = avoid;
    }
    if ('through' in a) {
      const from = local(a.from), via = local(a.through);
      if (typeof from === 'string') return from;
      if (typeof via === 'string') return via;
      const len = a.len ?? (t.region != null ? null : PAGE_RAY_LEN);
      const to = len != null ? { x: from.x + len * (via.x - from.x), y: from.y + len * (via.y - from.y) } : rayEnd(from, via, 1000, h);
      if (!to) return 'ray with no direction';
      delete out.through; delete out.len;
      return { ...out, from, to: { x: clamp(to.x, 1000), y: clamp(to.y, h) } } as Action;
    }
    for (const k of ptFields) {
      if (out[k] == null) continue;
      const p = local(out[k] as PtArg);
      if (typeof p === 'string') { if (k === 'near') { delete out.near; continue; } return p; }
      out[k] = p;
    }
    if (Array.isArray(out.pts)) {
      const ps = (out.pts as PtArg[]).map(local);
      const bad = ps.find((p) => typeof p === 'string');
      if (bad) return bad as string;
      out.pts = ps;
    }
    // World lengths scale with a fitted region (radii, axes sizes); text sizes are screen px and don't.
    if (t.region != null && f.fitted) for (const k of ['rx', 'ry', 'r', 'w', 'h'] as const) if (typeof out[k] === 'number') out[k] = f.scaleLen(out[k] as number);
    // Boxes and axes stay inside their target (axes grow up from their origin).
    const at = out.at as Pt | undefined;
    if (at && a.kind === 'box' && typeof out.w === 'number' && 'x' in at && !out.centered) { out.w = Math.min(out.w as number, 1000 - at.x); out.h = Math.min(out.h as number, h - at.y); }
    if (at && a.kind === 'axes' && 'x' in at) { out.w = Math.min(out.w as number, 1000 - at.x); out.h = Math.min(out.h as number, at.y); }
    // Unchanged (all literal, in range, unfitted): hand back the same object, so identity-keyed
    // bookkeeping (debug timings, tests) sees the action it ran.
    return sameShape(out, a as Record<string, unknown>) ? (a as Action) : (out as Action);
  }

  /** A connector end on a page mark (or a let-only name): a dot or line end → its point, a line → its midpoint, text → its quote, else its box. */
  private markEnd(e: RawEnd): End | string {
    // A region end naming a point that only a {{let}} defines (no element has that id): the point itself.
    if ('ref' in e && !this.elements.has(`r:${e.region}:${e.ref}`)) {
      const f = this.figure({ region: e.region });
      if (f.has(e.ref)) {
        const w = f.world({ ref: e.ref });
        if (!('x' in w)) return 'missing' in w ? `unknown point ${w.missing}` : w.degenerate;
        return { region: e.region, at: f.toLocal(w, REGION_H) };
      }
    }
    if (!('mark' in e)) return e;
    const [base, end] = e.mark.split('.');
    const m = this.ground.mark(e.page, base);
    if (!m) return `unknown mark ${e.mark}`;
    if (end && !('from' in m)) return `${base} is not a line`;
    if (m.kind === 'dot') return { page: e.page, at: m.at };
    if ('from' in m) return { page: e.page, at: end === 'a' ? m.from : end === 'b' ? m.to : mid(m.from, m.to) };
    if (m.kind === 'text') return { page: e.page, quote: m.text, near: { x: m.rect.x + m.rect.w / 2, y: m.rect.y + m.rect.h / 2 } };
    return { page: e.page, rect: m.rect };
  }

  private markShape(a: Extract<RawAction, { mark: string }>): Action | string {
    const m = this.ground.mark(a.page, a.mark);
    if (!m) return `unknown mark ${a.mark}`;
    const base = { page: a.page, ...(a.id ? { id: a.id } : {}), ...(a.em ? { em: true } : {}), ...(a.weight ? { weight: a.weight } : {}) };
    const dash = a.dash ? { dash: true } : {};
    if (a.kind === 'line' || a.kind === 'arrow') {
      if (m.kind !== 'line' && m.kind !== 'arrow') return `${a.mark} is not a line`;
      return { kind: a.kind, ...base, from: m.from, to: m.to, ...dash };
    }
    if (a.kind === 'highlight' || a.kind === 'underline') {
      if (m.kind !== 'text') return `${a.mark} is not text`;
      const near = { x: m.rect.x + m.rect.w / 2, y: m.rect.y + m.rect.h / 2 };
      return a.kind === 'highlight' ? { kind: 'highlight', ...base, quote: m.text, near } : { kind: 'underline', ...base, quote: m.text, near };
    }
    // circle / box around the mark's extent, padded; a dot gets a circle of radius 14.
    const r: PageRect = m.kind === 'dot' ? { x: m.at.x - 8, y: m.at.y - 8, w: 16, h: 16 }
      : 'from' in m ? boxOf2(m.from, m.to) : m.rect;
    if (a.kind === 'box') return { kind: 'box', ...base, at: { x: r.x - MARK_PAD, y: r.y - MARK_PAD }, w: r.w + 2 * MARK_PAD, h: r.h + 2 * MARK_PAD };
    // An ellipse that encloses the rect: semi-axes w/√2, h/√2 (+ pad). ry is in x units (rule).
    return { kind: 'circle', ...base, at: { x: r.x + r.w / 2, y: r.y + r.h / 2 }, rx: r.w / Math.SQRT2 + MARK_PAD, ry: r.h / Math.SQRT2 + MARK_PAD, ...dash };
  }
}

function sameShape(x: Record<string, unknown>, y: Record<string, unknown>): boolean {
  const ks = new Set([...Object.keys(x), ...Object.keys(y)]);
  for (const k of ks) if (JSON.stringify(x[k]) !== JSON.stringify(y[k])) return false;
  return true;
}
const clamp = (n: number, hi: number) => Math.min(hi, Math.max(0, n));
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const boxOf2 = (a: Pt, b: Pt): PageRect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
void isLiteral;
