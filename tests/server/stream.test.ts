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

describe('ResponseEvents: which message is the script', () => {
  const run = (evs: object[]) => { const r = new ResponseEvents(); return evs.flatMap((e) => r.handle(e)); };
  const text = (out: { t: string }[]) => out.filter((x) => x.t === 'text').map((x) => (x as unknown as { d: string }).d).join('');
  it('prefers a final_answer item over a commentary item that has not streamed any text yet', () => {
    const out = run([
      { type: 'response.output_item.added', item: { id: 'c1', type: 'message', phase: 'commentary' } },
      { type: 'response.output_item.added', item: { id: 'f1', type: 'message', phase: 'final_answer' } },
      { type: 'response.output_text.delta', item_id: 'c1', delta: 'Let me look.' },
      { type: 'response.output_text.delta', item_id: 'f1', delta: 'The answer.' },
      { type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 1, output_tokens: 1 } } },
    ]);
    expect(text(out)).toBe('The answer.');
    expect(out.some((x) => x.t === 'note')).toBe(true);
  });
  it('keeps the commentary item once its text has started', () => {
    const out = run([
      { type: 'response.output_item.added', item: { id: 'c1', type: 'message', phase: 'commentary' } },
      { type: 'response.output_text.delta', item_id: 'c1', delta: 'Started.' },
      { type: 'response.output_item.added', item: { id: 'f1', type: 'message', phase: 'final_answer' } },
      { type: 'response.output_text.delta', item_id: 'f1', delta: 'Again.' },
    ]);
    expect(text(out)).toBe('Started.');
  });
  it('marks completed and incomplete responses', () => {
    expect(run([{ type: 'response.completed', response: { usage: { input_tokens: 1, output_tokens: 1 } } }]).at(-1)).toMatchObject({ t: 'usage', complete: true });
    expect(run([{ type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' }, usage: { input_tokens: 1, output_tokens: 1 } } }]).at(-1)).toMatchObject({ t: 'usage', complete: false });
  });
});

describe('ScriptFilter: bounded tags and plans', () => {
  const run = (s: string, step: number) => {
    const f = new ScriptFilter();
    let out = '';
    for (let i = 0; i < s.length; i += step) out += f.push(s.slice(i, i + step));
    return { out: out + f.end(), plan: f.plan };
  };
  it('a {{ with a newline before }} is not a tag: narration after it is cleaned again', () => {
    const s = 'Set {{ not a tag\nThen **bold** and \\(x\\). {{scroll p=1}} end.';
    for (const step of [1, 2, 3, 7, 100]) expect(run(s, step).out, String(step)).toBe('Set {{ not a tag\nThen bold and x. {{scroll p=1}} end.');
  });
  it('a {{ with no }} within 800 characters is not a tag', () => {
    const s = `A {{ ${'y'.repeat(850)} then **b** {{scroll p=1}} z.`;
    for (const step of [1, 5, 64, 1000]) {
      const out = run(s, step).out;
      expect(out, String(step)).toContain(' then b {{scroll p=1}} z.');
    }
  });
  it('an unclosed <plan> ends at a blank line, the next {{, or 1,500 characters; the answer survives', () => {
    for (const step of [1, 3, 9, 2000]) {
      const a = run('First. <plan>O=1,2 X=3,4\n\nSecond sentence.', step);
      expect(a.plan, `blank ${step}`).toBe('O=1,2 X=3,4');
      expect(a.out).toBe('First. Second sentence.');
      const b = run('First. <plan>O=1,2 {{sketch id=s near=p1 fit}} Next.', step);
      expect(b.plan, `tag ${step}`).toBe('O=1,2 ');
      expect(b.out).toBe('First. {{sketch id=s near=p1 fit}} Next.');
      const c = run(`First. <plan>${'p'.repeat(1600)}`, step);
      expect(c.plan.length, `cap ${step}`).toBe(1500);
      expect(c.out.startsWith('First. ')).toBe(true);
      expect(c.out.length).toBeLessThan(7 + 120);
    }
  });
  it('a closed plan still works and stays out of the captions', () => {
    const r = run('First. <plan>A=1,1\nB=2,2</plan> Second.', 4);
    expect(r).toEqual({ out: 'First.  Second.', plan: 'A=1,1\nB=2,2' });
  });
});
