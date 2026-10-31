// @vitest-environment node
// tests/server/title.test.ts — POST /api/title: a saved question's title, through the ledger and cached by content.
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { parseEnv } from '../../server/env';
import { createApi } from '../../server/plugin';
import { TITLE_MAX_OUTPUT, TITLE_MODEL, titleRequest, validateTitle } from '../../server/title';

const KEY = 'sk-test-TITLE-xyz';
let root = '';
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'petu-title-')); });
const env = (over: Record<string, string> = {}) => parseEnv((k) => ({ OPENAI_API_KEY: KEY, PETU_PHASE: 'dev', ...over })[k], { root, home: root });

function req(body: unknown, headers: Record<string, string> = {}): IncomingMessage {
  const r = Readable.from([Buffer.from(JSON.stringify(body))]) as unknown as IncomingMessage;
  Object.assign(r, { method: 'POST', url: '/api/title', headers: { host: 'localhost:5180', 'content-type': 'application/json', ...headers } });
  return r;
}
async function post(api: ReturnType<typeof createApi>, body: unknown, headers?: Record<string, string>) {
  const chunks: Buffer[] = [];
  const res = new Writable({ write(c, _e, cb) { chunks.push(Buffer.from(c)); cb(); } }) as unknown as ServerResponse;
  Object.assign(res, { statusCode: 200, setHeader() { return res; }, getHeader() { return undefined; } });
  await api.handle(req(body, headers), res, () => {});
  return { status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
}
/** A fake OpenAI: answers every call with `text`, counting the calls and keeping their bodies. */
function upstream(text: string) {
  const calls: any[] = [];
  const f = (async (_u: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ output_text: text, usage: { input_tokens: 120, output_tokens: 6 } }), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const body = { questions: ['why does the balance grow faster?', 'what after forty years?'], sections: ['Compound interest'] };

describe('/api/title', () => {
  it('one small call on the cheapest model, cleaned, booked on the ledger as kind title', async () => {
    const up = upstream('"Compound Interest Over Decades."');
    const api = createApi({ env: env(), root, fetch: up.f });
    const r = await post(api, body);
    expect(r.status).toBe(200);
    expect(r.body.title).toBe('Compound Interest Over Decades');
    expect(up.calls).toHaveLength(1);
    expect(up.calls[0]).toMatchObject({ model: TITLE_MODEL, max_output_tokens: TITLE_MAX_OUTPUT, reasoning: { effort: 'none' }, stream: false, store: false });
    const ledger = JSON.parse(readFileSync(join(root, '.petu', 'spend.json'), 'utf8'));
    const e = ledger.entries.find((x: any) => x.kind === 'title');
    expect(e).toMatchObject({ phase: 'dev', model: TITLE_MODEL, estimated: false });
    expect(e.usd).toBeGreaterThan(0);
    expect(e.usd).toBeLessThan(0.001);
  });

  it('the same content is titled once (cached by content); other content asks again', async () => {
    const up = upstream('Compound interest');
    const api = createApi({ env: env(), root, fetch: up.f });
    await post(api, body);
    const again = await post(api, { questions: [' why does the balance  grow faster? ', 'what after forty years?'], sections: ['Compound interest'] });
    expect(again.body).toMatchObject({ title: 'Compound interest', cached: true, usd: 0 });
    expect(up.calls).toHaveLength(1);
    await post(api, { questions: ['something else'] });
    expect(up.calls).toHaveLength(2);
  });

  it('a cap refuses before anything is sent (402); no key is 503; bad bodies are 400', async () => {
    const up = upstream('x');
    expect((await post(createApi({ env: env({ PETU_TOTAL_CAP_USD: '0' }), root, fetch: up.f }), body)).status).toBe(402);
    expect(up.calls).toHaveLength(0);
    expect((await post(createApi({ env: env({ OPENAI_API_KEY: '' }), root, fetch: up.f }), body)).status).toBe(503);
    const api = createApi({ env: env(), root, fetch: up.f });
    expect((await post(api, { questions: [] })).status).toBe(400);
    expect((await post(api, { questions: ['x'.repeat(301)] })).status).toBe(400);
    expect((await post(api, { questions: 'why' })).status).toBe(400);
    expect((await post(api, { ...body, phase: 'founder' })).status).toBe(400);
    expect(up.calls).toHaveLength(0);
  });

  it('nothing usable back is 502 (the list keeps the section title)', async () => {
    const api = createApi({ env: env(), root, fetch: upstream('  ""  ').f });
    expect((await post(api, body)).status).toBe(502);
  });

  it('is guarded like every route', async () => {
    const up = upstream('x');
    const api = createApi({ env: env(), root, fetch: up.f });
    expect((await post(api, body, { origin: 'https://evil.example' })).status).toBe(403);
    expect(up.calls).toHaveLength(0);
  });

  it('the request names the questions and the sections; validation trims and bounds them', () => {
    const i = validateTitle({ questions: ['  a  question ', ''], sections: ['S', 'S'] });
    expect(i).toEqual({ questions: ['a question'], sections: ['S'] });
    const text = titleRequest(i as never).input[1].content[0].text;
    expect(text).toContain('- a question');
    expect(text).toContain('- S');
  });
});
