// server/anthropic.ts — the Anthropic Messages API as a second stage-2 provider (PETU_MODEL=claude-…).
//
// Raw HTTP over the deps' `fetch`, like server/openai.ts (one code path, mocked in tests, no SDK).
// Shapes from Anthropic's docs (platform.claude.com/docs, read 2026-10-28; no calls made):
//  - POST https://api.anthropic.com/v1/messages, headers `x-api-key`, `anthropic-version: 2023-06-01`.
//    Body: `model`, `max_tokens`, `system` (text blocks), `messages` (user/assistant; consecutive
//    same-role messages are merged by the API), `stream`.
//  - Content: `{type:'text', text}`, `{type:'image', source:{type:'base64', media_type:'image/jpeg', data}}`.
//  - Prompt caching: `cache_control: {type:'ephemeral'}` (5 minutes) or `{…, ttl:'1h'}` on a block; ≤ 4
//    breakpoints; longer TTLs must come before shorter ones. petu's breakpoints map one to one onto the
//    same blocks: the system prompt's 12h → 1h, every 30m (digest, page image, MEMORY) → 5m.
//  - Thinking/effort: `thinking: {type:'adaptive'}` + `output_config: {effort}`. Claude Opus 5.5 cannot
//    turn thinking off (400 at every effort), so petu effort `none` is refused for it (server/env.ts).
//    Claude Sonnet 5.5 turns it off with `thinking: {type:'between_tools'}`; Claude Haiku 5.5 with
//    `{type:'disabled'}` (both only at effort high or below: the default is left alone).
//  - Streaming SSE: `message_start` (message.usage), `content_block_delta` (`text_delta` | `thinking_delta`
//    | …), `message_delta` (delta.stop_reason, cumulative usage), `message_stop`, `ping`, `error`.
//  - Usage: `input_tokens` (uncached only), `cache_creation_input_tokens`, `cache_read_input_tokens`,
//    `cache_creation.{ephemeral_5m_input_tokens, ephemeral_1h_input_tokens}`, `output_tokens` (thinking
//    included). Normalised here to the OpenAI-shaped `Usage` that server/prices.ts prices.
//  - Pre-warming: the same prefix with `max_tokens: 0`, not streamed (rejected with stream: true).
//
// No server-side refusal fallback is requested: a benchmark answer must come from the model it names.
// A `refusal` stop ends the answer as cut short (`complete: false`).
//
// Secrets: the key (PETU_ANTHROPIC_KEY or ANTHROPIC_API_KEY from the .env file only, read in server/env.ts)
// is used only in the header below.
import type { Usage } from './prices';
import type { Upstream } from './sse';
import type { Effort } from './openai';

export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';
export const isAnthropicModel = (model: string): boolean => model.startsWith('claude-');
export const anthropicHeaders = (key: string) => ({ 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION, 'content-type': 'application/json' });
/** What a missing key says (the answer stops; no request is sent). */
export const NO_ANTHROPIC_KEY = 'PETU_MODEL is a Claude model but no Anthropic key was found: put PETU_ANTHROPIC_KEY (or ANTHROPIC_API_KEY) in .env and restart. Only the .env file is read for it; a key exported in the shell is ignored.';

/** Models whose thinking cannot be turned off (petu effort `none` is refused). */
export const ANTHROPIC_NO_NONE = new Set(['claude-opus-5-5']);

/** `thinking` / `output_config` for a petu effort. */
export function thinkingFor(model: string, effort: Effort): Record<string, unknown> {
  if (effort === 'none') {
    if (ANTHROPIC_NO_NONE.has(model)) throw new Error(`${model} cannot run with thinking off; use effort low`);
    return { thinking: { type: model.startsWith('claude-sonnet') ? 'between_tools' : 'disabled' } };
  }
  return { thinking: { type: 'adaptive' }, output_config: { effort } };
}

type OaPart = { type: string; text?: string; image_url?: string; prompt_cache_breakpoint?: { ttl: string } };
type OaMsg = { role: string; content: OaPart[] };

