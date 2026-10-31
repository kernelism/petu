import { describe, expect, it, vi } from 'vitest';
import { formatUsd } from '../../src/agent/protocol';
import { AskError, askErrorLine, askStream, capLine, capNotice, getSpend, spendBlocked } from '../../src/agent/client';
import type { AskEvent, AskRequest, SpendSummary } from '../../src/agent/protocol';

const REQ = { question: 'q', history: [], context: {} } as unknown as AskRequest;

/** NDJSON for `events`, cut into byte chunks at `cuts` (offsets into the UTF-8 bytes). */
function body(events: AskEvent[], cuts: number[] = [], tail = '\n'): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(events.map((e) => JSON.stringify(e)).join('\n') + tail);
  const at = [0, ...cuts.filter((c) => c > 0 && c < bytes.length), bytes.length];
  const parts = at.slice(1).map((end, i) => bytes.slice(at[i], end));
  return new ReadableStream({ start(c) { for (const p of parts) c.enqueue(p); c.close(); } });
}
const fakeFetch = (res: Response | (() => never)) => vi.fn(async () => (typeof res === 'function' ? res() : res)) as unknown as typeof fetch;
const ok = (b: ReadableStream<Uint8Array>) => new Response(b, { status: 200 });

async function collect(it: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const c of it) out.push(c);
  return out;
}

const META: AskEvent = { t: 'meta', reqId: 'r1', model: 'gpt-6.1-terra', effort: 'none' };
const DONE: AskEvent = { t: 'done', usd: 0.01, spentUsd: 1, capUsd: 40, ttftMs: 900 };

