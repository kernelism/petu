// src/pdf/sections.ts
import type { PdfDoc } from './loadPdf';
import type { TextRun } from '../locate/locateQuote';
import { textLines, type TextLine } from '../agent/context/textLines';
import { resolveOutline, type Bookmark } from '../agent/context/outline';

/**
 * Where a page sits in the document, for the journey route ("p3 → p12 · Confidence intervals") and
 * the answer's part titles: the deepest bookmark at or before the page, else the page's own title
 * (its largest line near the top).
 */
const MAX_LABEL = 48;

const trim = (s: string) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > MAX_LABEL ? `${t.slice(0, MAX_LABEL - 1).trimEnd()}…` : t; };

/** The deepest bookmark at or before `page` (bookmarks sorted by page, then depth). */
export function sectionFor(bookmarks: Bookmark[], page: number): string | undefined {
  let best: Bookmark | undefined;
  for (const b of bookmarks) if (b.page <= page && (!best || b.page > best.page || (b.page === best.page && (b.depth ?? 0) >= (best.depth ?? 0)))) best = b;
  return best ? trim(best.title) : undefined;
}

/** A page's title: the tallest line with letters in its top quarter (a slide title, a heading). */
export function pageTitle(lines: TextLine[]): string | undefined {
  const top = lines.filter((l) => l.rect.y < 250 && !l.math && /\p{L}{2,}/u.test(l.text) && !/^\d+$/.test(l.text.trim()));
  if (!top.length) return undefined;
  const t = top.reduce((a, b) => (b.rect.h > a.rect.h * 1.05 || (b.rect.h >= a.rect.h * 0.95 && b.rect.y < a.rect.y) ? b : a));
  return trim(t.text);
}

/** Labels per page, loaded on demand and cached; `get` is synchronous (undefined until loaded). */
export class SectionLabels {
  private outline: Promise<Bookmark[]>;
  private cache = new Map<number, string | null>();
  constructor(private doc: PdfDoc, private runs: (page: number) => Promise<TextRun[]>, private aspect: (page: number) => number) {
    this.outline = resolveOutline(doc as never).catch(() => []);
  }
  get(page: number): string | undefined { return this.cache.get(page) ?? undefined; }
  async load(page: number): Promise<string | undefined> {
    if (this.cache.has(page)) return this.cache.get(page) ?? undefined;
    let label: string | undefined;
    try {
      label = sectionFor(await this.outline, page);
      if (!label && page >= 1 && page <= this.doc.numPages) label = pageTitle(textLines(await this.runs(page), this.aspect(page)));
    } catch { label = undefined; }
    this.cache.set(page, label ?? null);
    return label;
  }
}
