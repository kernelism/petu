// server/plugin.ts — the petu API as Vite dev-server middleware (`apply: 'serve'`, localhost only).
//
//   POST /api/ask              AskRequest → NDJSON AskEvents
//   POST /api/prewarm          { context } → { ok, usd, reason? } (deduped per docHash+page for 25 min)
//                              { scope: 'system' } → the shared system block (document open; ≤ 1 per 11.5h)
//   GET  /api/spend            → SpendSummary (+ phase, phaseCapUsd, byPhase, byModel, n)
//   POST /api/judge            eval only; header x-petu-eval: <.petu/eval-token> → JudgeResult
//   GET  /api/dev-pdf/<n>.pdf  <n>.pdf from the first PETU_PDF_DIRS directory that has it
//
// Logging: route + message only. Never request headers, bodies or the key.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import type { AskContext, AskEvent, AskRequest } from '../src/agent/protocol';
import { Ledger } from './ledger';
import { ask, judge, prewarm, prewarmSystem, type Deps, type JudgeRequest } from './openai';
import { CacheStats } from './cacheStats';
import { worstCaseUsd } from './prices';
import { loadPetuEnv, type PetuEnv } from './env';

export const BODY_LIMIT = 12 * 1024 * 1024;
const PREWARM_TTL_MS = 25 * 60 * 1000;
/** A typical answer's input (system prompt + page block + image) for the /api/spend "blocked" check. */
const TYPICAL_INPUT_TOKENS = 12000;

type Next = (err?: unknown) => void;
export type Api = {
  handle(req: IncomingMessage, res: ServerResponse, next: Next): Promise<void>;
  ledger: Ledger;
  token: string;
  statusLine(): string;
};

export function createApi(o: { env: PetuEnv; root: string; fetch?: typeof fetch; now?: () => number }): Api {
  const { env } = o;
  const dir = join(o.root, '.petu');
  mkdirSync(dir, { recursive: true });
  const ledger = new Ledger(join(dir, 'spend.json'), env.caps, undefined, env.priorUsd);
  // The eval runner passes its own token (PETU_EVAL_TOKEN) so several servers can run at once and
  // the token file of another server (e.g. the founder's) is not overwritten.
  const token = env.evalToken ?? randomBytes(24).toString('hex');
  if (!env.evalToken) writeFileSync(join(dir, 'eval-token'), token, { mode: 0o600 });
  const cache = new CacheStats(join(dir, 'cache.json'), o.now);
  const deps: Deps = { key: env.key, ledger, phase: env.phase, fetch: o.fetch ?? fetch, cache };
  let systemWarming: Promise<unknown> | null = null;
  const now = o.now ?? Date.now;
  const prewarmed = new Map<string, number>();

  const statusLine = () =>
    `petu: model ${env.model.model}/${env.model.effort} · spent $${ledger.spent().toFixed(2)} of $${env.caps.totalUsd} · phase ${env.phase}${env.key ? '' : ' · no OPENAI_API_KEY in .env'}`;

  async function handle(req: IncomingMessage, res: ServerResponse, next: Next): Promise<void> {
    const path = (req.url ?? '').split('?')[0];
    try {
      if (path === '/api/ask') return await routeAsk(req, res);
      if (path === '/api/prewarm') return await routePrewarm(req, res);
      if (path === '/api/spend') return routeSpend(req, res);
      if (path === '/api/judge') return await routeJudge(req, res);
      if (path.startsWith('/api/dev-pdf/')) return routePdf(req, res, path.slice('/api/dev-pdf/'.length));
    } catch (e) {
      console.error(`petu: ${path} failed: ${env.key ? String(e).split(env.key).join('***') : String(e)}`.slice(0, 300));
      if (!res.headersSent && !res.writableEnded) return json(res, 500, { error: 'internal error' });
      if (!res.writableEnded) res.end();
      return;
    }
    next();
  }

  async function routeAsk(req: IncomingMessage, res: ServerResponse) {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
    const body = await readJson(req, res);
    if (body === undefined) return;
    const bad = validateAsk(body) ?? (body.phase != null && body.phase !== env.phase ? `phase "${String(body.phase)}" ≠ server phase "${env.phase}" (start the server with PETU_PHASE=${String(body.phase)})` : null);
    if (bad) return json(res, 400, badRequest(bad));
    res.statusCode = 200;
    res.setHeader('content-type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-accel-buffering', 'no');
    res.flushHeaders();
    const ctl = new AbortController();
    const onClose = () => { if (!res.writableEnded) ctl.abort(); };
    // `res` close (not `req` close, which fires once the body is read): the client went away.
    res.on('close', onClose);
    const emit = (e: AskEvent) => { if (!res.writableEnded && !res.destroyed) res.write(JSON.stringify(e) + '\n'); };
    try {
      await ask(body as AskRequest, env.model, deps, emit, ctl.signal);
    } finally {
      res.off('close', onClose);
      if (!res.writableEnded && !res.destroyed) res.end();
    }
  }

  async function routePrewarm(req: IncomingMessage, res: ServerResponse) {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
    const body = await readJson(req, res);
    if (body === undefined) return;
    if (body?.scope === 'system') {
      // One at a time; prewarmSystem itself skips a block read or written in the last 11.5h.
      if (systemWarming) return json(res, 200, { ok: true, usd: 0, reason: 'deduped' });
      const p = prewarmSystem(env.model, deps);
      systemWarming = p;
      try { return json(res, 200, await p); } finally { systemWarming = null; }
    }
    const bad = validateContext(body?.context);
    if (bad) return json(res, 400, badRequest(bad));
    const c = body.context as AskContext;
    const k = `${c.docHash}:${c.page}`;
    const at = prewarmed.get(k);
    if (at != null && now() - at < PREWARM_TTL_MS) return json(res, 200, { ok: true, usd: 0, reason: 'deduped' });
    prewarmed.set(k, now());
    const r = await prewarm(c, env.model, deps);
    if (!r.ok) prewarmed.delete(k);
    return json(res, 200, r);
  }

  function routeSpend(req: IncomingMessage, res: ServerResponse) {
    if (req.method !== 'GET') return json(res, 405, { error: 'GET only' });
    const s = ledger.summary();
    const refusal = ledger.check(env.phase, worstCaseUsd(env.model.model, TYPICAL_INPUT_TOKENS, env.model.maxOutput, env.model.fast));
    return json(res, 200, { ...s, phase: env.phase, phaseCapUsd: env.caps.phaseUsd?.[env.phase], ...(refusal ? { blocked: refusal.message, blockedCode: refusal.code } : {}) });
  }

  async function routeJudge(req: IncomingMessage, res: ServerResponse) {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
    const got = Buffer.from(String(req.headers['x-petu-eval'] ?? ''));
    const want = Buffer.from(token);
    if (got.length !== want.length || !timingSafeEqual(got, want)) return json(res, 403, { error: 'eval token required' });
    const body = await readJson(req, res);
    if (body === undefined) return;
    if (typeof body?.instructions !== 'string' || !Array.isArray(body.content) || typeof body.schema !== 'object' || body.schema == null)
      return json(res, 400, badRequest('judge body needs { instructions, content[], schema }'));
    return json(res, 200, await judge(body as JudgeRequest, deps));
  }

  function routePdf(req: IncomingMessage, res: ServerResponse, raw: string) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'GET only' });
    let name: string;
    try { name = decodeURIComponent(raw); } catch { return json(res, 400, { error: 'bad name' }); }
    if (!/^[^/\\]+\.pdf$/i.test(name) || name.includes('..') || name.includes('\0')) return json(res, 400, { error: 'basename.pdf only' });
    for (const d of env.pdfDirs) {
      const file = join(d, name);
      let size: number;
      try { const st = statSync(file); if (!st.isFile()) continue; size = st.size; } catch { continue; }
      res.statusCode = 200;
      res.setHeader('content-type', 'application/pdf');
      res.setHeader('content-length', size);
      res.setHeader('cache-control', 'no-store');
      if (req.method === 'HEAD') { res.end(); return; }
      createReadStream(file).on('error', () => res.destroy()).pipe(res);
      return;
    }
    return json(res, 404, { error: 'not found' });
  }

  return { handle, ledger, token, statusLine };
}

