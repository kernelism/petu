// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadPetuEnv, parseEnv, PHASE_CAPS, MAX_TOTAL_USD } from '../../server/env';
import { createApi } from '../../server/plugin';
import { STT_MINT_URL, STT_WS_URL } from '../../server/stt';
import type { AskEvent, AskRequest } from '../../src/agent/protocol';

const KEY = 'sk-test-PLUGIN-xyz';

describe('parseEnv', () => {
  const from = (o: Record<string, string>) => (k: string) => o[k];
  const opts = { root: '/repo', home: '/home/u' };
  it('defaults: terra/none (answer and scout), founder phase with $3/day, phase caps incl. the lesson phases, $80 total, prior $0.0076', () => {
    const e = parseEnv(from({}), opts);
    expect(e.key).toBe('');
    expect(e.model).toEqual({ model: 'gpt-6.1-terra', effort: 'none', maxOutput: 4800 });
    expect(e.scout).toEqual({ model: 'gpt-6.1-terra', effort: 'none', maxOutput: 600 });
    expect(e.phase).toBe('founder');
    expect(e.caps).toEqual({ totalUsd: 80, dailyUsd: 3, phaseUsd: PHASE_CAPS });
    expect(PHASE_CAPS).toEqual({ dev: 1, bakeoff: 6, iterate: 7, validate: 2, founder: 21.99, lessondev: 1.5, lessonbake: 3, lessoniter: 3.5, lessonval: 2, bench: 15 });
    expect(e.priorUsd).toBe(0.0076);
    expect(e.pdfDirs).toEqual(['/home/u/Documents/670/contents', '/repo/public/dev']);
  });
  it('phases other than founder have no daily cap; per-phase caps and knobs are read', () => {
    const e = parseEnv(from({ PETU_PHASE: 'bakeoff', PETU_CAP_BAKEOFF: '5', PETU_MODEL: 'gpt-6-luna', PETU_EFFORT: 'low', PETU_MAX_OUTPUT: '900', PETU_PDF_DIRS: '~/a, /b', OPENAI_API_KEY: KEY }), opts);
    expect(e.phase).toBe('bakeoff');
    expect(e.caps.dailyUsd).toBeUndefined();
    expect(e.caps.phaseUsd?.bakeoff).toBe(5);
    expect(e.model).toEqual({ model: 'gpt-6-luna', effort: 'low', maxOutput: 900 });
    expect(e.pdfDirs).toEqual(['/home/u/a', '/b']);
    expect(e.key).toBe(KEY);
  });
  it('the lesson phases: selectable, no daily cap, their own budgets (overridable per run)', () => {
    for (const [p, cap] of [['lessondev', 1.5], ['lessonbake', 3], ['lessoniter', 3.5], ['lessonval', 2], ['bench', 15]] as const) {
      const e = parseEnv(from({ PETU_PHASE: p }), opts);
      expect(e.phase).toBe(p);
      expect(e.caps.dailyUsd).toBeUndefined();
      expect(e.caps.phaseUsd?.[p]).toBe(cap);
      expect(e.caps.totalUsd).toBe(80);
    }
    expect(parseEnv(from({ PETU_PHASE: 'lessondev', PETU_CAP_LESSONDEV: '0.5' }), opts).caps.phaseUsd?.lessondev).toBe(0.5);
    // The founder reserve and daily cap are unchanged.
    expect(PHASE_CAPS.founder).toBe(21.99);
    expect(parseEnv(from({}), opts).caps.dailyUsd).toBe(3);
  });
  it('the scout model is a knob of its own', () => {
    const e = parseEnv(from({ PETU_SCOUT_MODEL: 'gpt-6-luna' }), opts);
    expect(e.scout.model).toBe('gpt-6-luna');
    expect(e.model.model).toBe('gpt-6.1-terra');
    expect(() => parseEnv(from({ PETU_SCOUT_MODEL: 'gpt-9' }), opts)).toThrow(/PETU_SCOUT_MODEL/);
    expect(() => parseEnv(from({ PETU_SCOUT_MODEL: 'gpt-6.1-sol' }), opts)).toThrow(/none/);
  });
  it('the total can be lowered but never raised past $80', () => {
    expect(parseEnv(from({ PETU_TOTAL_CAP_USD: '0' }), opts).caps.totalUsd).toBe(0);
    expect(parseEnv(from({ PETU_TOTAL_CAP_USD: '100' }), opts).caps.totalUsd).toBe(MAX_TOTAL_USD);
  });
  it('SPEECHMATICS_API_KEY: trimmed, \'\' when unset, the shell\'s over the .env file\'s', () => {
    expect(parseEnv(from({}), opts).speechmaticsKey).toBe('');
    expect(parseEnv(from({ SPEECHMATICS_API_KEY: ' k ' }), opts).speechmaticsKey).toBe('k');
    const load = (file: Record<string, string>, proc: Record<string, string> = {}) => loadPetuEnv('development', '/repo', '/repo', (() => ({ ...file, ...proc })) as never, proc as NodeJS.ProcessEnv);
    expect(load({ SPEECHMATICS_API_KEY: 'file' }).speechmaticsKey).toBe('file');
    expect(load({ SPEECHMATICS_API_KEY: 'file' }, { SPEECHMATICS_API_KEY: 'shell' }).speechmaticsKey).toBe('shell');
  });
  it('rejects bad knobs, including effort none on models that refuse it', () => {
    expect(() => parseEnv(from({ PETU_EFFORT: 'max' }), opts)).toThrow(/PETU_EFFORT/);
    expect(() => parseEnv(from({ PETU_MODEL: 'gpt-9' }), opts)).toThrow(/PETU_MODEL/);
    expect(() => parseEnv(from({ PETU_MODEL: 'gpt-6.1-sol', PETU_EFFORT: 'none' }), opts)).toThrow(/none/);
    expect(() => parseEnv(from({ PETU_PHASE: 'spike' }), opts)).toThrow(/PETU_PHASE/);
    expect(() => parseEnv(from({ PETU_DAILY_CAP_USD: 'lots' }), opts)).toThrow(/PETU_DAILY_CAP_USD/);
  });
});

