import { describe, it, expect, vi } from 'vitest';
import { answerPages, imagePages, parseScout, SCOUT_MAX_PAGES, SCOUT_PLAN_CHARS } from '../../src/agent/scout';
import { scoutLive, scoutPages } from '../../src/agent/client';

describe('parseScout', () => {
  it('reads strict JSON', () => {
    expect(parseScout('{"pages":[12,13,15],"plan":"walk"}', 40, 3)).toEqual({ pages: [12, 13, 15], plan: 'walk' });
  });
  it('tolerates fences and prose around the object, page numbers as strings or "p12"', () => {
    expect(parseScout('```json\n{"pages":["12","p13"],"plan":"x"}\n```', 40, 3).pages).toEqual([12, 13]);
    expect(parseScout('Here: {"pages":[4],"plan":""} done', 40, 3).pages).toEqual([4]);
  });
  it('drops duplicates, out-of-range and non-integer pages; keeps at most 6 in order', () => {
    const r = parseScout(JSON.stringify({ pages: [5, 5, 0, 41, 2.5, -1, 9, 1, 2, 3, 4, 6, 7], plan: '' }), 40, 3);
    expect(r.pages).toEqual([5, 9, 1, 2, 3, 4]);
    expect(r.pages).toHaveLength(SCOUT_MAX_PAGES);
    expect(r.fallback).toBeUndefined();
  });
  it('falls back to the visible page on junk, no object, or no valid page', () => {
    for (const t of ['', 'page 4 please', '{"pages":', 'null', '[1,2]', '{"pages":[]}', '{"pages":[99],"plan":"p"}', '{"plan":"p"}']) {
      const r = parseScout(t, 40, 7);
      expect(r.pages, t).toEqual([7]);
      expect(r.fallback, t).toEqual(expect.any(String));
    }
    expect(parseScout('{"pages":[99],"plan":"keep me"}', 40, 7).plan).toBe('keep me');
  });
  it('cuts a long plan at a word, with an ellipsis', () => {
    const plan = 'word '.repeat(300);
    const r = parseScout(JSON.stringify({ pages: [1], plan }), 5, 1);
    expect(r.plan.length).toBeLessThanOrEqual(SCOUT_PLAN_CHARS + 1);
    expect(SCOUT_PLAN_CHARS).toBeGreaterThanOrEqual(700); // ≈ 100 words: the beats at the plan's end survive the clip
    expect(r.plan.endsWith('word…')).toBe(true);
  });
});

describe('answer pages', () => {
  it('the visible page first, then the scout order; images for the first four', () => {
    expect(answerPages(5, [8, 2, 5, 3, 1, 9])).toEqual([5, 8, 2, 3, 1, 9]);
    expect(imagePages(5, [8, 2, 5, 3, 1, 9])).toEqual([5, 8, 2, 3]);
    expect(answerPages(5, [])).toEqual([5]);
  });
});

/** An NDJSON Response whose lines arrive one per pull (`hang`: then never ends until aborted). */
function ndjson(lines: object[], o: { signal?: AbortSignal; hang?: boolean; status?: number } = {}) {
  const enc = new TextEncoder();
  let i = 0;
  return new Response(new ReadableStream<Uint8Array>({
    pull(c) {
      if (i < lines.length) { c.enqueue(enc.encode(JSON.stringify(lines[i++]) + '\n')); return; }
      if (!o.hang) { c.close(); return; }
      return new Promise<void>((ok) => { const stop = () => { c.error(new DOMException('aborted', 'AbortError')); ok(); }; if (o.signal?.aborted) stop(); else o.signal?.addEventListener('abort', stop); });
    },
  }, { highWaterMark: 0 }), { status: o.status ?? 200 });
}

