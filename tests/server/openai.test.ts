// @vitest-environment node
import { parseScout } from '../../src/agent/scout';
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ledger } from '../../server/ledger';
import { costUsd } from '../../server/prices';
import { type AnswerRecord, ask, askImages, buildRequest, buildScoutRequest, buildSystemPrewarm, estimateInputTokens, openerNote, relationNote, prewarm, prewarmScout, prewarmSystem, judge, scoutStream, scoutCacheKey, systemTokensLow, type ModelConfig, type Deps } from '../../server/openai';
import { SCOUT_SYSTEM } from '../../server/prompt/scout';
import type { ScoutEvent } from '../../src/agent/scout';
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

describe('follow-ups: MEMORY and RELATION', () => {
  it('MEMORY is its own message after the page block, cached at its end (30m), before history; the relation note follows the PLAN', () => {
    const b = buildRequest(req({ history: [{ q: 'q', a: 'a', page: 1 }], context: { ...context, memory: 'MEMORY\nA1 …', scout: { pages: [2], plan: 'walk', relation: 'simplify' } } }), cfg) as any;
    expect(b.input[2]).toEqual({ role: 'user', content: [{ type: 'input_text', text: 'MEMORY\nA1 …', prompt_cache_breakpoint: { mode: 'explicit', ttl: '30m' } }] });
    expect(b.input[3].content[0].text).toBe('QUESTION (page 1): q');
    const bps = JSON.stringify(b.input).match(/prompt_cache_breakpoint/g) ?? [];
    expect(bps.length).toBeLessThanOrEqual(4);
    const tail = b.input.at(-1).content.map((c: any) => c.text ?? '');
    const plan = tail.findIndex((t: string) => t.startsWith('PLAN'));
    expect(tail[plan + 1]).toBe(relationNote('simplify'));
    expect(relationNote('simplify')).toMatch(/fresh board section/);
    expect(relationNote('simplify')).toMatch(/everyday comparison mapped part for part/);
    expect(relationNote('continue')).not.toMatch(/fresh board section/);
  });
  it('no memory, no relation note; prewarm never carries memory', () => {
    const b = buildRequest(req({ context: { ...context, scout: { pages: [2], plan: 'walk', relation: 'simplify' } } }), cfg) as any;
    expect(JSON.stringify(b.input.at(-1))).not.toContain('RELATION to your previous answer');
    const w = buildRequest(req({ context: { ...context, memory: 'MEMORY' } }), cfg, true) as any;
    expect(w.input).toHaveLength(2);
  });
  it('the scout reads the relation first and passes it on', () => {
    expect(parseScout('{"relation":"new-example","opener":"x","pages":[2],"find":[],"plan":"p"}', 5, 1)).toEqual({ pages: [2], plan: 'p', relation: 'new-example' });
    expect(parseScout('{"relation":"eli5","pages":[2],"plan":"p"}', 5, 1)).toEqual({ pages: [2], plan: 'p' });
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
    // The first answer on this page: 8300 system tokens cached, 3000 page tokens written.
    const first = { input_tokens: 11500, output_tokens: 300, input_tokens_details: { cached_tokens: 8300, cache_write_tokens: 3000, cache_write_tokens_details: { ttl_12h_tokens: 0, ttl_30m_tokens: 3000 } } };
    const chunks1 = [sse({ type: 'response.output_item.added', item: { id: 'm1', type: 'message' } }), ...textEvents('m1', ['Hi.']), sse({ type: 'response.completed', response: { usage: first } })];
    const { f } = fakeFetch([{ chunks: chunks1 }, { chunks: okBody(['One. ', 'Two. ', 'Three. ', 'Four.']) }, { chunks: okBody(['One. ', 'Two. ', 'Three. ', 'Four.']) }]);
    await run(req(), deps(f, { cache }));
    const ctl = new AbortController();
    await run(req(), deps(f, { cache }), (_e, all) => { if (all.filter((x) => x.t === 'text').length === 2) ctl.abort(); }, ctl.signal);
    const file = JSON.parse(readFileSync(join(dir, 'spend.json'), 'utf8'));
    const aborted = file.entries[1];
    expect(aborted).toMatchObject({ estimated: true });
    // What the last answer read + wrote (11300), capped at this request's input estimate.
    expect(aborted.tokens.cached).toBe(Math.min(11300, estimateInputTokens(buildRequest(req(), cfg), [context.image])));
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
  it('keeps an answer record: question, page, the script as sent, and a malformed tag with its raw text', async () => {
    const chunks = [
      sse({ type: 'response.output_item.added', item: { id: 'm1', type: 'message', phase: 'final_answer' } }),
      ...textEvents('m1', ['Look {{grid on=s id=g ', 'vals=1,2;3}} here.']),
      sse({ type: 'response.completed', response: { status: 'completed', usage } }),
    ];
    const { f } = fakeFetch([{ chunks }]);
    const recs: AnswerRecord[] = [];
    await run(req(), deps(f, { log: (r) => recs.push(r) }));
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ question: 'Why does disparity shrink?', page: 2, script: 'Look {{grid on=s id=g vals=1,2;3}} here.', lint: ['malformed (dropped): {{grid on=s id=g vals=1,2;3}}'] });
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

// ---- timeouts, incomplete streams, booking of failed attempts -------------------------------

/** A fetch whose replies can hang: 'hang' never answers (until aborted); { chunks, hang } streams then stalls. */
function hangFetch(replies: ('hang' | { chunks: string[]; hang?: boolean } | { status: number; text?: string })[]) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = replies.shift();
    if (!r) throw new Error('unexpected fetch');
    const signal = init.signal!;
    const aborted = () => new DOMException('aborted', 'AbortError');
    if (r === 'hang') return new Promise((_ok, bad) => { if (signal.aborted) bad(aborted()); signal.addEventListener('abort', () => bad(aborted())); });
    if ('status' in r) return new Response(r.text ?? '', { status: r.status });
    const enc = new TextEncoder();
    let i = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (i < r.chunks.length) { c.enqueue(enc.encode(r.chunks[i++])); return; }
        if (!r.hang) { c.close(); return; }
        return new Promise<void>((ok) => { const stop = () => { c.error(aborted()); ok(); }; if (signal.aborted) stop(); else signal.addEventListener('abort', stop); });
      },
    }, { highWaterMark: 0 });
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const fast = { headersMs: 30, idleMs: 30, callMs: 30 };
const entries = () => JSON.parse(readFileSync(join(dir, 'spend.json'), 'utf8')).entries as any[];

describe('ask: upstream timeouts', () => {
  it('no response headers within the timeout: retried once (before any text), the stalled attempt is booked', async () => {
    const { f, calls } = hangFetch(['hang', { chunks: okBody(['Hi there.']) }]);
    const out = await run(req(), deps(f, { timeouts: fast }));
    expect(calls).toHaveLength(2);
    expect((calls[0].init.signal as AbortSignal).aborted).toBe(true);
    expect(texts(out)).toBe('Hi there.');
    expect(out[out.length - 1]).toMatchObject({ t: 'done', estimated: false });
    // attempt 0 may have reached OpenAI: booked as an estimate next to the real answer
    expect(entries()).toEqual([expect.objectContaining({ estimated: true, kind: 'answer' }), expect.objectContaining({ estimated: false, kind: 'answer' })]);
    expect(JSON.parse(readFileSync(join(dir, 'spend.json'), 'utf8')).open).toEqual({});
  });
  it('both attempts time out: a network error, and both are booked', async () => {
    const { f } = hangFetch(['hang', 'hang']);
    const out = await run(req(), deps(f, { timeouts: fast }));
    expect(out[out.length - 1]).toMatchObject({ t: 'error', code: 'network', retryable: true });
    expect(entries()).toHaveLength(2);
    expect(entries().every((e) => e.estimated)).toBe(true);
  });
  it('a stream that stalls after text: plays what arrived, then done and cut_off', async () => {
    const chunks = [sse({ type: 'response.output_item.added', item: { id: 'm1', type: 'message' } }), ...textEvents('m1', ['Part one. '])];
    const { f, calls } = hangFetch([{ chunks, hang: true }]);
    const out = await run(req(), deps(f, { timeouts: fast }));
    expect(texts(out)).toBe('Part one. ');
    expect(out[out.length - 2]).toMatchObject({ t: 'done', estimated: true });
    expect(out[out.length - 1]).toMatchObject({ t: 'error', code: 'cut_off' });
    expect((calls[0].init.signal as AbortSignal).aborted).toBe(true);
    expect(calls).toHaveLength(1);
  });
  it('a stream that stalls before any text: a network error, booked as an estimate', async () => {
    const { f } = hangFetch([{ chunks: [sse({ type: 'response.output_item.added', item: { id: 'm1', type: 'message' } })], hang: true }]);
    const out = await run(req(), deps(f, { timeouts: fast }));
    expect(out[out.length - 1]).toMatchObject({ t: 'error', code: 'network' });
    expect(out.some((e) => e.t === 'done')).toBe(false);
    expect(entries()).toEqual([expect.objectContaining({ estimated: true })]);
  });
  it('non-streamed calls (judge, prewarm) time out and book the worst case', async () => {
    const { f } = hangFetch(['hang', 'hang']);
    const r = await prewarmSystem(cfg, deps(f, { timeouts: fast }));
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/abort|timeout/i) });
    expect(entries()).toEqual([expect.objectContaining({ kind: 'prewarm', estimated: true }), expect.objectContaining({ kind: 'prewarm', estimated: true })]);
  });
  it('a non-streamed call whose first try fails after sending books that try when the retry succeeds', async () => {
    const { f } = hangFetch(['hang', { status: 200, text: JSON.stringify({ usage: { input_tokens: 4100, output_tokens: 0 } }) }]);
    const r = await prewarmSystem(cfg, deps(f, { timeouts: fast }));
    expect(r.ok).toBe(true);
    expect(entries().map((e) => !!e.estimated)).toEqual([true, false]);
  });
});

