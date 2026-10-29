// src/desk/registry.ts
import type { SPt, SRect } from '../geometry/space';
import type { Stroke } from '../ink/agent/strokes';
import type { Target } from '../script/types';

/** One drawn element of the current answer. Coordinates are target space. */
export type ElementEntry = {
  /** The script's id, or an internal `_n` for unnamed elements (they are still obstacles for labels). */
  id: string;
  kind: string;
  target: Target;
  /** The whole element. */
  bbox: SRect;
  /** Finer boxes for collision (a diagonal line is several small boxes, not one big one). */
  boxes: SRect[];
  /** Where `move` and ref labels attach: a point's center, a line's end, a label's text anchor. */
  anchor: SPt;
  /** The element's own group (emph / move / fade act on it). */
  group: SVGGElement;
  /** The traced strokes, for emph's re-trace. Text elements have none. */
  strokes?: Stroke[];
  /** A closed shape's outline (circle, box, shade): a point label on it goes outside. */
  outline?: SPt[];
  faded?: boolean;
};

/**
 * A label written beside an element (a point's name, a line's own label): `boxes[index]` of its owner.
 * `place` finds its clear spot again from where things are now; a later stroke that crosses it re-places it.
 */
export type PlacedLabel = { owner: string; index: number; text: string; group: SVGGElement; place(): SRect };

const sameTarget = (a: Target, b: Target) => (a.region != null ? a.region === b.region : a.page === b.page);

/** Elements of the current answer, by id (rule 4: ids are unique per answer). */
/** Kinds that are lines between things (their boxes sample the line). */
const LINES = new Set(['scene-link', 'connect', 'scene-pair']);

export class Registry {
  private byId = new Map<string, ElementEntry>();
  private waiters = new Map<string, ((e: ElementEntry) => void)[]>();
  private anon = 0;
  private placed: PlacedLabel[] = [];
  /** Per-answer state kept beside the registry (the visual kit's blocks): settled and cleared with it. */
  private exts = new Map<string, { settle?(): void; clear?(): void }>();

  /** The extension under `key`, made on first use. */
  ext<T extends { settle?(): void; clear?(): void }>(key: string, make: () => T): T {
    let e = this.exts.get(key) as T | undefined;
    if (!e) { e = make(); this.exts.set(key, e); }
    return e;
  }

  /** Animations still running jump to their end state (a stopped or replaced answer). */
  settle(): void { this.exts.forEach((e) => e.settle?.()); }

  /** Registers an element. A duplicate id is refused (warned): the element still draws, unnamed. Returns the id used. */
  define(e: Omit<ElementEntry, 'id'> & { id?: string }): string {
    let id = e.id;
    if (id && this.byId.has(id)) { console.warn('[desk] duplicate id, drawn unnamed:', id); id = undefined; }
    const entry: ElementEntry = { ...e, id: id ?? `_${++this.anon}` };
    this.byId.set(entry.id, entry);
    const w = this.waiters.get(entry.id);
    if (w) { this.waiters.delete(entry.id); w.forEach((r) => r(entry)); }
    return entry.id;
  }

  get(id: string): ElementEntry | undefined { return this.byId.get(id); }

  /** Every element of the current answer, in definition order. */
  entries(): ElementEntry[] { return [...this.byId.values()]; }

  /** The entry once it is defined, or undefined after `ms` (an element still waiting on its word). */
  wait(id: string, ms: number): Promise<ElementEntry | undefined> {
    const e = this.byId.get(id);
    if (e) return Promise.resolve(e);
    return new Promise((resolve) => {
      const list = this.waiters.get(id) ?? [];
      const done = (x?: ElementEntry) => { clearTimeout(t); resolve(x); };
      const t = setTimeout(() => {
        const l = this.waiters.get(id);
        if (l) { const i = l.indexOf(done); if (i >= 0) l.splice(i, 1); }
        resolve(undefined);
      }, ms);
      list.push(done);
      this.waiters.set(id, list);
    });
  }

  update(id: string, patch: Partial<Omit<ElementEntry, 'id'>>): void {
    const e = this.byId.get(id);
    if (e) Object.assign(e, patch);
  }

