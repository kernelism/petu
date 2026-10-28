// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { SseParser, ResponseEvents } from '../../server/sse';
import { ScriptFilter } from '../../server/scriptFilter';

const sse = (o: object) => `event: x\ndata: ${JSON.stringify(o)}\n\n`;

describe('SseParser + ResponseEvents', () => {
  it('streams the first message and drops a later commentary/final duplicate', () => {
    const raw = [
      sse({ type: 'response.output_item.added', item: { id: 'm1', type: 'message', phase: 'commentary' } }),
      sse({ type: 'response.output_text.delta', item_id: 'm1', delta: 'Hello ' }),
      sse({ type: 'response.output_text.delta', item_id: 'm1', delta: 'there.' }),
      sse({ type: 'response.output_item.added', item: { id: 'm2', type: 'message', phase: 'final_answer' } }),
      sse({ type: 'response.output_text.delta', item_id: 'm2', delta: 'Hello there.' }),
      sse({ type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 10, output_tokens: 4 } } }),
      'data: [DONE]\n\n',
    ].join('');
    const p = new SseParser(), r = new ResponseEvents();
    const out = [];
    for (let i = 0; i < raw.length; i += 7) for (const e of p.push(raw.slice(i, i + 7))) out.push(...r.handle(e));
    expect(out.filter((x) => x.t === 'text').map((x) => (x as { d: string }).d).join('')).toBe('Hello there.');
    expect(out.some((x) => x.t === 'note')).toBe(true);
    expect(out[out.length - 1]).toMatchObject({ t: 'usage', status: 'completed' });
  });
});

describe('ScriptFilter', () => {
  const run = (s: string, step: number) => {
    const f = new ScriptFilter();
    let out = '';
    for (let i = 0; i < s.length; i += step) out += f.push(s.slice(i, i + step));
    return { out: out + f.end(), plan: f.plan };
  };
  it('removes the plan and markdown at any chunking; leaves tags intact', () => {
    const s = '{{scroll p=4}} **Disparity** halves. <plan>O=300,600 X=500,300</plan>{{math on=s at=1,1 "\\frac{B f}{z}"}} So \\(d\\) halves.';
    for (const step of [1, 2, 3, 5, 8, 100]) {
      const r = run(s, step);
      expect(r.out, String(step)).toBe('{{scroll p=4}} Disparity halves. {{math on=s at=1,1 "\\frac{B f}{z}"}} So d halves.');
      expect(r.plan).toBe('O=300,600 X=500,300');
    }
  });
});
