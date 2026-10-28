import { describe, it, expect } from 'vitest';
import { deckDigest, DIGEST_CHARS, PAGE_CHARS, pageShare } from '../../../src/agent/context/digest';

const at = (m: Record<number, string[]>) => (p: number) => m[p];

describe('deckDigest', () => {
  it('lists every page in order: title first, then its lines, trimmed; unread and empty pages say so', () => {
    const d = deckDigest('lec.pdf', 4, at({ 1: ['Intro', '  course   logistics ', '1'], 2: ['Slide 2 of 9'], 4: ['Method', 'step one', 'step two'] }));
    expect(d.split('\n')).toEqual([
      'DECK lec.pdf (4 pages): every page, its title first, then its text, trimmed',
      'p1: Intro · course logistics',
      'p2: (no text)',
      'p3: …',
      'p4: Method · step one · step two',
    ]);
  });

  it('clips a page to its share with an ellipsis', () => {
    const d = deckDigest('a.pdf', 2, at({ 1: ['T', 'x'.repeat(2000)], 2: ['U'] }));
    const p1 = d.split('\n')[1];
    expect(p1.length).toBeLessThanOrEqual('p1: '.length + PAGE_CHARS);
    expect(p1.endsWith('…')).toBe(true);
  });

  it('stays within budget for a long book, every page still present, bookmarks first', () => {
    const n = 1200;
    const pages: Record<number, string[]> = {};
    for (let p = 1; p <= n; p++) pages[p] = [`Section ${p} heading`, 'body text '.repeat(40)];
    const d = deckDigest('book.pdf', n, at(pages), [{ title: 'Chapter 1', page: 1, depth: 0 }, { title: 'Part', page: 30, depth: 1 }]);
    const lines = d.split('\n');
    expect(lines[1]).toBe('OUTLINE');
    expect(lines[2]).toBe('Chapter 1 … p1');
    expect(lines[3]).toBe('  Part … p30');
    expect(lines.filter((l) => /^p\d+: /.test(l))).toHaveLength(n);
    expect(d.length).toBeLessThan(DIGEST_CHARS * 1.25);
    expect(pageShare(n)).toBeGreaterThanOrEqual(30);
    expect(pageShare(10)).toBe(PAGE_CHARS);
  });

  it('is deterministic (a stable cache prefix)', () => {
    const m = at({ 1: ['A'], 2: ['B', 'c'] });
    expect(deckDigest('x.pdf', 2, m)).toBe(deckDigest('x.pdf', 2, m));
  });
});

describe('deckDigest: running headers and footers', () => {
  it('drops lines repeated on most pages, keeps a title shared by a run of a few pages', () => {
    const m: Record<number, string[]> = {};
    for (let p = 1; p <= 10; p++) m[p] = ['Prof X (Uni, Fall 26) COURSE 101', p >= 4 && p <= 6 ? 'Worked example' : `Topic ${p}`, `point ${p}`];
    const lines = deckDigest('d.pdf', 10, at(m)).split('\n');
    expect(lines.join('\n')).not.toContain('Prof X');
    expect(lines[1]).toBe('p1: Topic 1 · point 1');
    expect(lines[5]).toBe('p5: Worked example · point 5');
  });
});
