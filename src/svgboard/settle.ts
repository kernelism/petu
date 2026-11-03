// src/svgboard/settle.ts — one collision model for every text on the board: what counts, who moves, where to.
/**
 * Every text on the board is an obstacle and a mover by the same rule, whoever made it: the model's own
 * labels, labels the engine placed at a data point (`data-at`), the engine's own frame text (tick numbers,
 * data.ts drawFrame), and what earlier groups left. The renderer raises every text to the legibility floor
 * (render.ts, LEGIBLE_PX) and never shrinks one back (its size is its tier, grammar.ts), so a text with no
 * room moves.
 *
 * What counts as a collision of text i:
 *  - containment, always: off the canvas (`e`), across the edge of a shape it partly overlaps (`c`: a text is
 *    wholly inside a shape or wholly outside it, never half on a bar), inside an axis's number band (`b`,
 *    below): the model cannot compose a text half off its canvas or half across a fill;
 *  - against earlier groups, always (`p` texts, `q` strokes): the model could not see where the board put them;
 *  - against its own group (`t…` texts, `s` strokes), only what the model did not write: a pair counts unless
 *    both ends are where the model put them and they already met at the model's own sizes and places (a label
 *    the model set on its own curve stays). A text the engine placed (data-at, an engine tick) is never where
 *    the model put it, so every collision with it counts, from either side (D19: "P 10, Q 10" at dx=-12 dy=-12
 *    sat across its own demand line; a model's axis title under an engine tick was left on it, the pair
 *    having "always" collided).
 *
 * Who moves: the freest text first. A model label moves anywhere near; a data-placed label moves by dx/dy
 * only (x/y are its point's: a re-resolve or tween rewrites them and keeps the nudge); an engine tick never
 * moves (its place is the scale). A text whose collision is with a freer one waits for that one to move.
 *
 * Where to: the smallest nudge (eight directions, up to 2 em) that clears every counting collision of its own
 * and adds none to any other text. A text that does not fit its shape is placed whole, never split: centred
 * in it if it fits, else beside it (above, below, right, left; a leader back to it when it cannot sit
 * adjacent), set in ink when it leaves a fill it was light on. A model label of several words with no shape
 * of its own may break into two lines at its middle word (a row of labels keeps its places).
 *
 * Axis bands: a frame (a data-axes group with data-box that draws its axes or ticks) owns the band under its
 * x axis where its numbers are written (tick labels, and labels the model places on the axis, `pt(ax,v,0)`):
 * 8 units plus a line of the tier the ticks are set at. Only what is anchored on that axis may sit in it, so a
 * model's axis title written there moves out when the frame is drawn, before a later number lands on it (the
 * price-ceiling board: "rental units" under the axis, then "140" at its drop line, 2026-11-02). Bands carry to
 * later groups with the board (Drawn.bands, BoardState.bands).
 *
 * Pure over the parsed XML; geometry is the gate's (check.ts groupGeometry: measured widths in a browser,
 * estimates elsewhere); the gate and the renderer run it alike. Texts inside a data-at group or under
 * rotation are not moved.
 */
import { core, groupGeometry, I, mul, overlapArea, parseTransform, segHitsBox, type Box, type M, type Seg, type TextBox } from './check';
import { inkBox } from './grammar';
import { parseColor } from './style';

const SVGNS = 'http://www.w3.org/2000/svg';
const num = (v: string | null | undefined, d = 0): number => { const n = v == null ? NaN : parseFloat(v); return Number.isFinite(n) ? n : d; };
const r2 = (v: number) => String(Math.round(v * 100) / 100);
const tag = (e: Element) => e.nodeName.toLowerCase().replace(/^svg:/, '');
const matOf = (el: Element, root: Element): M => { const chain: Element[] = []; for (let e: Element | null = el; e && e !== root.parentElement; e = e.parentElement) chain.unshift(e); return chain.reduce((m, e) => mul(m, parseTransform(e.getAttribute('transform'))), I); };
const isShift = (m: M) => Math.abs(m[0] - 1) < 1e-9 && Math.abs(m[3] - 1) < 1e-9 && Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9;
const inherit = (el: Element, a: string): string | null => { for (let e: Element | null = el; e; e = e.parentElement) { const v = e.getAttribute(a); if (v != null) return v; } return null; };

/** An axis's number band: the room under an x axis (`at`: the axis line's y, from–to its extent). */
export type Band = Box & { at: number; from: number; to: number };
export type Drawn = { texts: TextBox[]; segs: Seg[]; bands?: Band[] };

