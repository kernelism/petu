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
import { HARD_STOP_USD, type AskEvent, type AskRequest, type AskContext } from '../src/agent/protocol';
import { costUsd, worstCaseUsd, PRICES, type Usage } from './prices';
import type { Ledger, Phase } from './ledger';
import { SseParser, ResponseEvents } from './sse';
import { ScriptFilter } from './scriptFilter';
import { Lint } from './lint';
import { systemPrompt, PROMPT_VERSION } from './prompt/system';
import { SCOUT_SYSTEM, SCOUT_VERSION } from './prompt/scout';
import { SCOUT_SCHEMA, fallbackScout, parseScout, type ScoutEvent, type ScoutRequest, type ScoutResult } from '../src/agent/scout';
import { OpenerGate, ScoutJson } from './scoutStream';
import type { Relation } from '../src/agent/context/memory';
import { CacheStats, estimatedUsage } from './cacheStats';
import { STORYBOARD_SYSTEM, STORYBOARD_VERSION } from './prompt/storyboard';
import { STORYBOARD_SCHEMA, parseStoryboard, storyboardText, type Storyboard } from '../src/agent/storyboard';
import { ANTHROPIC_URL, AnthropicEvents, NO_ANTHROPIC_KEY, anthropicHeaders, anthropicInput, isAnthropicModel, normalizeUsage, toAnthropicRequest, type AnthropicUsage } from './anthropic';

export type Effort = 'none' | 'low' | 'medium' | 'high';
export type ModelConfig = { model: string; effort: Effort; maxOutput: number; fast: boolean; verbosity?: 'low' | 'medium'; explicitCache: boolean;
  /** Vision detail for the scout's other pages (the visible page is always high). Default high. */
  pageDetail?: 'low' | 'high';
  /** A deadline for the whole call (the storyboard: PETU_STORYBOARD_TIMEOUT_MS; default STORYBOARD_TIMEOUT_MS). */
  timeoutMs?: number };
export type Deps = {
  key: string; ledger: Ledger; phase: Phase; fetch: typeof fetch;
  /** PETU_ANTHROPIC_KEY (server/env.ts): used only when the answer model is a Claude model (server/anthropic.ts). */
  anthropicKey?: string;
  now?: () => number;
  /** Retry back-off; tests pass an immediate one. */
  sleep?: (ms: number) => Promise<void>;
  /** What the prompt cache likely holds: abort and crash estimates read it, usage feeds it. */
  cache?: CacheStats;
  /** Upstream timeouts (tests pass short ones). */
  timeouts?: Partial<Timeouts>;
  /** The answer record (plugin: .petu/answers.jsonl): question, page, the script as sent, lint notes with any malformed tag's raw text. */
  log?: (rec: AnswerRecord) => void;
};
export type AnswerRecord = { at: string; phase: string; model: string; effort: string; page: number; question: string; script: string; lint: string[]; usd: number; error?: string;
  /** The storyboard stage 2 performed (or why it ran on the scout's plan alone), its latency and cost. */
  storyboard?: { model: string; effort: string; version: string; ms: number; usd: number; board?: Storyboard; fallback?: string } };
/**
 * `headersMs`: no response headers → the attempt is abandoned (retried once, before any text).
 * `idleMs`: a streamed answer that sends nothing for this long is ended (cut_off after text).
 * `callMs`: a non-streamed call (prewarm, judge) as a whole.
 */
export type Timeouts = { headersMs: number; idleMs: number; callMs: number };
export const TIMEOUTS: Timeouts = { headersMs: 15_000, idleMs: 20_000, callMs: 60_000 };
const URL_ = 'https://api.openai.com/v1/responses';
export const JUDGE_MODEL = 'gpt-6.1-sol';
/** r3 rubric (5 criteria + defect flags + notes) needs more room than r2; the reservation uses this too. */
import { JUDGE_MAX_OUTPUT } from './limits';

/** Shared by every document: the system block's cache is reused across PDFs. */
export const cacheKey = () => `petu-${PROMPT_VERSION}`;
/** A lower bound on the system block's tokens (≈ 3.3 chars/token measured; 4 keeps it low). */
export const systemTokensLow = () => Math.floor(systemPrompt().length / 4);

