import { describe, it, expect } from 'vitest';
import { samplePages, pct, sizeHistogram, digestPageStats, rankOf } from '../../scripts/corpus/stats';
import { CORPUS } from '../../scripts/corpus/sources';
import { deckDigest } from '../../src/agent/context/digest';

describe('corpus stress helpers', () => {
  it('samples pages spread over the document, deterministically', () => {
    const s = samplePages(1000, 10);
    expect(s).toHaveLength(10);
    expect(s[0]).toBe(1);
    expect(s.at(-1)).toBe(1000);
    expect(samplePages(1000, 10)).toEqual(s);
    expect(samplePages(5, 10)).toEqual([1, 2, 3, 4, 5]);
  });
  it('percentiles, size histogram, ranks', () => {
    expect(pct([5, 1, 3, 2, 4])).toEqual({ p50: 3, p90: 5, max: 5 });
    expect(pct([])).toEqual({ p50: 0, p90: 0, max: 0 });
    expect(sizeHistogram(['612x792', '612x792', '595x842'])).toBe('612x792 ×2, 595x842 ×1');
    expect(rankOf([9, 4, 7], 7)).toBe(3);
    expect(rankOf([9, 4, 7], 8, 1)).toBe(1);
    expect(rankOf([9, 4], 1)).toBe(0);
  });
  it('reads a digest back: per-page share, clipped, empty and unread pages', () => {
    const lines = (p: number) => (p === 3 ? [] : p === 4 ? undefined : [`Title ${p}`, 'x'.repeat(500)]);
    const st = digestPageStats(deckDigest('d', 4, lines));
    expect(st).toMatchObject({ pages: 4, clipped: 2, empty: 1, unread: 1 });
  });
  it('the corpus registry: unique ids and files, https sources, a licence each', () => {
    expect(new Set(CORPUS.map((d) => d.id)).size).toBe(CORPUS.length);
    expect(new Set(CORPUS.map((d) => d.file)).size).toBe(CORPUS.length);
    for (const d of CORPUS) { expect(d.urls.every((u) => u.startsWith('https://')), d.id).toBe(true); expect(d.licence, d.id).toBeTruthy(); }
  });
});
