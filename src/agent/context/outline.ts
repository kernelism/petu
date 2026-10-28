// src/agent/context/outline.ts — the document header: what the deck/book is and where things are.

export type Bookmark = { title: string; page: number; depth?: number };

const SHORT_DOC = 80;
const MAX_BOOKMARKS = 120;
const WINDOW = 10;
const LINE = 80;
const clip = (s: string) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > LINE ? `${t.slice(0, LINE - 1)}…` : t; };

/**
 * ≤ 80 pages: one line per page (`p12: <first line>`), stable per document so it caches.
 * Longer: the PDF outline (≤ 120 bookmarks) plus first lines for pages p−10…p+10.
 */
export function docHeader(name: string, numPages: number, page: number, firstLines: Map<number, string>, bookmarks?: Bookmark[]): string {
  const out = [`DOCUMENT ${name} (${numPages} page${numPages === 1 ? '' : 's'})`];
  const first = (p: number) => `p${p}: ${firstLines.has(p) ? clip(firstLines.get(p)!) : '…'}`;
  if (numPages <= SHORT_DOC) {
    for (let p = 1; p <= numPages; p++) out.push(first(p));
    return out.join('\n');
  }
  if (bookmarks?.length) {
    out.push('OUTLINE');
    for (const b of bookmarks.slice(0, MAX_BOOKMARKS)) out.push(`${'  '.repeat(Math.min(b.depth ?? 0, 3))}${clip(b.title)} … p${b.page}`);
  }
  const lo = Math.max(1, page - WINDOW), hi = Math.min(numPages, page + WINDOW);
  out.push(`PAGES ${lo}–${hi}`);
  for (let p = lo; p <= hi; p++) out.push(first(p));
  return out.join('\n');
}

type OutlineNode = { title: string; dest: string | unknown[] | null; items: OutlineNode[] };
type OutlineDoc = {
  getOutline(): Promise<OutlineNode[] | null>;
  getDestination(id: string): Promise<unknown[] | null>;
  getPageIndex(ref: { num: number; gen: number }): Promise<number>;
};

/**
 * The PDF's bookmarks resolved to 1-based pages, at most 120: whole levels first (chapters, then
 * sections, …) so a long book's outline spans the whole book, listed in page order. [] when none.
 */
export async function resolveOutline(doc: OutlineDoc): Promise<Bookmark[]> {
  let level: OutlineNode[] = [];
  try { level = (await doc.getOutline()) ?? []; } catch { return []; }
  const out: Bookmark[] = [];
  for (let depth = 0; level.length && out.length < MAX_BOOKMARKS; depth++) {
    for (const n of level) {
      if (out.length >= MAX_BOOKMARKS) break;
      try {
        const dest = typeof n.dest === 'string' ? await doc.getDestination(n.dest) : n.dest;
        const ref = dest?.[0];
        const idx = typeof ref === 'number' ? ref : ref && typeof ref === 'object' ? await doc.getPageIndex(ref as { num: number; gen: number }) : -1;
        if (idx >= 0 && n.title?.trim()) out.push({ title: n.title, page: idx + 1, depth });
      } catch { /* unresolvable bookmark: skip */ }
    }
    level = level.flatMap((n) => n.items ?? []);
  }
  return out.sort((a, b) => a.page - b.page || a.depth! - b.depth!);
}
