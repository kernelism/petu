// tests/desk/layout.test.ts
import { describe, it, expect } from 'vitest';
import {
  frameFor, readingColumn, computeLayout, boardLayout, bodyFraction, bodyPx, cropSpan, margin, inView, frameTop, frameInk, band, INK_PAD,
  MAX_PAGE_W, MIN_SLIDE_COL, SAFE_TOP, SAFE_BOTTOM, BOARD_HEAD, MIN_TEXT_PX, TEXT_UNITS, SECTION_H, CROP_PAD, BOTTOM_PAD, dockReserve,
} from '../../src/desk/layout';

const SIZES: [number, number][] = [[1280, 800], [1440, 900], [2560, 1440], [1024, 768], [900, 800], [700, 900]];
const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('margin', () => {
  it('is 2.5% of the window width, within 16–40px', () => {
    expect(margin(1440)).toBe(36);
    expect(margin(400)).toBe(16);
    expect(margin(2560)).toBe(40);
  });
});

describe('frameFor', () => {
  it('reading: the page column centred, as before the split layout', () => {
    const f = frameFor(1440, 900, 'none', 9 / 16, false);
    expect(f.board).toBeNull();
    expect(f.page).toEqual(readingColumn(1440));
    expect(f.page).toEqual({ pageW: MAX_PAGE_W, pageX: 290 });
  });
  for (const [W, H] of SIZES) {
    it(`split at ${W}×${H}: equal margins, gutter = margin, shared top and bottom edges, nothing overlapping`, () => {
      const f = frameFor(W, H, 'normal', 9 / 16, false);
      const b = f.board!;
      if (f.stacked) {
        expect(f.slides.w).toBe(b.w);
        expect(b.y - (f.slides.y + f.slides.h)).toBeCloseTo(f.m);
        expect(b.y + b.h).toBeLessThanOrEqual(H - dockReserve());
        expect(f.page.pageW * (9 / 16)).toBeLessThanOrEqual(f.slides.h);
      } else {
        expect(f.slides.x).toBe(f.m);
        expect(b.x - (f.slides.x + f.slides.w)).toBeCloseTo(f.m);
        expect(W - (b.x + b.w)).toBeCloseTo(f.m);
        expect(f.slides.y).toBe(b.y);
        expect(f.slides.h).toBe(b.h);
        expect(b.y + b.h).toBeCloseTo(H - f.m);
        expect(Math.abs(f.slides.w - b.w)).toBeLessThanOrEqual(1); // 1:1
        expect(f.page).toEqual({ pageX: f.m, pageW: f.slides.w }); // the page fills its column
      }
      expect(overlaps(f.slides, b)).toBe(false);
    });
  }
  it('wide (size=l): the slide column takes ~0.4, the board ~0.6', () => {
    const f = frameFor(1440, 900, 'wide', 9 / 16, false);
    expect(f.ratio).toBe('wide');
    expect(f.slides.w / (f.slides.w + f.board!.w)).toBeCloseTo(0.4, 1);
  });
  it('a wide split that would squeeze the slides below the minimum falls back to normal', () => {
    const f = frameFor(1100, 800, 'wide', 9 / 16, false);
    expect(f.ratio).toBe('normal');
    expect(f.stacked).toBe(false);
  });
  it('stacks below the minimum slide column', () => {
    expect(frameFor(900, 800, 'normal', 9 / 16, false).stacked).toBe(true);
    expect(frameFor(1100, 800, 'normal', 9 / 16, false).stacked).toBe(false);
    const W = Math.ceil(2 * MIN_SLIDE_COL / 0.925) + 2;
    expect(frameFor(W, 800, 'normal', 9 / 16, false).stacked).toBe(false);
  });
  it('is a pure function of the window (resizing back restores the same frame)', () => {
    expect(frameFor(1440, 900, 'normal', 0.75, false)).toEqual(frameFor(1440, 900, 'normal', 0.75, false));
  });
});

