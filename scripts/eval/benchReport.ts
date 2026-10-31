// scripts/eval/benchReport.ts — the author benchmark's pure parts (`npm run bench`, scripts/eval/bench.ts):
// flags, the budget preflight, per-answer cells (metrics, judge, gate-beats defect counts), the per-config
// summary and the side-by-side index.html (one row per question turn, one column per config).
// Local file, relative image paths into the run dirs, plain HTML/CSS: no scripts.
import { esc } from './esc.ts';
import { criteriaOf, meanScore, type JudgeResult } from './judge.ts';
import { percentile, type Metrics } from './metrics.ts';
import { CONFIGS, expectedAnswerUsd, expectedJudgeUsd, worstAnswerUsd, worstJudgeUsd, type Config } from './configs.ts';
import { answersOf } from './plan.ts';
import type { Question } from './questions.ts';

// ---- flags ---------------------------------------------------------------------------------

export type BenchArgs = {
  qset: string;
  configs: string[];
  judge: boolean;
  /** $0: existing recorded runs of each config on this set, else fake answers; no server, no browser. */
  dry: boolean;
  /** Reuse the latest existing run of each config on this set (no generation). */
  replay: boolean;
  /** Explicit runs per config (`--runs a=<runId>,b=<runId>`), reused as they are. */
  runs: Record<string, string>;
  parallel: number;
};

export function parseBenchArgs(argv: string[]): BenchArgs {
  const a: BenchArgs = { qset: 'draw', configs: [], judge: false, dry: false, replay: false, runs: {}, parallel: 2 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const val = () => { const v = argv[++i]; if (v == null) throw new Error(`${k} needs a value`); return v; };
    switch (k) {
      case '--qset': a.qset = val(); break;
      case '--configs': a.configs = val().split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--judge': a.judge = true; break;
      case '--no-judge': a.judge = false; break;
      case '--dry': a.dry = true; break;
      case '--replay': a.replay = true; break;
      case '--runs': for (const kv of val().split(',')) { const [c, r] = kv.split('='); if (!c || !r) throw new Error('--runs needs config=runId[,config=runId]'); a.runs[c.trim()] = r.trim(); } break;
      case '--parallel': a.parallel = Math.min(4, Math.max(1, Math.floor(Number(val())))); break;
      default: throw new Error(`unknown flag ${k}`);
    }
  }
  if (!a.configs.length) throw new Error('--configs a,b,c is required');
  const bad = a.configs.filter((c) => !CONFIGS[c]);
  if (bad.length) throw new Error(`unknown config(s) ${bad.join(', ')} (have: ${Object.keys(CONFIGS).join(', ')})`);
  for (const c of Object.keys(a.runs)) if (!a.configs.includes(c)) throw new Error(`--runs names ${c}, which is not in --configs`);
  return a;
}

// ---- budget ---------------------------------------------------------------------------------

export type ConfigCost = { config: string; model: string; answers: number; judged: number; expectedUsd: number; worstUsd: number; generates: boolean };
export type Preflight = { rows: ConfigCost[]; expectedUsd: number; worstUsd: number; remainingUsd: number; ok: boolean; table: string };

/** Spend so far, read from the ledger file without touching it: settled entries plus open reservations. */
export type LedgerFile = { priorUsd?: number; entries?: { phase: string; usd: number }[]; open?: Record<string, { phase: string; worstUsd: number }> };
export function remainingFromLedger(f: LedgerFile, phase: string, caps: { totalUsd: number; phaseUsd: number }): { remainingUsd: number; phaseSpentUsd: number; totalSpentUsd: number } {
  const entries = f.entries ?? [];
  const open = Object.values(f.open ?? {});
  const held = open.reduce((s, o) => s + o.worstUsd, 0);
  const total = (f.priorUsd ?? 0) + entries.reduce((s, e) => s + e.usd, 0) + held;
  const ph = entries.filter((e) => e.phase === phase).reduce((s, e) => s + e.usd, 0) + held;
  return { remainingUsd: Math.max(0, Math.min(caps.totalUsd - total, caps.phaseUsd - ph)), phaseSpentUsd: ph, totalSpentUsd: total };
}

