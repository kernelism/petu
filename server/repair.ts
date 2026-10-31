// server/repair.ts — POST /api/repair: one replacement beat for the live gate (design 2026-10-29 §6).
//
// Stage 2's request is kept per answer (`RepairCache`, filled by `ask` through `Deps.onBody`) in the
// OpenAI format. A repair resends it unchanged (same prompt_cache_key, same breakpoints, so the prefix
// reads from cache), then the stage-2 text released so far as the assistant's turn, then the repair
// note (server/prompt/repair.ts) as the user's — and asks for at most REPAIR_MAX_OUTPUT tokens. A Claude
// answer model gets the same body converted (toAnthropicRequest): roles user → assistant → user,
// cache_control on the same blocks, empty text blocks dropped.
//
// Spend: reserved at its worst case as kind `repair`, settled on usage; an abort or the deadline books
// an estimate. MAX_REPAIRS per answer. Output goes through the same ScriptFilter + Lint as stage 2.
// Secrets: the key is only in the upstream headers; every error text is scrubbed of it.
import { randomUUID } from 'node:crypto';
import { costUsd, worstCaseUsd, PRICES, type Usage } from './prices';
import { estimatedUsage } from './cacheStats';
import { ScriptFilter } from './scriptFilter';
import { SvgBeatFilter } from './svgBeats';
import { isSvgMode } from './prompt/system';
import { rawSvgScript } from '../src/svgboard/wire';
import { Lint } from './lint';
import { capHint, endpointOf, estimateFor, newRead, readUpstream, scrub, systemTokensLow, tokens, TIMEOUTS, type AnswerBody, type CacheKey, type Deps, type ModelConfig } from './openai';
import { ANTHROPIC_NO_NONE, toAnthropicRequest } from './anthropic';
import { PROMPT_VERSION } from './prompt/system';
import { repairNote, svgRepairNote, REPAIR_VERSION } from './prompt/repair';
import { MAX_REPAIRS, REPAIR_MAX_OUTPUT, SVG_REPAIR_MAX_OUTPUT } from './limits';
import type { RepairWire, RepairWireEvent } from '../src/agent/protocol';
import type { RepairReport } from '../src/gate/events';

/** How long an answer's request stays repairable, and how many answers are kept. */
export const REPAIR_TTL_MS = 10 * 60_000;
export const REPAIR_CACHE_MAX = 16;

export type RepairEntry = { oa: AnswerBody; cfg: ModelConfig; ck: CacheKey; images: { w: number; h: number }[]; repairs: number; at: number };

/** reqId → stage 2's request, ≤ REPAIR_CACHE_MAX answers, each for REPAIR_TTL_MS. */
export class RepairCache {
  private m = new Map<string, RepairEntry>();
  constructor(private now: () => number = Date.now, private ttlMs = REPAIR_TTL_MS, private max = REPAIR_CACHE_MAX) {}
  put(reqId: string, oa: AnswerBody, cfg: ModelConfig, ck: CacheKey, images: { w: number; h: number }[] = []): void {
    this.prune();
    this.m.delete(reqId);
    this.m.set(reqId, { oa, cfg, ck, images, repairs: 0, at: this.now() });
    while (this.m.size > this.max) this.m.delete(this.m.keys().next().value!);
  }
  get(reqId: string): RepairEntry | undefined {
    this.prune();
    return this.m.get(reqId);
  }
  get size(): number { this.prune(); return this.m.size; }
  private prune() { const t = this.now(); for (const [k, e] of this.m) if (t - e.at >= this.ttlMs) this.m.delete(k); }
}

/**
 * The repair's OpenAI-format body: stage 2's request unchanged, then the released text (assistant, when
 * non-empty), then the repair note (user); small output budget, the repair's effort, streamed.
 */
