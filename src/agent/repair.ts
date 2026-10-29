// src/agent/repair.ts — the live gate's RepairFn implementations (design 2026-10-29 §6, §8).
//   makeRepair      POST /api/repair (NDJSON, like askStream): the real one, bound to an answer's reqId.
//   fakeRepair      no network: a replacement after `delayMs` (dev scripts, gallery, tests; `&repair=fake`).
//   recordedRepair  replays the repairs a recorded answer got (eval replays; `&repair=recorded`), $0.
// Every one honours the abort signal and resolves (never rejects) with a RepairResult.
import type { FaultMode, Faults, RepairEvent, RepairFn, RepairRequest, RepairResult } from '../gate/events';
import type { RepairWire, RepairWireEvent } from './protocol';

const REFUSED_CODES = new Set(['not_found', 'too_many', 'bad_request', 'cap', 'off', 'no_key']);

/** Waits `ms`, or until `signal` aborts (then resolves false). */
function wait(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((ok) => {
    const t = setTimeout(() => { signal.removeEventListener('abort', stop); ok(true); }, Math.max(0, ms));
    const stop = () => { clearTimeout(t); ok(false); };
    signal.addEventListener('abort', stop, { once: true });
  });
}
const aborted = (): RepairResult => ({ ok: false, reason: 'error', detail: 'aborted' });

/**
 * The real repair: POST /api/repair {…req, reqId, phase} → NDJSON text… done{usd} | error. HTTP 4xx and
 * the server's refusal codes resolve `refused`; network, upstream, `late` and 5xx resolve `error`. The
 * client gives up at `req.deadlineMs` (plus `graceMs`) even if the server has not.
 */
export function makeRepair(o: { reqId: string; phase?: string; fetch?: typeof fetch; graceMs?: number }): RepairFn {
  const f = o.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  return async (req, signal) => {
    if (signal.aborted) return aborted();
    const ctl = new AbortController();
    const onAbort = () => ctl.abort();
    signal.addEventListener('abort', onAbort);
    let late = false;
    const timer = setTimeout(() => { late = true; ctl.abort(); }, req.deadlineMs + (o.graceMs ?? 0));
    const wire: RepairWire = { ...req, reqId: o.reqId, ...(o.phase ? { phase: o.phase } : {}) };
    try {
      let res: Response;
      try {
        res = await f('/api/repair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(wire), signal: ctl.signal });
      } catch { return signal.aborted ? aborted() : { ok: false, reason: 'error', detail: late ? 'late' : 'network' }; }
      if (!res.ok || !res.body) {
        let code = '';
        try { code = String((await res.json())?.code ?? ''); } catch { /* not JSON */ }
        const refused = (res.status >= 400 && res.status < 500) || REFUSED_CODES.has(code);
        return { ok: false, reason: refused ? 'refused' : 'error', detail: `${res.status}${code ? ` ${code}` : ''}` };
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '', text = '';
      let end: RepairResult | null = null;
      const line = (raw: string) => {
        const s = raw.trim();
        if (!s || end) return;
        let e: RepairWireEvent;
        try { e = JSON.parse(s) as RepairWireEvent; } catch { return; }
        if (e.t === 'text') text += e.d;
        else if (e.t === 'done') end = { ok: true, text, usd: e.usd };
        else if (e.t === 'error') end = { ok: false, reason: REFUSED_CODES.has(e.code) ? 'refused' : 'error', detail: e.code, ...(e.usd != null ? { usd: e.usd } : {}) };
      };
      try {
        for (;;) {
          const c = await reader.read();
          if (c.done) break;
          buf += dec.decode(c.value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf('\n')) >= 0) { line(buf.slice(0, nl)); buf = buf.slice(nl + 1); }
          if (end) break;
        }
        line(buf + dec.decode());
      } catch {
        return signal.aborted ? aborted() : { ok: false, reason: 'error', detail: late ? 'late' : 'network' };
      } finally {
        reader.cancel().catch(() => undefined);
      }
      if (signal.aborted) return aborted();
      return end ?? { ok: false, reason: 'error', detail: late ? 'late' : 'stream ended without done' };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
  };
}

/** A plain version of a beat: its tags removed (the note's last resort: say the point with no tags). */
export const plainBeat = (beat: string): string => beat.replace(/\{\{[^}]*\}\}/g, ' ').replace(/\s+([,.;:!?])/g, '$1').replace(/\s{2,}/g, ' ').trim();

/**
 * No network. After `delayMs` (abortable) the replacement is `text` (per unit index, or a function of
 * the request) or else the beat with its tags removed. `faults` (`&gatefail=`, keyed by the unit key
 * '0', '1'…): `late` sleeps until the deadline + 500 ms (the gate drops the unit), `bad` returns the
 * original beat (the re-check fails), `ok` the fix. `usd` 0.
 */
export function fakeRepair(o: { delayMs?: number; faults?: Faults; text?: Record<number, string> | ((req: RepairRequest) => string) } = {}): RepairFn {
  return async (req, signal) => {
    const mode: FaultMode | undefined = o.faults?.get(String(req.k));
    if (mode === 'late') { await wait(req.deadlineMs + 500, signal); return signal.aborted ? aborted() : { ok: false, reason: 'error', detail: 'late' }; }
    if (!(await wait(o.delayMs ?? 0, signal))) return aborted();
    if (mode === 'bad') return { ok: true, text: req.beat, usd: 0 };
    const t = typeof o.text === 'function' ? o.text(req) : o.text?.[req.k];
    return { ok: true, text: t ?? plainBeat(req.beat), usd: 0 };
  };
}

/**
 * Replays recorded repairs: for unit k, the recorded `ok` text after its recorded latency (`sent` → `ok`
 * ms difference, or the `ok` event's ms); a recorded refusal or error resolves the same way; a unit
 * with no recorded repair resolves `refused` (the recording never asked). `sleep` is injectable for tests.
 */
export function recordedRepair(events: readonly unknown[], o: { scale?: number } = {}): RepairFn {
  const rs = events.filter((e): e is RepairEvent => !!e && typeof e === 'object' && (e as { t?: string }).t === 'repair');
  return async (req, signal) => {
    const mine = rs.filter((e) => e.k === String(req.k));
    const sent = mine.find((e) => e.phase === 'sent');
    const end = mine.find((e) => e.phase !== 'sent');
    if (!end) return { ok: false, reason: 'refused', detail: 'not recorded' };
    const ms = Math.max(0, end.ms - (sent && sent.ms <= end.ms ? sent.ms : 0)) * (o.scale ?? 1);
    if (end.phase === 'late') { await wait(req.deadlineMs + 500, signal); return signal.aborted ? aborted() : { ok: false, reason: 'error', detail: 'late' }; }
    if (!(await wait(ms, signal))) return aborted();
    if ((end.phase === 'ok' || end.phase === 'fail') && end.text != null) return { ok: true, text: end.text, ...(end.usd != null ? { usd: end.usd } : {}) };
    return { ok: false, reason: end.phase === 'refused' ? 'refused' : 'error', detail: `recorded ${end.phase}` };
  };
}
