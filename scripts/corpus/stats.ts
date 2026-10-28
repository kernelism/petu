// scripts/corpus/stats.ts — pure helpers for the corpus stress profile (tested in tests/corpus).
import { mulberry32 } from '../eval/sample.ts';

/**
 * `k` distinct pages of 1…n: half evenly spread (first, last and between), the rest seeded random,
 * sorted. Deterministic for a seed.
 */
export function samplePages(n: number, k: number, seed = 670): number[] {
  if (n <= k) return Array.from({ length: n }, (_, i) => i + 1);
  const out = new Set<number>();
  const even = Math.ceil(k / 2);
  for (let i = 0; i < even; i++) out.add(1 + Math.round((i * (n - 1)) / Math.max(1, even - 1)));
  const rnd = mulberry32(seed);
  while (out.size < k) out.add(1 + Math.floor(rnd() * n));
  return [...out].sort((a, b) => a - b);
}

/** p50 / p90 / max of a list (nearest rank). */
export function pct(xs: number[]): { p50: number; p90: number; max: number } {
  if (!xs.length) return { p50: 0, p90: 0, max: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))];
  return { p50: at(0.5), p90: at(0.9), max: s[s.length - 1] };
}

/** Page sizes as "612x792 ×959, 595x842 ×2", most common first. */
export function sizeHistogram(sizes: string[]): string {
  const m = new Map<string, number>();
  for (const s of sizes) m.set(s, (m.get(s) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ×${n}`).join(', ');
}

/**
 * Per-page digest lines `p12: …` → how many characters each page's entry carries after its `pN: `
 * prefix, and how many were cut (end in …).
 */
export function digestPageStats(digest: string): { pages: number; avgChars: number; clipped: number; empty: number; unread: number } {
  let pages = 0, chars = 0, clipped = 0, empty = 0, unread = 0;
  for (const l of digest.split('\n')) {
    const m = /^p\d+: (.*)$/.exec(l);
    if (!m) continue;
    pages++;
    const body = m[1];
    if (body === '…') { unread++; continue; }
    if (body === '(no text)') { empty++; continue; }
    chars += body.length;
    if (body.endsWith('…')) clipped++;
  }
  return { pages, avgChars: pages ? Math.round(chars / Math.max(1, pages - unread - empty)) : 0, clipped, empty, unread };
}

/** 1-based rank of `page` in a ranked list (accepting `slack` pages either side), or 0 when absent. */
export function rankOf(ranked: number[], page: number, slack = 0): number {
  const i = ranked.findIndex((p) => Math.abs(p - page) <= slack);
  return i < 0 ? 0 : i + 1;
}
