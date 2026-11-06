// scripts/eval/teachReport.ts — the teaching-engine table for one run (teaching-engine.md §6, Phase 1):
//   node --import ./scripts/lib/tsResolve.mjs --experimental-transform-types --no-warnings scripts/eval/teachReport.ts <runId>
// One row per answer (D4.2 is D4's second sample) and a total. Reads <runs>/<runId>/*/result.json (runsDir: PETU_RUNS_DIR, the worktree's, else the main checkout's).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeMetrics, gateMetrics, percentile, teachMetrics } from './metrics.ts';
import type { StoredQuestion } from './run.ts';
import { runsDir } from '../gate-beats/recordings.ts';
import { calcData, documentNumbers, fromDocument } from './provenance.ts';
import { textNumbers } from '../../src/gate/numbers.ts';

const runId = process.argv[2];
if (!runId) { console.error('usage: teachReport.ts <runId>'); process.exit(2); }
// The worktree's runs, else the main checkout's (as the gate-beats tools find them).
const dir = join(runsDir(), runId);
const ids = readdirSync(dir).filter((d) => existsSync(join(dir, d, 'result.json'))).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
const rows: string[][] = [['answer', 'calcs', 'failed', 'vals', 'data-val', 'slides', 'on page', 'grids', 'series', 'tweens', 'typed #', 'gate # flags', '(f)', 'invented', 'drops', 'repairs ok/sent', 'first word s', 'usd']];
const firstWords: (number | null)[] = [], usd: number[] = [];
const tot = { answers: 0, withCalc: 0, calcs: 0, failed: 0, stepped: 0, typed: 0, flags: 0, drops: 0, slides: 0, pageSlides: 0, grids: 0, series: 0, conventions: 0, dataCalcs: 0, invented: 0 };
for (const id of ids) {
  const s = JSON.parse(readFileSync(join(dir, id, 'result.json'), 'utf8')) as StoredQuestion;
  const r = s.turns[0];
  if (!r) { rows.push([id, 'no answer', ...s.errors.slice(0, 1)]); continue; }
  const m = computeMetrics(r), t = teachMetrics(r), g = gateMetrics(r);
  firstWords.push(m.firstWordMs); usd.push(m.answerUsd);
  tot.answers++; tot.calcs += t.calcs; tot.failed += t.calcFailed; tot.withCalc += t.calcs > 0 ? 1 : 0; tot.stepped += t.stepped ? 1 : 0;
  tot.typed += t.typedNumbers; tot.flags += t.numberFlags; tot.drops += g?.drops ?? 0; tot.slides += t.slides; tot.pageSlides += t.pageSlides; tot.grids += t.grids; tot.series += t.series; tot.conventions += t.conventions;
  // Check (b), measured: calcs whose data is not the document's or the question's (provenance.ts).
  const scout = r.events.find((e) => e.t === 'scout') as { pages?: number[] } | undefined;
  const given = await documentNumbers(s.open.src, [s.open.page, ...(scout?.pages ?? [])]);
  const data = calcData(r.chunks.map((c) => c.d).join(''));
  const q = new Set(textNumbers(r.question ?? ''));
  const invented = given ? data.filter((c) => !fromDocument(c.nums, new Set([...given, ...q]))).length : null;
  tot.dataCalcs += data.length; tot.invented += invented ?? 0;
  rows.push([id, String(t.calcs), String(t.calcFailed), String(t.vals), String(t.dataVals), String(t.slides), String(t.pageSlides), String(t.grids), String(t.series), String(t.tweens), String(t.typedNumbers), String(t.numberFlags), String(t.conventions), invented == null ? '-' : `${invented}/${data.length}`, String(g?.drops ?? 0), `${g?.repairOk ?? 0}/${g?.repairs ?? 0}`, m.firstWordMs == null ? '-' : (m.firstWordMs / 1000).toFixed(1), m.answerUsd.toFixed(4)]);
}
const w = rows[0].map((_, i) => Math.max(...rows.map((r) => (r[i] ?? '').length)));
for (const r of rows) console.log(r.map((c, i) => (c ?? '').padEnd(w[i])).join('  '));
const p50 = percentile(firstWords, 0.5);
console.log(`\n${tot.answers} answers · ${tot.withCalc} with a calc · ${tot.calcs} calcs, ${tot.failed} failed (first-run compile ${tot.calcs ? (100 * (1 - tot.failed / tot.calcs)).toFixed(0) : '-'}%) · ${tot.stepped} stepped · ${tot.slides} engine windows (${tot.pageSlides} over a page image) · ${tot.grids} grids · ${tot.series} traces`);
console.log(`typed numerals ${tot.typed} (upper bound; includes given data) · gate number flags ${tot.flags} · (f) conventions notes ${tot.conventions} · calcs with data ${tot.dataCalcs}, invented ${tot.invented} · drops ${tot.drops} · median first word ${p50 == null ? '-' : (p50 / 1000).toFixed(1)} s · mean $${(usd.reduce((a, b) => a + b, 0) / Math.max(1, usd.length)).toFixed(4)}`);
