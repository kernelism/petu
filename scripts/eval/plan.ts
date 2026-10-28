// scripts/eval/plan.ts — the runner's pure decisions: flags, which questions, budget preflight.
import { QUESTIONS, assertSplitAllowed, type Question } from './questions.ts';
import { CONFIGS, plannedWorstUsd, type Config } from './configs.ts';
import type { SpendSummary } from '../../src/agent/protocol.ts';

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
};

export function parseArgs(argv: string[]): Args {
  const a: Args = { split: 'dev', config: 'terra-none', only: null, n: 1, replay: null, finish: null, judge: null, webkit: false, parallel: 4, prewarmMs: 0 };
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
      case '--webkit': a.webkit = true; break;
      case '--prewarm': a.prewarmMs = 4000; break;
      case '--parallel': a.parallel = Math.min(4, Math.max(1, Math.floor(Number(val())))); break;
      default: throw new Error(`unknown flag ${k}`);
    }
  }
  if (!CONFIGS[a.config]) throw new Error(`unknown config ${a.config} (have: ${Object.keys(CONFIGS).join(', ')})`);
  return a;
}

/** Questions to run, in set order, after --split, --only and the config's own restriction. */
export function selectQuestions(a: Args, cfg: Config = CONFIGS[a.config], qs: Question[] = QUESTIONS): Question[] {
  let out = a.split === 'both' ? qs : qs.filter((q) => q.split === a.split);
  if (a.only) {
    const unknown = a.only.filter((id) => !qs.some((q) => q.id === id));
    if (unknown.length) throw new Error(`unknown question id(s): ${unknown.join(', ')}`);
    out = qs.filter((q) => a.only!.includes(q.id));
  } else if (cfg.only) out = out.filter((q) => cfg.only!.includes(q.id));
  return out;
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

export function checkBudget(spend: SpendSummary, cfg: Config, qs: Question[], n: number, judge: boolean): BudgetCheck {
  const answers = answersOf(qs, n);
  const planned = plannedWorstUsd(cfg, answers, judge ? qs.length * n : 0);
  const remaining = remainingUsd(spend);
  if (spend.blocked) return { ok: false, planned, remaining, message: `server is blocked: ${spend.blocked}` };
  const ok = planned <= remaining;
  return { ok, planned, remaining, message: `planned worst case $${planned.toFixed(2)} ${ok ? '<=' : '>'} remaining $${remaining.toFixed(2)}` };
}

export { assertSplitAllowed };
