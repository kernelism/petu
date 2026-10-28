// src/geometry/resolve.ts
import { REGION_H, type Action, type End, type Pt, type RawAction, type RawEnd, type Target } from '../script/types';
import { isBlockRef, isLiteral, type PtArg } from '../script/pointExpr';
import { Figure, rayEnd } from './figure';
import type { PageRect } from './space';

/** What the grounding knows about one page mark (model coords). */
export type GroundMark =
  | { kind: 'dot'; at: Pt }
  | { kind: 'line' | 'arrow'; from: Pt; to: Pt }
  | { kind: 'box' | 'image' | 'figure' | 'equation'; rect: PageRect }
  | { kind: 'text'; rect: PageRect; text: string };
export type Grounding = { mark(page: number, id: string): GroundMark | undefined };

/** Pages: a ray without `len` stops at 1.5 × |AB| (a page has no frame to run to). */
export const PAGE_RAY_LEN = 1.5;
/** Padding around a mark that a circle or box encloses (page x units). */
export const MARK_PAD = 6;

const key = (t: Target) => (t.region != null ? `r:${t.region}` : `p:${t.page}`);
const tgt = (a: { page?: number; region?: string }): Target => (a.region != null ? { region: a.region } : { page: a.page! });
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
  constructor(private ground: Grounding) {}

  clear(): void { this.figs.clear(); this.fitted.clear(); this.elements.clear(); }

  figure(t: Target): Figure {
    const k = key(t);
    let f = this.figs.get(k);
    if (!f) {
      const page = t.page;
      f = new Figure(this.fitted.has(k), (id) => {
        if (page == null) return undefined;
        const [base, end] = id.split('.');
        const m = this.ground.mark(page, base);
        if (!m) return undefined;
        if (m.kind === 'dot') return m.at;
        if ('from' in m) return end === 'a' ? m.from : end === 'b' ? m.to : mid(m.from, m.to);
        return { x: m.rect.x + m.rect.w / 2, y: m.rect.y + m.rect.h / 2 };
      });
      this.figs.set(k, f);
    }
    return f;
  }

  /** Lookahead: called for every parsed action, in stream order. */
  note(a: RawAction): void {
    if (a.kind === 'sketch') { if (a.fit) this.fitted.add(`r:${a.id}`); return; }
    if (a.kind === 'let') { const f = this.figure(tgt(a)); for (const [n, p] of a.defs) f.define(n, p); return; }
    if (!('page' in a) && !('region' in a)) return;
    if (a.kind === 'scroll' || 'ref' in a || 'mark' in a) return;
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
    if (a.kind === 'sketch' || a.kind === 'scroll' || a.kind === 'clear' || 'ref' in a) return a as Action;
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
    const t = tgt(a as { page?: number; region?: string });
    const f = this.figure(t);
    const h = t.region != null ? REGION_H : 1000;
    const local = (p: PtArg): Pt | string => {
      // A kit block's part (g[2,3]): its place exists only once the block is laid out, so the kit resolves it when built.
      if (t.region != null && !isLiteral(p) && 'ref' in p && isBlockRef(p.ref)) return p as unknown as Pt;
      const w = f.world(p);
      if (!('x' in w)) return 'missing' in w ? `unknown point ${w.missing}` : w.degenerate;
      return t.region != null ? f.toLocal(w, h) : { x: clamp(w.x, 1000), y: clamp(w.y, 1000) };
    };
    const out: Record<string, unknown> = { ...a };
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