// ---- fake req / res -------------------------------------------------------------------------

type FakeRes = ServerResponse & { body(): string; headersSent_: Record<string, string | number> };
function fakeReq(method: string, url: string, body: string | Buffer = '', headers: Record<string, string | undefined> = {}): IncomingMessage {
  const r = Readable.from(body.length ? [Buffer.from(body)] : []) as unknown as IncomingMessage;
  // A same-origin request from the app by default; tests override any header (undefined removes it).
  const h: Record<string, string | undefined> = { host: 'localhost:5180', ...(method === 'POST' ? { 'content-type': 'application/json' } : {}), ...headers };
  Object.assign(r, { method, url, headers: Object.fromEntries(Object.entries(h).filter(([, v]) => v !== undefined)) });
  return r;
}
function fakeRes(): FakeRes {
  const chunks: Buffer[] = [];
  const w = new Writable({ write(c, _e, cb) { chunks.push(Buffer.from(c)); cb(); } }) as unknown as FakeRes;
  const hs: Record<string, string | number> = {};
  Object.assign(w, {
    statusCode: 200,
    headersSent_: hs,
    setHeader(k: string, v: string | number) { hs[k.toLowerCase()] = v; return w; },
    getHeader(k: string) { return hs[k.toLowerCase()]; },
    flushHeaders() { /* noop */ },
    body: () => Buffer.concat(chunks).toString('utf8'),
  });
  return w;
}
const lines = (res: FakeRes) => res.body().split('\n').filter(Boolean).map((l) => JSON.parse(l) as AskEvent);

const sse = (o: object) => `data: ${JSON.stringify(o)}\n\n`;
const usage = { input_tokens: 9000, output_tokens: 700 };
const okChunks = ['Disparity ', 'halves.'].map((d) => sse({ type: 'response.output_text.delta', item_id: 'm1', delta: d }))
  .concat(sse({ type: 'response.completed', response: { status: 'completed', usage } }));

