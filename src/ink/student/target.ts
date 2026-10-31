// src/ink/student/target.ts — what a student's mark is on (spec "Student ink": each mark records its
// target). Pure: page model coords (x 0–1000, y 0–1000 down the page), the page's text lines (the
// same ids the model's page listing uses, t7…) and its figures (#g2…). No DOM, no subject.
import { bbox, type MarkKind, type Pt } from './gesture';

type Rect = { x: number; y: number; w: number; h: number };
export type Line = { id?: string; text: string; rect: Rect };
export type Figure = { id: string; label?: string; rect: Rect };

/**
 * What a mark is on. `text`: the words it covers or points at (a phrase, whole lines, a figure's
 * label); `ref`: the listing's id (t7, #g2) when there is one; `what` says which.
 */
export type PageTarget = { page: number; what: 'phrase' | 'lines' | 'figure' | 'area'; text: string; ref?: string; area?: Rect };
/** On the board: the drawing's section, the elements and the board text the mark covers. */
export type BoardTarget = { board: string; elements: string[]; text: string };
export type Target = PageTarget | BoardTarget;

const QUOTE = 300;
const words = (s: string) => s.replace(/\s+/g, ' ').trim();
const clip = (s: string, n = QUOTE) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const cx = (r: Rect) => r.x + r.w / 2;
const cy = (r: Rect) => r.y + r.h / 2;

/** The words of `line` between x0 and x1 (characters spread evenly across its rect), whole words only. */
export function phrase(line: Line, x0: number, x1: number): string {
  const t = line.text, n = t.length;
  if (!n || line.rect.w <= 0) return words(t);
  let i = Math.floor(((x0 - line.rect.x) / line.rect.w) * n), j = Math.ceil(((x1 - line.rect.x) / line.rect.w) * n);
  i = Math.max(0, Math.min(n, i)); j = Math.max(i, Math.min(n, j));
  // Out to whole words.
  while (i > 0 && /\S/.test(t[i - 1])) i--;
  while (j < n && /\S/.test(t[j])) j++;
  return words(t.slice(i, j)) || words(t);
}

