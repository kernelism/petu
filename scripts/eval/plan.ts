// scripts/eval/plan.ts — the runner's pure decisions: flags, which questions, budget preflight.
import { DEFAULT_QSET, QSETS, assertSplitAllowed, type QSetName, type Question } from './questions.ts';
import { CONFIGS, plannedWorstUsd, type Config } from './configs.ts';
import { DEFAULT_RUBRIC, RUBRICS, type RubricVersion } from './judge.ts';
import type { SpendSummary } from '../../src/agent/protocol.ts';
import type { GateSetting } from '../../src/gate/events.ts';

export type Args = {
  split: 'dev' | 'test' | 'both';
  config: string;
  only: string[] | null;
  n: number;
  replay: string | null;
  /** Finish a run in place from its stored results (no generation, no replay): sheets, missing judgements, summary. */
  finish: string | null;
  judge: boolean | null; // null = the config's default
  webkit: boolean;
  parallel: number;
  /** Latency run (plan P3.2): focus the ask bar, wait this long (page prewarm on intent), then ask. 0 = ask at once. */
  prewarmMs: number;
  /** Question set (q2 default; q1 = checkpoint 2). */
  qset: QSetName;
  /** Judge rubric (r3 default; r2 = checkpoint 2, for comparison). */
  rubric: RubricVersion;
  /** Offline check of the judge path: build every request, answer it with a fixed fake judgement (no server call, $0). */
  fakeJudge: boolean;
  /** --ask <deck>:<page>:<question>: one ad-hoc question (id X1, dev), e.g. to reproduce a founder report. */
  ask: { deck: string; page: number; question: string } | null;
  /** --then [p<page>:]<question> (repeatable, with --ask): follow-up turns in the same session; p<page> scrolls the PDF there first (the student wandered). */
  then: { page: number | null; question: string }[];
  /** Live gate (design 2026-10-29 §8): `&gate=` for the app; null = the app's default (live for agent answers). */
  gate: GateSetting | null;
  /** `&gatefail=K[:mode],…` injected faults (oN = opener sentence N). */
  gatefail: string | null;
  /** `&repair=`: live (POST /api/repair, spends), fake, recorded (replays only, $0), off. Null = recorded on a replay, live otherwise. */
  repair: RepairSetting | null;
};
export type RepairSetting = 'live' | 'fake' | 'recorded' | 'off';
const GATES: GateSetting[] = ['off', 'live', 'audit'];
const REPAIRS: RepairSetting[] = ['live', 'fake', 'recorded', 'off'];

export function parseArgs(argv: string[]): Args {
  const a: Args = { split: 'dev', config: 'terra-none', only: null, n: 1, replay: null, finish: null, judge: null, webkit: false, parallel: 4, prewarmMs: 0, qset: DEFAULT_QSET, rubric: DEFAULT_RUBRIC, fakeJudge: false, ask: null, then: [], gate: null, gatefail: null, repair: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const val = () => { const v = argv[++i]; if (v == null) throw new Error(`${k} needs a value`); return v; };
    switch (k) {
      case '--split': { const v = val(); if (v !== 'dev' && v !== 'test' && v !== 'both') throw new Error(`bad --split ${v}`); a.split = v; break; }
      case '--config': a.config = val(); break;
      case '--only': a.only = val().split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--n': a.n = Math.max(1, Math.floor(Number(val()))); if (!Number.isFinite(a.n)) throw new Error('bad --n'); break;
      case '--replay': a.replay = val(); break;
      case '--finish': a.finish = val(); break;
      case '--judge': a.judge = true; break;
      case '--no-judge': a.judge = false; break;
      case '--fake-judge': a.fakeJudge = true; a.judge = true; break;
      case '--webkit': a.webkit = true; break;
      case '--prewarm': a.prewarmMs = 4000; break;
      case '--qset': { const v = val(); if (!(v in QSETS)) throw new Error(`bad --qset ${v} (have: ${Object.keys(QSETS).join(', ')})`); a.qset = v as QSetName; break; }
      case '--rubric': { const v = val(); if (!(v in RUBRICS)) throw new Error(`bad --rubric ${v} (have: ${Object.keys(RUBRICS).join(', ')})`); a.rubric = v as RubricVersion; break; }
      case '--ask': { const m = /^([\w-]+):(\d+):(.+)$/s.exec(val()); if (!m) throw new Error('--ask needs <deck>:<page>:<question>'); a.ask = { deck: m[1], page: Number(m[2]), question: m[3] }; a.only = ['X1']; break; }
      case '--then': { const m = /^(?:p(\d+):)?(.+)$/s.exec(val()); if (!m) throw new Error('--then needs [p<page>:]<question>'); a.then.push({ page: m[1] ? Number(m[1]) : null, question: m[2] }); break; }
      case '--gate': { const v = val(); if (!GATES.includes(v as GateSetting)) throw new Error(`bad --gate ${v} (have: ${GATES.join(', ')})`); a.gate = v as GateSetting; break; }
      case '--gatefail': { const v = val(); if (!/^(o?\d+(:(skip|late|bad|ok))?)(,o?\d+(:(skip|late|bad|ok))?)*$/.test(v)) throw new Error(`bad --gatefail ${v} (K[:skip|late|bad|ok],…)`); a.gatefail = v; break; }
      case '--repair': { const v = val(); if (!REPAIRS.includes(v as RepairSetting)) throw new Error(`bad --repair ${v} (have: ${REPAIRS.join(', ')})`); a.repair = v as RepairSetting; break; }
      case '--parallel': a.parallel = Math.min(4, Math.max(1, Math.floor(Number(val())))); break;
      default: throw new Error(`unknown flag ${k}`);
    }
  }
  if (a.repair === 'recorded' && !a.replay) throw new Error('--repair recorded needs --replay');
  if (a.then.length && !a.ask) throw new Error('--then needs --ask');
  if (!CONFIGS[a.config]) throw new Error(`unknown config ${a.config} (have: ${Object.keys(CONFIGS).join(', ')})`);
  return a;
}

