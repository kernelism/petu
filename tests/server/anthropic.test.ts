// @vitest-environment node
// The Anthropic Messages API provider (server/anthropic.ts, wired in server/openai.ts): no network,
// a scripted fetch only.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ledger } from '../../server/ledger';
import { PRICES, costUsd, worstCaseUsd } from '../../server/prices';
import { ask, buildAnswerRequest, prewarm, prewarmSystem, type Deps, type ModelConfig } from '../../server/openai';
import { AnthropicEvents, NO_ANTHROPIC_KEY, normalizeUsage, thinkingFor } from '../../server/anthropic';
import { loadPetuEnv, parseEnv } from '../../server/env';
import { systemPrompt } from '../../server/prompt/system';
import type { AskContext, AskEvent, AskRequest } from '../../src/agent/protocol';

const KEY = 'sk-ant-test-SECRET-xyz';
const OPENAI_KEY = 'sk-openai-should-not-be-sent';
const opus: ModelConfig = { model: 'claude-opus-5-5', effort: 'low', maxOutput: 6000, fast: false, explicitCache: true };
const sonnetNone: ModelConfig = { model: 'claude-sonnet-5-5', effort: 'none', maxOutput: 3200, fast: false, explicitCache: true };
const context: AskContext = {
  docName: 'econ.pdf', docHash: 'h1', numPages: 20, page: 12,
  docText: 'DOC digest', pageText: 'PAGE 12 lines', image: { b64: 'QUJD', w: 1024, h: 768 },
  memory: 'MEMORY: answer 1 …',
  pagesText: 'PAGES 11, 13', images: [{ page: 13, b64: 'REVG', w: 800, h: 600 }],
  scout: { pages: [12, 13], plan: 'tax wedge, then who bears it' },
  opener: 'The tax splits between buyers and sellers.',
};
const req = (over: Partial<AskRequest> = {}): AskRequest => ({ question: 'Who actually pays this tax?', history: [{ q: 'q0', a: 'a0', page: 12 }], context, ...over });

const sse = (o: { type: string } & Record<string, unknown>) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;
const startUsage = { input_tokens: 600, cache_creation_input_tokens: 3000, cache_read_input_tokens: 9000, cache_creation: { ephemeral_5m_input_tokens: 3000, ephemeral_1h_input_tokens: 0 }, output_tokens: 1 };
const stream = (parts: string[], stop = 'end_turn', out = 850) => [
  sse({ type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', usage: startUsage } }),
  sse({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }),
  sse({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '' } }),
  sse({ type: 'content_block_stop', index: 0 }),
  sse({ type: 'ping' }),
  sse({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }),
  ...parts.map((t) => sse({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: t } })),
  sse({ type: 'content_block_stop', index: 1 }),
  sse({ type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: out } }),
  sse({ type: 'message_stop' }),
];

