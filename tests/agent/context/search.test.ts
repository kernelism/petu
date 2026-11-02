import { describe, it, expect } from 'vitest';
import { PageIndex, rankPages, snippet, stems } from '../../../src/agent/context/search';

const pages = new Map<number, string[]>([
  [1, ['Introduction to computer vision', 'Course logistics and grading']],
  [2, ['Optical flow', 'Brightness constancy assumption', 'The aperture problem']],
  [3, ['Lucas-Kanade optical flow', 'Solve a least squares system for flow', 'Flow vectors per window', 'Corners give good flow']],
  [4, ['Stereo matching', 'Disparity and depth', 'Epipolar lines']],
  [5, ['Summary', 'Optical flow recap']],
]);

describe('search', () => {
  it('stems lowercase words of 3+ letters minus stopwords', () => {
    expect(stems('The Corners of a flowing window and the matches')).toEqual(['corner', 'flow', 'window', 'match']);
  });

  it('ranks pages by BM25', () => {
    const r = rankPages(pages, 'how does Lucas-Kanade solve optical flow?', 3);
    expect(r[0].page).toBe(3);
    expect(r.map((x) => x.page)).toContain(2);
    expect(r).toHaveLength(3);
    expect(rankPages(pages, 'disparity depth', 3)[0].page).toBe(4);
  });

  it('never returns excluded pages, nor pages without a hit', () => {
    const r = rankPages(pages, 'optical flow', 5, new Set([3, 2]));
    expect(r.map((x) => x.page)).not.toContain(3);
    expect(r.map((x) => x.page)).not.toContain(2);
    expect(r.map((x) => x.page)).toEqual([5]);
    expect(rankPages(pages, 'the and of', 3)).toEqual([]);
  });

  it('a page snippet is its best lines with one line of context each', async () => {
    const idx = new PageIndex(5, async (p) => pages.get(p) ?? []);
    await idx.fill();
    expect(idx.firstLine(2)).toBe('Optical flow');
    expect(snippet(pages.get(3)!, 'least squares flow corners')).toEqual([
      'Lucas-Kanade optical flow',
      'Solve a least squares system for flow',
      'Flow vectors per window',
      'Corners give good flow',
    ]);
  });

  it('fills the whole index in idle slices', async () => {
    let calls = 0;
    const idx = new PageIndex(40, async (p) => { calls++; return [`page ${p} title`]; });
    await idx.fill();
    expect(calls).toBe(40);
    expect(idx.ready()).toBe(true);
    expect(idx.firstLine(40)).toBe('page 40 title');
  });
});