describe('ask: incomplete streams', () => {
  const head = [sse({ type: 'response.output_item.added', item: { id: 'm1', type: 'message' } }), ...textEvents('m1', ['Part one. '])];
  it('response.incomplete after text: done (with usage), then cut_off', async () => {
    const { f } = fakeFetch([{ chunks: [...head, sse({ type: 'response.incomplete', response: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, usage } })] }]);
    const out = await run(req(), deps(f));
    expect(out[out.length - 2]).toMatchObject({ t: 'done', estimated: false });
    expect(out[out.length - 1]).toMatchObject({ t: 'error', code: 'cut_off' });
  });
  it('a body that ends without a terminal event: done, then cut_off', async () => {
    const { f } = fakeFetch([{ chunks: head }]);
    const out = await run(req(), deps(f));
    expect(texts(out)).toBe('Part one. ');
    expect(out[out.length - 2]).toMatchObject({ t: 'done', estimated: true });
    expect(out[out.length - 1]).toMatchObject({ t: 'error', code: 'cut_off' });
  });
  it('a body that ends without any text or terminal event is an error, not an empty answer', async () => {
    const { f } = fakeFetch([{ chunks: [sse({ type: 'response.output_item.added', item: { id: 'm1', type: 'message' } })] }]);
    const out = await run(req(), deps(f));
    expect(out[out.length - 1]).toMatchObject({ t: 'error', code: 'upstream' });
    expect(out.some((e) => e.t === 'done')).toBe(false);
  });
  it('a complete answer has no cut_off', async () => {
    const { f } = fakeFetch([{ chunks: okBody(['All here.']) }]);
    const out = await run(req(), deps(f));
    expect(out[out.length - 1]).toMatchObject({ t: 'done' });
  });
});