function inPoly(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

const overlapX = (a: Rect, x0: number, x1: number) => Math.min(a.x + a.w, x1) - Math.max(a.x, x0);

/** The thing nearest `p` within `r` units: a figure it is on, else the closest word of a line. */
function near(p: Pt, lines: Line[], figures: Figure[], r = 45): { text: string; ref?: string; what: PageTarget['what'] } | null {
  const fig = figures.filter((f) => p.x >= f.rect.x && p.x <= f.rect.x + f.rect.w && p.y >= f.rect.y && p.y <= f.rect.y + f.rect.h)
    .sort((a, b) => a.rect.w * a.rect.h - b.rect.w * b.rect.h)[0];
  let best: Line | null = null, bd = Infinity;
  for (const l of lines) {
    const dx = Math.max(l.rect.x - p.x, 0, p.x - (l.rect.x + l.rect.w)), dy = Math.max(l.rect.y - p.y, 0, p.y - (l.rect.y + l.rect.h));
    const d = Math.hypot(dx, dy);
    if (d < bd) { bd = d; best = l; }
  }
  if (best && bd <= (fig ? 4 : r)) {
    const x = Math.max(best.rect.x, Math.min(p.x, best.rect.x + best.rect.w));
    const span = Math.max(30, 0.2 * best.rect.w);
    return { text: phrase(best, x - span / 2, x + span / 2), ...(best.id ? { ref: best.id } : {}), what: 'phrase' };
  }
  if (fig) return { text: fig.label ?? '', ref: fig.id, what: 'figure' };
  return null;
}

/**
 * The target of a mark on page `page`. `pts` are the stroke's points in model coords; an arrow's
 * `from`/`to` its tail and tip. Circle: the lines (or the phrase of one line) and figures inside;
 * underline: the phrase on the line just above (a highlighter: the phrase under it); arrow: what its
 * tail and its tip are on; "?" and notes: the nearest phrase or figure.
 */
export function pageTarget(kind: MarkKind, page: number, pts: Pt[], lines: Line[], figures: Figure[], o: { tool?: 'pen' | 'highlighter'; from?: Pt; to?: Pt } = {}): { target: PageTarget; to?: PageTarget } {
  const b = bbox(pts), R = Math.round;
  const area = { x: R(b.x), y: R(b.y), w: R(b.w), h: R(b.h) };
  const empty: PageTarget = { page, what: 'area', text: '', area };
  if (kind === 'circle') {
    // Lines with their middle inside; a circle around part of one line is that phrase.
    const rows = lines.filter((l) => cy(l.rect) >= b.y && cy(l.rect) <= b.y + b.h && overlapX(l.rect, b.x, b.x + b.w) > 0);
    const whole = rows.filter((l) => inPoly({ x: cx(l.rect), y: cy(l.rect) }, pts));
    const figs = figures.filter((f) => inPoly({ x: cx(f.rect), y: cy(f.rect) }, pts));
    if (whole.length >= 2 || (whole.length === 1 && rows.length === 1 && overlapX(whole[0].rect, b.x, b.x + b.w) > 0.8 * whole[0].rect.w)) {
      return { target: { page, what: 'lines', text: clip(whole.map((l) => words(l.text)).join(' ')), ref: whole.map((l) => l.id).filter(Boolean).join(','), area } };
    }
    if (rows.length) {
      const text = rows.map((l) => phrase(l, b.x, b.x + b.w)).join(' ');
      return { target: { page, what: 'phrase', text: clip(text), ...(rows[0].id ? { ref: rows.map((l) => l.id).filter(Boolean).join(',') } : {}), area } };
    }
    if (figs.length) return { target: { page, what: 'figure', text: clip(figs.map((f) => f.label ?? '').filter(Boolean).join(', ')), ref: figs.map((f) => f.id).join(','), area } };
    // Part of a figure (the loop sits inside it).
    const host = figures.filter((f) => b.x >= f.rect.x && b.y >= f.rect.y && b.x + b.w <= f.rect.x + f.rect.w && b.y + b.h <= f.rect.y + f.rect.h)
      .sort((p, q) => p.rect.w * p.rect.h - q.rect.w * q.rect.h)[0];
    if (host) return { target: { page, what: 'figure', text: host.label ?? '', ref: host.id, area } };
    return { target: empty };
  }
  if (kind === 'underline') {
    const x0 = b.x, x1 = b.x + b.w, y = cy(b);
    const hl = o.tool === 'highlighter';
    const hits = lines
      .filter((l) => (hl ? cy(l.rect) >= b.y - 0.5 * l.rect.h && cy(l.rect) <= b.y + b.h + 0.5 * l.rect.h : y >= l.rect.y + 0.5 * l.rect.h && y <= l.rect.y + 2.2 * l.rect.h))
      .filter((l) => overlapX(l.rect, x0, x1) > 0.3 * Math.min(x1 - x0, l.rect.w))
      .sort((p, q) => (hl ? p.rect.y - q.rect.y : Math.abs(y - (p.rect.y + p.rect.h)) - Math.abs(y - (q.rect.y + q.rect.h))));
    const use = hl ? hits : hits.slice(0, 1);
    if (use.length) return { target: { page, what: 'phrase', text: clip(use.map((l) => phrase(l, x0, x1)).join(' ')), ...(use[0].id ? { ref: use.map((l) => l.id).filter(Boolean).join(',') } : {}), area } };
    return { target: empty };
  }
  if (kind === 'arrow' && o.from && o.to) {
    const at = (p: Pt): PageTarget => {
      const n = near(p, lines, figures);
      const R2 = (v: number) => Math.round(v);
      return n ? { page, ...n } : { page, what: 'area', text: '', area: { x: R2(p.x), y: R2(p.y), w: 0, h: 0 } };
    };
    return { target: at(o.from), to: at(o.to) };
  }
  // "?" and notes: what it sits beside (its centre, then its nearest point).
  const c = { x: cx(b), y: cy(b) };
  const n = near(c, lines, figures, 60) ?? pts.reduce<ReturnType<typeof near>>((acc, p) => acc ?? near(p, lines, figures, 30), null);
  if (n) return { target: { page, ...n, area } };
  // In the margin: the line level with it (its words nearest the mark), up to a column's width away.
  const level = lines
    .filter((l) => l.rect.y <= b.y + b.h + 10 && l.rect.y + l.rect.h >= b.y - 10)
    .map((l) => ({ l, dx: Math.max(l.rect.x - (b.x + b.w), 0, b.x - (l.rect.x + l.rect.w)) }))
    .filter((x) => x.dx <= 250)
    .sort((p, q) => p.dx - q.dx || Math.abs(cy(p.l.rect) - c.y) - Math.abs(cy(q.l.rect) - c.y))[0]?.l;
  if (level) {
    const x = Math.max(level.rect.x, Math.min(c.x, level.rect.x + level.rect.w)), span = Math.max(60, 0.3 * level.rect.w);
    return { target: { page, what: 'phrase', text: phrase(level, x - span, x + span), ...(level.id ? { ref: level.id } : {}), area } };
  }
  return { target: empty };
}