describe('scoutLive / scoutPages (client)', () => {
  const req = { question: 'how?', docName: 'd.pdf', docHash: 'h', numPages: 20, page: 4, digest: 'D', pageText: 'PAGE 4' };
  const ctl = () => new AbortController();
  it('posts JSON to /api/scout; streams the opener in order, then the verdict (re-checked, with the whole opener), then the cost', async () => {
    const f = vi.fn(async () => ndjson([
      { t: 'opener', d: 'It votes. ', ms: 700 }, { t: 'opener', d: 'Outliers lose.', ms: 900 },
      { t: 'scout', pages: [6, 99, 7], plan: 'p', ms: 1500 }, { t: 'end', usd: 0.001, ms: 1600, cached: 900, input: 1000 },
    ]));
    let t = 0;
    const live = scoutLive(req, ctl().signal, f as unknown as typeof fetch, () => (t += 100));
    const said: string[] = [];
    for await (const s of live.opener) said.push(s);
    expect(said).toEqual(['It votes. ', 'Outliers lose.']);
    const v = await live.verdict;
    expect(v).toMatchObject({ pages: [6, 7], plan: 'p', opener: 'It votes. Outliers lose.', openerMs: expect.any(Number) });
    expect(await live.cost).toEqual({ usd: 0.001, cached: 900, input: 1000 });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/scout');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(JSON.parse(String(init.body))).toEqual(req);
    // The one-shot form.
    const f2 = vi.fn(async () => ndjson([{ t: 'scout', pages: [6], plan: 'p', ms: 5 }, { t: 'end', usd: 0.002, ms: 6 }]));
    expect(await scoutPages(req, ctl().signal, f2 as unknown as typeof fetch)).toMatchObject({ pages: [6], plan: 'p', usd: 0.002 });
  });
  it('the early pages are known (re-checked) before the first opener sentence; pages after the opener are not early', async () => {
    const f = vi.fn(async () => ndjson([{ t: 'pages', pages: [99, 8, 9], ms: 300 }, { t: 'opener', d: 'A. ', ms: 700 }, { t: 'scout', pages: [8, 9], plan: 'p', ms: 900 }, { t: 'end', usd: 0, ms: 950 }]));
    const live = scoutLive(req, ctl().signal, f as unknown as typeof fetch);
    expect(live.pages()).toBeNull();
    for await (const s of live.opener) { expect(s).toBe('A. '); expect(live.pages()).toEqual([8, 9]); }
    const late = vi.fn(async () => ndjson([{ t: 'opener', d: 'A. ', ms: 700 }, { t: 'pages', pages: [8], ms: 800 }, { t: 'scout', pages: [8], plan: 'p', ms: 900 }]));
    const l2 = scoutLive(req, ctl().signal, late as unknown as typeof fetch);
    for await (const _ of l2.opener) { /* drain */ }
    await l2.verdict;
    expect(l2.pages()).toBeNull();
    // A stream that ends after the early pages (no verdict) keeps them in its fallback.
    const cut = vi.fn(async () => ndjson([{ t: 'pages', pages: [8, 9], ms: 300 }, { t: 'opener', d: 'A. ', ms: 700 }]));
    expect(await scoutPages(req, ctl().signal, cut as unknown as typeof fetch)).toMatchObject({ pages: [8, 9], fallback: expect.any(String), opener: 'A. ' });
  });
  it('the opener ends when the verdict comes, even while the stream is still open', async () => {
    const c = ctl();
    const f = vi.fn(async () => ndjson([{ t: 'opener', d: 'A. ', ms: 1 }, { t: 'scout', pages: [2], plan: '', ms: 2 }], { hang: true, signal: c.signal }));
    const live = scoutLive(req, c.signal, f as unknown as typeof fetch);
    const said: string[] = [];
    for await (const s of live.opener) said.push(s);
    expect(said).toEqual(['A. ']);
    expect((await live.verdict)?.pages).toEqual([2]);
    c.abort();
  });
  it('never throws: a server error, a network failure or a stream without a verdict gives the visible page; an opener that came stays', async () => {
    const e500 = vi.fn(async () => new Response('x', { status: 500 }));
    expect(await scoutPages(req, ctl().signal, e500 as unknown as typeof fetch)).toMatchObject({ pages: [4], fallback: expect.any(String) });
    const net = vi.fn(async () => { throw new TypeError('down'); });
    expect(await scoutPages(req, ctl().signal, net as unknown as typeof fetch)).toMatchObject({ pages: [4], fallback: expect.any(String) });
    const cut = vi.fn(async () => ndjson([{ t: 'opener', d: 'Half. ', ms: 1 }, 'garbage' as unknown as object]));
    expect(await scoutPages(req, ctl().signal, cut as unknown as typeof fetch)).toMatchObject({ pages: [4], opener: 'Half. ', fallback: expect.any(String) });
  });
  it('an abort returns null and ends the opener', async () => {
    const c = ctl();
    const f = vi.fn(async () => { c.abort(); throw new DOMException('aborted', 'AbortError'); });
    expect(await scoutPages(req, c.signal, f as unknown as typeof fetch)).toBeNull();
    const c2 = ctl();
    const f2 = vi.fn(async () => ndjson([{ t: 'opener', d: 'A. ', ms: 1 }], { hang: true, signal: c2.signal }));
    const live = scoutLive(req, c2.signal, f2 as unknown as typeof fetch);
    const said: string[] = [];
    for await (const s of live.opener) { said.push(s); c2.abort(); }
    expect(said).toEqual(['A. ']);
    expect(await live.verdict).toBeNull();
  });
});

describe('clipPlan: a long plan keeps its beats and scope (the length budget)', () => {
  it('cuts the prose, never the numbered beats or the scope', async () => {
    const { clipPlan } = await import('../../src/agent/scout');
    const prose = 'Draw two 1-kg masses at 1 m and pull them in to 0.5 m while the spin rises. '.repeat(12);
    const out = clipPlan(`${prose}1. Arms in, inertia drops; 2. Constant momentum; 3. Check energy source. Scope: narrow`, 750);
    expect(out.length).toBeLessThanOrEqual(750);
    expect(out.endsWith('1. Arms in, inertia drops; 2. Constant momentum; 3. Check energy source. Scope: narrow')).toBe(true);
    expect(out).toContain('…');
    expect(clipPlan('short plan. Scope: broad', 750)).toBe('short plan. Scope: broad');
  });
});