describe('computeLayout', () => {
  it('lets the last page scroll up to the band in a short window', () => {
    const L = computeLayout({ pageX: 0, pageW: 340 }, new Float64Array(3).fill(9 / 16), 800);
    const last = L.tops[2];
    expect(L.total - 800).toBeGreaterThanOrEqual(last - SAFE_TOP);
    expect(computeLayout({ pageX: 0, pageW: 340 }, new Float64Array(3).fill(9 / 16)).total).toBe(last + 340 * 9 / 16 + BOTTOM_PAD);
  });
});

describe('boardLayout', () => {
  it('stacks sections under the head with one even gap, centred, uniformly scaled', () => {
    const { boxes, pad, height } = boardLayout(666, [{ body: 20 }, { body: 20, span: 300 }]);
    expect(boxes[0].y).toBe(BOARD_HEAD);
    expect(boxes[1].y - (boxes[0].y + boxes[0].h)).toBe(pad);
    expect(boxes[0].h).toBeCloseTo(SECTION_H * boxes[0].s);
    expect(boxes[1].h).toBeCloseTo(300 * boxes[1].s); // a cropped section keeps only its ink
    expect(boxes[0].x - pad).toBeCloseTo(666 - pad - (boxes[0].x + boxes[0].w));
    expect(height).toBeCloseTo(boxes[1].y + boxes[1].h + pad);
  });
  it('scale = min(width fit, type cap): small body text gets a smaller section, never text under the floor', () => {
    const wide = boardLayout(2000, [{ body: 14 }]).boxes[0];
    expect(wide.s).toBeCloseTo(14 / TEXT_UNITS);
    const narrow = boardLayout(400, [{ body: 30 }]).boxes[0];
    expect(narrow.w).toBeLessThanOrEqual(400);
    expect(boardLayout(2000, [{ body: 4 }]).boxes[0].s).toBeCloseTo(MIN_TEXT_PX / TEXT_UNITS);
  });
  it('stacked (fitH): a section scales down to fit the short board, never below half its width fit (F05)', () => {
    const free = boardLayout(760, [{ body: 40 }]).boxes[0];
    const { boxes, pad } = boardLayout(760, [{ body: 40, fitH: 420 }]);
    expect(boxes[0].s).toBeLessThan(free.s);
    expect(BOARD_HEAD + boxes[0].h + 2 * pad).toBeLessThanOrEqual(420 + 0.5);
    // Very short: the floor (half the width fit) holds; the rest reveals as it draws.
    expect(boardLayout(760, [{ body: 40, fitH: 120 }]).boxes[0].s).toBeCloseTo(free.s / 2);
  });
});

describe('bodyFraction / bodyPx', () => {
  const run = (text: string, y: number, h: number) => ({ text, rect: { x: 0, y, w: 100, h } });
  it('is the character-weighted median glyph size, ignoring headers and footers', () => {
    const runs = [
      run('A Big Title', 100, 80),
      run('body text that goes on and on', 300, 40), run('more body text here and there', 400, 40),
      run('COMPSCI 670 Some Author — Some University, Fall 26, a long footer line', 960, 20),
    ];
    // 40 model units of a 9:16 page's height, 1.12 em per box → a fraction of the page width.
    expect(bodyFraction(runs, 9 / 16)).toBeCloseTo((40 / 1000) * (9 / 16) / 1.12);
  });
  it('is null without text; bodyPx falls back and stays within the floor', () => {
    expect(bodyFraction([], 0.75)).toBeNull();
    expect(bodyPx(null, 666)).toBeGreaterThanOrEqual(MIN_TEXT_PX);
    expect(bodyPx(0.001, 666)).toBe(MIN_TEXT_PX);
  });
});

describe('cropSpan', () => {
  it('keeps a finished section\'s ink plus air; nothing measured keeps it whole', () => {
    expect(cropSpan({ y: 100, h: 300 })).toEqual({ y0: 100 - CROP_PAD, y1: 400 + CROP_PAD });
    expect(cropSpan({ y: 10, h: 680 })).toEqual({ y0: 0, y1: SECTION_H });
    expect(cropSpan(null)).toEqual({ y0: 0, y1: SECTION_H });
  });
});

