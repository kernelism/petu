// src/agent/context/digest.ts — the deck digest: every page in one block (number, title, its text
// lines trimmed), read by the scout to plan the walk and sent again with the answer. It is built from
// the document's text index (search.ts) and depends only on the document, so it is a stable,
// cacheable prefix for both stages.
import type { Bookmark } from './outline';

/** The whole digest stays under this (≈ 15k tokens at 3.3 chars/token), whatever the page count. */
export const DIGEST_CHARS = 48_000;
/** One page's share at most (a slide's title and its main lines). */
export const PAGE_CHARS = 360;
/** One page's share at least (a long book still gets every page's title). */
const PAGE_MIN = 30;
const BOOKMARKS = 120;
const BOOKMARK_LINE = 80;

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
/** Lines worth reading: not empty, not a bare page or slide number. */
const keep = (l: string) => { const t = squash(l); return t.length > 0 && !/^\d{1,4}$/.test(t) && !/^(page|slide)\s*\d+(\s*(of|\/)\s*\d+)?$/i.test(t); };
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s);

/** A page's characters: an equal share of the budget, between PAGE_MIN and PAGE_CHARS. */
export const pageShare = (numPages: number) => Math.max(PAGE_MIN, Math.min(PAGE_CHARS, Math.floor(DIGEST_CHARS / Math.max(1, numPages)) - 8));

/**
 * `p12: Title · line · line…` for every page, in page order. A page the index has not read yet is
 * `p12: …`; a page without text is `p12: (no text)`. A long document's bookmarks come first.
 */
export function deckDigest(name: string, numPages: number, pages: (page: number) => string[] | undefined, bookmarks: Bookmark[] = []): string {
  const out = [`DECK ${name} (${numPages} page${numPages === 1 ? '' : 's'}): every page, its title first, then its text, trimmed`];
  if (bookmarks.length) {
    out.push('OUTLINE');
    for (const b of bookmarks.slice(0, BOOKMARKS)) out.push(`${'  '.repeat(Math.min(b.depth ?? 0, 3))}${clip(squash(b.title), BOOKMARK_LINE)} … p${b.page}`);
  }
  const share = pageShare(numPages);
  for (let p = 1; p <= numPages; p++) {
    const ls = pages(p);
    if (!ls) { out.push(`p${p}: …`); continue; }
    const lines = ls.filter(keep).map(squash);
    out.push(`p${p}: ${lines.length ? clip(lines.join(' · '), share) : '(no text)'}`);
  }
  return out.join('\n');
}
