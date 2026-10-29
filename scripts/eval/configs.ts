// scripts/eval/configs.ts — named model configs. Each sets env for the dev server the runner starts.
import { PRICES, worstCaseUsd } from '../../server/prices.ts';
import { JUDGE_MAX_OUTPUT, SCOUT_MAX_OUTPUT, STORYBOARD_MAX_OUTPUT } from '../../server/limits.ts';
export { JUDGE_MAX_OUTPUT };

export type Config = {
  name: string;
  model: string;
  effort: 'none' | 'low' | 'medium';
  /** PETU_MAX_OUTPUT for the run (thinking models spend part of it before the first word). Default: the server's 3200. */
  maxOutput?: number;
  fast?: boolean;
  /** text.verbosity for the model, when it accepts one (server reads PETU_VERBOSITY). */
  verbosity?: 'low';
  /** Restrict to these question ids (cost control). */
  only?: string[];
  /** Judge by default? (timing-only configs say no.) */
  judge?: boolean;
};

const D1_6 = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'];
const TEN = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10'];

export const CONFIGS: Record<string, Config> = {
  'luna-none': { name: 'luna-none', model: 'gpt-6-luna', effort: 'none' },
  'terra-none': { name: 'terra-none', model: 'gpt-6.1-terra', effort: 'none' },
  'terra-low': { name: 'terra-low', model: 'gpt-6.1-terra', effort: 'low' },
  'terra-medium': { name: 'terra-medium', model: 'gpt-6.1-terra', effort: 'medium', maxOutput: 6000 },
  'sol-low': { name: 'sol-low', model: 'gpt-6.1-sol', effort: 'low' },
  'sol-medium': { name: 'sol-medium', model: 'gpt-6.1-sol', effort: 'medium', maxOutput: 6000 },
  'astra-low': { name: 'astra-low', model: 'gpt-6-astra', effort: 'low', only: D1_6 },
  'terra-none-fast': { name: 'terra-none-fast', model: 'gpt-6.1-terra', effort: 'none', fast: true, only: TEN, judge: false },
  'terra-none-verbosity-low': { name: 'terra-none-verbosity-low', model: 'gpt-6.1-terra', effort: 'none', verbosity: 'low' },
  // Anthropic (server/anthropic.ts; needs PETU_ANTHROPIC_KEY). One per current model, chosen for the
  // first word: Opus 5.5 cannot turn thinking off, so its lowest effort; Sonnet 5.5 and Haiku 5.5 with
  // thinking off (no thinking before the first text token). claude-sonnet-low is the thinking variant.
  // Thinking tokens count against max_tokens: thinking configs get 6000.
  'claude-opus-low': { name: 'claude-opus-low', model: 'claude-opus-5-5', effort: 'low', maxOutput: 6000 },
  'claude-sonnet-none': { name: 'claude-sonnet-none', model: 'claude-sonnet-5-5', effort: 'none' },
  'claude-sonnet-low': { name: 'claude-sonnet-low', model: 'claude-sonnet-5-5', effort: 'low', maxOutput: 6000 },
  'claude-haiku-none': { name: 'claude-haiku-none', model: 'claude-haiku-5-5', effort: 'none' },
};

export function configEnv(c: Config, phase: string): Record<string, string> {
  const env: Record<string, string> = { PETU_MODEL: c.model, PETU_EFFORT: c.effort, PETU_PHASE: phase, PETU_FAST: c.fast ? '1' : '0' };
  if (c.verbosity) env.PETU_VERBOSITY = c.verbosity;
  if (c.maxOutput) env.PETU_MAX_OUTPUT = String(c.maxOutput);
  return env;
}

/** The server's stage-2 output budget for a config (what the ledger reserves per answer). */
export const maxOutputOf = (c: Config): number => c.maxOutput ?? 3200;
/** Claude's tokenizer counts up to ~1.35× the tokens of the same text (server/openai.ts reserves with the same factor). */
export const inputFactor = (c: Config): number => (c.model.startsWith('claude-') ? 1.35 : 1);

/**
 * Typical output tokens of one stage-2 answer by effort (narration + tags; thinking included for
 * reasoning efforts). From recorded runs: terra-none answers stream ~700–1000 tokens; reasoning adds
 * roughly 1–2.5k. An estimate for the preflight, not a bound (the bound is maxOutputOf).
 */
