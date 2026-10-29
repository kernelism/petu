// server/plugin.ts — the petu API as Vite dev-server middleware (`apply: 'serve'`, localhost only).
//
//   POST /api/ask              AskRequest → NDJSON AskEvents (with an opener and the storyboard on: the
//                              lesson design first — a `storyboard` event — then stage 2 performing it)
//   POST /api/scout            ScoutRequest → NDJSON ScoutEvents (stage 1, streamed: opener sentences,
//                              then the verdict: pages in teaching order + plan, then the cost; any
//                              failure falls back to the visible page, never an error status)
//   POST /api/prewarm          { context } → { ok, usd, reason? }: the answer's prefix (deduped per
//                              docHash+page for 25 min) and the scout's (per digest)
//                              { scope: 'system' } → the shared system block (document open; ≤ 1 per 11.5h)
//   GET  /api/spend            → SpendSummary (+ phase, phaseCapUsd, byPhase, byModel, n)
//   POST /api/judge            eval only; header x-petu-eval: <.petu/eval-token> → JudgeResult
//   POST /api/repair           RepairWire → NDJSON RepairWireEvents (the live gate's replacement beat for
//                              an answer's failed unit, server/repair.ts); 404 unknown reqId, 429 past
//                              MAX_REPAIRS, 400 bad body or phase, 402 cap, 503 repairs off
//   POST /api/report           { report, png? } → saved under .petu/reports/ (server/report.ts)
//   GET  /api/dev-pdf/<n>.pdf  <n>.pdf from the first PETU_PDF_DIRS directory that has it
//
// Every /api/* request must come from the app itself (`guard`): a loopback Host (no rebound DNS
// name), an Origin, when present, equal to that host, and `content-type: application/json` on POSTs
// (a cross-site page can then only send them after a CORS preflight, which is refused). These routes
// run before Vite's own host check and CORS, so they cannot rely on them.
//
// Logging: route + message only. Never request headers, bodies or the key.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { appendFileSync, createReadStream, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import type { AskContext, AskEvent, AskRequest } from '../src/agent/protocol';
import { Ledger } from './ledger';
import { ask, judge, prewarm, prewarmScout, prewarmSystem, scoutStream, type Deps, type JudgeRequest, type Timeouts } from './openai';
import type { ScoutEvent, ScoutRequest } from '../src/agent/scout';
import { createHash } from 'node:crypto';
import { CacheStats } from './cacheStats';
import { worstCaseUsd } from './prices';
import { loadPetuEnv, type PetuEnv } from './env';
import { routeReport } from './report';
import { RepairCache, repair } from './repair';
import type { RepairWire, RepairWireEvent } from '../src/agent/protocol';
import { isRelation } from '../src/agent/context/memory';

export const BODY_LIMIT = 12 * 1024 * 1024;
const PREWARM_TTL_MS = 25 * 60 * 1000;
/** Prewarmed (doc, page) keys kept for the dedupe; older ones are forgotten first. */
export const PREWARM_MAX = 256;
/**
 * A typical v3 question's input for the /api/spend "blocked" check: the answer (system prompt, digest,
 * listings, 4 images) and the scout (instructions + digest). Both calls are reserved one after the other.
 */
const TYPICAL_INPUT_TOKENS = 24000;
const TYPICAL_SCOUT_TOKENS = 8000;

type Next = (err?: unknown) => void;
export type Api = {
  handle(req: IncomingMessage, res: ServerResponse, next: Next): Promise<void>;
  ledger: Ledger;
  token: string;
  statusLine(): string;
  /** Size of the prewarm dedupe map (bounded by PREWARM_MAX and the TTL). */
  prewarmedCount(): number;
};

