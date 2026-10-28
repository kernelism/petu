// src/agent/client.ts — the browser side of POST /api/ask (NDJSON AskEvents) and GET /api/spend.
import { formatUsd, HARD_STOP_USD, type AskErrorCode, type AskEvent, type AskRequest, type SpendSummary } from './protocol';
import { fallbackScout, parseScout, type ScoutEvent, type ScoutRequest, type ScoutResult } from './scout';

export class AskError extends Error {
  constructor(readonly code: AskErrorCode, message: string, readonly retryable: boolean) { super(message); }
}

export type AskHandlers = {
  onMeta?(e: Extract<AskEvent, { t: 'meta' }>): void;
  /** Stage 1 finished: the scout's pages, plan and latency. */
  onScout?(e: Extract<AskEvent, { t: 'scout' }>): void;
  /** The lesson design arrived (or fell back to the scout's plan), before stage 2's first text. */
  onStoryboard?(e: Extract<AskEvent, { t: 'storyboard' }>): void;
  /** Stage 2's first text is about to play (after the opener, if there was one). */
  onHandoff?(e: Extract<AskEvent, { t: 'handoff' }>): void;
  onNote?(message: string): void;
  onDone?(e: Extract<AskEvent, { t: 'done' }>): void;
  /** The stream ended early after narration started: play what arrived, then say so. */
  onCutOff?(message: string): void;
  /** Every event as it arrives (eval recording). */
  onEvent?(e: AskEvent): void;
};

/**
 * POST /api/ask → narration chunks for AnswerSession.
 * - An error before any text throws AskError (the session's error state).
 * - An error after text, a `cut_off`, or a stream that drops after text without `done`, ends
 *   normally and calls `onCutOff`: what arrived plays out.
 * - Aborting `signal` stops reading and returns quietly.
 */