/** Room a text keeps from another (em of the smaller): its ink box, widened a little. */
const AIR = 0.08;
const airBox = (t: TextBox): Box => { const b = inkBox(t), a = AIR * t.fs; return { x: b.x - a, y: b.y - a / 2, w: b.w + 2 * a, h: b.h + a }; };
const textsHit = (a: TextBox, b: TextBox) => overlapArea(airBox(a), airBox(b)) > 0;
const inside = (a: Box, b: Box, tol = 0.5) => a.x >= b.x - tol && a.y >= b.y - tol && a.x + a.w <= b.x + b.w + tol && a.y + a.h <= b.y + b.h + tol;

/** How a text was placed, freest first: the model's x/y, a data point (moves by dx/dy), an engine tick (pinned). */
type Placed = 'model' | 'data' | 'tick';
const placedOf = (el: Element): Placed => (el.hasAttribute('data-engine') ? 'tick' : el.hasAttribute('data-at') ? 'data' : 'model');
const RANK: Record<Placed, number> = { model: 0, data: 1, tick: 2 };

/** The point a text is anchored at (x/y before dx/dy), in group units. */
const anchorOf = (el: Element, g: Element) => { const m = matOf(el, g); return { x: num(el.getAttribute('x')?.split(/[\s,]+/)[0]) + m[4], y: num(el.getAttribute('y')?.split(/[\s,]+/)[0]) + m[5] }; };

/**
 * The number bands of a group's frames (see the header). `fs`: the size its ticks are set at (the board's
 * small tier); a frame's own engine ticks give it when present.
 */
export function axisBands(g: Element, fs: number): Band[] {
  const out: Band[] = [];
  const frames = [g, ...Array.from(g.querySelectorAll('[data-axes][data-box]'))].filter((e) => e.hasAttribute('data-box') && e.hasAttribute('data-axes') && (e.hasAttribute('data-frame') || e.hasAttribute('data-ticks-x')));
  for (const f of frames) {
    const m = matOf(f, g);
    if (!isShift(m)) continue;
    const [x, y, w, h] = (f.getAttribute('data-box') ?? '').split(/[\s,]+/).map(Number);
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) continue;
    const tickFs = num(f.querySelector(':scope > text[data-engine]')?.getAttribute('font-size'), fs);
    const at = y + h + m[5], depth = 8 + 1.2 * tickFs, pad = 0.6 * tickFs;
    out.push({ x: x + m[4] - pad, y: at, w: w + 2 * pad, h: depth, at, from: x + m[4], to: x + m[4] + w });
  }
  return out;
}
/** Whether a text anchored at `a` belongs in band `b` (it is written on that axis). */
const onAxis = (a: { x: number; y: number }, b: Band) => Math.abs(a.y - b.at) <= 1.5 && a.x >= b.from - 1 && a.x <= b.to + 1;

/** A closed shape of the group a text may sit in or be beside (rects, circles, ellipses). */
type Shape = { el: Element; box: Box; bound: boolean };
function shapesOf(g: Element): Shape[] {
  const out: Shape[] = [];
  for (const el of Array.from(g.querySelectorAll('rect,circle,ellipse'))) {
    if (el.closest('defs,marker,symbol,clipPath,clippath,pattern,[data-engine]') || el.hasAttribute('data-bad') || el.hasAttribute('data-leader')) continue;
    const fill = inherit(el, 'fill'), stroke = inherit(el, 'stroke');
    if ((fill === 'none' || fill === 'transparent') && (!stroke || stroke === 'none')) continue;
    const m = matOf(el, g);
    if (!isShift(m)) continue;
    const t = tag(el);
    const box = t === 'rect' ? { x: num(el.getAttribute('x')), y: num(el.getAttribute('y')), w: num(el.getAttribute('width')), h: num(el.getAttribute('height')) }
      : (() => { const cx = num(el.getAttribute('cx')), cy = num(el.getAttribute('cy')), rx = t === 'circle' ? num(el.getAttribute('r')) : num(el.getAttribute('rx')), ry = t === 'circle' ? rx : num(el.getAttribute('ry')); return { x: cx - rx, y: cy - ry, w: 2 * rx, h: 2 * ry }; })();
    if (!(box.w > 3 && box.h > 3)) continue;
    out.push({ el, box: { ...box, x: box.x + m[4], y: box.y + m[5] }, bound: !!el.closest('[data-at],[data-set],[data-axes]') || el.hasAttribute('data-at') });
  }
  return out;
}

