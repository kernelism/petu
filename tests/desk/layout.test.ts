// tests/desk/layout.test.ts
import { describe, it, expect } from 'vitest';
import {
  column, computeLayout, placeAll, regionRects, lanesFor, gapsFor, stageLayout, inView, fitTogether, frameTop, regionWidth,
  MAX_PAGE_W, C_MIN_PAGE_W, GAP_X, TOOLBAR_CLEAR, EDGE, SAFE_TOP, SAFE_BOTTOM, GAP_Y, type RegionReq,
} from '../../src/desk/layout';

const slides = (n: number) => new Float64Array(n).fill(9 / 16);
const req = (id: string, page: number, o: Partial<RegionReq> = {}): RegionReq => ({ id, page, size: 'm', place: 'auto', ...o });
const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function deskAt(W: number, H: number, reqs: RegionReq[], pages = 5) {
  const placed = placeAll(reqs, W, H);
  const col = column(W, lanesFor(placed, W));
  const L = computeLayout(col, slides(pages), gapsFor(placed, W, col));
  return { placed, col, L, rects: regionRects(placed, L, W) };
}

describe('column', () => {
  it('is centered at full width with no lanes (unchanged from the viewer today)', () => {
    expect(column(1440, { left: 0, right: 0 })).toEqual({ pageW: MAX_PAGE_W, pageX: 290 });
    expect(column(800, { left: 0, right: 0 })).toEqual({ pageW: 736, pageX: 32 });
  });
  it('slides the page left to make a right lane, shrinking it only when needed', () => {
    const lane = regionWidth('m', 1440) + GAP_X;
    const c = column(1440, { left: 0, right: lane });
    expect(c.pageX + c.pageW + lane).toBeLessThanOrEqual(1440 - EDGE);
    expect(c.pageX).toBeLessThan(290);
    expect(c.pageX).toBeGreaterThanOrEqual(TOOLBAR_CLEAR); // never under the canvas toolbar
    const wide = column(2560, { left: 0, right: lane });
    expect(wide.pageW).toBe(MAX_PAGE_W);
  });
  it('keeps a left lane clear of the toolbar', () => {
    const lane = regionWidth('s', 1440) + GAP_X;
    const c = column(1440, { left: lane, right: 0 });
    expect(c.pageX - lane).toBeGreaterThanOrEqual(TOOLBAR_CLEAR);
  });
});

describe('placeAll', () => {
  it('auto prefers right, then left for a second region on the same page', () => {
    const p = placeAll([req('a', 3), req('b', 3)], 1920, 1080);
    expect(p.map((x) => x.mode)).toEqual(['right', 'left']);
  });
  it('size l is always B, and so is a promoted region', () => {
    expect(placeAll([req('a', 3, { size: 'l' })], 2560, 1440)[0].mode).toBe('b');
    expect(placeAll([req('a', 3, { forceB: true })], 2560, 1440)[0].mode).toBe('b');
  });
  it('auto goes below when neither side fits; B when below does not fit either', () => {
    expect(placeAll([req('a', 3)], 1024, 768)[0].mode).toBe('below');
    expect(placeAll([req('a', 3)], 1024, 440)[0].mode).toBe('b'); // too short for the region
  });
  it('a side that would make the page narrower than C_MIN_PAGE_W does not fit', () => {
    expect(placeAll([req('a', 3, { place: 'right' })], 1024, 768)[0].mode).toBe('b');
    expect(column(1024, lanesFor([{ ...req('a', 3), mode: 'right' }], 1024)).pageW).toBeLessThan(C_MIN_PAGE_W);
  });
  it('an explicit place that does not fit is B, not another side', () => {
    expect(placeAll([req('a', 3, { place: 'left' })], 1024, 768)[0].mode).toBe('b');
  });
  it('is a pure function of the window: resizing back restores C (rule 7)', () => {
    const r = [req('a', 2, { place: 'right' })];
    expect(placeAll(r, 1024, 768)[0].mode).toBe('b');
    expect(placeAll(r, 1440, 900)[0].mode).toBe('right');
  });
});

