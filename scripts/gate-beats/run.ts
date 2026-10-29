// scripts/gate-beats/run.ts — the commit gate, offline, over recorded eval answers.
//   npm run gate-beats -- <runId> [<runId> …] [--eval | --all] [--json out.json] [--quiet]
// --eval = the step-1 set: the 20 judged dev answers of the labelled run plus every 2026-10-29 run.
// --all = every live (non-replay) run: no labels, so its flag rate bounds the false-flag rate from above.
// Prints each answer's beats with the gate's verdict and reasons, then recall on the hand labels
// (scripts/gate-beats/labels.ts) and the false-flag rate on clean beats. No API calls.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { listRuns, loadRun, runsDir, type Recording } from './recordings.ts';
import { gateAnswer, liveSkips, type AnswerResult, type PageText } from './gateRun.ts';
import { EVAL_RUNS, EXTRA_PREFIX, LABELS, type DefectKind } from './labels.ts';
import { NUMBER_FAMILY, type CheckKind } from '../../src/gate/check.ts';
import { answerPages } from '../../src/agent/scout.ts';
import { groundingOf, type PageGround } from '../../src/agent/context/types.ts';

const mainRoot = (() => { try { return resolve(execSync('git rev-parse --git-common-dir', { encoding: 'utf8' }).trim(), '..'); } catch { return process.cwd(); } })();

type Doc = { numPages: number; getPage(n: number): Promise<unknown>; destroy?: () => Promise<void> };

async function grounder() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { groundPage } = await import('../../src/agent/context/build.ts');
  const { pathOfSrc, pdfDirs } = await import('../eval/decks.ts');
  const OPS = pdfjs.OPS as unknown as Record<string, number>;
  const dirs = [...new Set([...pdfDirs(process.cwd()), ...pdfDirs(mainRoot)])];
  const docs = new Map<string, Promise<Doc | null>>();
  const pathOf = (src: string) => pathOfSrc(src, dirs, process.cwd()) ?? pathOfSrc(src, dirs, mainRoot);
  const open = (p: string) => {
    if (!docs.has(p)) docs.set(p, pdfjs.getDocument({ data: new Uint8Array(readFileSync(p)), verbosity: 0, isEvalSupported: false, fontExtraProperties: true }).promise.catch(() => null) as never);
    return docs.get(p)!;
  };
  return {
    async pages(rec: Recording): Promise<{ text: PageText; grounds: PageGround[]; pdf: boolean }> {
      const text: PageText = new Map();
      const grounds: PageGround[] = [];
      const p = rec.src ? pathOf(rec.src) : null;
      if (!p || !existsSync(p) || !rec.page) return { text, grounds, pdf: false };
      const d = await open(p);
      if (!d) return { text, grounds, pdf: false };
      const want = new Set<number>(answerPages(rec.page, rec.scoutPages ?? []));
      for (const m of rec.script.matchAll(/\bp=(\d+)/g)) want.add(Number(m[1]));
      for (const n of want) {
        if (n < 1 || n > d.numPages) continue;
        try { const g = await groundPage(await d.getPage(n) as never, OPS) as PageGround; grounds.push(g); text.set(n, g.lines.map((l) => l.text).join('\n')); } catch { /* skip page */ }
      }
      return { text, grounds, pdf: true };
    },
    async close() { for (const d of docs.values()) await (await d)?.destroy?.(); },
  };
}

export type Row = { label: string; k: number; positive: DefectKind[]; flagged: CheckKind[]; liveDefect: boolean; adjudicated: boolean };

/** Per-beat rows for scoring: hand labels by anchor phrase, live skips/malformed as mechanical defects. */
export function score(results: AnswerResult[], withAdjudicated = true): { rows: Row[]; unmatched: string[] } {
  const rows: Row[] = [];
  const unmatched: string[] = [];
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const a of results) {
    const labels = (LABELS[a.label] ?? []).filter((l) => withAdjudicated || !l.adjudicated);
    const hit = new Set<number>();
    for (const b of a.beats) {
      if (b.opener) continue;
      const positive = labels.filter((l) => norm(b.text).includes(norm(l.anchor))).map((l) => l.kind);
      labels.forEach((l, i) => { if (norm(b.text).includes(norm(l.anchor))) hit.add(i); });
      const adjudicated = labels.some((l) => l.adjudicated && norm(b.text).includes(norm(l.anchor)));
      rows.push({ label: a.label, k: b.k, adjudicated, positive, flagged: [...new Set(b.verdict.flags.map((f) => f.check))], liveDefect: b.verdict.flags.some((f) => f.check === 'tag') });
    }
    labels.forEach((l, i) => { if (!hit.has(i)) unmatched.push(`${a.label}: "${l.anchor}"`); });
  }
  return { rows, unmatched };
}