/** Moves a text (and its absolutely placed tspans) by (dx, dy): through x/y, or its dx/dy when data places it. */
function shift(el: Element, dx: number, dy: number): void {
  const by = el.hasAttribute('data-at');
  for (const [k0, d] of [['x', dx], ['y', dy]] as const) {
    if (!d) continue;
    const k = by ? `d${k0}` : k0;
    el.setAttribute(k, r2(num(el.getAttribute(k)?.split(/[\s,]+/)[0]) + d));
    if (by) continue;
    for (const s of Array.from(el.children)) if (s.hasAttribute(k)) s.setAttribute(k, r2(num(s.getAttribute(k)) + d));
  }
}

/** What a group's text `i` runs into: texts (same group `t…`, earlier `p…`), strokes (own `s`, earlier `q`), canvas edge `e`, a shape's edge `c…`, a band `b`. */
type Hits = Set<string>;

/**
 * Settles a prepared group's texts: `raw` is the group as the model wrote it (data resolved, its own
 * sizes), `prior` what earlier groups left on the board, `w` the canvas width. Returns how many texts
 * still collide (for metrics).
 */
export function settle(g: Element, raw: Element, prior: Drawn, w: number): number {
  const els = Array.from(g.querySelectorAll('text'));
  if (!els.length) return 0;
  const geoOf = (root: Element) => { try { return groupGeometry(root, 0); } catch { return null; } };
  const rawGeo = geoOf(raw);
  if (!rawGeo) return 0;
  const segsOf = (geo: { segs: Seg[] }) => geo.segs.filter((s) => !s.tiny);
  const priorSegs = prior.segs.filter((s) => !s.tiny);
  const placed = els.map(placedOf);
  /** Engine-placed (data-at, a tick): the model could not see where it lands, so every hit with it counts. */
  const unseen = placed.map((p) => p !== 'model');
  const anchors = els.map((el) => anchorOf(el, g));
  const fsMin = Math.min(...els.map((el) => num(inherit(el, 'font-size'), 16)));
  const bands = [...(prior.bands ?? []), ...axisBands(g, fsMin)];
  const shapes = shapesOf(g);
  // The model's texts in `raw`, matched in order by their words (the prose pass may have removed some).
  const rawEls = Array.from(raw.querySelectorAll('text'));
  const words = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  const rawOf: number[] = [];
  for (let i = 0, k = 0; i < els.length; i++) { let j = k; while (j < rawEls.length && words(rawEls[j]) !== words(els[i])) j++; rawOf.push(j < rawEls.length ? j : -1); if (j < rawEls.length) k = j + 1; }
  /** Every collision of text i, given each text's boxes (several lines per text). */
  const hitsOf = (boxes: TextBox[][], segs: Seg[], i: number, anchor = anchors[i]): Hits => {
    const out: Hits = new Set();
    for (const a of boxes[i]) {
      // An engine-placed text keeps its air from strokes too: core()'s slack is for the model's own composition.
      const c = unseen[i] ? airBox(a) : core(a), ink = inkBox(a);
      boxes.forEach((bs, j) => { if (j !== i && bs.some((b) => textsHit(a, b))) out.add(`t${j}`); });
      prior.texts.forEach((p, j) => { if (textsHit(a, p)) out.add(`p${j}`); });
      if (segs.some((s) => segHitsBox(s.a, s.b, c))) out.add('s');
      if (priorSegs.some((s) => !(s.curve && a.on?.includes(s.curve)) && segHitsBox(s.a, s.b, c))) out.add('q');
      if (a.x < -1 || a.x + a.w > w + 1 || a.y < -1) out.add('e');
      shapes.forEach((s, k) => { if (overlapArea(ink, s.box) > 0 && !inside(ink, s.box)) out.add(`c${k}`); });
      if (placed[i] !== 'tick' && bands.some((b) => overlapArea(ink, b) > 0 && !onAxis(anchor, b))) out.add('b');
    }
    return out;
  };
  const byEl = (geo: { texts: TextBox[] }, list: Element[]) => list.map((el) => geo.texts.filter((t) => t.el === el));
  const rawBoxes = byEl(rawGeo, rawEls), rawSegs = segsOf(rawGeo);
  // As written: the pairs the model itself set together (its own text against its own text or stroke).
  const asWritten = rawEls.map((_, j) => {
    const out: Hits = new Set();
    for (const a of rawBoxes[j]) {
      rawBoxes.forEach((bs, k) => { if (k !== j && bs.some((b) => textsHit(a, b))) out.add(`r${k}`); });
      if (rawSegs.some((s) => segHitsBox(s.a, s.b, core(a)))) out.add('s');
    }
    return out;
  });
  const counts = (h: Hits, i: number): string[] => [...h].filter((k) => {
    if (k[0] !== 't' && k !== 's') return true;
    if (unseen[i]) return true;
    const ri = rawOf[i], was = ri >= 0 ? asWritten[ri] : null;
    if (k === 's') return !was?.has('s');
    const j = Number(k.slice(1));
    if (unseen[j]) return true;
    return !(was && rawOf[j] >= 0 && was.has(`r${rawOf[j]}`));
  });
  // Freest first; an engine tick never moves.
  const order = els.map((_, i) => i).filter((i) => placed[i] !== 'tick').sort((a, b) => RANK[placed[a]] - RANK[placed[b]] || a - b);
  let left = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (const i of order) {
      const geo = geoOf(g);
      if (!geo) return left;
      const boxes = byEl(geo, els), segs = segsOf(geo);
      if (!boxes[i]?.length || !counts(hitsOf(boxes, segs, i), i).length) continue;
      const el = els[i];
      // A data-placed text with placed lines stays (its dx moves only the first line).
      if ((unseen[i] ? el.querySelector('[x],[y]') : el.closest('[data-at]')) || !isShift(matOf(el, g))) continue;
      if (place(el, i)) continue;
      if (pass === 1) left++;
    }
  }
  return left;

  /** Places text i clear (see the header): a shape's label whole, in or beside its shape; else nudges, a two-line wrap, a longer nudge. */
  function place(el: Element, i: number): boolean {
    type Now = { boxes: TextBox[][]; segs: Seg[] };
    const now = (): Now | null => { const geo = geoOf(g); return geo ? { boxes: byEl(geo, els), segs: segsOf(geo) } : null; };
    const clearAt = (st: Now, dx: number, dy: number): boolean => {
      const moved = st.boxes.map((bs, j) => (j === i ? bs.map((b) => ({ ...b, x: b.x + dx, y: b.y + dy })) : bs));
      if (counts(hitsOf(moved, st.segs, i), i).length) return false;
      // Never onto another text's room either (its own hits must not grow).
      return !moved.some((_, j) => j !== i && counts(hitsOf(moved, st.segs, j), j).some((k) => k === `t${i}`));
    };
    const tryHere = (reach: number): boolean => {
      const st = now();
      if (!st) return false;
      const bs = st.boxes[i];
      if (!counts(hitsOf(st.boxes, st.segs, i), i).length) return true;
      const fs = bs[0]?.fs ?? 16;
      const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0], [1, -1], [-1, -1], [1, 1], [-1, 1]];
      // An edge: first the shift that brings it inside.
      const x0 = Math.min(...bs.map((b) => b.x)), x1 = Math.max(...bs.map((b) => b.x + b.w));
      const edge = x1 > w ? w - x1 - 2 : x0 < 0 ? -x0 + 2 : 0;
      const cands: [number, number][] = edge ? [[edge, 0], [edge, -0.6 * fs], [edge, 0.6 * fs]] : [];
      for (const k of [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].filter((v) => v <= reach)) for (const [ux, uy] of dirs) { const n = Math.hypot(ux, uy); cands.push([edge + (ux / n) * k * fs, (uy / n) * k * fs]); }
      for (const [dx, dy] of cands) if (clearAt(st, dx, dy)) { shift(el, dx, dy); return true; }
      return false;
    };
    const st0 = now();
    const bs0 = st0?.boxes[i];
    if (!st0 || !bs0?.length) return false;
    const u = (() => { const x = Math.min(...bs0.map((b) => b.x)), y = Math.min(...bs0.map((b) => b.y)); return { x, y, w: Math.max(...bs0.map((b) => b.x + b.w)) - x, h: Math.max(...bs0.map((b) => b.y + b.h)) - y }; })();
    const fs0 = bs0[0].fs, pad = 0.3 * fs0;
    // Its shape: the smallest one that holds its centre.
    const cx = u.x + u.w / 2, cy = u.y + u.h / 2;
    const home = shapes.filter((s) => cx >= s.box.x && cx <= s.box.x + s.box.w && cy >= s.box.y && cy <= s.box.y + s.box.h).sort((a, b) => a.box.w * a.box.h - b.box.w * b.box.h)[0];
    if (home && !(u.w + 2 * pad <= home.box.w && inkBox(u as TextBox).h <= home.box.h)) return beside(el, home, u, fs0, st0, clearAt);
    if (tryHere(0.5)) return true;
    if (home) {
      // Across its shape's edge, though it fits: centred in it.
      const b = home.box, dx = b.x + b.w / 2 - cx, dy = b.y + b.h / 2 - cy, st = now();
      if (st && clearAt(st, dx, dy)) { shift(el, dx, dy); return true; }
    }
    const ws = (el.textContent ?? '').replace(/\s+/g, ' ').trim().split(' ');
    const snapshot = el.cloneNode(true) as Element;
    if (!home && !el.children.length && ws.length >= 2 && placed[i] === 'model') {
      // A row's label: two lines, broken at the word that best halves it (the row keeps its places).
      let best = 1, bd = Infinity;
      const len = (a: string[]) => a.join(' ').length;
      for (let k = 1; k < ws.length; k++) { const d = Math.abs(len(ws.slice(0, k)) - len(ws.slice(k))); if (d < bd) { bd = d; best = k; } }
      const x = el.getAttribute('x') ?? '0', fs = num(el.getAttribute('font-size'), 16);
      while (el.firstChild) el.removeChild(el.firstChild);
      [ws.slice(0, best).join(' '), ws.slice(best).join(' ')].forEach((s, k) => { const sp = el.ownerDocument.createElementNS(SVGNS, 'tspan'); sp.setAttribute('x', x); if (k) sp.setAttribute('dy', r2(1.15 * fs)); sp.textContent = s; el.appendChild(sp); });
      if (tryHere(0.5)) return true;
      restore(el, snapshot);
    }
    if (tryHere(2)) return true;
    // Never smaller: a text's size is its tier (grammar.ts). What is left keeps the paper halo.
    restore(el, snapshot);
    return false;
  }

  /**
   * A label wider (or taller) than its shape, whole, beside it: above, below, right, left, or under its start;
   * adjacent first, then further out with a leader back to the shape; in ink if it was light on the fill.
   */
  function beside<S>(el: Element, s: Shape, u: Box, fs: number, st: S, clearAt: (st: S, dx: number, dy: number) => boolean): boolean {
    const b = s.box, pad = 0.3 * fs;
    const ucx = u.x + u.w / 2, ucy = u.y + u.h / 2, bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
    for (const far of [0, 1, 2]) {
      const gap = pad + far * fs;
      const cands: [number, number][] = [
        [bcx - ucx, b.y - gap - (u.y + u.h)], [bcx - ucx, b.y + b.h + gap - u.y],
        [b.x + b.w + gap - u.x, bcy - ucy], [b.x - gap - (u.x + u.w), bcy - ucy],
        [b.x - u.x, b.y + b.h + gap - u.y], [b.x - u.x, b.y - gap - (u.y + u.h)],
      ];
      for (const [dx, dy] of cands) {
        if (!clearAt(st, dx, dy)) continue;
        shift(el, dx, dy);
        lightToInk(el);
        if (far) leader(g, el, b, { ...u, x: u.x + dx, y: u.y + dy }, fs);
        return true;
      }
    }
    return false;
  }
}

