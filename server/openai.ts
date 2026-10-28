// server/openai.ts — Responses API client for answers, prewarm and the judge.
//
// Field names verified 2026-10-28 against developers.openai.com/api/docs (web docs only, no calls):
//  - POST https://api.openai.com/v1/responses; `input` messages with `input_text` / `input_image`
//    (`image_url` data URL, `detail`: low | high | auto | original) and assistant `output_text`.
//  - Prompt caching (guides/prompt-caching; GPT-5.6 and later): request-level
//    `prompt_cache_options: { mode: 'explicit' | 'implicit', ttl?: '30m' | '12h', prewarm?: boolean }`,
//    `prompt_cache_key` (top-level string), and per content block
//    `prompt_cache_breakpoint: { mode: 'explicit', ttl: '30m' | '12h' }` (not allowed in top-level
//    `instructions`, so the system prompt is an `input_text` block in a `developer` message).
//    ≤ 4 cache writes per request; writes bill at 1.25× (30m) / 2.5× (12h) input; usage reports
//    `input_tokens_details.{cached_tokens, cache_write_tokens, cache_write_tokens_details.{ttl_30m_tokens, ttl_12h_tokens}}`.
//    Prewarm: same prefix with `prompt_cache_options.prewarm: true`, no output generated.
//  - Reasoning (guides/reasoning): `reasoning.effort` ∈ none | minimal | low | medium | high | xhigh | max,
//    model-dependent. gpt-6.1-sol and gpt-6-astra REJECT `none` (400) — server/env.ts refuses that config.
//  - Fast mode (guides/fast-mode): `service_tier: 'fast'` (Priority processing was renamed Fast mode
//    on 2026-07-30; 'priority' is still accepted). Fast prices are exactly 2× Standard (prices.ts).
//  - Streaming events: `response.output_item.added` (item.id, item.type, message item.phase
//    commentary | final_answer), `response.output_text.delta` (item_id, delta), `response.completed`,
//    `response.incomplete` (response.incomplete_details.reason), `response.failed`
//    (response.error.message), `error` (message).
//  - `text.verbosity`: gpt-6.1-terra accepts "low" (P1 bake-off), but it stays opt-in (PETU_VERBOSITY), off
//    by default: it lost 0.25 judge points on the answers it changed and it re-writes the system cache.
//  - Fast mode stays off (PETU_FAST=0): no first-word gain in the P1 A/B, at 2× the price.
//  - Structured output: `text.format: { type: 'json_schema', name, schema, strict: true }`.
// Cache key (P0 smoke: a per-document key gave the 12h system block 0% cache on every new PDF):
// `prompt_cache_key` is per prompt version, shared by every document, so all answers route to the
// machines that hold the system block. The page block is told apart by its content and its own 30m
// breakpoint (the docs: keys influence routing, they never isolate matching on GPT-5.6+). A
// system-only prewarm (`prewarmSystem`) writes the 12h block when a document opens, if no request
// has read or written it in the last 11.5h (server/cacheStats.ts).
// Explicit caching is on by default (PETU_EXPLICIT_CACHE=0 falls back to implicit caching: same stable
// prefix first, no breakpoint fields, /api/prewarm disabled).
//
// Secrets: the key is used only in the Authorization header below. It is never logged, emitted or
// booked; upstream error text is scrubbed of it.
import { randomUUID } from 'node:crypto';
import type { AskEvent, AskRequest, AskContext } from '../src/agent/protocol';
import { costUsd, worstCaseUsd, PRICES, type Usage } from './prices';
import type { Ledger, Phase } from './ledger';
import { SseParser, ResponseEvents } from './sse';
import { ScriptFilter } from './scriptFilter';
import { Lint } from './lint';
import { systemPrompt, PROMPT_VERSION } from './prompt/system';
import { CacheStats, estimatedUsage } from './cacheStats';

export type Effort = 'none' | 'low' | 'medium' | 'high';
export type ModelConfig = { model: string; effort: Effort; maxOutput: number; fast: boolean; verbosity?: 'low' | 'medium'; explicitCache: boolean };
export type Deps = {
  key: string; ledger: Ledger; phase: Phase; fetch: typeof fetch;
  now?: () => number;
  /** Retry back-off; tests pass an immediate one. */
  sleep?: (ms: number) => Promise<void>;
  /** What the prompt cache likely holds: abort and crash estimates read it, usage feeds it. */
  cache?: CacheStats;
};
const URL_ = 'https://api.openai.com/v1/responses';
export const JUDGE_MODEL = 'gpt-6.1-sol';
const JUDGE_MAX_OUTPUT = 800;

