// scripts/eval/compare.ts — A vs B: per-question deltas, aggregates, and a verdict.
//   node --experimental-strip-types scripts/eval/compare.ts <runIdA> <runIdB>
import { criteriaOf, meanScore } from './judge.ts';
import type { Summary } from './summary.ts';

export type Verdict = 'ACCEPT' | 'REJECT' | 'RERUN n=2';
export type Row = { id: string; judgeDelta: number | null; criteria: Record<string, number> | null; fatalDelta: number; skippedDelta: number; firstWordA: number | null; firstWordB: number | null; usdDelta: number };
export type Comparison = {
  rows: Row[];
  meanJudgeDelta: number | null;
  signs: { up: number; down: number };
  fatal: { a: number; b: number };
  skipped: { a: number; b: number };
  malformed: { a: number; b: number };
  firstWordP50: { a: number | null; b: number | null };
  takeawayFirstRate: { a: number; b: number };
  /** The live gate (absent on both sides when neither run was gated; an ungated run counts as 0). */
  gate?: { drops: { a: number; b: number }; holds: { a: number; b: number }; liveSkipAfterPass: { a: number; b: number }; repairUsd: { a: number; b: number } };
  /** How first word was compared: 'compared' (scout changed, quiet machine), 'skipped' (same scout: not this change's metric), 'unreliable' (load high or not recorded). */
  latency: { status: 'compared' | 'skipped' | 'unreliable'; note?: string };
  verdict: Verdict;
  reasons: string[];
  /** Findings that do not decide the verdict by themselves (an unreliable latency regression turns an ACCEPT into a RERUN). */
  warnings: string[];
};

export const THRESHOLDS = { acceptDelta: 0.15, rerunBand: 0.25, skippedSlack: 2, malformedSlack: 1, firstWordSlack: 0.15,
  /** Live gate: more dropped units or > 1 s holds than this over A rejects; any live skip after a pass rejects. */
  dropSlack: 1, holdSlack: 2,
  /** A run whose 1-min load average per CPU peaked above this measured latency on a busy machine. */
  highLoadPerCpu: 0.75 };

/**
 * First word is the scout's metric (it speaks first): compared only when the scout changed between the
 * runs, and trusted only when both runs recorded a quiet machine. A slowdown with the same scout is not
 * this change's; one measured under high or unrecorded load is noise until a rerun on a quiet machine.
 */
export function latencyRule(A: Pick<Summary, 'scout' | 'load' | 'run'>, B: Pick<Summary, 'scout' | 'load' | 'run'>): { status: Comparison['latency']['status']; note?: string; reason?: string; warning?: string } {
  const a = A.run.firstWordMs.p50, b = B.run.firstWordMs.p50;
  const slower = a != null && b != null && b > a * (1 + THRESHOLDS.firstWordSlack);
  const by = slower ? `p50 first word worse by ${(((b! - a!) / a!) * 100).toFixed(0)}% (> ${Math.round(THRESHOLDS.firstWordSlack * 100)}%)` : '';
  if (A.scout && B.scout && A.scout === B.scout) return { status: 'skipped', note: `first word not compared: same scout (${A.scout})${slower ? `; ${by}, ignored` : ''}` };
  const loads = [A.load, B.load];
  if (loads.some((l) => !l)) return slower ? { status: 'unreliable', note: 'machine load not recorded', warning: `${by}, unreliable: machine load not recorded (rerun on a quiet machine)` } : { status: 'unreliable', note: 'machine load not recorded' };
  const busy = loads.some((l) => l!.perCpuMax > THRESHOLDS.highLoadPerCpu);
  const lp = `load per CPU ${A.load!.perCpuMax} -> ${B.load!.perCpuMax}`;
  if (busy) return slower ? { status: 'unreliable', note: lp, warning: `${by}, unreliable: ${lp} (> ${THRESHOLDS.highLoadPerCpu}; rerun on a quiet machine)` } : { status: 'unreliable', note: lp };
  return slower ? { status: 'compared', note: lp, reason: by } : { status: 'compared', note: lp };
}

