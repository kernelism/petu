// scripts/eval/summary.ts — one run's summary.json: per-question metrics and judgements plus run level.
import { aggregate, type Metrics, type RunMetrics } from './metrics.ts';
import { criteriaOf, meanScore, type JudgeResult } from './judge.ts';

export type QuestionSummary = { id: string; split: 'dev' | 'test'; type: string; turn?: number; metrics: Metrics; judge?: JudgeResult; judgeUsd?: number };
export type Summary = {
  runId: string; config: string; qset: string; promptVersion: string; phase: string; createdAt: string;
  /** Rubric the judgements used (r3 default; absent in checkpoint-2 runs = r2). */
  rubric?: string;
  /** --fake-judge run: judgements are placeholders, not model output. */
  fakeJudge?: boolean;
  questions: QuestionSummary[];
  run: RunMetrics;
  judge: { n: number; mean: number | null; byCriterion: Record<string, number> | null; fatal: number; fatalByKind: Record<string, number>; defectsByKind?: Record<string, number>; usd: number };
  genUsd: number;
};

export function buildSummary(a: { runId: string; config: string; qset: string; promptVersion: string; phase: string; rubric?: string; questions: QuestionSummary[]; now?: () => Date }): Summary {
  const judged = a.questions.filter((q) => q.judge);
  const fatalByKind: Record<string, number> = {};
  for (const q of judged) for (const f of q.judge!.fatal) fatalByKind[f] = (fatalByKind[f] ?? 0) + 1;
  const defectsByKind: Record<string, number> = {};
  for (const q of judged) for (const d of q.judge!.defects ?? []) defectsByKind[d] = (defectsByKind[d] ?? 0) + 1;
  const criteria = [...new Set(judged.flatMap((q) => criteriaOf(q.judge!)))];
  const byCriterion = judged.length ? Object.fromEntries(criteria.map((c) => {
    const xs = judged.flatMap((q) => (c in q.judge!.scores ? [q.judge!.scores[c]] : []));
    return [c, xs.reduce((s, v) => s + v, 0) / xs.length];
  })) : null;
  return {
    runId: a.runId, config: a.config, qset: a.qset, promptVersion: a.promptVersion, phase: a.phase, ...(a.rubric ? { rubric: a.rubric } : {}),
    createdAt: (a.now ?? (() => new Date()))().toISOString(),
    questions: a.questions,
    run: aggregate(a.questions.map((q) => q.metrics)),
    judge: {
      n: judged.length,
      mean: judged.length ? judged.reduce((s, q) => s + meanScore(q.judge!), 0) / judged.length : null,
      byCriterion,
      fatal: judged.reduce((s, q) => s + q.judge!.fatal.length, 0),
      fatalByKind,
      ...(Object.keys(defectsByKind).length ? { defectsByKind } : {}),
      usd: judged.reduce((s, q) => s + (q.judgeUsd ?? 0), 0),
    },
    genUsd: a.questions.reduce((s, q) => s + q.metrics.usd, 0),
  };
}

/** `<date>-<config>-<PROMPT_VERSION>-<QSET>` */
export const runIdOf = (date: string, config: string, promptVersion: string, qset: string): string => `${date}-${config}-${promptVersion}-${qset}`;
