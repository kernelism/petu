// src/svgboard/settle.ts — the legibility floor's safety net: a label raised to the floor finds room.
/**
 * The renderer raises every text to the legibility floor (render.ts, LEGIBLE_PX on screen). A model
 * that laid its drawing out for smaller text (the 1000-wide canvas before p6.4, or any model output
 * today) leaves some labels no room at that size: they would run into a neighbour, across a stroke or
 * off the canvas. Shrinking them back under the floor made dense lane boards unreadable (8–10 px,
 * founder 2026-10-31), so a label keeps its size and moves instead:
 *  1. nudge: the smallest offset (up to half an em, eight directions) where it is clear;
 *  2. wrap: a label of several words breaks into two lines at its middle word (a row keeps its places);
 *  3. a longer nudge (up to 2 em);
 *  4. last resort: a little smaller (7% steps) but never under `hardMin`, nudging at each size.
 * Only collisions the raise created count (pairs that were clear at the model's own sizes and places),
 * so a model's deliberate composition (a label on its curve, behind the paper halo) is left alone.
 * Pure over the parsed XML; geometry is the gate's (check.ts groupGeometry: measured widths in a
 * browser, estimates elsewhere). Texts placed by data (`data-at`) or under rotation are not moved.
 */
import { core, groupGeometry, I, mul, overlapArea, parseTransform, segHitsBox, type Box, type M, type Seg, type TextBox } from './check';
import { inkBox } from './grammar';

const SVGNS = 'http://www.w3.org/2000/svg';
const num = (v: string | null | undefined, d = 0): number => { const n = v == null ? NaN : parseFloat(v); return Number.isFinite(n) ? n : d; };
const r2 = (v: number) => String(Math.round(v * 100) / 100);
const matOf = (el: Element, root: Element): M => { const chain: Element[] = []; for (let e: Element | null = el; e && e !== root.parentElement; e = e.parentElement) chain.unshift(e); return chain.reduce((m, e) => mul(m, parseTransform(e.getAttribute('transform'))), I); };
const isShift = (m: M) => Math.abs(m[0] - 1) < 1e-9 && Math.abs(m[3] - 1) < 1e-9 && Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9;

export type Drawn = { texts: TextBox[]; segs: Seg[] };

/** Room a text keeps from another (em of the smaller): its ink box, widened a little. */
const AIR = 0.08;
const airBox = (t: TextBox): Box => { const b = inkBox(t), a = AIR * t.fs; return { x: b.x - a, y: b.y - a / 2, w: b.w + 2 * a, h: b.h + a }; };
const textsHit = (a: TextBox, b: TextBox) => overlapArea(airBox(a), airBox(b)) > 0;

/** Moves a text (and its absolutely placed tspans) by (dx, dy). */
function shift(el: Element, dx: number, dy: number): void {
  for (const [k, d] of [['x', dx], ['y', dy]] as const) {
    if (!d) continue;
    el.setAttribute(k, r2(num(el.getAttribute(k)?.split(/[\s,]+/)[0]) + d));
    for (const s of Array.from(el.children)) if (s.hasAttribute(k)) s.setAttribute(k, r2(num(s.getAttribute(k)) + d));
  }
}

/** What a group's text `i` runs into: indexes of texts (same group, `t…`), earlier groups (`p…`), strokes (`s`), canvas edge (`e`). */
type Hits = Set<string>;

/**
 * Settles a prepared group's texts: `raw` is the group as the model wrote it (data resolved, its own
 * sizes), `prior` what earlier groups left on the board, `w` the canvas width; `hardMin` the smallest
 * size (units) a text may go to as a last resort. Returns how many texts still collide (for metrics).
 */