const bp = (on: boolean, ttl: '30m' | '12h') => (on ? { prompt_cache_breakpoint: { mode: 'explicit', ttl } } : {});
const img = (b64: string) => `data:image/jpeg;base64,${b64}`;
const sleepDefault = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));
const scrub = (s: string, key: string) => (key ? s.split(key).join('***') : s);
const headers = (key: string) => ({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' });
/** Where a model's calls go: OpenAI's Responses API, or Anthropic's Messages API for claude-* (stage 2 and its prewarm only). */
type Endpoint = { anthropic: boolean; vendor: string; url: string; key: string; headers: Record<string, string> };
export const endpointOf = (model: string, d: Pick<Deps, 'key' | 'anthropicKey'>): Endpoint => (isAnthropicModel(model)
  ? { anthropic: true, vendor: 'Anthropic', url: ANTHROPIC_URL, key: d.anthropicKey ?? '', headers: anthropicHeaders(d.anthropicKey ?? '') }
  : { anthropic: false, vendor: 'OpenAI', url: URL_, key: d.key, headers: headers(d.key) });
const noKeyMessage = (ep: Endpoint) => (ep.anthropic ? NO_ANTHROPIC_KEY : 'Add OPENAI_API_KEY to .env and restart npm run dev.');
/**
 * Input tokens of a provider's request body, upper bound. Anthropic's tokenizer on current models
 * counts up to ~1.35× what an older tokenizer does: its estimate is scaled by that.
 */
const estimateFor = (ep: Endpoint, body: any, images: { w: number; h: number }[]) =>
  (ep.anthropic ? Math.ceil(estimateInputTokens(anthropicInput(body), images) * 1.35) : estimateInputTokens(body, images));
/** Stage 2's request for the model's provider (the Anthropic body keeps the same blocks and breakpoints). */
export function buildAnswerRequest(r: Parameters<typeof buildRequest>[0], cfg: ModelConfig, prewarm = false): any {
  const oa = buildRequest(r, cfg, prewarm);
  return isAnthropicModel(cfg.model) ? toAnthropicRequest(oa as never, cfg, prewarm) : oa;
}
const developer = (cfg: ModelConfig) => ({ role: 'developer', content: [{ type: 'input_text', text: systemPrompt(), ...bp(cfg.explicitCache, '12h') }] });
const common = (cfg: ModelConfig) => ({
  model: cfg.model, store: false, max_output_tokens: cfg.maxOutput, reasoning: { effort: cfg.effort },
  prompt_cache_key: cacheKey(),
});

/**
 * Stage 2 (perform). Cacheable prefix: the system prompt (12h), the deck digest (30m: constant per
 * document), the visible page's listing and image (30m: constant per page). Then history, then the
 * volatile tail: the scout's other pages (listings, then their images), the scout's plan, student
 * ink, and the question last.
 */
export function buildRequest(r: Pick<AskRequest, 'question' | 'history'> & { context: AskContext; storyboard?: Storyboard }, cfg: ModelConfig, prewarm = false) {
  const c = r.context;
  const tail: unknown[] = groundingTail(c, cfg);
  if (r.storyboard) tail.push({ type: 'input_text', text: storyboardText(r.storyboard) });
  tail.push({ type: 'input_text', text: `QUESTION (the student is looking at page ${c.page}): ${r.question}` });
  if (c.opener) tail.push({ type: 'input_text', text: openerNote(c.opener) });
  const input = [
    developer(cfg),
    pageBlock(c, cfg),
    ...(prewarm ? [] : memoryBlock(c, cfg)),
    ...(prewarm ? [] : historyTurns(r.history)),
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

/** The cacheable page block: the deck digest (30m) and the visible page's listing and image (30m). */
const pageBlock = (c: AskContext, cfg: ModelConfig) => ({ role: 'user', content: [
  { type: 'input_text', text: c.docText, ...bp(cfg.explicitCache, '30m') },
  { type: 'input_text', text: c.pageText },
  { type: 'input_image', image_url: img(c.image.b64), detail: 'high', ...bp(cfg.explicitCache, '30m') },
] });
/**
 * Session MEMORY (follow-ups): its own message after the page block, cached at its end (30m). It is
 * append-only, so each turn reads the earlier turns from cache (≤ 4 breakpoints: system, digest, image, memory).
 */
const memoryBlock = (c: AskContext, cfg: ModelConfig) => (c.memory ? [{ role: 'user', content: [{ type: 'input_text', text: c.memory, ...bp(cfg.explicitCache, '30m') }] }] : []);
const historyTurns = (h: AskRequest['history']) => h.flatMap((x) => [
  { role: 'user', content: [{ type: 'input_text', text: `QUESTION (page ${x.page}): ${x.q}` }] },
  { role: 'assistant', content: [{ type: 'output_text', text: x.a }] },
]);
/** The volatile grounding both stage 2 and the storyboard read: the scout's pages and images, the plan, student ink. */
function groundingTail(c: AskContext, cfg: ModelConfig): unknown[] {
  const tail: unknown[] = [];
  if (c.pagesText) tail.push({ type: 'input_text', text: c.pagesText });
  for (const im of c.images ?? []) {
    tail.push({ type: 'input_text', text: `IMAGE of page ${im.page}:` });
    tail.push({ type: 'input_image', image_url: img(im.b64), detail: cfg.pageDetail ?? 'high' });
  }
  if (c.searchText) tail.push({ type: 'input_text', text: c.searchText });
  if (c.scout) {
    const order = c.scout.pages.join(', ');
    tail.push({ type: 'input_text', text: `PLAN (a first read of the whole document; pages in teaching order: ${order})${c.scout.plan ? `: ${c.scout.plan}` : ''}` });
    if (c.memory && c.scout.relation) tail.push({ type: 'input_text', text: relationNote(c.scout.relation) });
  }
  if (c.ink) {
    tail.push({ type: 'input_text', text: `STUDENT INK on page ${c.page}: ${c.ink.summary}` });
    if (c.ink.crop) tail.push({ type: 'input_image', image_url: img(c.ink.crop.b64), detail: 'high' });
  }
  return tail;
}

/**
 * How this question stands to the previous answer (the last in MEMORY), as the scout read it. A
 * revision (another picture, simpler, another example, deeper) adds what it asks of the board and
 * the narration: a fresh section, a deliberately different representation or level, nothing repeated.
 * Per-turn text in the volatile tail, so the cached system block stays one for every question.
 */
export function relationNote(r: Relation): string {
  const head = `RELATION to your previous answer (the last in MEMORY): ${r}.`;
  if (r === 'continue') return `${head} Carry on from where it left off, in the same scene, without repeating it.`;
  if (r === 'new-topic') return `${head} A new question: answer it on its own; refer to earlier answers only when they help.`;
  const change: Record<string, string> = {
    'revise-representation': 'The student wants the same idea shown another, better way: choose a different kind of picture, the one that shows the cause producing the effect most directly for what this student is missing (a physical picture, a count of things, a before and after, a picture on the slide\'s own figure), not the same kind of chart redrawn.',
    'simplify': 'The student wants it simpler: fewer things on the board, plain everyday words, and one everyday comparison mapped part for part onto the real thing: draw the comparison itself, each part labelled with the real thing it stands for, so the mapping is something the student sees, then show the real idea in that light.',
    'new-example': 'The student wants another example: a new case with new values that the same idea runs on, so they watch the same mechanism work again.',
    'deeper': 'The student wants to go deeper: the next level of the mechanism under what you showed, built on a concrete case.',
  };
  return `${head} ${change[r]} What you showed did not land, or not well enough. Do not add to the old picture: open a fresh board section with a new id and teach the idea with this deliberately different representation or level. The new picture shows the mechanism happening (change one thing and let the student watch what follows) and its final state shows the point on its own. Your first beat says in a few words what is different this time. Reuse the slide's own figure when it can carry the new picture, and point back to the earlier picture only to contrast. Never repeat a claim or a drawing MEMORY lists.`;
}

/** The storyboard's cache key: one per storyboard prompt version, shared by every document. */
export const storyCacheKey = () => `petu-story-${STORYBOARD_VERSION}`;
/**
 * The storyboard's deadline, from its request: past it stage 2 runs on the scout's plan. The opener
 * usually plays for 6–12s; a design that arrives much later than that costs an audible pause.
 */
export const STORYBOARD_TIMEOUT_MS = 12_000;

/**
 * The lesson design. Same grounding as stage 2 (developer = the designer's brief (12h), then the
 * digest and the visible page (30m each), history, the scout's pages, images and plan, ink), then
 * the question and the opener already spoken. Strict JSON out (STORYBOARD_SCHEMA), streamed so a
 * deadline or the client's abort can end it.
 */
export function buildStoryboardRequest(r: Pick<AskRequest, 'question' | 'history'> & { context: AskContext }, cfg: ModelConfig) {
  const c = r.context;
  const tail = groundingTail(c, cfg);
  tail.push({ type: 'input_text', text: `QUESTION (the student is looking at page ${c.page}): ${r.question}` });
  tail.push({ type: 'input_text', text: c.opener ? `OPENING ALREADY SPOKEN (the tutor said this aloud and pointed as its tags show; the lesson continues from it): ${c.opener}` : 'No opening was spoken: the lesson starts the answer.' });
  return {
    model: cfg.model, store: false, max_output_tokens: cfg.maxOutput, reasoning: { effort: cfg.effort },
    prompt_cache_key: storyCacheKey(),
    input: [
      { role: 'developer', content: [{ type: 'input_text', text: STORYBOARD_SYSTEM, ...bp(cfg.explicitCache, '12h') }] },
      pageBlock(c, cfg),
      ...memoryBlock(c, cfg),
      ...historyTurns(r.history),
      { role: 'user', content: tail },
    ],
    stream: true,
    text: { format: { type: 'json_schema', name: 'storyboard', schema: STORYBOARD_SCHEMA, strict: true } },
    ...(cfg.explicitCache ? { prompt_cache_options: { mode: 'explicit' } } : {}),
    metadata: { prompt: STORYBOARD_VERSION },
  };
}

export type StoryboardEvent = Extract<AskEvent, { t: 'storyboard' }>;

/**
 * Stage 1.5: asks for the storyboard and waits for it whole (no retry: a slow or failed design means
 * stage 2 runs on the scout's plan). Booked as kind 'storyboard': real usage when the stream
 * completes, else an estimate (the full output budget: reasoning may have been spent unseen).
 * Never throws. On the client's abort it returns `fallback: 'aborted'`.
 */
export async function storyboard(r: Pick<AskRequest, 'question' | 'history'> & { context: AskContext }, cfg: ModelConfig, d: Deps, signal?: AbortSignal): Promise<StoryboardEvent> {
  const now = d.now ?? (() => performance.now());
  const t0 = now();
  const base = { t: 'storyboard' as const, model: cfg.model, effort: cfg.effort, version: STORYBOARD_VERSION };
  const out = (o: { usd?: number; fallback?: string; board?: Storyboard; usage?: Usage; estimated?: boolean }): StoryboardEvent => ({
    ...base, ms: Math.round(now() - t0), usd: o.usd ?? 0,
    ...(o.board ? { board: o.board } : {}), ...(o.fallback ? { fallback: o.fallback } : {}), ...(o.estimated ? { estimated: true } : {}),
    ...(o.usage ? { input: o.usage.input_tokens, cached: o.usage.input_tokens_details?.cached_tokens ?? 0, output: o.usage.output_tokens, ...(o.usage.output_tokens_details?.reasoning_tokens != null ? { reasoning: o.usage.output_tokens_details.reasoning_tokens } : {}) } : {}),
  });
  if (!d.key) return out({ fallback: 'no key' });
  if (!PRICES[cfg.model]) return out({ fallback: `no price for ${cfg.model}` });
  if (signal?.aborted) return out({ fallback: 'aborted' });
  const body = buildStoryboardRequest(r, cfg);
  const est = estimateInputTokens(body, askImages(r.context));
  const id = randomUUID();
  const refused = d.ledger.reserve(id, d.phase, worstCaseUsd(cfg.model, est, cfg.maxOutput, cfg.fast), { kind: 'storyboard', model: cfg.model });
  if (refused) return out({ fallback: 'cap' });

  const T = { ...TIMEOUTS, ...d.timeouts };
  const up = new AbortController();
  const onAbort = () => up.abort();
  signal?.addEventListener('abort', onAbort);
  let timedOut = false, usage: Usage | undefined, complete = false, text = '', failed = '';
  const deadline = setTimeout(() => { timedOut = true; up.abort(); }, Math.min(cfg.timeoutMs ?? STORYBOARD_TIMEOUT_MS, T.callMs));
  try {
    const res = await d.fetch(URL_, { method: 'POST', signal: up.signal, headers: headers(d.key), body: JSON.stringify(body) });
    if (!res.ok || !res.body) {
      const msg = scrub((await res.text().catch(() => '')).slice(0, 120), d.key);
      d.ledger.release(id);
      return out({ fallback: `storyboard failed: OpenAI ${res.status}: ${msg}` });
    }
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const dec = new TextDecoder(), sse = new SseParser(), events = new ResponseEvents();
    for (;;) {
      let idle: ReturnType<typeof setTimeout> | undefined;
      const x = await Promise.race([reader.read(), new Promise<'idle'>((ok) => { idle = setTimeout(() => ok('idle'), T.idleMs); })]);
      clearTimeout(idle);
      if (x === 'idle') { up.abort(); reader.cancel().catch(() => undefined); failed = 'storyboard stalled'; break; }
      if (x.done) break;
      for (const ev of sse.push(dec.decode(x.value, { stream: true }))) {
        for (const u of events.handle(ev)) {
          if (u.t === 'text') text += u.d;
          else if (u.t === 'usage') { usage = u.usage; complete = u.complete; }
          else if (u.t === 'error') throw new Error(u.message);
        }
      }
    }
  } catch (e) {
    failed = signal?.aborted ? 'aborted' : timedOut ? 'storyboard timed out' : `storyboard failed: ${scrub(String(e), d.key).slice(0, 120)}`;
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener('abort', onAbort);
  }
  const u: Usage = usage ?? estimatedUsage(est, 0, cfg.maxOutput);
  const usd = costUsd(cfg.model, u, '12h', cfg.fast);
  d.ledger.settle({ id, phase: d.phase, kind: 'storyboard', model: cfg.model, usd, estimated: !usage, tokens: tokens(u) });
  if (failed) return out({ usd, fallback: failed, ...(usage ? { usage } : { estimated: true }) });
  if (!complete) return out({ usd, fallback: usage ? 'storyboard cut short upstream' : 'storyboard ended early', ...(usage ? { usage } : { estimated: true }) });
  const p = parseStoryboard(text);
  return out({ usd, usage, ...('board' in p ? { board: p.board } : { fallback: p.fallback }) });
}

/**
 * Stage 2 continues the scout's opener: the student has already heard it (and seen its marks), so the
 * script picks up at the next sentence, as one continuous explanation.
 */
export const openerNote = (opener: string) =>
  `ALREADY SPOKEN: you have already said the opening below aloud, and its tags have been drawn. Your script continues straight on from its last word, as the next sentence of the same explanation. The student has its claim: never state it again, in any words, not even as a lead-in to your next point. Your first sentence must add something the opening did not say: why it holds (the mechanism), or the first step of it drawn. Do not repeat, rephrase or summarise the opening, do not answer the question again, and do not mark again what it marked. If the opening already says everything the question needs, output nothing.\nOPENING: ${opener}`;

/** The scout's cache key: one per scout prompt version, shared by every document. */
export const scoutCacheKey = () => `petu-scout-${SCOUT_VERSION}`;
/** How much of the previous answer the scout reads. */
const PRIOR_CHARS = 600;

/**
 * Stage 1 (scout). Cacheable prefix: the scout instructions and the deck digest (30m), byte-identical
 * to the digest the answer sends, then the visible page's listing (30m: constant per page; what the
 * opener may point at). Then the previous exchange and the question last. Strict JSON out, streamed:
 * the opener comes first so it can be spoken while the pages and plan are written.
 */
export function buildScoutRequest(r: ScoutRequest, cfg: ModelConfig, prewarm = false) {
  const tail = [`The student is looking at page ${r.page}.`];
  if (r.prior) tail.push(`PREVIOUS QUESTION (page ${r.prior.page}): ${r.prior.q}\nPREVIOUS ANSWER (spoken): ${r.prior.a.length > PRIOR_CHARS ? `${r.prior.a.slice(0, PRIOR_CHARS)}…` : r.prior.a}`);
  tail.push(`QUESTION: ${r.question}`);
  if (r.candidates) tail.splice(tail.length - 1, 0, r.candidates);
  const prefix: unknown[] = [{ type: 'input_text', text: r.digest, ...bp(cfg.explicitCache, '30m') }];
  // ctx=new, huge documents: the visible section at full detail, cached per section.
  if (r.section) prefix.push({ type: 'input_text', text: r.section, ...bp(cfg.explicitCache, '30m') });
  // The same listing the answer gets (so prewarm and ask agree byte for byte), minus the image —
  // unless the page is a scan or draws its equations as outlines: then its image, at low detail.
  const listing = r.image ? r.pageText : r.pageText?.replace(/; image attached(?=[;)])/, '; listing only, no image');
  if (listing) prefix.push({ type: 'input_text', text: listing, ...(r.image ? {} : bp(cfg.explicitCache, '30m')) });
  if (r.image) prefix.push({ type: 'input_image', image_url: img(r.image.b64), detail: 'low', ...bp(cfg.explicitCache, '30m') });
  // Session memory: append-only, so each turn reads the earlier turns from cache.
  if (r.memory) prefix.push({ type: 'input_text', text: r.memory, ...bp(cfg.explicitCache, '30m') });
  return {
    model: cfg.model, store: false, max_output_tokens: cfg.maxOutput, reasoning: { effort: cfg.effort },
    prompt_cache_key: scoutCacheKey(),
    input: [
      { role: 'developer', content: [{ type: 'input_text', text: SCOUT_SYSTEM }] },
      { role: 'user', content: prefix },
      ...(prewarm ? [] : [{ role: 'user', content: [{ type: 'input_text', text: tail.join('\n') }] }]),
    ],
    stream: !prewarm,
    ...(cfg.fast ? { service_tier: 'fast' } : {}),
    text: { format: { type: 'json_schema', name: 'scout', schema: SCOUT_SCHEMA, strict: true } },
    ...(cfg.explicitCache ? { prompt_cache_options: { mode: 'explicit', ...(prewarm ? { prewarm: true } : {}) } } : {}),
    metadata: { prompt: SCOUT_VERSION },
  };
}

/** Upper bound on the scout's wait for its verdict: past it the answer goes ahead on the visible page. */
export const SCOUT_TIMEOUT_MS = 8000;

/**
 * Stage 1, streamed (no retry: a slow or failed scout falls back to the visible page rather than
 * delaying the answer). Emits `opener` sentences as they complete, the `scout` verdict as soon as
 * the pages and plan are parsed (always exactly one, a fallback on any failure), then `end` with the
 * cost. Booked as kind 'scout': real usage when the stream completes, else an estimate. Never throws.
 */
export async function scoutStream(r: ScoutRequest, cfg: ModelConfig, d: Deps, emit: (e: ScoutEvent) => void, signal?: AbortSignal): Promise<ScoutResult> {
  const now = d.now ?? (() => performance.now());
  const t0 = now();
  const ms = () => Math.round(now() - t0);
  let verdict: ScoutResult | null = null;
  const gate = new OpenerGate(r.page);
  let openerMs: number | undefined;
  const say = (s: string) => {
    if (!s || verdict || signal?.aborted) return;
    if (openerMs == null) openerMs = ms();
    emit({ t: 'opener', d: s, ms: ms() });
  };
  const decide = (v: { pages: number[]; plan: string; fallback?: string; find?: string[]; relation?: Relation }) => {
    if (verdict) return;
    say(gate.end());
    verdict = { pages: v.pages, plan: v.plan, ms: ms(), usd: 0, ...(v.fallback ? { fallback: v.fallback } : {}), ...(v.relation ? { relation: v.relation } : {}), ...(v.find?.length ? { find: v.find } : {}), ...(gate.said ? { opener: gate.said } : {}), ...(openerMs != null ? { openerMs } : {}) };
    if (!signal?.aborted) emit({ t: 'scout', pages: verdict.pages, plan: verdict.plan, ms: verdict.ms, ...(v.fallback ? { fallback: v.fallback } : {}), ...(v.relation ? { relation: v.relation } : {}), ...(v.find?.length ? { find: v.find } : {}), ...(gate.notes.length ? { notes: gate.notes } : {}) });
  };
  const finish = (usd: number, u?: Usage): ScoutResult => {
    if (!verdict) decide(fallbackScout(r.page, 'scout ended without a verdict'));
    verdict!.usd = usd;
    if (!signal?.aborted) emit({ t: 'end', usd, ms: ms(), ...(u ? { cached: u.input_tokens_details?.cached_tokens ?? 0, input: u.input_tokens } : {}) });
    return verdict!;
  };
  if (!d.key) { decide(fallbackScout(r.page, 'no key')); return finish(0); }
  if (!PRICES[cfg.model]) { decide(fallbackScout(r.page, `no price for ${cfg.model}`)); return finish(0); }

  const body = buildScoutRequest(r, cfg);
  const est = estimateInputTokens(body, r.image ? [{ w: 512, h: 512 }] : []);
  const id = randomUUID();
  const refused = d.ledger.reserve(id, d.phase, worstCaseUsd(cfg.model, est, cfg.maxOutput, cfg.fast), { kind: 'scout', model: cfg.model });
  if (refused) { decide(fallbackScout(r.page, 'cap')); return finish(0); }

  const T = { ...TIMEOUTS, ...d.timeouts };
  const up = new AbortController();
  const onAbort = () => up.abort();
  signal?.addEventListener('abort', onAbort);
  if (signal?.aborted) up.abort();
  let timedOut = false, sent = false, usage: Usage | undefined, outChars = 0, text = '';
  // The verdict must come within SCOUT_TIMEOUT_MS (or the configured call timeout, if shorter).
  const deadline = setTimeout(() => { timedOut = true; up.abort(); }, Math.min(SCOUT_TIMEOUT_MS, T.callMs));
  const json = new ScoutJson({
    onString: (k, dlt) => { if (k === 'opener') say(gate.push(dlt)); },
    onField: (k) => {
      const f = json.fields;
      // The opener's last sentence plays as soon as its string closes, not when the verdict comes.
      if (k === 'opener') say(gate.end());
      // The verdict once pages and plan are both in (the opener, first in the schema, is complete by then).
      if ((k === 'pages' || k === 'plan') && 'pages' in f && 'plan' in f) decide(parseScout(JSON.stringify({ pages: f.pages, plan: f.plan, find: f.find, relation: f.relation }), r.numPages, r.page));
    },
  });
  try {
    sent = true;
    const res = await d.fetch(URL_, { method: 'POST', signal: up.signal, headers: headers(d.key), body: JSON.stringify(body) });
    if (!res.ok || !res.body) {
      const msg = scrub((await res.text().catch(() => '')).slice(0, 120), d.key);
      clearTimeout(deadline);
      signal?.removeEventListener('abort', onAbort);
      d.ledger.release(id);
      decide(fallbackScout(r.page, `scout failed: OpenAI ${res.status}: ${msg}`));
      return finish(0);
    }
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const dec = new TextDecoder(), sse = new SseParser(), events = new ResponseEvents();
    for (;;) {
      let idle: ReturnType<typeof setTimeout> | undefined;
      const x = await Promise.race([reader.read(), new Promise<'idle'>((ok) => { idle = setTimeout(() => ok('idle'), T.idleMs); })]);
      clearTimeout(idle);
      if (x === 'idle') { up.abort(); reader.cancel().catch(() => undefined); break; }
      if (x.done) break;
      for (const ev of sse.push(dec.decode(x.value, { stream: true }))) {
        for (const u of events.handle(ev)) {
          if (u.t === 'text') { text += u.d; outChars += u.d.length; json.push(u.d); }
          else if (u.t === 'usage') usage = u.usage;
          else if (u.t === 'error') throw new Error(u.message);
        }
      }
    }
  } catch (e) {
    if (!verdict && !signal?.aborted) decide(fallbackScout(r.page, timedOut ? 'scout timed out' : `scout failed: ${scrub(String(e), d.key).slice(0, 120)}`));
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener('abort', onAbort);
  }
  if (!verdict) {
    // The stream ended without the fields arriving one by one (or the incremental read missed them):
    // parse the whole text once more.
    decide(timedOut ? fallbackScout(r.page, 'scout timed out') : parseScout(text, r.numPages, r.page));
  }
  if (!sent) { d.ledger.release(id); return finish(0); }
  const u: Usage = usage ?? estimatedUsage(est, 0, Math.ceil(outChars / 3.2) || cfg.maxOutput);
  const usd = costUsd(cfg.model, u, '12h', cfg.fast);
  d.ledger.settle({ id, phase: d.phase, kind: 'scout', model: cfg.model, usd, estimated: !usage, tokens: tokens(u) });
  return finish(usd, usage);
}

/** Stage 1 as one result (the opener included): `scoutStream` without the events. */
export async function scout(r: ScoutRequest, cfg: ModelConfig, d: Deps, signal?: AbortSignal): Promise<ScoutResult> {
  return scoutStream(r, cfg, d, () => {}, signal);
}

/** Writes the scout's prefix (instructions + digest) without generating output. */
export async function prewarmScout(r: Pick<ScoutRequest, 'digest' | 'docHash' | 'numPages' | 'page' | 'docName' | 'pageText' | 'section'>, cfg: ModelConfig, d: Deps): Promise<PrewarmResult> {
  if (!cfg.explicitCache) return { ok: false, usd: 0, reason: 'prewarm needs explicit caching (PETU_EXPLICIT_CACHE=0)' };
  if (!d.key) return { ok: false, usd: 0, reason: 'no key' };
  if (!PRICES[cfg.model]) return { ok: false, usd: 0, reason: `no price for ${cfg.model}` };
  const body = buildScoutRequest({ ...r, question: '' }, cfg, true);
  const res = await callJson(body, cfg.model, estimateInputTokens(body, []), cfg.maxOutput, cfg.fast, 'prewarm', d);
  return res.ok ? { ok: true, usd: res.usd } : { ok: false, usd: res.usd, reason: res.message };
}

/** The system block alone, as a prewarm: written once and shared by every document. */
export function buildSystemPrewarm(cfg: ModelConfig) {
  return { ...common(cfg), input: [developer(cfg)], stream: false, prompt_cache_options: { mode: 'explicit', prewarm: true }, metadata: { prompt: PROMPT_VERSION } };
}

/**
 * Upper bound on input tokens: ASCII text at 3.2 chars/token, any other character as a whole token
 * (accents, CJK, math symbols), images by the 32-px patch rule × 1.2.
 */
export function estimateInputTokens(body: { input: unknown }, images: { w: number; h: number }[]): number {
  const text = JSON.stringify(body.input).replace(/data:image\/jpeg;base64,[A-Za-z0-9+/=]+/g, '');
  const wide = text.match(/[^\x00-\x7f]/g)?.length ?? 0;
  const patches = images.reduce((n, i) => n + Math.ceil(i.w / 32) * Math.ceil(i.h / 32), 0);
  return Math.ceil((text.length - wide) / 3.2 + wide + patches * 1.2) + 50;
}

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
/** A base64 JPEG's pixel size from its frame header, or null when it is not a readable JPEG. */
export function jpegSize(b64: string): { w: number; h: number } | null {
  const b = Buffer.from(b64.slice(0, 1 << 17), 'base64');
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  for (let i = 2; i + 3 < b.length;) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1];
    if (m === 0xff) { i++; continue; } // fill byte
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd9)) { i += 2; continue; } // no length
    if (SOF.has(m)) return i + 8 < b.length ? { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) } : null;
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}
/** An image's size for the worst case: the larger of what the client claims and what the JPEG says. */
const imageDims = (im: { b64: string; w: number; h: number }) => {
  const real = jpegSize(im.b64);
  return { w: Math.max(im.w, real?.w ?? 0), h: Math.max(im.h, real?.h ?? 0) };
};
/** The images of an answer request, sized for the worst case. */
export const askImages = (c: AskContext) => [c.image, ...(c.images ?? []), ...(c.ink?.crop ? [c.ink.crop] : [])].map(imageDims);

