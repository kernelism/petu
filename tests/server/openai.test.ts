// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ledger } from '../../server/ledger';
import { costUsd } from '../../server/prices';
import { ask, buildRequest, buildSystemPrewarm, estimateInputTokens, prewarm, prewarmSystem, judge, systemTokensLow, type ModelConfig, type Deps } from '../../server/openai';
import { CacheStats } from '../../server/cacheStats';
import { PROMPT_VERSION, systemPrompt } from '../../server/prompt/system';
import type { AskEvent, AskRequest, AskContext } from '../../src/agent/protocol';

const KEY = 'sk-test-SECRET-abc123';
const cfg: ModelConfig = { model: 'gpt-6.1-terra', effort: 'none', maxOutput: 1400, fast: false, explicitCache: true };
const context: AskContext = {
  docName: 'epipolar.pdf', docHash: 'abc', numPages: 5, page: 2,
  docText: 'DOC header', pageText: 'PAGE 2 lines', image: { b64: 'A'.repeat(4000), w: 1024, h: 768 },
};
const req = (over: Partial<AskRequest> = {}): AskRequest => ({ question: 'Why does disparity shrink?', history: [], context, ...over });

const sse = (o: object) => `event: x\ndata: ${JSON.stringify(o)}\n\n`;
const usage = { input_tokens: 9000, output_tokens: 700, input_tokens_details: { cached_tokens: 4500, cache_write_tokens: 4000 } };
const textEvents = (id: string, parts: string[]) => parts.map((d) => sse({ type: 'response.output_text.delta', item_id: id, delta: d }));
const okBody = (parts: string[]) => [
  sse({ type: 'response.output_item.added', item: { id: 'm1', type: 'message' } }),
  ...textEvents('m1', parts),
  sse({ type: 'response.completed', response: { status: 'completed', usage } }),
];

type Call = { url: string; init: RequestInit };
/** A fake fetch: each call takes the next scripted reply. Bodies stream one chunk per pull. */
function fakeFetch(replies: ({ status: number; text?: string } | { chunks: string[] })[]) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = replies.shift();
    if (!r) throw new Error('unexpected fetch');
    if ('status' in r) return new Response(r.text ?? '', { status: r.status });
    const signal = init.signal!;
    const enc = new TextEncoder();
    let i = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (signal.aborted) { c.error(new DOMException('aborted', 'AbortError')); return; }
        if (i < r.chunks.length) c.enqueue(enc.encode(r.chunks[i++]));
        else c.close();
      },
    }, { highWaterMark: 0 });
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

let dir = '';
let ledger: Ledger;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'openai-'));
  ledger = new Ledger(join(dir, 'spend.json'), { totalUsd: 40 });
});
const deps = (f: typeof fetch, over: Partial<Deps> = {}): Deps => ({ key: KEY, ledger, phase: 'dev', fetch: f, sleep: async () => {}, ...over });

async function run(r: AskRequest, d: Deps, onEmit?: (e: AskEvent, all: AskEvent[]) => void, signal = new AbortController().signal) {
  const out: AskEvent[] = [];
  await ask(r, cfg, d, (e) => { out.push(e); onEmit?.(e, out); }, signal);
  return out;
}
const texts = (out: AskEvent[]) => out.filter((e) => e.t === 'text').map((e) => (e as { d: string }).d).join('');

