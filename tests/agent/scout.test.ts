import { describe, it, expect, vi } from 'vitest';
import { answerPages, imagePages, parseScout, SCOUT_MAX_PAGES } from '../../src/agent/scout';
import { scoutPages } from '../../src/agent/client';

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
    expect(r.plan.length).toBeLessThanOrEqual(601);
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

describe('scoutPages (client)', () => {
  const req = { question: 'how?', docName: 'd.pdf', docHash: 'h', numPages: 20, page: 4, digest: 'D' };
  const ctl = () => new AbortController();
  it('posts JSON to /api/scout and returns the server verdict, re-checked', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ pages: [6, 99, 7], plan: 'p', ms: 640, usd: 0.001 }), { status: 200 }));
    const r = await scoutPages(req, ctl().signal, f as unknown as typeof fetch);
    expect(r).toEqual({ pages: [6, 7], plan: 'p', ms: 640, usd: 0.001 });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/scout');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(JSON.parse(String(init.body))).toEqual(req);
  });
  it('never throws: a server error or a network failure gives the visible page', async () => {
    const e500 = vi.fn(async () => new Response('x', { status: 500 }));
    expect(await scoutPages(req, ctl().signal, e500 as unknown as typeof fetch)).toMatchObject({ pages: [4], fallback: expect.any(String) });
    const net = vi.fn(async () => { throw new TypeError('down'); });
    expect(await scoutPages(req, ctl().signal, net as unknown as typeof fetch)).toMatchObject({ pages: [4], fallback: expect.any(String) });
  });
  it('an abort returns null', async () => {
    const c = ctl();
    const f = vi.fn(async () => { c.abort(); throw new DOMException('aborted', 'AbortError'); });
    expect(await scoutPages(req, c.signal, f as unknown as typeof fetch)).toBeNull();
  });
});