const pc = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(0)}%` : '–');

export function scoreTable(rows: Row[]): string {
  const num = rows.filter((r) => r.positive.includes('number'));
  const lay = rows.filter((r) => r.positive.includes('layout'));
  const pos = rows.filter((r) => r.positive.length);
  const caughtNum = num.filter((r) => r.flagged.some((f) => NUMBER_FAMILY.has(f)));
  const caughtLay = lay.filter((r) => r.flagged.includes('layout'));
  const caughtAny = pos.filter((r) => r.flagged.length);
  const clean = rows.filter((r) => !r.positive.length && !r.liveDefect);
  const flaggedClean = clean.filter((r) => r.flagged.length);
  const byCheck = new Map<CheckKind, number>();
  for (const r of flaggedClean) for (const f of r.flagged) byCheck.set(f, (byCheck.get(f) ?? 0) + 1);
  const live = rows.filter((r) => r.liveDefect && !r.positive.length);
  return [
    `beats gated (stage 2): ${rows.length}; hand-labelled defect beats: ${pos.length} (number ${num.length}, layout ${lay.length}); beats with a live skip/malformed tag: ${rows.filter((r) => r.liveDefect).length}`,
    '',
    'target                                   result',
    `recall, fatal number contradictions      ${caughtNum.length}/${num.length} = ${pc(caughtNum.length, num.length)} (by a number-family check)`,
    `recall, layout collisions                ${caughtLay.length}/${lay.length} = ${pc(caughtLay.length, lay.length)} (by the layout check)`,
    `recall, all labelled (≥ 80%)             ${caughtAny.length}/${pos.length} = ${pc(caughtAny.length, pos.length)} (by any check); by the matching check ${caughtNum.length + caughtLay.length}/${pos.length} = ${pc(caughtNum.length + caughtLay.length, pos.length)}`,
    `false flags on clean beats (≤ 10%)       ${flaggedClean.length}/${clean.length} = ${pc(flaggedClean.length, clean.length)}  [${[...byCheck].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}]`,
    `live-skip beats caught by the tag check  ${live.filter((r) => r.flagged.includes('tag')).length}/${live.length}`,
  ].join('\n');
}

function printAnswer(a: AnswerResult, quiet: boolean): string {
  const lines = [`\n== ${a.label}  Q: ${a.question.slice(0, 110)}`];
  for (const b of a.beats) {
    const flags = b.verdict.flags;
    const lbl = (LABELS[a.label] ?? []).filter((l) => b.text.toLowerCase().includes(l.anchor.toLowerCase())).map((l) => `[label: ${l.kind}]`).join(' ');
    if (quiet && !flags.length && !lbl) continue;
    lines.push(`  ${b.opener ? 'opener' : `beat ${b.k}`} ${flags.length ? 'FAIL' : 'pass'} ${lbl} (${b.tags.join(' ') || 'no tags'})`);
    lines.push(`    "${b.text.length > 220 ? `${b.text.slice(0, 220)}…` : b.text}"`);
    for (const f of flags) lines.push(`    ✗ ${f.check}: ${f.detail}`);
  }
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const opt = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const root = runsDir();
  let runs = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--json');
  if (argv.includes('--all')) runs = listRuns(root).filter((r) => !/replay|fake|stub|rj\d/.test(r));
  else if (argv.includes('--eval') || !runs.length) runs = [...EVAL_RUNS, ...listRuns(root).filter((r) => r.startsWith(EXTRA_PREFIX))];
  const g = await grounder();
  const results: AnswerResult[] = [];
  let noPdf = 0;
  for (const run of runs) {
    for (const rec of loadRun(run, root)) {
      const { text, grounds, pdf } = await g.pages(rec);
      if (!pdf) noPdf++;
      const t0 = performance.now();
      const byPage = new Map(grounds.map((g) => [g.page, g.lines.map((l) => ({ x: l.rect.x, y: l.rect.y * g.aspect, w: l.rect.w, h: l.rect.h * g.aspect }))]));
      const res = gateAnswer(rec, { pages: text, grounding: groundingOf(grounds), lines: (p) => byPage.get(p) });
      const ms = performance.now() - t0;
      results.push(res);
      console.log(printAnswer(res, argv.includes('--quiet')) + `\n    (${res.beats.length} beats, gate ${ms.toFixed(1)} ms for the answer; live skips ${liveSkips(rec.script, rec.timings).size})`);
    }
  }
  await g.close();
  const { rows, unmatched } = score(results);
  console.log(`\n${'='.repeat(100)}\nanswers ${results.length} (${noPdf} without their PDF: page numbers unverifiable)`);
  if (unmatched.length) console.log(`labels not found in any beat: ${unmatched.join('; ')}`);
  console.log(`\n-- pre-registered labels only (D17's collision counted as a clean beat):\n${scoreTable(score(results, false).rows)}`);
  console.log(`\n-- with the adjudicated label:\n${scoreTable(rows)}`);
  const json = opt('--json');
  if (json) writeFileSync(json, JSON.stringify({ results, rows }, null, 1));
}

export { join };
