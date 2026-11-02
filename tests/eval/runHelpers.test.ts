import { describe, it, expect } from 'vitest';
import { testUsesOf, jpegDims, missingDecks, captureEnd, liveSettledScript } from '../../scripts/eval/run';
import type { Chrome } from '../../scripts/eval/cdp';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathOfSrc, deckUrlPath, deckIdOfFile, deckPath } from '../../scripts/eval/decks';
import { existsSync, readFileSync } from 'node:fs';

describe('runner helpers', () => {
  it('the final shot waits for the last group to lose the live accent, so the judge sees it at rest beside the takeaway', async () => {
    // The page: one part keeps data-live for 900 ms (past the old fixed 700; render.ts LIVE_SETTLE_MS is 1400).
    const t0 = Date.now();
    const document = { querySelector: (s: string) => (s === '[data-live]' && Date.now() - t0 < 900 ? {} : null) };
    const live = () => document.querySelector('[data-live]');
    const page = (js: string) => new Function('document', `return ${js}`)(document);
    const log: string[] = [];
    const chrome = {
      eval: async (js: string) => { log.push(`eval live=${!!live()}`); return js.includes('[data-live]') ? page(js) : null; },
      shot: async () => { log.push(`shot live=${!!live()}`); return Buffer.from([]); },
    } as unknown as Chrome;
    await captureEnd(chrome, mkdtempSync(join(tmpdir(), 'petu-end-')), '');
    expect(log.filter((l) => l.startsWith('shot'))).toEqual(['shot live=false']);
    // A part that never settles cannot hang the run.
    const s = Date.now();
    await new Function('document', `return ${liveSettledScript(100)}`)({ querySelector: () => ({}) });
    expect(Date.now() - s).toBeLessThan(1000);
  });
  it('names each missing deck once with its questions, so a run fails fast instead of waiting on a page that never opens', () => {
    const find = (d: string) => { if (d === 'econ') return '/x/econ.pdf'; throw new Error(`deck ${d} (${d}.pdf) not found in /a`); };
    expect(missingDecks([{ id: 'D1', deck: 'lec06' }, { id: 'D2', deck: 'econ' }, { id: 'D3', deck: 'lec06' }], find)).toEqual(['deck lec06 (lec06.pdf) not found in /a (D1,D3)']);
    expect(missingDecks([{ id: 'D2', deck: 'econ' }], find)).toEqual([]);
  });
  it('test-split uses are counted per question set (old entries are q1)', () => {
    const uses = [{ runId: 'a', at: '' }, { runId: 'b', at: '', qset: 'q1' }, { runId: 'c', at: '', qset: 'q2' }];
    expect(testUsesOf(uses, 'q1')).toBe(2);
    expect(testUsesOf(uses, 'q2')).toBe(1);
    expect(testUsesOf([], 'q2')).toBe(0);
  });
  it('reads a JPEG size from its header', () => {
    // minimal SOI + APP0 stub + SOF0 (h=720, w=1152)
    const b = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0xd0, 0x04, 0x80, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(jpegDims(b)).toEqual({ w: 1152, h: 720 });
    expect(jpegDims(Buffer.from([1, 2, 3]))).toEqual({ w: 0, h: 0 });
  });
  it('synthetic decks are served from /fixtures and resolve to the committed files', () => {
    expect(deckUrlPath('econ')).toBe('/fixtures/econ.pdf');
    expect(deckUrlPath('lec06')).toBe('/api/dev-pdf/lec06_conv.pdf');
    expect(deckIdOfFile('mechanics.pdf')).toBe('mechanics');
    expect(deckIdOfFile('lec06_conv.pdf')).toBe('lec06');
    expect(deckIdOfFile('nope.pdf')).toBeNull();
    for (const d of ['econ', 'mechanics']) {
      const p = deckPath(d);
      expect(existsSync(p), p).toBe(true);
      expect(readFileSync(p).subarray(0, 5).toString()).toBe('%PDF-');
      expect(pathOfSrc(deckUrlPath(d))).toBe(p);
    }
    expect(pathOfSrc('/api/dev-pdf/x.pdf', [])).toBeNull();
    // Corpus documents (q3) are served like the course PDFs, from the corpus directory.
    expect(deckUrlPath('ax-resnet')).toBe('/api/dev-pdf/arxiv-1512.03385.pdf');
    expect(deckIdOfFile('arxiv-1512.03385.pdf')).toBe('ax-resnet');
    expect(pathOfSrc('/api/dev-pdf/arxiv-1512.03385.pdf', ['/c'])).toBeNull();
    expect(pathOfSrc('/elsewhere/x.pdf')).toBeNull();
  });
});
