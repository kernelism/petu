import { describe, it, expect } from 'vitest';
import { QUESTIONS, bySplit, validateSet, qsetHash, qsetId, assertSplitAllowed } from '../../scripts/eval/questions';
import { DECK_FILES } from '../../scripts/eval/decks';
import { EXCLUDED } from '../../scripts/eval/sample';

describe('question set v1', () => {
  it('has 24 questions: 14 dev, 10 test, unique ids and pages', () => {
    expect(QUESTIONS).toHaveLength(24);
    expect(bySplit('dev')).toHaveLength(14);
    expect(bySplit('test')).toHaveLength(10);
    expect(validateSet(QUESTIONS)).toEqual([]);
  });
  it('splits are disjoint by id prefix', () => {
    expect(bySplit('dev').every((x) => x.id.startsWith('D'))).toBe(true);
    expect(bySplit('test').every((x) => x.id.startsWith('T'))).toBe(true);
  });
  it('uses known decks and never an excluded page', () => {
    for (const x of QUESTIONS) {
      expect(DECK_FILES[x.deck], x.id).toBeDefined();
      expect(EXCLUDED.has(`${x.deck}:${x.page}`), x.id).toBe(false);
    }
  });
  it('covers 12 distinct decks overall (fixture excluded)', () => {
    const decks = new Set(QUESTIONS.map((x) => x.deck));
    expect(decks.size).toBeGreaterThanOrEqual(11);
    expect(decks.has('fixture')).toBe(false);
  });
  it('fills the random quotas', () => {
    const dev = bySplit('dev').filter((x) => x.pick === 'random');
    expect(dev).toHaveLength(7);
    const n = (t: string) => dev.filter((x) => x.type === t).length;
    expect(n('point-at')).toBe(2); expect(n('why')).toBe(1); expect(n('what-if')).toBe(1);
    expect(n('ink')).toBe(1); expect(n('follow-up')).toBe(1); expect(n('off-topic')).toBe(1);
    expect(dev.find((x) => x.type === 'ink')!.ink).toBe(true);
    expect(dev.find((x) => x.type === 'follow-up')!.followUp).toBeTruthy();
    const test = bySplit('test').filter((x) => x.pick === 'random').map((x) => x.type).sort();
    expect(test).toEqual(['derive', 'ink', 'navigation', 'point-at', 'why']);
  });
  it('is frozen: editing a question changes the hash (pin below)', () => {
    expect(qsetHash().slice(0, 8)).toBe(qsetId().slice(3));
    expect(qsetId()).toBe(PINNED);
    const edited = QUESTIONS.map((x, i) => (i === 0 ? { ...x, question: x.question + '!' } : x));
    expect(qsetHash(edited)).not.toBe(qsetHash());
  });
  it('the held-out test split is refused while tuning', () => {
    const t = ['T1'], d = ['D1'];
    expect(() => assertSplitAllowed(d, 'iterate', 5)).not.toThrow();
    expect(() => assertSplitAllowed(t, 'iterate', 0)).toThrow(/held out/);
    expect(() => assertSplitAllowed(t, 'dev', 0)).toThrow();
    expect(() => assertSplitAllowed(t, 'bakeoff', 0)).not.toThrow();
    expect(() => assertSplitAllowed(t, 'bakeoff', 1)).toThrow();
    expect(() => assertSplitAllowed(t, 'validate', 3)).not.toThrow();
  });
});
const PINNED = 'q1-ecbcb2f0';