/** A fake upstream: streams `chunks`, then (if `hang`) waits until aborted. */
function upstream(chunks: string[], hang = false) {
  const seen: { signal?: AbortSignal }[] = [];
  const f = (async (_u: string, init: RequestInit) => {
    seen.push({ signal: init.signal ?? undefined });
    const enc = new TextEncoder();
    let i = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (i < chunks.length) { c.enqueue(enc.encode(chunks[i++])); return; }
        if (!hang) { c.close(); return; }
        return new Promise<void>((ok) => init.signal!.addEventListener('abort', () => { c.error(new DOMException('aborted', 'AbortError')); ok(); }));
      },
    }, { highWaterMark: 0 });
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch;
  return { f, seen };
}

let root = '';
let pdfDir = '';
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'petu-root-'));
  pdfDir = join(root, 'pdfs');
  mkdirSync(pdfDir);
  writeFileSync(join(pdfDir, 'lec.pdf'), '%PDF-1.4 fake');
});
const env = (over: Record<string, string> = {}) => parseEnv((k) => ({ OPENAI_API_KEY: KEY, PETU_PDF_DIRS: pdfDir, ...over })[k], { root, home: root });
const good = (over: Partial<AskRequest> = {}): AskRequest => ({
  question: 'Why?', history: [],
  context: { docName: 'd.pdf', docHash: 'h', numPages: 3, page: 2, docText: 'D', pageText: 'P', image: { b64: 'AAAA', w: 100, h: 100 } },
  ...over,
});