describe('buildRequest', () => {
  it('developer prompt first (12h), then page block + image (30m), then history, then the volatile tail with the question last', () => {
    const b = buildRequest(req({
      history: [{ q: 'q1', a: 'a1', page: 1 }],
      context: { ...context, searchText: 'HITS', ink: { summary: 'a circle', crop: { b64: 'BB', w: 64, h: 64 } } },
    }), cfg) as any;
    expect(b.input[0].role).toBe('developer');
    expect(b.input[0].content[0].prompt_cache_breakpoint).toEqual({ mode: 'explicit', ttl: '12h' });
    expect(b.input[1].content.map((c: any) => c.type)).toEqual(['input_text', 'input_text', 'input_image']);
    expect(b.input[1].content[0].text).toBe('DOC header');
    expect(b.input[1].content[1].text).toBe('PAGE 2 lines');
    expect(b.input[1].content[2].prompt_cache_breakpoint).toEqual({ mode: 'explicit', ttl: '30m' });
    expect(b.input[1].content[2].image_url).toMatch(/^data:image\/jpeg;base64,A+$/);
    expect(b.input[2]).toEqual({ role: 'user', content: [{ type: 'input_text', text: 'QUESTION (page 1): q1' }] });
    expect(b.input[3]).toEqual({ role: 'assistant', content: [{ type: 'output_text', text: 'a1' }] });
    const tail = b.input[4].content;
    expect(tail[0].text).toBe('HITS');
    expect(tail[1].text).toMatch(/^STUDENT INK on page 2: a circle/);
    expect(tail[2].type).toBe('input_image');
    expect(tail[tail.length - 1].text).toBe('QUESTION (the student is looking at page 2): Why does disparity shrink?');
    expect(b.input).toHaveLength(5);
    expect(b).toMatchObject({ model: 'gpt-6.1-terra', stream: true, store: false, max_output_tokens: 1400, reasoning: { effort: 'none' }, prompt_cache_key: `petu-${PROMPT_VERSION}`, prompt_cache_options: { mode: 'explicit' } });
    expect(b.service_tier).toBeUndefined();
  });
  it('implicit caching drops the breakpoint fields; fast and verbosity are opt-in', () => {
    const b = buildRequest(req(), { ...cfg, explicitCache: false, fast: true, verbosity: 'low' }) as any;
    expect(JSON.stringify(b)).not.toContain('prompt_cache_breakpoint');
    expect(b.prompt_cache_options).toBeUndefined();
    expect(b.prompt_cache_key).toBe(`petu-${PROMPT_VERSION}`);
    expect(b.service_tier).toBe('fast');
    expect(b.text).toEqual({ verbosity: 'low' });
  });
  it('prewarm: the cacheable prefix only, not streamed, prewarm flag set', () => {
    const b = buildRequest(req({ history: [{ q: 'q', a: 'a', page: 1 }] }), cfg, true) as any;
    expect(b.input).toHaveLength(2);
    expect(b.stream).toBe(false);
    expect(b.prompt_cache_options).toEqual({ mode: 'explicit', prewarm: true });
  });
});

describe('caching across documents', () => {
  it('the cache key is per prompt version, the same for every document, so the system block is shared', () => {
    const a = buildRequest(req(), cfg) as any;
    const b = buildRequest(req({ context: { ...context, docHash: 'other-doc', docText: 'OTHER', pageText: 'P' } }), cfg) as any;
    expect(a.prompt_cache_key).toBe(b.prompt_cache_key);
    expect(a.prompt_cache_key).not.toContain('abc');
    // The system block is byte-identical and ends at its own 12h breakpoint; the page block has a 30m one.
    expect(a.input[0]).toEqual(b.input[0]);
    expect(a.input[0].content).toHaveLength(1);
    expect(a.input[0].content[0].prompt_cache_breakpoint).toEqual({ mode: 'explicit', ttl: '12h' });
    expect(b.input[1].content.at(-1).prompt_cache_breakpoint).toEqual({ mode: 'explicit', ttl: '30m' });
    // ≤ 4 cache writes per request (OpenAI prompt-caching guide).
    expect(JSON.stringify(a).split('prompt_cache_breakpoint').length - 1).toBeLessThanOrEqual(4);
  });
  it('the system prewarm is the developer block alone, same key, prewarm flag, nothing streamed', () => {
    const p = buildSystemPrewarm(cfg) as any;
    const a = buildRequest(req(), cfg) as any;
    expect(p.input).toEqual([a.input[0]]);
    expect(p).toMatchObject({ prompt_cache_key: a.prompt_cache_key, stream: false, prompt_cache_options: { mode: 'explicit', prewarm: true }, model: cfg.model });
    expect(p.input[0].content[0].text).toBe(systemPrompt());
  });
  it('prewarmSystem posts once, then skips while the block is warm', async () => {
    const cache = new CacheStats(null);
    const { f, calls } = fakeFetch([{ status: 200, text: JSON.stringify({ usage: { input_tokens: 4100, output_tokens: 0, input_tokens_details: { cache_write_tokens: 4100 } } }) }]);
    const r1 = await prewarmSystem(cfg, deps(f, { cache }));
    expect(r1).toMatchObject({ ok: true });
    expect(r1.usd).toBeCloseTo((4100 * 2.5) / 1e6, 10);
    expect(JSON.parse(String(calls[0].init.body)).input).toHaveLength(1);
    expect(await prewarmSystem(cfg, deps(f, { cache }))).toEqual({ ok: true, usd: 0, reason: 'cached' });
    expect(calls).toHaveLength(1);
  });
});

