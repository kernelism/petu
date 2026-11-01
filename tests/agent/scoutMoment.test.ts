// tests/agent/scoutMoment.test.ts — the scout hears the moment (C5): a check reply's scout request
// carries the check question and the page it was offered on, and is asked on that page; what the
// student pointed at goes too. Driven through useAgent's real source with fetch stubbed (no network).
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

/** Runs one question through useAgent's source; returns the bodies POSTed to /api/scout. */
async function scoutBodies(ask: Record<string, unknown>) {
  const bodies: any[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/scout') bodies.push(JSON.parse(String(init?.body)));
    return new Response('no', { status: 500 });
  }));
  let api!: ReturnType<typeof useAgent>;
  const doc = { numPages: 20, fingerprints: ['h'] } as unknown as PdfDoc;
  const Probe = () => { api = useAgent({ doc, name: 'd.pdf', enabled: true, make: builder, warmSystem: false }); return null; };
  root = createRoot(document.createElement('div'));
  await act(async () => root!.render(createElement(Probe)));
  const it = api.source({ question: '0.5', page: 6, ink: () => [], handlers: {}, onGrounding: () => {}, ...ask })(new AbortController().signal);
  try { for await (const _ of it) { /* the answer fails at /api/ask: only the scout request matters */ } } catch { /* AskError */ }
  return bodies;
}

describe('the scout request carries the moment', () => {
  it('a check reply: the check question and its page; asked on that page', async () => {
    const [b] = await scoutBodies({ page: 12, checkPage: 12, moment: { check: 'What happens if the rate doubles?' } });
    expect(b.page).toBe(12);
    expect(b.check).toEqual({ q: 'What happens if the rate doubles?', page: 12 });
  });
  it('what the student pointed at; nothing when there is no moment', async () => {
    const [b] = await scoutBodies({ moment: { about: 'The student selected this text on page 6: "x"' } });
    expect(b.about).toMatch(/selected this text on page 6/);
    expect(b.check).toBeUndefined();
    const [c] = await scoutBodies({});
    expect(c.about).toBeUndefined();
  });
});