describe('createApi', () => {
  it('writes the ledger seeded with the prior spend and an eval token under .petu/', () => {
    const api = createApi({ env: env(), root, fetch: upstream([]).f });
    expect(JSON.parse(readFileSync(join(root, '.petu/spend.json'), 'utf8')).priorUsd).toBe(0.0076);
    expect(readFileSync(join(root, '.petu/eval-token'), 'utf8')).toBe(api.token);
    expect(api.statusLine()).toBe('petu: model gpt-6.1-terra/none · spent $0.01 of $80 · phase founder');
    expect(api.statusLine()).not.toContain(KEY);
  });

  it('uses the eval runner\'s PETU_EVAL_TOKEN and leaves another server\'s token file alone', () => {
    mkdirSync(join(root, '.petu'), { recursive: true });
    writeFileSync(join(root, '.petu/eval-token'), 'founder-token');
    const api = createApi({ env: env({ PETU_EVAL_TOKEN: 'runner-token' }), root, fetch: upstream([]).f });
    expect(api.token).toBe('runner-token');
    expect(readFileSync(join(root, '.petu/eval-token'), 'utf8')).toBe('founder-token');
  });

  it('400 on bad bodies', async () => {
    const api = createApi({ env: env(), root, fetch: upstream([]).f });
    const bad: unknown[] = [
      '{}', 'not json', { ...good(), question: '' }, { ...good(), question: 'x'.repeat(2001) },
      { ...good(), history: Array(4).fill({ q: 'q', a: 'a', page: 1 }) },
      { ...good(), context: { ...good().context, page: 4 } },
      { ...good(), context: { ...good().context, image: undefined } },
      { ...good(), context: { ...good().context, image: { b64: '', w: 1, h: 1 } } },
      { ...good(), context: { ...good().context, image: { b64: 'AAAA', w: 4000, h: 100 } } },
      { ...good(), context: { ...good().context, docText: 'x'.repeat(120_001) } },
      { ...good(), context: { ...good().context, pagesText: 'x'.repeat(120_001) } },
      { ...good(), context: { ...good().context, images: Array(4).fill({ page: 1, b64: 'AAAA', w: 10, h: 10 }) } },
      { ...good(), context: { ...good().context, images: [{ page: 9, b64: 'AAAA', w: 10, h: 10 }] } },
      { ...good(), context: { ...good().context, scout: { pages: [1, 7], plan: '' } } },
      { ...good(), context: { ...good().context, scout: { pages: [1], plan: 'x'.repeat(2001) } } },
      { ...good(), context: { ...good().context, pageText: 'x'.repeat(60_001) } },
      { ...good(), context: { ...good().context, opener: 'x'.repeat(2_001) } },
      { ...good(), context: { ...good().context, opener: 42 } },
      { ...good(), context: { ...good().context, ink: { summary: 'x'.repeat(4_001) } } },
    ];
    for (const b of bad) {
      const res = fakeRes();
      await api.handle(fakeReq('POST', '/api/ask', typeof b === 'string' ? b : JSON.stringify(b)), res, () => {});
      expect(res.statusCode, JSON.stringify(b).slice(0, 80)).toBe(400);
      expect(JSON.parse(res.body())).toMatchObject({ t: 'error', code: 'bad_request' });
    }
  });

  it('413 on bodies over 12 MB', async () => {
    const api = createApi({ env: env(), root, fetch: upstream([]).f });
    const res = fakeRes();
    await api.handle(fakeReq('POST', '/api/ask', Buffer.alloc(12 * 1024 * 1024 + 1, 32)), res, () => {});
    expect(res.statusCode).toBe(413);
  });

  it('streams NDJSON: headers, one event per line, meta first, done last', async () => {
    const { f } = upstream(okChunks);
    const api = createApi({ env: env(), root, fetch: f });
    const res = fakeRes();
    await api.handle(fakeReq('POST', '/api/ask', JSON.stringify(good())), res, () => {});
    expect(res.headersSent_['content-type']).toBe('application/x-ndjson; charset=utf-8');
    expect(res.headersSent_['cache-control']).toBe('no-store');
    expect(res.body().endsWith('\n')).toBe(true);
    const ev = lines(res);
    expect(ev[0].t).toBe('meta');
    expect(ev.filter((e) => e.t === 'text').map((e) => (e as { d: string }).d).join('')).toBe('Disparity halves.');
    expect(ev[ev.length - 1].t).toBe('done');
    expect(res.writableEnded).toBe(true);
    expect(res.body()).not.toContain(KEY);
  });

  it('no key → a no_key event, nothing sent upstream', async () => {
    const { f, seen } = upstream(okChunks);
    const api = createApi({ env: env({ OPENAI_API_KEY: '' }), root, fetch: f });
    const res = fakeRes();
    await api.handle(fakeReq('POST', '/api/ask', JSON.stringify(good())), res, () => {});
    expect(lines(res)).toEqual([expect.objectContaining({ t: 'error', code: 'no_key' })]);
    expect(seen).toHaveLength(0);
  });

  it('aborts upstream when the client goes away mid-answer, and books an estimate', async () => {
    const { f, seen } = upstream(okChunks.slice(0, 1), true);
    const api = createApi({ env: env(), root, fetch: f });
    const res = fakeRes();
    const origWrite = res.write.bind(res);
    (res as unknown as { write: typeof res.write }).write = ((c: string) => {
      const ok = origWrite(c);
      if (String(c).includes('"t":"text"')) setTimeout(() => res.destroy(), 0);
      return ok;
    }) as typeof res.write;
    await api.handle(fakeReq('POST', '/api/ask', JSON.stringify(good())), res, () => {});
    expect(seen[0].signal?.aborted).toBe(true);
    const book = JSON.parse(readFileSync(join(root, '.petu/spend.json'), 'utf8'));
    expect(book.entries).toEqual([expect.objectContaining({ estimated: true, kind: 'answer', phase: 'founder' })]);
  });

  it('rejects a request tagged with a different phase than the server runs', async () => {
    const api = createApi({ env: env(), root, fetch: upstream(okChunks).f });
    const res = fakeRes();
    await api.handle(fakeReq('POST', '/api/ask', JSON.stringify(good({ phase: 'bakeoff' }))), res, () => {});
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/spend returns the seeded prior and the founder daily cap', async () => {
    const api = createApi({ env: env(), root, fetch: upstream([]).f });
    const res = fakeRes();
    await api.handle(fakeReq('GET', '/api/spend'), res, () => {});
    const s = JSON.parse(res.body());
    expect(s).toMatchObject({ totalUsd: 0.0076, capUsd: 80, todayUsd: 0, dailyCapUsd: 3, phase: 'founder', phaseCapUsd: 21.99 });
    expect(s.blocked).toBeUndefined();
  });

  it('GET /api/spend reports blocked when a typical answer would be refused', async () => {
    const api = createApi({ env: env({ PETU_TOTAL_CAP_USD: '0' }), root, fetch: upstream([]).f });
    const res = fakeRes();
    await api.handle(fakeReq('GET', '/api/spend'), res, () => {});
    expect(JSON.parse(res.body()).blocked).toMatch(/Spending stopped/);
  });

  it('POST /api/prewarm warms the answer prefix (per docHash+page) and the scout prefix (per digest+page, with the visible listing), each deduped', async () => {
    const bodies: any[] = [];
    const f = (async (_u: string, init: RequestInit) => { bodies.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ usage: { input_tokens: 100, output_tokens: 0 } }), { status: 200 }); }) as unknown as typeof fetch;
    const api = createApi({ env: env(), root, fetch: f });
    for (let i = 0; i < 2; i++) {
      const res = fakeRes();
      await api.handle(fakeReq('POST', '/api/prewarm', JSON.stringify({ context: good().context })), res, () => {});
      expect(JSON.parse(res.body()).ok).toBe(true);
    }
    expect(bodies).toHaveLength(2);
    const keys = bodies.map((b) => b.prompt_cache_key).sort();
    expect(keys[0]).toMatch(/^petu-p/);
    expect(keys[1]).toMatch(/^petu-scout-/);
    expect(bodies.every((b) => b.prompt_cache_options?.prewarm === true)).toBe(true);
    const scoutBody = bodies.find((b) => b.prompt_cache_key.startsWith('petu-scout-'));
    expect(scoutBody.input[1].content).toHaveLength(2); // digest + the visible page's listing
    // Another page of the same document: both prefixes are new (the scout's holds the visible listing).
    const res = fakeRes();
    await api.handle(fakeReq('POST', '/api/prewarm', JSON.stringify({ context: { ...good().context, page: 3 } })), res, () => {});
    expect(bodies).toHaveLength(4);
  });

  it('POST /api/scout streams NDJSON: opener sentences, the verdict, the cost; a bad upstream reply falls back to the visible page', async () => {
    const sseOf = (text: string) => [
      `data: ${JSON.stringify({ type: 'response.output_item.added', item: { id: 's', type: 'message' } })}\n\n`,
      ...text.match(/.{1,7}/gs)!.map((d) => `data: ${JSON.stringify({ type: 'response.output_text.delta', item_id: 's', delta: d })}\n\n`),
      `data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 900, output_tokens: 40 } } })}\n\n`,
    ];
    const reply = (text: string) => (async () => new Response(new ReadableStream<Uint8Array>({
      start(c) { for (const x of sseOf(text)) c.enqueue(new TextEncoder().encode(x)); c.close(); },
    }), { status: 200 })) as unknown as typeof fetch;
    const body = { question: 'How does it work?', docName: 'd.pdf', docHash: 'h', numPages: 9, page: 2, digest: 'DECK d.pdf (9 pages)\np1: a', pageText: 'PAGE 2 (visible)' };
    const run = async (f: typeof fetch, b: object = body) => {
      const api = createApi({ env: env(), root, fetch: f });
      const res = fakeRes();
      await api.handle(fakeReq('POST', '/api/scout', JSON.stringify(b)), res, () => {});
      return { status: res.statusCode, type: String(res.getHeader('content-type')), out: res.statusCode === 200 ? lines(res) as any[] : JSON.parse(res.body()) };
    };
    const ok = await run(reply(JSON.stringify({ opener: 'It votes. {{circle p=2 mark=#d1}}Here.', pages: [4, 5, 2], plan: 'walk 4 then 5' })));
    expect(ok.status).toBe(200);
    expect(ok.type).toMatch(/ndjson/);
    expect(ok.out.map((e: any) => e.t)).toEqual(['opener', 'opener', 'scout', 'end']);
    expect(ok.out[0].d + ok.out[1].d).toBe('It votes. {{circle p=2 mark=#d1}}Here.');
    expect(ok.out[2]).toMatchObject({ pages: [4, 5, 2], plan: 'walk 4 then 5' });
    expect(ok.out[2].fallback).toBeUndefined();
    expect(ok.out[3].usd).toBeGreaterThan(0);
    const junk = await run(reply('I think page 4'));
    expect(junk.out.find((e: any) => e.t === 'scout')).toMatchObject({ pages: [2], fallback: expect.any(String) });
    const down = await run((async () => new Response('nope', { status: 500 })) as unknown as typeof fetch);
    expect(down.out.find((e: any) => e.t === 'scout')).toMatchObject({ pages: [2], fallback: expect.stringMatching(/scout failed/) });
    expect((await run(reply('{}'), { ...body, page: 10 })).status).toBe(400);
    expect((await run(reply('{}'), { ...body, digest: '' })).status).toBe(400);
    expect((await run(reply('{}'), { ...body, pageText: 7 })).status).toBe(400);
  });

  it('POST /api/scout keeps the request guard', async () => {
    const api = createApi({ env: env(), root, fetch: upstream([]).f });
    const res = fakeRes();
    await api.handle(fakeReq('POST', '/api/scout', '{}', { 'content-type': 'text/plain' }), res, () => {});
    expect(res.statusCode).toBe(415);
  });

  it('POST /api/prewarm { scope: system } warms the shared system block once', async () => {
    const bodies: any[] = [];
    const f = (async (_u: string, init: RequestInit) => { bodies.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ usage: { input_tokens: 4100, output_tokens: 0, input_tokens_details: { cache_write_tokens: 4100 } } }), { status: 200 }); }) as unknown as typeof fetch;
    const api = createApi({ env: env(), root, fetch: f });
    const out: any[] = [];
    for (let i = 0; i < 2; i++) {
      const res = fakeRes();
      await api.handle(fakeReq('POST', '/api/prewarm', JSON.stringify({ scope: 'system' })), res, () => {});
      out.push(JSON.parse(res.body()));
    }
    expect(bodies).toHaveLength(1);
    expect(bodies[0].input).toHaveLength(1);
    expect(bodies[0].input[0].role).toBe('developer');
    expect(out[0]).toMatchObject({ ok: true });
    expect(out[1]).toMatchObject({ ok: true, usd: 0, reason: 'cached' });
  });

  it('POST /api/judge needs the eval token', async () => {
    const api = createApi({ env: env(), root, fetch: upstream([]).f });
    const res = fakeRes();
    await api.handle(fakeReq('POST', '/api/judge', '{}', { 'x-petu-eval': 'wrong' }), res, () => {});
    expect(res.statusCode).toBe(403);
  });

  it('/api/dev-pdf serves basenames from PETU_PDF_DIRS only', async () => {
    const api = createApi({ env: env(), root, fetch: upstream([]).f });
    const get = async (name: string) => {
      const res = fakeRes();
      await api.handle(fakeReq('GET', `/api/dev-pdf/${name}`), res, () => {});
      if (!res.writableEnded) await new Promise((ok) => res.on('finish', ok));
      return res;
    };
    const ok = await get('lec.pdf');
    expect(ok.statusCode).toBe(200);
    expect(ok.headersSent_['content-type']).toBe('application/pdf');
    expect(ok.body()).toBe('%PDF-1.4 fake');
    expect((await get('..%2Fx.pdf')).statusCode).toBe(400);
    expect((await get('../x.pdf')).statusCode).toBe(400);
    expect((await get('a%2F..%2Flec.pdf')).statusCode).toBe(400);
    expect((await get('notes.txt')).statusCode).toBe(400);
    expect((await get('missing.pdf')).statusCode).toBe(404);
  });

  it('leaves other routes to the next middleware', async () => {
    const api = createApi({ env: env(), root, fetch: upstream([]).f });
    let nexted = false;
    await api.handle(fakeReq('GET', '/src/main.tsx'), fakeRes(), () => { nexted = true; });
    expect(nexted).toBe(true);
    expect(existsSync(join(root, '.petu'))).toBe(true);
  });

  describe('only the app itself may call /api/* (DNS rebinding, cross-site POSTs)', () => {
    const call = async (method: string, url: string, headers: Record<string, string | undefined>, body = '') => {
      const { f, seen } = upstream(okChunks);
      const api = createApi({ env: env(), root, fetch: f });
      const res = fakeRes();
      let nexted = false;
      await api.handle(fakeReq(method, url, body, headers), res, () => { nexted = true; });
      if (!nexted && !res.writableEnded) await new Promise((ok) => res.on('finish', ok));
      return { res, seen, nexted };
    };
    const ask = JSON.stringify(good());

    it('allows the app: localhost, 127.0.0.1 and [::1] hosts, same-origin Origin or none', async () => {
      for (const h of [
        { host: 'localhost:5180', origin: 'http://localhost:5180' },
        { host: '127.0.0.1:5186', origin: 'http://127.0.0.1:5186' },
        { host: '[::1]:5180', origin: 'http://[::1]:5180' },
        { host: 'localhost:5180', origin: undefined },
        { host: 'LOCALHOST:5180', origin: 'https://localhost:5180' },
      ]) {
        const { res, seen } = await call('POST', '/api/ask', h, ask);
        expect(res.statusCode, JSON.stringify(h)).toBe(200);
        expect(seen).toHaveLength(1);
      }
      expect((await call('GET', '/api/spend', { host: '127.0.0.1:5199' })).res.statusCode).toBe(200);
      expect((await call('GET', '/api/dev-pdf/lec.pdf', { host: 'localhost:5180' })).res.statusCode).toBe(200);
    });

    it('403 on any other Host (a rebound DNS name), nothing sent upstream, no PDF served', async () => {
      for (const host of ['evil.example:5180', 'localhost.evil.example:5180', '192.168.1.5:5180', '0.0.0.0:5180', undefined]) {
        const a = await call('POST', '/api/ask', { host }, ask);
        expect(a.res.statusCode, String(host)).toBe(403);
        expect(a.seen).toHaveLength(0);
        expect((await call('GET', '/api/dev-pdf/lec.pdf', { host })).res.statusCode).toBe(403);
        expect((await call('GET', '/api/spend', { host })).res.statusCode).toBe(403);
      }
    });

    it('403 on a foreign or mismatched Origin', async () => {
      for (const origin of ['https://evil.example', 'http://localhost:5181', 'http://127.0.0.1:5180', 'null', 'file://']) {
        const a = await call('POST', '/api/ask', { origin }, ask);
        expect(a.res.statusCode, origin).toBe(403);
        expect(a.seen).toHaveLength(0);
        expect((await call('GET', '/api/spend', { origin })).res.statusCode).toBe(403);
      }
    });

    it('415 on a POST that is not application/json (a no-preflight text/plain or form POST)', async () => {
      for (const ct of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', undefined]) {
        for (const url of ['/api/ask', '/api/prewarm']) {
          const a = await call('POST', url, { 'content-type': ct }, ask);
          expect(a.res.statusCode, `${url} ${ct}`).toBe(415);
          expect(a.seen).toHaveLength(0);
        }
      }
      expect((await call('POST', '/api/ask', { 'content-type': 'application/json; charset=utf-8' }, ask)).res.statusCode).toBe(200);
    });

    it('OPTIONS (a CORS preflight) is refused without CORS headers', async () => {
      const a = await call('OPTIONS', '/api/ask', { origin: 'https://evil.example', 'access-control-request-method': 'POST' });
      expect([403, 405]).toContain(a.res.statusCode);
      expect(a.res.headersSent_['access-control-allow-origin']).toBeUndefined();
      const b = await call('OPTIONS', '/api/ask', {});
      expect(b.res.statusCode).toBe(405);
    });

    it('leaves non-API paths to Vite (its own host check applies there)', async () => {
      expect((await call('GET', '/src/main.tsx', { host: 'evil.example' })).nexted).toBe(true);
    });
  });

  it('a hung system prewarm times out and frees the one-at-a-time slot', async () => {
    let calls = 0;
    const f = (async (_u: string, init: RequestInit) => {
      calls++;
      return new Promise((_ok, bad) => init.signal!.addEventListener('abort', () => bad(new DOMException('timeout', 'TimeoutError'))));
    }) as unknown as typeof fetch;
    const api = createApi({ env: env(), root, fetch: f, timeouts: { callMs: 20 } });
    const post = async () => { const res = fakeRes(); await api.handle(fakeReq('POST', '/api/prewarm', JSON.stringify({ scope: 'system' })), res, () => {}); return JSON.parse(res.body()); };
    expect(await post()).toMatchObject({ ok: false });
    const n = calls;
    expect(n).toBeGreaterThan(0);
    expect(await post()).toMatchObject({ ok: false });
    expect(calls).toBeGreaterThan(n); // not 'deduped' by a stuck slot
  });

  it('the prewarm dedupe map stays bounded', async () => {
    const f = (async () => new Response(JSON.stringify({ usage: { input_tokens: 100, output_tokens: 0 } }), { status: 200 })) as unknown as typeof fetch;
    let t = 0;
    const api = createApi({ env: env(), root, fetch: f, now: () => t });
    for (let p = 1; p <= 300; p++) {
      const res = fakeRes();
      await api.handle(fakeReq('POST', '/api/prewarm', JSON.stringify({ context: { ...good().context, numPages: 400, page: p } })), res, () => {});
    }
    expect(api.prewarmedCount()).toBe(256);
    t += 26 * 60 * 1000; // past the TTL: the next prewarm clears every expired key
    const res = fakeRes();
    await api.handle(fakeReq('POST', '/api/prewarm', JSON.stringify({ context: good().context })), res, () => {});
    expect(api.prewarmedCount()).toBe(2); // this page's answer prefix and the document's scout prefix
  }, 20_000); // 300 prewarms, each through the ledger's file lock: ~3.5s alone, slower under a parallel run
});

