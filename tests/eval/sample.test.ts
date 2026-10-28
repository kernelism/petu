import { describe, it, expect } from 'vitest';
import { mulberry32, pickPages, EXCLUDED, isEligible } from '../../scripts/eval/sample';

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const decks = [
  { deck: 'lec09', eligible: range(1, 60) },
  { deck: 'lec10', eligible: range(1, 30) },
  { deck: 'hw1', eligible: range(1, 8) },
];

describe('sampler', () => {
  it('mulberry32 is deterministic and in [0,1)', () => {
    const a = mulberry32(670), b = mulberry32(670);
    for (let i = 0; i < 20; i++) { const x = a(); expect(x).toBe(b()); expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); }
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
  it('the same seed gives the same pages; a different seed differs', () => {
    expect(pickPages({ seed: 670, n: 8, decks })).toEqual(pickPages({ seed: 670, n: 8, decks }));
    expect(pickPages({ seed: 671, n: 8, decks })).not.toEqual(pickPages({ seed: 670, n: 8, decks }));
  });
  it('never returns excluded pages, extra exclusions, or duplicates', () => {
    for (let seed = 0; seed < 200; seed++) {
      const picks = pickPages({ seed, n: 30, decks, exclude: ['hw1:3'] });
      const keys = picks.map((p) => `${p.deck}:${p.page}`);
      expect(new Set(keys).size).toBe(keys.length);
      for (const k of keys) { expect(EXCLUDED.has(k)).toBe(false); expect(k).not.toBe('hw1:3'); }
    }
  });
  it('visits every deck before repeating one', () => {
    const picks = pickPages({ seed: 5, n: 3, decks });
    expect(new Set(picks.map((p) => p.deck)).size).toBe(3);
  });
  it('stops when the pool runs out', () => {
    expect(pickPages({ seed: 1, n: 100, decks: [{ deck: 'hw1', eligible: [1, 2] }] })).toHaveLength(2);
  });
  it('eligibility: 40 chars of text or a mark', () => {
    expect(isEligible(39)).toBe(false);
    expect(isEligible(40)).toBe(true);
    expect(isEligible(3, 1)).toBe(true);
  });
});