export async function* askStream(req: AskRequest, signal: AbortSignal, h: AskHandlers = {}, f: typeof fetch = fetch): AsyncGenerator<string> {
  let res: Response;
  try {
    res = await f('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req), signal });
  } catch {
    if (signal.aborted) return;
    throw new AskError('network', "Couldn't reach the tutor.", true);
  }
  if (!res.ok || !res.body) {
    // 404: no dev-server plugin answering /api/ask (a static build, or an old server).
    const code: AskErrorCode = res.status === 400 ? 'bad_request' : res.status === 404 ? 'network' : 'upstream';
    throw new AskError(code, `Tutor server error (${res.status}).`, res.status !== 400);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', spoke = false, done = false;
  /** Handles one line; true ends the stream. */
  const line = function* (raw: string): Generator<string, boolean> {
    const s = raw.trim();
    if (!s) return false;
    let e: AskEvent;
    try { e = JSON.parse(s) as AskEvent; } catch { console.warn('[ask] skipped a malformed line'); return false; }
    h.onEvent?.(e);
    if (e.t === 'text') { spoke = true; yield e.d; }
    else if (e.t === 'meta') h.onMeta?.(e);
    else if (e.t === 'storyboard') h.onStoryboard?.(e);
    else if (e.t === 'note') h.onNote?.(e.message);
    else if (e.t === 'done') { done = true; h.onDone?.(e); }
    else if (e.t === 'error') {
      if (spoke || e.code === 'cut_off') { h.onCutOff?.(e.message); return true; }
      throw new AskError(e.code, e.message, e.retryable);
    }
    return false;
  };
  try {
    for (;;) {
      if (signal.aborted) return;
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try { chunk = await reader.read(); } catch {
        if (signal.aborted) return;
        if (spoke) { h.onCutOff?.('The answer was cut off.'); return; }
        throw new AskError('network', "Couldn't reach the tutor.", true);
      }
      if (signal.aborted) return;
      if (chunk.done) break;
      buf += dec.decode(chunk.value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const l = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (yield* line(l)) return;
        if (signal.aborted) return;
      }
    }
    buf += dec.decode();
    if (yield* line(buf)) return;
    if (!done) {
      if (spoke) h.onCutOff?.('The answer was cut off.');
      else throw new AskError('upstream', "Couldn't reach the tutor.", true);
    }
  } finally {
    if (signal.aborted) void reader.cancel().catch(() => {});
    else reader.releaseLock();
  }
}

/** A live stage 1: opener sentences as they arrive, then the verdict, then the cost. */
export type ScoutLive = {
  /** The opener's sentences (script text, tags included), in order; ends when the verdict is in. */
  opener: AsyncIterable<string>;
  /** The pages and plan (with the whole opener), or a visible-page fallback. Null only on abort. */
  verdict: Promise<ScoutResult | null>;
  /** The scout's cost and cache use, once its stream ends (0 when unknown). */
  cost: Promise<{ usd: number; cached?: number; input?: number }>;
};

/**
 * POST /api/scout → NDJSON ScoutEvents. Never throws: any failure (network, server, cap, bad lines, a
 * stream that ends without a verdict) resolves the verdict with the visible page alone, so the answer
 * still goes ahead; opener sentences that already arrived stay. An abort ends the opener and resolves
 * the verdict with null. `ms` fields are from the call.
 */
export function scoutLive(req: ScoutRequest, signal: AbortSignal, f: typeof fetch = fetch, now: () => number = () => performance.now()): ScoutLive {
  const t0 = now();
  const q = new Queue<string>();
  let said = '', openerMs: number | undefined;
  let settle!: (v: ScoutResult | null) => void;
  let pay!: (c: { usd: number; cached?: number; input?: number }) => void;
  const verdict = new Promise<ScoutResult | null>((ok) => { settle = ok; });
  const cost = new Promise<{ usd: number; cached?: number; input?: number }>((ok) => { pay = ok; });
  let decided = false;
  const decide = (v: ScoutResult | null) => {
    if (decided) return;
    decided = true;
    q.close();
    settle(v && { ...v, ...(said ? { opener: said } : {}), ...(openerMs != null ? { openerMs } : {}) });
  };
  const fallback = (why: string) => decide(signal.aborted ? null : fallbackScout(req.page, why, Math.round(now() - t0)));
  void (async () => {
    let usd = 0, cached: number | undefined, input: number | undefined;
    try {
      const r = await f('/api/scout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req), signal });
      if (!r.ok || !r.body) { fallback(`scout server error (${r.status})`); return; }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      const line = (raw: string) => {
        const s = raw.trim();
        if (!s) return;
        let e: ScoutEvent;
        try { e = JSON.parse(s) as ScoutEvent; } catch { return; }
        if (e.t === 'opener' && !decided && typeof e.d === 'string' && e.d) {
          if (openerMs == null) openerMs = Math.round(now() - t0);
          said += e.d;
          q.push(e.d);
        } else if (e.t === 'scout') {
          // The server parses already; parse again so a bad reply can never pass a bad page on.
          const p = parseScout(JSON.stringify({ pages: e.pages, plan: e.plan }), req.numPages, req.page);
          const fb = e.fallback ?? p.fallback;
          decide({ pages: p.pages, plan: p.plan, ms: Math.round(now() - t0), usd: 0, ...(fb ? { fallback: fb } : {}) });
        } else if (e.t === 'end') { usd = typeof e.usd === 'number' ? e.usd : 0; cached = e.cached; input = e.input; }
      };
      for (;;) {
        const x = await reader.read();
        if (x.done) break;
        buf += dec.decode(x.value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) { line(buf.slice(0, nl)); buf = buf.slice(nl + 1); }
      }
      line(buf + dec.decode());
      fallback('scout ended without a verdict');
    } catch {
      fallback("couldn't reach the scout");
    } finally {
      q.close();
      pay({ usd, ...(cached != null ? { cached } : {}), ...(input != null ? { input } : {}) });
    }
  })();
  return { opener: q, verdict, cost };
}

/** Stage 1 as one result (tests, eval tools): the streamed scout, its opener collected. */
export async function scoutPages(req: ScoutRequest, signal: AbortSignal, f: typeof fetch = fetch, now: () => number = () => performance.now()): Promise<ScoutResult | null> {
  const live = scoutLive(req, signal, f, now);
  for await (const _ of live.opener) { /* collected in the verdict */ }
  const v = await live.verdict;
  if (!v) return null;
  return { ...v, usd: (await live.cost).usd };
}

/** A minimal async queue: push/close on one side, `for await` on the other. */
export class Queue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiting: ((r: IteratorResult<T>) => void) | null = null;
  private closed = false;
  push(x: T): void {
    if (this.closed) return;
    if (this.waiting) { const w = this.waiting; this.waiting = null; w({ value: x, done: false }); }
    else this.items.push(x);
  }
  close(): void {
    this.closed = true;
    if (this.waiting) { const w = this.waiting; this.waiting = null; w({ value: undefined as never, done: true }); }
  }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.items.length) return Promise.resolve({ value: this.items.shift()!, done: false });
        if (this.closed) return Promise.resolve({ value: undefined as never, done: true });
        return new Promise((ok) => { this.waiting = ok; });
      },
    };
  }
}