export function settle(g: Element, raw: Element, prior: Drawn, w: number, hardMin: number): number {
  const els = Array.from(g.querySelectorAll('text'));
  if (!els.length) return 0;
  const rawEls = Array.from(raw.querySelectorAll('text'));
  const geoOf = (root: Element) => { try { return groupGeometry(root, 0); } catch { return null; } };
  const rawGeo = geoOf(raw);
  if (!rawGeo) return 0;
  const segsOf = (geo: { segs: Seg[] }) => geo.segs.filter((s) => !s.tiny).concat(prior.segs.filter((s) => !s.tiny));
  /** Every collision of text i, given each text's boxes (several lines per text). */
  const hitsOf = (boxes: TextBox[][], segs: Seg[], i: number): Hits => {
    const out: Hits = new Set();
    for (const a of boxes[i]) {
      boxes.forEach((bs, j) => { if (j !== i && bs.some((b) => textsHit(a, b))) out.add(`t${j}`); });
      prior.texts.forEach((p, j) => { if (textsHit(a, p)) out.add(`p${j}`); });
      if (segs.some((s) => segHitsBox(s.a, s.b, core(a)))) out.add('s');
      if (a.x < -1 || a.x + a.w > w + 1 || a.y < -1) out.add('e');
    }
    return out;
  };
  const byEl = (geo: { texts: TextBox[] }, list: Element[]) => list.map((el) => geo.texts.filter((t) => t.el === el));
  const rawBoxes = byEl(rawGeo, rawEls), rawSegs = segsOf(rawGeo);
  const before = rawEls.map((_, i) => hitsOf(rawBoxes, rawSegs, i));
  const fresh = (h: Hits, i: number) => [...h].filter((k) => !before[i]?.has(k));
  let left = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < els.length; i++) {
      const geo = geoOf(g);
      if (!geo) return left;
      const boxes = byEl(geo, els), segs = segsOf(geo);
      if (!boxes[i]?.length || !fresh(hitsOf(boxes, segs, i), i).length) continue;
      const el = els[i];
      if (el.hasAttribute('data-at') || el.closest('[data-at]') || !isShift(matOf(el, g))) continue;
      if (place(el, i)) continue;
      if (pass === 1) left++;
    }
  }
  return left;

  /** Tries nudges, then a wrap, then smaller sizes, for text i; true once it is clear. */
  function place(el: Element, i: number): boolean {
    const tryHere = (reach: number): boolean => {
      const geo = geoOf(g);
      if (!geo) return false;
      const boxes = byEl(geo, els), segs = segsOf(geo);
      if (!fresh(hitsOf(boxes, segs, i), i).length) return true;
      const fs = boxes[i][0]?.fs ?? 16;
      const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0], [1, -1], [-1, -1], [1, 1], [-1, 1]];
      // An edge: first the shift that brings it inside.
      const x0 = Math.min(...boxes[i].map((b) => b.x)), x1 = Math.max(...boxes[i].map((b) => b.x + b.w));
      const edge = x1 > w ? w - x1 - 2 : x0 < 0 ? -x0 + 2 : 0;
      const cands: [number, number][] = edge ? [[edge, 0], [edge, -0.6 * fs], [edge, 0.6 * fs]] : [];
      for (const k of [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].filter((v) => v <= reach)) for (const [ux, uy] of dirs) { const n = Math.hypot(ux, uy); cands.push([edge + (ux / n) * k * fs, (uy / n) * k * fs]); }
      for (const [dx, dy] of cands) {
        const moved = boxes.map((bs, j) => (j === i ? bs.map((b) => ({ ...b, x: b.x + dx, y: b.y + dy })) : bs));
        if (fresh(hitsOf(moved, segs, i), i).length) continue;
        // Never onto another text's room either (its own hits must not grow).
        if (moved.some((_, j) => j !== i && fresh(hitsOf(moved, segs, j), j).some((k) => k === `t${i}`))) continue;
        shift(el, dx, dy);
        return true;
      }
      return false;
    };
    // A small nudge first; then, for a label of several words, two lines (a row of labels keeps its
    // places); then a longer move.
    if (tryHere(0.5)) return true;
    const words = (el.textContent ?? '').replace(/\s+/g, ' ').trim().split(' ');
    const snapshot = el.cloneNode(true) as Element;
    if (!el.children.length && words.length >= 2) {
      // Two lines, broken at the word that best halves it.
      let best = 1, bd = Infinity;
      const len = (a: string[]) => a.join(' ').length;
      for (let k = 1; k < words.length; k++) { const d = Math.abs(len(words.slice(0, k)) - len(words.slice(k))); if (d < bd) { bd = d; best = k; } }
      const x = el.getAttribute('x') ?? '0', fs = num(el.getAttribute('font-size'), 16);
      while (el.firstChild) el.removeChild(el.firstChild);
      [words.slice(0, best).join(' '), words.slice(best).join(' ')].forEach((s, k) => { const sp = el.ownerDocument.createElementNS(SVGNS, 'tspan'); sp.setAttribute('x', x); if (k) sp.setAttribute('dy', r2(1.15 * fs)); sp.textContent = s; el.appendChild(sp); });
      if (tryHere(0.5)) return true;
      restore(el, snapshot);
    }
    if (tryHere(2)) return true;
    // Last resort: a little smaller, never under hardMin.
    const fs0 = num(el.getAttribute('font-size'), 16);
    for (let fs = fs0 * 0.93; fs >= hardMin - 1e-6; fs *= 0.93) {
      el.setAttribute('font-size', r2(fs));
      if (tryHere(2)) return true;
    }
    restore(el, snapshot);
    return false;
  }
}

function restore(el: Element, snap: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
  for (const c of Array.from(snap.childNodes)) el.appendChild(c.cloneNode(true));
  for (const a of el.getAttributeNames()) el.removeAttribute(a);
  for (const a of snap.getAttributeNames()) el.setAttribute(a, snap.getAttribute(a)!);
}