export const TYPICAL_OUTPUT: Record<Config['effort'], number> = { none: 1000, low: 2200, medium: 3800 };
/** Typical stage-2 input (system + digest + visible page and image + other pages + tail) and the share read from cache. */
export const TYPICAL_INPUT_TOKENS = 14000;
export const TYPICAL_CACHED_SHARE = 0.5;

/**
 * Expected cost of one answer (stage 2 + scout), USD: half the input read from cache, the other half
 * written at the short-TTL rate (worst of plain and write), typical output for the effort.
 */
export function expectedAnswerUsd(c: Config): number {
  const p = PRICES[c.model];
  if (!p) throw new Error(`no price for ${c.model}`);
  const input = TYPICAL_INPUT_TOKENS * inputFactor(c);
  const stage2 = (input * TYPICAL_CACHED_SHARE * p.cached + input * (1 - TYPICAL_CACHED_SHARE) * Math.max(p.in, p.write30m) + TYPICAL_OUTPUT[c.effort] * p.out) / 1e6;
  const s = PRICES[SCOUT_MODEL];
  const scout = (SCOUT_INPUT_TOKENS * 0.5 * s.cached + SCOUT_INPUT_TOKENS * 0.5 * s.write30m + 250 * s.out) / 1e6;
  return (c.fast ? stage2 * 2 : stage2) + scout;
}
/** The ledger's worst case for one answer (stage 2 at its own output budget + scout), USD. */
export const worstAnswerUsd = (c: Config): number =>
  worstCaseUsd(c.model, Math.ceil(ASSUMED_INPUT_TOKENS * inputFactor(c)), maxOutputOf(c), !!c.fast) + worstCaseUsd(SCOUT_MODEL, SCOUT_INPUT_TOKENS, SCOUT_MAX_OUTPUT) + storyboardWorst();
/** One r3 judgement: expected (~16k in, mostly uncached; ~800 out) and worst (the server's 1600-token budget). */
export const expectedJudgeUsd = (): number => { const p = PRICES['gpt-6.1-sol']; return (JUDGE_INPUT_TOKENS_R3 * p.in + 800 * p.out) / 1e6; };
export const worstJudgeUsd = (): number => worstCaseUsd('gpt-6.1-sol', JUDGE_INPUT_TOKENS_R3, JUDGE_MAX_OUTPUT);

/** What one answer can cost at worst, as the ledger would reserve it (assumed ~12k input, 1.5k output). */
export const ASSUMED_INPUT_TOKENS = 12000;
export const ASSUMED_MAX_OUTPUT = 1500;
/** The judge's worst case: page + sheet images, transcript, a short structured answer (r2). */
export const JUDGE_INPUT_TOKENS = 6000;
/**
 * r3: page + up to 6 timeline frames + final + board (1152 px JPEGs, ~1k tokens each by the server's
 * estimate), the deck digest (~3k) and the transcript.
 */
export const JUDGE_INPUT_TOKENS_R3 = 16000;
/** The scout's worst case per answer (stage 1, gpt-6.1-terra): system + deck digest + visible listing + question. */
export const SCOUT_MODEL = 'gpt-6.1-terra';
export const SCOUT_INPUT_TOKENS = 8000;
/** The storyboard's worst case per answer (gpt-6.1-terra; the same grounding as the answer). Counted only when PETU_STORYBOARD=1. */
export const STORYBOARD_MODEL = 'gpt-6.1-terra';
const storyboardWorst = () => (process.env.PETU_STORYBOARD !== '1' ? 0 : worstCaseUsd(process.env.PETU_STORYBOARD_MODEL || STORYBOARD_MODEL, ASSUMED_INPUT_TOKENS, STORYBOARD_MAX_OUTPUT));

export function plannedWorstUsd(c: Config, answers: number, judged: number, rubric: 'r2' | 'r3' = 'r2'): number {
  return answers * (worstCaseUsd(c.model, ASSUMED_INPUT_TOKENS, ASSUMED_MAX_OUTPUT, !!c.fast) + worstCaseUsd(SCOUT_MODEL, SCOUT_INPUT_TOKENS, SCOUT_MAX_OUTPUT) + storyboardWorst()) +
    judged * worstCaseUsd('gpt-6.1-sol', rubric === 'r3' ? JUDGE_INPUT_TOKENS_R3 : JUDGE_INPUT_TOKENS, JUDGE_MAX_OUTPUT);
}
