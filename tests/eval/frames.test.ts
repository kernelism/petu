import { describe, it, expect } from 'vitest';
import { frameSchedule, frameCaptions, boardSegments, pagesTouched, digestPages, deckDigest, itemsToLines, stitchScript, downscaleScript, boardProbeScript, BOARD_SELECTOR, FRAME_OPTS } from '../../scripts/eval/frames';

const sent = (words: number[]) => words.map((w, i) => ({ text: Array.from({ length: w }, (_, k) => `w${i}_${k}`).join(' '), endMs: (i + 1) * 1000 }));

describe('frame schedule', () => {
  it('a frame every ~35 spoken words, at sentence ends, always the last', () => {
    expect(frameSchedule([])).toEqual([]);
    expect(frameSchedule(sent([5]))).toEqual([0]);
    // 12 words a sentence: 36 words by sentence 3 → frames after 3, 6 and the last (7)
    expect(frameSchedule(sent([12, 12, 12, 12, 12, 12, 12]))).toEqual([2, 5, 6]);
    // one long sentence is a frame by itself
    expect(frameSchedule(sent([40, 3, 3, 40]))).toEqual([0, 3]);
  });
  it('caps at max, spread evenly, last kept, ascending', () => {
    const p = frameSchedule(sent(Array(60).fill(36)));
    expect(p).toHaveLength(FRAME_OPTS.max);
    expect(p[p.length - 1]).toBe(59);
    expect([...p].sort((a, b) => a - b)).toEqual(p);
    expect(new Set(p).size).toBe(p.length);
    expect(frameSchedule(sent(Array(10).fill(40)), { everyWords: 35, max: 1 })).toEqual([9]);
  });
  it('captions say when, and what was said since the previous frame', () => {
    const s = [{ text: 'One.', endMs: 1200 }, { text: 'Two.', endMs: 2500 }, { text: 'Three.', endMs: 4000 }];
    const c = frameCaptions(s, [1, 2]);
    expect(c[0]).toBe('After sentence 2 of 3 (2.5s). Said since the previous frame: "One. Two."');
    expect(c[1]).toContain('"Three."');
    expect(frameCaptions([{ text: 'x'.repeat(900), endMs: 1 }], [0], 50)[0]).toContain('…');
  });
});

describe('board capture', () => {
  it('strips of one viewport, the last aligned to the bottom', () => {
    expect(boardSegments(500, 600)).toEqual([0]);
    expect(boardSegments(1500, 600)).toEqual([0, 600, 900]);
    expect(boardSegments(1200, 600)).toEqual([0, 600]);
    expect(boardSegments(0, 600)).toEqual([]);
  });
  it('a very tall board keeps its top strips and its bottom', () => {
    const s = boardSegments(10000, 600, 4);
    expect(s).toHaveLength(4); expect(s.slice(0, 3)).toEqual([0, 600, 1200]); expect(s[3]).toBe(9400);
  });
  it('the scripts are canvas-only and find the board by its attribute', () => {
    expect(boardProbeScript).toContain(BOARD_SELECTOR);
    for (const js of [stitchScript(['data:image/png;base64,AA'], [0], 600), downscaleScript('data:image/png;base64,AA')]) {
      expect(js).toContain('toDataURL'); expect(js).not.toMatch(/foreignObject/i);
    }
  });
});

describe('deck digest', () => {
  const tm = (action: Record<string, unknown>, firedAt: number, skipped?: string) => ({ action, firedAt, queuedAt: firedAt, startedAt: firedAt, endedAt: firedAt + 1, ...(skipped ? { skipped } : {}) });
  it('pages touched: scroll/sketch pages and page targets, first-touch order, skipped ignored', () => {
    expect(pagesTouched({ timings: [
      tm({ kind: 'circle', target: { page: 7 } }, 300), tm({ kind: 'scroll', page: 5 }, 100), tm({ kind: 'line', target: { region: 's' } }, 400),
      tm({ kind: 'box', target: { page: 9 } }, 500, 'unknown mark'), tm({ kind: 'connect', from: { page: 5 }, to: { region: 's' } }, 600), tm({ kind: 'sketch', page: 6, id: 's' }, 200),
    ] })).toEqual([5, 6, 7]);
  });
  it('a short deck is listed whole; a book lists the visible window and touched pages', () => {
    expect(digestPages(12, { visible: 3 })).toHaveLength(12);
    const p = digestPages(1000, { visible: 500, touched: [700], window: 2 });
    expect(p).toEqual([498, 499, 500, 501, 502, 699, 700, 701]);
    expect(digestPages(1000, { visible: 1, window: 2 })).toEqual([1, 2, 3]);
  });
  it('one line per page with the visible page marked and gaps said', () => {
    const lines = new Map([[1, ['Title', 'Sub']], [2, ['Elasticity', 'more', 'and more']], [3, []]]);
    const d = deckDigest(3, lines, { visible: 2, linesPerPage: 2 });
    expect(d).toBe('3 pages.\np1: Title / Sub\np2 (visible): Elasticity / more\np3: (no text)');
    const big = deckDigest(100, new Map(), { visible: 50, window: 1, maxPages: 10 });
    expect(big).toContain('… (pages 1-48 not listed)');
    expect(big).toContain('… (pages 52-100 not listed)');
  });
  it('groups text items into lines top to bottom, left to right', () => {
    expect(itemsToLines([{ s: 'world', x: 50, y: 700, h: 10 }, { s: 'Hello', x: 10, y: 701, h: 10 }, { s: 'below', x: 10, y: 650, h: 10 }, { s: ' ', x: 0, y: 600, h: 10 }]))
      .toEqual(['Hello world', 'below']);
  });
});
