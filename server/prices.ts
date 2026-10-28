// server/prices.ts
/**
 * USD per 1M tokens, Standard tier, short context (developers.openai.com/api/docs/pricing, checked
 * 2026-10-28). `write30m`/`write12h`: explicit cache writes (they replace the input rate for those
 * tokens). Re-check before the iteration phase; a wrong price here is a wrong ledger.
 */
export type Price = { in: number; cached: number; out: number; write30m: number; write12h: number };
export const PRICES: Record<string, Price> = {
  'gpt-6-luna': { in: 0.10, cached: 0.01, out: 0.50, write30m: 0.125, write12h: 0.25 },
  'gpt-6.1-terra': { in: 1.00, cached: 0.05, out: 5.00, write30m: 1.25, write12h: 2.50 },
  'gpt-6.1-sol': { in: 2.00, cached: 0.10, out: 10.00, write30m: 2.50, write12h: 5.00 },
  'gpt-6-astra': { in: 10.00, cached: 1.00, out: 50.00, write30m: 12.50, write12h: 25.00 },
};

export type Usage = {
  input_tokens: number;
  output_tokens: number;
  input_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
  output_tokens_details?: { reasoning_tokens?: number };
};

/** Cost of one response from its usage. Unknown models throw (the ledger must never guess low). */
export function costUsd(model: string, u: Usage, writeTtl: '30m' | '12h' = '12h', fast = false): number {
  const p = PRICES[model];
  if (!p) throw new Error(`no price for model ${model}`);
  const cached = u.input_tokens_details?.cached_tokens ?? 0;
  const written = u.input_tokens_details?.cache_write_tokens ?? 0;
  const plain = Math.max(0, u.input_tokens - cached - written);
  // Writes are billed at the TTL's rate; we don't know the split per breakpoint, so the dearer one.
  const w = writeTtl === '12h' ? p.write12h : p.write30m;
  const usd = (plain * p.in + cached * p.cached + written * w + u.output_tokens * p.out) / 1e6;
  return fast ? usd * 2 : usd;
}

/** Worst case before sending: every input token written at the 12h rate, the full output budget. */
export function worstCaseUsd(model: string, inputTokens: number, maxOutput: number, fast = false): number {
  const p = PRICES[model];
  if (!p) throw new Error(`no price for model ${model}`);
  const usd = (inputTokens * p.write12h + maxOutput * p.out) / 1e6;
  return fast ? usd * 2 : usd;
}