  /** Collision boxes of every element in `t`, except `skip` (and, with `solid`, except lines: links and connectors a route may cross). */
  obstacles(t: Target, skip?: string, solid = false): SRect[] {
    const out: SRect[] = [];
    for (const e of this.byId.values()) if (e.id !== skip && !e.faded && sameTarget(e.target, t) && !(solid && LINES.has(e.kind))) out.push(...e.boxes);
    return out;
  }

  /** Segments of every drawn stroke in `t` (faded elements excluded), for exact label placement. */
  segments(t: Target): { a: SPt; b: SPt }[] {
    const out: { a: SPt; b: SPt }[] = [];
    for (const e of this.byId.values()) {
      if (e.faded || !e.strokes || !sameTarget(e.target, t)) continue;
      for (const s of e.strokes) for (let i = 0; i + 1 < s.length; i++) out.push({ a: s[i], b: s[i + 1] });
    }
    return out;
  }

  /** Outlines of the closed shapes drawn in `t` (faded ones excluded). */
  outlines(t: Target): SPt[][] {
    const out: SPt[][] = [];
    for (const e of this.byId.values()) if (e.outline && !e.faded && sameTarget(e.target, t)) out.push(e.outline);
    return out;
  }

  /** Records a label beside its owner (see PlacedLabel). */
  addLabel(l: PlacedLabel): void { this.placed.push(l); }

  /** The labels in `t` with their owners' entries and current boxes (faded owners excluded). */
  labels(t: Target): (PlacedLabel & { entry: ElementEntry; box: SRect })[] {
    const out: (PlacedLabel & { entry: ElementEntry; box: SRect })[] = [];
    for (const l of this.placed) {
      const entry = this.byId.get(l.owner), box = entry?.boxes[l.index];
      if (entry && box && !entry.faded && sameTarget(entry.target, t)) out.push({ ...l, entry, box });
    }
    return out;
  }

  /** Every placed label's text and box (all targets, or `t`'s). */
  labelBoxes(t?: Target): { text: string; box: SRect }[] {
    return (t ? this.labels(t) : this.placed.flatMap((l) => { const e = this.byId.get(l.owner); return e ? this.labels(e.target).filter((x) => x.group === l.group) : []; }))
      .map((l) => ({ text: l.text, box: l.box }));
  }

  /** The most recent element of `kind` in `t` (plot finds its axes). */
  latest(t: Target, kind: string): ElementEntry | undefined {
    let last: ElementEntry | undefined;
    for (const e of this.byId.values()) if (e.kind === kind && sameTarget(e.target, t)) last = e;
    return last;
  }

  clear(): void {
    this.settle();
    this.exts.forEach((e) => e.clear?.());
    this.byId.clear();
    this.placed = [];
    this.anon = 0;
    // Pending waits resolve undefined on their own timers.
  }
}

/** Splits a polyline into ≤ `n` chunks and boxes each (padded by `pad`), for collision tests. */
export function strokeBoxes(strokes: Stroke[], n = 8, pad = 4): SRect[] {
  const out: SRect[] = [];
  for (const s of strokes) {
    if (!s.length) continue;
    const step = Math.max(1, Math.ceil((s.length - 1) / n));
    for (let i = 0; i < s.length - 1 || i === 0; i += step) {
      const seg = s.slice(i, Math.min(s.length, i + step + 1));
      out.push(boxOf(seg, pad));
      if (s.length === 1) break;
    }
  }
  return out;
}

/** Axis-aligned box of points, padded. */
export function boxOf(pts: SPt[], pad = 0): SRect {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const p of pts) { x1 = Math.min(x1, p.x); y1 = Math.min(y1, p.y); x2 = Math.max(x2, p.x); y2 = Math.max(y2, p.y); }
  return { x: x1 - pad, y: y1 - pad, w: x2 - x1 + 2 * pad, h: y2 - y1 + 2 * pad };
}

/** Union of rects. */
export function union(rs: SRect[]): SRect {
  return boxOf(rs.flatMap((r) => [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y + r.h }]));
}
