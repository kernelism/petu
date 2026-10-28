// src/agent/context/tiers.ts — the tiered context (design "Huge-PDF context" §2): what the scout and
// stage 2 read, by page count. Pure functions over page texts, shared by the browser's ContextBuilder
// and the offline benchmark (scripts/corpus/ctxBench.ts), so the benchmark measures the real blocks.
//
//   small  ≤ 60    the digest (≤ 360 chars/page)                                 + candidates
//   medium 61–400  the document card + map, then the digest (120–360 chars/page) + candidates
//   huge   > 400   the document card + map; the visible section at full detail   + candidates
import type { MapEntry } from './docmap';
import { boilerplate, PAGE_CHARS } from './digest.ts';

export type Tier = 'small' | 'medium' | 'huge';
export const SMALL_MAX = 60;
export const MEDIUM_MAX = 400;
export const tierOf = (numPages: number): Tier => (numPages <= SMALL_MAX ? 'small' : numPages <= MEDIUM_MAX ? 'medium' : 'huge');

/** A section longer than this is centred on the visible page instead (±HALF pages). */
export const SECTION_MAX = 36;
const HALF = 10;

/**
 * The pages of the visible page's section card: the deepest map entry of ≥ 3 pages that contains the
 * page (≤ 36 pages: all of it); a longer section, or none, is a 21-page window centred on a multiple of
 * 10 near the page (so neighbouring pages share one cached card).
 */
export function sectionWindow(map: MapEntry[], page: number, numPages: number): { from: number; to: number; title?: string } {
  const hits = map.filter((e) => e.from <= page && e.to >= page).sort((a, b) => b.depth - a.depth);
  const s = hits.find((e) => e.to - e.from + 1 >= 3) ?? hits[0];
  if (s && s.to - s.from + 1 <= SECTION_MAX) return { from: s.from, to: s.to, title: s.title };
  const lo0 = s?.from ?? 1, hi0 = s?.to ?? numPages;
  const c = Math.min(Math.max(Math.round(page / HALF) * HALF, lo0), hi0);
  let from = Math.max(lo0, c - HALF), to = Math.min(hi0, c + HALF);
  if (page < from) from = page;
  if (page > to) to = page;
  return { from, to, ...(s ? { title: s.title } : {}) };
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const keep = (l: string) => { const t = squash(l); return t.length > 0 && !/^\d{1,4}$/.test(t); };
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s);

/**
 * The section card: every page of the window at the digest's full detail (360 chars a page),
 * running headers and footers left out (`skip`: the boilerplate of the sampled pages).
 */
export function sectionCard(w: { from: number; to: number; title?: string }, lines: (p: number) => string[] | undefined, skip: Set<string> = new Set()): string {
  const out = [`SECTION${w.title ? ` ${clip(squash(w.title), 80)}` : ''} (p${w.from}–${w.to}; the student's part of the document, every page at full detail)`];
  for (let p = w.from; p <= w.to; p++) {
    const ls = lines(p);
    if (!ls) { out.push(`p${p}: …`); continue; }
    const t = ls.filter(keep).map(squash).filter((l) => !skip.has(l));
    out.push(`p${p}: ${t.length ? clip(t.join(' · '), PAGE_CHARS) : '(no text)'}`);
  }
  return out.join('\n');
}

/** Running headers/footers judged from the window itself (a line on > 40% of its pages, ≥ 3). */
export function windowBoilerplate(w: { from: number; to: number }, lines: (p: number) => string[] | undefined): Set<string> {
  return boilerplate(w.to - w.from + 1, (i) => lines(w.from + i - 1));
}

/** Token estimate used everywhere in the context (≈ 3.3 chars per token on these listings). */
export const tokens = (s: string | undefined) => (s ? Math.ceil(s.length / 3.3) : 0);