describe('estimateInputTokens', () => {
  it('counts images by the 32-px patch rule × 1.2 and ignores base64 bytes', () => {
    const b = buildRequest(req(), cfg);
    const none = estimateInputTokens(b, []);
    const one = estimateInputTokens(b, [{ w: 1024, h: 768 }]);
    expect(one - none).toBeGreaterThanOrEqual(921);
    expect(one - none).toBeLessThanOrEqual(923);
    const big = buildRequest(req({ context: { ...context, image: { b64: 'A'.repeat(1_000_000), w: 1024, h: 768 } } }), cfg);
    expect(estimateInputTokens(big, [{ w: 1024, h: 768 }])).toBe(one);
  });
});

describe('ask', () => {
  it('a cap refusal emits error{code:cap} and never calls fetch', async () => {
    ledger = new Ledger(join(dir, 'capped.json'), { totalUsd: 0.001 });
    const { f, calls } = fakeFetch([]);
    const out = await run(req(), deps(f));
    expect(out).toEqual([expect.objectContaining({ t: 'error', code: 'cap', retryable: false })]);
    expect(calls).toHaveLength(0);
  });
  it('no key: no_key, never calls fetch', async () => {
    const { f, calls } = fakeFetch([]);
    const out = await run(req(), deps(f, { key: '' }));
    expect(out[0]).toMatchObject({ t: 'error', code: 'no_key' });
    expect(calls).toHaveLength(0);
  });
  it('a 429 before any text is retried once', async () => {
    const { f, calls } = fakeFetch([{ status: 429, text: 'slow down' }, { chunks: okBody(['Hi there.']) }]);
    const out = await run(req(), deps(f));
    expect(calls).toHaveLength(2);
    expect(texts(out)).toBe('Hi there.');
    expect(out[out.length - 1]).toMatchObject({ t: 'done' });
  });
  it('a 429 on the second try emits rate_limited and books nothing', async () => {
    const { f, calls } = fakeFetch([{ status: 429 }, { status: 429, text: 'still slow' }]);
    const out = await run(req(), deps(f));
    expect(calls).toHaveLength(2);
    expect(out[out.length - 1]).toMatchObject({ t: 'error', code: 'rate_limited', retryable: true });
    expect(ledger.summary().n).toBe(0);
    expect(ledger.reserve('probe', 'dev', 39.99)).toBeNull(); // the reservation was released
  });
  it('a 400 is not retried', async () => {
    const { f, calls } = fakeFetch([{ status: 400, text: 'bad' }]);
    const out = await run(req(), deps(f));
    expect(calls).toHaveLength(1);
    expect(out[out.length - 1]).toMatchObject({ t: 'error', code: 'bad_request', retryable: false });
  });
  it('an abort after 3 text events settles an estimated entry and aborts upstream', async () => {
    const { f, calls } = fakeFetch([{ chunks: okBody(['One. ', 'Two. ', 'Three. ', 'Four. ', 'Five. ']) }]);
    const ctl = new AbortController();
    const out = await run(req(), deps(f), (_e, all) => { if (all.filter((x) => x.t === 'text').length === 3) ctl.abort(); }, ctl.signal);
    expect(texts(out)).toBe('One. Two. Three. ');
    expect((calls[0].init.signal as AbortSignal).aborted).toBe(true);
    expect(out.some((e) => e.t === 'done' || e.t === 'error')).toBe(false);
    const file = JSON.parse(readFileSync(join(dir, 'spend.json'), 'utf8'));
    expect(file.entries).toHaveLength(1);
    expect(file.entries[0]).toMatchObject({ kind: 'answer', estimated: true, phase: 'dev' });
    expect(file.entries[0].usd).toBeGreaterThan(0);
  });
  it('an abort on a cached page books the cached share at the read rate (not all input as a 12h write)', async () => {
    const cache = new CacheStats(null);
    // The first answer on this page: 4100 system tokens cached, 3000 page tokens written.
    const first = { input_tokens: 7300, output_tokens: 300, input_tokens_details: { cached_tokens: 4100, cache_write_tokens: 3000, cache_write_tokens_details: { ttl_12h_tokens: 0, ttl_30m_tokens: 3000 } } };
    const chunks1 = [sse({ type: 'response.output_item.added', item: { id: 'm1', type: 'message' } }), ...textEvents('m1', ['Hi.']), sse({ type: 'response.completed', response: { usage: first } })];
    const { f } = fakeFetch([{ chunks: chunks1 }, { chunks: okBody(['One. ', 'Two. ', 'Three. ', 'Four.']) }, { chunks: okBody(['One. ', 'Two. ', 'Three. ', 'Four.']) }]);
    await run(req(), deps(f, { cache }));
    const ctl = new AbortController();
    await run(req(), deps(f, { cache }), (_e, all) => { if (all.filter((x) => x.t === 'text').length === 2) ctl.abort(); }, ctl.signal);
    const file = JSON.parse(readFileSync(join(dir, 'spend.json'), 'utf8'));
    const aborted = file.entries[1];
    expect(aborted).toMatchObject({ estimated: true });
    // What the last answer read + wrote (7100), capped at this request's input estimate.
    expect(aborted.tokens.cached).toBe(Math.min(7100, estimateInputTokens(buildRequest(req(), cfg), [context.image])));
    // The same abort with nothing known about the cache (another page, fresh stats) costs far more.
    const ctl2 = new AbortController();
    await run(req({ context: { ...context, docHash: 'zzz' } }), deps(f, { cache: new CacheStats(null) }), (_e, all) => { if (all.filter((x) => x.t === 'text').length === 2) ctl2.abort(); }, ctl2.signal);
    const cold = JSON.parse(readFileSync(join(dir, 'spend.json'), 'utf8')).entries[2];
    expect(cold.tokens.cached).toBe(0);
    expect(cold.usd / aborted.usd).toBeGreaterThan(3);
  });
  it('a new document reuses the system block: the abort estimate counts it as cached', async () => {
    const cache = new CacheStats(null);
    cache.observeSystem({ model: cfg.model, version: PROMPT_VERSION }, 4100);
    const { f } = fakeFetch([{ chunks: okBody(['One. ', 'Two. ', 'Three.']) }]);
    const ctl = new AbortController();
    await run(req({ context: { ...context, docHash: 'new-doc' } }), deps(f, { cache }), (_e, all) => { if (all.some((x) => x.t === 'text')) ctl.abort(); }, ctl.signal);
    const e = JSON.parse(readFileSync(join(dir, 'spend.json'), 'utf8')).entries[0];
    expect(e.tokens.cached).toBe(4100);
  });
  it('a request in flight is persisted with a cache-aware estimate until it settles', async () => {
    const cache = new CacheStats(null);
    cache.observeSystem({ model: cfg.model, version: PROMPT_VERSION }, 4100);
    const { f } = fakeFetch([{ chunks: okBody(['One. ', 'Two.']) }]);
    let open: any = null;
    await run(req(), deps(f, { cache }), () => { open ??= JSON.parse(readFileSync(join(dir, 'spend.json'), 'utf8')).open; });
    const [o] = Object.values(open) as any[];
    expect(o).toMatchObject({ pid: process.pid, kind: 'answer', model: cfg.model });
    expect(o.estUsd).toBeLessThan(o.worstUsd);
    expect(o.estUsd).toBeGreaterThan(0);
    expect(JSON.parse(readFileSync(join(dir, 'spend.json'), 'utf8')).open).toEqual({});
  });
  it('systemTokensLow is a lower bound on the system block', () => {
    expect(systemTokensLow()).toBeGreaterThan(1024);
    expect(systemTokensLow()).toBeLessThan(systemPrompt().length / 3);
  });
  it('streams the script once when a commentary message is followed by a final_answer duplicate', async () => {
    const chunks = [
      sse({ type: 'response.output_item.added', item: { id: 'r0', type: 'reasoning' } }),
      sse({ type: 'response.output_item.added', item: { id: 'm1', type: 'message', phase: 'commentary' } }),
      ...textEvents('m1', ['Disparity ', 'halves.']),
      sse({ type: 'response.output_item.added', item: { id: 'm2', type: 'message', phase: 'final_answer' } }),
      ...textEvents('m2', ['Disparity halves.']),
      sse({ type: 'response.completed', response: { status: 'completed', usage } }),
    ];
    const { f } = fakeFetch([{ chunks }]);
    const out = await run(req(), deps(f));
    expect(texts(out)).toBe('Disparity halves.');
    expect(out.filter((e) => e.t === 'note')).toHaveLength(1);
  });
  it('done.usd equals costUsd(usage); the ledger holds it; plan and lint ride on done', async () => {
    const { f } = fakeFetch([{ chunks: okBody(['{{scroll p=2}} Disparity ', 'halves.<plan>O=1,2</plan> Done.']) }]);
    const out = await run(req(), deps(f, { now: (() => { let t = 0; return () => (t += 10); })() }));
    const done = out[out.length - 1] as Extract<AskEvent, { t: 'done' }>;
    expect(out[0]).toMatchObject({ t: 'meta', model: 'gpt-6.1-terra', effort: 'none' });
    expect(texts(out)).toBe('{{scroll p=2}} Disparity halves. Done.');
    expect(done.t).toBe('done');
    expect(done.usd).toBeCloseTo(costUsd('gpt-6.1-terra', usage, '12h'), 10);
    expect(done.estimated).toBe(false);
    expect(done.plan).toBe('O=1,2');
    expect(done.ttftMs).toBeGreaterThan(0);
    expect(ledger.spent()).toBeCloseTo(done.usd, 10);
    expect(done.spentUsd).toBeCloseTo(done.usd, 10);
    expect(done.capUsd).toBe(40);
  });
  it('a stream that fails after text plays what arrived, then says cut_off', async () => {
    const chunks = [...okBody(['Part one. ']).slice(0, 2), sse({ type: 'response.failed', response: { error: { message: 'boom' } } })];
    const { f } = fakeFetch([{ chunks }]);
    const out = await run(req(), deps(f));
    expect(texts(out)).toBe('Part one. ');
    expect(out[out.length - 2]).toMatchObject({ t: 'done', estimated: true });
    expect(out[out.length - 1]).toMatchObject({ t: 'error', code: 'cut_off' });
  });
  it('the key never appears in any emitted event or ledger entry', async () => {
    const all: AskEvent[] = [];
    const sendsKey: string[] = [];
    for (const replies of [
      [{ status: 400, text: `invalid key ${KEY} given` }],
      [{ status: 500, text: KEY }, { status: 503, text: `x ${KEY} y ${KEY}` }],
      [{ chunks: okBody(['Fine.']) }],
    ] as Parameters<typeof fakeFetch>[0][]) {
      const { f, calls } = fakeFetch(replies);
      all.push(...(await run(req(), deps(f))));
      sendsKey.push(...calls.map((c) => String((c.init.headers as Record<string, string>).Authorization)));
    }
    expect(sendsKey.every((h) => h === `Bearer ${KEY}`)).toBe(true);
    expect(JSON.stringify(all)).not.toContain(KEY);
    expect(JSON.stringify(all)).toContain('***');
    expect(readFileSync(join(dir, 'spend.json'), 'utf8')).not.toContain(KEY);
  });
});

