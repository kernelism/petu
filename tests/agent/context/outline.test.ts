import { describe, it, expect } from 'vitest';
import { docHeader, resolveOutline } from '../../../src/agent/context/outline';

describe('docHeader', () => {
  it('lists every page of a short document by its first line', () => {
    const first = new Map([[1, 'Optical flow'], [2, 'Brightness constancy'], [3, 'x'.repeat(100)]]);
    expect(docHeader('lec09.pdf', 3, 2, first)).toBe([
      'DOCUMENT lec09.pdf (3 pages)',
      'p1: Optical flow',
      'p2: Brightness constancy',
      `p3: ${'x'.repeat(79)}…`,
    ].join('\n'));
  });

  it('marks pages whose first line is not known yet', () => {
    expect(docHeader('a.pdf', 2, 1, new Map([[1, 'Intro']]))).toBe('DOCUMENT a.pdf (2 pages)\np1: Intro\np2: …');
  });

  it('uses bookmarks plus nearby first lines for a long document', () => {
    const first = new Map(Array.from({ length: 300 }, (_, i) => [i + 1, `first line of ${i + 1}`] as [number, string]));
    const marks = Array.from({ length: 150 }, (_, i) => ({ title: `Chapter ${i + 1}`, page: 2 * i + 1, depth: i % 2 }));
    const s = docHeader('book.pdf', 300, 100, first, marks);
    const lines = s.split('\n');
    expect(lines[0]).toBe('DOCUMENT book.pdf (300 pages)');
    expect(lines[1]).toBe('OUTLINE');
    expect(lines[2]).toBe('Chapter 1 … p1');
    expect(lines[3]).toBe('  Chapter 2 … p3');
    expect(lines.filter((l) => / … p\d+$/.test(l))).toHaveLength(120);
    expect(s).toContain('PAGES 90–110');
    expect(s).toContain('p90: first line of 90');
    expect(s).toContain('p110: first line of 110');
    expect(s).not.toContain('p89:');
    expect(s).not.toContain('p111:');
  });

  it('a long document without bookmarks still gets nearby first lines', () => {
    const s = docHeader('book.pdf', 500, 3, new Map([[1, 'Title page']]));
    expect(s.split('\n').slice(0, 3)).toEqual(['DOCUMENT book.pdf (500 pages)', 'PAGES 1–13', 'p1: Title page']);
  });

  it('resolves bookmarks level by level, in page order, capped at 120', async () => {
    const node = (title: string, page: number, items: unknown[] = []) => ({ title, dest: [{ num: page, gen: 0 }], items });
    const chapters = Array.from({ length: 30 }, (_, c) => node(`Ch ${c + 1}`, c * 40 + 1, Array.from({ length: 10 }, (_, s) => node(`${c + 1}.${s + 1}`, c * 40 + 2 + s))));
    const doc = {
      getOutline: async () => [...chapters, { title: 'Broken', dest: 'nope', items: [] }],
      getDestination: async () => null,
      getPageIndex: async (r: { num: number }) => r.num - 1,
    };
    const bm = await resolveOutline(doc as never);
    expect(bm).toHaveLength(120);
    expect(bm.filter((b) => b.depth === 0)).toHaveLength(30);
    expect(bm[0]).toEqual({ title: 'Ch 1', page: 1, depth: 0 });
    expect(bm.at(-1)!.title).toBe('Ch 30');
    expect(bm.map((b) => b.page)).toEqual([...bm.map((b) => b.page)].sort((a, b) => a - b));
  });
});