/**
 * One answer: [storyboard →] gate → stream → filters → book. Emits AskEvents; resolves when done.
 * With `story` (a model config) and an opener already playing, the lesson is designed first
 * (`storyboard` event, before `meta`) and stage 2 performs it; any storyboard failure means stage 2
 * runs on the scout's plan alone. Without an opener nothing covers the wait, so there is no storyboard.
 */
export async function ask(r: AskRequest, cfg: ModelConfig, d: Deps, emit: (e: AskEvent) => void, signal: AbortSignal, story?: ModelConfig | null): Promise<void> {
  const reqId = randomUUID();
  const ep = endpointOf(cfg.model, d);
  if (!ep.key) { emit({ t: 'error', code: 'no_key', message: noKeyMessage(ep), retryable: false }); return; }
  if (!PRICES[cfg.model]) { emit({ t: 'error', code: 'bad_request', message: `No price for ${cfg.model}.`, retryable: false }); return; }
  let sb: StoryboardEvent | undefined;
  if (story && r.context.opener) {
    sb = await storyboard(r, story, d, signal);
    if (signal.aborted) {
      try { d.log?.({ at: new Date().toISOString(), phase: d.phase, model: cfg.model, effort: cfg.effort, page: r.context.page, question: r.question.slice(0, 2000), script: '', lint: [], usd: 0, error: 'aborted', storyboard: storyRecord(sb) }); } catch { /* never fails an answer */ }
      return;
    }
    emit(sb);
  }
  const body = buildAnswerRequest({ ...r, ...(sb?.board ? { storyboard: sb.board } : {}) }, cfg);
  const est = estimateFor(ep, body, askImages(r.context));
  const ck = { model: cfg.model, version: PROMPT_VERSION, docHash: r.context.docHash, page: r.context.page };
  const cachedGuess = d.cache?.expectedCached(ck, est) ?? 0;
  const estUsd = costUsd(cfg.model, estimatedUsage(est, cachedGuess, cfg.maxOutput), '12h', cfg.fast);
  const refused = d.ledger.reserve(reqId, d.phase, worstCaseUsd(cfg.model, est, cfg.maxOutput, cfg.fast), { kind: 'answer', model: cfg.model, estUsd });
  if (refused) { emit({ t: 'error', code: 'cap', message: capHint(refused.code, refused.message, d.phase), retryable: false }); return; }
  emit({ t: 'meta', reqId, model: cfg.model, effort: cfg.effort });

  const now = d.now ?? (() => performance.now());
  const sleep = d.sleep ?? sleepDefault;
  const T = { ...TIMEOUTS, ...d.timeouts };
  const t0 = now();
  const up = new AbortController();
  const onAbort = () => up.abort();
  signal.addEventListener('abort', onAbort);
  if (signal.aborted) up.abort();
  const filter = new ScriptFilter(), lint = new Lint(), sse = new SseParser(), events = ep.anthropic ? new AnthropicEvents() : new ResponseEvents();
  let outChars = 0, rawChars = 0, ttft = NaN, usage: Usage | undefined, failed: Extract<AskEvent, { t: 'error' }> | null = null;
  let sent = false, terminal = false, complete = false, idle = false, script = '';
  const send = (s: string) => { if (!s || signal.aborted) return; outChars += s.length; script += s; if (Number.isNaN(ttft)) ttft = now() - t0; emit({ t: 'text', d: s }); };
  try {
    let res: Response | null = null;
    let live: AbortController | null = null;
    for (let attempt = 0; attempt < 2 && !res; attempt++) {
      // Each attempt has its own controller: the client's abort ends it, and so does the headers timeout.
      const att = new AbortController();
      const onUp = () => att.abort();
      up.signal.addEventListener('abort', onUp);
      if (up.signal.aborted) att.abort();
      const timer = setTimeout(() => att.abort(), T.headersMs);
      try {
        sent = true;
        const r0 = await d.fetch(ep.url, { method: 'POST', signal: att.signal, headers: ep.headers, body: JSON.stringify(body) });
        clearTimeout(timer);
        if (r0.ok) { res = r0; live = att; break; }
        up.signal.removeEventListener('abort', onUp);
        const retryable = r0.status === 429 || r0.status >= 500;
        const text = scrub((await r0.text()).slice(0, 300), ep.key);
        if (!retryable || attempt === 1) { failed = { t: 'error', code: r0.status === 429 ? 'rate_limited' : r0.status === 400 ? 'bad_request' : 'upstream', message: `${ep.vendor} ${r0.status}: ${text}`, retryable }; break; }
      } catch (e) {
        clearTimeout(timer);
        up.signal.removeEventListener('abort', onUp);
        if (signal.aborted) throw e;
        if (attempt === 1) { failed = { t: 'error', code: 'network', message: `Network error reaching ${ep.vendor}.`, retryable: true }; break; }
        // A network failure or timeout may have reached OpenAI and been billed: book it on its own
        // (the request's reservation covers the retry).
        d.ledger.settle({ id: `${reqId}:a0`, phase: d.phase, kind: 'answer', model: cfg.model, usd: estUsd, estimated: true });
      }
      await sleep(500 + Math.random() * 300);
    }
    if (!res) {
      // An HTTP error reply means nothing was generated: free the reservation. A network failure may
      // have reached OpenAI, so it is booked as an estimate below.
      if (failed && failed.code !== 'network') { d.ledger.release(reqId); emit(failed); signal.removeEventListener('abort', onAbort); return; }
    } else {
      const dec = new TextDecoder();
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      for (;;) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const r = await Promise.race([reader.read(), new Promise<'idle'>((ok) => { timer = setTimeout(() => ok('idle'), T.idleMs); })]);
        clearTimeout(timer);
        if (r === 'idle') { idle = true; live?.abort(); reader.cancel().catch(() => undefined); break; }
        if (r.done || signal.aborted) break;
        for (const ev of sse.push(dec.decode(r.value, { stream: true }))) {
          if ((ev as { type?: string })?.type === 'response.output_text.delta') rawChars += String((ev as { delta?: unknown }).delta ?? '').length;
          else if ((ev as { type?: string })?.type === 'content_block_delta') { const dl = (ev as { delta?: { text?: string; thinking?: string } }).delta; rawChars += String(dl?.text ?? dl?.thinking ?? '').length; }
          for (const u of events.handle(ev)) {
            if (u.t === 'text') send(lint.push(filter.push(u.d)));
            else if (u.t === 'note') emit({ t: 'note', message: u.message });
            else if (u.t === 'usage') { usage = u.usage; terminal = true; complete = u.complete; }
            else if (u.t === 'error') { terminal = true; failed = { t: 'error', code: 'upstream', message: scrub(u.message, ep.key), retryable: true }; }
          }
        }
      }
      if (signal.aborted) up.abort();
      send(lint.push(filter.end()) + lint.end());
      // Stalled, cut short upstream (response.incomplete), or ended without a terminal event: what
      // arrived plays, then the client hears cut_off; with no text at all it is an error.
      if (!signal.aborted && !failed && (idle || !terminal || !complete)) {
        const why = idle ? `${ep.vendor} stopped sending.` : terminal ? `${ep.vendor} ended the answer early.` : `The stream from ${ep.vendor} ended early.`;
        failed = { t: 'error', code: outChars ? 'cut_off' : idle ? 'network' : 'upstream', message: why, retryable: true };
      }
    }
  } catch (e) {
    if (!signal.aborted) failed = { t: 'error', code: outChars ? 'cut_off' : 'network', message: scrub(String(e), ep.key).slice(0, 200), retryable: true };
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
  // Book it: real usage when we have it, else an estimate: the input this (doc, page) most likely
  // read from cache at the cached rate, the rest at the 12h write rate, output as generated (the
  // plan and anything held back count too, not only what reached the client).
  const estimated = !usage;
  if (!sent) { d.ledger.release(reqId); return; }
  if (usage) d.cache?.observe(ck, usage, systemTokensLow());
  const u: Usage = usage ?? estimatedUsage(est, cachedGuess, Math.ceil(Math.max(rawChars, outChars) / 3.2));
  const usd = costUsd(cfg.model, u, '12h', cfg.fast);
  d.ledger.settle({ id: reqId, phase: d.phase, kind: 'answer', model: cfg.model, usd, estimated, tokens: tokens(u) });
  try { d.log?.({ at: new Date().toISOString(), phase: d.phase, model: cfg.model, effort: cfg.effort, page: r.context.page, question: r.question.slice(0, 2000), script, lint: lint.notes, usd, ...(failed ? { error: failed.code } : signal.aborted ? { error: 'aborted' } : {}), ...(sb ? { storyboard: storyRecord(sb) } : {}) }); } catch { /* a log failure never fails an answer */ }
  if (signal.aborted) return;
  if (failed && failed.code !== 'cut_off' && !outChars) { emit(failed); return; }
  const s = d.ledger.summary();
  emit({ t: 'done', usage, usd, estimated, spentUsd: s.totalUsd, capUsd: s.capUsd, ttftMs: Math.round(ttft), plan: filter.plan || undefined, lint: lint.notes.length ? lint.notes : undefined });
  if (failed) emit({ ...failed, code: 'cut_off', message: 'The answer was cut off.' });
}