export function buildRepairRequest(oa: AnswerBody, w: Pick<RepairWire, 'committed' | 'report'>, cfg: Pick<ModelConfig, 'effort'>, svg = false): AnswerBody {
  const input: unknown[] = [...oa.input];
  // The svg mode: the model sees its own format (raw <g> groups), never the wire tags.
  const committed = svg ? rawSvgScript(w.committed) : w.committed;
  if (committed.trim()) input.push({ role: 'assistant', content: [{ type: 'output_text', text: committed }] });
  input.push({ role: 'user', content: [{ type: 'input_text', text: svg ? svgRepairNote(w.report) : repairNote(w.report) }] });
  return { ...oa, input, max_output_tokens: svg ? SVG_REPAIR_MAX_OUTPUT : REPAIR_MAX_OUTPUT, reasoning: { effort: cfg.effort }, stream: true, metadata: { prompt: PROMPT_VERSION, repair: REPAIR_VERSION } } as unknown as AnswerBody;
}

/** The body for the answer model's provider (Anthropic: converted block for block). */
export function repairBody(oa: AnswerBody, w: Pick<RepairWire, 'committed' | 'report'>, cfg: ModelConfig, svg = false): any {
  const body = buildRepairRequest(oa, w, cfg, svg);
  return cfg.model.startsWith('claude-') ? toAnthropicRequest(body as never, { model: cfg.model, effort: cfg.effort, maxOutput: svg ? SVG_REPAIR_MAX_OUTPUT : REPAIR_MAX_OUTPUT }) : body;
}

/** A repair line in .petu/answers.jsonl. */
export type RepairRecord = { kind: 'repair'; at: string; reqId: string; k: number; report: RepairReport; text: string; usd: number; ms: number; version: string; model: string; effort: string; error?: string };
export type RepairDeps = Omit<Deps, 'log'> & { repairs: RepairCache; log?: (rec: RepairRecord) => void };
/** A refusal before anything streams: the route answers with this status and body. */
export type RepairRefusal = { status: number; error: Extract<RepairWireEvent, { t: 'error' }> };

const refuse = (status: number, code: Extract<RepairWireEvent, { t: 'error' }>['code'], message: string): RepairRefusal => ({ status, error: { t: 'error', code, message } });

/**
 * One repair. Refusals come back before anything is sent (404 unknown or expired reqId, 429 past
 * MAX_REPAIRS, 503 repairs off, 402 the ledger refuses); otherwise the replacement streams as `text`
 * events, then `done` (cost) or `error`. `cfg` is the repair config (env.repair: the answer model at the
 * repair effort); the cached answer's model is used if it differs (a request is repaired by its author).
 */
