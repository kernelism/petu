// scripts/eval/calibrate.ts — hand-vs-judge calibration of a rubric (spec E: r3 is trusted only after
// it agrees with hand scores on 8 answers).
//   node --experimental-strip-types scripts/eval/calibrate.ts dump <runId> [--n 8] [--seed 670] [--allow-fake]
//     picks N judged answers spread over decks and narrow/broad, writes <run>/calibration/hand.html
//     (blind: question, page, frame timeline, final state, board, transcript; no judge output) and a
//     hand.json template to fill in (scores 1-5, defects, fatal).
//   node --experimental-strip-types scripts/eval/calibrate.ts compare <runId>
//     hand.json vs the judge: per-criterion bias, exact and ±1 agreement, defect agreement; writes
//     calibration/comparison.json. `npm run eval -- --finish <runId>` then shows it in report.html.
// No model calls.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FATALS, RUBRICS, criteriaOf, type JudgeResult, type RubricVersion } from './judge.ts';
import { mulberry32 } from './sample.ts';
import { esc } from './esc.ts';

export type HandItem = { id: string; scores: Record<string, number | null>; defects: string[]; fatal: string[]; notes: string };
export type HandFile = { rubric: RubricVersion; criteria: string[]; defects: string[]; fatals: string[]; instructions: string; items: HandItem[] };
export type CriterionStats = { criterion: string; n: number; judgeMean: number; handMean: number; bias: number; exact: number; within1: number };
export type Calibration = {
  n: number;
  criteria: CriterionStats[];
  /** ±1 agreement over every (answer, criterion) pair. Trusted at ≥ 0.8 with |bias| ≤ 0.5 on every criterion, over ≥ 8 answers. */
  within1: number;
  exact: number;
  trusted: boolean;
  defects: { defect: string; judge: number; hand: number; both: number }[];
  fatal: { judge: number; hand: number; both: number };
};
/** Spec E: calibrated against hand scores on 8 answers before it is trusted. */
export const TRUST = { within1: 0.8, maxBias: 0.5, minN: 8 };

/**
 * Picks `n` answers for hand scoring: greedy, each pick the candidate whose deck and then scope are
 * least represented so far, ties broken by a seeded shuffle. Spreads over decks and narrow/broad.
 */
export function pickForCalibration<T extends { id: string; deck: string; scope: string }>(items: T[], n: number, seed = 670): T[] {
  const rnd = mulberry32(seed);
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const out: T[] = [];
  while (out.length < n && pool.length) {
    let best = 0, bestKey = [Infinity, Infinity];
    pool.forEach((c, i) => {
      const key = [out.filter((o) => o.deck === c.deck).length, out.filter((o) => o.scope === c.scope).length];
      if (key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) { best = i; bestKey = key; }
    });
    out.push(pool.splice(best, 1)[0]);
  }
  return out;
}

/** Hand vs judge over the hand items that have every score filled in. */
export function compareHand(hand: HandItem[], judge: Record<string, JudgeResult>, criteria: readonly string[]): Calibration {
  const pairs = hand.filter((h) => judge[h.id] && criteria.every((c) => typeof h.scores[c] === 'number'));
  const stats: CriterionStats[] = criteria.map((c) => {
    const d = pairs.map((h) => ({ j: judge[h.id].scores[c], h: h.scores[c] as number }));
    const n = d.length, mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    const jm = mean(d.map((x) => x.j)), hm = mean(d.map((x) => x.h));
    return { criterion: c, n, judgeMean: jm, handMean: hm, bias: jm - hm,
      exact: n ? d.filter((x) => x.j === x.h).length / n : 0, within1: n ? d.filter((x) => Math.abs(x.j - x.h) <= 1).length / n : 0 };
  });
  const all = pairs.flatMap((h) => criteria.map((c) => Math.abs(judge[h.id].scores[c] - (h.scores[c] as number))));
  const within1 = all.length ? all.filter((x) => x <= 1).length / all.length : 0;
  const exact = all.length ? all.filter((x) => x === 0).length / all.length : 0;
  const defectNames = [...new Set([...pairs.flatMap((h) => h.defects), ...pairs.flatMap((h) => judge[h.id].defects ?? [])])].sort();
  const defects = defectNames.map((d) => ({ defect: d,
    judge: pairs.filter((h) => judge[h.id].defects?.includes(d)).length,
    hand: pairs.filter((h) => h.defects.includes(d)).length,
    both: pairs.filter((h) => h.defects.includes(d) && judge[h.id].defects?.includes(d)).length }));
  const fatal = {
    judge: pairs.filter((h) => judge[h.id].fatal.length > 0).length,
    hand: pairs.filter((h) => h.fatal.length > 0).length,
    both: pairs.filter((h) => h.fatal.length > 0 && judge[h.id].fatal.length > 0).length,
  };
  const trusted = pairs.length >= TRUST.minN && within1 >= TRUST.within1 && stats.every((s) => Math.abs(s.bias) <= TRUST.maxBias);
  return { n: pairs.length, criteria: stats, within1, exact, trusted, defects, fatal };
}