export function createApi(o: { env: PetuEnv; root: string; fetch?: typeof fetch; now?: () => number; timeouts?: Partial<Timeouts> }): Api {
  const { env } = o;
  const dir = join(o.root, '.petu');
  mkdirSync(dir, { recursive: true });
  const ledger = new Ledger(join(dir, 'spend.json'), env.caps, undefined, env.priorUsd);
  // The eval runner passes its own token (PETU_EVAL_TOKEN) so several servers can run at once and
  // the token file of another server (e.g. the founder's) is not overwritten.
  const token = env.evalToken ?? randomBytes(24).toString('hex');
  if (!env.evalToken) writeFileSync(join(dir, 'eval-token'), token, { mode: 0o600 });
  const cache = new CacheStats(join(dir, 'cache.json'), o.now);
  // Every answer's record, local only (gitignored): diagnosable without screenshots.
  const log = (rec: object) => appendFileSync(join(dir, 'answers.jsonl'), `${JSON.stringify(rec)}\n`);
  // Stage 2's requests by reqId, so a live-gate repair resends the same cached prefix (server/repair.ts).
  const repairs = new RepairCache(o.now);
  const deps: Deps = { key: env.key, ...(env.anthropicKey ? { anthropicKey: env.anthropicKey } : {}), ledger, phase: env.phase, fetch: o.fetch ?? fetch, cache, log, ...(o.timeouts ? { timeouts: o.timeouts } : {}),
    ...(env.repair ? { onBody: (id, oa, cfg, ck, images) => repairs.put(id, oa, cfg, ck, images) } : {}) };
  let systemWarming: Promise<unknown> | null = null;
  const now = o.now ?? Date.now;
  const prewarmed = new Map<string, number>();

  /** Marks `k` prewarmed now; drops expired keys and, past PREWARM_MAX, the oldest. */
  const remember = (k: string) => {
    const t = now();
    prewarmed.delete(k);
    for (const [key, at] of prewarmed) if (t - at >= PREWARM_TTL_MS) prewarmed.delete(key);
    prewarmed.set(k, t);
    while (prewarmed.size > PREWARM_MAX) prewarmed.delete(prewarmed.keys().next().value!);
  };

  const statusLine = () =>
    `petu: model ${env.model.model}/${env.model.effort} · spent $${ledger.spent().toFixed(2)} of $${env.caps.totalUsd} · phase ${env.phase}${env.key ? '' : ' · no OPENAI_API_KEY in .env'}${env.model.model.startsWith('claude-') && !env.anthropicKey ? ' · no PETU_ANTHROPIC_KEY (answers will refuse)' : ''}`;

  async function handle(req: IncomingMessage, res: ServerResponse, next: Next): Promise<void> {
    const path = (req.url ?? '').split('?')[0];
    if (path.startsWith('/api/')) {
      const refused = guard(req);
      if (refused) return json(res, refused.status, { error: refused.error });
    }
    try {
      if (path === '/api/ask') return await routeAsk(req, res);
      if (path === '/api/scout') return await routeScout(req, res);
      if (path === '/api/prewarm') return await routePrewarm(req, res);
      if (path === '/api/spend') return routeSpend(req, res);
      if (path === '/api/judge') return await routeJudge(req, res);
      if (path === '/api/repair') return await routeRepair(req, res);
      if (path === '/api/report') return await routeReport(req, res, o.root, env.key);
      if (path.startsWith('/api/dev-pdf/')) return routePdf(req, res, path.slice('/api/dev-pdf/'.length));
    } catch (e) {
      const msg = [env.key, env.anthropicKey].filter(Boolean).reduce((m, k) => m.split(k).join('***'), String(e));
      console.error(`petu: ${path} failed: ${msg}`.slice(0, 300));
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
      await ask(body as AskRequest, env.model, deps, emit, ctl.signal, env.storyboard);
    } finally {
      res.off('close', onClose);
      if (!res.writableEnded && !res.destroyed) res.end();
    }
  }

  async function routeRepair(req: IncomingMessage, res: ServerResponse) {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
    const body = await readJson(req, res);
    if (body === undefined) return;
    const bad = validateRepair(body) ?? (body.phase != null && body.phase !== env.phase ? `phase "${String(body.phase)}" ≠ server phase "${env.phase}"` : null);
    if (bad) return json(res, 400, { t: 'error', code: 'bad_request', message: bad });
    const ctl = new AbortController();
    const onClose = () => { if (!res.writableEnded) ctl.abort(); };
    res.on('close', onClose);
    let opened = false;
    const open = () => {
      if (opened) return;
      opened = true;
      res.statusCode = 200;
      res.setHeader('content-type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      res.setHeader('x-accel-buffering', 'no');
      res.flushHeaders();
    };
    const emit = (e: RepairWireEvent) => { open(); if (!res.writableEnded && !res.destroyed) res.write(JSON.stringify(e) + '\n'); };
    try {
      const refused = await repair(body as RepairWire, env.repair, { ...deps, repairs, log }, emit, ctl.signal);
      if (refused && !opened) return json(res, refused.status, refused.error);
    } finally {
      res.off('close', onClose);
      if (!res.writableEnded && !res.destroyed) res.end();
    }
  }

  async function routeScout(req: IncomingMessage, res: ServerResponse) {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
    const body = await readJson(req, res);
    if (body === undefined) return;
    const bad = validateScout(body) ?? (body.phase != null && body.phase !== env.phase ? `phase "${String(body.phase)}" ≠ server phase "${env.phase}"` : null);
    if (bad) return json(res, 400, badRequest(bad));
    res.statusCode = 200;
    res.setHeader('content-type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-accel-buffering', 'no');
    res.flushHeaders();
    const ctl = new AbortController();
    const onClose = () => { if (!res.writableEnded) ctl.abort(); };
    res.on('close', onClose);
    const emit = (e: ScoutEvent) => { if (!res.writableEnded && !res.destroyed) res.write(JSON.stringify(e) + '\n'); };
    try {
      await scoutStream(body as ScoutRequest, env.scout, deps, emit, ctl.signal);
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
      // One at a time; prewarmSystem itself skips a block read or written in the last 11.5h. It
      // always settles (its upstream call has a timeout), and `finally` frees the slot on any outcome.
      if (systemWarming) return json(res, 200, { ok: true, usd: 0, reason: 'deduped' });
      const p = prewarmSystem(env.model, deps);
      systemWarming = p;
      try { return json(res, 200, await p); } finally { systemWarming = null; }
    }
    const bad = validateContext(body?.context);
    if (bad) return json(res, 400, badRequest(bad));
    const c = body.context as AskContext;
    // The scout's prefix (instructions + digest + the visible page's listing) is per (digest, page);
    // the answer's is per (doc, page).
    const sk = `scout:${createHash('sha1').update(c.docText).update(c.scoutSection ?? '').digest('hex')}:${c.page}`;
    const k = `${c.docHash}:${c.page}`;
    const fresh = (key: string) => { const at = prewarmed.get(key); return at != null && now() - at < PREWARM_TTL_MS; };
    const doScout = !fresh(sk), doPage = !fresh(k);
    if (!doScout && !doPage) return json(res, 200, { ok: true, usd: 0, reason: 'deduped' });
    if (doScout) remember(sk);
    if (doPage) remember(k);
    const [a, b] = await Promise.all([
      doPage ? prewarm(c, env.model, deps) : Promise.resolve({ ok: true, usd: 0, reason: 'deduped' }),
      doScout ? prewarmScout({ digest: c.docText, docHash: c.docHash, docName: c.docName, numPages: c.numPages, page: c.page, pageText: c.pageText, ...(c.scoutSection ? { section: c.scoutSection } : {}) }, env.scout, deps) : Promise.resolve({ ok: true, usd: 0, reason: 'deduped' }),
    ]);
    if (!a.ok) prewarmed.delete(k);
    if (!b.ok) prewarmed.delete(sk);
    const reason = [a.reason, b.reason].filter((x) => x && x !== 'deduped').join('; ');
    return json(res, 200, { ok: a.ok && b.ok, usd: a.usd + b.usd, ...(reason ? { reason } : !doPage || !doScout ? { reason: 'deduped' } : {}) });
  }

  function routeSpend(req: IncomingMessage, res: ServerResponse) {
    if (req.method !== 'GET') return json(res, 405, { error: 'GET only' });
    const s = ledger.summary();
    const worst = worstCaseUsd(env.model.model, TYPICAL_INPUT_TOKENS, env.model.maxOutput, env.model.fast) + worstCaseUsd(env.scout.model, TYPICAL_SCOUT_TOKENS, env.scout.maxOutput, env.scout.fast)
      + (env.storyboard ? worstCaseUsd(env.storyboard.model, TYPICAL_INPUT_TOKENS, env.storyboard.maxOutput, env.storyboard.fast) : 0);
    const refusal = ledger.check(env.phase, worst);
    // Which keys the server has (booleans only), so a runner can refuse a config before spending on scouts.
    return json(res, 200, { ...s, phase: env.phase, phaseCapUsd: env.caps.phaseUsd?.[env.phase], model: env.model.model, keys: { openai: !!env.key, anthropic: !!env.anthropicKey }, ...(refusal ? { blocked: refusal.message, blockedCode: refusal.code } : {}) });
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

  return { handle, ledger, token, statusLine, prewarmedCount: () => prewarmed.size };
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

// ---- request guard ----------------------------------------------------------------------------

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Why a /api/* request is refused, or null for the app's own requests. */
export function guard(req: IncomingMessage): { status: number; error: string } | null {
  const host = String(req.headers.host ?? '').toLowerCase();
  const m = /^(localhost|127\.0\.0\.1|\[::1\])(?::(\d{1,5}))?$/.exec(host);
  if (!m || !LOOPBACK.has(m[1])) return { status: 403, error: 'forbidden host' };
  const origin = req.headers.origin;
  if (origin != null) {
    const o = String(origin).toLowerCase();
    if (o !== `http://${host}` && o !== `https://${host}`) return { status: 403, error: 'forbidden origin' };
  }
  if (req.method === 'OPTIONS') return { status: 405, error: 'no CORS' };
  if (req.method === 'POST') {
    const ct = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (ct !== 'application/json') return { status: 415, error: 'content-type must be application/json' };
  }
  return null;
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
/** Sane maxima for what the browser sends (it sends ≤ 1280 px images and much shorter text). */
export const LIMITS = { imageSide: 2048, docText: 120_000, pageText: 60_000, pagesText: 120_000, images: 3, plan: 2_000, opener: 2_000, scoutPages: 6, searchText: 20_000, inkSummary: 4_000,
  /** Tiered context (ctx=new): the section card, session memory, candidates. */
  section: 60_000, memory: 20_000, candidates: 20_000,
  /** /api/repair: the released stage-2 text, the failed beat, the report (as JSON). */
  committed: 40_000, beat: 4_000, report: 6_000 };
const isImage = (v: any) => v != null && isStr(v.b64) && v.b64.length > 0 && typeof v.w === 'number' && typeof v.h === 'number' && v.w > 0 && v.h > 0 && v.w <= LIMITS.imageSide && v.h <= LIMITS.imageSide;

export function validateContext(c: any): string | null {
  if (c == null || typeof c !== 'object') return 'context is required';
  if (!isStr(c.docName) || !isStr(c.docHash) || !c.docHash) return 'context.docName and context.docHash are required';
  if (!isInt(c.numPages) || c.numPages < 1) return 'context.numPages must be a positive integer';
  if (!isInt(c.page) || c.page < 1 || c.page > c.numPages) return 'context.page is out of range';
  if (!isStr(c.docText) || !isStr(c.pageText)) return 'context.docText and context.pageText are required';
  if (c.docText.length > LIMITS.docText || c.pageText.length > LIMITS.pageText) return 'context.docText or context.pageText is too long';
  if (!isImage(c.image)) return 'context.image { b64, w, h } is required';
  if (c.pagesText != null && (!isStr(c.pagesText) || c.pagesText.length > LIMITS.pagesText)) return 'context.pagesText must be a string of at most 120,000 characters';
  if (c.images != null && (!Array.isArray(c.images) || c.images.length > LIMITS.images || !c.images.every((im: any) => isImage(im) && isInt(im.page) && im.page >= 1 && im.page <= c.numPages))) return `context.images must be at most ${LIMITS.images} images { page, b64, w, h }`;
  if (c.scout != null && (!Array.isArray(c.scout.pages) || c.scout.pages.length > LIMITS.scoutPages + 1 || !c.scout.pages.every((p: unknown) => isInt(p) && p >= 1 && p <= c.numPages) || !isStr(c.scout.plan) || c.scout.plan.length > LIMITS.plan)) return 'context.scout must be { pages: page numbers, plan }';
  if (c.opener != null && (!isStr(c.opener) || c.opener.length > LIMITS.opener)) return 'context.opener must be a string of at most 2,000 characters';
  if (c.searchText != null && (!isStr(c.searchText) || c.searchText.length > LIMITS.searchText)) return 'context.searchText must be a string of at most 20,000 characters';
  if (c.ink != null && (!isStr(c.ink.summary) || c.ink.summary.length > LIMITS.inkSummary || (c.ink.crop != null && !isImage(c.ink.crop)))) return 'context.ink is malformed';
  if (c.memory != null && (!isStr(c.memory) || c.memory.length > LIMITS.memory)) return `context.memory must be a string of at most ${LIMITS.memory.toLocaleString('en-US')} characters`;
  if (c.scout?.relation != null && !isRelation(c.scout.relation)) return 'context.scout.relation is not a known relation';
  if (c.scoutSection != null && (!isStr(c.scoutSection) || c.scoutSection.length > LIMITS.section)) return 'context.scoutSection is too long';
  return null;
}

export function validateScout(b: any): string | null {
  if (b == null || typeof b !== 'object') return 'body must be an object';
  if (!isStr(b.question) || !b.question.trim() || b.question.length > 2000) return 'question must be 1–2,000 characters';
  if (!isStr(b.docName) || !isStr(b.docHash) || !b.docHash) return 'docName and docHash are required';
  if (!isInt(b.numPages) || b.numPages < 1) return 'numPages must be a positive integer';
  if (!isInt(b.page) || b.page < 1 || b.page > b.numPages) return 'page is out of range';
  if (!isStr(b.digest) || !b.digest || b.digest.length > LIMITS.docText) return 'digest must be a string of at most 120,000 characters';
  if (b.pageText != null && (!isStr(b.pageText) || b.pageText.length > LIMITS.pageText)) return 'pageText must be a string of at most 60,000 characters';
  if (b.prior != null && !(isStr(b.prior.q) && isStr(b.prior.a) && isInt(b.prior.page) && b.prior.q.length <= 2000 && b.prior.a.length <= 20_000)) return 'prior must be { q, a, page }';
  for (const k of ['section', 'memory', 'candidates'] as const) if (b[k] != null && (!isStr(b[k]) || b[k].length > LIMITS[k])) return `${k} must be a string of at most ${LIMITS[k].toLocaleString('en-US')} characters`;
  if (b.image != null && !isImage(b.image)) return 'image must be { b64, w, h }';
  return null;
}

export function validateAsk(b: any): string | null {
  if (b == null || typeof b !== 'object') return 'body must be an object';
  if (!isStr(b.question) || !b.question.trim() || b.question.length > 2000) return 'question must be 1–2,000 characters';
  if (!Array.isArray(b.history) || b.history.length > 3) return 'history must be an array of at most 3';
  if (!b.history.every((h: any) => h && isStr(h.q) && isStr(h.a) && isInt(h.page))) return 'history items need { q, a, page }';
  return validateContext(b.context);
}

/** POST /api/repair's body (RepairWire): reqId, unit index, released text, failed beat, report, deadline. */
export function validateRepair(b: any): string | null {
  if (b == null || typeof b !== 'object') return 'body must be an object';
  if (!isStr(b.reqId) || !b.reqId || b.reqId.length > 100) return 'reqId is required';
  if (!isInt(b.k) || b.k < 0 || b.k > 10_000) return 'k must be a unit index';
  if (!isStr(b.committed) || b.committed.length > LIMITS.committed) return `committed must be a string of at most ${LIMITS.committed.toLocaleString('en-US')} characters`;
  if (!isStr(b.beat) || !b.beat.trim() || b.beat.length > LIMITS.beat) return `beat must be 1–${LIMITS.beat.toLocaleString('en-US')} characters`;
  if (typeof b.deadlineMs !== 'number' || !Number.isFinite(b.deadlineMs) || b.deadlineMs <= 0 || b.deadlineMs > 60_000) return 'deadlineMs must be 1–60000';
  const r = b.report;
  if (r == null || typeof r !== 'object' || JSON.stringify(r).length > LIMITS.report) return `report must be an object of at most ${LIMITS.report.toLocaleString('en-US')} characters`;
  if (!isStr(r.beat) || !isStr(r.tail) || !isInt(r.maxWords) || r.maxWords < 1) return 'report needs { beat, tail, maxWords }';
  if (!Array.isArray(r.problems) || !r.problems.every((p: any) => p && isStr(p.check) && isStr(p.detail) && (p.hint == null || isStr(p.hint)))) return 'report.problems must be [{ check, detail, hint? }]';
  if (!Array.isArray(r.board) || !r.board.every((s: any) => s && isStr(s.section) && isInt(s.count) && (s.items == null || (Array.isArray(s.items) && s.items.every((i: any) => i && isStr(i.id) && isStr(i.kind) && (i.label == null || isStr(i.label))))))) return 'report.board must be [{ section, count, items? }]';
  if (r.consts == null || typeof r.consts !== 'object' || Array.isArray(r.consts) || !Object.values(r.consts).every((v) => typeof v === 'number')) return 'report.consts must be { name: number }';
  if (!Array.isArray(r.finds) || !r.finds.every(isStr) || !Array.isArray(r.later) || !r.later.every(isStr)) return 'report.finds and report.later must be string arrays';
  return null;
}
