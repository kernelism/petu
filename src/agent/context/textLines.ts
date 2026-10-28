// src/agent/context/textLines.ts
import type { TextRun } from '../../locate/locateQuote';
import type { PageRect } from '../../geometry/space';

/**
 * One visual line segment of text, as the model sees it and as the locator searches it: the page's
 * runs grouped by baseline band, sorted left to right, split at wide gaps (columns, figure labels).
 * Equation glyphs (one run per glyph, in arbitrary stream order) come out in reading order.
 */
export type TextLine = {
  id: string; // t1, t2, … in reading order
  text: string;
  rect: PageRect; // model coords
  runs: TextRun[];
  /** Mostly single-glyph runs: an equation (quote small parts; box with mark=). */
  math: boolean;
};

const cy = (r: PageRect) => r.y + r.h / 2;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0; };

/** `aspect` = page h / w: converts y units to x units, so gaps compare in one scale. */
export function textLines(runs: TextRun[], aspect: number): TextLine[] {
  const all = runs.filter((r) => r.text.trim() && r.rect.w > 0 && r.rect.h > 0);
  // Sideways runs (rotated axis labels, a page drawn sideways) never join a horizontal band: each is
  // its own line, placed by its top-left.
  const rs = all.filter((r) => !r.vertical);
  const sideways = all.filter((r) => r.vertical).map((r): Omit<TextLine, 'id'> => ({ text: r.text.replace(/\s+/g, ' ').trim(), rect: r.rect, runs: [r], math: false }));
  // Baseline bands: runs whose vertical centres sit within half the smaller height.
  const sorted = [...rs].sort((a, b) => cy(a.rect) - cy(b.rect));
  const bands: TextRun[][] = [];
  for (const r of sorted) {
    const band = bands.find((b) => Math.abs(cy(b[0].rect) - cy(r.rect)) < Math.min(b[0].rect.h, r.rect.h) * 0.5);
    if (band) band.push(r); else bands.push([r]);
  }
  // Sub- and superscripts (smaller runs whose centre falls inside a taller band's box, within its
  // x-span) join that band, so "λ λ −α(λ + λ )2" reads "λ1 λ2 − α(λ1 + λ2)2".
  for (let i = bands.length - 1; i >= 0; i--) {
    const b = bands[i];
    const h = Math.max(...b.map((r) => r.rect.h));
    const host = bands.find((o) => o !== b && Math.max(...o.map((r) => r.rect.h)) > 1.25 * h && b.every((r) => o.some((q) =>
      cy(r.rect) > q.rect.y - 0.35 * q.rect.h && cy(r.rect) < q.rect.y + 1.35 * q.rect.h && r.rect.x >= q.rect.x - 3 * q.rect.h && r.rect.x <= q.rect.x + q.rect.w + 3 * q.rect.h)));
    if (host) { host.push(...b); bands.splice(i, 1); }
  }
  const out: Omit<TextLine, 'id'>[] = [];
  for (const band of bands) {
    band.sort((a, b) => a.rect.x - b.rect.x);
    const hX = median(band.map((r) => r.rect.h)) * aspect; // line height in x units
    let seg: TextRun[] = [];
    const flush = () => { if (seg.length) out.push(lineOf(seg, hX, aspect)); seg = []; };
    for (const r of band) {
      const prev = seg[seg.length - 1];
      if (prev && r.rect.x - (prev.rect.x + prev.rect.w) > 1.2 * hX) flush();
      seg.push(r);
    }
    flush();
  }
  out.push(...sideways);
  return readingOrder(out).map((l, i) => ({ ...l, id: `t${i + 1}` }));
}

type Seg = Omit<TextLine, 'id'>;
const rowOrder = (a: Seg, b: Seg) => (Math.abs(a.rect.y - b.rect.y) < Math.min(a.rect.h, b.rect.h) * 0.5 ? a.rect.x - b.rect.x : a.rect.y - b.rect.y);
/** Lines needed on each side of a gutter before a page counts as two columns. */
const MIN_COLUMN_LINES = 5;

/**
 * Reading order. Row by row (top to bottom, left to right), except on two-column pages: there each
 * block between full-width lines (titles, wide captions, footers) reads down the left column, then
 * down the right. A gutter is an x where (almost) no line crosses, with ≥ 5 lines on each side that
 * share their vertical range, and body text on both sides (or body text beside a figure's labels).
 */
function readingOrder(lines: Seg[]): Seg[] {
  const rows = [...lines].sort(rowOrder);
  const g = gutter(rows);
  if (g == null) return rows;
  const spans = (l: Seg) => l.rect.x < g && l.rect.x + l.rect.w > g;
  const out: Seg[] = [];
  let left: Seg[] = [], right: Seg[] = [];
  const flush = () => { out.push(...left, ...right); left = []; right = []; };
  for (const l of rows) {
    if (spans(l)) { flush(); out.push(l); continue; }
    (l.rect.x + l.rect.w / 2 < g ? left : right).push(l);
  }
  flush();
  return out;
}

