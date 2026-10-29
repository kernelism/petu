// @vitest-environment node
// The live gate's repair (design 2026-10-29 §6): request body for both providers, the reqId cache, the
// route behind guard, the ledger, the answer record, key scrubbing. Every upstream is a fake: $0.
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { parseEnv } from '../../server/env';
import { createApi, validateRepair, LIMITS } from '../../server/plugin';
import { buildRequest, cacheKey, type ModelConfig } from '../../server/openai';
import { RepairCache, buildRepairRequest, repairBody, REPAIR_TTL_MS, REPAIR_CACHE_MAX } from '../../server/repair';
import { repairNote, boardReport, REPAIR_VERSION, BOARD_CHARS } from '../../server/prompt/repair';
import { MAX_REPAIRS, REPAIR_MAX_OUTPUT } from '../../server/limits';
import type { AskRequest, RepairWire } from '../../src/agent/protocol';
import type { RepairReport } from '../../src/gate/events';

const KEY = 'sk-test-REPAIR-secret-123';
const AKEY = 'sk-ant-test-REPAIR-456';

const report = (over: Partial<RepairReport> = {}): RepairReport => ({
  beat: 'Notice point Z {{circle on=s at=Z}} on the curve.',
  problems: [{ check: 'unknown', detail: 'point Z is not on the board', hint: 'create it with {{point on=s id=Z}}' }, { check: 'named', detail: '"point Z" has no element' }],
  board: [{ section: 's', count: 2, items: [{ id: 'a', kind: 'axes' }, { id: 'c1', kind: 'plot', label: 'demand' }] }, { section: 'old', count: 4 }],
  consts: { g: 9.8 }, finds: ['peak'], later: ['Z'], tail: 'the curve rises then falls as price grows', maxWords: 22,
  ...over,
});
const ask = (over: Partial<AskRequest> = {}): AskRequest => ({
  question: 'Why?', history: [],
  context: { docName: 'd.pdf', docHash: 'h', numPages: 3, page: 2, docText: 'DIGEST', pageText: 'PAGE', image: { b64: 'AAAA', w: 100, h: 100 }, opener: 'It falls.' },
  ...over,
});
const terra: ModelConfig = { model: 'gpt-6.1-terra', effort: 'none', maxOutput: 3200, fast: false, explicitCache: true };

describe('repairNote r1', () => {
  it('has every part of the contract, in order', () => {
    const n = repairNote(report());
    const order = ['GATE REPORT (r1). The beat below was NOT shown', 'FAILED BEAT: Notice point Z {{circle on=s at=Z}}', 'PROBLEMS:', '- unknown: point Z is not on the board (fix: create it with {{point on=s id=Z}})',
      'ON THE BOARD NOW:', 's: a axes; c1 plot "demand"', 'old: 4 elements', 'consts: g=9.8', 'finds: peak', 'LATER BEATS USE: Z',
      'continuing right after "…the curve rises then falls as price grows". Same point, ≤ 22 words.', 'every board number via {{val}}', 'no pointing words and no tags.'];
    let at = -1;
    for (const s of order) { const i = n.indexOf(s); expect(i, s).toBeGreaterThan(at); at = i; }
    expect(REPAIR_VERSION).toBe('r1');
  });
  it('the board report is capped', () => {
    const items = Array.from({ length: 200 }, (_, i) => ({ id: `n${i}`, kind: 'node', label: 'a long label for the element' }));
    expect(boardReport({ board: [{ section: 's', count: 200, items }], consts: {}, finds: [] }).length).toBeLessThanOrEqual(BOARD_CHARS);
  });
});