describe('askStream', () => {
  it('yields text events in order across awkward byte splits (multi-byte chars included)', async () => {
    const events: AskEvent[] = [META, { t: 'text', d: 'The line l′ ' }, { t: 'text', d: '{{circle p=3 mark=#d3}} is where — ' }, { t: 'text', d: 'x′ must lie.' }, DONE];
    const total = new TextEncoder().encode(events.map((e) => JSON.stringify(e)).join('\n')).length;
    for (const cuts of [[1], [5, 6, 7], [40, 41, 90, 91, 92], Array.from({ length: total }, (_, i) => i)]) {
      const out = await collect(askStream(REQ, new AbortController().signal, {}, fakeFetch(ok(body(events, cuts)))));
      expect(out).toEqual(['The line l′ ', '{{circle p=3 mark=#d3}} is where — ', 'x′ must lie.']);
    }
  });

  it('posts the request as JSON to /api/ask', async () => {
    const f = fakeFetch(ok(body([{ t: 'text', d: 'a' }])));
    await collect(askStream(REQ, new AbortController().signal, {}, f));
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/ask');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual(REQ);
  });

  it('routes meta, note and done to handlers', async () => {
    const h = { onMeta: vi.fn(), onNote: vi.fn(), onDone: vi.fn(), onCutOff: vi.fn() };
    const events: AskEvent[] = [META, { t: 'text', d: 'Hi.' }, { t: 'note', message: 'dropped 1 message' }, DONE];
    await collect(askStream(REQ, new AbortController().signal, h, fakeFetch(ok(body(events, [3, 50])))));
    expect(h.onMeta).toHaveBeenCalledWith(META);
    expect(h.onNote).toHaveBeenCalledWith('dropped 1 message');
    expect(h.onDone).toHaveBeenCalledWith(DONE);
    expect(h.onCutOff).not.toHaveBeenCalled();
  });

  it('reads a last line without a trailing newline and skips blank or malformed lines', async () => {
    const enc = new TextEncoder();
    const raw = `\n${JSON.stringify({ t: 'text', d: 'a' })}\n{not json\n\n${JSON.stringify({ t: 'text', d: 'b' })}`;
    const b = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(enc.encode(raw)); c.close(); } });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await collect(askStream(REQ, new AbortController().signal, {}, fakeFetch(ok(b))))).toEqual(['a', 'b']);
    warn.mockRestore();
  });

  it('an error before any text throws AskError with its code and retryability', async () => {
    const events: AskEvent[] = [{ t: 'error', code: 'no_key', message: 'Add OPENAI_API_KEY', retryable: false }];
    const err = await collect(askStream(REQ, new AbortController().signal, {}, fakeFetch(ok(body(events))))).catch((e) => e);
    expect(err).toBeInstanceOf(AskError);
    expect(err).toMatchObject({ code: 'no_key', retryable: false });
    const err2 = await collect(askStream(REQ, new AbortController().signal, {}, fakeFetch(ok(body([META, { t: 'error', code: 'rate_limited', message: '429', retryable: true }]))))).catch((e) => e);
    expect(err2).toMatchObject({ code: 'rate_limited', retryable: true });
  });

  it('an error after text ends normally and reports a cut-off (what arrived plays out)', async () => {
    const onCutOff = vi.fn();
    const events: AskEvent[] = [{ t: 'text', d: 'First part ' }, DONE, { t: 'error', code: 'cut_off', message: 'The answer was cut off.', retryable: true }, { t: 'text', d: 'never' }];
    const out = await collect(askStream(REQ, new AbortController().signal, { onCutOff }, fakeFetch(ok(body(events, [7])))));
    expect(out).toEqual(['First part ']);
    expect(onCutOff).toHaveBeenCalledWith('The answer was cut off.');
    const onCutOff2 = vi.fn();
    const out2 = await collect(askStream(REQ, new AbortController().signal, { onCutOff: onCutOff2 }, fakeFetch(ok(body([{ t: 'text', d: 'x' }, { t: 'error', code: 'network', message: 'reset', retryable: true }]))))) ;
    expect(out2).toEqual(['x']);
    expect(onCutOff2).toHaveBeenCalledOnce();
  });

  it('a cut_off with no text before it is still a cut-off, not a throw', async () => {
    const onCutOff = vi.fn();
    const out = await collect(askStream(REQ, new AbortController().signal, { onCutOff }, fakeFetch(ok(body([META, { t: 'error', code: 'cut_off', message: 'cut', retryable: true }])))));
    expect(out).toEqual([]);
    expect(onCutOff).toHaveBeenCalledOnce();
  });

  it('a stream that drops without a done after text counts as cut off', async () => {
    const onCutOff = vi.fn();
    const out = await collect(askStream(REQ, new AbortController().signal, { onCutOff }, fakeFetch(ok(body([META, { t: 'text', d: 'half an' }])))));
    expect(out).toEqual(['half an']);
    expect(onCutOff).toHaveBeenCalledOnce();
  });

  it('a connection that drops after done is not a cut-off: the whole answer arrived (QA B1)', async () => {
    const onCutOff = vi.fn(), onDone = vi.fn();
    const bytes = new TextEncoder().encode([META, { t: 'text', d: 'All of it.' }, DONE].map((e) => JSON.stringify(e)).join('\n') + '\n');
    let sent = false;
    const dropping = new ReadableStream<Uint8Array>({ pull(c) { if (!sent) { sent = true; c.enqueue(bytes); } else c.error(new TypeError('network error')); } });
    const out = await collect(askStream(REQ, new AbortController().signal, { onCutOff, onDone }, fakeFetch(ok(dropping))));
    expect(out).toEqual(['All of it.']);
    expect(onDone).toHaveBeenCalledOnce();
    expect(onCutOff).not.toHaveBeenCalled();
  });
  it('a connection that drops after text but before done is still a cut-off', async () => {
    const onCutOff = vi.fn();
    const bytes = new TextEncoder().encode([META, { t: 'text', d: 'half an' }].map((e) => JSON.stringify(e)).join('\n') + '\n');
    let sent = false;
    const dropping = new ReadableStream<Uint8Array>({ pull(c) { if (!sent) { sent = true; c.enqueue(bytes); } else c.error(new TypeError('network error')); } });
    await collect(askStream(REQ, new AbortController().signal, { onCutOff }, fakeFetch(ok(dropping))));
    expect(onCutOff).toHaveBeenCalledWith('The answer was cut off.');
  });

  it('maps a failed fetch to network and HTTP errors to bad_request / upstream', async () => {
    const net = await collect(askStream(REQ, new AbortController().signal, {}, fakeFetch(() => { throw new TypeError('Failed to fetch'); }))).catch((e) => e);
    expect(net).toMatchObject({ code: 'network', retryable: true });
    const bad = await collect(askStream(REQ, new AbortController().signal, {}, fakeFetch(new Response('no', { status: 400 })))).catch((e) => e);
    expect(bad).toMatchObject({ code: 'bad_request', retryable: false });
    const up = await collect(askStream(REQ, new AbortController().signal, {}, fakeFetch(new Response('no', { status: 502 })))).catch((e) => e);
    expect(up).toMatchObject({ code: 'upstream', retryable: true });
    const missing = await collect(askStream(REQ, new AbortController().signal, {}, fakeFetch(new Response('no', { status: 404 })))).catch((e) => e);
    expect(missing).toMatchObject({ code: 'network', retryable: true });
  });

  it('aborting stops reading, cancels the body and does not throw', async () => {
    const ctrl = new AbortController();
    const enc = new TextEncoder();
    let cancelled = false;
    let push!: (s: string) => void;
    const b = new ReadableStream<Uint8Array>({
      start(c) { push = (s) => c.enqueue(enc.encode(s)); },
      cancel() { cancelled = true; },
    });
    const f = vi.fn(async (_u: string, init: RequestInit) => {
      init.signal!.addEventListener('abort', () => {});
      return ok(b);
    }) as unknown as typeof fetch;
    const out: string[] = [];
    const run = (async () => { for await (const c of askStream(REQ, ctrl.signal, {}, f)) { out.push(c); ctrl.abort(); push(`${JSON.stringify({ t: 'text', d: 'late' })}\n`); } })();
    push(`${JSON.stringify({ t: 'text', d: 'first' })}\n`);
    await expect(run).resolves.toBeUndefined();
    expect(out).toEqual(['first']);
    expect(cancelled).toBe(true);
  });

  it('a fetch rejected because the signal aborted returns quietly', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const f = fakeFetch(() => { throw new DOMException('aborted', 'AbortError'); });
    await expect(collect(askStream(REQ, ctrl.signal, {}, f))).resolves.toEqual([]);
  });
});

