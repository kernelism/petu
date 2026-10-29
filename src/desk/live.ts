// src/desk/live.ts — live geometry on the board: elements whose points or lengths are formulas over
// the answer's constants (src/geometry/live.ts). Each is drawn once, as any element is (traced, its
// label written); from then on, whenever a constant changes (each frame of a {{tween}}, {{limit}} or
// {{beforeafter}}: KitStore.constsChanged) it is re-resolved and its ink is updated in place: the same
// paths get new geometry, its dot and labels glide with it. Once drawn is drawn: a moving thing is a
// transformation, never an erase and redraw. Labels are placed again each frame clear of every stroke
// (keeping their side while it stays clear, so they never flicker between sides). A point with `trace`
// leaves a faint path behind it.
import type { Action, RawAction, Target } from '../script/types';
import type { SPt, SRect } from '../geometry/space';
import type { Registry } from './registry';
import type { BuildEnv, TargetCtx } from './types';
import { arcStroke, arrowStrokes, bisector, circleStroke, curveStroke, lineStroke, type Stroke } from '../ink/agent/strokes';
import { toD } from '../ink/agent/animate';
import { weightStyle } from '../ink/agent/weights';
import { tokenNum } from '../ink/agent/tokens';
import { placeClear, segHitsRect, overlapArea } from './nudge';
import { boxOf, strokeBoxes, union } from './registry';
import { kitStore } from './kit/kit';

const SVG = 'http://www.w3.org/2000/svg';
/** Room around a section labels may use (as elements.ts bounds). */
const BLEED = 40;
/** A trace keeps a new point once the dot has moved this far (CSS px). */
const TRACE_STEP_PX = 2.5;
const TRACE_MAX = 4000;

type Item = {
  id: string;
  resolve: () => Action | null | string;
  ctx: TargetCtx;
  env: BuildEnv;
  /** The label's offset from its anchor (kept while clear), and the box it was first written at. */
  label?: { box0: SRect; off: SPt; nat: SPt; g: SVGGElement; dir: string };
  /** text/write: where it was first written (its `at`), and its words (a readout's number follows them). */
  text?: { at0: SPt; words: string; unit?: string; num: string; g: SVGGElement; box0: SRect };
  trace?: { path: SVGPathElement; pts: SPt[]; id: string };
};

const children = (g: Element, tag: string) => Array.from(g.children).filter((c) => c.tagName.toLowerCase() === tag);
const bounds = (ctx: TargetCtx): SRect => (ctx.target.region != null ? { x: -BLEED, y: -BLEED, w: 1000 + 2 * BLEED, h: ctx.h + 2 * BLEED } : { x: 0, y: 0, w: 1000, h: ctx.h });
const translate = (g: SVGGElement, dx: number, dy: number) => g.setAttribute('transform', `translate(${dx.toFixed(2)} ${dy.toFixed(2)})`);
const sameTarget = (a: Target, b: Target) => (a.region != null ? a.region === b.region : a.page === b.page);

export class LiveGeo {
  private items: Item[] = [];
  private unsub: (() => void) | null = null;
  private n = 0;
  constructor(private registry: Registry) {}

  /** An id for a live element the script left unnamed (it must be found again each frame). */
  anonId(): string { return `_live${++this.n}`; }

