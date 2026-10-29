import { describe, it, expect } from 'vitest';
import { estimateFor, estimateInputTokens } from '../../server/openai';
import { toAnthropicRequest } from '../../server/anthropic';

// A founder report (2026-10-29): Opus answers were refused by a $3 daily cap with $2.85 left. The
// Anthropic body carries images as raw base64 in source.data (no data: URL), and the estimate counted
// those bytes as text — ~60k "tokens" per page image.
describe('input estimate for an Anthropic body', () => {
  const b64 = 'A'.repeat(200_000);
  const oa = {
    model: 'claude-opus-5-5', max_output_tokens: 3200, reasoning: { effort: 'low' },
    input: [
      { role: 'developer', content: [{ type: 'input_text', text: 'system prompt' }] },
      { role: 'user', content: [{ type: 'input_text', text: 'page listing' }, { type: 'input_image', image_url: `data:image/jpeg;base64,${b64}` }] },
    ],
  };
  const images = [{ w: 1024, h: 1400 }];
  it('does not count image bytes as text', () => {
    const ant = toAnthropicRequest(oa as never, { model: 'claude-opus-5-5', effort: 'low', maxOutput: 3200 } as never);
    const ep = { anthropic: true } as never;
    const openai = estimateInputTokens(oa as never, images);
    const claude = estimateFor(ep, ant, images);
    expect(openai).toBeLessThan(2_000);
    expect(claude).toBeLessThan(2 * openai);
  });
});
