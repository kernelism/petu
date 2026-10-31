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
  /** What the first word depends on (scout prompt version, model, effort, context mode): compare.ts compares first word only when it differs. Absent in older runs. */
  scout?: string;
  /** Machine load while the run generated (1-min load average per CPU, sampled): latency is unreliable when it is high. Absent in older runs. */
  load?: HostLoad;
  run: RunMetrics;
  judge: { n: number; mean: number | null; byCriterion: Record<string, number> | null; fatal: number; fatalByKind: Record<string, number>; defectsByKind?: Record<string, number>; usd: number };
  genUsd: number;
};

export type HostLoad = { cpus: number; samples: number; /** Mean and max of the 1-min load average divided by the CPU count. */ perCpuMean: number; perCpuMax: number };

/** Summarises 1-min load-average samples (os.loadavg()[0]) on `cpus` CPUs; null without samples. */
export function hostLoadOf(samples: number[], cpus: number): HostLoad | null {
  if (!samples.length || cpus <= 0) return null;
  const r = (x: number) => Math.round(x * 100) / 100;
  return { cpus, samples: samples.length, perCpuMean: r(samples.reduce((s, x) => s + x, 0) / samples.length / cpus), perCpuMax: r(Math.max(...samples) / cpus) };
}

export function buildSummary(a: { runId: string; config: string; qset: string; promptVersion: string; phase: string; rubric?: string; scout?: string; load?: HostLoad | null; questions: QuestionSummary[]; now?: () => Date }): Summary {
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
    ...(a.scout ? { scout: a.scout } : {}),
    ...(a.load ? { load: a.load } : {}),
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