export async function repair(w: RepairWire, cfg: ModelConfig | null, d: RepairDeps, emit: (e: RepairWireEvent) => void, signal: AbortSignal): Promise<RepairRefusal | null> {
  if (!cfg) return refuse(503, 'off', 'Repairs are off (PETU_REPAIR=off).');
  const entry = d.repairs.get(w.reqId);
  if (!entry) return refuse(404, 'not_found', 'Unknown or expired answer (reqId).');
  if (entry.repairs >= MAX_REPAIRS) return refuse(429, 'too_many', `At most ${MAX_REPAIRS} repairs per answer.`);
  const svg = isSvgMode(entry.cfg.promptVariant);
  // A model that cannot turn thinking off (Opus, Answer quality "Best") repairs at low, its floor.
  const effort = cfg.effort === 'none' && ANTHROPIC_NO_NONE.has(entry.cfg.model) ? 'low' : cfg.effort;
  const rc: ModelConfig = { ...cfg, model: entry.cfg.model, effort, fast: entry.cfg.fast, maxOutput: svg ? SVG_REPAIR_MAX_OUTPUT : REPAIR_MAX_OUTPUT };
  const ep = endpointOf(rc.model, d);
  if (!ep.key) return refuse(503, 'no_key', 'No key for the answer model.');
  if (!PRICES[rc.model]) return refuse(400, 'bad_request', `No price for ${rc.model}.`);
  const body = repairBody(entry.oa, w, rc, svg);
  const est = estimateFor(ep, body, entry.images);
  const cachedGuess = d.cache?.expectedCached(entry.ck, est) ?? 0;
  const id = randomUUID();
  const refused = d.ledger.reserve(id, d.phase, worstCaseUsd(rc.model, est, rc.maxOutput, rc.fast), { kind: 'repair', model: rc.model, estUsd: costUsd(rc.model, estimatedUsage(est, cachedGuess, rc.maxOutput), '12h', rc.fast) });
  if (refused) return refuse(402, 'cap', capHint(refused.code, refused.message, d.phase));
  entry.repairs++;

  const now = d.now ?? (() => performance.now());
  const t0 = now();
  const T = { ...TIMEOUTS, ...d.timeouts };
  const up = new AbortController();
  const onAbort = () => up.abort();
  signal.addEventListener('abort', onAbort);
  if (signal.aborted) up.abort();
  let late = false;
  const deadline = setTimeout(() => { late = true; up.abort(); }, Math.max(0, Math.min(w.deadlineMs, T.callMs)));
  // A repaired beat draws into the answer's open board: its groups go out with no BOARD tag of their own.
  const filter = svg ? new SvgBeatFilter(undefined, { opened: true }) : new ScriptFilter(), lint = new Lint(), read = newRead();
  let text = '', failed: Extract<RepairWireEvent, { t: 'error' }> | null = null, sent = false;
  const send = (s: string) => { if (!s) return; text += s; if (!signal.aborted && !late) emit({ t: 'text', d: s }); };
  try {
    sent = true;
    const res = await d.fetch(ep.url, { method: 'POST', signal: up.signal, headers: ep.headers, body: JSON.stringify(body) });
    if (!res.ok || !res.body) {
      const msg = scrub((await res.text().catch(() => '')).slice(0, 200), ep.key);
      sent = false;
      failed = { t: 'error', code: 'upstream', message: `${ep.vendor} ${res.status}: ${msg}` };
    } else {
      await readUpstream(res, ep, { signal: up.signal, idleMs: T.idleMs, filter, lint, send, stop: () => up.abort() }, read);
      send(lint.push(filter.end()) + lint.end());
      if (read.failed) failed = { t: 'error', code: 'upstream', message: read.failed };
      else if (late) failed = { t: 'error', code: 'late', message: 'Past the repair deadline.' };
      else if (!signal.aborted && (read.idle || !read.terminal || !read.complete)) failed = { t: 'error', code: 'upstream', message: `${ep.vendor} ended the repair early.` };
    }
  } catch (e) {
    failed = late ? { t: 'error', code: 'late', message: 'Past the repair deadline.' } : { t: 'error', code: 'network', message: scrub(String(e), ep.key).slice(0, 200) };
  } finally {
    clearTimeout(deadline);
    signal.removeEventListener('abort', onAbort);
  }
  const ms = Math.round(now() - t0);
  let usd = 0;
  if (!sent) d.ledger.release(id);
  else {
    if (read.usage) d.cache?.observe(entry.ck, read.usage, systemTokensLow());
    const u: Usage = read.usage ?? estimatedUsage(est, cachedGuess, Math.ceil(Math.max(read.rawChars, text.length) / 3.2) || REPAIR_MAX_OUTPUT);
    usd = costUsd(rc.model, u, '12h', rc.fast);
    d.ledger.settle({ id, phase: d.phase, kind: 'repair', model: rc.model, usd, estimated: !read.usage, tokens: tokens(u) });
  }
  try { d.log?.({ kind: 'repair', at: new Date().toISOString(), reqId: w.reqId, k: w.k, report: w.report, text, usd, ms, version: REPAIR_VERSION, model: rc.model, effort: rc.effort, ...(failed ? { error: failed.code } : signal.aborted ? { error: 'aborted' } : {}) }); } catch { /* never fails a repair */ }
  if (signal.aborted) return null;
  emit(failed ? { ...failed, usd } : { t: 'done', usd, estimated: !read.usage, ms, ...(lint.notes.length ? { lint: lint.notes } : {}) });
  return null;
}