describe('getSpend', () => {
  it('returns the summary, or null when the server is missing or down', async () => {
    const s: SpendSummary = { totalUsd: 1.5, capUsd: 40, todayUsd: 0.2 };
    expect(await getSpend(fakeFetch(new Response(JSON.stringify(s), { status: 200 })))).toEqual(s);
    expect(await getSpend(fakeFetch(new Response('<html>', { status: 200 })))).toBeNull();
    expect(await getSpend(fakeFetch(new Response('', { status: 404 })))).toBeNull();
    expect(await getSpend(fakeFetch(() => { throw new TypeError('down'); }))).toBeNull();
  });
});

describe('copy', () => {
  const spend = (o: Partial<SpendSummary>): SpendSummary => ({ totalUsd: 0, capUsd: 40, todayUsd: 0, ...o });

  it('spendBlocked: the server says so, or a cap is used up', () => {
    expect(spendBlocked(null)).toBe(false);
    expect(spendBlocked(spend({ totalUsd: 1 }))).toBe(false);
    expect(spendBlocked(spend({ blocked: 'total' }))).toBe(true);
    expect(spendBlocked(spend({ totalUsd: 0.0076, capUsd: 0 }))).toBe(true);
    expect(spendBlocked(spend({ todayUsd: 3, dailyCapUsd: 3 }))).toBe(true);
  });

  it('capLine names the cap that is used up, in dollars, with the command-line knob', () => {
    expect(capLine(spend({ totalUsd: 60, capUsd: 60 }))).toBe('Spending cap reached: $60.00 of $60.00 used. This is the $60.00 hard stop.');
    expect(capLine(spend({ totalUsd: 40, capUsd: 40 }))).toBe('Spending cap reached: $40.00 of $40.00 used. Raise it for this run: PETU_TOTAL_CAP_USD=60 npm run dev.');
    expect(capLine(spend({ totalUsd: 0.0076, capUsd: 0 }))).toBe('Spending cap reached: $0.0076 of $0.00 used. Raise it for this run: PETU_TOTAL_CAP_USD=60 npm run dev.');
    expect(capLine(spend({ totalUsd: 10, todayUsd: 3.01, dailyCapUsd: 3 }))).toBe("Today's spending cap reached: $3.01 of $3.00 used. Raise it for this run: PETU_DAILY_CAP_USD=6 npm run dev.");
    expect(capLine(null)).toBe('Spending cap reached. Raise it for this run on the command line, e.g. PETU_DAILY_CAP_USD=6 npm run dev.');
    // The server refuses for another reason (a phase budget): its line, which names the budget.
    expect(capLine(spend({ totalUsd: 5, phase: 'dev', phaseCapUsd: 1, blockedCode: 'phase', blocked: 'Spending stopped: $1.00 of this phase’s budget ($1.00) is used.' })))
      .toBe('Spending stopped: $1.00 of this phase’s budget ($1.00) is used. Raise it for this run: PETU_CAP_DEV=2 npm run dev.');
    // Older servers send only the line: the cap is read from it.
    expect(capLine(spend({ totalUsd: 0.01, todayUsd: 0.014, dailyCapUsd: 0.02, blocked: "Spending stopped: $0.014 of today's cap ($0.020) is used." })))
      .toBe("Spending stopped: $0.014 of today's cap ($0.020) is used. Raise it for this run: PETU_DAILY_CAP_USD=1 npm run dev.");
    expect(capLine(null)).not.toMatch(/\.env/);
  });

  it('capNotice is the student\'s line: no dollars, no knobs; the daily cap says when it resets (F03)', () => {
    const daily = "Today's answer budget is used up. It resets tomorrow.";
    expect(capNotice(spend({ totalUsd: 10, todayUsd: 3.67, dailyCapUsd: 3 }))).toBe(daily);
    expect(capNotice(spend({ totalUsd: 0.01, todayUsd: 0.014, dailyCapUsd: 0.02, blocked: "Spending stopped: $0.014 of today's cap ($0.020) is used." }))).toBe(daily);
    expect(capNotice(spend({ totalUsd: 60, capUsd: 60 }))).toBe('The answer budget is used up.');
    expect(capNotice(null, 'Today’s cap… PETU_DAILY_CAP_USD=6')).toBe(daily);
    for (const s of [spend({ totalUsd: 60, capUsd: 60 }), spend({ todayUsd: 3, dailyCapUsd: 3 }), null]) expect(capNotice(s)).not.toMatch(/PETU_|\$|npm/);
    expect(askErrorLine('cap', spend({ todayUsd: 3, dailyCapUsd: 3 })).message).toBe(daily);
  });

  it('formatUsd keeps two significant digits below $0.10', () => {
    expect([0, 0.014, 0.02, 0.0076, 0.1, 0.105, 3.01, 40, 0.00012].map(formatUsd))
      .toEqual(['$0.00', '$0.014', '$0.020', '$0.0076', '$0.10', '$0.10', '$3.01', '$40.00', '$0.00012']);
  });

  it('askErrorLine follows the copy table, with Retry only where it helps', () => {
    expect(askErrorLine('no_key', null)).toEqual({ message: 'Add your OpenAI key to .env, then restart the dev server.', retry: false });
    expect(askErrorLine('cap', spend({ totalUsd: 60, capUsd: 60 }))).toEqual({ message: 'The answer budget is used up.', retry: false });
    expect(askErrorLine('rate_limited', null)).toEqual({ message: 'The tutor is busy. Try again in a moment.', retry: true });
    expect(askErrorLine('network', null)).toEqual({ message: "Couldn't reach the tutor.", retry: true });
    expect(askErrorLine('upstream', null)).toEqual({ message: "Couldn't reach the tutor.", retry: true });
    expect(askErrorLine('cut_off', null)).toEqual({ message: 'The answer was cut off.', retry: true });
    expect(askErrorLine('bad_request', null)).toEqual({ message: "That question couldn't be sent.", retry: false });
  });
});

describe('askStream: the storyboard event', () => {
  it('reaches onStoryboard (and onEvent) before stage 2 text', async () => {
    const seen: string[] = [];
    const sb: AskEvent = { t: 'storyboard', ms: 4200, usd: 0.02, model: 'gpt-6.1-terra', effort: 'low', version: 'b1.0', fallback: 'storyboard timed out' };
    const events: AskEvent[] = [sb, { t: 'meta', reqId: 'r', model: 'm', effort: 'none' }, { t: 'text', d: 'Hi.' }, { t: 'done', usd: 0.01, spentUsd: 1, capUsd: 40, ttftMs: 5 }];
    const out = await collect(askStream(REQ, new AbortController().signal, {
      onStoryboard: (e) => seen.push(`story ${e.fallback}`), onMeta: () => seen.push('meta'), onEvent: (e) => seen.push(`ev ${e.t}`),
    }, fakeFetch(ok(body(events)))));
    expect(out).toEqual(['Hi.']);
    expect(seen.slice(0, 3)).toEqual(['ev storyboard', 'story storyboard timed out', 'ev meta']);
  });
});
