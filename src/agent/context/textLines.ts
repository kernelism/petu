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
  const rs = runs.filter((r) => r.text.trim() && r.rect.w > 0 && r.rect.h > 0);
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
  out.sort((a, b) => (Math.abs(a.rect.y - b.rect.y) < Math.min(a.rect.h, b.rect.h) * 0.5 ? a.rect.x - b.rect.x : a.rect.y - b.rect.y));
  return out.map((l, i) => ({ ...l, id: `t${i + 1}` }));
}

function lineOf(seg: TextRun[], hX: number, aspect: number): Omit<TextLine, 'id'> {
  let text = '';
  seg.forEach((r, i) => {
    const prev = seg[i - 1];
    const gap = prev ? r.rect.x - (prev.rect.x + prev.rect.w) : 0;
    const t = r.text.replace(/\s+/g, ' ');
    if (prev && gap > 0.12 * hX && !text.endsWith(' ') && !t.startsWith(' ')) text += ' ';
    text += t;
  });
  const x0 = Math.min(...seg.map((r) => r.rect.x)), y0 = Math.min(...seg.map((r) => r.rect.y));
  const x1 = Math.max(...seg.map((r) => r.rect.x + r.rect.w)), y1 = Math.max(...seg.map((r) => r.rect.y + r.rect.h));
  const glyphs = seg.filter((r) => Array.from(r.text.trim()).length === 1).length;
  const words = (text.match(/\p{L}{3,}/gu) ?? []).length;
  void aspect;
  return { text: text.trim(), rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, runs: seg, math: seg.length >= 3 && glyphs / seg.length > 0.5 && words <= 2 };
}
