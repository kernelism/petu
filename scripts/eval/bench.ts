// scripts/eval/bench.ts — which model should author petu's answers? Runs (or reuses) each config on
// one question set and writes a side-by-side report.
//   npm run bench -- --qset draw --configs terra-none,claude-sonnet-none,claude-opus-low [--judge] [--dry] [--replay] [--runs cfg=runId,…] [--parallel 2]
// Spend phase: PETU_PHASE (default `bench`, $15). Before anything runs, the preflight prints the
// expected and worst-case cost per config and refuses when the worst case is over what the phase (or
// the hard stop) has left; every config's eval run then checks its own budget against the server, and
// the server's ledger reserves each call again.
//   --dry     $0: no server, no browser, no API. Each config's latest recorded run on this set is used
//             when one exists, else fake answers (demo scripts) — to check the report end to end.
//   --replay  reuse each config's latest recorded run on this set (no generation; judged ones keep their judgements).
//   --runs    name the runs to reuse per config.
// Output: .petu/eval/bench/<id>/index.html (+ bench.json). Images link into the run dirs.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { CONFIGS } from './configs.ts';
import { QSETS, qsetId, type Question } from './questions.ts';
import { computeMetrics } from './metrics.ts';
import { parseAnswer } from './scriptTags.ts';
import { frameSchedule } from './frames.ts';
import { fakeJudgement, parseJudge, renderTranscript, R3, type JudgeResult } from './judge.ts';
import { deckUrlPath } from './decks.ts';
import { gateCounts, keyFrames, parseBenchArgs, preflight, remainingFromLedger, renderBench, summarize, type BenchCell, type BenchRow, type LedgerFile } from './benchReport.ts';
import { recordingOf } from '../gate-beats/recordings.ts';
import { gateAnswer } from '../gate-beats/gateRun.ts';
import { grounder } from '../gate-beats/run.ts';
import { groundingOf } from '../../src/agent/context/types.ts';
import { DEMOS } from '../../src/demo/demoScript.ts';
import { emptyResult, type EvalResult } from '../../src/agent/evalHooks.ts';
import { MAX_TOTAL_USD, PHASE_CAPS } from '../../server/env.ts';
import { PROMPT_VERSION } from '../../server/prompt/system.ts';
import type { Phase } from '../../server/ledger.ts';

const ROOT = process.cwd();
const EVAL = join(ROOT, '.petu/eval');
const RUNS = join(EVAL, 'runs');
const BENCH = join(EVAL, 'bench');
type Stored = { open: { src: string; page: number }; turns: EvalResult[]; errors?: string[] };

const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The latest run of `config` on this set (`<date>-<config>-<prompt>-<qset>[-N]`, not a replay or an ad-hoc ask). */
export function latestRun(config: string, qset: string, runs = RUNS): string | null {
  if (!existsSync(runs)) return null;
  const re = new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${reEsc(config)}-p[\\d.]+-${reEsc(qset)}(-\\d+)?$`);
  const answered = (r: string) => readdirSync(join(runs, r)).filter((q) => existsSync(join(runs, r, q, 'result.json'))).length;
  // The most complete run, the newest among equals.
  const hits = readdirSync(runs).filter((r) => re.test(r) && answered(r) > 0).map((r) => ({ r, n: answered(r), t: statSync(join(runs, r)).mtimeMs }));
  hits.sort((a, b) => a.n - b.n || a.t - b.t);
  return hits.at(-1)?.r ?? null;
}

/** One eval run of a config (the real runner: its own dev server, Chrome, ledger checks). Resolves with its run id. */
function runConfig(config: string, qset: string, ids: string[], judge: boolean, parallel: number, phase: string): Promise<string> {
  const argv = ['--experimental-strip-types', '--no-warnings', 'scripts/eval/run.ts', '--qset', qset, '--split', 'dev', '--config', config, '--only', ids.join(','), judge ? '--judge' : '--no-judge', '--parallel', String(parallel)];
  console.log(`\n== ${config}: node ${argv.join(' ')}`);
  return new Promise((ok, fail) => {
    const p = spawn(process.execPath, argv, { cwd: ROOT, env: { ...process.env, PETU_PHASE: phase }, stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    p.stdout.on('data', (b: Buffer) => { out += b.toString(); process.stdout.write(b); });
    p.on('close', (code) => {
      const m = /^run (\S+)$/m.exec(out);
      if (code === 0 && m) ok(m[1]); else fail(new Error(`${config}: eval run failed (exit ${code})`));
    });
  });
}

/** A fake answer for --dry: a demo script streamed in chunks, with a word clock (2.6 words/s) so every metric has a value. */
function fakeAnswer(q: Question, turn: number, k: number): Stored {
  const asked = turn ? q.followUp! : q.question;
  const d = DEMOS[k % DEMOS.length];
  const r = emptyResult(asked, 0);
  let t = 1200;
  for (let i = 0; i < d.script.length; i += 9) { r.chunks.push({ t, d: d.script.slice(i, i + 9) }); t += 30; }
  const narration = d.script.replace(/\{\{[\s\S]*?\}\}/g, ' ').replace(/\s+/g, ' ').trim();
  let w = 1400;
  for (const s of narration.split(/(?<=[.?!])\s+/)) {
    for (const word of s.split(' ').filter(Boolean)) { r.words.push({ text: word, t: w }); w += 385; }
    r.sentences.push({ text: s, endMs: w });
  }
  r.events = [{ t: 'done', usd: 0, spentUsd: 0, capUsd: 0, ttftMs: 1200 }];
  return { open: { src: deckUrlPath(q.deck), page: q.page }, turns: turn ? [r, r] : [r] };
}

type Grounder = Awaited<ReturnType<typeof grounder>>;
async function gateOf(g: Grounder, stored: Stored, turn: number, dir: string, run: string, q: string) {
  const rec = recordingOf(stored as never, turn, dir, run, q);
  if (!rec) return undefined;
  const { text, grounds } = await g.pages(rec);
  const byPage = new Map(grounds.map((x) => [x.page, x.lines.map((l) => ({ x: l.rect.x, y: l.rect.y * x.aspect, w: l.rect.w, h: l.rect.h * x.aspect }))]));
  try { return gateCounts(gateAnswer(rec, { pages: text, grounding: groundingOf(grounds), lines: (p) => byPage.get(p) }).beats); } catch (e) { console.error(`gate ${run}/${q}#${turn}: ${(e as Error).message}`); return undefined; }
}