type Call = { url: string; init: RequestInit };
function fakeFetch(replies: ({ status: number; text?: string } | { chunks: string[] })[]) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = replies.shift();
    if (!r) throw new Error('unexpected fetch');
    if ('status' in r) return new Response(r.text ?? '', { status: r.status });
    const enc = new TextEncoder();
    let i = 0;
    return new Response(new ReadableStream<Uint8Array>({ pull(c) { if (i < r.chunks.length) c.enqueue(enc.encode(r.chunks[i++])); else c.close(); } }, { highWaterMark: 0 }), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

let ledger: Ledger;
beforeEach(() => { ledger = new Ledger(join(mkdtempSync(join(tmpdir(), 'anthropic-')), 'spend.json'), { totalUsd: 40 }); });
const deps = (f: typeof fetch, over: Partial<Deps> = {}): Deps => ({ key: OPENAI_KEY, anthropicKey: KEY, ledger, phase: 'dev', fetch: f, sleep: async () => {}, ...over });
async function run(r: AskRequest, cfg: ModelConfig, d: Deps) {
  const out: AskEvent[] = [];
  await ask(r, cfg, d, (e) => out.push(e), new AbortController().signal);
  return out;
}
const cacheMarks = (b: any) => [...b.system, ...b.messages.flatMap((m: any) => m.content)].filter((p: any) => p.cache_control).map((p: any) => p.cache_control);

describe('Anthropic request (stage 2)', () => {
  it('system prompt first with a 1h breakpoint; digest and visible image 5m; MEMORY 5m; history; the volatile tail with the question and opener last', () => {
    const b = buildAnswerRequest(req(), opus);
    expect(b.model).toBe('claude-opus-5-5');
    expect(b.max_tokens).toBe(6000);
    expect(b.stream).toBe(true);
    for (const k of ['input', 'prompt_cache_key', 'reasoning', 'store', 'metadata', 'prompt_cache_options', 'temperature']) expect(b).not.toHaveProperty(k);
    expect(b.system).toEqual([{ type: 'text', text: systemPrompt(), cache_control: { type: 'ephemeral', ttl: '1h' } }]);
    const [page, mem, hq, ha, tail] = b.messages;
    expect(page.role).toBe('user');
    expect(page.content).toEqual([
      { type: 'text', text: 'DOC digest', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'PAGE 12 lines' },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' }, cache_control: { type: 'ephemeral' } },
    ]);
    expect(mem).toEqual({ role: 'user', content: [{ type: 'text', text: context.memory, cache_control: { type: 'ephemeral' } }] });
    expect(hq.role).toBe('user');
    expect(ha).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'a0' }] });
    expect(tail.role).toBe('user');
    const texts = tail.content.filter((p: any) => p.type === 'text').map((p: any) => p.text as string);
    expect(texts[0]).toBe('PAGES 11, 13');
    expect(tail.content.find((p: any) => p.type === 'image').source.data).toBe('REVG');
    expect(texts.at(-2)).toMatch(/^QUESTION \(the student is looking at page 12\): Who actually pays/);
    expect(texts.at(-1)).toMatch(/^ALREADY SPOKEN/);
    expect(tail.content.some((p: any) => p.cache_control)).toBe(false);
    // ≤ 4 breakpoints, the longer TTL first (the API's ordering rule).
    const marks = cacheMarks(b);
    expect(marks).toHaveLength(4);
    expect(marks[0].ttl).toBe('1h');
    expect(marks.slice(1).every((m: any) => m.ttl == null)).toBe(true);
    expect(b.messages.at(-1).role).toBe('user'); // no assistant prefill
  });
  it('thinking and effort: adaptive + output_config.effort; none = thinking off (Sonnet between_tools, Haiku disabled); Opus 5.5 cannot run without thinking', () => {
    expect(buildAnswerRequest(req(), opus)).toMatchObject({ thinking: { type: 'adaptive' }, output_config: { effort: 'low' } });
    const s = buildAnswerRequest(req(), sonnetNone);
    expect(s.thinking).toEqual({ type: 'between_tools' });
    expect(s).not.toHaveProperty('output_config');
    expect(thinkingFor('claude-haiku-5-5', 'none')).toEqual({ thinking: { type: 'disabled' } });
    expect(thinkingFor('claude-sonnet-5-5', 'medium')).toEqual({ thinking: { type: 'adaptive', display: 'summarized' }, output_config: { effort: 'medium' } });
    expect(() => thinkingFor('claude-opus-5-5', 'none')).toThrow(/thinking/);
  });
  it('drops empty text blocks and messages left empty (the API rejects them)', () => {
    const b = buildAnswerRequest(req({ history: [{ q: 'q0', a: '', page: 12 }] }), opus);
    const all = b.messages.flatMap((m: any) => m.content);
    expect(all.every((p: any) => p.type !== 'text' || p.text.trim())).toBe(true);
    expect(b.messages.some((m: any) => m.role === 'assistant')).toBe(false);
  });
  it('OpenAI configs are untouched by the provider switch', () => {
    const b = buildAnswerRequest(req(), { ...opus, model: 'gpt-6.1-terra', effort: 'none' });
    expect(b).toHaveProperty('input');
    expect(b.input[0].role).toBe('developer');
  });
});