/**
 * Per config: expected and worst-case cost of generating every answer of the set (follow-ups are two)
 * plus, with --judge, one r3 judgement per question. Configs that reuse runs cost nothing. Refused when
 * the worst case of the whole bench is over what the phase (and the hard stop) has left.
 */
export function preflight(cfgs: Config[], qs: Question[], judge: boolean, remainingUsd: number, generates: (c: Config) => boolean): Preflight {
  const answers = answersOf(qs, 1);
  const rows = cfgs.map((c): ConfigCost => {
    const gen = generates(c);
    // A reused run keeps its judgements: only a generated run is judged anew.
    const judged = judge && gen ? qs.length : 0;
    return {
      config: c.name, model: c.model, answers: gen ? answers : 0, judged, generates: gen,
      expectedUsd: (gen ? answers * expectedAnswerUsd(c) : 0) + judged * expectedJudgeUsd(),
      worstUsd: (gen ? answers * worstAnswerUsd(c) : 0) + judged * worstJudgeUsd(),
    };
  });
  const expectedUsd = rows.reduce((s, r) => s + r.expectedUsd, 0), worstUsd = rows.reduce((s, r) => s + r.worstUsd, 0);
  const ok = worstUsd <= remainingUsd;
  const line = (cols: string[]) => cols.map((c, i) => (i ? c.padStart(12) : c.padEnd(30))).join('');
  const table = [
    line(['config', 'answers', 'judged', 'expected $', 'worst $']),
    ...rows.map((r) => line([r.config + (r.generates ? '' : ' (reuse)'), String(r.answers), String(r.judged), r.expectedUsd.toFixed(2), r.worstUsd.toFixed(2)])),
    line(['total', '', '', expectedUsd.toFixed(2), worstUsd.toFixed(2)]),
    `remaining in phase (and under the hard stop): $${remainingUsd.toFixed(2)} → ${ok ? 'OK' : 'REFUSED (worst case over the cap)'}`,
  ].join('\n');
  return { rows, expectedUsd, worstUsd, remainingUsd, ok, table };
}

// ---- cells ---------------------------------------------------------------------------------

export type GateCounts = { beats: number; failing: number; numbers: number; unbound: number; collisions: number; deixis: number; skips: number; other: number };
export const GATE_KEYS = ['numbers', 'unbound', 'collisions', 'deixis', 'skips', 'other'] as const;
const FAMILY: Record<string, (typeof GATE_KEYS)[number]> = { number: 'numbers', threshold: 'numbers', direction: 'numbers', unbound: 'unbound', layout: 'collisions', deixis: 'deixis', tag: 'skips' };

/** Defect counts over an answer's beats (the scout's opener beats excluded: every config shares the scout). */
export function gateCounts(beats: { opener: boolean; verdict: { flags: { check: string }[] } }[]): GateCounts {
  const g: GateCounts = { beats: 0, failing: 0, numbers: 0, unbound: 0, collisions: 0, deixis: 0, skips: 0, other: 0 };
  for (const b of beats) {
    if (b.opener) continue;
    g.beats++;
    if (b.verdict.flags.length) g.failing++;
    for (const f of b.verdict.flags) g[FAMILY[f.check] ?? 'other']++;
  }
  return g;
}

export type BenchCell = {
  config: string;
  runId: string | null;
  /** Question as asked on this turn. */
  asked: string;
  /** Paths relative to the bench index.html. */
  board?: string; final?: string; frames: { src: string; label: string }[];
  transcript: string;
  metrics: Metrics | null;
  judge?: JudgeResult;
  judgeUsd?: number;
  /** A placeholder judgement (--dry --judge), not a model's. */
  fakeJudge?: boolean;
  gate?: GateCounts;
  /** Fake answer (--dry with no recorded run): a demo script on the question's page, not a model's. */
  fake?: boolean;
  missing?: string;
};
export type BenchRow = { id: string; turn: number; deck: string; page: number; question: string; cells: Record<string, BenchCell> };