export type PrewarmResult = { ok: boolean; usd: number; reason?: string };

const storyRecord = (e: StoryboardEvent): NonNullable<AnswerRecord['storyboard']> => ({
  model: e.model, effort: e.effort, version: e.version, ms: e.ms, usd: e.usd, ...(e.board ? { board: e.board } : {}), ...(e.fallback ? { fallback: e.fallback } : {}),
});

/** Writes the cacheable prefix (system prompt + page block) without generating output. */
export async function prewarm(context: AskContext, cfg: ModelConfig, d: Deps): Promise<PrewarmResult> {
  if (!cfg.explicitCache) return { ok: false, usd: 0, reason: 'prewarm needs explicit caching (PETU_EXPLICIT_CACHE=0)' };
  const ep = endpointOf(cfg.model, d);
  if (!ep.key) return { ok: false, usd: 0, reason: 'no key' };
  if (!PRICES[cfg.model]) return { ok: false, usd: 0, reason: `no price for ${cfg.model}` };
  const body = buildAnswerRequest({ question: '', history: [], context }, cfg, true);
  // An Anthropic prewarm generates nothing (max_tokens 0): reserve no output.
  const r = await callJson(body, cfg.model, estimateFor(ep, body, askImages(context)), ep.anthropic ? 0 : cfg.maxOutput, cfg.fast, 'prewarm', d, { ep });
  if (r.ok && r.json?.usage) d.cache?.observe({ model: cfg.model, version: PROMPT_VERSION, docHash: context.docHash, page: context.page }, r.json.usage, systemTokensLow());
  return r.ok ? { ok: true, usd: r.usd } : { ok: false, usd: r.usd, reason: r.message };
}