  /**
   * Starts following a live element once it has been drawn (its registry entry exists): `raw` is
   * re-resolved by `resolve` whenever a constant changes.
   */
  async add(id: string, raw: RawAction, resolve: () => Action | null | string, env: BuildEnv): Promise<void> {
    const e = this.registry.get(id);
    if (!e) return;
    const ctx = await env.ctx(e.target);
    if (typeof ctx === 'string') return;
    const it: Item = { id, resolve, ctx, env };
    const a = resolve();
    if (a && typeof a === 'object') {
      const tg = children(e.group, 'g')[0] as SVGGElement | undefined;
      if ((a.kind === 'point' || a.kind === 'angle') && tg && 'text' in a && a.text) {
        const anchor = a.kind === 'point' ? ctx.toSpace(a.at) : labelTip(a, ctx);
        const lb = a.kind === 'point' ? e.boxes[1] : textBox(tg, anchor);
        if (lb) { const off = { x: lb.x - anchor.x, y: lb.y - anchor.y }; it.label = { box0: lb, off, nat: off, g: tg, dir: a.kind === 'point' ? a.dir ?? 'ne' : 'e' }; }
      }
      if ((a.kind === 'label' || a.kind === 'write') && 'at' in a && tg) {
        const r = raw as { text?: string; unit?: string };
        const words = r.text ?? a.text;
        const num = a.text.length > words.length ? a.text.slice(words.length + 1, r.unit ? -(r.unit.length + 1) : undefined) : '';
        it.text = { at0: ctx.toSpace(a.at), words, unit: r.unit, num, g: tg, box0: e.bbox };
      }
      if (a.kind === 'point' && (raw as { trace?: boolean }).trace) {
        const c = ctx.toSpace(a.at);
        const ws = weightStyle('faint', env.settings.inkStyle === 'hand');
        const path = document.createElementNS(SVG, 'path') as SVGPathElement;
        for (const [k, v] of Object.entries({ fill: 'none', stroke: ws.color, 'stroke-width': ws.width, 'stroke-opacity': Math.min(0.55, ws.opacity), 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke', 'data-trace': '' })) path.setAttribute(k, String(v));
        // Behind every stroke and text of the section (a sheet).
        const layer = ctx.layers.agent;
        const first = Array.from(layer.children).find((x) => !x.hasAttribute('data-sheet'));
        layer.insertBefore(path, first ?? null);
        const tid = this.registry.define({ kind: 'trace', target: e.target, bbox: { x: c.x, y: c.y, w: 0, h: 0 }, boxes: [], anchor: c, group: path as unknown as SVGGElement, strokes: [[c]] });
        it.trace = { path, pts: [c], id: tid };
      }
    }
    this.items.push(it);
    if (!this.unsub) {
      const store = kitStore(this.registry);
      this.unsub = store.onConsts(() => this.refresh());
      store.liveBox = () => this.box();
    }
    this.update(it); // catch up with a constant that changed while it was drawing
  }

  /** Every live element follows the constants as they stand now. */
  refresh(): void { for (const it of this.items) this.update(it); }

  /** Where live geometry sits (the latest live element's target): a tween frames it. */
  box(): { target: Target; bbox: SRect } | null {
    const last = this.items[this.items.length - 1];
    const e = last && this.registry.get(last.id);
    if (!e) return null;
    const es = this.items.map((x) => this.registry.get(x.id)).filter((x): x is NonNullable<typeof x> => !!x && sameTarget(x.target, e.target));
    return { target: e.target, bbox: union(es.map((x) => x.bbox)) };
  }

  clear(): void { this.items = []; this.unsub = null; }

  private update(it: Item): void {
    const a = it.resolve();
    const e = this.registry.get(it.id);
    // A frame where it does not resolve (a construction degenerate for a moment) keeps the last state.
    if (!a || typeof a !== 'object' || !e) return;
    const { ctx } = it;
    const P = (p: { x: number; y: number }) => ctx.toSpace(p);
    const setPaths = (strokes: Stroke[]) => {
      const ps = children(e.group, 'path');
      strokes.forEach((s, i) => ps[i]?.setAttribute('d', toD(s)));
      const boxes = strokeBoxes(strokes);
      const last = strokes[strokes.length - 1];
      this.registry.update(it.id, { strokes, boxes, bbox: union(boxes), anchor: last[last.length - 1], ...(e.outline ? { outline: strokes[0] } : {}) });
    };
    switch (a.kind) {
      case 'line': setPaths([lineStroke(P(a.from), P(a.to), null)]); break;
      case 'arrow': setPaths(arrowStrokes(P(a.from), P(a.to), null)); break;
      case 'curve': setPaths([curveStroke(a.pts.map(P), null)]); break;
      case 'circle': if ('at' in a) setPaths([circleStroke(P(a.at), a.rx, a.ry, null)]); break;
      case 'angle': {
        const c = P(a.at), rad = a.r ?? 28 / Math.max(ctx.scale(), 1e-3);
        setPaths([arcStroke(c, P(a.from), P(a.to), rad)]);
        if (it.label) this.placeLabel(it, labelTip(a, ctx), 0);
        break;
      }
      case 'point': {
        const c = P(a.at);
        const dot = children(e.group, 'circle')[0];
        dot?.setAttribute('cx', String(c.x)); dot?.setAttribute('cy', String(c.y));
        const rad = tokenNum('--ink-dot-r') / Math.max(ctx.scale(), 1e-3);
        const db = { x: c.x - rad, y: c.y - rad, w: rad * 2, h: rad * 2 };
        this.registry.update(it.id, { anchor: c, bbox: db, boxes: [db] });
        if (it.trace) this.extendTrace(it, c);
        if (it.label) this.placeLabel(it, c, rad, true);
        break;
      }
      case 'label':
      case 'write': {
        if (!it.text || !('at' in a)) break;
        const at = P(a.at), d = { x: at.x - it.text.at0.x, y: at.y - it.text.at0.y };
        translate(it.text.g, d.x, d.y);
        const num = a.text.length > it.text.words.length ? a.text.slice(it.text.words.length + 1, it.text.unit ? -(it.text.unit.length + 1) : undefined) : '';
        if (num !== it.text.num) { replaceLast(it.text.g, it.text.num, num); it.text.num = num; }
        const b = textBox(it.text.g, at) ?? { ...it.text.box0, x: it.text.box0.x + d.x, y: it.text.box0.y + d.y };
        this.registry.update(it.id, { bbox: b, boxes: [b], anchor: { x: b.x, y: b.y + b.h / 2 } });
        break;
      }
      case 'shade': {
        const el = e.group.querySelector('polygon, ellipse');
        if (!el) break;
        if ('pts' in a) el.setAttribute('points', a.pts.map((p) => { const q = P(p); return `${q.x},${q.y}`; }).join(' '));
        else { const c = P(a.at); el.setAttribute('cx', String(c.x)); el.setAttribute('cy', String(c.y)); el.setAttribute('rx', String(a.rx)); el.setAttribute('ry', String(a.ry)); }
        const pts = 'pts' in a ? a.pts.map(P) : Array.from({ length: 48 }, (_, i) => { const c = P(a.at); return { x: c.x + a.rx * Math.cos((i / 48) * 2 * Math.PI), y: c.y + a.ry * Math.sin((i / 48) * 2 * Math.PI) }; });
        this.registry.update(it.id, { bbox: boxOf(pts), outline: pts });
        break;
      }
    }
  }

  /** The label beside its moving anchor: on the side it had while that stays clear, else the clearest side now. */
  private placeLabel(it: Item, anchor: SPt, clear: number, outside = false): void {
    const L = it.label!, { ctx } = it;
    const w = L.box0.w, h = L.box0.h;
    const segs = this.registry.segments(ctx.target);
    const obst = this.registry.obstacles(ctx.target, it.id);
    const b = bounds(ctx);
    const clean = (r: SRect) => r.x >= b.x && r.y >= b.y && r.x + w <= b.x + b.w && r.y + h <= b.y + b.h && !segs.some((s) => segHitsRect(s, r)) && obst.every((o) => overlapArea(r, o) === 0);
    // Its first side when that is clear again, else the side it has now while clear, else the clearest side.
    const nat = { x: anchor.x + L.nat.x, y: anchor.y + L.nat.y, w, h }, keep = { x: anchor.x + L.off.x, y: anchor.y + L.off.y, w, h };
    const r = clean(nat) ? nat : clean(keep) ? keep : placeClear(anchor, w, h, L.dir as never, clear, segs, obst, b, outside ? this.registry.outlines(ctx.target) : []);
    L.off = { x: r.x - anchor.x, y: r.y - anchor.y };
    translate(L.g, r.x - L.box0.x, r.y - L.box0.y);
    // The shape's own boxes were just set; the label's joins them.
    const e = this.registry.get(it.id);
    if (e) this.registry.update(it.id, { boxes: [...e.boxes, r], bbox: union([e.bbox, r]) });
  }

  private extendTrace(it: Item, c: SPt): void {
    const t = it.trace!;
    const last = t.pts[t.pts.length - 1];
    if (Math.hypot(c.x - last.x, c.y - last.y) * it.ctx.scale() < TRACE_STEP_PX || t.pts.length >= TRACE_MAX) return;
    t.pts.push(c);
    t.path.setAttribute('d', toD(t.pts));
    this.registry.update(t.id, { strokes: [t.pts], bbox: boxOf(t.pts), anchor: c });
  }
}

/** Where an angle's label sits: beyond its arc on the bisector (as elements.ts draws it). */
function labelTip(a: Extract<Action, { kind: 'angle' }>, ctx: TargetCtx): SPt {
  const c = ctx.toSpace(a.at), px = (n: number) => n / Math.max(ctx.scale(), 1e-3), rad = a.r ?? px(28);
  const b = bisector(c, ctx.toSpace(a.from), ctx.toSpace(a.to));
  return { x: c.x + b.x * (rad + px(10)), y: c.y + b.y * (rad + px(10)) };
}

/** A text group's box (target units), from its element's own measure when the browser has one. */
function textBox(g: SVGGElement, at: SPt): SRect | null {
  const t = g.querySelector('text') as SVGTextElement | null;
  if (!t || typeof (t as SVGGraphicsElement).getBBox !== 'function') return null;
  try {
    const bb = (t as SVGGraphicsElement).getBBox();
    const tr = g.transform?.baseVal?.consolidate?.()?.matrix;
    return bb.width ? { x: bb.x + (tr?.e ?? 0), y: bb.y + (tr?.f ?? 0), w: bb.width, h: bb.height } : null;
  } catch { return { x: at.x, y: at.y, w: 0, h: 0 }; }
}

/** Replaces the last occurrence of `from` in a text element's runs with `to` (a readout's number). */
function replaceLast(g: SVGGElement, from: string, to: string): void {
  if (!from) return;
  const nodes: Text[] = [];
  const walk = (n: Node) => { n.childNodes.forEach((c) => (c.nodeType === 3 ? nodes.push(c as Text) : walk(c))); };
  walk(g);
  for (let i = nodes.length - 1; i >= 0; i--) {
    const s = nodes[i].data, k = s.lastIndexOf(from);
    if (k >= 0) { nodes[i].data = s.slice(0, k) + to + s.slice(k + from.length); return; }
  }
}

export const liveGeo = (r: Registry): LiveGeo => r.ext('live', () => new LiveGeo(r));
