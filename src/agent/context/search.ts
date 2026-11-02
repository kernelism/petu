// src/agent/context/search.ts — a lazy per-document text index: first lines for the outline, and
// keyword hits (BM25) from pages not already sent with the question.

const STOP = new Set(('the and for are but not you all any can had her was one our out his has how its may new now see two way who did does get got let put say she too use what when why with this that from they them then than there these those which will would could should about into onto over under also only just more most some such very each other where while been being have here were your why whose upon via per both same own off yet').split(' '));

/** Lowercase word stems of 3+ letters, minus stopwords. */
export function stems(s: string): string[] {
  const out: string[] = [];
  for (const m of s.toLowerCase().matchAll(/\p{L}[\p{L}\p{N}]*/gu)) {
    const w = m[0];
    if (w.length < 3 || STOP.has(w)) continue;
    out.push(stem(w));
  }
  return out;
}
function stem(w: string): string {
  const cut = (n: number, add = '') => (w.length - n >= 3 ? w.slice(0, w.length - n) + add : w);
  if (w.endsWith('ies')) return cut(3, 'y');
  if (w.endsWith('ing')) return cut(3);
  if (/(s|x|z|ch|sh)es$/.test(w)) return cut(2);
  if (w.endsWith('ed')) return cut(2);
  if (w.endsWith('s') && !w.endsWith('ss')) return cut(1);
  return w;
}

const K1 = 1.2, B = 0.75;

const statsOf = new WeakMap<string[], { tf: Map<string, number>; len: number }>();
/** Term frequencies of a page, cached per lines array (index pages are stored once). */
function termStats(lines: string[]) {
  let st = statsOf.get(lines);
  if (!st) {
    const tf = new Map<string, number>();
    let len = 0;
    for (const l of lines) for (const t of stems(l)) { tf.set(t, (tf.get(t) ?? 0) + 1); len++; }
    statsOf.set(lines, (st = { tf, len }));
  }
  return st;
}

/** BM25 over pages (each a list of lines). Only pages with at least one query term are returned. */
export function rankPages(pages: Map<number, string[]>, query: string, k = 3, exclude: Set<number> = new Set()): { page: number; score: number }[] {
  const q = [...new Set(stems(query))];
  if (!q.length || !pages.size) return [];
  const docs = [...pages].map(([page, lines]) => ({ page, ...termStats(lines) }));
  const avg = docs.reduce((a, d) => a + d.len, 0) / docs.length || 1;
  const df = new Map(q.map((t) => [t, docs.filter((d) => d.tf.has(t)).length]));
  const N = docs.length;
  return docs
    .filter((d) => !exclude.has(d.page))
    .map((d) => ({
      page: d.page,
      score: q.reduce((s, t) => {
        const f = d.tf.get(t) ?? 0;
        if (!f) return s;
        const n = df.get(t) ?? 0;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        return s + (idf * f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.len) / avg));
      }, 0),
    }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.page - b.page)
    .slice(0, k);
}

/** A page's best-matching lines (up to 3) with the line before and after each, in page order. */
export function snippet(lines: string[], query: string, best = 3): string[] {
  const q = new Set(stems(query));
  const scored = lines.map((l, i) => ({ i, s: stems(l).filter((t) => q.has(t)).length })).filter((x) => x.s > 0);
  scored.sort((a, b) => b.s - a.s || a.i - b.i);
  const keep = new Set<number>();
  for (const { i } of scored.slice(0, best)) for (const j of [i - 1, i, i + 1]) if (j >= 0 && j < lines.length) keep.add(j);
  return [...keep].sort((a, b) => a - b).map((i) => lines[i]);
}

const idle = () => new Promise<void>((res) => {
  const ric = (globalThis as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric(() => res(), { timeout: 200 }); else setTimeout(res, 0);
});

/**
 * The document's page texts, filled in idle time (≤ 4 pages per slice). `getLines(p)` returns a
 * page's text lines in reading order. Pages already grounded can be added directly with `set`.
 */
export class PageIndex {
  private pages = new Map<number, string[]>();
  private filling: Promise<void> | null = null;
  private stopped = false;

  private numPages: number;
  private getLines: (page: number) => Promise<string[]>;
  private perSlice: number;

  constructor(numPages: number, getLines: (page: number) => Promise<string[]>, perSlice = 4) {
    this.numPages = numPages;
    this.getLines = getLines;
    this.perSlice = perSlice;
  }

  set(page: number, lines: string[]) { this.pages.set(page, lines); }
  has(page: number) { return this.pages.has(page); }
  /** A page's text lines, if indexed. */
  lines(page: number): string[] | undefined { return this.pages.get(page); }
  ready() { return this.pages.size >= this.numPages; }
  /** How many pages are indexed. */
  get size() { return this.pages.size; }
  /** The indexed pages (live map: do not mutate). */
  all(): Map<number, string[]> { return this.pages; }
  /** Reads these pages now (out of the idle order) if they are not indexed yet. */
  async ensure(pages: number[]): Promise<void> {
    await Promise.all(pages.filter((p) => p >= 1 && p <= this.numPages && !this.pages.has(p)).map(async (p) => {
      try { const ls = await this.getLines(p); if (!this.pages.has(p)) this.pages.set(p, ls); } catch { this.pages.set(p, []); }
    }));
  }

  /** Fills every missing page, a few per idle slice. Safe to call repeatedly. */
  fill(): Promise<void> {
    if (!this.filling) {
      this.filling = (async () => {
        for (let p = 1; p <= this.numPages && !this.stopped;) {
          await idle();
          for (let n = 0; n < this.perSlice && p <= this.numPages; p++) {
            if (this.pages.has(p)) continue;
            n++;
            try { this.pages.set(p, await this.getLines(p)); } catch { this.pages.set(p, []); }
          }
        }
      })();
    }
    return this.filling;
  }
  stop() { this.stopped = true; }

  /** The page's first line with a word in it (its title on slides), if indexed. */
  firstLine(page: number): string | undefined {
    const ls = this.pages.get(page);
    return ls?.find((l) => /\p{L}{2,}/u.test(l)) ?? ls?.[0];
  }
  firstLines(): Map<number, string> {
    const m = new Map<number, string>();
    for (const p of this.pages.keys()) { const f = this.firstLine(p); if (f) m.set(p, f); }
    return m;
  }

  topPages(question: string, k = 3, exclude: Set<number> = new Set()) {
    return rankPages(this.pages, question, k, exclude);
  }
}
