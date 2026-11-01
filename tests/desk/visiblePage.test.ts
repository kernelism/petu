// tests/desk/visiblePage.test.ts — the asked page when nothing names one (C5): the most visible page
// in the band between the top bar and the dock, not the page under the 35% reading line.
import { describe, it, expect } from 'vitest';
import { computeLayout, laneFrame, mostVisiblePage, pageAt, SAFE_TOP, SAFE_BOTTOM } from '../../src/desk/layout';

const lane = (W: number, H: number, aspect: number, n = 30) => computeLayout(laneFrame(W)!.page, new Float64Array(n).fill(aspect), H);
const vis = (L: ReturnType<typeof lane>, lo: number, hi: number, p: number) => Math.max(0, Math.min(hi, L.tops[p - 1] + L.heights[p - 1]) - Math.max(lo, L.tops[p - 1]));

describe('mostVisiblePage', () => {
  it('names the page with more on screen where the reading line names its half-gone neighbour (diag/line.ts)', () => {
    const W = 1440, H = 900, L = lane(W, H, 9 / 16), top = 196;
    const lo = top + SAFE_TOP, hi = top + H - SAFE_BOTTOM, line = top + 0.35 * H;
    expect(pageAt(L, line)).toBe(1);
    expect(Math.round(vis(L, lo, hi, 1))).toBe(262);
    expect(Math.round(vis(L, lo, hi, 2))).toBe(394);
    expect(mostVisiblePage(L, lo, hi, line)).toBe(2);
  });
  it('is never less visible than another page, at every scroll position and deck shape', () => {
    for (const [W, H, a] of [[1440, 900, 9 / 16], [1280, 800, 9 / 16], [1440, 900, 0.75], [1440, 900, 1.294], [1920, 1080, 9 / 16]] as const) {
      const L = lane(W, H, a);
      const worse: number[] = [];
      for (let top = 0; top < L.tops[27]; top += 2) {
        const lo = top + SAFE_TOP, hi = top + H - SAFE_BOTTOM;
        const p = mostVisiblePage(L, lo, hi, top + 0.35 * H);
        for (let q = 1; q <= 30; q++) if (vis(L, lo, hi, q) > vis(L, lo, hi, p) + 0.5) worse.push(top);
      }
      expect(worse).toEqual([]);
    }
  });
  it('a tie goes to the reading line', () => {
    // Two pages, each 300px of a 600px band: the line decides.
    const L = { tops: Float64Array.from([0, 324]), heights: Float64Array.from([300, 300]) };
    expect(mostVisiblePage(L, 12, 612, 200)).toBe(1);
    expect(mostVisiblePage(L, 12, 612, 400)).toBe(2);
  });
});
