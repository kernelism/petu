// server/prices.ts
/**
 * USD per 1M tokens, Standard tier, short context (developers.openai.com/api/docs/pricing, checked
 * 2026-10-28). `write30m`/`write12h`: explicit cache writes (they replace the input rate for those
 * tokens). Re-check before the iteration phase; a wrong price here is a wrong ledger.
 */
export type Price = { in: number; cached: number; out: number; write30m: number; write12h: number;
  /** A higher price for requests whose whole prompt (cache reads and writes included) is over `above` tokens. */
  long?: { above: number; price: Omit<Price, 'long'> } };
export const PRICES: Record<string, Price> = {
  'gpt-6-luna': { in: 0.10, cached: 0.01, out: 0.50, write30m: 0.125, write12h: 0.25 },
  'gpt-6.1-terra': { in: 1.00, cached: 0.05, out: 5.00, write30m: 1.25, write12h: 2.50 },
  'gpt-6.1-sol': { in: 2.00, cached: 0.10, out: 10.00, write30m: 2.50, write12h: 5.00 },
  'gpt-6-astra': { in: 10.00, cached: 1.00, out: 50.00, write30m: 12.50, write12h: 25.00 },
  /*
   * Anthropic (Messages API; server/anthropic.ts), USD per 1M tokens from Anthropic's official pricing
   * page https://platform.claude.com/docs/en/about-claude/pricing (fetched 2026-10-28). Columns map as
   * `cached` = "Cache hits and refreshes", `write30m` = "5m cache writes" (petu's 30m breakpoints become
   * 5-minute ephemeral breakpoints), `write12h` = "1h cache writes" (the 12h system block becomes ttl 1h).
   * Claude Haiku 5.5 is priced by prompt length: over 100,000 prompt tokens the whole request pays the
   * higher row. Opus 5.5 and Sonnet 5.5 cache hits are below the usual 0.1x (footnote 2 on that page).
   */
  'claude-opus-5-5': { in: 4.00, cached: 0.20, out: 20.00, write30m: 5.00, write12h: 8.00 },
  'claude-sonnet-5-5': { in: 2.00, cached: 0.10, out: 10.00, write30m: 2.50, write12h: 4.00 },
  'claude-haiku-5-5': { in: 0.10, cached: 0.01, out: 0.50, write30m: 0.125, write12h: 0.20,
    long: { above: 100_000, price: { in: 0.50, cached: 0.05, out: 2.50, write30m: 0.625, write12h: 1.00 } } },
};

/**
 * Realtime models (server/voice.ts reads one as the narration's voice), USD per 1M tokens from
 * developers.openai.com/api/docs/models/gpt-realtime-2.1-mini (checked 2026-10-30). `out` is text
 * output (the transcript and any reasoning), `audioOut` the spoken audio.
 */
export const REALTIME_PRICES = {
  'gpt-realtime-2.1-mini': { in: 0.60, cached: 0.06, out: 2.40, audioOut: 20.00 },
} as const;

/** The price row a request of `promptTokens` pays (Haiku 5.5's long-prompt tier). */
export function priceFor(model: string, promptTokens: number): Omit<Price, 'long'> {
  const p = PRICES[model];
  if (!p) throw new Error(`no price for model ${model}`);
  return p.long && promptTokens > p.long.above ? p.long.price : p;
}

export type Usage = {
  input_tokens: number;
  output_tokens: number;
  input_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number; cache_write_tokens_details?: { ttl_12h_tokens?: number; ttl_30m_tokens?: number } };
  output_tokens_details?: { reasoning_tokens?: number };
};

/** Cost of one response from its usage. Unknown models throw (the ledger must never guess low). */
export function costUsd(model: string, u: Usage, writeTtl: '30m' | '12h' = '12h', fast = false): number {
  const p = priceFor(model, u.input_tokens);
  const cached = u.input_tokens_details?.cached_tokens ?? 0;
  const written = u.input_tokens_details?.cache_write_tokens ?? 0;
  const plain = Math.max(0, u.input_tokens - cached - written);
  // Writes are billed at their TTL's rate: by the reported split when usage has one, else all at `writeTtl`.
  const split = u.input_tokens_details?.cache_write_tokens_details;
  const w12 = split ? split.ttl_12h_tokens ?? 0 : writeTtl === '12h' ? written : 0;
  const w30 = split ? Math.max(0, written - w12) : written - w12;
  const usd = (plain * p.in + cached * p.cached + w12 * p.write12h + w30 * p.write30m + u.output_tokens * p.out) / 1e6;
  return fast ? usd * 2 : usd;
}

/** Worst case before sending: every input token written at the 12h rate, the full output budget. */
export function worstCaseUsd(model: string, inputTokens: number, maxOutput: number, fast = false): number {
  const p = priceFor(model, inputTokens);
  const usd = (inputTokens * p.write12h + maxOutput * p.out) / 1e6;
  return fast ? usd * 2 : usd;
}
