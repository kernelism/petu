import type { PageRect } from '../geometry/space';

/** `font` is a CSS font string used only to measure relative glyph widths. */
export type TextRun = { text: string; rect: PageRect; font?: string };
/** Width of `s` in `font`, in any consistent unit (only ratios are used). */
export type Measure = (font: string, s: string) => number;
export type LocateOpts = { measure?: Measure };

let canvasMeasure: Measure | null | undefined;
/** A cached 2D-canvas measurer, or null where no canvas exists (jsdom, node). */
function defaultMeasure(): Measure | null {
  if (canvasMeasure !== undefined) return canvasMeasure;
  canvasMeasure = null;
  try {
    let ctx: { font: string; measureText(s: string): { width: number } } | null = null;
    if (typeof OffscreenCanvas !== 'undefined') ctx = new OffscreenCanvas(1, 1).getContext('2d') as typeof ctx;
    else if (typeof document !== 'undefined' && !/jsdom/i.test(navigator.userAgent)) ctx = document.createElement('canvas').getContext('2d');
    if (ctx) {
      const c = ctx;
      canvasMeasure = (font, str) => { c.font = font; return c.measureText(str).width; };
    }
  } catch { /* no canvas: proportional */ }
  return canvasMeasure;
}

const LIG: Record<string, string> = { 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬀ': 'ff', 'ﬃ': 'ffi', 'ﬄ': 'ffl' };

function normChar(c: string): string {
  if (c === '\u00AD') return '';
  if (LIG[c]) return LIG[c];
  const n = c.normalize('NFKC');
  if (/[‘’′`´]/.test(n)) return "'";
  if (/[“”″]/.test(n)) return '"';
  if (/[‐‑‒–—−]/.test(n)) return '-';
  if (/\s/.test(n)) return ' ';
  return n.toLowerCase();
}

export function normalizeText(s: string): string {
  let out = '';
  for (const c of s) {
    const n = normChar(c);
    if (n === ' ' && (out === '' || out.endsWith(' '))) continue;
    out += n;
  }
  return out.trim();
}

type Slot = { run: number; ch: number }; // ch = -1 for inserted separators

const sameLine = (a: PageRect, b: PageRect) => Math.abs(a.y + a.h / 2 - (b.y + b.h / 2)) < Math.min(a.h, b.h) * 0.5;

function buildIndex(runs: TextRun[]) {
  let text = '';
  const map: Slot[] = [];
  const add = (s: string, slot: Slot) => {
    for (const c of s) {
      if (c === ' ' && (text === '' || text.endsWith(' '))) continue;
      text += c;
      map.push(slot);
    }
  };
  runs.forEach((r, ri) => {
    const chars = Array.from(r.text);
    const next = runs[ri + 1];
    const hyphenBreak = !!next && /[-‐]$/.test(r.text) && !sameLine(r.rect, next.rect);
    chars.forEach((c, ci) => {
      if (hyphenBreak && ci === chars.length - 1) return;
      const n = normChar(c);
      if (n === '-') return; // hyphens are optional: indexed text has none, and the quote's are stripped too
      add(n, { run: ri, ch: ci });
    });
    if (!next || hyphenBreak) return;
    const gap = next.rect.x - (r.rect.x + r.rect.w);
    // Touching = the next run continues this word to the right. A big negative gap means the next
    // run sits to the left (content-stream order jumped, e.g. labels in a figure): not the same word.
    const touching = sameLine(r.rect, next.rect) && gap < r.rect.h * 0.15 && gap > -r.rect.h * 0.3;
    if (!touching) add(' ', { run: ri, ch: -1 });
  });
  return { text, map };
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const t = s.replace(/ /g, '');
  for (let i = 0; i < t.length - 1; i++) m.set(t.slice(i, i + 2), (m.get(t.slice(i, i + 2)) ?? 0) + 1);
  return m;
}
function dice(a: string, b: string): number {
  const A = bigrams(a), B = bigrams(b);
  let inter = 0, total = 0;
  A.forEach((n, k) => { inter += Math.min(n, B.get(k) ?? 0); total += n; });
  B.forEach((n) => (total += n));
  return total ? (2 * inter) / total : 0;
}

function fuzzy(text: string, q: string): [number, number] | null {
  if (q.length < 12) return null; // short quotes are too ambiguous to guess at: a wrong highlight is worse than none
  const words: { s: number; e: number }[] = [];
  for (const m of text.matchAll(/\S+/g)) words.push({ s: m.index!, e: m.index! + m[0].length });
  const n = q.split(' ').length;
  let best: [number, number] | null = null, bestScore = 0.65;
  for (let size = Math.max(1, n - 2); size <= n + 2; size++) {
    for (let i = 0; i + size <= words.length; i++) {
      const s = words[i].s, e = words[i + size - 1].e;
      const score = dice(text.slice(s, e), q);
      if (score > bestScore) { bestScore = score; best = [s, e]; }
    }
  }
  return best;
}

const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);

/**
 * Finds `quote` in the page's text runs. Returns one rect per line, in model coords, or [].
 * Exact matches on word boundaries win; among several, the one nearest `near` (or the first).
 */
export function locateQuote(runs: TextRun[], quote: string, near?: { x: number; y: number }, opts: LocateOpts = {}): PageRect[] {
  const q = normalizeText(quote).replace(/-/g, '').replace(/ {2,}/g, ' ').trim();
  if (!q || !runs.length) return [];
  const { text, map } = buildIndex(runs);
  const hits: number[] = [];
  for (let i = text.indexOf(q); i >= 0; i = text.indexOf(q, i + 1)) hits.push(i);
  const whole = hits.filter((i) => !isWordChar(text[i - 1]) && !isWordChar(text[i + q.length]));
  const candidates = (whole.length ? whole : q.length >= 12 ? hits : []).map((i) => [i, i + q.length] as [number, number]);
  if (!candidates.length) {
    const f = fuzzy(text, q);
    if (f) candidates.push(f);
  }
  if (!candidates.length) return [];
  const results = candidates.map((range) => rectsFor(runs, map, range, opts.measure ?? defaultMeasure()));
  if (!near || results.length === 1) return results[0];
  const dist = (rs: PageRect[]) => Math.hypot(rs[0].x + rs[0].w / 2 - near.x, rs[0].y + rs[0].h / 2 - near.y);
  return results.reduce((best, r) => (dist(r) < dist(best) ? r : best));
}

function rectsFor(runs: TextRun[], map: Slot[], range: [number, number], measure: Measure | null): PageRect[] {
  const span = new Map<number, { min: number; max: number }>();
  for (let i = range[0]; i < range[1]; i++) {
    const { run, ch } = map[i];
    if (ch < 0) continue;
    const s = span.get(run) ?? { min: ch, max: ch };
    span.set(run, { min: Math.min(s.min, ch), max: Math.max(s.max, ch) });
  }

  const lines: PageRect[] = [];
  [...span.entries()].sort((a, b) => a[0] - b[0]).forEach(([ri, { min, max }]) => {
    const r = runs[ri].rect;
    const chars = Array.from(runs[ri].text);
    const len = chars.length;
    let f0 = min / len, f1 = (max + 1) / len; // proportional by default
    const font = runs[ri].font;
    if (measure && font) {
      try {
        const total = measure(font, chars.join(''));
        const a = measure(font, chars.slice(0, min).join('')) / total;
        const b = measure(font, chars.slice(0, max + 1).join('')) / total;
        if (total > 0 && Number.isFinite(a) && Number.isFinite(b) && a >= 0 && b > a && b <= 1.0001) { f0 = a; f1 = Math.min(b, 1); }
      } catch { /* keep proportional */ }
    }
    const part: PageRect = { x: r.x + r.w * f0, y: r.y, w: r.w * (f1 - f0), h: r.h };
    const line = lines.find((l) => sameLine(l, part));
    if (!line) { lines.push(part); return; }
    const x1 = Math.min(line.x, part.x), x2 = Math.max(line.x + line.w, part.x + part.w);
    const y1 = Math.min(line.y, part.y), y2 = Math.max(line.y + line.h, part.y + part.h);
    Object.assign(line, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
  });
  return lines.sort((a, b) => a.y - b.y);
}