const cacheOf = (p: OaPart) => (p.prompt_cache_breakpoint ? { cache_control: p.prompt_cache_breakpoint.ttl === '12h' ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' } } : {});
function part(p: OaPart): Record<string, unknown> {
  if (p.type === 'input_image') {
    const m = /^data:([^;]+);base64,(.*)$/s.exec(p.image_url ?? '');
    return { type: 'image', source: { type: 'base64', media_type: m?.[1] ?? 'image/jpeg', data: m?.[2] ?? '' }, ...cacheOf(p) };
  }
  return { type: 'text', text: p.text ?? '', ...cacheOf(p) };
}

/**
 * The Messages API body for an OpenAI Responses body built by `buildRequest` / `buildSystemPrewarm`:
 * the developer message becomes `system`, every other message keeps its role and its blocks in order,
 * and each cache breakpoint stays on the same block. One layout, two providers: a change to the
 * request layout in openai.ts carries over here unchanged.
 */
export function toAnthropicRequest(oa: { input: OaMsg[]; stream?: boolean }, cfg: { model: string; effort: Effort; maxOutput: number }, prewarm = false) {
  const system = oa.input.filter((m) => m.role === 'developer' || m.role === 'system').flatMap((m) => m.content.map(part));
  const messages = oa.input.filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => ({ role: m.role, content: m.content.map(part) }));
  // A system-only prewarm has no message: the API needs one; a fixed one-word user turn after the cached system block.
  if (!messages.length) messages.push({ role: 'user', content: [{ type: 'text', text: '.' }] });
  return {
    model: cfg.model,
    max_tokens: prewarm ? 0 : cfg.maxOutput,
    system,
    messages,
    ...thinkingFor(cfg.model, cfg.effort),
    ...(prewarm ? {} : { stream: oa.stream !== false }),
  };
}

/** For the token estimate (openai.ts estimateInputTokens reads `input`). */
export const anthropicInput = (b: { system: unknown; messages: unknown }) => ({ input: [b.system, b.messages] });

export type AnthropicUsage = {
  input_tokens?: number; output_tokens?: number;
  cache_creation_input_tokens?: number; cache_read_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
};

/** Anthropic usage → petu's Usage (input_tokens = the whole prompt; cached = reads; writes split by TTL). */
export function normalizeUsage(u: AnthropicUsage): Usage {
  const read = u.cache_read_input_tokens ?? 0, write = u.cache_creation_input_tokens ?? 0;
  const split = u.cache_creation;
  return {
    input_tokens: (u.input_tokens ?? 0) + read + write,
    output_tokens: u.output_tokens ?? 0,
    input_tokens_details: {
      cached_tokens: read, cache_write_tokens: write,
      ...(split ? { cache_write_tokens_details: { ttl_12h_tokens: split.ephemeral_1h_input_tokens ?? 0, ttl_30m_tokens: split.ephemeral_5m_input_tokens ?? 0 } } : {}),
    },
  };
}

/** Messages API stream events → petu's Upstream (text deltas only; thinking is billed, never spoken). */
export class AnthropicEvents {
  private usage: AnthropicUsage = {};
  private stop: string | null = null;
  private thinkingChars = 0;
  handle(e: any): Upstream[] {
    switch (e?.type) {
      case 'message_start':
        this.usage = { ...(e.message?.usage ?? {}) };
        return [];
      case 'content_block_delta': {
        const d = e.delta;
        if (d?.type === 'text_delta') { const s = String(d.text ?? ''); return s ? [{ t: 'text', d: s }] : []; }
        if (d?.type === 'thinking_delta') this.thinkingChars += String(d.thinking ?? '').length;
        return [];
      }
      case 'message_delta':
        if (e.delta?.stop_reason) this.stop = e.delta.stop_reason;
        // Usage here is cumulative: later fields replace earlier ones.
        for (const [k, v] of Object.entries(e.usage ?? {})) if (v != null) (this.usage as Record<string, unknown>)[k] = v;
        return [];
      case 'message_stop': {
        const stop = this.stop ?? 'end_turn';
        return [{ t: 'usage', usage: normalizeUsage(this.usage), status: stop, complete: stop === 'end_turn' || stop === 'stop_sequence' }];
      }
      case 'error':
        return [{ t: 'error', message: e.error?.message ?? e.message ?? 'stream error' }];
      default:
        return [];
    }
  }
}
