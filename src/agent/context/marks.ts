// src/agent/context/marks.ts
import type { Pt } from '../../script/types';
import type { PageRect } from '../../geometry/space';
import type { TextLine } from './textLines';

/** A painted path in model coords (0–1000 both axes). `ops`: M L C R Z per point step. */
export type PaintedPath = { paint: 'stroke' | 'fill' | 'both'; ops: string; pts: Pt[] };
export type PaintedImage = { rect: PageRect };

/**
 * Figure marks: handles on the page's own drawing, so the model can point at a dot, retrace a
 * segment or box an image by id instead of guessing coordinates (set-of-marks, as text).
 */
export type FigureMark =
  | { id: string; kind: 'dot'; at: Pt; label?: string }
  | { id: string; kind: 'line' | 'arrow'; from: Pt; to: Pt; label?: string; ends?: [string?, string?] }
  | { id: string; kind: 'box' | 'image' | 'figure' | 'equation'; rect: PageRect; label?: string; n?: number };

export const MAX_MARKS = 60;
const DOT_MAX = 16;   // a dot's bbox, x units
const SEG_MIN = 15;   // shorter segments are decoration (ticks, arrowheads)
const SNAP = 12;      // an endpoint this close to a dot is that dot
const LABEL_R = 45;   // a short text line this close names a mark
const HEAD_R = 14;    // a small fill this close to a segment end is its arrowhead
const RULE = 850;     // an axis-aligned segment this long is a page rule, not figure geometry
// More candidates than this are not figure dots/arrowheads but glyphs drawn as outlines (text as
// paths) or a dense scatter: they are clustered into figures instead.
const DOT_FLOOD = 40;
const HEAD_FLOOD = 120;
const EQ_LABEL = 60;
const FLOOD = 24;     // more anonymous lines/arrows/boxes than this are one drawing  // characters of an equation's text shown in its label

type Box = { x0: number; y0: number; x1: number; y1: number };
function bbox(pts: Pt[]): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
  return { x0, y0, x1, y1 };
}
const boxOf = (r: PageRect): Box => ({ x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h });