describe('ask: abort estimates count everything generated', () => {
  it('text held back from the client (the plan) counts toward the estimated output', async () => {
    const plan = 'x'.repeat(1200);
    const { f } = fakeFetch([{ chunks: okBody([`One. <plan>${plan}`, '</plan> Two.']) }]);
    const ctl = new AbortController();
    await run(req(), deps(f), (e) => { if (e.t === 'text') ctl.abort(); }, ctl.signal);
    const [e] = entries();
    expect(e.estimated).toBe(true);
    expect(e.tokens.out).toBeGreaterThanOrEqual(Math.ceil((5 + 6 + 1200) / 3.2));
  });
});

describe('estimateInputTokens: worst cases', () => {
  it('counts non-ASCII text at one token per character', () => {
    const ascii = estimateInputTokens(buildRequest(req({ context: { ...context, pageText: 'e'.repeat(3200) } }), cfg), []);
    const accented = estimateInputTokens(buildRequest(req({ context: { ...context, pageText: 'é'.repeat(3200) } }), cfg), []);
    const cjk = estimateInputTokens(buildRequest(req({ context: { ...context, pageText: '視'.repeat(3200) } }), cfg), []);
    expect(accented - ascii).toBeGreaterThanOrEqual(3200 - 1000 - 1);
    expect(cjk - ascii).toBeGreaterThanOrEqual(3200 - 1000 - 1);
  });
  it('sizes a JPEG by its own header when the claimed size is smaller', async () => {
    const { jpegSize } = await import('../../server/openai');
    // SOI, APP0 (len 16), SOF0 (len 17: precision 8, h=1500, w=2000, 3 components), EOI
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...Array(14).fill(0), 0xff, 0xc0, 0x00, 0x11, 0x08, 0x05, 0xdc, 0x07, 0xd0, 0x03, ...Array(9).fill(0), 0xff, 0xd9]);
    expect(jpegSize(bytes.toString('base64'))).toEqual({ w: 2000, h: 1500 });
    expect(jpegSize('AAAA')).toBeNull();
    const b64 = bytes.toString('base64');
    const lie = buildRequest(req({ context: { ...context, image: { b64, w: 10, h: 10 } } }), cfg);
    const { askImages } = await import('../../server/openai');
    expect(askImages({ ...context, image: { b64, w: 10, h: 10 } })).toEqual([{ w: 2000, h: 1500 }]);
    expect(estimateInputTokens(lie, askImages({ ...context, image: { b64, w: 10, h: 10 } }))).toBeGreaterThan(estimateInputTokens(lie, [{ w: 10, h: 10 }]) + 2000);
  });
});

