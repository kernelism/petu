// tests/agent/prescout.test.ts — a question asked mid-answer (src/agent/route.ts): its scout starts before
// App knows which session plays it, with the paused answer; the route comes from it; the session the route
// picks adopts that same scout (the question is asked once), and reads the history as it stands by then
// (an answer it replaced has ended in between). Driven through useAgent with fetch stubbed (no network).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useAgent, type ContextSource } from '../../src/agent/useAgent';
import type { PdfDoc } from '../../src/pdf/loadPdf';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; vi.unstubAllGlobals(); });

const ground = (page: number) => ({ page, aspect: 9 / 16, lines: [], marks: [], noText: false });
const builder = (): ContextSource => ({
  warm: () => {}, destroy: () => {},
  digest: async () => 'DECK d.pdf\np1: a',
  visible: async (page) => ({ pageText: `PAGE ${page} (visible)`, ground: ground(page) }),
  pagePrefix: async () => ({}) as never,
  build: async (page) => ({ context: { docName: 'd.pdf', docHash: 'h', numPages: 20, page, docText: 'DECK', pageText: '' } as never, grounds: [ground(page)] }),
});
const ndjson = (lines: object[]) => new Response(lines.map((l) => JSON.stringify(l)).join('\n') + '\n', { status: 200 });

async function mount(scout: () => Response) {
  const calls: { url: string; body: any; signal?: AbortSignal | null }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null, signal: init?.signal });
    if (url === '/api/scout') return scout();
    return new Response('no', { status: 500 });
  }));
  let api!: ReturnType<typeof useAgent>;
  const doc = { numPages: 20, fingerprints: ['h'] } as unknown as PdfDoc;
  const Probe = () => { api = useAgent({ doc, name: 'd.pdf', enabled: true, make: builder, warmSystem: false }); return null; };
  root = createRoot(document.createElement('div'));
  await act(async () => root!.render(createElement(Probe)));
  return { api, calls };
}

describe('prescout: a mid-answer question is scouted once, before its session exists', () => {
  it('sends the paused answer, settles the route, and the adopting session asks no second scout', async () => {
    const { api, calls } = await mount(() => ndjson([{ t: 'route', route: 'new', ms: 200 }, { t: 'opener', d: 'The last page plots it. ', ms: 400 }, { t: 'scout', pages: [5], plan: 'p', ms: 600, route: 'new' }, { t: 'end', usd: 0, ms: 700 }]));
    const pre = api.prescout({ question: 'skip that, what does the graph show?', page: 3, paused: 'The paused answer was to: "Why?"' });
    expect(await pre.route).toBe('new');
    // The answer it replaces ends (its exchange lands in history) before the new session starts.
    api.history.push('Why?', ['First', 'the', 'base', 'rate.'], 3);
    const said: string[] = [];
    const src = api.source({ question: 'skip that, what does the graph show?', page: 3, ink: () => [], handlers: {}, onGrounding: () => {}, started: pre, moment: { replaced: 'R' } })(new AbortController().signal);
    try { for await (const c of src) said.push(c); } catch { /* /api/ask fails here: what matters is what was sent */ }
    const scouts = calls.filter((c) => c.url === '/api/scout');
    expect(scouts).toHaveLength(1);
    expect(scouts[0].body.paused).toBe('The paused answer was to: "Why?"');
    expect(said[0]).toBe('The last page plots it. '); // the adopted scout's opener plays
    const ask = calls.find((c) => c.url === '/api/ask')!;
    expect(ask.body.history.at(-1)).toMatchObject({ q: 'Why?' });
    expect(ask.body.context.replaced).toBe('R');
  });

  it('an abort before adoption drops the scout; once adopted, the session\'s abort does', async () => {
    const { api, calls } = await mount(() => ndjson([{ t: 'route', route: 'aside', ms: 1 }]));
    const pre = api.prescout({ question: 'q', page: 3, paused: 'P' });
    expect(await pre.route).toBe('aside');
    pre.abort();
    const scouts = () => calls.filter((c) => c.url === '/api/scout');
    expect(scouts()[0].signal?.aborted).toBe(true);
    const pre2 = api.prescout({ question: 'q2', page: 3, paused: 'P' });
    await pre2.route;
    const ctl = new AbortController();
    const it2 = api.source({ question: 'q2', page: 3, ink: () => [], handlers: {}, onGrounding: () => {}, started: pre2 })(ctl.signal)[Symbol.asyncIterator]();
    const first = it2.next();
    ctl.abort();
    await first.catch(() => undefined);
    expect(scouts()).toHaveLength(2);
    expect(scouts()[1].signal?.aborted).toBe(true);
  });
});