/** The Vite plugin: `plugins: [react(), petuApi()]`. */
export function petuApi(): Plugin {
  return {
    name: 'petu-api',
    apply: 'serve',
    configureServer(server) {
      if (process.env.VITEST) return; // vitest runs a Vite server too: no ledger, no key, no routes
      const root = server.config.root;
      const env = loadPetuEnv(server.config.mode, server.config.envDir, root);
      const api = createApi({ env, root });
      server.middlewares.use((req, res, next) => { void api.handle(req, res, next); });
      server.config.logger.info(api.statusLine());
    },
  };
}

// ---- helpers ----------------------------------------------------------------------------------

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}
const badRequest = (message: string): AskEvent => ({ t: 'error', code: 'bad_request', message, retryable: false });

/** Reads a JSON body (≤ 12 MB). Responds 413/400 itself and returns undefined on failure. */
async function readJson(req: IncomingMessage, res: ServerResponse): Promise<any> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req as AsyncIterable<Buffer | string>) {
    const b = typeof c === 'string' ? Buffer.from(c) : c;
    n += b.length;
    if (n > BODY_LIMIT) {
      res.setHeader('connection', 'close');
      json(res, 413, { t: 'error', code: 'bad_request', message: 'Request too large (12 MB max).', retryable: false });
      return undefined;
    }
    chunks.push(b);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {
    json(res, 400, badRequest('Body must be JSON.'));
    return undefined;
  }
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isImage = (v: any) => v != null && isStr(v.b64) && v.b64.length > 0 && typeof v.w === 'number' && typeof v.h === 'number' && v.w > 0 && v.h > 0 && v.w <= 10000 && v.h <= 10000;

export function validateContext(c: any): string | null {
  if (c == null || typeof c !== 'object') return 'context is required';
  if (!isStr(c.docName) || !isStr(c.docHash) || !c.docHash) return 'context.docName and context.docHash are required';
  if (!isInt(c.numPages) || c.numPages < 1) return 'context.numPages must be a positive integer';
  if (!isInt(c.page) || c.page < 1 || c.page > c.numPages) return 'context.page is out of range';
  if (!isStr(c.docText) || !isStr(c.pageText)) return 'context.docText and context.pageText are required';
  if (!isImage(c.image)) return 'context.image { b64, w, h } is required';
  if (c.searchText != null && !isStr(c.searchText)) return 'context.searchText must be a string';
  if (c.ink != null && (!isStr(c.ink.summary) || (c.ink.crop != null && !isImage(c.ink.crop)))) return 'context.ink is malformed';
  return null;
}

export function validateAsk(b: any): string | null {
  if (b == null || typeof b !== 'object') return 'body must be an object';
  if (!isStr(b.question) || !b.question.trim() || b.question.length > 2000) return 'question must be 1–2,000 characters';
  if (!Array.isArray(b.history) || b.history.length > 3) return 'history must be an array of at most 3';
  if (!b.history.every((h: any) => h && isStr(h.q) && isStr(h.a) && isInt(h.page))) return 'history items need { q, a, page }';
  return validateContext(b.context);
}