/** Up to `n` key frames spread over the scheduled ones (first, middle, last). */
export function keyFrames<T>(xs: T[], n = 3): T[] {
  if (xs.length <= n) return xs;
  const out: T[] = [];
  for (let k = 0; k < n; k++) out.push(xs[Math.round((k * (xs.length - 1)) / (n - 1))]);
  return [...new Set(out)];
}

// ---- summary --------------------------------------------------------------------------------

export type ConfigSummary = {
  config: string; model: string; effort: string; runId: string | null; fake: boolean;
  answers: number; missing: number;
  judged: number; judgeMean: number | null; byCriterion: Record<string, number>; fatal: number; fakeJudge: boolean;
  firstWordP50: number | null; firstWordP90: number | null;
  stage2P50: number | null; stage2P90: number | null; gapP50: number | null; gapP90: number | null;
  /** The silence actually heard after the opener (Metrics.silenceMs), and answers with a mid-answer silence over 1.5 s. */
  silenceP50: number | null; silenceP90: number | null; midSilent: number;
  spokenMeanS: number | null; spokenP50S: number | null;
  genUsd: number; usdPerAnswer: number | null; judgeUsd: number;
  gate: GateCounts; skipped: number; malformed: number;
};

export function summarize(config: string, cells: BenchCell[]): ConfigSummary {
  const c = CONFIGS[config];
  const ok = cells.filter((x) => x.metrics);
  const ms = ok.map((x) => x.metrics!);
  const judged = cells.filter((x) => x.judge);
  const criteria = [...new Set(judged.flatMap((x) => criteriaOf(x.judge!)))];
  const spoken = ms.map((m) => m.spokenMs).filter((v): v is number => v != null);
  const gate: GateCounts = { beats: 0, failing: 0, numbers: 0, unbound: 0, collisions: 0, deixis: 0, skips: 0, other: 0 };
  for (const x of cells) if (x.gate) for (const k of Object.keys(gate) as (keyof GateCounts)[]) gate[k] += x.gate[k];
  const genUsd = ms.reduce((s, m) => s + (m.answerUsd ?? m.usd), 0);
  return {
    config, model: c?.model ?? '?', effort: c?.effort ?? '?', runId: cells.find((x) => x.runId)?.runId ?? null, fake: cells.some((x) => x.fake),
    answers: ok.length, missing: cells.length - ok.length,
    judged: judged.length,
    judgeMean: judged.length ? judged.reduce((s, x) => s + meanScore(x.judge!), 0) / judged.length : null,
    byCriterion: Object.fromEntries(criteria.map((k) => { const v = judged.flatMap((x) => (k in x.judge!.scores ? [x.judge!.scores[k]] : [])); return [k, v.reduce((a, b) => a + b, 0) / v.length]; })),
    fatal: judged.reduce((s, x) => s + x.judge!.fatal.length, 0),
    fakeJudge: judged.some((x) => x.fakeJudge),
    firstWordP50: percentile(ms.map((m) => m.firstWordMs), 0.5), firstWordP90: percentile(ms.map((m) => m.firstWordMs), 0.9),
    stage2P50: percentile(ms.map((m) => m.stage2Ms ?? null), 0.5), stage2P90: percentile(ms.map((m) => m.stage2Ms ?? null), 0.9),
    gapP50: percentile(ms.map((m) => m.handoffGapMs ?? null), 0.5), gapP90: percentile(ms.map((m) => m.handoffGapMs ?? null), 0.9),
    silenceP50: percentile(ms.map((m) => m.silenceMs ?? null), 0.5), silenceP90: percentile(ms.map((m) => m.silenceMs ?? null), 0.9),
    midSilent: ms.filter((m) => (m.midSilences ?? 0) > 0).length,
    spokenMeanS: spoken.length ? spoken.reduce((a, b) => a + b, 0) / spoken.length / 1000 : null,
    spokenP50S: spoken.length ? percentile(spoken, 0.5)! / 1000 : null,
    genUsd, usdPerAnswer: ms.length ? genUsd / ms.length : null,
    judgeUsd: cells.reduce((s, x) => s + (x.judgeUsd ?? 0), 0),
    gate, skipped: ms.reduce((s, m) => s + m.skippedTotal, 0), malformed: ms.reduce((s, m) => s + m.malformed, 0),
  };
}

