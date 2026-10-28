import { describe, it, expect } from 'vitest';
import { compare, format } from '../../scripts/eval/compare';
import { buildSummary, type QuestionSummary } from '../../scripts/eval/summary';
import { computeMetrics } from '../../scripts/eval/metrics';
import { emptyResult } from '../../src/agent/evalHooks';

function q(id: string, score: number, o: { fatal?: string[]; skipped?: number; firstWord?: number; takeaway?: boolean; malformed?: number } = {}): QuestionSummary {
  const r = emptyResult(id, 0);
  const m = computeMetrics(r);
  m.firstWordMs = o.firstWord ?? 1000; m.takeawayFirst = o.takeaway ?? true; m.skippedTotal = o.skipped ?? 0; m.malformed = o.malformed ?? 0;
  return { id, split: 'dev', type: 'why', metrics: m, judge: { scores: { intuitive: score, sync: score, correct: score, simple: score }, fatal: (o.fatal ?? []) as never, notes: '' } };
}
const S = (id: string, qs: QuestionSummary[]) => buildSummary({ runId: id, config: 'c', qset: 'q', promptVersion: 'p', phase: 'iterate', questions: qs });
const four = (s: number[], o: Parameters<typeof q>[2] = {}) => s.map((x, i) => q(`D${i + 1}`, x, o));

describe('compare', () => {
  const A = S('a', four([3, 3, 3, 3]));
  it('ACCEPT: clear improvement, nothing worse', () => {
    const c = compare(A, S('b', four([4, 4, 3, 4])));
    expect(c.meanJudgeDelta).toBeCloseTo(0.75); expect(c.verdict).toBe('ACCEPT');
  });
  it('REJECT: improvement but a fatal appears', () => {
    const c = compare(A, S('b', [q('D1', 5, { fatal: ['wrong_fact'] }), ...four([4, 4, 4]).slice(1)]));
    expect(c.verdict).toBe('REJECT'); expect(c.reasons.join()).toMatch(/fatal up/);
  });
  it('REJECT: small gain below +0.15', () => {
    const c = compare(A, S('b', four([3, 3, 3, 3.5 as never])));
    expect(c.verdict).toBe('REJECT');
  });
  it('REJECT on skipped (+3), malformed (+2), slow p50 (+16%), takeaway rate down', () => {
    const better = [4, 4, 4, 4];
    expect(compare(A, S('b', four(better, { skipped: 1 }))).reasons.join()).toMatch(/skipped up by 4/);
    expect(compare(A, S('b', four(better, { malformed: 1 }))).verdict).toBe('REJECT'); // 4 total, +4
    expect(compare(A, S('b', four(better, { firstWord: 1160 }))).reasons.join()).toMatch(/first word/);
    expect(compare(A, S('b', four(better, { takeaway: false }))).reasons.join()).toMatch(/takeawayFirst/);
  });
  it('allows slack: skipped +2 total and p50 +15% still accept', () => {
    const qs = four([4, 4, 4, 4]); qs[0].metrics.skippedTotal = 2; qs.forEach((x) => { x.metrics.firstWordMs = 1150; });
    expect(compare(A, S('b', qs)).verdict).toBe('ACCEPT');
  });
  it('RERUN n=2: |delta| < 0.25 with mixed signs', () => {
    const c = compare(A, S('b', four([4, 2, 3, 3])));
    expect(c.meanJudgeDelta).toBeCloseTo(0.25 - 0.25); expect(c.verdict).toBe('RERUN n=2');
    const c2 = compare(A, S('b', four([4, 3.5 as never, 4, 3])));
    expect(c2.verdict).toBe('ACCEPT');
  });
  it('formats a verdict line', () => {
    const B = S('b', four([4, 4, 4, 4]));
    expect(format(A, B, compare(A, B))).toMatch(/VERDICT: ACCEPT/);
  });
});