/** The gate comparison and its reject reasons (pure; used by compare). */
export function gateRules(A: Pick<Summary, 'run'>, B: Pick<Summary, 'run'>): { gate?: Comparison['gate']; reasons: string[] } {
  const ga = A.run.gate, gb = B.run.gate;
  if (!ga && !gb) return { reasons: [] };
  const v = (g: typeof ga, k: 'drops' | 'holds' | 'liveSkipAfterPass') => g?.sum[k] ?? 0;
  const gate = {
    drops: { a: v(ga, 'drops'), b: v(gb, 'drops') }, holds: { a: v(ga, 'holds'), b: v(gb, 'holds') },
    liveSkipAfterPass: { a: v(ga, 'liveSkipAfterPass'), b: v(gb, 'liveSkipAfterPass') }, repairUsd: { a: ga?.repairUsd ?? 0, b: gb?.repairUsd ?? 0 },
  };
  const reasons: string[] = [];
  if (gate.drops.b - gate.drops.a > THRESHOLDS.dropSlack) reasons.push(`gate drops up by ${gate.drops.b - gate.drops.a} (> ${THRESHOLDS.dropSlack})`);
  if (gate.holds.b - gate.holds.a > THRESHOLDS.holdSlack) reasons.push(`holds > 1 s up by ${gate.holds.b - gate.holds.a} (> ${THRESHOLDS.holdSlack})`);
  if (gb && gate.liveSkipAfterPass.b > 0) reasons.push(`${gate.liveSkipAfterPass.b} live skip(s) after the gate passed`);
  return { gate, reasons };
}

/** Criteria both runs were judged on (r2 or r3); comparing across rubrics is refused. */
export function sharedCriteria(A: Summary, B: Summary): string[] {
  const of = (S: Summary) => { const j = S.questions.find((q) => q.judge)?.judge; return j ? [...criteriaOf(j)] : []; };
  const a = of(A), b = of(B);
  if (a.length && b.length && a.join() !== b.join()) throw new Error(`runs were judged with different rubrics (${a.join(',')} vs ${b.join(',')}): re-judge one with --finish/--rubric`);
  return a.length ? a : b;
}