/** Builds marks from painted paths, images and the page's text lines. `aspect` = page h / w. */
export function figureMarks(paths: PaintedPath[], images: PaintedImage[], lines: TextLine[], aspect: number): FigureMark[] {
  const d = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, (a.y - b.y) * aspect); // in x units
  let dots: { c: Pt; b: Box }[] = [], heads: { c: Pt; b: Box }[] = [];
  const segs: { from: Pt; to: Pt }[] = [], bars: Box[] = [];
  const boxes: Box[] = [], others: Box[] = [];
  const seen = new Set<string>();
  for (const p of paths) {
    if (!p.pts.length) continue;
    const b = bbox(p.pts);
    if (![b.x0, b.y0, b.x1, b.y1].every(Number.isFinite)) continue;
    const key = `${p.ops}|${Math.round(b.x0)},${Math.round(b.y0)},${Math.round(b.x1)},${Math.round(b.y1)}`;
    if (seen.has(key)) continue; // fill + stroke of one shape
    seen.add(key);
    if (b.x1 < 0 || b.x0 > 1000 || b.y1 < 0 || b.y0 > 1000) continue; // off the page
    const w = b.x1 - b.x0, h = (b.y1 - b.y0) * aspect;
    if (w > 950 && h > 950 * aspect * 0.9) continue; // page background
    const curved = /C/.test(p.ops);
    const c = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
    // A dot is drawn with curves only (a circle); a small closed shape with straight edges is an arrowhead.
    if (w <= DOT_MAX && h <= DOT_MAX && /^MC+Z?M?$/.test(p.ops) && Math.max(w, h) < 2 * Math.min(w, h) + 1) { dots.push({ c, b }); continue; }
    if (p.paint !== 'stroke' && w <= HEAD_R && h <= HEAD_R) { heads.push({ c, b }); continue; }
    if (/^R$/.test(p.ops) || (/^MLLLZ?/.test(p.ops) && p.pts.length <= 5 && isAxisRect(p.pts))) {
      const chrome = w > 900 && (b.y0 < 15 || b.y1 > 985); // header / footer bars
      if (h < 3 && w >= SEG_MIN && !chrome) { // a thin filled rule: treat as a segment
        const from = { x: b.x0, y: c.y }, to = { x: b.x1, y: c.y };
        if (fractionBar(from, to, lines)) bars.push(b);
        else if (w < RULE) segs.push({ from, to });
      } else if (w >= 20 && h >= 20 && w * h < 0.6 * 1000 * 1000 * aspect && !chrome) boxes.push(b);
      continue;
    }
    if (!curved && /^ML+Z?$/.test(p.ops) && collinear(p.pts)) {
      const from = p.pts[0], to = p.pts[p.pts.length - 1];
      const axis = Math.abs(from.x - to.x) < 2 || Math.abs(from.y - to.y) < 2;
      if (d(from, to) < SEG_MIN) { if (p.paint !== 'stroke') heads.push({ c, b }); continue; }
      if (fractionBar(from, to, lines)) bars.push(b);
      else if (!(axis && d(from, to) >= RULE)) segs.push({ from, to });
      continue;
    }
    if (w >= SEG_MIN || h >= SEG_MIN) others.push(b);
  }
  if (dots.length > DOT_FLOOD) { others.push(...dots.map((x) => x.b)); dots = []; }
  if (heads.length > HEAD_FLOOD) { others.push(...heads.map((x) => x.b)); heads = []; }

  const marks: FigureMark[] = [];
  const uniqDots: Pt[] = [];
  for (const { c } of dots) if (!uniqDots.some((q) => d(c, q) < 3)) uniqDots.push(c);
  uniqDots.forEach((at, i) => marks.push({ id: `#d${i + 1}`, kind: 'dot', at: round(at) }));
  const dotAt = (p: Pt) => marks.find((m) => m.kind === 'dot' && d(m.at, p) <= SNAP)?.id;
  let ns = 0, na = 0;
  // Each arrowhead belongs to the one segment end nearest it.
  const owner = heads.map(({ c: h }) => {
    let best = -1, bd = HEAD_R, end = 'to' as 'from' | 'to';
    segs.forEach((s, i) => { for (const e of ['from', 'to'] as const) { const dist = d(h, s[e]); if (dist < bd) { bd = dist; best = i; end = e; } } });
    return { seg: best, end };
  });
  segs.forEach((s, i) => {
    const headAtEnd = owner.some((o) => o.seg === i && o.end === 'to');
    const headAtStart = !headAtEnd && owner.some((o) => o.seg === i && o.end === 'from');
    const [from, to] = headAtStart ? [s.to, s.from] : [s.from, s.to];
    const arrow = headAtEnd || headAtStart;
    const ends: [string?, string?] = [dotAt(from), dotAt(to)];
    marks.push({ id: arrow ? `#a${++na}` : `#s${++ns}`, kind: arrow ? 'arrow' : 'line', from: round(from), to: round(to), ...(ends[0] || ends[1] ? { ends } : {}) });
  });
  equations(lines, bars).forEach((e, i) => marks.push({ id: `#e${i + 1}`, kind: 'equation', rect: rect(e.box), label: e.label }));
  boxes.forEach((b, i) => marks.push({ id: `#b${i + 1}`, kind: 'box', rect: rect(b) }));
  const imgs = clusters(images.map((im) => boxOf(im.rect)).filter((b) => b.x1 - b.x0 > 0 && b.y1 - b.y0 > 0), 2)
    .map((c) => c.box)
    .filter((b) => b.x1 - b.x0 >= 30 && b.y1 - b.y0 >= 30 && (b.x1 - b.x0) * (b.y1 - b.y0) < 0.95e6);
  imgs.forEach((b, i) => marks.push({ id: `#i${i + 1}`, kind: 'image', rect: rect(b) }));

  // Short text lines name the nearest mark (each label names one mark). Dots are preferred: their
  // distance is weighted 0.7, and a dot within 10% of the best segment still wins.
  // Boxes that will be named by their inside text (≤ 40 characters: cells, keys, buttons).
  const inside = (b: Box, l: TextLine) => l.rect.x >= b.x0 - 2 && l.rect.y >= b.y0 - 2 && l.rect.x + l.rect.w <= b.x1 + 2 && l.rect.y + l.rect.h <= b.y1 + 2;
  const naming = boxes.filter((b) => { const t = lines.filter((l) => inside(b, l)).map((l) => l.text).join(' '); return t.length > 0 && t.length <= 40; });
  const inBox = (l: TextLine) => naming.some((b) => inside(b, l));
  for (const l of lines) {
    if (l.math || Array.from(l.text).length > 8 || inBox(l)) continue; // text inside a box names the box
    const c = { x: l.rect.x + l.rect.w / 2, y: l.rect.y + l.rect.h / 2 };
    let dot: FigureMark | null = null, dd = LABEL_R, seg: FigureMark | null = null, sd = LABEL_R;
    for (const m of marks) {
      if (m.kind === 'dot') {
        if (m.label) continue; // a dot has one name; lines may gather a word and a symbol
        const dist = 0.7 * d(c, m.at);
        if (dist < dd) { dd = dist; dot = m; }
      } else if (m.kind === 'line' || m.kind === 'arrow') {
        const dist = segDist(c, m.from, m.to, d);
        if (dist < sd) { sd = dist; seg = m; }
      }
    }
    const best = dot && (!seg || dd <= 1.1 * sd) ? dot : seg;
    if (best) best.label = best.label ? `${best.label} ${l.text}` : l.text;
  }
  // Boxes and figures are named by the short text inside them.
  const nameByInside = (m: FigureMark) => {
    if ((m.kind === 'box' || m.kind === 'figure') && !m.label) {
      const inside = lines.filter((l) => l.rect.x >= m.rect.x - 2 && l.rect.y >= m.rect.y - 2 && l.rect.x + l.rect.w <= m.rect.x + m.rect.w + 2 && l.rect.y + l.rect.h <= m.rect.y + m.rect.h + 2);
      const text = inside.map((l) => l.text).join(' ');
      if (text && text.length <= 40) m.label = text;
    }
  };
  marks.forEach(nameByInside);
  // Floods of anonymous lines, arrows or boxes (hatching, perspective rays, quiver plots, grids)
  // are one drawing: they become figures, so the cap keeps the marks that can be named.
  let kept = marks;
  for (const kind of ['line', 'arrow', 'box'] as const) {
    const anon = kept.filter((m) => m.kind === kind && !m.label && !('ends' in m && m.ends));
    if (anon.length <= FLOOD) continue;
    const drop = new Set(anon);
    for (const m of anon) {
      if (m.kind === 'line' || m.kind === 'arrow') others.push({ x0: Math.min(m.from.x, m.to.x), y0: Math.min(m.from.y, m.to.y), x1: Math.max(m.from.x, m.to.x), y1: Math.max(m.from.y, m.to.y) });
      else if ('rect' in m) others.push(boxOf(m.rect));
    }
    kept = kept.filter((m) => !drop.has(m));
  }
  // A lone path counts as a figure only if it has some extent both ways (not a stray rule).
  clusters(others, 10).filter((c) => c.n >= 2 || (c.box.x1 - c.box.x0 > 40 && c.box.y1 - c.box.y0 > 3)).forEach((c) => {
    const m: FigureMark = { id: '#g', kind: 'figure', rect: rect(c.box), n: c.n };
    nameByInside(m);
    kept.push(m);
  });
  return renumber(prioritise(kept).slice(0, MAX_MARKS));
}