describe('Lessons v3: two stages', () => {
  const multi: AskContext = {
    ...context, docText: 'DECK digest', pageText: 'PAGE 2 (visible) lines',
    pagesText: 'PAGE 7 (16:9 slide; image attached)\nt1 60 40–300: Seven\nPAGE 9 (16:9 slide; listing only, no image)\nt1 60 40–300: Nine',
    images: [{ page: 7, b64: 'C'.repeat(400), w: 1280, h: 720 }],
    scout: { pages: [7, 2, 9], plan: 'walk 7, then 2, then 9; draw one figure' },
  };

  it('perform: digest (30m) and the visible page (30m) are the cached prefix; the scout pages, their images and the plan come in the tail before the question', () => {
    const b = buildRequest(req({ context: { ...multi, ink: { summary: 'a loop' } } }), cfg) as any;
    expect(b.input[1].content[0]).toMatchObject({ text: 'DECK digest', prompt_cache_breakpoint: { mode: 'explicit', ttl: '30m' } });
    expect(b.input[1].content[2].prompt_cache_breakpoint).toEqual({ mode: 'explicit', ttl: '30m' });
    expect(JSON.stringify(b).split('prompt_cache_breakpoint').length - 1).toBe(3);
    const tail = b.input[2].content;
    expect(tail.map((c: any) => c.type)).toEqual(['input_text', 'input_text', 'input_image', 'input_text', 'input_text', 'input_text']);
    expect(tail[0].text).toMatch(/^PAGE 7/);
    expect(tail[1].text).toBe('IMAGE of page 7:');
    expect(tail[3].text).toBe('PLAN (a first read of the whole document; pages in teaching order: 7, 2, 9): walk 7, then 2, then 9; draw one figure');
    expect(tail[4].text).toMatch(/^STUDENT INK/);
    expect(tail.at(-1).text).toMatch(/^QUESTION/);
    // The prewarm prefix is the same as the answer's prefix.
    const pre = buildRequest(req({ context: multi }), cfg, true) as any;
    expect(pre.input).toEqual(b.input.slice(0, 2));
  });

  it("the worst case counts every image sent", () => {
    expect(askImages(multi)).toHaveLength(2);
    const one = estimateInputTokens(buildRequest(req(), cfg), askImages(context));
    const two = estimateInputTokens(buildRequest(req({ context: multi }), cfg), askImages(multi));
    expect(two - one).toBeGreaterThan(40 * 23 * 1.2);
  });

  it('scout s2.6: the plan ends with its beats and a scope word; a narrow question is three or four beats (founder 2026-10-29: length by scope)', () => {
    expect(SCOUT_SYSTEM).toMatch(/end with "Scope:" and one word: narrow \([^)]*three or four beats\), standard, or broad/);
  });

  const sreq = { question: 'How does it work?', docName: 'd.pdf', docHash: 'h', numPages: 12, page: 3, digest: 'DECK d.pdf\np1: a', prior: { q: 'before?', a: 'x'.repeat(2000), page: 2 },
    pageText: 'PAGE 3 (visible; 16:9 slide; image attached)\nt1 60 40–300: Three' };
  const scfg: ModelConfig = { model: 'gpt-6.1-terra', effort: 'none', maxOutput: 600, fast: false, explicitCache: true };

  it('scout request: instructions, the digest (30m) and the visible listing (30m), then the previous exchange and the question last; strict JSON, streamed', () => {
    const b = buildScoutRequest(sreq, scfg) as any;
    expect(b.input[0]).toEqual({ role: 'developer', content: [{ type: 'input_text', text: SCOUT_SYSTEM }] });
    expect(b.input[1].content[0]).toEqual({ type: 'input_text', text: 'DECK d.pdf\np1: a', prompt_cache_breakpoint: { mode: 'explicit', ttl: '30m' } });
    // The answer's own listing of the visible page, but the scout gets no image.
    expect(b.input[1].content[1]).toEqual({ type: 'input_text', text: 'PAGE 3 (visible; 16:9 slide; listing only, no image)\nt1 60 40–300: Three', prompt_cache_breakpoint: { mode: 'explicit', ttl: '30m' } });
    const tail = b.input[2].content[0].text as string;
    expect(tail.startsWith('The student is looking at page 3.')).toBe(true);
    expect(tail).toContain('PREVIOUS QUESTION (page 2): before?');
    expect(tail.length).toBeLessThan(900); // the previous answer is trimmed
    expect(tail.endsWith('QUESTION: How does it work?')).toBe(true);
    expect(b).toMatchObject({ stream: true, max_output_tokens: 600, reasoning: { effort: 'none' }, prompt_cache_key: scoutCacheKey(), text: { format: { type: 'json_schema', strict: true } } });
    // The opener is first in the schema: it streams first.
    expect(Object.keys(b.text.format.schema.properties)).toEqual(['relation', 'opener', 'pages', 'find', 'plan']);
    // The prewarm is the same prefix (and the same output format, which is part of the prompt).
    const pre = buildScoutRequest(sreq, scfg, true) as any;
    expect(pre.input).toEqual(b.input.slice(0, 2));
    expect(pre.text).toEqual(b.text);
    expect(pre.stream).toBe(false);
    expect(pre.prompt_cache_options).toEqual({ mode: 'explicit', prewarm: true });
  });

  it('scout request, tiered context: map, section, listing, memory each cached (≤ 4 breakpoints); a scan gets a low-detail image; candidates before the question', () => {
    const bp = { prompt_cache_breakpoint: { mode: 'explicit', ttl: '30m' } };
    const b = buildScoutRequest({ ...sreq, prior: undefined, digest: 'DOCUMENT d.pdf\nMAP', section: 'SECTION 2', memory: 'SESSION\n1. …', candidates: 'CANDIDATES\np9 · x' }, scfg) as any;
    expect(b.input[1].content).toEqual([
      { type: 'input_text', text: 'DOCUMENT d.pdf\nMAP', ...bp },
      { type: 'input_text', text: 'SECTION 2', ...bp },
      { type: 'input_text', text: 'PAGE 3 (visible; 16:9 slide; listing only, no image)\nt1 60 40–300: Three', ...bp },
      { type: 'input_text', text: 'SESSION\n1. …', ...bp },
    ]);
    expect(b.input[2].content[0].text).toBe('The student is looking at page 3.\nCANDIDATES\np9 · x\nQUESTION: How does it work?');
    const scan = buildScoutRequest({ ...sreq, pageText: 'PAGE 3 (visible; page; no extractable text: x; image attached)', image: { b64: 'JPEG', w: 900, h: 1200 } }, scfg) as any;
    expect(scan.input[1].content.slice(1)).toEqual([
      { type: 'input_text', text: 'PAGE 3 (visible; page; no extractable text: x; image attached)' },
      { type: 'input_image', image_url: 'data:image/jpeg;base64,JPEG', detail: 'low', ...bp },
    ]);
    const n = (x: any) => x.input[1].content.filter((c: any) => c.prompt_cache_breakpoint).length;
    expect(n(b)).toBe(4);
  });

  it('the scout verdict carries an optional find list (≤ 3 short strings)', () => {
    expect(parseScout('{"opener":"a","pages":[2],"find":["Table 15.5"," appendix  D ","x","y"],"plan":"p"}', 12, 3)).toEqual({ pages: [2], plan: 'p', find: ['Table 15.5', 'appendix D', 'x'] });
    expect(parseScout('{"pages":[2],"find":[],"plan":"p"}', 12, 3)).toEqual({ pages: [2], plan: 'p' });
  });

  const susage = { input_tokens: 3000, output_tokens: 60, input_tokens_details: { cached_tokens: 2800 } };
  /** The scout's JSON as SSE deltas of `n` characters, then completed. */
  const scoutSse = (obj: object | string, n = 5, done = true) => {
    const text = typeof obj === 'string' ? obj : JSON.stringify(obj);
    const parts: string[] = [];
    for (let i = 0; i < text.length; i += n) parts.push(text.slice(i, i + n));
    return [sse({ type: 'response.output_item.added', item: { id: 's1', type: 'message' } }), ...textEvents('s1', parts),
      ...(done ? [sse({ type: 'response.completed', response: { status: 'completed', usage: susage } })] : [])];
  };
  const collect = async (f: typeof fetch, d: Partial<Deps> = {}, signal?: AbortSignal) => {
    const ev: ScoutEvent[] = [];
    const r = await scoutStream(sreq, scfg, deps(f, d), (e) => ev.push(e), signal);
    return { r, ev };
  };

  it('scout stream: opener sentences first (as they complete), then the verdict, then the cost; one scout entry', async () => {
    const obj = { opener: '{{circle p=3 mark=#d1}} It keeps the line with the most inliers. {{highlight p=9 "x"}}Outliers do not vote.', pages: [5, 6, 3], plan: 'p' };
    const { f, calls } = fakeFetch([{ chunks: scoutSse(obj, 4) }]);
    const { r, ev } = await collect(f);
    expect(calls).toHaveLength(1);
    expect(ev.map((e) => e.t)).toEqual(['opener', 'opener', 'scout', 'end']);
    expect(ev[0]).toMatchObject({ t: 'opener', d: '{{circle p=3 mark=#d1}} It keeps the line with the most inliers. ' });
    expect(ev[1]).toMatchObject({ t: 'opener', d: 'Outliers do not vote.' }); // the tag on page 9 is dropped
    expect(ev[2]).toMatchObject({ t: 'scout', pages: [5, 6, 3], plan: 'p', notes: [expect.stringMatching(/dropped/)] });
    expect(r).toMatchObject({ pages: [5, 6, 3], plan: 'p', opener: '{{circle p=3 mark=#d1}} It keeps the line with the most inliers. Outliers do not vote.' });
    expect(r.fallback).toBeUndefined();
    const e = JSON.parse(readFileSync(join(dir, 'spend.json'), 'utf8')).entries;
    expect(e).toEqual([expect.objectContaining({ kind: 'scout', phase: 'dev', usd: r.usd, estimated: false })]);
    expect(r.usd).toBeCloseTo(costUsd('gpt-6.1-terra', susage), 9);
    expect(ev[3]).toMatchObject({ t: 'end', usd: r.usd, cached: 2800, input: 3000 });
  });

  it('scout stream: the verdict comes as soon as pages and plan are parsed, before the stream completes', async () => {
    const order: string[] = [];
    const f = (async () => {
      const enc = new TextEncoder();
      const chunks = scoutSse({ opener: 'Yes.', pages: [2], plan: 'q' }, 200, false);
      let i = 0;
      return new Response(new ReadableStream<Uint8Array>({
        async pull(c) {
          if (i < chunks.length) { c.enqueue(enc.encode(chunks[i++])); return; }
          order.push('upstream done');
          c.enqueue(enc.encode(sse({ type: 'response.completed', response: { status: 'completed', usage: susage } })));
          c.close();
        },
      }, { highWaterMark: 0 }), { status: 200 });
    }) as unknown as typeof fetch;
    await scoutStream(sreq, scfg, deps(f), (e) => order.push(e.t));
    expect(order).toEqual(['opener', 'scout', 'upstream done', 'end']);
  });

  it('scout stream: the opener’s last sentence plays when its string closes, before pages and plan are written', async () => {
    const seen: string[] = [];
    const { f } = fakeFetch([{ chunks: scoutSse({ opener: 'One sentence only.', pages: [2], plan: 'a fairly long plan written after the opener' }, 3) }]);
    await scoutStream(sreq, scfg, deps(f), (e) => seen.push(e.t === 'opener' ? `opener:${e.d}` : e.t));
    expect(seen).toEqual(['opener:One sentence only.', 'scout', 'end']);
    // It was emitted while the plan was still streaming: check with a stream that stops before the plan.
    const early: string[] = [];
    const half = fakeFetch([{ chunks: scoutSse('{"opener":"One sentence only.","pages":[2],"plan":"still writ', 4, false) }]);
    await scoutStream(sreq, scfg, deps(half.f), (e) => early.push(e.t));
    expect(early[0]).toBe('opener');
  });

  it('scout stream: no retry on failure, it falls back to the visible page (with whatever opener already came)', async () => {
    const down = fakeFetch([{ status: 503 }]);
    const { r: r2, ev } = await collect(down.f);
    expect(down.calls).toHaveLength(1);
    expect(r2).toMatchObject({ pages: [3], fallback: expect.stringMatching(/scout failed/) });
    expect(ev.map((e) => e.t)).toEqual(['scout', 'end']);

    const junk = fakeFetch([{ chunks: scoutSse('not json') }]);
    expect((await collect(junk.f)).r).toMatchObject({ pages: [3], fallback: expect.any(String) });

    // The stream drops after the opener: the opener stays, the pages fall back.
    const cut = fakeFetch([{ chunks: scoutSse('{"opener":"Half an answer. And', 6, false) }]);
    const c = await collect(cut.f);
    expect(c.ev.map((e) => e.t)).toEqual(['opener', 'opener', 'scout', 'end']);
    expect(c.r).toMatchObject({ pages: [3], opener: 'Half an answer. And', fallback: expect.any(String) });
  });

  it('scout stream: a cap refusal never calls fetch and falls back', async () => {
    const tight = new Ledger(join(dir, 'tight.json'), { totalUsd: 0 });
    const { f, calls } = fakeFetch([]);
    expect((await collect(f, { ledger: tight })).r).toMatchObject({ pages: [3], fallback: 'cap' });
    expect(calls).toHaveLength(0);
  });

  it('scout stream: a client abort during the opener stops upstream, emits nothing more and books an estimate (no open reservation)', async () => {
    const ctl = new AbortController();
    const enc = new TextEncoder();
    let upstreamAborted = false;
    const f = (async (_u: string, init: RequestInit) => {
      init.signal!.addEventListener('abort', () => { upstreamAborted = true; });
      const chunks = scoutSse('{"opener":"First sentence. Second', 8, false);
      let i = 0;
      return new Response(new ReadableStream<Uint8Array>({
        pull(c) {
          if (i < chunks.length) { c.enqueue(enc.encode(chunks[i++])); return; }
          return new Promise<void>((ok) => { const stop = () => { c.error(new DOMException('aborted', 'AbortError')); ok(); }; if (init.signal!.aborted) stop(); else init.signal!.addEventListener('abort', stop); });
        },
      }, { highWaterMark: 0 }), { status: 200 });
    }) as unknown as typeof fetch;
    const ev: ScoutEvent[] = [];
    const p = scoutStream(sreq, scfg, deps(f), (e) => { ev.push(e); if (e.t === 'opener') ctl.abort(); }, ctl.signal);
    await p;
    expect(upstreamAborted).toBe(true);
    expect(ev.map((e) => e.t)).toEqual(['opener']);
    const raw = JSON.parse(readFileSync(join(dir, 'spend.json'), 'utf8'));
    expect(raw.entries).toEqual([expect.objectContaining({ kind: 'scout', estimated: true })]);
    expect(raw.entries[0].usd).toBeGreaterThan(0);
    expect(raw.open ?? {}).toEqual({});
  });

  it('scout stream: a scout that never decides times out to the visible page', async () => {
    const f = (async (_u: string, init: RequestInit) => new Response(new ReadableStream<Uint8Array>({
      pull(c) { return new Promise<void>((ok) => { const stop = () => { c.error(new DOMException('aborted', 'AbortError')); ok(); }; if (init.signal!.aborted) stop(); else init.signal!.addEventListener('abort', stop); }); },
    }, { highWaterMark: 0 }), { status: 200 })) as unknown as typeof fetch;
    const { r } = await collect(f, { timeouts: { callMs: 40, idleMs: 1000, headersMs: 1000 } });
    expect(r).toMatchObject({ pages: [3], fallback: 'scout timed out' });
  });

  it('stage 2 is told the opener verbatim, after the question, and continues from it', () => {
    const b = buildRequest(req({ context: { ...multi, opener: '{{circle p=2 mark=#d1}} It is the best line.' } }), cfg) as any;
    const tail = b.input[2].content;
    expect(tail.at(-2).text).toMatch(/^QUESTION/);
    expect(tail.at(-1).text).toBe(openerNote('{{circle p=2 mark=#d1}} It is the best line.'));
    expect(tail.at(-1).text).toMatch(/^ALREADY SPOKEN:.*Do not repeat.*\nOPENING: \{\{circle p=2 mark=#d1\}\} It is the best line\.$/s);
    // it continues from where the opener stopped: never its claim again, a first sentence that adds something
    expect(tail.at(-1).text).toMatch(/never state it again, in any words/);
    expect(tail.at(-1).text).toMatch(/first sentence must add something the opening did not say: why it holds \(the mechanism\), or the first step of it drawn/);
    // The cached prefix is unchanged by the opener.
    expect(b.input.slice(0, 2)).toEqual((buildRequest(req({ context: multi }), cfg) as any).input.slice(0, 2));
  });

  it('scout prewarm writes the scout prefix and books a prewarm entry', async () => {
    const { f, calls } = fakeFetch([{ status: 200, text: JSON.stringify({ usage: { input_tokens: 3000, output_tokens: 0 } }) }]);
    expect(await prewarmScout(sreq, scfg, deps(f))).toMatchObject({ ok: true });
    expect(JSON.parse(String(calls[0].init.body)).input).toHaveLength(2);
  });
});
