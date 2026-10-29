import { describe, it, expect, vi, afterEach } from 'vitest';
import { fakeRepair, makeRepair, plainBeat, recordedRepair } from '../../src/agent/repair';
import type { RepairReport, RepairRequest } from '../../src/gate/events';

const report: RepairReport = { beat: 'b', problems: [], board: [], consts: {}, finds: [], later: [], tail: 't', maxWords: 20 };
const req = (over: Partial<RepairRequest> = {}): RepairRequest => ({ k: 2, committed: 'So far.', beat: 'Notice {{circle on=s at=Z}} point Z here .', report, deadlineMs: 2000, ...over });

/** A fake /api/repair answering with `lines` (NDJSON), or a status, or a stream that never ends. */
function server(o: { lines?: object[]; status?: number; json?: object; hang?: boolean }) {
  const calls: { url: string; body: any }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    if (o.status) return new Response(JSON.stringify(o.json ?? {}), { status: o.status });
    const enc = new TextEncoder();
    const ls = (o.lines ?? []).map((l) => `${JSON.stringify(l)}\n`);
    let i = 0;
    return new Response(new ReadableStream<Uint8Array>({
      pull(c) {
        if (i < ls.length) { c.enqueue(enc.encode(ls[i++])); return; }
        if (!o.hang) { c.close(); return; }
        return new Promise<void>((ok) => init.signal!.addEventListener('abort', () => { c.error(new DOMException('aborted', 'AbortError')); ok(); }));
      },
    }, { highWaterMark: 0 }), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

afterEach(() => { vi.useRealTimers(); });

describe('makeRepair', () => {
  it('posts the request with reqId and phase; NDJSON text pieces + done → ok with the text and cost', async () => {
    const { f, calls } = server({ lines: [{ t: 'text', d: 'Point ' }, { t: 'text', d: 'Z {{point on=s id=Z}}.' }, { t: 'done', usd: 0.006, ms: 900 }] });
    const r = await makeRepair({ reqId: 'abc', phase: 'dev', fetch: f })(req(), new AbortController().signal);
    expect(r).toEqual({ ok: true, text: 'Point Z {{point on=s id=Z}}.', usd: 0.006 });
    expect(calls[0].url).toBe('/api/repair');
    expect(calls[0].body).toMatchObject({ reqId: 'abc', phase: 'dev', k: 2, committed: 'So far.', deadlineMs: 2000, report });
  });
  it('refusals (404/429/402 and refusal codes) → refused; a server error or upstream error → error', async () => {
    for (const [status, code] of [[404, 'not_found'], [429, 'too_many'], [402, 'cap'], [400, 'bad_request']] as const) {
      const r = await makeRepair({ reqId: 'x', fetch: server({ status, json: { t: 'error', code } }).f })(req(), new AbortController().signal);
      expect(r).toMatchObject({ ok: false, reason: 'refused' });
    }
    expect(await makeRepair({ reqId: 'x', fetch: server({ status: 500 }).f })(req(), new AbortController().signal)).toMatchObject({ ok: false, reason: 'error' });
    expect(await makeRepair({ reqId: 'x', fetch: server({ lines: [{ t: 'text', d: 'half' }, { t: 'error', code: 'upstream', message: 'x', usd: 0.001 }] }).f })(req(), new AbortController().signal))
      .toEqual({ ok: false, reason: 'error', detail: 'upstream', usd: 0.001 });
    expect(await makeRepair({ reqId: 'x', fetch: server({ lines: [{ t: 'text', d: 'no done' }] }).f })(req(), new AbortController().signal)).toMatchObject({ ok: false, reason: 'error' });
  });
  it('abort mid-stream resolves error/aborted (never rejects)', async () => {
    const ctl = new AbortController();
    const p = makeRepair({ reqId: 'x', fetch: server({ lines: [{ t: 'text', d: 'a' }], hang: true }).f })(req(), ctl.signal);
    setTimeout(() => ctl.abort(), 10);
    expect(await p).toEqual({ ok: false, reason: 'error', detail: 'aborted' });
    expect(await makeRepair({ reqId: 'x', fetch: server({}).f })(req(), AbortSignal.abort())).toMatchObject({ detail: 'aborted' });
  });
  it('gives up at the deadline even when the server keeps the stream open', async () => {
    const r = await makeRepair({ reqId: 'x', fetch: server({ lines: [{ t: 'text', d: 'a' }], hang: true }).f })(req({ deadlineMs: 20 }), new AbortController().signal);
    expect(r).toEqual({ ok: false, reason: 'error', detail: 'late' });
  });
});

describe('fakeRepair', () => {
  it('after the delay: the given text, else the beat without its tags', async () => {
    vi.useFakeTimers();
    const p = fakeRepair({ delayMs: 1500 })(req(), new AbortController().signal);
    let done = false; void p.then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(1499);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toEqual({ ok: true, text: 'Notice point Z here.', usd: 0 });
    vi.useRealTimers();
    expect(await fakeRepair({ text: { 2: 'Fixed.' } })(req(), new AbortController().signal)).toMatchObject({ text: 'Fixed.' });
    expect(await fakeRepair({ text: (r) => `k${r.k}` })(req(), new AbortController().signal)).toMatchObject({ text: 'k2' });
  });
  it('faults: late sleeps past the deadline; bad returns the original; ok fixes', async () => {
    vi.useFakeTimers();
    const faults = new Map([['2', 'late' as const], ['3', 'bad' as const], ['4', 'ok' as const]]);
    const R = fakeRepair({ delayMs: 10, faults });
    const late = R(req({ deadlineMs: 1000 }), new AbortController().signal);
    let settled = false; void late.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(1499);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await late).toMatchObject({ ok: false, detail: 'late' });
    const bad = R(req({ k: 3 }), new AbortController().signal);
    await vi.advanceTimersByTimeAsync(10);
    expect(await bad).toMatchObject({ ok: true, text: req().beat });
    const ok = R(req({ k: 4 }), new AbortController().signal);
    await vi.advanceTimersByTimeAsync(10);
    expect(await ok).toMatchObject({ ok: true, text: 'Notice point Z here.' });
  });
  it('abort during the delay → aborted', async () => {
    const ctl = new AbortController();
    const p = fakeRepair({ delayMs: 5000 })(req(), ctl.signal);
    ctl.abort();
    expect(await p).toEqual({ ok: false, reason: 'error', detail: 'aborted' });
  });
  it('plainBeat drops tags and tidies spaces', () => {
    expect(plainBeat('A {{x}} b , c {{y z}}.')).toBe('A b, c.');
  });
});

describe('recordedRepair', () => {
  const events = [
    { t: 'gate', k: '2', unit: 'beat', result: 'fail', action: 'repair', flags: [], notes: [], ms: 3, bufferedMs: 7000, mode: 'beat' },
    { t: 'repair', k: '2', phase: 'sent', ms: 0 },
    { t: 'repair', k: '2', phase: 'ok', ms: 30, usd: 0.006, text: 'Recorded fix.' },
    { t: 'repair', k: '5', phase: 'sent', ms: 0 },
    { t: 'repair', k: '5', phase: 'refused', ms: 4 },
  ];
  it('replays the recorded text after the recorded latency; refusals as recorded; unknown units refused', async () => {
    const R = recordedRepair(events);
    const t0 = Date.now();
    expect(await R(req(), new AbortController().signal)).toEqual({ ok: true, text: 'Recorded fix.', usd: 0.006 });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(25);
    expect(await R(req({ k: 5 }), new AbortController().signal)).toMatchObject({ ok: false, reason: 'refused' });
    expect(await R(req({ k: 9 }), new AbortController().signal)).toMatchObject({ ok: false, reason: 'refused', detail: 'not recorded' });
  });
});