export const HAND_INSTRUCTIONS = 'Score each answer before looking at the judge (report.html shows its scores; hand.html does not). Use the rubric text below: integers 1-5 per criterion, the defects that apply, and fatal flags. Leave an item null to skip it. Then run: node --experimental-strip-types scripts/eval/calibrate.ts compare <runId>';

export function handTemplate(rubric: RubricVersion, ids: string[]): HandFile {
  const r = RUBRICS[rubric];
  return { rubric, criteria: [...r.criteria], defects: [...r.defects], fatals: [...FATALS], instructions: HAND_INSTRUCTIONS,
    items: ids.map((id) => ({ id, scores: Object.fromEntries(r.criteria.map((c) => [c, null])), defects: [], fatal: [], notes: '' })) };
}

/** The run's calibration for report.html: the comparison when hand scores exist, else whether a dump is pending. */
export function readCalibration(runDir: string, includeFake = false): { comparison?: Calibration; pending?: number } | null {
  const f = join(runDir, 'calibration', 'hand.json');
  if (!existsSync(f)) return null;
  const hand = JSON.parse(readFileSync(f, 'utf8')) as HandFile;
  const judge = judgementsOf(runDir, includeFake);
  const c = compareHand(hand.items, judge, hand.criteria);
  return c.n ? { comparison: c } : { pending: hand.items.length };
}

