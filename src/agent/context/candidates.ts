// src/agent/context/candidates.ts — per-question evidence for the scout (design §2.2): the visible
// page's neighbourhood, pages the question names by label or printed page number, and keyword (BM25)
// hits, merged (each page once, ≤ 8 pages) into a CANDIDATES block of ≈ 150–250 tokens a page. Local,
// free, < 1 ms once the index holds the pages. Also the scout's `find` resolver (§2.6).
import type { MapEntry } from './docmap';
import { sectionOf } from './docmap.ts';
import type { LabelIndex } from './labels';
import { mentions } from './labels.ts';
import { rankPages, snippet } from './search.ts';
import { pagesNamed } from './printed.ts';

export type Why = 'neighbour' | 'label' | 'page' | 'search';
export type Candidate = { page: number; why: Why; label?: string };

export const MAX_CANDIDATES = 8;
const SEARCH_K = 5;
/** One page's lines in the block at most (≈ 200 tokens). */
const PAGE_CHARS = 700;
/** The whole block at most (≈ 1.5k tokens). */
export const CANDIDATE_CHARS = 5000;

export type CandidateInput = {
  page: number;
  numPages: number;
  question: string;
  /** The previous question (its labels count too: "where is that explained" often follows one). */
  prior?: string;
  map: MapEntry[];
  labels: LabelIndex;
  /** PDF − printed page (0: the same). */
  printedOffset: number;
  /** The indexed pages' text lines. */
  pages: Map<number, string[]>;
  /** Pages already shown in full (the section card): not repeated as neighbours. */
  shown?: Set<number>;
};

/** The visible page ±2, and the whole section when it is ≤ 6 pages. */
export function neighbourhood(page: number, numPages: number, map: MapEntry[]): number[] {
  const out: number[] = [];
  for (const d of [-1, 1, -2, 2]) { const p = page + d; if (p >= 1 && p <= numPages) out.push(p); }
  const s = sectionOf(map, page);
  if (s && s.to - s.from + 1 <= 6) for (let p = s.from; p <= s.to; p++) if (p !== page && !out.includes(p)) out.push(p);
  return out;
}

/** The candidates, in order: named pages (labels, printed page numbers), neighbours, search hits. */
export function candidates(i: CandidateInput): Candidate[] {
  const out: Candidate[] = [];
  const has = (p: number) => p === i.page || out.some((c) => c.page === p);
  const add = (c: Candidate) => { if (out.length < MAX_CANDIDATES && c.page >= 1 && c.page <= i.numPages && !has(c.page)) out.push(c); };
  for (const [label, p] of i.labels.resolve(i.question)) add({ page: p, why: 'label', label });
  for (const n of pagesNamed(i.question)) add({ page: n + i.printedOffset, why: 'page', label: `page ${n}` });
  if (i.prior) for (const [label, p] of i.labels.resolve(i.prior)) add({ page: p, why: 'label', label });
  for (const p of neighbourhood(i.page, i.numPages, i.map)) if (!i.shown?.has(p)) add({ page: p, why: 'neighbour' });
  const near = new Set([i.page, ...neighbourhood(i.page, i.numPages, i.map), ...(i.shown ?? [])]);
  // Keyword hits: the question, then the visible section's title as a second, lower-weight query.
  // Back matter (contents, answer keys, chapter reviews, exercises, index) matches every term and
  // teaches none, so it is skipped; one page per section, so five hits are five places.
  const q = i.question.replace(/\b(?:page|pg\.?|pp?\.)\s*\d+/gi, ' ');
  const sec = sectionOf(i.map, i.page);
  const used = new Set<string>();
  let k = 0;
  for (const query of [q, sec?.title ?? '']) {
    if (!query) continue;
    for (const h of rankPages(i.pages, query, 60, near)) {
      if (k >= SEARCH_K || out.length >= MAX_CANDIDATES) break;
      if (apparatus(i.map, h.page)) continue;
      const s = sectionOf(i.map, h.page);
      const key = s ? `${s.from}:${s.title}` : `p${h.page}`;
      if (used.has(key) || has(h.page)) continue;
      used.add(key);
      add({ page: h.page, why: 'search' });
      k++;
    }
    if (k >= 3) break; // the section title only tops up a thin result
  }
  return out;
}

/** Contents, answer keys, reviews, exercises, indexes: pages that mention everything. */
const APPARATUS = /^(table of )?contents\b|^index\b|^answer key|^answers\b|^solutions?\b|^chapter review|^review questions|^key (terms|equations|concepts)|^summary\b|^conceptual questions|^(additional |challenge )?problems\b|^exercises\b|^homework\b|^practice\b|^glossary\b|^references\b|^bibliography\b|^check your understanding/i;
export function apparatus(map: MapEntry[], page: number): boolean {
  return map.some((e) => e.from <= page && e.to >= page && APPARATUS.test(e.title.replace(/^[\d.]+\s+/, '')));
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * `CANDIDATES` block: per page its number, its section from the map, why it is here, and its best
 * matching lines (a neighbour: its first lines). Pages the index has not read yet say so.
 */
export function formatCandidates(cs: Candidate[], i: Pick<CandidateInput, 'question' | 'map' | 'pages'>, indexing: boolean, maxChars = CANDIDATE_CHARS): string {
  if (!cs.length) return '';
  const out = [`CANDIDATES (found locally for this question: pages it names, the visible page's neighbours, keyword matches; any other page may be chosen too)${indexing ? ' — the document is still being read: some pages are not searched yet' : ''}`];
  let n = out[0].length;
  for (const c of cs) {
    const sec = sectionOf(i.map, c.page);
    const why = c.why === 'label' ? `"${c.label}" named` : c.why === 'page' ? `printed ${c.label} named` : c.why;
    const head = `p${c.page}${sec ? ` · ${clip(sec.title, 60)}` : ''} · ${why}`;
    const ls = i.pages.get(c.page);
    let body: string;
    if (!ls) body = '(not read yet)';
    else {
      const picked = c.why === 'neighbour' || c.why === 'page' ? ls.slice(0, 4) : snippet(ls, c.label ? `${c.label} ${i.question}` : i.question, 3);
      body = clip((picked.length ? picked : ls.slice(0, 3)).map(squash).filter(Boolean).join(' · '), PAGE_CHARS) || '(no text)';
    }
    const s = `${head}: ${body}`;
    if (n + s.length + 1 > maxChars) break;
    out.push(s);
    n += s.length + 1;
  }
  return out.join('\n');
}

/**
 * The scout's `find` strings → pages, locally: a label it names through the label index, else the
 * best keyword page. Pages in `exclude` (already chosen) are not returned again.
 */
export function resolveFind(find: string[], labels: LabelIndex, pages: Map<number, string[]>, exclude: Set<number>): { q: string; page: number; via: 'label' | 'search' }[] {
  const out: { q: string; page: number; via: 'label' | 'search' }[] = [];
  const taken = new Set(exclude);
  for (const q of find.slice(0, 3)) {
    const s = squash(q).slice(0, 120);
    if (!s) continue;
    const named = mentions(s).length ? labels.resolve(s).find(([, p]) => !taken.has(p)) : undefined;
    const hit = named ? { page: named[1], via: 'label' as const } : (() => { const r = rankPages(pages, s, 1, taken)[0]; return r ? { page: r.page, via: 'search' as const } : null; })();
    if (hit) { out.push({ q: s, ...hit }); taken.add(hit.page); }
  }
  return out;
}