function gutter(rows: Seg[]): number | null {
  if (rows.length < 2 * MIN_COLUMN_LINES) return null;
  let best: number | null = null, bestScore = -1;
  for (let x = 300; x <= 700; x += 5) {
    const C: Seg[] = [], L: Seg[] = [], R: Seg[] = [];
    for (const l of rows) {
      if (l.rect.x < x && l.rect.x + l.rect.w > x) C.push(l);
      else if (l.rect.x + l.rect.w <= x) L.push(l);
      else R.push(l);
    }
    if (L.length < MIN_COLUMN_LINES || R.length < MIN_COLUMN_LINES) continue;
    // Columns of text, not a label or two: the sides share their vertical range, and each side's
    // lines are mostly wide (body text, not figure labels).
    const top = Math.max(Math.min(...L.map((l) => l.rect.y)), Math.min(...R.map((l) => l.rect.y)));
    const bot = Math.min(Math.max(...L.map((l) => l.rect.y)), Math.max(...R.map((l) => l.rect.y)));
    if (bot - top < 150) continue;
    // Body text fills its column: most lines run ≥ 70% of the column's width (a table's cells don't,
    // so tables keep row order).
    const inRange = (ls: Seg[]) => ls.filter((l) => l.rect.y >= top && l.rect.y <= bot);
    const Li = inRange(L), Ri = inRange(R);
    const lw = x - Math.min(...Li.map((l) => l.rect.x)), rw = Math.max(...Ri.map((l) => l.rect.x + l.rect.w)) - x;
    const full = (ls: Seg[], w: number) => { if (w < 250) return false; const n = ls.filter((l) => l.rect.w >= 0.7 * w).length; return n >= MIN_COLUMN_LINES && n >= 0.6 * ls.length; };
    // One side may be a figure's labels beside a column of text: the figure reads as one block.
    const fl = full(Li, lw), fr = full(Ri, rw);
    if (!fl && !fr) continue;
    if (!(fl && fr) && (fl ? Ri : Li).some((l) => l.rect.w >= 0.7 * (fl ? rw : lw))) continue;
    // Full-width lines above or below the columns (title, abstract, footers) don't count against
    // the gutter; a few inside (a wide caption) are allowed.
    const cross = C.filter((l) => l.rect.y > top && l.rect.y < bot).length;
    const inside = Li.length + Ri.length;
    if (cross > Math.max(2, 0.1 * inside)) continue;
    const score = Math.min(L.length, R.length) - 3 * cross;
    if (score > bestScore) { bestScore = score; best = x; }
  }
  return best;
}

/**
 * Superscripts: runs clearly smaller than the line's main text whose baseline sits well above the
 * main baseline (by > 20% of the main height). Subscripts and smaller words on the baseline are not.
 */
function superscripts(seg: TextRun[]): boolean[] {
  // The main height ignores glyphs far taller than the rest (big brackets and operators span rows).
  const med = median(seg.map((r) => r.rect.h));
  const H = Math.max(...seg.map((r) => r.rect.h).filter((h) => h <= 1.6 * med));
  const main = seg.filter((r) => r.rect.h >= 0.85 * H);
  // A base made only of punctuation (a stray comma from the next row) can't carry an exponent.
  if (!main.some((r) => /[\p{L}\p{N})\]]/u.test(r.text))) return seg.map(() => false);
  const base = median(main.map((r) => r.rect.y + r.rect.h));
  // Primes are drawn raised already: x′ stays x′.
  return seg.map((r) => r.rect.h < 0.85 * H && r.rect.y + r.rect.h < base - 0.2 * H && !/^[\s′″‴'*∗]+$/.test(r.text));
}

function lineOf(seg: TextRun[], hX: number, aspect: number): Omit<TextLine, 'id'> {
  let text = '';
  const sup = superscripts(seg);
  // A superscript group is written ^c (one character) or ^(...), so "2^(64×64)" reads as it is drawn.
  let group = '';
  const close = () => {
    if (!group) return;
    const g = group.trim();
    text += Array.from(g).length === 1 ? `^${g}` : `^(${g})`;
    group = '';
  };
  seg.forEach((r, i) => {
    const prev = seg[i - 1];
    const gap = prev ? r.rect.x - (prev.rect.x + prev.rect.w) : 0;
    const t = r.text.replace(/\s+/g, ' ');
    if (sup[i]) {
      if (!group && prev && !sup[i - 1] && gap > 0.12 * hX && !text.endsWith(' ')) text += ' ';
      if (group && gap > 0.12 * hX && !group.endsWith(' ') && !t.startsWith(' ')) group += ' ';
      group += t;
      return;
    }
    const wasSup = i > 0 && sup[i - 1];
    close();
    if (prev && gap > 0.12 * hX && !text.endsWith(' ') && !t.startsWith(' ')) text += ' ';
    else if (wasSup && gap > 0.05 * hX && !t.startsWith(' ')) text += ' ';
    text += t;
  });
  close();
  const x0 = Math.min(...seg.map((r) => r.rect.x)), y0 = Math.min(...seg.map((r) => r.rect.y));
  const x1 = Math.max(...seg.map((r) => r.rect.x + r.rect.w)), y1 = Math.max(...seg.map((r) => r.rect.y + r.rect.h));
  const glyphs = seg.filter((r) => Array.from(r.text.trim()).length === 1).length;
  const words = (text.match(/\p{L}{3,}/gu) ?? []).length;
  void aspect;
  return { text: text.trim(), rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, runs: seg, math: seg.length >= 3 && glyphs / seg.length > 0.5 && words <= 2 };
}
