import { describe, it, expect } from 'vitest';
import { stratifiedSplit } from '../../scripts/eval/split';

const items = (spec: Record<string, number>) => Object.entries(spec).flatMap(([deck, n]) =>
  Array.from({ length: n }, (_, i) => ({ deck, page: i + 1, scope: i % 2 ? 'broad' : 'narrow' })));

describe('stratified split', () => {
  it('per deck the sides differ by at most one, and so do the totals', () => {
    for (const seed of [1, 2, 670, 9999]) {
      const xs = items({ a: 3, b: 4, c: 1, d: 3, e: 2, f: 5 });
      const { dev, test } = stratifiedSplit(xs, seed);
      expect(dev.length + test.length).toBe(xs.length);
      expect(Math.abs(dev.length - test.length)).toBeLessThanOrEqual(1);
      for (const d of 'abcdef') expect(Math.abs(dev.filter((x) => x.deck === d).length - test.filter((x) => x.deck === d).length)).toBeLessThanOrEqual(1);
    }
  });
  it('an even total splits exactly in half even when every deck is odd', () => {
    const { dev, test } = stratifiedSplit(items({ a: 3, b: 3, c: 1, d: 1 }), 7);
    expect(dev).toHaveLength(4); expect(test).toHaveLength(4);
  });
  it('is deterministic per seed, keeps input order within a side, and loses nothing', () => {
    const xs = items({ a: 5, b: 5, c: 4 });
    const a = stratifiedSplit(xs, 3), b = stratifiedSplit(xs, 3);
    expect(a).toEqual(b);
    expect([...a.dev, ...a.test].sort((x, y) => xs.indexOf(x) - xs.indexOf(y))).toEqual(xs);
    for (const side of [a.dev, a.test]) for (let i = 1; i < side.length; i++) expect(xs.indexOf(side[i])).toBeGreaterThan(xs.indexOf(side[i - 1]));
    const seeds = new Set([1, 2, 3, 4, 5, 6].map((s) => JSON.stringify(stratifiedSplit(xs, s).dev.map((x) => `${x.deck}${x.page}`))));
    expect(seeds.size).toBeGreaterThan(1);
  });
  it('a deck of two always gives one to each side', () => {
    const { dev, test } = stratifiedSplit(items({ a: 2, b: 2, c: 2 }), 11);
    for (const d of 'abc') { expect(dev.filter((x) => x.deck === d)).toHaveLength(1); expect(test.filter((x) => x.deck === d)).toHaveLength(1); }
  });
});