const PREFIX: Record<FigureMark['kind'], string> = { dot: '#d', line: '#s', arrow: '#a', equation: '#e', image: '#i', box: '#b', figure: '#g' };
/** Ids in listing order per kind (#d1, #d2, …); segment ends follow their dots (or fall back to coordinates). */
function renumber(ms: FigureMark[]): FigureMark[] {
  const n: Record<string, number> = {};
  const map = new Map<string, string>();
  const out = ms.map((m) => {
    const id = `${PREFIX[m.kind]}${(n[m.kind] = (n[m.kind] ?? 0) + 1)}`;
    if (m.kind === 'dot') map.set(m.id, id);
    return { ...m, id } as FigureMark;
  });
  for (const m of out) {
    if ('ends' in m && m.ends) {
      const ends: [string?, string?] = [m.ends[0] && map.get(m.ends[0]), m.ends[1] && map.get(m.ends[1])];
      if (ends[0] || ends[1]) m.ends = ends; else delete m.ends;
    }
  }
  return out;
}

const PRI: Record<FigureMark['kind'], number> = { dot: 0, arrow: 1, line: 2, equation: 3, image: 4, box: 5, figure: 6 };
function prioritise(ms: FigureMark[]): FigureMark[] {
  return [...ms].sort((a, b) => (a.label && a.kind !== 'equation' ? 0 : 1) - (b.label && b.kind !== 'equation' ? 0 : 1) || PRI[a.kind] - PRI[b.kind]);
}