describe('regionRects', () => {
  for (const [W, H] of [[1280, 800], [1440, 900], [1920, 1080], [2560, 1440]]) {
    it(`never overlaps pages or other regions at ${W}×${H}`, () => {
      const { L, rects } = deskAt(W, H, [req('a', 2), req('b', 2), req('c', 4, { place: 'below' })]);
      const pages = Array.from(L.tops, (t, i) => ({ x: L.pageX, y: t, w: L.pageW, h: L.heights[i] }));
      const rs = [...rects.values()];
      for (const r of rs) {
        for (const p of pages) expect(overlaps(r, p)).toBe(false);
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w).toBeLessThanOrEqual(W);
      }
      for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) expect(overlaps(rs[i], rs[j])).toBe(false);
    });
  }
  it('anchors a region to its page: it moves with the page top', () => {
    const a = deskAt(1440, 900, [req('a', 3)]);
    const r = a.rects.get('a')!;
    expect(r.x).toBe(a.L.pageX + a.L.pageW + GAP_X);
    expect(r.y - a.L.tops[2]).toBeCloseTo(Math.max(0, (a.L.heights[2] - r.h) / 2));
  });
  it('stacks two right regions on the same page instead of overlapping', () => {
    const { rects } = deskAt(1920, 1080, [req('a', 3, { place: 'right' }), req('b', 3, { place: 'right' })]);
    const a = rects.get('a')!, b = rects.get('b')!;
    expect(b.y).toBeGreaterThanOrEqual(a.y + a.h + GAP_Y - 1e-9);
  });
  it('below inserts a gap after its page and centers the region in the column', () => {
    const { L, rects } = deskAt(1440, 900, [req('a', 2, { place: 'below' })]);
    const r = rects.get('a')!;
    expect(r.y).toBeCloseTo(L.tops[1] + L.heights[1] + GAP_Y);
    expect(L.tops[2]).toBeGreaterThanOrEqual(r.y + r.h + GAP_Y);
    expect(r.x + r.w / 2).toBeCloseTo(L.pageX + L.pageW / 2);
  });
});

describe('stageLayout (B)', () => {
  it('pins the card top-left and gives the region the rest, inside the chrome', () => {
    const s = stageLayout(1440, 900, 9 / 16);
    expect(s.card.x).toBeLessThan(s.region.x);
    expect(s.region.x).toBeGreaterThanOrEqual(s.card.x + s.card.w + 40);
    expect(s.region.y).toBeGreaterThanOrEqual(SAFE_TOP);
    expect(s.region.y + s.region.h).toBeLessThanOrEqual(900 - SAFE_BOTTOM);
    expect(s.region.h / s.region.w).toBeCloseTo(0.7);
    expect(s.region.w).toBeGreaterThan(800);
  });
});

describe('framing', () => {
  const v = { top: 1000, H: 900, max: 10000 };
  it('inView needs the whole rect clear of the chrome', () => {
    expect(inView({ x: 0, y: 1000 + SAFE_TOP, w: 10, h: 100 }, v)).toBe(true);
    expect(inView({ x: 0, y: 1000 + 900 - SAFE_BOTTOM - 50, w: 10, h: 100 }, v)).toBe(false);
  });
  it('fitTogether and frameTop center a union in the band', () => {
    expect(fitTogether([{ x: 0, y: 0, w: 1, h: 100 }, { x: 0, y: 500, w: 1, h: 100 }], 900)).toBe(true);
    expect(fitTogether([{ x: 0, y: 0, w: 1, h: 100 }, { x: 0, y: 700, w: 1, h: 100 }], 900)).toBe(false);
    const r = { x: 0, y: 2000, w: 1, h: 280 };
    const t = frameTop(r, v);
    expect(r.y - t - SAFE_TOP).toBeCloseTo(900 - SAFE_TOP - SAFE_BOTTOM - (r.y + r.h - t - SAFE_TOP));
  });
  it('frameTop stays put for a rect that is not finite (a page past the end)', () => {
    expect(frameTop({ x: 0, y: NaN, w: 1, h: 10 }, { ...v, top: 1234 })).toBe(1234);
  });
});