/** judge.json of every answer in a run, by id. Fake judgements (--fake-judge) only when asked. */
export function judgementsOf(runDir: string, includeFake = false): Record<string, JudgeResult> {
  const out: Record<string, JudgeResult> = {};
  for (const id of readdirSync(runDir)) {
    const f = join(runDir, id, 'judge.json');
    if (!existsSync(f)) continue;
    const j = JSON.parse(readFileSync(f, 'utf8')) as { judge: JudgeResult; fake?: boolean };
    if (!j.fake || includeFake) out[id] = j.judge;
  }
  return out;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
export function formatCalibration(c: Calibration): string {
  const L = [`${c.n} answers hand-scored · ±1 agreement ${pct(c.within1)} · exact ${pct(c.exact)} · ${c.trusted ? 'TRUSTED' : 'NOT TRUSTED'} (needs ≥ ${TRUST.minN} answers, ±1 ≥ ${pct(TRUST.within1)} and |bias| ≤ ${TRUST.maxBias} on every criterion)`, '',
    'criterion       judge  hand   bias  exact  ±1'];
  for (const s of c.criteria) L.push(`${s.criterion.padEnd(14)} ${s.judgeMean.toFixed(2).padStart(5)} ${s.handMean.toFixed(2).padStart(5)} ${(s.bias >= 0 ? '+' : '') + s.bias.toFixed(2).padStart(5)} ${pct(s.exact).padStart(5)} ${pct(s.within1).padStart(4)}`);
  if (c.defects.length) { L.push('', 'defect                   judge  hand  both'); for (const d of c.defects) L.push(`${d.defect.padEnd(24)} ${String(d.judge).padStart(5)} ${String(d.hand).padStart(5)} ${String(d.both).padStart(5)}`); }
  L.push('', `fatal: judge ${c.fatal.judge}, hand ${c.fatal.hand}, both ${c.fatal.both}`);
  return L.join('\n');
}

type StoredItem = { id: string; question: string; deck: string; scope: string; page: string; timeline: { src: string; caption: string }[]; final?: string; board?: string; transcript: string };

/** The blind hand-scoring page (paths relative to calibration/). */
export function handHtml(rubricText: string, items: StoredItem[]): string {
  const css = `:root{--bg:#f6f6f8;--card:#fff;--ink:#1d1d1f;--mute:#6b6b73;--line:#dcdce2}@media (prefers-color-scheme:dark){:root{--bg:#141416;--card:#1d1d20;--ink:#ececf0;--mute:#9a9aa4;--line:#34343a}}
*{box-sizing:border-box}body{margin:0;padding:24px;background:var(--bg);color:var(--ink);font:14px/1.5 -apple-system,system-ui,sans-serif}
article{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:0 0 20px}h2{font-size:15px;margin:0 0 6px}
.tl{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px}figure{margin:0}figure img{width:100%;display:block;border:1px solid var(--line);border-radius:6px}
figcaption{font-size:12px;color:var(--mute);margin-top:4px}pre{white-space:pre-wrap;font:13px/1.5 inherit}details{margin:0 0 20px}.mute{color:var(--mute)}`;
  const fig = (src: string, cap: string) => `<figure><a href="${esc(src)}"><img loading="lazy" src="${esc(src)}" alt="${esc(cap)}"></a><figcaption>${esc(cap)}</figcaption></figure>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hand scoring</title><style>${css}</style></head><body>
<h1>Hand scoring (blind)</h1><p class="mute">${esc(HAND_INSTRUCTIONS)}</p>
<details><summary>Rubric</summary><pre>${esc(rubricText)}</pre></details>
${items.map((it) => `<article id="${esc(it.id)}"><h2>${esc(it.id)} · ${esc(it.deck)} · ${esc(it.scope)}</h2><p><b>${esc(it.question)}</b></p>
<div class="tl">${fig(it.page, 'page the student was looking at')}${it.timeline.map((f, i) => fig(f.src, `${i + 1}. ${f.caption}`)).join('')}${it.final ? fig(it.final, 'final state') : ''}${it.board ? fig(it.board, 'whole board') : ''}</div>
<pre>${esc(it.transcript)}</pre></article>`).join('\n')}
</body></html>`;
}

async function dump(runId: string, n: number, seed: number, allowFake: boolean): Promise<void> {
  const dir = join('.petu/eval/runs', runId);
  const { renderTranscript } = await import('./judge.ts');
  const { QSETS } = await import('./questions.ts');
  const { frameSchedule, frameCaptions } = await import('./frames.ts');
  const run = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')) as { args: { qset?: string; rubric?: RubricVersion } };
  const rubric = run.args.rubric ?? 'r2';
  const qs = QSETS[(run.args.qset ?? 'q1') as 'q1' | 'q2'];
  const judged = judgementsOf(dir, allowFake);
  const cands = Object.keys(judged).flatMap((id) => { const q = qs.find((x) => x.id === id.split('.')[0]); return q ? [{ id, deck: q.deck, scope: q.type, q }] : []; });
  if (!cands.length) throw new Error(`no judged answers in ${dir}${allowFake ? '' : ' (fake judgements are skipped; --allow-fake to rehearse)'}`);
  const picks = pickForCalibration(cands, n, seed);
  const items: StoredItem[] = picks.map((p) => {
    const stored = JSON.parse(readFileSync(join(dir, p.id, 'result.json'), 'utf8')) as { turns: import('../../src/agent/evalHooks.ts').EvalResult[] };
    const t = stored.turns.length - 1, pre = t ? `t${t + 1}-` : '';
    const res = stored.turns[t];
    const sched = frameSchedule(res.sentences), caps = frameCaptions(res.sentences, sched);
    const rel = (f: string) => (existsSync(join(dir, p.id, f)) ? `../${p.id}/${f}` : undefined);
    return { id: p.id, question: res.question, deck: p.deck, scope: p.scope, page: `../${p.id}/page.png`,
      timeline: sched.flatMap((s, k) => { const src = rel(`${pre}s${s}.png`); return src ? [{ src, caption: caps[k] }] : []; }),
      final: rel(`${pre}final.png`), board: rel(`${pre}board.jpg`), transcript: renderTranscript(res) };
  });
  const cdir = join(dir, 'calibration');
  mkdirSync(cdir, { recursive: true });
  writeFileSync(join(cdir, 'hand.html'), handHtml(RUBRICS[rubric].text, items));
  const hf = join(cdir, 'hand.json');
  if (existsSync(hf)) console.log(`kept existing ${hf} (delete it to start over)`);
  else writeFileSync(hf, JSON.stringify(handTemplate(rubric, items.map((i) => i.id)), null, 1));
  console.log(`picked ${items.map((i) => `${i.id} (${i.deck}, ${i.scope})`).join(', ')}\n  score in ${join(cdir, 'hand.html')}\n  fill ${hf}`);
}

function compareCmd(runId: string, allowFake: boolean): void {
  const dir = join('.petu/eval/runs', runId);
  const hand = JSON.parse(readFileSync(join(dir, 'calibration', 'hand.json'), 'utf8')) as HandFile;
  const judge = judgementsOf(dir, allowFake);
  const crit = hand.criteria.length ? hand.criteria : [...criteriaOf(Object.values(judge)[0])];
  const c = compareHand(hand.items, judge, crit);
  writeFileSync(join(dir, 'calibration', 'comparison.json'), JSON.stringify(c, null, 1));
  console.log(formatCalibration(c));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, runId, ...rest] = process.argv.slice(2);
  const opt = (k: string, d: number) => { const i = rest.indexOf(`--${k}`); return i >= 0 ? Number(rest[i + 1]) : d; };
  if (!runId || (cmd !== 'dump' && cmd !== 'compare')) { console.error('usage: calibrate.ts dump|compare <runId> [--n 8] [--seed 670]'); process.exit(2); }
  const allowFake = rest.includes('--allow-fake');
  if (cmd === 'dump') await dump(runId, opt('n', 8), opt('seed', 670), allowFake); else compareCmd(runId, allowFake);
}