/** The server's spend phase (GET /api/spend reports it); asks carry it so eval spend is tagged right. */
export const spendPhase = (s: SpendSummary | null): string | undefined => s?.phase;

export async function getSpend(f: typeof fetch = fetch): Promise<SpendSummary | null> {
  try {
    const r = await f('/api/spend');
    if (!r.ok) return null;
    const s = (await r.json()) as SpendSummary;
    return typeof s?.totalUsd === 'number' && typeof s.capUsd === 'number' ? s : null;
  } catch { return null; }
}

// ------------------------------------------------------------------------------------------------
// Copy: one calm line per state.

const usd = formatUsd;
const dailyHit = (s: SpendSummary) => s.dailyCapUsd != null && s.todayUsd >= s.dailyCapUsd && s.totalUsd < s.capUsd;

/** No more answers can be bought: the server says so, or a cap is used up. */
export function spendBlocked(s: SpendSummary | null): boolean {
  if (!s) return false;
  return !!s.blocked || s.totalUsd >= s.capUsd || (s.dailyCapUsd != null && s.todayUsd >= s.dailyCapUsd);
}

/** A suggested new cap for the knob line: double, at least $1, never past the hard stop. */
const raiseTo = (cap: number) => Math.min(HARD_STOP_USD, Math.max(1, Math.ceil(cap * 2)));
/** How to lift a cap: caps are set per run on the command line, never by editing .env. */
export function knobLine(code: 'total' | 'daily' | 'phase', s: SpendSummary): string {
  if (code === 'daily') return `Raise it for this run: PETU_DAILY_CAP_USD=${raiseTo(s.dailyCapUsd ?? 3)} npm run dev.`;
  if (code === 'phase') {
    const phase = (s.phase ?? 'founder').toUpperCase();
    return `Raise it for this run: PETU_CAP_${phase}=${raiseTo(s.phaseCapUsd ?? 1)} npm run dev.`;
  }
  return s.capUsd < HARD_STOP_USD
    ? `Raise it for this run: PETU_TOTAL_CAP_USD=${HARD_STOP_USD} npm run dev.`
    : `This is the checkpoint's ${usd(HARD_STOP_USD)} hard stop.`;
}

/** Which cap the server's refusal line names (older servers send only the line). */
function blockedCode(s: SpendSummary): 'total' | 'daily' | 'phase' {
  if (s.blockedCode) return s.blockedCode;
  const b = s.blocked ?? '';
  return /today/i.test(b) ? 'daily' : /phase/i.test(b) ? 'phase' : 'total';
}

/** The cap line, in the caption and in place of the ask bar's placeholder. */
export function capLine(s: SpendSummary | null): string {
  if (!s) return 'Spending cap reached. Raise it for this run on the command line, e.g. PETU_DAILY_CAP_USD=6 npm run dev.';
  if (dailyHit(s)) return `Today's spending cap reached: ${usd(s.todayUsd)} of ${usd(s.dailyCapUsd!)} used. ${knobLine('daily', s)}`;
  // Neither the total nor today's cap is used up, but the server refuses (a phase budget, or the
  // next answer's worst case would cross a cap): its own line names which.
  if (s.totalUsd < s.capUsd && typeof s.blocked === 'string' && s.blocked) return `${s.blocked.trim()} ${knobLine(blockedCode(s), s)}`;
  return `Spending cap reached: ${usd(s.totalUsd)} of ${usd(s.capUsd)} used. ${knobLine('total', s)}`;
}

/** What the caption says for a failed answer, and whether Retry is offered. */
export function askErrorLine(code: AskErrorCode, spend: SpendSummary | null): { message: string; retry: boolean } {
  switch (code) {
    case 'no_key': return { message: 'Add your OpenAI key to .env, then restart the dev server.', retry: false };
    case 'cap': return { message: capLine(spend), retry: false };
    case 'rate_limited': return { message: 'The tutor is busy. Try again in a moment.', retry: true };
    case 'cut_off': return { message: 'The answer was cut off.', retry: true };
    case 'bad_request': return { message: "That question couldn't be sent.", retry: false };
    default: return { message: "Couldn't reach the tutor.", retry: true };
  }
}
