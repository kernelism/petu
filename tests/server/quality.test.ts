// @vitest-environment node
// Settings → Answer quality (server/quality.ts): the browser sends 'standard' | 'best', never a model
// name; the server maps it, refuses anything else, and books Best like any answer. Fake upstreams: $0.
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { parseEnv, DEFAULT_MAX_OUTPUT_REASONING } from '../../server/env';
import { createApi } from '../../server/plugin';
import { answerConfig, BEST_EFFORT, BEST_MODEL, isQuality } from '../../server/quality';
import type { AskRequest } from '../../src/agent/protocol';
import type { RepairReport } from '../../src/gate/events';

const KEY = 'sk-test-QUALITY-openai';
const AKEY = 'sk-ant-test-QUALITY-anthropic';

let root = '';
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'petu-quality-')); mkdirSync(join(root, 'pdfs')); });
const env = (over: Record<string, string> = {}, anthropic = true) => parseEnv(
  (k) => ({ OPENAI_API_KEY: KEY, PETU_PDF_DIRS: join(root, 'pdfs'), PETU_PHASE: 'dev', ...over })[k],
  { root, home: root, fileEnv: (k) => (anthropic && k === 'PETU_ANTHROPIC_KEY' ? AKEY : undefined) });
const spend = () => JSON.parse(readFileSync(join(root, '.petu/spend.json'), 'utf8'));
const ask = (over: Record<string, unknown> = {}): AskRequest => ({
  question: 'Why?', history: [],
  context: { docName: 'd.pdf', docHash: 'h', numPages: 3, page: 2, docText: 'DIGEST', pageText: 'PAGE', image: { b64: 'AAAA', w: 100, h: 100 } },
  ...over,
} as AskRequest);

type FakeRes = ServerResponse & { body(): string };
function fakeReq(method: string, url: string, body = ''): IncomingMessage {
  const r = Readable.from(body.length ? [Buffer.from(body)] : []) as unknown as IncomingMessage;
  Object.assign(r, { method, url, headers: { host: 'localhost:5182', ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) } });
  return r;
}
function fakeRes(): FakeRes {
  const chunks: Buffer[] = [];
  const w = new Writable({ write(c, _e, cb) { chunks.push(Buffer.from(c)); cb(); } }) as unknown as FakeRes;
  Object.assign(w, { statusCode: 200, setHeader() { return w; }, getHeader() { return undefined; }, flushHeaders() { /* noop */ }, body: () => Buffer.concat(chunks).toString('utf8') });
  return w;
}
const lines = (res: FakeRes) => res.body().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const sse = (o: object) => `data: ${JSON.stringify(o)}\n\n`;
const oaText = (parts: string[]) => parts.map((d) => sse({ type: 'response.output_text.delta', item_id: 'm1', delta: d }))
  .concat(sse({ type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 9000, output_tokens: 60 } } }));
const anText = (parts: string[]) => [sse({ type: 'message_start', message: { usage: { input_tokens: 100, cache_read_input_tokens: 9000 } } }),
  ...parts.map((d) => sse({ type: 'content_block_delta', delta: { type: 'text_delta', text: d } })),
  sse({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 50 } }), sse({ type: 'message_stop' })];