/**
 * Writes the system block (12h) so a new document's first answer reads it from cache. Skipped when
 * a request read or wrote it in the last 11.5h.
 */
export async function prewarmSystem(cfg: ModelConfig, d: Deps): Promise<PrewarmResult> {
  if (!cfg.explicitCache) return { ok: false, usd: 0, reason: 'prewarm needs explicit caching (PETU_EXPLICIT_CACHE=0)' };
  const ep = endpointOf(cfg.model, d);
  if (!ep.key) return { ok: false, usd: 0, reason: 'no key' };
  if (!PRICES[cfg.model]) return { ok: false, usd: 0, reason: `no price for ${cfg.model}` };
  const k = { model: cfg.model, version: PROMPT_VERSION };
  // Anthropic's system breakpoint lives 1h (refreshed by each read), not 12h.
  if (d.cache?.systemFresh(k, ep.anthropic ? 55 * 60_000 : undefined)) return { ok: true, usd: 0, reason: 'cached' };
  const oa = buildSystemPrewarm(cfg);
  const body = ep.anthropic ? toAnthropicRequest(oa as never, cfg, true) : oa;
  const r = await callJson(body, cfg.model, estimateFor(ep, body, []), ep.anthropic ? 0 : cfg.maxOutput, cfg.fast, 'prewarm', d, { ep });
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
  const images = j.content.flatMap((p) => (p.type === 'input_image' ? [imageDims(p)] : []));
  const r = await callJson(body, JUDGE_MODEL, estimateInputTokens(body, images), JUDGE_MAX_OUTPUT, false, 'judge', d);
  if (!r.ok) return { ok: false, code: r.code, message: r.message, usd: r.usd };
  const text = outputText(r.json);
  try { return { ok: true, output: JSON.parse(text), usd: r.usd }; } catch { return { ok: false, code: 'upstream', message: `judge returned non-JSON: ${text.slice(0, 120)}`, usd: r.usd }; }
}

