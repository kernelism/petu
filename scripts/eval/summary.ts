// scripts/eval/summary.ts — one run's summary.json: per-question metrics and judgements plus run level.
import { aggregate, type Metrics, type RunMetrics } from './metrics.ts';
import { CRITERIA, meanScore, type JudgeResult } from './judge.ts';

export type QuestionSummary = { id: string; split: 'dev' | 'test'; type: string; turn?: number; metrics: Metrics; judge?: JudgeResult; judgeUsd?: number };
export type Summary = {
  runId: string; config: string; qset: string; promptVersion: string; phase: string; createdAt: string;
  questions: QuestionSummary[];
  run: RunMetrics;
  judge: { n: number; mean: number | null; byCriterion: Record<string, number> | null; fatal: number; fatalByKind: Record<string, number>; usd: number };
  genUsd: number;
};

export function buildSummary(a: { runId: string; config: string; qset: string; promptVersion: string; phase: string; questions: QuestionSummary[]; now?: () => Date }): Summary {
  const judged = a.questions.filter((q) => q.judge);
  const fatalByKind: Record<string, number> = {};
  for (const q of judged) for (const f of q.judge!.fatal) fatalByKind[f] = (fatalByKind[f] ?? 0) + 1;
  const byCriterion = judged.length ? Object.fromEntries(CRITERIA.map((c) => [c, judged.reduce((s, q) => s + q.judge!.scores[c], 0) / judged.length])) : null;
  return {
    runId: a.runId, config: a.config, qset: a.qset, promptVersion: a.promptVersion, phase: a.phase,
    createdAt: (a.now ?? (() => new Date()))().toISOString(),
    questions: a.questions,
    run: aggregate(a.questions.map((q) => q.metrics)),
    judge: {
      n: judged.length,
      mean: judged.length ? judged.reduce((s, q) => s + meanScore(q.judge!), 0) / judged.length : null,
      byCriterion,
      fatal: judged.reduce((s, q) => s + q.judge!.fatal.length, 0),
      fatalByKind,
      usd: judged.reduce((s, q) => s + (q.judgeUsd ?? 0), 0),
    },
    genUsd: a.questions.reduce((s, q) => s + q.metrics.usd, 0),
  };
}

/** `<date>-<config>-<PROMPT_VERSION>-<QSET>` */
export const runIdOf = (date: string, config: string, promptVersion: string, qset: string): string => `${date}-${config}-${promptVersion}-${qset}`;