// ---- html -----------------------------------------------------------------------------------

const sec = (ms: number | null | undefined) => (ms == null ? '–' : `${(ms / 1000).toFixed(1)} s`);
const usd = (x: number | null | undefined) => (x == null ? '–' : x < 0.01 ? `$${x.toFixed(4)}` : `$${x.toFixed(3)}`);
const ABBR: Record<string, string> = { understanding: 'U', illustration: 'I', deck: 'D', craft: 'C', economy: 'E' };

const CSS = `
:root{--bg:#f6f6f8;--card:#fff;--ink:#1d1d1f;--mute:#6b6b73;--line:#dcdce2;--warn:#b3261e;--ok:#1a7f4b;--soft:#eef0f4}
@media (prefers-color-scheme:dark){:root{--bg:#141416;--card:#1d1d20;--ink:#ececf0;--mute:#9a9aa4;--line:#34343a;--warn:#ff8a80;--ok:#6fd39a;--soft:#26262b}}
*{box-sizing:border-box}body{margin:0;padding:24px;background:var(--bg);color:var(--ink);font:14px/1.45 -apple-system,system-ui,sans-serif}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:0 0 8px}p{margin:0 0 6px}.mute{color:var(--mute)}
.banner{border:1px solid var(--warn);color:var(--warn);border-radius:8px;padding:8px 12px;margin:12px 0}
section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:0 0 20px}
table{border-collapse:collapse;font-size:12.5px}td,th{padding:4px 10px 4px 0;text-align:left;border-bottom:1px solid var(--line);vertical-align:top;font-variant-numeric:tabular-nums}
.sum th{font-weight:600}.sum td.n{text-align:right}
.wrap{overflow-x:auto}
.grid{display:grid;gap:12px}
.qhead{grid-column:1/-1;margin-top:18px;padding-top:12px;border-top:1px solid var(--line)}
.qhead b{font-size:14px}.tag{font-size:12px;color:var(--mute);border:1px solid var(--line);border-radius:999px;padding:0 8px;margin-left:6px}
.cell{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px;min-width:0}
.cell h3{font-size:12px;margin:0 0 6px;color:var(--mute);font-weight:600}
.board img{width:100%;height:auto;max-height:640px;object-fit:contain;object-position:top;display:block;border:1px solid var(--line);border-radius:6px;background:var(--soft)}
.frames{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin:6px 0}.frames img{width:100%;height:auto;display:block;border:1px solid var(--line);border-radius:4px}
.frames figure{margin:0}.frames figcaption{font-size:11px;color:var(--mute)}
.stats{display:flex;flex-wrap:wrap;gap:2px 12px;font-size:12px;margin:6px 0}.stats b{font-weight:600}
.gate{font-size:12px}.gate .hit{color:var(--warn);font-weight:600}
.fatal{color:var(--warn);font-weight:600}.ok{color:var(--ok)}
.empty{display:flex;align-items:center;justify-content:center;min-height:120px;border:1px dashed var(--line);border-radius:6px;color:var(--mute);font-size:12px}
details{margin-top:6px}summary{cursor:pointer;font-size:12px;color:var(--mute)}summary:focus-visible,a:focus-visible{outline:2px solid currentColor;outline-offset:2px}
.tr{white-space:pre-wrap;font-size:12px;max-height:420px;overflow:auto;margin-top:6px}
a{color:inherit}
`;