function upstream(script: string[][]) {
  const calls: { url: string; body: any }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    const chunks = script[Math.min(calls.length - 1, script.length - 1)];
    const enc = new TextEncoder();
    let i = 0;
    return new Response(new ReadableStream<Uint8Array>({ pull(c) { if (i < chunks.length) c.enqueue(enc.encode(chunks[i++])); else c.close(); } }, { highWaterMark: 0 }), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}
async function post(api: ReturnType<typeof createApi>, path: string, body: unknown) {
  const res = fakeRes();
  await api.handle(fakeReq('POST', path, JSON.stringify(body)), res, () => { throw new Error('next'); });
  return res;
}
const report: RepairReport = { beat: 'Notice Z.', problems: [{ check: 'unknown', detail: 'no Z' }], board: [], consts: {}, finds: [], later: [], tail: 'so far', maxWords: 20 };

describe('answer quality mapping', () => {
  it('standard (or absent) is the server model; best is Opus at effort low with the standard prompt; anything else is refused', () => {
    const e = env({});
    expect(answerConfig(e, undefined)).toEqual({ cfg: e.model });
    expect(answerConfig(e, 'standard')).toEqual({ cfg: e.model });
    expect(e.model).toMatchObject({ model: 'gpt-6.1-terra', effort: 'none' });
    expect(answerConfig(e, 'best')).toEqual({ cfg: { ...e.model, model: BEST_MODEL, effort: BEST_EFFORT, maxOutput: DEFAULT_MAX_OUTPUT_REASONING } });
    expect([BEST_MODEL, BEST_EFFORT]).toEqual(['claude-opus-5-5', 'low']);
    for (const q of ['claude-opus-5-5', 'gpt-6.1-sol', 'Best', '', 1, {}, ['best']]) {
      expect(answerConfig(e, q), JSON.stringify(q)).toHaveProperty('error');
      expect(isQuality(q)).toBe(false);
    }
  });
  it('without the Anthropic key in .env, Best is off (null) and refused with a short reason', () => {
    const e = env({}, false);
    expect(e.best).toBeNull();
    expect(answerConfig(e, 'best')).toEqual({ error: expect.stringMatching(/PETU_ANTHROPIC_KEY/) });
    // A key exported in the shell is never read (env.ts): still off.
    expect(parseEnv((k) => ({ PETU_ANTHROPIC_KEY: 'shell' } as Record<string, string>)[k], { root, home: root }).best).toBeNull();
  });
});

describe('POST /api/ask with quality', () => {
  it('400 for an unknown token or a model name; nothing goes upstream, nothing is booked', async () => {
    const { f, calls } = upstream([oaText(['x'])]);
    const api = createApi({ env: env(), root, fetch: f });
    for (const quality of ['claude-opus-5-5', 'gpt-6.1-sol', 'turbo', 7, 'BEST']) {
      const res = await post(api, '/api/ask', ask({ quality }));
      expect(res.statusCode, String(quality)).toBe(400);
      expect(JSON.parse(res.body())).toMatchObject({ t: 'error', code: 'bad_request' });
    }
    expect(calls).toHaveLength(0);
    expect(spend().entries ?? []).toEqual([]);
  });
  it('a stray `model` in the body is ignored: the server picks', async () => {
    const { f, calls } = upstream([oaText(['Fine.'])]);
    const api = createApi({ env: env(), root, fetch: f });
    await post(api, '/api/ask', ask({ model: 'claude-opus-5-5', effort: 'high' }));
    expect(calls[0].url).toMatch(/openai/);
    expect(calls[0].body.model).toBe('gpt-6.1-terra');
  });
  it('best without the key: 400, no call', async () => {
    const { f, calls } = upstream([oaText(['x'])]);
    const api = createApi({ env: env({}, false), root, fetch: f });
    const res = await post(api, '/api/ask', ask({ quality: 'best' }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body()).message).toMatch(/PETU_ANTHROPIC_KEY/);
    expect(calls).toHaveLength(0);
  });
  it('best: Opus at effort low on Messages, meta says so, the ledger books it as an answer; standard stays on terra', async () => {
    const { f, calls } = upstream([anText(['Deep ', 'answer.']), oaText(['Plain answer.'])]);
    const api = createApi({ env: env(), root, fetch: f });
    const res = await post(api, '/api/ask', ask({ quality: 'best' }));
    const ev = lines(res);
    expect(ev[0]).toMatchObject({ t: 'meta', model: 'claude-opus-5-5', effort: 'low' });
    expect(ev.filter((e) => e.t === 'text').map((e) => e.d).join('')).toBe('Deep answer.');
    expect(calls[0].url).toMatch(/anthropic/);
    expect(calls[0].body).toMatchObject({ model: 'claude-opus-5-5', max_tokens: DEFAULT_MAX_OUTPUT_REASONING, thinking: { type: 'adaptive' }, output_config: { effort: 'low' } });
    const entry = spend().entries.find((e: any) => e.kind === 'answer');
    expect(entry).toMatchObject({ kind: 'answer', model: 'claude-opus-5-5', phase: 'dev', estimated: false });
    expect(entry.usd).toBeGreaterThan(0);
    expect(spend().open ?? {}).toEqual({});
    await post(api, '/api/ask', ask({ quality: 'standard' }));
    expect(calls[1].url).toMatch(/openai/);
    expect(calls[1].body.model).toBe('gpt-6.1-terra');
  });
  it('best goes through the same caps: a spent phase refuses it before any call', async () => {
    const { f, calls } = upstream([anText(['x'])]);
    const api = createApi({ env: env({ PETU_CAP_DEV: '0' }), root, fetch: f });
    const ev = lines(await post(api, '/api/ask', ask({ quality: 'best' })));
    expect(ev).toEqual([expect.objectContaining({ t: 'error', code: 'cap' })]);
    expect(calls).toHaveLength(0);
  });
  it("a Best answer's repair runs on Opus at effort low (it cannot turn thinking off), booked as a repair", async () => {
    const { f, calls } = upstream([anText(['Answer.']), anText(['Fixed beat.'])]);
    const e = env();
    expect(e.repair).toMatchObject({ model: 'gpt-6.1-terra', effort: 'none' });
    const api = createApi({ env: e, root, fetch: f });
    const reqId = lines(await post(api, '/api/ask', ask({ quality: 'best' }))).find((x) => x.t === 'meta').reqId;
    const res = await post(api, '/api/repair', { reqId, phase: 'dev', k: 1, committed: 'So far.', beat: report.beat, report, deadlineMs: 5000 });
    expect(lines(res).filter((x) => x.t === 'text').map((x) => x.d).join('')).toBe('Fixed beat.');
    expect(calls[1].url).toMatch(/anthropic/);
    expect(calls[1].body).toMatchObject({ model: 'claude-opus-5-5', thinking: { type: 'adaptive' }, output_config: { effort: 'low' } });
    expect(spend().entries.find((x: any) => x.kind === 'repair')).toMatchObject({ model: 'claude-opus-5-5' });
  });
});

describe('GET /api/spend says whether Best can run (a boolean, never the key)', () => {
  it.each([[true], [false]])('anthropic key in .env: %s', async (has) => {
    const api = createApi({ env: env({}, has), root, fetch: upstream([]).f });
    const res = fakeRes();
    await api.handle(fakeReq('GET', '/api/spend'), res, () => {});
    const s = JSON.parse(res.body());
    expect(s.best).toBe(has);
    expect(res.body()).not.toContain(AKEY);
    expect(api.statusLine()).not.toContain(AKEY);
    if (has) expect(api.statusLine()).toContain('best claude-opus-5-5/low');
  });
});
