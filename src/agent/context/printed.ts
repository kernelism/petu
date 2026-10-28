// src/agent/context/printed.ts — printed vs PDF page numbers (design §1.9, §2.9). Students say
// "page 512" from the number printed on the page; the app counts PDF pages. The offset comes from the
// PDF's page labels when it has numeric ones, else from a running-header/footer number that recurs at
// one fixed offset on a fixed sample of pages (so the result never depends on the index's progress).

/** PDF page − printed page, from pdf.js page labels (`getPageLabels()`), or null when they are not numbers. */
export function offsetFromLabels(labels: (string | null)[] | null | undefined): number | null {
  if (!labels?.length) return null;
  const votes = new Map<number, number>();
  labels.forEach((l, i) => { if (l && /^\d{1,5}$/.test(l.trim())) { const o = i + 1 - Number(l); votes.set(o, (votes.get(o) ?? 0) + 1); } });
  return best(votes, labels.length);
}

/** Numbers that begin or end a page's first or last lines (running headers, footers). */
export function edgeNumbers(lines: string[]): number[] {
  const edge = [...lines.slice(0, 3), ...lines.slice(-3)];
  const out = new Set<number>();
  for (const l of edge) {
    const t = l.trim();
    const a = /^(\d{1,4})(?!\d|\.\d)\b/.exec(t), b = /(?<![\d.])\b(\d{1,4})$/.exec(t);
    if (a) out.add(Number(a[1]));
    if (b) out.add(Number(b[1]));
  }
  return [...out];
}

/**
 * PDF page − printed page from sampled pages' edge numbers: the offset that the most pages agree on,
 * if at least 4 pages and 40% of the sampled pages with text agree. 0 when printed = PDF or unknown.
 */
export function offsetFromHeaders(sample: { page: number; lines: string[] }[]): number {
  const votes = new Map<number, number>();
  let withText = 0;
  for (const { page, lines } of sample) {
    if (!lines.length) continue;
    withText++;
    for (const o of new Set(edgeNumbers(lines).map((n) => page - n))) if (o >= 0 && o < page) votes.set(o, (votes.get(o) ?? 0) + 1);
  }
  return best(votes, withText) ?? 0;
}

function best(votes: Map<number, number>, of: number): number | null {
  let top: number | null = null, n = 0;
  for (const [o, v] of votes) if (v > n || (v === n && top != null && Math.abs(o) < Math.abs(top))) { top = o; n = v; }
  return top != null && n >= 4 && n >= 0.4 * of ? top : null;
}

/** Pages to sample for the offset: `k` spread evenly over the middle 80% of the document. */
export function samplePages(numPages: number, k = 16): number[] {
  if (numPages <= k) return Array.from({ length: numPages }, (_, i) => i + 1);
  const lo = Math.max(1, Math.floor(numPages * 0.1)), hi = Math.ceil(numPages * 0.9);
  return [...new Set(Array.from({ length: k }, (_, i) => Math.round(lo + ((hi - lo) * i) / (k - 1))))];
}

/** "page 512", "p. 512", "pg 512", "pp. 512" in a question → the numbers named. */
export function pagesNamed(question: string): number[] {
  return [...question.matchAll(/\b(?:page|pages|pg\.?|pp?\.)\s*(\d{1,4})\b/gi)].map((m) => Number(m[1]));
}
