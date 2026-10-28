// src/agent/context/docmap.ts — the document map (design "Huge-PDF context" §2.1): every bookmark with
// its page range (or detected headings when there are none), under a document card. Built from the
// outline alone (and a fixed sample of pages for the card), so it is byte-identical on every question
// and never depends on how far the text index has got: the cached prefix of medium and huge documents.
import type { TextLine } from './textLines';

export type MapEntry = { title: string; depth: number; from: number; to: number };
type OutlineNode = { title: string; dest: string | unknown[] | null; items: OutlineNode[] };
type OutlineDoc = {
  getOutline(): Promise<OutlineNode[] | null>;
  getDestination(id: string): Promise<unknown[] | null>;
  getPageIndex(ref: { num: number; gen: number }): Promise<number>;
};

/** The map's budget (tokens at 3.3 chars/token): past it, the deepest level goes, chapter by chapter from the back. */
export const MAP_TOKENS = 6000;
const CHARS_PER_TOKEN = 3.3;
const TITLE = 80;
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Every bookmark (all levels) resolved to 1-based pages, in page order (a parent before its child). */
export async function outlineTree(doc: OutlineDoc): Promise<{ title: string; page: number; depth: number }[]> {
  let roots: OutlineNode[] = [];
  try { roots = (await doc.getOutline()) ?? []; } catch { return []; }
  const flat: { title: string; page: number; depth: number; seq: number }[] = [];
  let seq = 0;
  const walk = async (ns: OutlineNode[], depth: number) => {
    for (const n of ns) {
      try {
        const dest = typeof n.dest === 'string' ? await doc.getDestination(n.dest) : n.dest;
        const ref = dest?.[0];
        const idx = typeof ref === 'number' ? ref : ref && typeof ref === 'object' ? await doc.getPageIndex(ref as { num: number; gen: number }) : -1;
        if (idx >= 0 && n.title?.trim()) flat.push({ title: squash(n.title), page: idx + 1, depth, seq: seq++ });
      } catch { /* unresolvable bookmark: skip */ }
      await walk(n.items ?? [], depth + 1);
    }
  };
  await walk(roots, 0);
  return flat.sort((a, b) => a.page - b.page || a.depth - b.depth || a.seq - b.seq).map(({ title, page, depth }) => ({ title, page, depth }));
}

/**
 * Page ranges: an entry runs to the page before the next entry at its depth or above (the last to
 * the end). Entries whose range would be empty (a later sibling on the same page) are dropped.
 * A "map" with more than one entry per page (bookmarks that lie) is no map: [].
 */
export function withRanges(bs: { title: string; page: number; depth: number }[], numPages: number): MapEntry[] {
  const ok = bs.filter((b) => b.page >= 1 && b.page <= numPages);
  if (ok.length > numPages) return [];
  const out: MapEntry[] = [];
  ok.forEach((e, i) => {
    const next = ok.slice(i + 1).find((f) => f.depth <= e.depth);
    if (next && next.page === e.page && next.depth === e.depth) return; // same page, same level: the later one stands
    out.push({ title: e.title, depth: e.depth, from: e.page, to: next ? Math.max(e.page, next.page - 1) : numPages });
  });
  return out;
}

const entryLine = (e: MapEntry) => `${'  '.repeat(Math.min(e.depth, 3))}${clip(e.title, TITLE)} p${e.from}${e.to > e.from ? `–${e.to}` : ''}`;

/**
 * Cuts a map to `maxTokens`: the deepest level remaining goes first, chapter by chapter from the back
 * of the book (each top-level entry's deepest children as a unit), so chapter titles always survive
 * and every chapter keeps one depth throughout.
 */