describe('buildRepairRequest', () => {
  const oa = buildRequest(ask(), terra);
  it('OpenAI: the same body and cache key, then committed (assistant) and the note (user); 450 out, streamed', () => {
    const b = buildRepairRequest(oa, { committed: 'So far so good.', report: report() }, { effort: 'low' }) as any;
    expect(b.prompt_cache_key).toBe(cacheKey());
    expect(b.prompt_cache_options).toEqual(oa.prompt_cache_options);
    expect(b.input.slice(0, oa.input.length)).toEqual(oa.input);
    const [a, u] = b.input.slice(oa.input.length);
    expect(a).toEqual({ role: 'assistant', content: [{ type: 'output_text', text: 'So far so good.' }] });
    expect(u.role).toBe('user');
    expect(u.content[0].text).toBe(repairNote(report()));
    expect(b.max_output_tokens).toBe(REPAIR_MAX_OUTPUT);
    expect(b.reasoning).toEqual({ effort: 'low' });
    expect(b.stream).toBe(true);
    // The breakpoints are untouched (12h system, 30m digest and image).
    expect(JSON.stringify(b.input).match(/prompt_cache_breakpoint/g)?.length).toBe(3);
    expect(oa.max_output_tokens).toBe(3200); // the cached body is not mutated
  });
  it('nothing released yet: no empty assistant turn', () => {
    const b = buildRepairRequest(oa, { committed: '  ', report: report() }, { effort: 'none' }) as any;
    expect(b.input.length).toBe(oa.input.length + 1);
    expect(b.input.at(-1).role).toBe('user');
  });
  it('Anthropic: user → assistant → user, cache_control on the same blocks, thinking per the repair effort, 450 max_tokens', () => {
    const cfg: ModelConfig = { model: 'claude-opus-5-5', effort: 'low', maxOutput: 6000, fast: false, explicitCache: true };
    const o2 = buildRequest(ask({ history: [{ q: 'Before?', a: '', page: 1 }] }), cfg);
    const b = repairBody(o2, { committed: 'Released words.', report: report() }, cfg);
    expect(b.max_tokens).toBe(REPAIR_MAX_OUTPUT);
    expect(b.thinking).toEqual({ type: 'adaptive' });
    expect(b.output_config).toEqual({ effort: 'low' });
    expect(b.stream).toBe(true);
    const roles = b.messages.map((m: any) => m.role);
    expect(roles.slice(-3)).toEqual(['user', 'assistant', 'user']);
    expect(b.messages.at(-2).content).toEqual([{ type: 'text', text: 'Released words.' }]);
    // The empty history answer was dropped (the API rejects empty text blocks).
    expect(JSON.stringify(b.messages)).not.toContain('"text":""');
    expect(b.system[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(JSON.stringify(b).match(/cache_control/g)?.length).toBe(3);
    const haiku: ModelConfig = { ...cfg, model: 'claude-haiku-5-5', effort: 'none' };
    expect(repairBody(buildRequest(ask(), haiku), { committed: '', report: report() }, haiku).thinking).toEqual({ type: 'disabled' });
  });
});

describe('RepairCache', () => {
  it('expires after the TTL and keeps at most 16 answers (oldest out first)', () => {
    let t = 0;
    const c = new RepairCache(() => t);
    const oa = buildRequest(ask(), terra);
    c.put('a', oa, terra, { model: 'm', version: 'v', docHash: 'h', page: 1 });
    t = REPAIR_TTL_MS - 1;
    expect(c.get('a')).toBeDefined();
    t = REPAIR_TTL_MS;
    expect(c.get('a')).toBeUndefined();
    for (let i = 0; i < REPAIR_CACHE_MAX + 3; i++) c.put(`r${i}`, oa, terra, { model: 'm', version: 'v', docHash: 'h', page: 1 });
    expect(c.size).toBe(REPAIR_CACHE_MAX);
    expect(c.get('r0')).toBeUndefined();
    expect(c.get(`r${REPAIR_CACHE_MAX + 2}`)).toBeDefined();
  });
});

describe('validateRepair', () => {
  const ok = (): RepairWire => ({ reqId: 'r', k: 2, committed: 'x', beat: 'b', report: report(), deadlineMs: 3000 });
  it('accepts the contract and refuses what is malformed or too large', () => {
    expect(validateRepair(ok())).toBeNull();
    expect(validateRepair({ ...ok(), reqId: '' })).toMatch(/reqId/);
    expect(validateRepair({ ...ok(), k: -1 })).toMatch(/k/);
    expect(validateRepair({ ...ok(), committed: 'x'.repeat(LIMITS.committed + 1) })).toMatch(/committed/);
    expect(validateRepair({ ...ok(), beat: 'x'.repeat(LIMITS.beat + 1) })).toMatch(/beat/);
    expect(validateRepair({ ...ok(), deadlineMs: 0 })).toMatch(/deadline/);
    expect(validateRepair({ ...ok(), report: { ...report(), problems: [{ check: 1 }] } })).toMatch(/problems/);
    expect(validateRepair({ ...ok(), report: { ...report(), beat: 'x'.repeat(LIMITS.report) } })).toMatch(/report/);
    expect(validateRepair({ ...ok(), report: { ...report(), consts: { a: 'b' } } })).toMatch(/consts/);
  });
});

// ---- the route, end to end (fake upstreams) ---------------------------------------------------

type FakeRes = ServerResponse & { body(): string };
function fakeReq(method: string, url: string, body = '', headers: Record<string, string | undefined> = {}): IncomingMessage {
  const r = Readable.from(body.length ? [Buffer.from(body)] : []) as unknown as IncomingMessage;
  const h: Record<string, string | undefined> = { host: 'localhost:5182', ...(method === 'POST' ? { 'content-type': 'application/json' } : {}), ...headers };
  Object.assign(r, { method, url, headers: Object.fromEntries(Object.entries(h).filter(([, v]) => v !== undefined)) });
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
const oaText = (parts: string[], usage = { input_tokens: 9000, output_tokens: 60, input_tokens_details: { cached_tokens: 8000 } }) =>
  parts.map((d) => sse({ type: 'response.output_text.delta', item_id: 'm1', delta: d })).concat(sse({ type: 'response.completed', response: { status: 'completed', usage } }));
const anText = (parts: string[]) => [sse({ type: 'message_start', message: { usage: { input_tokens: 100, cache_read_input_tokens: 9000 } } }),
  ...parts.map((d) => sse({ type: 'content_block_delta', delta: { type: 'text_delta', text: d } })),
  sse({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 50 } }), sse({ type: 'message_stop' })];

/** A fake upstream that answers each call with the next script: chunks (200), a status + text, or a hang until aborted. */
function upstream(script: ({ chunks: string[] } | { status: number; text: string } | { hang: true })[]) {
  const calls: { url: string; body: any; headers: Record<string, string> }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> });
    const s = script[Math.min(calls.length - 1, script.length - 1)];
    if ('status' in s) return new Response(s.text, { status: s.status });
    const enc = new TextEncoder();
    let i = 0;
    const chunks = 'chunks' in s ? s.chunks : [];
    return new Response(new ReadableStream<Uint8Array>({
      pull(c) {
        if (i < chunks.length) { c.enqueue(enc.encode(chunks[i++])); return; }
        if (!('hang' in s)) { c.close(); return; }
        return new Promise<void>((ok) => init.signal!.addEventListener('abort', () => { c.error(new DOMException('aborted', 'AbortError')); ok(); }));
      },
    }, { highWaterMark: 0 }), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

let root = '';
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'petu-repair-')); mkdirSync(join(root, 'pdfs')); });
const env = (over: Record<string, string> = {}) => parseEnv((k) => ({ OPENAI_API_KEY: KEY, PETU_PDF_DIRS: join(root, 'pdfs'), PETU_PHASE: 'dev', ...over })[k], { root, home: root, fileEnv: (k) => (k === 'PETU_ANTHROPIC_KEY' ? AKEY : undefined) });
const spend = () => JSON.parse(readFileSync(join(root, '.petu/spend.json'), 'utf8'));
const records = () => (existsSync(join(root, '.petu/answers.jsonl')) ? readFileSync(join(root, '.petu/answers.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);

async function post(api: ReturnType<typeof createApi>, path: string, body: unknown, headers: Record<string, string | undefined> = {}) {
  const res = fakeRes();
  await api.handle(fakeReq('POST', path, JSON.stringify(body), headers), res, () => { throw new Error('next'); });
  return res;
}
/** Asks once (the fake upstream's first script), returns the reqId from meta. */
async function answer(api: ReturnType<typeof createApi>): Promise<string> {
  const res = await post(api, '/api/ask', ask());
  const meta = lines(res).find((e) => e.t === 'meta');
  expect(meta).toBeDefined();
  return meta.reqId;
}
const wire = (reqId: string, over: Partial<RepairWire> = {}): RepairWire => ({ reqId, phase: 'dev', k: 2, committed: 'Released so far.', beat: report().beat, report: report(), deadlineMs: 5000, ...over });

describe('POST /api/repair', () => {
  it('resends the cached answer body with the note, streams the replacement, books kind repair, writes a record', async () => {
    const { f, calls } = upstream([{ chunks: oaText(['The answer.']) }, { chunks: oaText(['Point ', '{{point on=s id=Z at=4,2}} Z sits here.']) }]);
    const api = createApi({ env: env(), root, fetch: f });
    const reqId = await answer(api);
    const res = await post(api, '/api/repair', wire(reqId));
    expect(res.statusCode).toBe(200);
    const ev = lines(res);
    expect(ev.filter((e) => e.t === 'text').map((e) => e.d).join('')).toBe('Point {{point on=s id=Z at=4,2}} Z sits here.');
    const done = ev.at(-1);
    expect(done.t).toBe('done');
    expect(done.usd).toBeGreaterThan(0);
    expect(done.estimated).toBe(false);
    // Same prefix and key as the answer.
    const [a, r] = calls.map((c) => c.body);
    expect(r.prompt_cache_key).toBe(a.prompt_cache_key);
    expect(r.input.slice(0, a.input.length)).toEqual(a.input);
    expect(r.max_output_tokens).toBe(REPAIR_MAX_OUTPUT);
    const entry = spend().entries.find((e: any) => e.kind === 'repair');
    expect(entry).toMatchObject({ kind: 'repair', model: 'gpt-6.1-terra', phase: 'dev', estimated: false });
    expect(spend().open ?? {}).toEqual({});
    const rec = records().find((x) => x.kind === 'repair');
    expect(rec).toMatchObject({ kind: 'repair', reqId, k: 2, text: 'Point {{point on=s id=Z at=4,2}} Z sits here.', version: 'r1' });
    expect(rec.report.later).toEqual(['Z']);
  });

  it('Anthropic answer model: the repair goes to Messages with the same cached blocks', async () => {
    const { f, calls } = upstream([{ chunks: anText(['Answer.']) }, { chunks: anText(['Fixed beat.']) }]);
    const api = createApi({ env: env({ PETU_MODEL: 'claude-opus-5-5', PETU_EFFORT: 'low' }), root, fetch: f });
    const reqId = await answer(api);
    const res = await post(api, '/api/repair', wire(reqId));
    expect(lines(res).filter((e) => e.t === 'text').map((e) => e.d).join('')).toBe('Fixed beat.');
    expect(calls[1].url).toMatch(/anthropic/);
    expect(calls[1].body.system).toEqual(calls[0].body.system);
    expect(calls[1].body.messages.map((m: any) => m.role).slice(-3)).toEqual(['user', 'assistant', 'user']);
    expect(calls[1].body.max_tokens).toBe(REPAIR_MAX_OUTPUT);
    expect(calls[1].headers['x-api-key']).toBe(AKEY);
  });

  it('PETU_REPAIR_EFFORT sets the repair effort (default: stage 2’s)', async () => {
    const { f, calls } = upstream([{ chunks: oaText(['A.']) }, { chunks: oaText(['B.']) }]);
    const api = createApi({ env: env({ PETU_REPAIR_EFFORT: 'low' }), root, fetch: f });
    await post(api, '/api/repair', wire(await answer(api)));
    expect(calls[1].body.reasoning).toEqual({ effort: 'low' });
    expect(parseEnv(() => undefined, { root, home: root }).repair).toMatchObject({ effort: 'none', maxOutput: REPAIR_MAX_OUTPUT });
    expect(() => parseEnv((k) => ({ PETU_MODEL: 'claude-opus-5-5', PETU_EFFORT: 'low', PETU_REPAIR_EFFORT: 'none' })[k], { root, home: root })).toThrow(/REPAIR_EFFORT/);
  });

  it('refusals: 404 unknown reqId, 429 past MAX_REPAIRS, 400 phase mismatch or bad body, 503 when off, 403 off-origin (guard)', async () => {
    const { f, calls } = upstream([{ chunks: oaText(['A.']) }]);
    const api = createApi({ env: env(), root, fetch: f });
    expect((await post(api, '/api/repair', wire('nope'))).statusCode).toBe(404);
    const reqId = await answer(api);
    expect((await post(api, '/api/repair', wire(reqId, { phase: 'iterate' }))).statusCode).toBe(400);
    expect((await post(api, '/api/repair', { ...wire(reqId), beat: '' })).statusCode).toBe(400);
    expect((await post(api, '/api/repair', wire(reqId), { origin: 'http://evil.example' })).statusCode).toBe(403);
    expect((await post(api, '/api/repair', wire(reqId), { 'content-type': 'text/plain' })).statusCode).toBe(415);
    for (let i = 0; i < MAX_REPAIRS; i++) expect((await post(api, '/api/repair', wire(reqId))).statusCode).toBe(200);
    const over = await post(api, '/api/repair', wire(reqId));
    expect(over.statusCode).toBe(429);
    expect(JSON.parse(over.body())).toMatchObject({ t: 'error', code: 'too_many' });
    expect(calls.length).toBe(1 + MAX_REPAIRS);
    const off = createApi({ env: env({ PETU_REPAIR: 'off' }), root, fetch: upstream([{ chunks: oaText(['A.']) }]).f });
    expect((await post(off, '/api/repair', wire(await answer(off)))).statusCode).toBe(503);
  });

  it('the ledger refuses (cap): 402 with the cap line, nothing sent, the repair not counted', async () => {
    const { f, calls } = upstream([{ chunks: oaText(['A.']) }, { chunks: oaText(['B.']) }]);
    const api = createApi({ env: env(), root, fetch: f });
    const reqId = await answer(api);
    // Something else used up the phase budget meanwhile.
    api.ledger.settle({ id: 'x', phase: 'dev', kind: 'answer', model: 'gpt-6.1-terra', usd: 0.9999 });
    const res = await post(api, '/api/repair', wire(reqId));
    expect(res.statusCode).toBe(402);
    expect(JSON.parse(res.body())).toMatchObject({ t: 'error', code: 'cap' });
    expect(JSON.parse(res.body()).message).toMatch(/PETU_CAP_DEV/);
    expect(calls.length).toBe(1);
  });

  it('the deadline aborts the upstream: error late, booked as an estimate', async () => {
    const { f } = upstream([{ chunks: oaText(['A.']) }, { hang: true }]);
    const api = createApi({ env: env(), root, fetch: f });
    const reqId = await answer(api);
    const res = await post(api, '/api/repair', wire(reqId, { deadlineMs: 30 }));
    const last = lines(res).at(-1);
    expect(last).toMatchObject({ t: 'error', code: 'late' });
    const e = spend().entries.find((x: any) => x.kind === 'repair');
    expect(e.estimated).toBe(true);
    expect(e.usd).toBeGreaterThan(0);
    expect(spend().open ?? {}).toEqual({});
  });

  it('an upstream HTTP error frees the reservation; the key never reaches the client, the record or the ledger', async () => {
    const { f } = upstream([{ chunks: oaText(['A.']) }, { status: 401, text: `bad key ${KEY} for you` }, { chunks: [sse({ type: 'error', message: `stream broke near ${KEY}` })] }]);
    const api = createApi({ env: env(), root, fetch: f });
    const reqId = await answer(api);
    const r1 = await post(api, '/api/repair', wire(reqId));
    const r2 = await post(api, '/api/repair', wire(reqId));
    for (const r of [r1, r2]) {
      expect(lines(r).at(-1).t).toBe('error');
      expect(r.body()).not.toContain(KEY);
      expect(r.body()).toContain('***');
    }
    expect(spend().entries.filter((x: any) => x.kind === 'repair').length).toBe(1); // the 401 sent nothing billable
    expect(readFileSync(join(root, '.petu/answers.jsonl'), 'utf8')).not.toContain(KEY);
    expect(readFileSync(join(root, '.petu/spend.json'), 'utf8')).not.toContain(KEY);
  });
});
