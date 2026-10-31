// server/env.ts — the ONLY place that reads OPENAI_API_KEY, the Anthropic key, SPEECHMATICS_API_KEY (and every PETU_* knob).
// The Anthropic key comes from the .env file only (Vite's loadEnv result): PETU_ANTHROPIC_KEY, else
// ANTHROPIC_API_KEY. A value of either name in the process environment is never used (in this shell
// ANTHROPIC_API_KEY can belong to other Anthropic tools and redirect their billing), and nothing is
// ever written into process.env, so no other code in the process picks the key up.
//
// Precedence: process.env first, then the .env files via Vite's loadEnv. Phases and caps are set on
// the command line for a run (`PETU_PHASE=bakeoff npm run dev`); nobody edits .env for them.
// The key is returned to server code only; it is never logged, emitted or written anywhere.
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadEnv } from 'vite';
import { PRICES } from './prices';
import { HARD_STOP_USD } from '../src/agent/protocol';
import type { Caps, Phase } from './ledger';
import type { Effort, ModelConfig } from './openai';
import { ANTHROPIC_NO_NONE, isAnthropicModel } from './anthropic';
import { VARIANT_NAMES } from './prompt/variants/index';
import { bestConfig } from './quality';

/** The $60 hard stop (prior spike spend included; $40 until 2026-10-28). PETU_TOTAL_CAP_USD may only lower it. */
export const MAX_TOTAL_USD = HARD_STOP_USD;
/**
 * Per-phase budgets (plan §3; Lessons v3 "Spend" adds the lesson* phases inside the same hard
 * stop, from the headroom outside the founder reserve). `bench` ($15): the author-model benchmark
 * (`npm run bench`), from the $20 the hard stop gained. Override one for a run with
 * PETU_CAP_<PHASE>, e.g. PETU_CAP_DEV=3 for contingency.
 */
export const PHASE_CAPS: Record<Phase, number> = {
  dev: 1, bakeoff: 6, iterate: 7, validate: 2, founder: 21.99,
  lessondev: 1.5, lessonbake: 3, lessoniter: 3.5, lessonval: 2, bench: 15,
};
export const PHASES = Object.keys(PHASE_CAPS) as Phase[];
const EFFORTS: Effort[] = ['none', 'low', 'medium', 'high'];
/**
 * The answer model, chosen by the P1 bake-off (2026-10-28, prompt p3.1, plan P1.5 / spec A1):
 * gpt-6.1-terra at effort none, Standard tier, no text.verbosity. It is the only config under the
 * latency gate (Enter → first caption word p50 1.27s / p90 2.21s over 58 answers; gate 1.4s / 2.5s).
 * luna-none missed p90 (2.62s) and scored lowest; terra-low (p90 4.5s), sol-low (p50 3.9s) and
 * astra-low (p90 8.7s) are too slow for one streamed pass. Fast mode gave no first-word gain (warm
 * A/B: 2.09s vs 1.24s/1.42s), and verbosity low lost 0.25 judge points on the answers it changed.
 */
export const DEFAULT_MODEL = 'gpt-6.1-terra';
/**
 * 2026-10-30 (SVG board, p6.1): effort medium. On the held-out set terra-medium judged 3.67 vs Opus-low
 * 3.80 at ~1/9 the cost, and a blind founder + coordinator A/B preferred it on 2 of 3; effort none drew
 * visibly weaker boards. Founder decision: terra-medium is the default, Opus the opt-in "best quality".
 * Reverted to effort none the same night: at medium the main answer started 16–32 s after Enter (the
 * opener covers ~5 s), a long silent "…" — latency outranks the board gain. Medium returns once the
 * thinking can overlap speech.
 */