export function capMap(es: MapEntry[], maxTokens = MAP_TOKENS): MapEntry[] {
  const budget = maxTokens * CHARS_PER_TOKEN;
  const size = (xs: MapEntry[]) => xs.reduce((n, e) => n + entryLine(e).length + 1, 0);
  let out = es;
  let total = size(out);
  while (total > budget) {
    const deepest = Math.max(...out.map((e) => e.depth));
    if (deepest === 0) {
      // Only chapters left: cut from the back.
      while (out.length && total > budget) { total -= entryLine(out[out.length - 1]).length + 1; out = out.slice(0, -1); }
      break;
    }
    // The last top-level chapter that still has entries at the deepest level.
    let cut = -1;
    for (let i = out.length - 1; i >= 0; i--) if (out[i].depth === deepest) { cut = i; break; }
    let start = cut;
    while (start > 0 && out[start].depth !== 0) start--;
    const drop = new Set<number>();
    for (let i = start; i < out.length && (i === start || out[i].depth !== 0); i++) if (out[i].depth === deepest) drop.add(i);
    for (const i of drop) total -= entryLine(out[i]).length + 1;
    out = out.filter((_, i) => !drop.has(i));
  }
  return out;
}

/** A numbered heading line: `3.2 Identity Mapping by Shortcuts`, `IV. Results`, `Appendix D Proofs`. */
export const HEADING = /^((\d+(\.\d+){0,3})\.?|[IVX]+\.|Appendix [A-Z]|[A-Z]\.)\s+\p{Lu}[^.!?]{2,70}$/u;

/**
 * A page's heading candidates: numbered, short, sentence-case lines set in a font taller than the
 * page's body text (the height check keeps exercise numbers out). Used only without bookmarks.
 */
export function headingLines(lines: Pick<TextLine, 'text' | 'rect'>[]): string[] {
  if (!lines.length) return [];
  const hs = lines.map((l) => l.rect.h).sort((a, b) => a - b);
  const body = hs[Math.floor(hs.length / 2)];
  return lines.filter((l) => l.rect.h >= 1.12 * body && HEADING.test(squash(l.text))).map((l) => squash(l.text));
}

/** Detected headings as a flat map (depth from the number's dots), ranges to the next heading. */
export function headingMap(heads: Map<number, string[]>, numPages: number): MapEntry[] {
  const bs: { title: string; page: number; depth: number }[] = [];
  for (const p of [...heads.keys()].sort((a, b) => a - b)) for (const t of heads.get(p) ?? []) {
    const m = /^(\d+(?:\.\d+)*)/.exec(t);
    bs.push({ title: t, page: p, depth: m ? m[1].split('.').length - 1 : 0 });
  }
  return withRanges(bs, numPages);
}

/** Without bookmarks or headings: one entry per ~20 pages, named by the bucket's first page's first line. */
export function bucketMap(firstLine: (p: number) => string | undefined, numPages: number, every = 20): MapEntry[] {
  const out: MapEntry[] = [];
  for (let p = 1; p <= numPages; p += every) out.push({ title: clip(squash(firstLine(p) ?? '…'), TITLE), depth: 0, from: p, to: Math.min(numPages, p + every - 1) });
  return out;
}

export type DocCard = { name: string; numPages: number; printedOffset: number; scanned: boolean; source: 'bookmarks' | 'headings' | 'pages' | 'none' };

/** The document card and map, one cached block. */
export function formatMap(card: DocCard, es: MapEntry[]): string {
  const facts = [`${card.numPages} PDF pages`];
  if (card.printedOffset) facts.push(`printed page numbers run ${card.printedOffset > 0 ? card.printedOffset : -card.printedOffset} ${card.printedOffset > 0 ? 'behind' : 'ahead of'} PDF pages: printed page X = PDF page X${card.printedOffset > 0 ? '+' : '−'}${Math.abs(card.printedOffset)}; page numbers here are PDF pages`);
  if (card.scanned) facts.push('scanned: the pages are images without text');
  const what = card.source === 'bookmarks' ? 'the document\'s own outline' : card.source === 'headings' ? 'headings detected on the pages' : card.source === 'pages' ? 'first lines, every 20 pages' : '';
  const out = [`DOCUMENT ${card.name} (${facts.join('; ')})`];
  if (es.length) out.push(`MAP (${what}; every entry with its page range)`, ...es.map(entryLine));
  return out.join('\n');
}

/** The deepest map entry that contains `page`, preferring one of at most `maxPages` pages. */
export function sectionOf(es: MapEntry[], page: number): MapEntry | undefined {
  const hits = es.filter((e) => e.from <= page && e.to >= page).sort((a, b) => b.depth - a.depth);
  return hits[0];
}