/**
 * Stacked `math` lines (vertical gap < one line height, overlapping in x) and the fraction bars
 * between them form one equation. A lone one-line formula stays a text line.
 */
function equations(lines: TextLine[], bars: Box[]): { box: Box; label: string }[] {
  const ms = lines.filter((l) => l.math);
  if (!ms.length && !bars.length) return [];
  // A short non-math line ("z" under a fraction bar) joins only through a bar.
  const short = (l: TextLine) => !l.math && Array.from(l.text.replace(/\s/g, '')).length <= 4;
  type Item = { box: Box; line?: TextLine };
  const items: Item[] = [...lines.filter((l) => l.math || (bars.length && short(l))).map((l) => ({ box: boxOf(l.rect), line: l })), ...bars.map((b) => ({ box: b }))];
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const xOverlap = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1;
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j];
    if (!xOverlap(a.box, b.box)) continue;
    if ((a.line && !a.line.math && b.line) || (b.line && !b.line.math && a.line)) continue;
    const lh = Math.min(...[a, b].filter((x) => x.line).map((x) => x.box.y1 - x.box.y0), Infinity);
    if (!Number.isFinite(lh)) continue; // two bars alone do not make an equation
    const gap = Math.max(a.box.y0, b.box.y0) - Math.min(a.box.y1, b.box.y1);
    if (gap < lh) parent[find(i)] = find(j);
  }
  const groups = new Map<number, Item[]>();
  items.forEach((it, i) => { const r = find(i); groups.set(r, [...(groups.get(r) ?? []), it]); });
  const out: { box: Box; label: string }[] = [];
  for (const g of groups.values()) {
    const ls = g.filter((x) => x.line).map((x) => x.line!);
    if (!ls.some((l) => l.math) || (ls.length < 2 && g.length < 2)) continue;
    ls.sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
    const box = g.reduce((u, x) => ({ x0: Math.min(u.x0, x.box.x0), y0: Math.min(u.y0, x.box.y0), x1: Math.max(u.x1, x.box.x1), y1: Math.max(u.y1, x.box.y1) }), g[0].box);
    const text = ls.map((l) => l.text).join(' ');
    out.push({ box, label: text.length > EQ_LABEL ? `${text.slice(0, EQ_LABEL - 1).trimEnd()}…` : text });
  }
  return out.sort((a, b) => a.box.y0 - b.box.y0 || a.box.x0 - b.box.x0);
}

/**
 * A short horizontal rule with a numerator just above and a denominator just below (math or short
 * lines, at least one math) is a fraction bar, not figure geometry.
 */
function fractionBar(a: Pt, b: Pt, lines: TextLine[]): boolean {
  if (Math.abs(a.y - b.y) > 1.5 || Math.abs(a.x - b.x) > 150) return false;
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
  const near = lines.filter((l) => (l.math || Array.from(l.text.replace(/\s/g, '')).length <= 4) &&
    l.rect.x < x1 && l.rect.x + l.rect.w > x0 && Math.abs(l.rect.y + l.rect.h / 2 - a.y) < 1.2 * l.rect.h);
  const above = near.filter((l) => l.rect.y + l.rect.h / 2 < a.y), below = near.filter((l) => l.rect.y + l.rect.h / 2 > a.y);
  return above.length > 0 && below.length > 0 && near.some((l) => l.math);
}
function isAxisRect(pts: Pt[]): boolean {
  for (let i = 1; i < Math.min(pts.length, 5); i++) {
    const a = pts[i - 1], b = pts[i];
    if (Math.abs(a.x - b.x) > 1 && Math.abs(a.y - b.y) > 1) return false;
  }
  return true;
}
function collinear(pts: Pt[]): boolean {
  if (pts.length <= 2) return true;
  const a = pts[0], b = pts[pts.length - 1];
  const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return pts.every((p) => Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / L < 2);
}
function segDist(p: Pt, a: Pt, b: Pt, d: (a: Pt, b: Pt) => number): number {
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / ((b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1)));
  return d(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
}
/**
 * Union of overlapping or near boxes (the curves of one plot become one figure; image tiles one
 * image). Merges repeat until no two clusters' boxes are within `pad` (the result does not depend on
 * order). Each pass finds near pairs through a coarse grid and joins them with union-find, so a pass
 * costs about n·(boxes per cell) instead of n²; listed in order of each cluster's first box.
 */
