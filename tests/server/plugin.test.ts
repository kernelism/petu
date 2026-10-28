// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { parseEnv, PHASE_CAPS, MAX_TOTAL_USD } from '../../server/env';
import { createApi } from '../../server/plugin';
import type { AskEvent, AskRequest } from '../../src/agent/protocol';

const KEY = 'sk-test-PLUGIN-xyz';

describe('parseEnv', () => {
  const from = (o: Record<string, string>) => (k: string) => o[k];
  const opts = { root: '/repo', home: '/home/u' };
  it('defaults: terra/none, founder phase with $3/day, §3 phase caps, $40 total, prior $0.0076', () => {
    const e = parseEnv(from({}), opts);
    expect(e.key).toBe('');
    expect(e.model).toEqual({ model: 'gpt-6.1-terra', effort: 'none', maxOutput: 1400, fast: false, explicitCache: true });
    expect(e.phase).toBe('founder');
    expect(e.caps).toEqual({ totalUsd: 40, dailyUsd: 3, phaseUsd: PHASE_CAPS });
    expect(PHASE_CAPS).toEqual({ dev: 1, bakeoff: 6, iterate: 7, validate: 2, founder: 21.99 });
    expect(e.priorUsd).toBe(0.0076);
    expect(e.pdfDirs).toEqual(['/home/u/Documents/670/contents', '/repo/public/dev']);
  });
  it('phases other than founder have no daily cap; per-phase caps and knobs are read', () => {
    const e = parseEnv(from({ PETU_PHASE: 'bakeoff', PETU_CAP_BAKEOFF: '5', PETU_MODEL: 'gpt-6-luna', PETU_EFFORT: 'low', PETU_FAST: '1', PETU_VERBOSITY: 'low', PETU_MAX_OUTPUT: '900', PETU_EXPLICIT_CACHE: '0', PETU_PDF_DIRS: '~/a, /b', OPENAI_API_KEY: KEY }), opts);
    expect(e.phase).toBe('bakeoff');
    expect(e.caps.dailyUsd).toBeUndefined();
    expect(e.caps.phaseUsd?.bakeoff).toBe(5);
    expect(e.model).toEqual({ model: 'gpt-6-luna', effort: 'low', maxOutput: 900, fast: true, verbosity: 'low', explicitCache: false });
    expect(e.pdfDirs).toEqual(['/home/u/a', '/b']);
    expect(e.key).toBe(KEY);
  });
  it('the total can be lowered but never raised past $40', () => {
    expect(parseEnv(from({ PETU_TOTAL_CAP_USD: '0' }), opts).caps.totalUsd).toBe(0);
    expect(parseEnv(from({ PETU_TOTAL_CAP_USD: '100' }), opts).caps.totalUsd).toBe(MAX_TOTAL_USD);
  });
  it('rejects bad knobs, including effort none on models that refuse it', () => {
    expect(() => parseEnv(from({ PETU_EFFORT: 'max' }), opts)).toThrow(/PETU_EFFORT/);
    expect(() => parseEnv(from({ PETU_MODEL: 'gpt-9' }), opts)).toThrow(/PETU_MODEL/);
    expect(() => parseEnv(from({ PETU_MODEL: 'gpt-6.1-sol' }), opts)).toThrow(/none/);
    expect(() => parseEnv(from({ PETU_PHASE: 'spike' }), opts)).toThrow(/PETU_PHASE/);
    expect(() => parseEnv(from({ PETU_DAILY_CAP_USD: 'lots' }), opts)).toThrow(/PETU_DAILY_CAP_USD/);
    expect(() => parseEnv(from({ PETU_VERBOSITY: 'high' }), opts)).toThrow(/PETU_VERBOSITY/);
  });
});

// ---- fake req / res -------------------------------------------------------------------------

type FakeRes = ServerResponse & { body(): string; headersSent_: Record<string, string | number> };
function fakeReq(method: string, url: string, body: string | Buffer = '', headers: Record<string, string> = {}): IncomingMessage {
  const r = Readable.from(body.length ? [Buffer.from(body)] : []) as unknown as IncomingMessage;
  Object.assign(r, { method, url, headers });
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
    expect(api.statusLine()).toBe('petu: model gpt-6.1-terra/none · spent $0.01 of $40 · phase founder');
    expect(api.statusLine()).not.toContain(KEY);
  });

  it('400 on bad bodies', async () => {
    const api = createApi({ env: env(), root, fetch: upstream([]).f });
    const bad: unknown[] = [
      '{}', 'not json', { ...good(), question: '' }, { ...good(), question: 'x'.repeat(2001) },
      { ...good(), history: Array(4).fill({ q: 'q', a: 'a', page: 1 }) },
      { ...good(), context: { ...good().context, page: 4 } },
      { ...good(), context: { ...good().context, image: undefined } },
      { ...good(), context: { ...good().context, image: { b64: '', w: 1, h: 1 } } },
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
    expect(s).toMatchObject({ totalUsd: 0.0076, capUsd: 40, todayUsd: 0, dailyCapUsd: 3, phase: 'founder', phaseCapUsd: 21.99 });
    expect(s.blocked).toBeUndefined();
  });

  it('GET /api/spend reports blocked when a typical answer would be refused', async () => {
    const api = createApi({ env: env({ PETU_TOTAL_CAP_USD: '0' }), root, fetch: upstream([]).f });
    const res = fakeRes();
    await api.handle(fakeReq('GET', '/api/spend'), res, () => {});
    expect(JSON.parse(res.body()).blocked).toMatch(/Spending stopped/);
  });

  it('POST /api/prewarm is deduped per docHash+page', async () => {
    let calls = 0;
    const f = (async () => { calls++; return new Response(JSON.stringify({ usage: { input_tokens: 100, output_tokens: 0 } }), { status: 200 }); }) as unknown as typeof fetch;
    const api = createApi({ env: env(), root, fetch: f });
    for (let i = 0; i < 2; i++) {
      const res = fakeRes();
      await api.handle(fakeReq('POST', '/api/prewarm', JSON.stringify({ context: good().context })), res, () => {});
      expect(JSON.parse(res.body()).ok).toBe(true);
    }
    expect(calls).toBe(1);
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
});
