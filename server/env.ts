// server/env.ts — the ONLY place that reads OPENAI_API_KEY (and every PETU_* knob).
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

/** The $40 hard stop for checkpoint 2 (prior spike spend included). PETU_TOTAL_CAP_USD may only lower it. */
export const MAX_TOTAL_USD = HARD_STOP_USD;
/**
 * Per-phase budgets (plan §3; Lessons v3 "Spend" adds the lesson* phases inside the same $40 hard
 * stop, from the headroom outside the founder reserve). Override one for a run with
 * PETU_CAP_<PHASE>, e.g. PETU_CAP_DEV=3 for contingency.
 */
export const PHASE_CAPS: Record<Phase, number> = {
  dev: 1, bakeoff: 6, iterate: 7, validate: 2, founder: 21.99,
  lessondev: 1.5, lessonbake: 3, lessoniter: 3.5, lessonval: 2,
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
export const DEFAULT_EFFORT: Effort = 'none';
/** Stage 2's output budget: a script that walks several pages and draws (p3.2 answers used ≤ ~900). */
export const DEFAULT_MAX_OUTPUT = 3200;
/** Stage 1 (spec A): the fast model at effort none; its JSON is the opener (one or two sentences), ≤ 6 pages and ≤ 80 words. */
export const DEFAULT_SCOUT_MODEL = 'gpt-6.1-terra';
export { SCOUT_MAX_OUTPUT } from './limits';
import { SCOUT_MAX_OUTPUT, STORYBOARD_MAX_OUTPUT } from './limits';
/**
 * The storyboard (spec "Board v2" 5): a reasoning model designs the lesson while the opener plays.
 * PETU_STORYBOARD=0 turns it off (stage 2 then runs on the scout's plan, as before).
 */
export const DEFAULT_STORYBOARD_MODEL = 'gpt-6.1-terra';
export const DEFAULT_STORYBOARD_EFFORT: Effort = 'low';
/** Models whose API rejects reasoning.effort "none" (developers.openai.com/api/docs/guides/reasoning, 2026-10-28). */
const NO_NONE = new Set(['gpt-6.1-sol', 'gpt-6-astra']);

export type PetuEnv = {
  key: string;
  model: ModelConfig;
  /** Stage 1 (scout): a fast model at no reasoning; JSON out. */
  scout: ModelConfig;
  /** The lesson designer between the scout and stage 2; null when PETU_STORYBOARD=0. */
  storyboard: ModelConfig | null;
  phase: Phase;
  caps: Caps;
  priorUsd: number;
  pdfDirs: string[];
  /** Eval runner only: the /api/judge token it chose (then .petu/eval-token is left alone). */
  evalToken?: string;
};

/** Typed, validated config from a key lookup. Throws on a bad knob (the dev server then refuses to start). */
export function parseEnv(get: (k: string) => string | undefined, opts: { root: string; home: string }): PetuEnv {
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
  const verbosity = str('PETU_VERBOSITY') == null ? undefined : oneOf('PETU_VERBOSITY', ['low', 'medium'] as const, 'low');
  // Lessons v3: an answer may walk several pages and build a figure across them.
  const maxOutput = Math.round(num('PETU_MAX_OUTPUT', DEFAULT_MAX_OUTPUT));
  if (maxOutput < 1) throw new Error('petu: PETU_MAX_OUTPUT must be ≥ 1');

  const scoutModel = str('PETU_SCOUT_MODEL') ?? DEFAULT_SCOUT_MODEL;
  if (!PRICES[scoutModel]) throw new Error(`petu: PETU_SCOUT_MODEL "${scoutModel}" has no price in server/prices.ts`);
  const scoutEffort = oneOf('PETU_SCOUT_EFFORT', EFFORTS, 'none');
  if (scoutEffort === 'none' && NO_NONE.has(scoutModel)) throw new Error(`petu: ${scoutModel} does not accept reasoning effort none; set PETU_SCOUT_EFFORT=low`);
  const explicitCache = str('PETU_EXPLICIT_CACHE') !== '0';
  const storyModel = str('PETU_STORYBOARD_MODEL') ?? DEFAULT_STORYBOARD_MODEL;
  if (!PRICES[storyModel]) throw new Error(`petu: PETU_STORYBOARD_MODEL "${storyModel}" has no price in server/prices.ts`);
  const storyEffort = oneOf('PETU_STORYBOARD_EFFORT', EFFORTS, DEFAULT_STORYBOARD_EFFORT);
  if (storyEffort === 'none' && NO_NONE.has(storyModel)) throw new Error(`petu: ${storyModel} does not accept reasoning effort none; set PETU_STORYBOARD_EFFORT=low`);
  const storyOn = oneOf('PETU_STORYBOARD', ['0', '1'] as const, '1') === '1';

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

  return {
    key: get('OPENAI_API_KEY')?.trim() ?? '',
    model: { model, effort, maxOutput, fast: str('PETU_FAST') === '1', ...(verbosity ? { verbosity } : {}), explicitCache, ...(str('PETU_PAGE_DETAIL') ? { pageDetail: oneOf('PETU_PAGE_DETAIL', ['low', 'high'] as const, 'high') } : {}) },
    scout: { model: scoutModel, effort: scoutEffort, maxOutput: SCOUT_MAX_OUTPUT, fast: str('PETU_SCOUT_FAST') === '1', explicitCache },
    storyboard: storyOn ? { model: storyModel, effort: storyEffort, maxOutput: STORYBOARD_MAX_OUTPUT, fast: false, explicitCache } : null,
    phase, caps,
    priorUsd: num('PETU_PRIOR_USD', 0.0076),
    pdfDirs,
    ...(str('PETU_EVAL_TOKEN') ? { evalToken: str('PETU_EVAL_TOKEN') } : {}),
  };
}

/** Reads the environment once for the dev server: process.env wins over the .env files. */
export function loadPetuEnv(mode: string, envDir: string | false, root: string): PetuEnv {
  const files = loadEnv(mode, envDir, '');
  return parseEnv((k) => (process.env[k] ? process.env[k] : files[k]), { root, home: homedir() });
}
