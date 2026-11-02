// server/quality.ts — Settings → Answer quality: the browser sends a choice token, never a model name.
//   'standard' (or absent) → the server's answer model (PETU_MODEL / PETU_EFFORT; default gpt-6.1-terra, effort none)
//   'best'                 → claude-opus-5-5 at effort low (null without an Anthropic key in .env)
// Anything else is refused (400). Both go through the same ledger, caps and repairs as any answer.
import { ANSWER_QUALITIES, type AnswerQuality } from '../src/agent/protocol';
import type { Effort, ModelConfig } from './openai';

/**
 * 2026-10-30 model sweep (SVG board p6.1; spec 2026-10-30-anchored-lane-design "Model choice
 * evidence"): Opus-low drew the best boards and judged 3.80 on the held-out set; it is the opt-in.
 * Opus cannot turn thinking off, so low is its floor (its repairs run at low too: server/repair.ts).
 */
export const BEST_MODEL = 'claude-opus-5-5';
export const BEST_EFFORT: Effort = 'low';

export const isQuality = (q: unknown): q is AnswerQuality => (ANSWER_QUALITIES as readonly unknown[]).includes(q);

/** Best's config: the standard one's (cache) on the best model, with a reasoning budget. */
export const bestConfig = (standard: ModelConfig, maxOutput: number): ModelConfig => ({ ...standard, model: BEST_MODEL, effort: BEST_EFFORT, maxOutput });

/** The answer config for a request's `quality`, or why it is refused. */
export function answerConfig(env: { model: ModelConfig; best: ModelConfig | null }, quality: unknown): { cfg: ModelConfig } | { error: string } {
  if (quality == null || quality === 'standard') return { cfg: env.model };
  if (quality !== 'best') return { error: `quality must be one of ${ANSWER_QUALITIES.join(' | ')}` };
  if (!env.best) return { error: 'Best quality needs PETU_ANTHROPIC_KEY in .env (restart npm run dev).' };
  return { cfg: env.best };
}