function judgeHtml(j: JudgeResult | undefined, fake?: boolean): string {
  if (!j) return '';
  const s = criteriaOf(j).map((k) => `${ABBR[k] ?? k}${j.scores[k]}`).join(' ');
  return `<p class="stats"><span>judge <b>${meanScore(j).toFixed(2)}</b> (${esc(s)})${fake ? ' <span class="fatal">fake</span>' : ''}</span>${j.fatal.length ? `<span class="fatal">fatal: ${esc(j.fatal.join(', '))}</span>` : ''}${j.defects?.length ? `<span class="mute">${esc(j.defects.join(', '))}</span>` : ''}</p>`;
}

function gateHtml(g: GateCounts | undefined): string {
  if (!g) return '<p class="gate mute">gate: not run</p>';
  const part = (k: (typeof GATE_KEYS)[number]) => `<span class="${g[k] ? 'hit' : 'mute'}">${k} ${g[k]}</span>`;
  return `<p class="gate">gate ${g.failing}/${g.beats} beats flagged · ${GATE_KEYS.map(part).join(' · ')}</p>`;
}

function cellHtml(c: BenchCell | undefined): string {
  if (!c || !c.metrics) return `<div class="cell"><div class="empty">${esc(c?.missing ?? 'no answer')}</div></div>`;
  const m = c.metrics;
  const img = c.board ?? c.final;
  const board = img ? `<div class="board"><a href="${esc(img)}"><img loading="lazy" src="${esc(img)}" alt="${esc(`${c.config} final board`)}"></a></div>` : `<div class="empty">${c.fake ? 'fake answer: no capture' : 'no board capture'}</div>`;
  const frames = c.frames.length ? `<div class="frames">${c.frames.map((f) => `<figure><a href="${esc(f.src)}"><img loading="lazy" src="${esc(f.src)}" alt="${esc(f.label)}"></a><figcaption>${esc(f.label)}</figcaption></figure>`).join('')}</div>` : '';
  return `<div class="cell">${board}${frames}
<p class="stats"><span>first word <b>${sec(m.firstWordMs)}</b></span><span>author text <b>${sec(m.stage2Ms)}</b>${m.silenceMs ? ` (silence ${sec(m.silenceMs)})` : ''}</span><span>spoken <b>${sec(m.spokenMs)}</b></span><span>cost <b>${usd(m.answerUsd ?? m.usd)}</b>${m.estimated ? ' (est.)' : ''}</span><span>${m.words} words</span><span>${m.elements} marks</span>${m.skippedTotal || m.malformed ? `<span class="fatal">skipped ${m.skippedTotal} · malformed ${m.malformed}</span>` : ''}</p>
${judgeHtml(c.judge, c.fakeJudge)}${gateHtml(c.gate)}
${c.fake ? '<p class="fatal">fake answer (dry run)</p>' : ''}
<details><summary>Transcript</summary><div class="tr">${esc(c.transcript)}</div></details></div>`;
}

