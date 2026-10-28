// scripts/eval/configs.ts — named model configs. Each sets env for the dev server the runner starts.
import { worstCaseUsd } from '../../server/prices.ts';

export type Config = {
  name: string;
  model: string;
  effort: 'none' | 'low' | 'medium';
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
  'sol-low': { name: 'sol-low', model: 'gpt-6.1-sol', effort: 'low' },
  'astra-low': { name: 'astra-low', model: 'gpt-6-astra', effort: 'low', only: D1_6 },
  'terra-none-fast': { name: 'terra-none-fast', model: 'gpt-6.1-terra', effort: 'none', fast: true, only: TEN, judge: false },
  'terra-none-verbosity-low': { name: 'terra-none-verbosity-low', model: 'gpt-6.1-terra', effort: 'none', verbosity: 'low' },
};

export function configEnv(c: Config, phase: string): Record<string, string> {
  const env: Record<string, string> = { PETU_MODEL: c.model, PETU_EFFORT: c.effort, PETU_PHASE: phase, PETU_FAST: c.fast ? '1' : '0' };
  if (c.verbosity) env.PETU_VERBOSITY = c.verbosity;
  return env;
}

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
/** The server's judge max_output_tokens (server/openai.ts JUDGE_MAX_OUTPUT). */
export const JUDGE_MAX_OUTPUT = 800;

export function plannedWorstUsd(c: Config, answers: number, judged: number, rubric: 'r2' | 'r3' = 'r2'): number {
  return answers * worstCaseUsd(c.model, ASSUMED_INPUT_TOKENS, ASSUMED_MAX_OUTPUT, !!c.fast) +
    judged * worstCaseUsd('gpt-6.1-sol', rubric === 'r3' ? JUDGE_INPUT_TOKENS_R3 : JUDGE_INPUT_TOKENS, JUDGE_MAX_OUTPUT);
}