describe('Anthropic stream', () => {
  it('text deltas only (thinking and pings dropped); usage normalised at message_stop', () => {
    const ev = new AnthropicEvents();
    const out = stream(['Buyers ', 'pay ', 'part.']).flatMap((c) => ev.handle(JSON.parse(c.split('data: ')[1])));
    expect(out.filter((u) => u.t === 'text').map((u) => (u as { d: string }).d).join('')).toBe('Buyers pay part.');
    const u = out.at(-1)!;
    expect(u).toEqual({ t: 'usage', status: 'end_turn', complete: true, usage: {
      input_tokens: 12600, output_tokens: 850,
      input_tokens_details: { cached_tokens: 9000, cache_write_tokens: 3000, cache_write_tokens_details: { ttl_12h_tokens: 0, ttl_30m_tokens: 3000 } },
    } });
  });
  it('max_tokens and refusal stops are incomplete; an error event is an error', () => {
    const ev = new AnthropicEvents();
    ev.handle({ type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 10 } });
    expect(ev.handle({ type: 'message_stop' })[0]).toMatchObject({ t: 'usage', complete: false, status: 'max_tokens' });
    const r = new AnthropicEvents();
    r.handle({ type: 'message_delta', delta: { stop_reason: 'refusal' } });
    expect(r.handle({ type: 'message_stop' })[0]).toMatchObject({ complete: false, status: 'refusal' });
    expect(new AnthropicEvents().handle({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } })).toEqual([{ t: 'error', message: 'Overloaded' }]);
  });
});

describe('Anthropic answer through ask()', () => {
  it('posts to the Messages API with x-api-key (never the OpenAI key), streams the text, books usage → cost', async () => {
    const { f, calls } = fakeFetch([{ chunks: stream(['Buyers ', 'pay ', 'part of it.']) }]);
    const out = await run(req(), opus, deps(f));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages');
    const h = calls[0].init.headers as Record<string, string>;
    expect(h['x-api-key']).toBe(KEY);
    expect(h['anthropic-version']).toBe('2023-06-01');
    expect(JSON.stringify(h)).not.toContain(OPENAI_KEY);
    expect(String(calls[0].init.body)).not.toContain(KEY);
    expect(out.filter((e) => e.t === 'text').map((e) => (e as { d: string }).d).join('')).toBe('Buyers pay part of it.');
    const done = out.find((e) => e.t === 'done') as Extract<AskEvent, { t: 'done' }>;
    // 600 plain × $4 + 9000 read × $0.20 + 3000 5m-write × $5 + 850 out × $20, per 1M.
    const want = (600 * 4 + 9000 * 0.2 + 3000 * 5 + 850 * 20) / 1e6;
    expect(done.usd).toBeCloseTo(want, 10);
    expect(done.estimated).toBe(false);
    expect(done.usage?.input_tokens_details?.cached_tokens).toBe(9000);
    expect(ledger.summary().totalUsd).toBeCloseTo(want, 10);
    expect(ledger.summary().byModel['claude-opus-5-5']).toBeCloseTo(want, 10);
  });
  it('refuses without PETU_ANTHROPIC_KEY: no request, a clear no_key error, nothing booked', async () => {
    const { f, calls } = fakeFetch([]);
    const out = await run(req(), opus, deps(f, { anthropicKey: undefined }));
    expect(calls).toHaveLength(0);
    expect(out).toEqual([{ t: 'error', code: 'no_key', message: NO_ANTHROPIC_KEY, retryable: false }]);
    expect(NO_ANTHROPIC_KEY).toMatch(/PETU_ANTHROPIC_KEY/);
    expect(ledger.summary().totalUsd).toBe(0);
  });
  it('an upstream error is reported as Anthropic and scrubbed of the key; the reservation is released', async () => {
    const { f } = fakeFetch([{ status: 400, text: `bad request for ${KEY}` }]);
    const out = await run(req(), opus, deps(f));
    const err = out.find((e) => e.t === 'error') as Extract<AskEvent, { t: 'error' }>;
    expect(err.message).toMatch(/^Anthropic 400: bad request for \*\*\*/);
    expect(ledger.summary().totalUsd).toBe(0);
  });
  it('max_tokens mid-answer: the text plays, then cut_off', async () => {
    const { f } = fakeFetch([{ chunks: stream(['A start'], 'max_tokens', 6000) }]);
    const out = await run(req(), opus, deps(f));
    expect(out.some((e) => e.t === 'done')).toBe(true);
    expect(out.at(-1)).toMatchObject({ t: 'error', code: 'cut_off' });
  });
  it('max_tokens just after a whole sentence: done, no cut_off', async () => {
    const { f } = fakeFetch([{ chunks: stream(['A start. And a finish.'], 'max_tokens', 6000) }]);
    const out = await run(req(), opus, deps(f));
    expect(out.at(-1)).toMatchObject({ t: 'done' });
    expect(out.some((e) => e.t === 'error')).toBe(false);
  });
});

