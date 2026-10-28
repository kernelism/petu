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
export const pageShare = (numPages: number, budget = DIGEST_CHARS) => Math.max(PAGE_MIN, Math.min(PAGE_CHARS, Math.floor(budget / Math.max(1, numPages)) - 8));

/**
 * Lines that repeat on many pages (running headers and footers: author, course, date) say nothing
 * about a page: a line on more than 40% of the read pages (and on at least 3) is dropped.
 */
export function boilerplate(numPages: number, pages: (page: number) => string[] | undefined): Set<string> {
  const seen = new Map<string, number>();
  let read = 0;
  for (let p = 1; p <= numPages; p++) {
    const ls = pages(p);
    if (!ls) continue;
    read++;
    for (const l of new Set(ls.map(squash))) if (l) seen.set(l, (seen.get(l) ?? 0) + 1);
  }
  const out = new Set<string>();
  for (const [l, n] of seen) if (n >= 3 && n > 0.4 * read) out.add(l);
  return out;
}

/**
 * `p12: Title · line · line…` for every page, in page order. A page the index has not read yet is
 * `p12: …`; a page without text is `p12: (no text)`. A long document's bookmarks come first.
 * Running headers and footers are left out (they would crowd out every page's title).
 */
export function deckDigest(name: string, numPages: number, pages: (page: number) => string[] | undefined, bookmarks: Bookmark[] = [], budget = DIGEST_CHARS): string {
  const skip = boilerplate(numPages, pages);
  const head = `DECK ${name} (${numPages} page${numPages === 1 ? '' : 's'}): every page, its title first, then its text, trimmed`;
  // The outline counts inside the budget (it used to overrun it by 1–3k chars): pages share what is
  // left; when even the minimum page share does not fit, the outline is cut from the back.
  let outline = bookmarks.slice(0, BOOKMARKS).map((b) => `${'  '.repeat(Math.min(b.depth ?? 0, 3))}${clip(squash(b.title), BOOKMARK_LINE)} … p${b.page}`);
  const size = (ls: string[]) => (ls.length ? 'OUTLINE'.length + 1 + ls.reduce((n, l) => n + l.length + 1, 0) : 0);
  const room = budget - head.length - 1;
  const share = pageShare(numPages, room - size(outline));
  const pagesMax = numPages * (share + 8);
  while (outline.length && size(outline) + pagesMax > room) outline = outline.slice(0, -1);
  const out = [head];
  if (outline.length) out.push('OUTLINE', ...outline);
  for (let p = 1; p <= numPages; p++) {
    const ls = pages(p);
    if (!ls) { out.push(`p${p}: …`); continue; }
    const lines = ls.filter(keep).map(squash).filter((l) => !skip.has(l));
    out.push(`p${p}: ${lines.length ? clip(lines.join(' · '), share) : '(no text)'}`);
  }
  return out.join('\n');
}