/** Shared by every document: the system block's cache is reused across PDFs. */
export const cacheKey = () => `petu-${PROMPT_VERSION}`;
/** A lower bound on the system block's tokens (≈ 3.3 chars/token measured; 4 keeps it low). */
export const systemTokensLow = () => Math.floor(systemPrompt().length / 4);

const bp = (on: boolean, ttl: '30m' | '12h') => (on ? { prompt_cache_breakpoint: { mode: 'explicit', ttl } } : {});
const img = (b64: string) => `data:image/jpeg;base64,${b64}`;
const sleepDefault = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));
const scrub = (s: string, key: string) => (key ? s.split(key).join('***') : s);
const headers = (key: string) => ({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' });
const developer = (cfg: ModelConfig) => ({ role: 'developer', content: [{ type: 'input_text', text: systemPrompt(), ...bp(cfg.explicitCache, '12h') }] });
const common = (cfg: ModelConfig) => ({
  model: cfg.model, store: false, max_output_tokens: cfg.maxOutput, reasoning: { effort: cfg.effort },
  prompt_cache_key: cacheKey(),
});

export function buildRequest(r: Pick<AskRequest, 'question' | 'history'> & { context: AskContext }, cfg: ModelConfig, prewarm = false) {
  const c = r.context;
  const tail: unknown[] = [];
  if (c.searchText) tail.push({ type: 'input_text', text: c.searchText });
  if (c.ink) {
    tail.push({ type: 'input_text', text: `STUDENT INK on page ${c.page}: ${c.ink.summary}` });
    if (c.ink.crop) tail.push({ type: 'input_image', image_url: img(c.ink.crop.b64), detail: 'high' });
  }
  tail.push({ type: 'input_text', text: `QUESTION (the student is looking at page ${c.page}): ${r.question}` });
  const input = [
    developer(cfg),
    { role: 'user', content: [
      { type: 'input_text', text: c.docText },
      { type: 'input_text', text: c.pageText },
      { type: 'input_image', image_url: img(c.image.b64), detail: 'high', ...bp(cfg.explicitCache, '30m') },
    ] },
    ...(prewarm ? [] : r.history.flatMap((h) => [
      { role: 'user', content: [{ type: 'input_text', text: `QUESTION (page ${h.page}): ${h.q}` }] },
      { role: 'assistant', content: [{ type: 'output_text', text: h.a }] },
    ])),
    ...(prewarm ? [] : [{ role: 'user', content: tail }]),
  ];
  return {
    ...common(cfg), input, stream: !prewarm,
    ...(cfg.explicitCache ? { prompt_cache_options: { mode: 'explicit', ...(prewarm ? { prewarm: true } : {}) } } : {}),
    ...(cfg.fast ? { service_tier: 'fast' } : {}),
    ...(cfg.verbosity ? { text: { verbosity: cfg.verbosity } } : {}),
    metadata: { prompt: PROMPT_VERSION },
  };
}

/** The system block alone, as a prewarm: written once and shared by every document. */
export function buildSystemPrewarm(cfg: ModelConfig) {
  return { ...common(cfg), input: [developer(cfg)], stream: false, prompt_cache_options: { mode: 'explicit', prewarm: true }, metadata: { prompt: PROMPT_VERSION } };
}

/** Upper bound on input tokens: text at 3.2 chars/token, images by the 32-px patch rule × 1.2. */
export function estimateInputTokens(body: { input: unknown }, images: { w: number; h: number }[]): number {
  const chars = JSON.stringify(body.input).replace(/data:image\/jpeg;base64,[A-Za-z0-9+/=]+/g, '').length;
  const patches = images.reduce((n, i) => n + Math.ceil(i.w / 32) * Math.ceil(i.h / 32), 0);
  return Math.ceil(chars / 3.2 + patches * 1.2) + 50;
}

/** One answer: gate → stream → filters → book. Emits AskEvents; resolves when done. */
export async function ask(r: AskRequest, cfg: ModelConfig, d: Deps, emit: (e: AskEvent) => void, signal: AbortSignal): Promise<void> {
  const reqId = randomUUID();
  if (!d.key) { emit({ t: 'error', code: 'no_key', message: 'Add OPENAI_API_KEY to .env and restart npm run dev.', retryable: false }); return; }
  if (!PRICES[cfg.model]) { emit({ t: 'error', code: 'bad_request', message: `No price for ${cfg.model}.`, retryable: false }); return; }
  const body = buildRequest(r, cfg);
  const images = [r.context.image, ...(r.context.ink?.crop ? [r.context.ink.crop] : [])];
  const est = estimateInputTokens(body, images);
  const ck = { model: cfg.model, version: PROMPT_VERSION, docHash: r.context.docHash, page: r.context.page };
  const cachedGuess = d.cache?.expectedCached(ck, est) ?? 0;
  const estUsd = costUsd(cfg.model, estimatedUsage(est, cachedGuess, cfg.maxOutput), '12h', cfg.fast);
  const refused = d.ledger.reserve(reqId, d.phase, worstCaseUsd(cfg.model, est, cfg.maxOutput, cfg.fast), { kind: 'answer', model: cfg.model, estUsd });
  if (refused) { emit({ t: 'error', code: 'cap', message: capHint(refused.code, refused.message, d.phase), retryable: false }); return; }
  emit({ t: 'meta', reqId, model: cfg.model, effort: cfg.effort });

  const now = d.now ?? (() => performance.now());
  const sleep = d.sleep ?? sleepDefault;
  const t0 = now();
  const up = new AbortController();
  const onAbort = () => up.abort();
  signal.addEventListener('abort', onAbort);
  if (signal.aborted) up.abort();
  const filter = new ScriptFilter(), lint = new Lint(), sse = new SseParser(), events = new ResponseEvents();
  let outChars = 0, ttft = NaN, usage: Usage | undefined, failed: Extract<AskEvent, { t: 'error' }> | null = null;
  let sent = false;
  const send = (s: string) => { if (!s || signal.aborted) return; outChars += s.length; if (Number.isNaN(ttft)) ttft = now() - t0; emit({ t: 'text', d: s }); };
  try {
    let res: Response | null = null;
    for (let attempt = 0; attempt < 2 && !res; attempt++) {
      try {
        sent = true;
        const r0 = await d.fetch(URL_, { method: 'POST', signal: up.signal, headers: headers(d.key), body: JSON.stringify(body) });
        if (r0.ok) { res = r0; break; }
        const retryable = r0.status === 429 || r0.status >= 500;
        const text = scrub((await r0.text()).slice(0, 300), d.key);
        if (!retryable || attempt === 1) { failed = { t: 'error', code: r0.status === 429 ? 'rate_limited' : r0.status === 400 ? 'bad_request' : 'upstream', message: `OpenAI ${r0.status}: ${text}`, retryable }; break; }
      } catch (e) {
        if (signal.aborted) throw e;
        if (attempt === 1) { failed = { t: 'error', code: 'network', message: 'Network error reaching OpenAI.', retryable: true }; break; }
      }
      await sleep(500 + Math.random() * 300);
    }
    if (!res) {
      // An HTTP error reply means nothing was generated: free the reservation. A network failure may
      // have reached OpenAI, so it is booked as an estimate below.
      if (failed && failed.code !== 'network') { d.ledger.release(reqId); emit(failed); signal.removeEventListener('abort', onAbort); return; }
    } else {
      const dec = new TextDecoder();
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        if (signal.aborted) break;
        for (const ev of sse.push(dec.decode(chunk, { stream: true }))) {
          for (const u of events.handle(ev)) {
            if (u.t === 'text') send(lint.push(filter.push(u.d)));
            else if (u.t === 'note') emit({ t: 'note', message: u.message });
            else if (u.t === 'usage') usage = u.usage;
            else if (u.t === 'error') failed = { t: 'error', code: 'upstream', message: scrub(u.message, d.key), retryable: true };
          }
        }
      }
      if (signal.aborted) up.abort();
      send(lint.push(filter.end()) + lint.end());
    }
  } catch (e) {
    if (!signal.aborted) failed = { t: 'error', code: outChars ? 'cut_off' : 'network', message: scrub(String(e), d.key).slice(0, 200), retryable: true };
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
  // Book it: real usage when we have it, else an estimate: the input this (doc, page) most likely
  // read from cache at the cached rate, the rest at the 12h write rate, output as streamed.
  const estimated = !usage;
  if (!sent) { d.ledger.release(reqId); return; }
  if (usage) d.cache?.observe(ck, usage, systemTokensLow());
  const u: Usage = usage ?? estimatedUsage(est, cachedGuess, Math.ceil(outChars / 3.2));
  const usd = costUsd(cfg.model, u, '12h', cfg.fast);
  d.ledger.settle({ id: reqId, phase: d.phase, kind: 'answer', model: cfg.model, usd, estimated, tokens: tokens(u) });
  if (signal.aborted) return;
  if (failed && failed.code !== 'cut_off' && !outChars) { emit(failed); return; }
  const s = d.ledger.summary();
  emit({ t: 'done', usage, usd, estimated, spentUsd: s.totalUsd, capUsd: s.capUsd, ttftMs: Math.round(ttft), plan: filter.plan || undefined, lint: lint.notes.length ? lint.notes : undefined });
  if (failed) emit({ ...failed, code: 'cut_off', message: 'The answer was cut off.' });
}

export type PrewarmResult = { ok: boolean; usd: number; reason?: string };

/** Writes the cacheable prefix (system prompt + page block) without generating output. */
export async function prewarm(context: AskContext, cfg: ModelConfig, d: Deps): Promise<PrewarmResult> {
  if (!cfg.explicitCache) return { ok: false, usd: 0, reason: 'prewarm needs explicit caching (PETU_EXPLICIT_CACHE=0)' };
  if (!d.key) return { ok: false, usd: 0, reason: 'no key' };
  if (!PRICES[cfg.model]) return { ok: false, usd: 0, reason: `no price for ${cfg.model}` };
  const body = buildRequest({ question: '', history: [], context }, cfg, true);
  const r = await callJson(body, cfg.model, estimateInputTokens(body, [context.image]), cfg.maxOutput, cfg.fast, 'prewarm', d);
  if (r.ok && r.json?.usage) d.cache?.observe({ model: cfg.model, version: PROMPT_VERSION, docHash: context.docHash, page: context.page }, r.json.usage, systemTokensLow());
  return r.ok ? { ok: true, usd: r.usd } : { ok: false, usd: r.usd, reason: r.message };
}

/**
 * Writes the system block (12h) so a new document's first answer reads it from cache. Skipped when
 * a request read or wrote it in the last 11.5h.
 */
export async function prewarmSystem(cfg: ModelConfig, d: Deps): Promise<PrewarmResult> {
  if (!cfg.explicitCache) return { ok: false, usd: 0, reason: 'prewarm needs explicit caching (PETU_EXPLICIT_CACHE=0)' };
  if (!d.key) return { ok: false, usd: 0, reason: 'no key' };
  if (!PRICES[cfg.model]) return { ok: false, usd: 0, reason: `no price for ${cfg.model}` };
  const k = { model: cfg.model, version: PROMPT_VERSION };
  if (d.cache?.systemFresh(k)) return { ok: true, usd: 0, reason: 'cached' };
  const body = buildSystemPrewarm(cfg);
  const r = await callJson(body, cfg.model, estimateInputTokens(body, []), cfg.maxOutput, cfg.fast, 'prewarm', d);
  if (r.ok) {
    const u = r.json?.usage as Usage | undefined;
    const t = u ? (u.input_tokens_details?.cached_tokens ?? 0) + (u.input_tokens_details?.cache_write_tokens ?? 0) : 0;
    d.cache?.observeSystem(k, Math.max(systemTokensLow(), Math.min(t, u?.input_tokens ?? t)));
  }
  return r.ok ? { ok: true, usd: r.usd } : { ok: false, usd: r.usd, reason: r.message };
}

/** One judge content part: text, or a JPEG with its pixel size (for the worst-case estimate). */
export type JudgePart = { type: 'input_text'; text: string } | { type: 'input_image'; b64: string; w: number; h: number; detail?: 'low' | 'high' | 'auto' };
export type JudgeRequest = { instructions: string; content: JudgePart[]; schema: Record<string, unknown>; name?: string };
export type JudgeResult = { ok: true; output: unknown; usd: number } | { ok: false; code: string; message: string; usd: number };

/** The eval judge: structured output from gpt-6.1-sol at low effort, booked as kind 'judge'. */
export async function judge(j: JudgeRequest, d: Deps): Promise<JudgeResult> {
  if (!d.key) return { ok: false, code: 'no_key', message: 'Add OPENAI_API_KEY to .env and restart npm run dev.', usd: 0 };
  const content = j.content.map((p) => (p.type === 'input_text' ? p : { type: 'input_image', image_url: img(p.b64), detail: p.detail ?? 'high' }));
  const body = {
    model: JUDGE_MODEL, store: false, stream: false, max_output_tokens: JUDGE_MAX_OUTPUT, reasoning: { effort: 'low' },
    input: [
      { role: 'developer', content: [{ type: 'input_text', text: j.instructions }] },
      { role: 'user', content },
    ],
    text: { format: { type: 'json_schema', name: j.name ?? 'judgement', schema: j.schema, strict: true } },
  };
  const images = j.content.flatMap((p) => (p.type === 'input_image' ? [{ w: p.w, h: p.h }] : []));
  const r = await callJson(body, JUDGE_MODEL, estimateInputTokens(body, images), JUDGE_MAX_OUTPUT, false, 'judge', d);
  if (!r.ok) return { ok: false, code: r.code, message: r.message, usd: r.usd };
  const text = outputText(r.json);
  try { return { ok: true, output: JSON.parse(text), usd: r.usd }; } catch { return { ok: false, code: 'upstream', message: `judge returned non-JSON: ${text.slice(0, 120)}`, usd: r.usd }; }
}

type CallResult = { ok: true; json: any; usd: number } | { ok: false; code: string; message: string; usd: number };

/** A non-streamed call: reserve the worst case → POST (one retry on 429/5xx/network) → book usage. */
async function callJson(body: unknown, model: string, est: number, maxOutput: number, fast: boolean, kind: 'prewarm' | 'judge', d: Deps): Promise<CallResult> {
  const id = randomUUID();
  const refused = d.ledger.reserve(id, d.phase, worstCaseUsd(model, est, maxOutput, fast), { kind, model });
  if (refused) return { ok: false, code: 'cap', message: capHint(refused.code, refused.message, d.phase), usd: 0 };
  const sleep = d.sleep ?? sleepDefault;
  let last: CallResult = { ok: false, code: 'network', message: 'Network error reaching OpenAI.', usd: 0 };
  let reached = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await d.fetch(URL_, { method: 'POST', headers: headers(d.key), body: JSON.stringify(body) });
      const text = await res.text();
      if (res.ok) {
        const json = JSON.parse(text);
        const u = json.usage as Usage | undefined;
        const estimated = !u;
        const usage: Usage = u ?? { input_tokens: est, output_tokens: maxOutput, input_tokens_details: { cache_write_tokens: est } };
        const usd = costUsd(model, usage, '12h', fast);
        d.ledger.settle({ id, phase: d.phase, kind, model, usd, estimated, tokens: tokens(usage) });
        return { ok: true, json, usd };
      }
      last = { ok: false, code: res.status === 429 ? 'rate_limited' : res.status === 400 ? 'bad_request' : 'upstream', message: `OpenAI ${res.status}: ${scrub(text.slice(0, 300), d.key)}`, usd: 0 };
      if (!(res.status === 429 || res.status >= 500)) break;
    } catch (e) {
      reached = true; // a network error after sending may still bill; book the worst case below
      last = { ok: false, code: 'network', message: scrub(String(e), d.key).slice(0, 200), usd: 0 };
    }
    if (attempt === 0) await sleep(500 + Math.random() * 300);
  }
  if (reached) {
    const usd = worstCaseUsd(model, est, maxOutput, fast);
    d.ledger.settle({ id, phase: d.phase, kind, model, usd, estimated: true });
    return { ...last, usd };
  }
  d.ledger.release(id);
  return last;
}

function outputText(json: any): string {
  if (typeof json?.output_text === 'string') return json.output_text;
  for (const item of json?.output ?? []) if (item?.type === 'message') for (const c of item.content ?? []) if (c?.type === 'output_text') return String(c.text ?? '');
  return '';
}

function tokens(u: Usage) {
  return { in: u.input_tokens, cached: u.input_tokens_details?.cached_tokens ?? 0, out: u.output_tokens };
}

/** Caps are set per run on the command line (never by editing .env). */
export function capHint(code: 'total' | 'daily' | 'phase', message: string, phase: Phase): string {
  if (code === 'total') return `${message} PETU_TOTAL_CAP_USD=<dollars> npm run dev sets it for a run, up to the checkpoint's $40 hard stop.`;
  if (code === 'daily') return `${message} It resets tomorrow, or raise it for this run: PETU_DAILY_CAP_USD=6 npm run dev.`;
  return `${message} Raise it for this run on the command line: PETU_CAP_${phase.toUpperCase()}=<dollars> npm run dev.`;
}