/** A stream that sends each chunk `gap` ms after the last (fake timers); `next` returns null to end it. */
function timedFetch(next: (i: number) => string | null, gap: (i: number) => number) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const enc = new TextEncoder();
    let i = 0;
    return new Response(new ReadableStream<Uint8Array>({
      pull(c) {
        return new Promise<void>((ok) => setTimeout(() => {
          const s = next(i);
          try { if (s == null) c.close(); else c.enqueue(enc.encode(s)); } catch { /* cancelled */ }
          i++; ok();
        }, gap(i)));
      },
    }, { highWaterMark: 0 }), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const think = (n: number) => sse({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: `step ${n} ` } });
const medium: ModelConfig = { ...opus, effort: 'medium' };

describe('Anthropic: thinking is activity (the idle timer), the whole stream has a cap', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }); });
  afterEach(() => { vi.useRealTimers(); });
  const answer = async (f: typeof fetch) => {
    const out: AskEvent[] = [];
    const p = ask(req(), medium, deps(f), (e) => out.push(e), new AbortController().signal);
    await vi.advanceTimersByTimeAsync(600_000);
    await p;
    return out;
  };
  const head = stream([]).slice(0, 2), tail = stream(['The tax ', 'splits.']).slice(4);

  it('30 s of thinking deltas (one every 2 s), then text: the answer plays in full, no error (default 20 s idle)', async () => {
    const body = [...head, ...Array.from({ length: 15 }, (_, k) => think(k)), ...tail];
    const { f, calls } = timedFetch((i) => body[i] ?? null, (i) => (i >= 2 && i < 17 ? 2_000 : 0));
    const out = await answer(f);
    expect((calls[0].init.signal as AbortSignal).aborted).toBe(false);
    expect(out.filter((e) => e.t === 'text').map((e) => (e as { d: string }).d).join('')).toBe('The tax splits.');
    expect(out.at(-1)).toMatchObject({ t: 'done', estimated: false });
    expect(out.some((e) => e.t === 'error')).toBe(false);
  });
  it('the request streams its thinking (display summarized), else a long think is silence', () => {
    expect(JSON.parse(JSON.stringify(buildAnswerRequest(req(), medium))).thinking).toEqual({ type: 'adaptive', display: 'summarized' });
  });
  it('30 s of silence is still a stall: aborted after 20 s, a network error, booked as an estimate', async () => {
    const { f, calls } = timedFetch((i) => [...head, ...tail][i] ?? null, (i) => (i === 2 ? 30_000 : 0));
    const out = await answer(f);
    expect((calls[0].init.signal as AbortSignal).aborted).toBe(true);
    expect(out.at(-1)).toMatchObject({ t: 'error', code: 'network', message: 'Anthropic stopped sending.' });
    expect(ledger.summary().totalUsd).toBeGreaterThan(0);
  });
  it('thinking that never ends: stopped by the overall cap (240 s), the upstream aborted, booked', async () => {
    const { f, calls } = timedFetch((i) => (i < 2 ? head[i] : think(i)), (i) => (i < 2 ? 0 : 2_000));
    const t0 = Date.now();
    const out: AskEvent[] = [];
    const p = ask(req(), medium, deps(f), (e) => out.push(e), new AbortController().signal);
    let endedAt = 0;
    void p.then(() => { endedAt = Date.now(); });
    await vi.advanceTimersByTimeAsync(600_000);
    await p;
    expect(endedAt - t0).toBeGreaterThanOrEqual(240_000);
    expect(endedAt - t0).toBeLessThan(243_000);
    expect((calls[0].init.signal as AbortSignal).aborted).toBe(true);
    expect(out.at(-1)).toMatchObject({ t: 'error', code: 'network', message: 'Anthropic took too long to finish.' });
    expect(ledger.summary().totalUsd).toBeGreaterThan(0);
  });
  it('OpenAI reasoning events count as activity too (one every 2 s for 30 s, then text)', async () => {
    const oa = (o: { type: string } & Record<string, unknown>) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;
    const body = [
      ...Array.from({ length: 15 }, (_, k) => oa({ type: 'response.reasoning_summary_text.delta', item_id: 'r1', delta: `step ${k} ` })),
      oa({ type: 'response.output_item.added', item: { id: 'm1', type: 'message' } }),
      oa({ type: 'response.output_text.delta', item_id: 'm1', delta: 'Hello.' }),
      oa({ type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 100, output_tokens: 10 } } }),
    ];
    const { f } = timedFetch((i) => body[i] ?? null, (i) => (i < 15 ? 2_000 : 0));
    const out: AskEvent[] = [];
    const p = ask(req(), { ...medium, model: 'gpt-6.1-terra' }, deps(f), (e) => out.push(e), new AbortController().signal);
    await vi.advanceTimersByTimeAsync(60_000);
    await p;
    expect(out.filter((e) => e.t === 'text').map((e) => (e as { d: string }).d).join('')).toBe('Hello.');
    expect(out.at(-1)).toMatchObject({ t: 'done', estimated: false });
  });
  it('the cap after text: what arrived plays, then cut_off', async () => {
    const t = stream(['Part one. ']);
    const { f } = timedFetch((i) => (i < 7 ? t[i] : think(i)), (i) => (i < 7 ? 0 : 2_000));
    const out = await answer(f);
    expect(out.filter((e) => e.t === 'text').map((e) => (e as { d: string }).d).join('')).toBe('Part one. ');
    expect(out.at(-1)).toMatchObject({ t: 'error', code: 'cut_off' });
  });
});

