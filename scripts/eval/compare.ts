// scripts/eval/compare.ts — A vs B: per-question deltas, aggregates, and a verdict.
//   node --experimental-strip-types scripts/eval/compare.ts <runIdA> <runIdB>
import { CRITERIA, meanScore } from './judge.ts';
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
  verdict: Verdict;
  reasons: string[];
};

export const THRESHOLDS = { acceptDelta: 0.15, rerunBand: 0.25, skippedSlack: 2, malformedSlack: 1, firstWordSlack: 0.15 };

export function compare(A: Summary, B: Summary): Comparison {
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
      criteria: both ? Object.fromEntries(CRITERIA.map((c) => [c, qb.judge!.scores[c] - qa.judge!.scores[c]])) : null,
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
  if (fw.a != null && fw.b != null && fw.b > fw.a * (1 + T.firstWordSlack)) reasons.push(`p50 first word worse by ${(((fw.b - fw.a) / fw.a) * 100).toFixed(0)}% (> 15%)`);
  if (tk.b < tk.a) reasons.push(`takeawayFirst rate down (${pct(tk.a)} -> ${pct(tk.b)})`);

  let verdict: Verdict;
  const d = meanJudgeDelta;
  const mixed = signs.up > 0 && signs.down > 0;
  if (reasons.length) verdict = 'REJECT';
  else if (d != null && d >= T.acceptDelta && (d >= T.rerunBand || !mixed)) verdict = 'ACCEPT';
  else if (d != null && Math.abs(d) < T.rerunBand && mixed) verdict = 'RERUN n=2';
  else { verdict = 'REJECT'; reasons.push(d == null ? 'no judged questions in common' : `mean judge delta ${d.toFixed(2)} < +${T.acceptDelta}`); }
  return { rows, meanJudgeDelta, signs, fatal, skipped, malformed, firstWordP50: fw, takeawayFirstRate: tk, verdict, reasons };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const f2 = (x: number | null) => (x == null ? '  - ' : `${x >= 0 ? '+' : ''}${x.toFixed(2)}`);

export function format(A: Summary, B: Summary, c: Comparison): string {
  const L: string[] = [`A ${A.runId}`, `B ${B.runId}`, '', 'question  judge   int   sync  corr  simp  fatal  skip  firstWord A -> B   $'];
  for (const r of c.rows) {
    const k = r.criteria;
    L.push([r.id.padEnd(9), f2(r.judgeDelta).padStart(5), ...CRITERIA.map((x) => f2(k ? k[x] : null).padStart(5)), String(r.fatalDelta).padStart(5), String(r.skippedDelta).padStart(5),
      `${r.firstWordA ?? '-'} -> ${r.firstWordB ?? '-'}`.padStart(16), (r.usdDelta >= 0 ? '+' : '') + r.usdDelta.toFixed(4)].join(' '));
  }
  L.push('', `mean judge delta ${f2(c.meanJudgeDelta)}  (up ${c.signs.up}, down ${c.signs.down})`,
    `fatal ${c.fatal.a} -> ${c.fatal.b}   skipped ${c.skipped.a} -> ${c.skipped.b}   malformed ${c.malformed.a} -> ${c.malformed.b}`,
    `p50 first word ${c.firstWordP50.a ?? '-'} -> ${c.firstWordP50.b ?? '-'} ms   takeawayFirst ${pct(c.takeawayFirstRate.a)} -> ${pct(c.takeawayFirstRate.b)}`,
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