export const DEFAULT_EFFORT: Effort = 'none';
/** Stage 2's output budget: a script that walks several pages and draws (p3.2 answers used ≤ ~900). */
export const DEFAULT_MAX_OUTPUT = 3200;
/** With reasoning on, its tokens count against the output budget too. */
export const DEFAULT_MAX_OUTPUT_REASONING = 6000;
/** Stage 1 (spec A): the fast model at effort none; its JSON is the opener (one or two sentences), ≤ 6 pages and a plan of ≤ 100 words ending with its beats. */
export const DEFAULT_SCOUT_MODEL = 'gpt-6.1-terra';
export { SCOUT_MAX_OUTPUT } from './limits';
import { REPAIR_MAX_OUTPUT, SCOUT_MAX_OUTPUT, STORYBOARD_MAX_OUTPUT } from './limits';
/**
 * The storyboard (spec "Board v2" 5): a reasoning model designs the lesson while the opener plays.
 * Off by default until it lands within the opener: the first live runs (2026-10-28) timed out at 12s
 * at effort low and none, a 20–24s handoff gap. PETU_STORYBOARD=1 turns it on for a run.
 */
export const DEFAULT_STORYBOARD_MODEL = 'gpt-6.1-terra';
export const DEFAULT_STORYBOARD_EFFORT: Effort = 'low';
/** Models whose API rejects reasoning.effort "none" (developers.openai.com/api/docs/guides/reasoning, 2026-10-28). */
const NO_NONE = new Set(['gpt-6.1-sol', 'gpt-6-astra']);

export type PetuEnv = {
  key: string;
  /** PETU_ANTHROPIC_KEY ('' when unset: a claude-* answer model then refuses each answer with a clear message). */
  anthropicKey: string;
  /** SPEECHMATICS_API_KEY ('' when unset: the mic button says dictation is not set up). Server-side only: the browser gets short-lived keys. */
  speechmaticsKey: string;
  model: ModelConfig;
  /** Answer quality "Best" (server/quality.ts): Opus at effort low; null without the Anthropic key. */
  best: ModelConfig | null;
  /** Stage 1 (scout): a fast model at no reasoning; JSON out. */
  scout: ModelConfig;
  /** The lesson designer between the scout and stage 2; null when PETU_STORYBOARD=0. */
  storyboard: ModelConfig | null;
  /**
   * The live gate's repairs (design §6; server/repair.ts): stage 2's model at PETU_REPAIR_EFFORT (default
   * stage 2's effort) with REPAIR_MAX_OUTPUT; null when PETU_REPAIR=off (every /api/repair is refused).
   */
  repair: ModelConfig | null;
  phase: Phase;
  caps: Caps;
  priorUsd: number;
  pdfDirs: string[];
  /** Eval runner only: the /api/judge token it chose (then .petu/eval-token is left alone). */
  evalToken?: string;
};

/**
 * Typed, validated config from a key lookup. Throws on a bad knob (the dev server then refuses to start).
 * `opts.fileEnv`: a lookup of the .env file alone (no process.env); the Anthropic key is read only there.
 */
