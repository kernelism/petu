// src/agent/client.ts — the browser side of POST /api/ask (NDJSON AskEvents) and GET /api/spend.
import { formatUsd, HARD_STOP_USD, type AskErrorCode, type AskEvent, type AskRequest, type SpendSummary } from './protocol';

export class AskError extends Error {
  constructor(readonly code: AskErrorCode, message: string, readonly retryable: boolean) { super(message); }
}

export type AskHandlers = {
  onMeta?(e: Extract<AskEvent, { t: 'meta' }>): void;
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
