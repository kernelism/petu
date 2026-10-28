import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prewarm, PREWARM_TTL_MS } from '../../src/agent/prewarm';
import type { AskContext } from '../../src/agent/protocol';

const CTX = { docHash: 'h1', page: 2 } as AskContext;
const prefix = () => vi.fn(async () => CTX);
const okFetch = () => vi.fn(async () => new Response(JSON.stringify({ ok: true, usd: 0.001 }), { status: 200 }));

function make(o: { inFlight?: boolean; blocked?: boolean; f?: ReturnType<typeof vi.fn> } = {}) {
  const f = o.f ?? okFetch();
  const state = { inFlight: !!o.inFlight, blocked: !!o.blocked };
  const p = new Prewarm({ inFlight: () => state.inFlight, blocked: () => state.blocked, fetch: f as unknown as typeof fetch });
  return { p, f, state };
}
const calls = (f: ReturnType<typeof vi.fn>) => f.mock.calls.length;

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-28T10:00:00Z')); });
afterEach(() => vi.useRealTimers());

describe('Prewarm', () => {
  it('posts the page prefix to /api/prewarm', async () => {
    const { p, f } = make();
    await p.intent('h1', 2, prefix());
    expect(calls(f)).toBe(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/prewarm');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ context: CTX });
  });

  it('sends at most once per (docHash, page) per 25 minutes', async () => {
    const { p, f } = make();
    const g = prefix();
    await p.intent('h1', 2, g);
    await p.intent('h1', 2, g);
    expect(calls(f)).toBe(1);
    expect(g).toHaveBeenCalledOnce(); // no context build for a deduped intent
    await p.intent('h1', 3, prefix());
    await p.intent('h2', 2, prefix());
    expect(calls(f)).toBe(3);
    vi.advanceTimersByTime(PREWARM_TTL_MS - 1000);
    await p.intent('h1', 2, prefix());
    expect(calls(f)).toBe(3);
    vi.advanceTimersByTime(2000);
    await p.intent('h1', 2, prefix());
    expect(calls(f)).toBe(4);
  });

  it('never sends while an answer is in flight, or when spend is blocked', async () => {
    const { p, f, state } = make({ inFlight: true });
    await p.intent('h1', 2, prefix());
    expect(calls(f)).toBe(0);
    state.inFlight = false;
    state.blocked = true;
    await p.intent('h1', 2, prefix());
    expect(calls(f)).toBe(0);
    state.blocked = false;
    await p.intent('h1', 2, prefix());
    expect(calls(f)).toBe(1);
  });

  it('re-checks after building the prefix (an ask may have started meanwhile)', async () => {
    const { p, f, state } = make();
    await p.intent('h1', 2, async () => { state.inFlight = true; return CTX; });
    expect(calls(f)).toBe(0);
    state.inFlight = false;
    await p.intent('h1', 2, prefix());
    expect(calls(f)).toBe(1); // the skipped intent didn't count as sent
  });

  it('one prewarm at a time: intents while one is pending are dropped', async () => {
    let release: (() => void) | undefined;
    const res = { ok: true, json: async () => ({ ok: true }) } as Response;
    const f = vi.fn(() => (release ? Promise.resolve(res) : new Promise<Response>((r) => { release = () => r(res); })));
    const { p } = make({ f });
    const first = p.intent('h1', 2, prefix());
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await p.intent('h1', 3, prefix());
    expect(f).toHaveBeenCalledOnce();
    release!();
    await first;
    await p.intent('h1', 3, prefix());
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('a failed prewarm may be tried again; a server that cannot prewarm is not asked again', async () => {
    const f = vi.fn(async () => { throw new TypeError('down'); });
    const { p } = make({ f });
    await p.intent('h1', 2, prefix());
    await p.intent('h1', 2, prefix());
    expect(f).toHaveBeenCalledTimes(2);

    const g = vi.fn(async () => new Response(JSON.stringify({ ok: false, usd: 0, reason: 'prewarm needs explicit caching (PETU_EXPLICIT_CACHE=0)' }), { status: 200 }));
    const q = make({ f: g }).p;
    await q.intent('h1', 2, prefix());
    await q.intent('h1', 3, prefix());
    expect(g).toHaveBeenCalledOnce();

    // A transient refusal (upstream error, cap) leaves the page free to try again.
    const k = vi.fn(async () => new Response(JSON.stringify({ ok: false, usd: 0, reason: 'OpenAI 503' }), { status: 200 }));
    const w = make({ f: k }).p;
    await w.intent('h1', 2, prefix());
    await w.intent('h1', 2, prefix());
    expect(k).toHaveBeenCalledTimes(2);
  });

  it('a deduped answer from the server counts as warm', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ ok: true, usd: 0, reason: 'deduped' }), { status: 200 }));
    const { p } = make({ f });
    await p.intent('h1', 2, prefix());
    await p.intent('h1', 2, prefix());
    expect(f).toHaveBeenCalledOnce();
  });

  it('a prefix that fails to build is swallowed', async () => {
    const { p, f } = make();
    await expect(p.intent('h1', 2, async () => { throw new Error('render'); })).resolves.toBeUndefined();
    expect(calls(f)).toBe(0);
  });
});