export function clusters(bs: Box[], pad: number): { box: Box; n: number }[] {
  const near = (a: Box, b: Box) => a.x0 - pad <= b.x1 && b.x0 - pad <= a.x1 && a.y0 - pad <= b.y1 && b.y0 - pad <= a.y1;
  const join = (a: Box, b: Box): Box => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
  let out = bs.map((b) => ({ box: { ...b }, n: 1 }));
  for (;;) {
    if (out.length < 2) return out;
    let X0 = Infinity, Y0 = Infinity, X1 = -Infinity, Y1 = -Infinity;
    for (const { box: b } of out) { X0 = Math.min(X0, b.x0); Y0 = Math.min(Y0, b.y0); X1 = Math.max(X1, b.x1); Y1 = Math.max(Y1, b.y1); }
    const G = 48;
    const cw = Math.max((X1 - X0) / G, pad, 1e-6), ch = Math.max((Y1 - Y0) / G, pad, 1e-6);
    const cx = (x: number) => Math.min(G, Math.max(0, Math.floor((x - X0) / cw)));
    const cy = (y: number) => Math.min(G, Math.max(0, Math.floor((y - Y0) / ch)));
    const parent = out.map((_, i) => i);
    const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const cells = new Map<number, number[]>();
    let merged = false;
    out.forEach((c, i) => {
      const b = c.box;
      const seen = new Set<number>();
      for (let gx = cx(b.x0 - pad); gx <= cx(b.x1 + pad); gx++) for (let gy = cy(b.y0 - pad); gy <= cy(b.y1 + pad); gy++) {
        const k = gx * (G + 1) + gy;
        for (const j of cells.get(k) ?? []) {
          if (seen.has(j)) continue;
          seen.add(j);
          if (find(i) !== find(j) && near(b, out[j].box)) { parent[Math.max(find(i), find(j))] = Math.min(find(i), find(j)); merged = true; }
        }
      }
      for (let gx = cx(b.x0); gx <= cx(b.x1); gx++) for (let gy = cy(b.y0); gy <= cy(b.y1); gy++) {
        const k = gx * (G + 1) + gy;
        const list = cells.get(k);
        if (list) list.push(i); else cells.set(k, [i]);
      }
    });
    if (!merged) return out;
    const groups = new Map<number, { box: Box; n: number }>();
    out.forEach((c, i) => {
      const r = find(i);
      const g = groups.get(r);
      if (g) { g.box = join(g.box, c.box); g.n += c.n; } else groups.set(r, { box: { ...c.box }, n: c.n });
    });
    out = [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([, g]) => g);
  }
}
const round = (p: Pt): Pt => ({ x: Math.round(p.x), y: Math.round(p.y) });
const rect = (b: Box): PageRect => ({ x: Math.round(b.x0), y: Math.round(b.y0), w: Math.round(b.x1 - b.x0), h: Math.round(b.y1 - b.y0) });

/** The compact listing sent to the model (one mark per line). */
export function formatMarks(ms: FigureMark[]): string {
  const P = (p: Pt) => `${p.x},${p.y}`;
  const L = (m: FigureMark) => (m.label ? ` "${m.label.replace(/"/g, "'")}"` : '');
  return ms.map((m) => {
    if (m.kind === 'dot') return `${m.id} dot ${P(m.at)}${L(m)}`;
    if (m.kind === 'line' || m.kind === 'arrow') return `${m.id} ${m.kind} ${m.ends?.[0] ?? P(m.from)}→${m.ends?.[1] ?? P(m.to)}${L(m)}`;
    const r = m as Extract<FigureMark, { rect: PageRect }>;
    return `${r.id} ${r.kind} ${r.rect.x},${r.rect.y} ${r.rect.w}×${r.rect.h}${r.n && r.n >= 2 ? ` (${r.n} paths)` : ''}${L(r)}`;
  }).join('\n');
}