function summaryHtml(sums: ConfigSummary[]): string {
  const criteria = [...new Set(sums.flatMap((s) => Object.keys(s.byCriterion)))];
  const head = ['config', 'model / effort', 'answers', 'judge', ...criteria.map((k) => ABBR[k] ?? k), 'fatal', 'first word p50 / p90', 'author text p50 / p90', 'pause after opener p50 / p90', 'silence heard p50 / p90 (answers with a >1.5 s mid silence)', 'spoken mean / p50', 'gen $ (per answer)', 'judge $', 'gate flagged beats', ...GATE_KEYS, 'live skipped / malformed'];
  const rows = sums.map((s) => [
    `<b>${esc(s.config)}</b>${s.fake ? ' <span class="fatal">fake</span>' : ''}${s.runId ? `<br><span class="mute">${esc(s.runId)}</span>` : ''}`,
    `${esc(s.model)} / ${esc(s.effort)}`,
    `${s.answers}${s.missing ? ` <span class="fatal">(${s.missing} missing)</span>` : ''}`,
    s.judgeMean == null ? '–' : `${s.judgeMean.toFixed(2)}${s.fakeJudge ? ' <span class="fatal">fake</span>' : ''}`,
    ...criteria.map((k) => (s.byCriterion[k] == null ? '–' : s.byCriterion[k].toFixed(2))),
    String(s.fatal),
    `${sec(s.firstWordP50)} / ${sec(s.firstWordP90)}`,
    `${sec(s.stage2P50)} / ${sec(s.stage2P90)}`,
    `${sec(s.gapP50)} / ${sec(s.gapP90)}`,
    `${sec(s.silenceP50)} / ${sec(s.silenceP90)} (${s.midSilent})`,
    `${s.spokenMeanS == null ? '–' : `${s.spokenMeanS.toFixed(0)} s`} / ${s.spokenP50S == null ? '–' : `${s.spokenP50S.toFixed(0)} s`}`,
    `${usd(s.genUsd)} (${usd(s.usdPerAnswer)})`,
    usd(s.judgeUsd),
    `${s.gate.failing}/${s.gate.beats}`,
    ...GATE_KEYS.map((k) => String(s.gate[k])),
    `${s.skipped} / ${s.malformed}`,
  ]);
  return `<section><h2>Per config</h2><div class="wrap"><table class="sum"><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((v) => `<td>${v}</td>`).join('')}</tr>`).join('')}</table></div>
<p class="mute">First word: Enter → first caption word (usually the scout's opener, the same model for every config). Author text: Enter → stage 2's first text (the handoff); pause: the silence between the opener's last word and it. Spoken: first word → end of the last sentence. Cost: scout + stage 2 per answer. Judge: r3 (U understanding, I illustration, D deck, C craft, E economy; ~0.5 lenient, trust deltas). Gate (src/gate, offline over the recording, stage-2 beats only): numbers = stated numbers matching no page, literal or computed value (and threshold/direction claims); unbound = an engine-computed number typed instead of bound; collisions = layout overlaps; deixis = "this/here" with no ink nearby; skips = beats with a skipped or malformed tag; other = geometry (tangent/on-circle claims), erasure, and constants stated before they are declared.</p></section>`;
}

export type BenchMeta = { id: string; qset: string; createdAt: string; dry: boolean; judge: boolean; phase: string; promptVersion: string; preflight?: string };

export function renderBench(meta: BenchMeta, configs: string[], rows: BenchRow[], sums: ConfigSummary[]): string {
  const cols = `repeat(${configs.length}, minmax(300px, 1fr))`;
  const header = configs.map((c) => `<div class="cell"><b>${esc(c)}</b><br><span class="mute">${esc(CONFIGS[c]?.model ?? '')} / ${esc(CONFIGS[c]?.effort ?? '')}</span></div>`).join('');
  const body = rows.map((r) => `<div class="qhead"><b>${esc(r.id)}${r.turn ? ' · follow-up' : ''}</b><span class="tag">${esc(r.deck)} p${r.page}</span><p>${esc(r.question)}</p></div>${configs.map((c) => cellHtml(r.cells[c])).join('')}`).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Author bench ${esc(meta.qset)}</title><style>${CSS}</style></head><body>
<h1>Author benchmark · ${esc(meta.qset)}</h1>
<p class="mute">${esc(meta.id)} · prompt ${esc(meta.promptVersion)} · phase ${esc(meta.phase)} · ${esc(meta.createdAt)} · ${meta.judge ? 'judged (r3)' : 'not judged'}</p>
${meta.dry ? '<p class="banner">Dry run ($0): cells come from existing recorded runs of each config where one exists on this set; the rest are fake answers (demo scripts) with no captures. Fake judgements are placeholders.</p>' : ''}
${summaryHtml(sums)}
${meta.preflight ? `<details><summary>Budget preflight</summary><pre class="tr">${esc(meta.preflight)}</pre></details>` : ''}
<div class="wrap"><div class="grid" style="grid-template-columns:${cols}">${header}
${body}</div></div>
</body></html>
`;
}
