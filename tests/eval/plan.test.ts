import { describe, it, expect } from 'vitest';
import { parseArgs, selectQuestions, checkBudget, remainingUsd, answersOf, wantsJudge } from '../../scripts/eval/plan';
import { CONFIGS, configEnv, plannedWorstUsd } from '../../scripts/eval/configs';
import { Q1 as QUESTIONS, QSETS } from '../../scripts/eval/questions';

describe('args', () => {
  it('defaults to dev + terra-none, question set q2, rubric r3', () => {
    const a = parseArgs([]);
    expect(a).toMatchObject({ split: 'dev', config: 'terra-none', n: 1, webkit: false, replay: null, judge: null, qset: 'q2', rubric: 'r3', fakeJudge: false });
  });
  it('--qset, --rubric and --fake-judge', () => {
    expect(parseArgs(['--qset', 'q1', '--rubric', 'r2'])).toMatchObject({ qset: 'q1', rubric: 'r2' });
    expect(parseArgs(['--fake-judge'])).toMatchObject({ fakeJudge: true, judge: true });
    expect(() => parseArgs(['--qset', 'q9'])).toThrow(/qset/);
    expect(parseArgs(['--qset', 'q3'])).toMatchObject({ qset: 'q3' });
    expect(() => parseArgs(['--rubric', 'r1'])).toThrow(/rubric/);
  });
  it('parses the documented flags', () => {
    const a = parseArgs(['--split', 'both', '--config', 'sol-low', '--only', 'D4,T2', '--n', '2', '--replay', 'r1', '--no-judge', '--webkit']);
    expect(a).toMatchObject({ split: 'both', config: 'sol-low', only: ['D4', 'T2'], n: 2, replay: 'r1', judge: false, webkit: true });
  });
  it('--prewarm waits 4s after focusing the ask bar (latency run, plan P3.2)', () => {
    expect(parseArgs([]).prewarmMs).toBe(0);
    expect(parseArgs(['--prewarm']).prewarmMs).toBe(4000);
  });
  it('rejects bad input', () => {
    expect(() => parseArgs(['--split', 'x'])).toThrow();
    expect(() => parseArgs(['--config', 'nope'])).toThrow(/unknown config/);
    expect(() => parseArgs(['--wat'])).toThrow(/unknown flag/);
  });
});

describe('selection', () => {
  it('splits (q1)', () => {
    expect(selectQuestions(parseArgs(['--qset', 'q1']))).toHaveLength(14);
    expect(selectQuestions(parseArgs(['--qset', 'q3']))).toHaveLength(18);
    expect(selectQuestions(parseArgs(['--qset', 'q1', '--split', 'test']))).toHaveLength(10);
    expect(selectQuestions(parseArgs(['--qset', 'q1', '--split', 'both']))).toHaveLength(24);
  });
  it('splits (q2, the default)', () => {
    expect(selectQuestions(parseArgs([]))).toHaveLength(20);
    expect(selectQuestions(parseArgs(['--split', 'test']))).toHaveLength(20);
    expect(selectQuestions(parseArgs(['--split', 'both']))).toEqual(QSETS.q2);
  });
  it('--only wins; unknown ids throw', () => {
    expect(selectQuestions(parseArgs(['--only', 'D4,T2'])).map((q) => q.id)).toEqual(['D4', 'T2']);
    expect(() => selectQuestions(parseArgs(['--only', 'D99']))).toThrow(/D99/);
  });
  it('configs restrict the questions (astra on D1-D6, fast on 10, no judge)', () => {
    expect(selectQuestions(parseArgs(['--qset', 'q1', '--config', 'astra-low'])).map((q) => q.id)).toEqual(['D1', 'D2', 'D3', 'D4', 'D5', 'D6']);
    const fast = parseArgs(['--qset', 'q1', '--config', 'terra-none-fast']);
    expect(selectQuestions(fast)).toHaveLength(10);
    expect(wantsJudge(fast, CONFIGS['terra-none-fast'])).toBe(false);
    expect(wantsJudge(parseArgs(['--no-judge']), CONFIGS['terra-none'])).toBe(false);
  });
  it('a follow-up counts as two answers', () => {
    expect(answersOf(QUESTIONS.filter((q) => q.split === 'dev'), 1)).toBe(15);
  });
});

describe('budget preflight', () => {
  const spend = (o: Partial<{ totalUsd: number; capUsd: number; todayUsd: number; dailyCapUsd: number; blocked: string; phase: string; phaseCapUsd: number; byPhase: Record<string, number> }> = {}) => ({ totalUsd: 0, capUsd: 6, todayUsd: 0, ...o });
  const dev = QUESTIONS.filter((q) => q.split === 'dev');
  it('remaining is the nearest cap', () => {
    expect(remainingUsd(spend({ totalUsd: 1, dailyCapUsd: 3, todayUsd: 2.5, phase: 'founder' }))).toBeCloseTo(0.5);
    // eval phases are not limited by the founder's daily cap
    expect(remainingUsd(spend({ totalUsd: 1, dailyCapUsd: 3, todayUsd: 2.9, phase: 'dev' }))).toBeCloseTo(5);
    expect(remainingUsd(spend({ totalUsd: 7 }))).toBe(0);
    expect(remainingUsd(spend({ totalUsd: 1, phase: 'bakeoff', phaseCapUsd: 6, byPhase: { bakeoff: 5.5, dev: 0.5 } }))).toBeCloseTo(0.5);
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
    // r3 shows the judge a timeline of frames and a deck digest: a bigger worst case than r2's sheet
    expect(plannedWorstUsd(CONFIGS['terra-none'], 0, 5, 'r3')).toBeGreaterThan(plannedWorstUsd(CONFIGS['terra-none'], 0, 5, 'r2'));
  });
  it('config env carries model, effort, phase and never a key', () => {
    const e = configEnv(CONFIGS['terra-none-fast'], 'bakeoff');
    expect(e).toMatchObject({ PETU_MODEL: 'gpt-6.1-terra', PETU_EFFORT: 'none', PETU_PHASE: 'bakeoff', PETU_FAST: '1' });
    expect(Object.keys(e).some((k) => /KEY/i.test(k))).toBe(false);
  });
});