export function parseEnv(get: (k: string) => string | undefined, opts: { root: string; home: string; fileEnv?: (k: string) => string | undefined }): PetuEnv {
  const str = (k: string) => { const v = get(k)?.trim(); return v ? v : undefined; };
  const num = (k: string, dflt: number) => {
    const v = str(k);
    if (v == null) return dflt;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Error(`petu: ${k} must be a non-negative number (got "${v}")`);
    return n;
  };
  const oneOf = <T extends string>(k: string, allowed: readonly T[], dflt: T): T => {
    const v = str(k) ?? dflt;
    if (!(allowed as readonly string[]).includes(v)) throw new Error(`petu: ${k} must be one of ${allowed.join(' | ')} (got "${v}")`);
    return v as T;
  };

  const model = str('PETU_MODEL') ?? DEFAULT_MODEL;
  if (!PRICES[model]) throw new Error(`petu: PETU_MODEL "${model}" has no price in server/prices.ts (${Object.keys(PRICES).join(', ')})`);
  const effort = oneOf('PETU_EFFORT', EFFORTS, DEFAULT_EFFORT);
  if (effort === 'none' && NO_NONE.has(model)) throw new Error(`petu: ${model} does not accept reasoning effort none; set PETU_EFFORT=low`);
  if (effort === 'none' && ANTHROPIC_NO_NONE.has(model)) throw new Error(`petu: ${model} cannot turn thinking off; set PETU_EFFORT=low`);
  const verbosity = str('PETU_VERBOSITY') == null ? undefined : oneOf('PETU_VERBOSITY', ['low', 'medium'] as const, 'low');
  // Lessons v3: an answer may walk several pages and build a figure across them.
  const maxOutput = Math.round(num('PETU_MAX_OUTPUT', effort === 'none' ? DEFAULT_MAX_OUTPUT : DEFAULT_MAX_OUTPUT_REASONING));
  if (maxOutput < 1) throw new Error('petu: PETU_MAX_OUTPUT must be ≥ 1');

  const scoutModel = str('PETU_SCOUT_MODEL') ?? DEFAULT_SCOUT_MODEL;
  if (!PRICES[scoutModel]) throw new Error(`petu: PETU_SCOUT_MODEL "${scoutModel}" has no price in server/prices.ts`);
  if (isAnthropicModel(scoutModel)) throw new Error('petu: the scout runs on OpenAI only (PETU_SCOUT_MODEL); Claude models are wired for stage 2 (PETU_MODEL)');
  const scoutEffort = oneOf('PETU_SCOUT_EFFORT', EFFORTS, 'none');
  if (scoutEffort === 'none' && NO_NONE.has(scoutModel)) throw new Error(`petu: ${scoutModel} does not accept reasoning effort none; set PETU_SCOUT_EFFORT=low`);
  const explicitCache = str('PETU_EXPLICIT_CACHE') !== '0';
  // EXPERIMENT: a stage-2 prompt variant (server/prompt/variants); unset = the default prompt, unchanged.
  const promptVariant = str('PETU_PROMPT_VARIANT');
  if (promptVariant && !VARIANT_NAMES.includes(promptVariant)) throw new Error(`petu: PETU_PROMPT_VARIANT must be one of ${VARIANT_NAMES.join(' | ')} (got "${promptVariant}")`);
  const storyModel = str('PETU_STORYBOARD_MODEL') ?? DEFAULT_STORYBOARD_MODEL;
  if (!PRICES[storyModel]) throw new Error(`petu: PETU_STORYBOARD_MODEL "${storyModel}" has no price in server/prices.ts`);
  if (isAnthropicModel(storyModel)) throw new Error('petu: the storyboard runs on OpenAI only (PETU_STORYBOARD_MODEL)');
  const storyEffort = oneOf('PETU_STORYBOARD_EFFORT', EFFORTS, DEFAULT_STORYBOARD_EFFORT);
  if (storyEffort === 'none' && NO_NONE.has(storyModel)) throw new Error(`petu: ${storyModel} does not accept reasoning effort none; set PETU_STORYBOARD_EFFORT=low`);
  const storyOn = oneOf('PETU_STORYBOARD', ['0', '1'] as const, '0') === '1';
  const repairOn = oneOf('PETU_REPAIR', ['on', 'off'] as const, 'on') === 'on';
  // A repair has only REPAIR_MAX_OUTPUT tokens: above low, reasoning could spend all of them before any text.
  const repairEffort = oneOf('PETU_REPAIR_EFFORT', EFFORTS, effort === 'none' || effort === 'low' ? effort : 'low');
  if (repairEffort === 'none' && (NO_NONE.has(model) || ANTHROPIC_NO_NONE.has(model))) throw new Error(`petu: ${model} does not accept effort none; set PETU_REPAIR_EFFORT=low`);

  const phase = oneOf('PETU_PHASE', PHASES, 'founder');
  const phaseUsd = Object.fromEntries(PHASES.map((p) => [p, num(`PETU_CAP_${p.toUpperCase()}`, PHASE_CAPS[p])])) as Record<Phase, number>;
  const caps: Caps = {
    totalUsd: Math.min(num('PETU_TOTAL_CAP_USD', MAX_TOTAL_USD), MAX_TOTAL_USD),
    // The daily cap guards the founder's own use; eval phases are bounded by their phase budgets.
    ...(phase === 'founder' ? { dailyUsd: num('PETU_DAILY_CAP_USD', 3) } : {}),
    phaseUsd,
  };

  const expand = (p: string) => (p === '~' ? opts.home : p.startsWith('~/') ? join(opts.home, p.slice(2)) : resolve(opts.root, p));
  const dirs = str('PETU_PDF_DIRS');
  const pdfDirs = (dirs ? dirs.split(',') : [join(opts.home, 'Documents/670/contents'), join(opts.root, 'public/dev')])
    .map((s) => s.trim()).filter(Boolean).map(expand);

  const anthropicKey = anthropicKeyOf(opts.fileEnv);
  const answer: ModelConfig = { model, effort, maxOutput, fast: str('PETU_FAST') === '1', ...(verbosity ? { verbosity } : {}), explicitCache, ...(promptVariant ? { promptVariant } : {}), ...(str('PETU_PAGE_DETAIL') ? { pageDetail: oneOf('PETU_PAGE_DETAIL', ['low', 'high'] as const, 'high') } : {}) };
  return {
    key: get('OPENAI_API_KEY')?.trim() ?? '',
    anthropicKey,
    speechmaticsKey: get('SPEECHMATICS_API_KEY')?.trim() ?? '',
    model: answer,
    best: anthropicKey ? bestConfig(answer, DEFAULT_MAX_OUTPUT_REASONING) : null,
    scout: { model: scoutModel, effort: scoutEffort, maxOutput: SCOUT_MAX_OUTPUT, fast: str('PETU_SCOUT_FAST') === '1', explicitCache },
    storyboard: storyOn ? { model: storyModel, effort: storyEffort, maxOutput: STORYBOARD_MAX_OUTPUT, fast: false, explicitCache, ...(str('PETU_STORYBOARD_TIMEOUT_MS') ? { timeoutMs: num('PETU_STORYBOARD_TIMEOUT_MS', 12_000) } : {}) } : null,
    repair: repairOn ? { model, effort: repairEffort, maxOutput: REPAIR_MAX_OUTPUT, fast: str('PETU_FAST') === '1', explicitCache } : null,
    phase, caps,
    priorUsd: num('PETU_PRIOR_USD', 0.0076),
    pdfDirs,
    ...(str('PETU_EVAL_TOKEN') ? { evalToken: str('PETU_EVAL_TOKEN') } : {}),
  };
}

/** The Anthropic key from the .env file lookup: PETU_ANTHROPIC_KEY first, else ANTHROPIC_API_KEY; '' when neither. */
export function anthropicKeyOf(fileEnv?: (k: string) => string | undefined): string {
  for (const k of ['PETU_ANTHROPIC_KEY', 'ANTHROPIC_API_KEY']) { const v = fileEnv?.(k)?.trim(); if (v) return v; }
  return '';
}

/**
 * Reads the environment once for the dev server: process.env wins over the .env files (knobs). The
 * Anthropic key is the exception: file only. Vite's loadEnv (prefix '') returns process.env's value
 * for any key the process also has, so a name present in process.env is skipped for the key (its file
 * value can't be told apart from the process's): unset it in the shell, or use PETU_ANTHROPIC_KEY.
 */
export function loadPetuEnv(mode: string, envDir: string | false, root: string, load: typeof loadEnv = loadEnv, proc: NodeJS.ProcessEnv = process.env): PetuEnv {
  const files = load(mode, envDir, '');
  const fileEnv = (k: string) => (proc[k] === undefined ? files[k] : undefined);
  return parseEnv((k) => (proc[k] ? proc[k] : files[k]), { root, home: homedir(), fileEnv });
}