/** A light text (set on a fill) taken off it is set in ink: on paper it would vanish. */
function lightToInk(el: Element): void {
  const c = parseColor(inherit(el, 'fill'));
  if (c && 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b > 190) el.setAttribute('fill', '#1D1D1F');
}

/** A thin line from a shape's nearest edge to its label, set beside the label (it draws with it). */
function leader(g: Element, el: Element, shape: Box, lab: Box, fs: number): void {
  const cl = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
  const lx = (lab.x + lab.w / 2), ly = lab.y + lab.h / 2;
  const sx = cl(lx, shape.x, shape.x + shape.w), sy = cl(ly, shape.y, shape.y + shape.h);
  // The label's end: its box edge facing the shape, a little short of the ink.
  const ex = cl(sx, lab.x - 0.15 * fs, lab.x + lab.w + 0.15 * fs), ey = cl(sy, lab.y - 0.1 * fs, lab.y + lab.h + 0.1 * fs);
  const off = matOf(el.parentElement!, g);
  const ln = el.ownerDocument.createElementNS(SVGNS, 'line');
  for (const [k, v] of Object.entries({ x1: sx - off[4], y1: sy - off[5], x2: ex - off[4], y2: ey - off[5] })) ln.setAttribute(k, r2(v));
  ln.setAttribute('stroke', '#6E6E73'); ln.setAttribute('stroke-width', '1'); ln.setAttribute('data-leader', '');
  el.parentElement!.insertBefore(ln, el);
}

function restore(el: Element, snap: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
  for (const c of Array.from(snap.childNodes)) el.appendChild(c.cloneNode(true));
  for (const a of el.getAttributeNames()) el.removeAttribute(a);
  for (const a of snap.getAttributeNames()) el.setAttribute(a, snap.getAttribute(a)!);
}