/** Questions to run, in set order, after --split, --only and the config's own restriction. */
export function selectQuestions(a: Args, cfg: Config = CONFIGS[a.config], qs: Question[] = QSETS[a.qset]): Question[] {
  let out = a.split === 'both' ? qs : qs.filter((q) => q.split === a.split);
  if (a.only) {
    const unknown = a.only.filter((id) => !qs.some((q) => q.id === id));
    if (unknown.length) throw new Error(`unknown question id(s): ${unknown.join(', ')}`);
    out = qs.filter((q) => a.only!.includes(q.id));
  } else if (cfg.only) out = out.filter((q) => cfg.only!.includes(q.id)); // cost control: a config may name ids
  return out;
}

/** The repair mode the app gets: recorded on a replay, live on a generating run, unless --repair says otherwise. */
export const repairOf = (a: Args): RepairSetting => a.repair ?? (a.replay ? 'recorded' : 'live');
/** Does this run spend on repairs? (a generating run, gated, with live repairs) */
export const spendsOnRepairs = (a: Args): boolean => !a.replay && !a.finish && a.gate !== 'off' && repairOf(a) === 'live';
/** The app's query for the gate flags (appended to the eval URL). */
export function gateQuery(a: Args): string {
  const q: string[] = [];
  if (a.gate) q.push(`gate=${a.gate}`);
  if (a.gatefail) q.push(`gatefail=${encodeURIComponent(a.gatefail)}`);
  const r = repairOf(a);
  if (a.repair || a.replay) q.push(`repair=${r === 'live' ? 'live' : r}`);
  return q.length ? `&${q.join('&')}` : '';
}

export const wantsJudge = (a: Args, cfg: Config): boolean => (a.judge ?? cfg.judge ?? true);

/** Turns generated: a follow-up question is two. */
export const answersOf = (qs: Question[], n: number): number => qs.reduce((s, q) => s + (q.followUp ? 2 : 1), 0) * n;

export type BudgetCheck = { ok: boolean; planned: number; remaining: number; message: string };

/** Remaining spend the server allows right now: the nearest of the total/phase cap and the daily cap. */
export function remainingUsd(s: SpendSummary): number {
  const left = [s.capUsd - s.totalUsd];
  // the daily cap counts founder-phase spend only, so it limits founder runs alone
  if (s.dailyCapUsd != null && s.phase === 'founder') left.push(s.dailyCapUsd - s.todayUsd);
  // The server's phase budget (the per-request refusal the run would otherwise hit midway).
  if (s.phaseCapUsd != null && s.phase) left.push(s.phaseCapUsd - (s.byPhase?.[s.phase] ?? 0));
  return Math.max(0, Math.min(...left));
}

export function checkBudget(spend: SpendSummary, cfg: Config, qs: Question[], n: number, judge: boolean, rubric: RubricVersion = 'r2', repairs = false): BudgetCheck {
  // (a fake judge costs nothing: the runner passes judge=false for it)
  const answers = answersOf(qs, n);
  const planned = plannedWorstUsd(cfg, answers, judge ? qs.length * n : 0, rubric, repairs);
  const remaining = remainingUsd(spend);
  if (spend.blocked) return { ok: false, planned, remaining, message: `server is blocked: ${spend.blocked}` };
  const ok = planned <= remaining;
  return { ok, planned, remaining, message: `planned worst case $${planned.toFixed(2)} ${ok ? '<=' : '>'} remaining $${remaining.toFixed(2)}` };
}

export { assertSplitAllowed };