describe('framing', () => {
  const v = { top: 1000, H: 900, max: 10000 };
  it('inView needs the whole rect clear of the chrome', () => {
    expect(inView({ x: 0, y: 1000 + SAFE_TOP, w: 10, h: 100 }, v)).toBe(true);
    expect(inView({ x: 0, y: 1000 + 900 - SAFE_BOTTOM - 50, w: 10, h: 100 }, v)).toBe(false);
  });
  it('frameTop centres a rect in the band', () => {
    const r = { x: 0, y: 2000, w: 1, h: 280 };
    const t = frameTop(r, v);
    expect(r.y - t - SAFE_TOP).toBeCloseTo(900 - SAFE_TOP - SAFE_BOTTOM - (r.y + r.h - t - SAFE_TOP));
  });
  it('frameTop stays put for a rect that is not finite (a page past the end)', () => {
    expect(frameTop({ x: 0, y: NaN, w: 1, h: 10 }, { ...v, top: 1234 })).toBe(1234);
  });
});

describe('frameInk (page ink framing)', () => {
  const v = { top: 0, H: 800, max: 10000 };
  const inBand = (r: { y: number; h: number }, top: number) =>
    r.y >= top + SAFE_TOP - 0.5 && r.y + r.h <= top + v.H - SAFE_BOTTOM + 0.5;
  it('frames the ink with room for its labels around it', () => {
    const r = { x: 0, y: 2000, w: 10, h: 200 };
    const t = frameInk(r, [], v);
    expect(inBand({ y: r.y - INK_PAD, h: r.h + 2 * INK_PAD }, t)).toBe(true);
  });
  it('keeps the earlier ink on the page in view with the new one when they fit together', () => {
    const ray = { x: 0, y: 2200, w: 10, h: 280 }; // drawn first, low on the page
    const hl = { x: 0, y: 1900, w: 300, h: 20 }; // the next highlight, above it
    const t = frameInk(hl, [ray], v);
    expect(inBand(hl, t)).toBe(true);
    expect(inBand(ray, t)).toBe(true);
  });
  it('drops context (oldest first) that would not fit with the target', () => {
    const recent = { x: 0, y: 2100, w: 10, h: 100 };
    const old = { x: 0, y: 3000, w: 10, h: 100 };
    const hl = { x: 0, y: 1900, w: 300, h: 20 };
    const t = frameInk(hl, [recent, old], v);
    expect(inBand(hl, t)).toBe(true);
    expect(inBand(recent, t)).toBe(true);
    expect(inBand(old, t)).toBe(false);
  });
  it('a box taller than the band keeps its anchor in the band, never under the dock', () => {
    const tall = { x: 0, y: 2000, w: 10, h: band(v.H) + 300 };
    const anchor = { x: 0, y: tall.y + tall.h - 10, w: 10, h: 10 }; // the line starts at the bottom
    const t = frameInk(tall, [], v, anchor);
    expect(inBand(anchor, t)).toBe(true);
  });
  it('is clamped to the scroll range', () => {
    expect(frameInk({ x: 0, y: 10, w: 1, h: 10 }, [], v)).toBe(0);
  });
});

describe('cropSpanX (a finished lane drawing shows the span it uses)', async () => {
  const { cropSpanX, CROP_MAX_K, CROP_PAD_X } = await import('../../src/desk/layout');
  it('crops to the drawing plus padding', () => {
    expect(cropSpanX(60, 700)).toEqual({ x0: 60 - CROP_PAD_X, w: 700 + 2 * CROP_PAD_X });
  });
  it('never enlarges past CROP_MAX_K, centred on the drawing', () => {
    const r = cropSpanX(400, 100)!;
    expect(r.w).toBeCloseTo(1000 / CROP_MAX_K);
    expect(r.x0 + r.w / 2).toBeCloseTo(450);
  });
  it('leaves a drawing that uses the canvas alone', () => {
    expect(cropSpanX(20, 960)).toBeNull();
  });
});