type CallResult = { ok: true; json: any; usd: number } | { ok: false; code: string; message: string; usd: number };

/** A non-streamed call: reserve the worst case → POST (one retry on 429/5xx/network) → book usage. */
type CallOpts = { timeoutMs?: number; retry?: boolean; signal?: AbortSignal; ep?: Endpoint };
async function callJson(body: unknown, model: string, est: number, maxOutput: number, fast: boolean, kind: 'prewarm' | 'judge' | 'scout', d: Deps, o: CallOpts = {}): Promise<CallResult> {
  const id = randomUUID();
  const refused = d.ledger.reserve(id, d.phase, worstCaseUsd(model, est, maxOutput, fast), { kind, model });
  if (refused) return { ok: false, code: 'cap', message: capHint(refused.code, refused.message, d.phase), usd: 0 };
  const sleep = d.sleep ?? sleepDefault;
  const T = { ...TIMEOUTS, ...d.timeouts };
  const ep = o.ep ?? endpointOf(JUDGE_MODEL, d);
  let last: CallResult = { ok: false, code: 'network', message: `Network error reaching ${ep.vendor}.`, usd: 0 };
  let reached = false;
  const attempts = o.retry === false ? 1 : 2;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const timeout = AbortSignal.timeout(o.timeoutMs ?? T.callMs);
      const signal = o.signal ? AbortSignal.any([timeout, o.signal]) : timeout;
      const res = await d.fetch(ep.url, { method: 'POST', signal, headers: ep.headers, body: JSON.stringify(body) });
      const text = await res.text();
      if (res.ok) {
        const json = JSON.parse(text);
        if (ep.anthropic && json.usage) json.usage = normalizeUsage(json.usage as AnthropicUsage);
        const u = json.usage as Usage | undefined;
        const estimated = !u;
        const usage: Usage = u ?? { input_tokens: est, output_tokens: maxOutput, input_tokens_details: { cache_write_tokens: est } };
        const usd = costUsd(model, usage, '12h', fast);
        d.ledger.settle({ id, phase: d.phase, kind, model, usd, estimated, tokens: tokens(usage) });
        return { ok: true, json, usd };
      }
      last = { ok: false, code: res.status === 429 ? 'rate_limited' : res.status === 400 ? 'bad_request' : 'upstream', message: `${ep.vendor} ${res.status}: ${scrub(text.slice(0, 300), ep.key)}`, usd: 0 };
      if (!(res.status === 429 || res.status >= 500)) break;
    } catch (e) {
      // A network error or timeout after sending may still bill: the last try is booked below at its
      // worst case; a first try that a retry follows is booked now, on its own.
      last = { ok: false, code: 'network', message: scrub(String(e), ep.key).slice(0, 200), usd: 0 };
      if (attempt < attempts - 1) d.ledger.settle({ id: `${id}:a0`, phase: d.phase, kind, model, usd: worstCaseUsd(model, est, maxOutput, fast), estimated: true });
      else reached = true;
    }
    if (attempt < attempts - 1) await sleep(500 + Math.random() * 300);
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
  if (code === 'total') return `${message} PETU_TOTAL_CAP_USD=<dollars> npm run dev sets it for a run, up to the $${HARD_STOP_USD} hard stop.`;
  if (code === 'daily') return `${message} It resets tomorrow, or raise it for this run: PETU_DAILY_CAP_USD=6 npm run dev.`;
  return `${message} Raise it for this run on the command line: PETU_CAP_${phase.toUpperCase()}=<dollars> npm run dev.`;
}
