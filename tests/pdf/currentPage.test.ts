// tests/pdf/currentPage.test.ts — the viewer's page in frame (the indicator's center, currentPage())
// follows the asked page's rule (C5): most visible in the band, not the page under the 35% line.
import { describe, it, expect } from 'vitest';
import { currentPageOf } from '../../src/pdf/PdfViewer';
import { computeLayout, laneFrame, pageAt } from '../../src/desk/layout';

describe('currentPageOf', () => {
  const L = computeLayout(laneFrame(1440)!.page, new Float64Array(30).fill(9 / 16), 900);
  it('names p2 (394px on screen) where the 35% line names p1 (262px): diag/line.ts', () => {
    expect(pageAt(L, 196 + 0.35 * 900)).toBe(1);
    expect(currentPageOf(L, 196, 900, 1)).toBe(2);
  });
  it('agrees with the reading line when one page fills the band', () => {
    const top = L.tops[4] - 64 - 20;
    expect(currentPageOf(L, top, 900, 1)).toBe(5);
  });
});