export function compare(A: Summary, B: Summary): Comparison {
  const criteria = sharedCriteria(A, B);
  const key = (q: { id: string; turn?: number }) => `${q.id}#${q.turn ?? 0}`;
  const a = new Map(A.questions.map((q) => [key(q), q]));
  const rows: Row[] = [];
  for (const qb of B.questions) {
    const qa = a.get(key(qb));
    if (!qa) continue;
    const both = qa.judge && qb.judge;
    rows.push({
      id: key(qb).replace(/#0$/, ''),
      judgeDelta: both ? meanScore(qb.judge!) - meanScore(qa.judge!) : null,
      criteria: both ? Object.fromEntries(criteria.map((c) => [c, qb.judge!.scores[c] - qa.judge!.scores[c]])) : null,
      fatalDelta: (qb.judge?.fatal.length ?? 0) - (qa.judge?.fatal.length ?? 0),
      skippedDelta: qb.metrics.skippedTotal - qa.metrics.skippedTotal,
      firstWordA: qa.metrics.firstWordMs, firstWordB: qb.metrics.firstWordMs,
      usdDelta: qb.metrics.usd - qa.metrics.usd,
    });
  }
  const deltas = rows.map((r) => r.judgeDelta).filter((d): d is number => d != null);
  const meanJudgeDelta = deltas.length ? deltas.reduce((s, d) => s + d, 0) / deltas.length : null;
  const signs = { up: deltas.filter((d) => d > 0).length, down: deltas.filter((d) => d < 0).length };
  const T = THRESHOLDS;
  const reasons: string[] = [];
  const fatal = { a: A.judge.fatal, b: B.judge.fatal };
  const skipped = { a: A.run.sum.skippedTotal, b: B.run.sum.skippedTotal };
  const malformed = { a: A.run.sum.malformed, b: B.run.sum.malformed };
  const fw = { a: A.run.firstWordMs.p50, b: B.run.firstWordMs.p50 };
  const tk = { a: A.run.takeawayFirstRate, b: B.run.takeawayFirstRate };

  if (fatal.b > fatal.a) reasons.push(`fatal up (${fatal.a} -> ${fatal.b})`);
  if (skipped.b - skipped.a > T.skippedSlack) reasons.push(`skipped up by ${skipped.b - skipped.a} (> ${T.skippedSlack})`);
  if (malformed.b - malformed.a > T.malformedSlack) reasons.push(`malformed up by ${malformed.b - malformed.a} (> ${T.malformedSlack})`);
  const lat = latencyRule(A, B);
  const warnings: string[] = lat.warning ? [lat.warning] : [];
  if (lat.reason) reasons.push(lat.reason);
  // The takeaway-first gate belongs to the r2 answer shape; Lessons v3 dropped that rule (r3 runs skip it).
  const g = gateRules(A, B);
  reasons.push(...g.reasons);
  if (!criteria.includes('understanding') && tk.b < tk.a) reasons.push(`takeawayFirst rate down (${pct(tk.a)} -> ${pct(tk.b)})`);

  let verdict: Verdict;
  const d = meanJudgeDelta;
  const mixed = signs.up > 0 && signs.down > 0;
  if (reasons.length) verdict = 'REJECT';
  else if (d != null && d >= T.acceptDelta && (d >= T.rerunBand || !mixed)) verdict = warnings.length ? 'RERUN n=2' : 'ACCEPT';
  else if (d != null && Math.abs(d) < T.rerunBand && mixed) verdict = 'RERUN n=2';
  else { verdict = 'REJECT'; reasons.push(d == null ? 'no judged questions in common' : `mean judge delta ${d.toFixed(2)} < +${T.acceptDelta}`); }
  return { rows, meanJudgeDelta, signs, fatal, skipped, malformed, firstWordP50: fw, takeawayFirstRate: tk, ...(g.gate ? { gate: g.gate } : {}), latency: { status: lat.status, ...(lat.note ? { note: lat.note } : {}) }, verdict, reasons, warnings };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const f2 = (x: number | null) => (x == null ? '  - ' : `${x >= 0 ? '+' : ''}${x.toFixed(2)}`);

export function format(A: Summary, B: Summary, c: Comparison): string {
  const criteria = sharedCriteria(A, B);
  const L: string[] = [`A ${A.runId}`, `B ${B.runId}`, '', ['question  judge', ...criteria.map((c) => c.slice(0, 4).padStart(5)), ' fatal  skip  firstWord A -> B   $'].join(' ')];
  for (const r of c.rows) {
    const k = r.criteria;
    L.push([r.id.padEnd(9), f2(r.judgeDelta).padStart(5), ...criteria.map((x) => f2(k ? k[x] : null).padStart(5)), String(r.fatalDelta).padStart(5), String(r.skippedDelta).padStart(5),
      `${r.firstWordA ?? '-'} -> ${r.firstWordB ?? '-'}`.padStart(16), (r.usdDelta >= 0 ? '+' : '') + r.usdDelta.toFixed(4)].join(' '));
  }
  L.push('', `mean judge delta ${f2(c.meanJudgeDelta)}  (up ${c.signs.up}, down ${c.signs.down})`,
    `fatal ${c.fatal.a} -> ${c.fatal.b}   skipped ${c.skipped.a} -> ${c.skipped.b}   malformed ${c.malformed.a} -> ${c.malformed.b}`,
    `p50 first word ${c.firstWordP50.a ?? '-'} -> ${c.firstWordP50.b ?? '-'} ms (${c.latency.status}${c.latency.note ? `: ${c.latency.note}` : ''})   takeawayFirst ${pct(c.takeawayFirstRate.a)} -> ${pct(c.takeawayFirstRate.b)}`,
    ...(c.gate ? [`gate drops ${c.gate.drops.a} -> ${c.gate.drops.b}   holds>1s ${c.gate.holds.a} -> ${c.gate.holds.b}   live skips after pass ${c.gate.liveSkipAfterPass.a} -> ${c.gate.liveSkipAfterPass.b}   repair $${c.gate.repairUsd.a.toFixed(3)} -> $${c.gate.repairUsd.b.toFixed(3)}`] : []),
    ...c.warnings.map((w) => `warning: ${w}`),
    `VERDICT: ${c.verdict}${c.reasons.length ? ` (${c.reasons.join('; ')})` : ''}`);
  return L.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import('node:fs');
  const load = (id: string): Summary => JSON.parse(readFileSync(`.petu/eval/runs/${id}/summary.json`, 'utf8'));
  const [x, y] = process.argv.slice(2);
  if (!x || !y) { console.error('usage: compare.ts <runIdA> <runIdB>'); process.exit(2); }
  const A = load(x), B = load(y);
  console.log(format(A, B, compare(A, B)));
}