async function main(): Promise<void> {
  const a = parseBenchArgs(process.argv.slice(2));
  const qs = QSETS[a.qset as keyof typeof QSETS];
  if (!qs) throw new Error(`unknown question set ${a.qset} (have: ${Object.keys(QSETS).join(', ')})`);
  const qlabel = qsetId(qs, a.qset);
  const phase = (process.env.PETU_PHASE ?? 'bench') as Phase;
  if (!(phase in PHASE_CAPS)) throw new Error(`unknown PETU_PHASE ${phase}`);
  const cfgs = a.configs.map((c) => CONFIGS[c]);

  // Which run each config uses: named, reused, generated (or, in a dry run, recorded or fake).
  const reuse: Record<string, string | null> = {};
  for (const c of a.configs) reuse[c] = a.runs[c] ?? (a.replay || a.dry ? latestRun(c, qlabel) : null);
  if (a.replay) { const none = a.configs.filter((c) => !reuse[c]); if (none.length) throw new Error(`--replay: no recorded ${a.qset} run for ${none.join(', ')} (set ${qlabel})`); }
  for (const [c, r] of Object.entries(reuse)) if (r && !existsSync(join(RUNS, r))) throw new Error(`no run ${r} for ${c}`);

  // Budget preflight, from the ledger file read as it is (nothing is reserved here).
  const ledgerFile = join(ROOT, '.petu/spend.json');
  const lf: LedgerFile = existsSync(ledgerFile) ? JSON.parse(readFileSync(ledgerFile, 'utf8')) : {};
  const num = (k: string, d: number) => { const v = Number(process.env[k]); return process.env[k] && Number.isFinite(v) && v >= 0 ? v : d; };
  const caps = { totalUsd: Math.min(num('PETU_TOTAL_CAP_USD', MAX_TOTAL_USD), MAX_TOTAL_USD), phaseUsd: num(`PETU_CAP_${phase.toUpperCase()}`, PHASE_CAPS[phase]) };
  const left = remainingFromLedger(lf, phase, caps);
  // A dry run prices the real run it stands in for (every config generated and, with --judge, judged).
  const generates = (c: { name: string }) => (a.dry ? !a.runs[c.name] : !reuse[c.name]);
  const pf = preflight(cfgs, qs, a.judge, left.remainingUsd, generates);
  console.log(`${a.dry ? 'DRY RUN ($0): the costs below are what the real run would cost.\n' : ''}bench ${a.qset} (${qlabel}) · phase ${phase}: spent $${left.phaseSpentUsd.toFixed(2)} of $${caps.phaseUsd} · all phases $${left.totalSpentUsd.toFixed(2)} of $${caps.totalUsd}\n${pf.table}`);
  if (!a.dry && !pf.ok) throw new Error(`refusing to start: worst case $${pf.worstUsd.toFixed(2)} > $${pf.remainingUsd.toFixed(2)} left (raise for one run with PETU_CAP_${phase.toUpperCase()}=<dollars>, or bench fewer configs)`);

  // Generate (sequentially: each run starts its own dev server with that config's model).
  const ids = qs.map((q) => q.id);
  for (const c of a.configs) if (!a.dry && !reuse[c]) reuse[c] = await runConfig(c, a.qset, ids, a.judge, a.parallel, phase);

  const date = new Date().toISOString().slice(0, 10);
  let id = `${date}-${a.qset}-${a.configs.join('+')}${a.dry ? '-dry' : ''}`;
  for (let i = 2; existsSync(join(BENCH, id)); i++) id = `${date}-${a.qset}-${a.configs.join('+')}${a.dry ? '-dry' : ''}-${i}`;
  const out = join(BENCH, id);
  mkdirSync(out, { recursive: true });
  const rel = (p: string) => relative(out, p);

  const g = await grounder();
  const rows: BenchRow[] = [];
  const byConfig: Record<string, BenchCell[]> = Object.fromEntries(a.configs.map((c) => [c, []]));
  for (const [qi, q] of qs.entries()) {
    for (let turn = 0; turn < (q.followUp ? 2 : 1); turn++) {
      const row: BenchRow = { id: q.id, turn, deck: q.deck, page: q.page, question: turn ? q.followUp! : q.question, cells: {} };
      for (const c of a.configs) {
        const run = reuse[c];
        const qdir = run ? join(RUNS, run, q.id) : '';
        let stored: Stored | null = run && existsSync(join(qdir, 'result.json')) ? JSON.parse(readFileSync(join(qdir, 'result.json'), 'utf8')) : null;
        const fake = !stored && a.dry;
        if (fake) stored = fakeAnswer(q, turn, qi);
        const res = stored?.turns[turn];
        const base = { config: c, runId: fake ? null : run, asked: row.question, frames: [] as BenchCell['frames'] };
        if (!stored || !res) { const cell: BenchCell = { ...base, transcript: '', metrics: null, missing: run ? `no ${turn ? 'follow-up ' : ''}answer in ${run}` : 'not run' }; row.cells[c] = cell; byConfig[c].push(cell); continue; }
        const parsed = parseAnswer(res);
        const pre = turn ? `t${turn + 1}-` : '';
        const has = (f: string) => !fake && existsSync(join(qdir, f));
        const n = res.sentences.length;
        const frames = keyFrames(frameSchedule(res.sentences).filter((i) => has(`${pre}s${i}.png`)), 3)
          .map((i) => ({ src: rel(join(qdir, `${pre}s${i}.png`)), label: `s${i + 1}/${n} · ${(res.sentences[i].endMs / 1000).toFixed(1)} s` }));
        // The judge sees (and scores) a question's last turn.
        let judge: JudgeResult | undefined, judgeUsd = 0, fakeJudge = false;
        if (turn === stored.turns.length - 1) {
          if (has('judge.json')) { const j = JSON.parse(readFileSync(join(qdir, 'judge.json'), 'utf8')); judge = j.judge; judgeUsd = j.usd ?? 0; fakeJudge = !!j.fake; }
          else if (a.dry && a.judge) { judge = parseJudge(fakeJudgement(R3), R3); fakeJudge = true; }
        }
        const cell: BenchCell = {
          ...base, frames,
          ...(has(`${pre}board.jpg`) ? { board: rel(join(qdir, `${pre}board.jpg`)) } : {}),
          ...(has(`${pre}final.png`) ? { final: rel(join(qdir, `${pre}final.png`)) } : {}),
          transcript: renderTranscript(res, parsed.tags),
          // A fake answer never ran in the engine: no timings, so no skip or malformed counts.
          metrics: fake ? { ...computeMetrics(res, parsed), malformed: 0, skipDefect: false } : computeMetrics(res, parsed),
          ...(judge ? { judge, judgeUsd, ...(fakeJudge ? { fakeJudge } : {}) } : {}),
          gate: await gateOf(g, stored, turn, qdir || out, run ?? 'fake', q.id),
          ...(fake ? { fake } : {}),
        };
        row.cells[c] = cell; byConfig[c].push(cell);
      }
      rows.push(row);
    }
  }
  await g.close();
  const sums = a.configs.map((c) => summarize(c, byConfig[c]));
  const meta = { id, qset: `${a.qset} (${qlabel})`, createdAt: new Date().toISOString(), dry: a.dry, judge: a.judge, phase, promptVersion: PROMPT_VERSION, preflight: pf.table };
  writeFileSync(join(out, 'index.html'), renderBench(meta, a.configs, rows, sums));
  writeFileSync(join(out, 'bench.json'), JSON.stringify({ meta, runs: reuse, summaries: sums, rows }, null, 1));
  const s1 = (x: number | null) => (x == null ? '–' : `${(x / 1000).toFixed(2)} s`);
  console.log(`\n${'config'.padEnd(22)} answers  judge  first-word p50  author-text p50  spoken mean   gen $  gate flagged`);
  for (const s of sums) console.log(`${s.config.padEnd(22)} ${String(s.answers).padStart(7)}  ${s.judgeMean == null ? '    –' : s.judgeMean.toFixed(2).padStart(5)}  ${s1(s.firstWordP50).padStart(14)}  ${s1(s.stage2P50).padStart(15)}  ${(s.spokenMeanS == null ? '–' : `${s.spokenMeanS.toFixed(0)} s`).padStart(11)}  ${s.genUsd.toFixed(3).padStart(6)}  ${s.gate.failing}/${s.gate.beats}${s.fake ? '  (fake)' : ''}`);
  console.log(`\nopen ${join(out, 'index.html')}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(() => process.exit(0), (e) => { console.error(String(e instanceof Error ? e.message : e)); process.exit(1); });
}