describe('/api/stt', () => {
  const SM = 'sm-secret-STT-key';
  const post = async (api: ReturnType<typeof createApi>, method = 'POST') => {
    const res = fakeRes();
    await api.handle(fakeReq(method, '/api/stt', method === 'POST' ? '{}' : ''), res, () => {});
    return { status: res.statusCode, body: res.body() };
  };
  it('GET says whether dictation is set up, and nothing else (never the key)', async () => {
    const f = vi.fn();
    const off = await post(createApi({ env: env(), root, fetch: f as unknown as typeof fetch }), 'GET');
    expect(off).toEqual({ status: 200, body: JSON.stringify({ on: false }) });
    const on = await post(createApi({ env: env({ SPEECHMATICS_API_KEY: SM }), root, fetch: f as unknown as typeof fetch }), 'GET');
    expect(JSON.parse(on.body)).toEqual({ on: true });
    expect(on.body).not.toContain(SM);
    expect(f).not.toHaveBeenCalled();
  });
  it('405 for anything but GET or POST; 503 with the setup line without a key (Speechmatics is not called)', async () => {
    const f = vi.fn();
    const api = createApi({ env: env(), root, fetch: f as unknown as typeof fetch });
    expect((await post(api, 'PUT')).status).toBe(405);
    const r = await post(api);
    expect(r.status).toBe(503);
    expect(JSON.parse(r.body).error).toMatch(/SPEECHMATICS_API_KEY/);
    expect(f).not.toHaveBeenCalled();
  });
  it('200 { jwt, url }: a temporary key minted with the account key', async () => {
    const f = vi.fn(async (_u: string, _i: RequestInit) => new Response(JSON.stringify({ key_value: 'tmp-jwt' }), { status: 201 }));
    const api = createApi({ env: env({ SPEECHMATICS_API_KEY: SM }), root, fetch: f as unknown as typeof fetch });
    const r = await post(api);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ jwt: 'tmp-jwt', url: STT_WS_URL });
    expect(r.body).not.toContain(SM);
    expect(f.mock.calls[0][0]).toBe(STT_MINT_URL);
  });
  it('502 with a generic line when Speechmatics refuses or fails; the key is in neither the response nor the log', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      for (const f of [
        async () => new Response('bad key', { status: 401 }),
        async () => new Response('not json', { status: 200 }),
        async () => { throw new Error(`connect failed with Bearer ${SM}`); },
      ]) {
        const api = createApi({ env: env({ SPEECHMATICS_API_KEY: SM }), root, fetch: f as unknown as typeof fetch });
        const r = await post(api);
        expect(r.status).toBe(502);
        expect(JSON.parse(r.body)).toEqual({ error: 'Dictation is unavailable right now.' });
        expect(r.body).not.toContain(SM);
      }
      expect(err).toHaveBeenCalledTimes(3);
      for (const c of err.mock.calls) expect(c.join(' ')).not.toContain(SM);
    } finally { err.mockRestore(); }
  });
});
