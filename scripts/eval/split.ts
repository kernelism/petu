// scripts/eval/split.ts — a seeded dev/test split, stratified by deck (then by scope).
import { mulberry32 } from './sample.ts';

export type SplitItem = { deck: string; page: number; scope?: string };

/**
 * Assigns every item to 'dev' or 'test'. Items are shuffled per deck (seeded), then placed one at a
 * time on the side that has fewer of that deck; ties go to the side with fewer items overall, then
 * fewer of that scope, then a coin flip. Result: per deck the sides differ by at most one, and so do
 * the totals. Deterministic for a given seed and input order.
 */
export function stratifiedSplit<T extends SplitItem>(items: T[], seed: number): { dev: T[]; test: T[] } {
  const rnd = mulberry32(seed);
  const byDeck = new Map<string, T[]>();
  for (const it of items) byDeck.set(it.deck, [...(byDeck.get(it.deck) ?? []), it]);
  const out = { dev: [] as T[], test: [] as T[] };
  const count = (side: 'dev' | 'test', f: (x: T) => boolean) => out[side].filter(f).length;
  for (const deck of [...byDeck.keys()].sort()) {
    const list = [...byDeck.get(deck)!];
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    for (const it of list) {
      const keys = (s: 'dev' | 'test') => [count(s, (x) => x.deck === deck), out[s].length, count(s, (x) => x.scope === it.scope)];
      const a = keys('dev'), b = keys('test');
      let side: 'dev' | 'test' | null = null;
      for (let k = 0; k < a.length && !side; k++) if (a[k] !== b[k]) side = a[k] < b[k] ? 'dev' : 'test';
      out[side ?? (rnd() < 0.5 ? 'dev' : 'test')].push(it);
    }
  }
  const order = (x: T) => items.indexOf(x);
  out.dev.sort((x, y) => order(x) - order(y));
  out.test.sort((x, y) => order(x) - order(y));
  return out;
}
