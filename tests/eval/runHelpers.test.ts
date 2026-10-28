import { describe, it, expect } from 'vitest';
import { testUsesOf, jpegDims } from '../../scripts/eval/run';
import { pathOfSrc, deckUrlPath, deckIdOfFile, deckPath } from '../../scripts/eval/decks';
import { existsSync, readFileSync } from 'node:fs';

describe('runner helpers', () => {
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
    expect(pathOfSrc('/elsewhere/x.pdf')).toBeNull();
  });
});