describe('Anthropic prewarm', () => {
  it('page prewarm: the same cached prefix, max_tokens 0, not streamed, same thinking settings; usage booked as prewarm', async () => {
    const usage = { input_tokens: 5, cache_creation_input_tokens: 9000, cache_read_input_tokens: 0, cache_creation: { ephemeral_5m_input_tokens: 3000, ephemeral_1h_input_tokens: 6000 }, output_tokens: 0 };
    const { f, calls } = fakeFetch([{ status: 200, text: JSON.stringify({ id: 'm', content: [], stop_reason: 'max_tokens', usage }) }]);
    const r = await prewarm(context, opus, deps(f));
    expect(r.ok).toBe(true);
    const b = JSON.parse(String(calls[0].init.body));
    expect(b.max_tokens).toBe(0);
    expect(b).not.toHaveProperty('stream');
    expect(b.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    expect(b.messages).toHaveLength(1);
    expect(cacheMarks(b)).toEqual([{ type: 'ephemeral', ttl: '1h' }, { type: 'ephemeral' }, { type: 'ephemeral' }]);
    expect(r.usd).toBeCloseTo((5 * 4 + 6000 * 8 + 3000 * 5) / 1e6, 10);
  });
  it('system prewarm without a key does nothing', async () => {
    const { f, calls } = fakeFetch([]);
    expect(await prewarmSystem(opus, deps(f, { anthropicKey: '' }))).toEqual({ ok: false, usd: 0, reason: 'no key' });
    expect(calls).toHaveLength(0);
  });
});

describe('Anthropic prices and env', () => {
  it('current models are priced (official pricing page); Haiku 5.5 switches to its long-prompt row past 100k', () => {
    for (const m of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']) expect(PRICES[m]).toBeDefined();
    const u = normalizeUsage({ input_tokens: 1000, output_tokens: 1000 });
    expect(costUsd('claude-haiku-5-5', u)).toBeCloseTo((1000 * 0.1 + 1000 * 0.5) / 1e6, 12);
    const big = normalizeUsage({ input_tokens: 120_000, output_tokens: 1000 });
    expect(costUsd('claude-haiku-5-5', big)).toBeCloseTo((120_000 * 0.5 + 1000 * 2.5) / 1e6, 12);
    expect(worstCaseUsd('claude-sonnet-5-5', 10_000, 1000)).toBeCloseTo((10_000 * 4 + 1000 * 10) / 1e6, 12);
  });
  it('the key comes from the .env file only: PETU_ANTHROPIC_KEY first, else ANTHROPIC_API_KEY; never from process.env, which is left untouched', () => {
    // A fake loadEnv standing in for Vite's: it returns the file's values, overridden by the process's (prefix '').
    const fakeLoad = (file: Record<string, string>, proc: Record<string, string>) => [((() => ({ ...file, ...proc })) as never), proc as NodeJS.ProcessEnv] as const;
    const load = (file: Record<string, string>, proc: Record<string, string> = {}) => { const [l, p] = fakeLoad(file, proc); return loadPetuEnv('development', '/repo', '/repo', l, p); };
    expect(load({ ANTHROPIC_API_KEY: 'file-a' }).anthropicKey).toBe('file-a');
    expect(load({ PETU_ANTHROPIC_KEY: ' file-p ', ANTHROPIC_API_KEY: 'file-a' }).anthropicKey).toBe('file-p');
    expect(load({}, { ANTHROPIC_API_KEY: 'shell', PETU_ANTHROPIC_KEY: 'shell2' }).anthropicKey).toBe('');
    // The shell's ANTHROPIC_API_KEY shadows the file's (Vite's merge): skipped; the other name still works.
    expect(load({ ANTHROPIC_API_KEY: 'file-a' }, { ANTHROPIC_API_KEY: 'shell' }).anthropicKey).toBe('');
    expect(load({ PETU_ANTHROPIC_KEY: 'file-p' }, { ANTHROPIC_API_KEY: 'shell' }).anthropicKey).toBe('file-p');
    const proc: Record<string, string> = {};
    load({ PETU_ANTHROPIC_KEY: 'file-p' }, proc);
    expect(proc).toEqual({});
    // parseEnv on its own reads no Anthropic key from the general lookup.
    expect(parseEnv((k) => ({ PETU_ANTHROPIC_KEY: 'x', ANTHROPIC_API_KEY: 'y' } as Record<string, string>)[k], { root: '/r', home: '/h' }).anthropicKey).toBe('');
  });
  it('Opus 5.5 refuses effort none; scout stays on OpenAI; Sonnet none is fine', () => {
    const opts = { root: '/repo', home: '/home/u' };
    const from = (o: Record<string, string>) => (k: string) => o[k];
    const e = parseEnv(from({ PETU_MODEL: 'claude-sonnet-5-5', PETU_EFFORT: 'none' }), opts);
    expect(e.model.model).toBe('claude-sonnet-5-5');
    expect(() => parseEnv(from({ PETU_MODEL: 'claude-opus-5-5', PETU_EFFORT: 'none' }), opts)).toThrow(/thinking off/);
    expect(parseEnv(from({ PETU_MODEL: 'claude-opus-5-5', PETU_EFFORT: 'low' }), opts).model.effort).toBe('low');
    expect(() => parseEnv(from({ PETU_SCOUT_MODEL: 'claude-haiku-5-5' }), opts)).toThrow(/scout runs on OpenAI/);
  });
});
