import { describe, it, expect } from 'vitest';
import { parseArgs, selectQuestions, checkBudget, remainingUsd, answersOf, wantsJudge } from '../../scripts/eval/plan';
import { CONFIGS, configEnv, plannedWorstUsd } from '../../scripts/eval/configs';
import { QUESTIONS } from '../../scripts/eval/questions';

describe('args', () => {
  it('defaults to dev + terra-none', () => {
    const a = parseArgs([]);
    expect(a).toMatchObject({ split: 'dev', config: 'terra-none', n: 1, webkit: false, replay: null, judge: null });
  });
  it('parses the documented flags', () => {
    const a = parseArgs(['--split', 'both', '--config', 'sol-low', '--only', 'D4,T2', '--n', '2', '--replay', 'r1', '--no-judge', '--webkit']);
    expect(a).toMatchObject({ split: 'both', config: 'sol-low', only: ['D4', 'T2'], n: 2, replay: 'r1', judge: false, webkit: true });
  });
  it('rejects bad input', () => {
    expect(() => parseArgs(['--split', 'x'])).toThrow();
    expect(() => parseArgs(['--config', 'nope'])).toThrow(/unknown config/);
    expect(() => parseArgs(['--wat'])).toThrow(/unknown flag/);
  });
});

describe('selection', () => {
  it('splits', () => {
    expect(selectQuestions(parseArgs([]))).toHaveLength(14);
    expect(selectQuestions(parseArgs(['--split', 'test']))).toHaveLength(10);
    expect(selectQuestions(parseArgs(['--split', 'both']))).toHaveLength(24);
  });
  it('--only wins; unknown ids throw', () => {
    expect(selectQuestions(parseArgs(['--only', 'D4,T2'])).map((q) => q.id)).toEqual(['D4', 'T2']);
    expect(() => selectQuestions(parseArgs(['--only', 'D99']))).toThrow(/D99/);
  });
  it('configs restrict the questions (astra on D1-D6, fast on 10, no judge)', () => {
    expect(selectQuestions(parseArgs(['--config', 'astra-low'])).map((q) => q.id)).toEqual(['D1', 'D2', 'D3', 'D4', 'D5', 'D6']);
    const fast = parseArgs(['--config', 'terra-none-fast']);
    expect(selectQuestions(fast)).toHaveLength(10);
    expect(wantsJudge(fast, CONFIGS['terra-none-fast'])).toBe(false);
    expect(wantsJudge(parseArgs(['--no-judge']), CONFIGS['terra-none'])).toBe(false);
  });
  it('a follow-up counts as two answers', () => {
    expect(answersOf(QUESTIONS.filter((q) => q.split === 'dev'), 1)).toBe(15);
  });
});

describe('budget preflight', () => {
  const spend = (o: Partial<{ totalUsd: number; capUsd: number; todayUsd: number; dailyCapUsd: number; blocked: string }> = {}) => ({ totalUsd: 0, capUsd: 6, todayUsd: 0, ...o });
  const dev = QUESTIONS.filter((q) => q.split === 'dev');
  it('remaining is the nearest cap', () => {
    expect(remainingUsd(spend({ totalUsd: 1, dailyCapUsd: 3, todayUsd: 2.5 }))).toBeCloseTo(0.5);
    expect(remainingUsd(spend({ totalUsd: 7 }))).toBe(0);
  });
  it('passes when the worst case fits, refuses when it does not', () => {
    const ok = checkBudget(spend(), CONFIGS['terra-none'], dev, 1, true);
    expect(ok.ok).toBe(true);
    const bad = checkBudget(spend({ totalUsd: 5.9 }), CONFIGS['terra-none'], dev, 1, true);
    expect(bad.ok).toBe(false); expect(bad.message).toMatch(/>/);
    expect(checkBudget(spend({ blocked: 'cap' }), CONFIGS['terra-none'], dev, 1, false).ok).toBe(false);
  });
  it('fast mode and the dearer models cost more at worst', () => {
    expect(plannedWorstUsd(CONFIGS['terra-none-fast'], 10, 0)).toBeGreaterThan(plannedWorstUsd(CONFIGS['terra-none'], 10, 0));
    expect(plannedWorstUsd(CONFIGS['astra-low'], 6, 0)).toBeGreaterThan(plannedWorstUsd(CONFIGS['terra-none'], 6, 0));
    expect(plannedWorstUsd(CONFIGS['terra-none'], 0, 5)).toBeGreaterThan(0);
  });
  it('config env carries model, effort, phase and never a key', () => {
    const e = configEnv(CONFIGS['terra-none-fast'], 'bakeoff');
    expect(e).toMatchObject({ PETU_MODEL: 'gpt-6.1-terra', PETU_EFFORT: 'none', PETU_PHASE: 'bakeoff', PETU_FAST: '1' });
    expect(Object.keys(e).some((k) => /KEY/i.test(k))).toBe(false);
  });
});
