import { describe, it, expect } from 'vitest';
import { Q1 as QUESTIONS, QSETS, QUESTIONS as DEFAULT, bySplit as bySplitOf, validateSet, qsetHash, qsetId, assertSplitAllowed, questionSet } from '../../scripts/eval/questions';
import { DECK_FILES, FIXTURE_DECKS, knownDeck } from '../../scripts/eval/decks';
import { EXCLUDED } from '../../scripts/eval/sample';
import { Q2_ROWS, buildQ2 } from '../../scripts/eval/q2';

const bySplit = (s: 'dev' | 'test') => bySplitOf(s, QUESTIONS);

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
    expect(qsetHash(QUESTIONS).slice(0, 8)).toBe(qsetId(QUESTIONS).slice(3));
    expect(qsetId(QUESTIONS)).toBe(PINNED);
    const edited = QUESTIONS.map((x, i) => (i === 0 ? { ...x, question: x.question + '!' } : x));
    expect(qsetHash(edited)).not.toBe(qsetHash(QUESTIONS));
  });
  it('the held-out test split is refused while tuning', () => {
    const t = ['T1'], d = ['D1'];
    expect(() => assertSplitAllowed(d, 'iterate', 5, QUESTIONS)).not.toThrow();
    expect(() => assertSplitAllowed(t, 'iterate', 0, QUESTIONS)).toThrow(/held out/);
    expect(() => assertSplitAllowed(t, 'dev', 0, QUESTIONS)).toThrow();
    expect(() => assertSplitAllowed(t, 'bakeoff', 0, QUESTIONS)).not.toThrow();
    expect(() => assertSplitAllowed(t, 'bakeoff', 1, QUESTIONS)).toThrow();
    expect(() => assertSplitAllowed(t, 'validate', 3, QUESTIONS)).not.toThrow();
  });
});
const PINNED = 'q1-ecbcb2f0';

describe('question set q2 (Eval v3)', () => {
  const q2 = QSETS.q2;
  it('is the default: 40 questions, 20 dev / 20 test, valid', () => {
    expect(DEFAULT).toBe(q2);
    expect(questionSet('q2')).toBe(q2);
    expect(() => questionSet('q7')).toThrow();
    expect(q2).toHaveLength(40);
    expect(bySplitOf('dev', q2)).toHaveLength(20);
    expect(bySplitOf('test', q2)).toHaveLength(20);
    expect(validateSet(q2)).toEqual([]);
  });
  it('covers every course deck and both synthetic decks, never an excluded page', () => {
    const decks = new Set(q2.map((x) => x.deck));
    for (const d of Object.keys(DECK_FILES)) expect(decks.has(d), d).toBe(true);
    for (const d of Object.keys(FIXTURE_DECKS)) expect(decks.has(d), d).toBe(true);
    for (const x of q2) { expect(knownDeck(x.deck), x.id).toBe(true); expect(EXCLUDED.has(`${x.deck}:${x.page}`), x.id).toBe(false); }
  });
  it('is stratified by deck: per deck the splits differ by at most one', () => {
    for (const d of new Set(q2.map((x) => x.deck))) {
      const dev = q2.filter((x) => x.deck === d && x.split === 'dev').length, test = q2.filter((x) => x.deck === d && x.split === 'test').length;
      expect(Math.abs(dev - test), d).toBeLessThanOrEqual(1);
    }
    expect(Q2_ROWS.filter((r) => FIXTURE_DECKS[r.deck])).toHaveLength(6);
    expect(q2.filter((x) => FIXTURE_DECKS[x.deck] && x.split === 'dev')).toHaveLength(3);
  });
  it('keeps the writer\'s rows as written and only labels them', () => {
    expect(q2.map((x) => x.question).sort()).toEqual(Q2_ROWS.map((r) => r.question).sort());
    expect(new Set(q2.map((x) => x.type))).toEqual(new Set(['narrow', 'broad']));
    expect(q2.every((x) => x.pick === 'agent')).toBe(true);
    expect(buildQ2()).toEqual(q2); // deterministic
  });
  it('is frozen (pin below); its own test-split history', () => {
    expect(qsetId(q2)).toBe(PINNED_Q2);
    expect(() => assertSplitAllowed(['T1'], 'lessoniter', 0, q2)).toThrow(/held out/);
    expect(() => assertSplitAllowed(['T1'], 'lessonbake', 0, q2)).not.toThrow();
    expect(() => assertSplitAllowed(['T1'], 'lessonbake', 1, q2)).toThrow();
    expect(() => assertSplitAllowed(['T1'], 'lessonval', 2, q2)).not.toThrow();
  });
});
const PINNED_Q2 = 'q2-ae05d5d6';
