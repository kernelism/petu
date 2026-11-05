// scripts/eval/teachReport.ts — the teaching-engine table for one run (teaching-engine.md §6, Phase 1):
//   node --import ./scripts/lib/tsResolve.mjs --experimental-transform-types --no-warnings scripts/eval/teachReport.ts <runId>
// One row per answer (D4.2 is D4's second sample) and a total. Reads .petu/eval/runs/<runId>/*/result.json.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeMetrics, gateMetrics, percentile, teachMetrics } from './metrics.ts';
import type { StoredQuestion } from './run.ts';

const runId = process.argv[2];
if (!runId) { console.error('usage: teachReport.ts <runId>'); process.exit(2); }
const dir = join(process.cwd(), '.petu/eval/runs', runId);
const ids = readdirSync(dir).filter((d) => existsSync(join(dir, d, 'result.json'))).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
const rows: string[][] = [['answer', 'calcs', 'failed', 'vals', 'data-val', 'slides', 'tweens', 'typed #', 'gate # flags', 'drops', 'repairs ok/sent', 'first word s', 'usd']];
const firstWords: (number | null)[] = [], usd: number[] = [];
const tot = { answers: 0, withCalc: 0, calcs: 0, failed: 0, stepped: 0, typed: 0, flags: 0, drops: 0, slides: 0 };
for (const id of ids) {
  const s = JSON.parse(readFileSync(join(dir, id, 'result.json'), 'utf8')) as StoredQuestion;
  const r = s.turns[0];
  if (!r) { rows.push([id, 'no answer', ...s.errors.slice(0, 1)]); continue; }
  const m = computeMetrics(r), t = teachMetrics(r), g = gateMetrics(r);
  firstWords.push(m.firstWordMs); usd.push(m.answerUsd);
  tot.answers++; tot.calcs += t.calcs; tot.failed += t.calcFailed; tot.withCalc += t.calcs > 0 ? 1 : 0; tot.stepped += t.stepped ? 1 : 0;
  tot.typed += t.typedNumbers; tot.flags += t.numberFlags; tot.drops += g?.drops ?? 0; tot.slides += t.slides;
  rows.push([id, String(t.calcs), String(t.calcFailed), String(t.vals), String(t.dataVals), String(t.slides), String(t.tweens), String(t.typedNumbers), String(t.numberFlags), String(g?.drops ?? 0), `${g?.repairOk ?? 0}/${g?.repairs ?? 0}`, m.firstWordMs == null ? '-' : (m.firstWordMs / 1000).toFixed(1), m.answerUsd.toFixed(4)]);
}
const w = rows[0].map((_, i) => Math.max(...rows.map((r) => (r[i] ?? '').length)));
for (const r of rows) console.log(r.map((c, i) => (c ?? '').padEnd(w[i])).join('  '));
const p50 = percentile(firstWords, 0.5);
console.log(`\n${tot.answers} answers · ${tot.withCalc} with a calc · ${tot.calcs} calcs, ${tot.failed} failed (first-run compile ${tot.calcs ? (100 * (1 - tot.failed / tot.calcs)).toFixed(0) : '-'}%) · ${tot.stepped} stepped · ${tot.slides} engine windows`);
console.log(`typed numerals ${tot.typed} (upper bound; includes given data) · gate number flags ${tot.flags} · drops ${tot.drops} · median first word ${p50 == null ? '-' : (p50 / 1000).toFixed(1)} s · mean $${(usd.reduce((a, b) => a + b, 0) / Math.max(1, usd.length)).toFixed(4)}`);