describe('prewarm', () => {
  it('books a prewarm entry from usage', async () => {
    const { f, calls } = fakeFetch([{ status: 200, text: JSON.stringify({ status: 'completed', usage: { input_tokens: 5000, output_tokens: 0, input_tokens_details: { cache_write_tokens: 5000 } } }) }]);
    const r = await prewarm(context, cfg, deps(f));
    expect(r.ok).toBe(true);
    expect(r.usd).toBeCloseTo((5000 * 2.5) / 1e6, 10);
    expect(JSON.parse(String(calls[0].init.body)).prompt_cache_options).toEqual({ mode: 'explicit', prewarm: true });
    expect(JSON.parse(readFileSync(join(dir, 'spend.json'), 'utf8')).entries[0]).toMatchObject({ kind: 'prewarm' });
  });
  it('is disabled without explicit caching and never calls fetch', async () => {
    const { f, calls } = fakeFetch([]);
    const r = await prewarm(context, { ...cfg, explicitCache: false }, deps(f));
    expect(r).toMatchObject({ ok: false });
    expect(calls).toHaveLength(0);
  });
});

describe('judge', () => {
  const body = {
    instructions: 'Score it.',
    content: [{ type: 'input_text' as const, text: 'Q' }, { type: 'input_image' as const, b64: 'CC', w: 1536, h: 864 }],
    schema: { type: 'object', properties: { score: { type: 'number' } }, required: ['score'], additionalProperties: false },
  };
  it('calls sol at low effort with a json_schema format and books a judge entry', async () => {
    const resp = { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"score":4}' }] }], usage: { input_tokens: 3000, output_tokens: 200 } };
    const { f, calls } = fakeFetch([{ status: 200, text: JSON.stringify(resp) }]);
    const r = await judge(body, deps(f));
    expect(r).toMatchObject({ ok: true, output: { score: 4 } });
    const sent = JSON.parse(String(calls[0].init.body));
    expect(sent).toMatchObject({ model: 'gpt-6.1-sol', reasoning: { effort: 'low' }, stream: false, store: false, text: { format: { type: 'json_schema', strict: true } } });
    expect(sent.input[1].content[1]).toMatchObject({ type: 'input_image', image_url: 'data:image/jpeg;base64,CC' });
    expect(JSON.parse(readFileSync(join(dir, 'spend.json'), 'utf8')).entries[0]).toMatchObject({ kind: 'judge', model: 'gpt-6.1-sol' });
  });
  it('a cap refusal never calls fetch', async () => {
    ledger = new Ledger(join(dir, 'capped.json'), { totalUsd: 0.0001 });
    const { f, calls } = fakeFetch([]);
    expect(await judge(body, deps(f))).toMatchObject({ ok: false, code: 'cap' });
    expect(calls).toHaveLength(0);
  });
});
