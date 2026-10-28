import { describe, it, expect } from 'vitest';
import { formatVisible, formatNeighbour, lineText } from '../../../src/agent/context/format';
import type { PageGround } from '../../../src/agent/context/types';
import type { TextLine } from '../../../src/agent/context/textLines';

const L = (id: string, text: string, x: number, y: number, w: number, math = false): TextLine => ({ id, text, rect: { x, y, w, h: 30 }, runs: [], math });
const page: PageGround = {
  page: 40,
  aspect: 0.5625,
  noText: false,
  lines: [L('t1', 'Depth from disparity', 12, 16, 395.4), L('t2', 'x − xʹ', 211.2, 338, 63.7, true)],
  marks: [
    { id: '#d1', kind: 'dot', at: { x: 407, y: 600 }, label: 'O' },
    { id: '#a1', kind: 'arrow', from: { x: 407, y: 600 }, to: { x: 600, y: 600 }, ends: ['#d1', undefined], label: 'Baseline B' },
    { id: '#i1', kind: 'image', rect: { x: 121, y: 344, w: 318, h: 522 } },
  ],
};

describe('format', () => {
  it('lists the visible page: header, lines, marks', () => {
    expect(formatVisible(page)).toBe([
      'PAGE 40 (visible; 16:9 slide; image attached)',
      't1 16 12–407: Depth from disparity',
      't2 338 211–275 math: x − xʹ',
      '#d1 dot 407,600 "O"',
      '#a1 arrow #d1→600,600 "Baseline B"',
      '#i1 image 121,344 318×522',
    ].join('\n'));
  });

  it('names the page shape', () => {
    expect(formatVisible({ ...page, aspect: 0.75 })).toMatch(/^PAGE 40 \(visible; 4:3 slide;/);
    expect(formatVisible({ ...page, aspect: 1.294 })).toMatch(/^PAGE 40 \(visible; portrait page;/);
  });

  it('says when a page has no extractable text, and lists no garbage lines', () => {
    const s = formatVisible({ ...page, noText: true, lines: [L('t1', '���', 0, 0, 10)] });
    expect(s.split('\n')[0]).toBe('PAGE 40 (visible; 16:9 slide; no extractable text: point with marks, or by coordinates inside images)');
    expect(s).not.toContain('t1');
    expect(s).toContain('#d1 dot');
  });

  it('cuts a neighbour to its character budget', () => {
    const lines = Array.from({ length: 50 }, (_, i) => L(`t${i + 1}`, `line number ${i + 1} of the neighbour page`, 50, 20 * i, 500));
    const g: PageGround = { page: 39, aspect: 0.5625, noText: false, lines, marks: [] };
    const s = formatNeighbour(g, 300);
    expect(s.startsWith('PAGE 39 (text only)\nt1 0 50–550: line number 1')).toBe(true);
    expect(s.endsWith('\n…')).toBe(true);
    expect(s.length).toBeLessThanOrEqual(302);
    expect(formatNeighbour(g, 100000).split('\n')).toHaveLength(51);
  });

  it('formats one line', () => {
    expect(lineText(L('t9', 'B f', 10.4, 99.6, 20))).toBe('t9 100 10–30: B f');
  });
});

describe('format bounds', () => {
  it('caps the visible page block at ~6k tokens, keeping the header and the marks', async () => {
    const { VISIBLE_TOKENS } = await import('../../../src/agent/context/format');
    const lines = Array.from({ length: 3000 }, (_, i) => L(`t${i + 1}`, `a fairly long line of tiny print number ${i + 1} on a dense page`, 50, i / 3, 500));
    const s = formatVisible({ ...page, lines });
    expect(s.length).toBeLessThanOrEqual(VISIBLE_TOKENS * 3.3 + 200);
    expect(s.split('\n')[0]).toMatch(/^PAGE 40 \(visible/);
    expect(s).toContain('\n…\n#d1 dot');
    expect(s.endsWith('#i1 image 121,344 318×522')).toBe(true);
    expect(formatVisible(page)).not.toContain('…');
  });
});
