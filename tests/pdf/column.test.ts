import { describe, it, expect } from 'vitest';
import { clampPageZoom, fitColumn, MASK_FADE, MIN_FIT_SHARE, PAGE_ZOOM_MAX, PAGE_ZOOM_MIN, pageZoomStep, panFor, readingOffset, zoomColumn } from '../../src/pdf/column';
import { garbled } from '../../src/pdf/mathGlyphs';
import { pageTitle, sectionFor } from '../../src/pdf/sections';
import { textLines } from '../../src/agent/context/textLines';
import type { TextRun } from '../../src/locate/locateQuote';

describe('fitColumn (F09: a slide is framed whole above the dock)', () => {
  const col = { pageX: 32, pageW: 592 };
  it('shrinks a landscape page a little taller than the band, centred in its column', () => {
    const c = fitColumn(col, 0.75, 400); // 444 tall at full width
    expect(c.pageW).toBe(533);
    expect(c.pageW * 0.75).toBeLessThanOrEqual(400);
    expect(c.pageX + c.pageW / 2).toBeCloseTo(col.pageX + col.pageW / 2);
  });
  it('leaves a page that fits, a portrait page, or one that would shrink past MIN_FIT_SHARE', () => {
    expect(fitColumn(col, 0.5625, 400)).toBe(col);
    expect(fitColumn(col, 1.294, 400)).toBe(col);
    expect(fitColumn(col, 0.75, col.pageW * 0.75 * (MIN_FIT_SHARE - 0.05))).toBe(col);
    expect(fitColumn(col, 0.75, 0)).toBe(col);
  });
});

describe('page zoom (F31)', () => {
  it('steps through the stops and off-step values go to their neighbour', () => {
    expect(pageZoomStep(1, 1)).toBe(1.25);
    expect(pageZoomStep(1, -1)).toBe(0.8);
    expect(pageZoomStep(1.1, 1)).toBe(1.25);
    expect(pageZoomStep(1.1, -1)).toBe(1);
    expect(pageZoomStep(PAGE_ZOOM_MAX, 1)).toBe(PAGE_ZOOM_MAX);
    expect(pageZoomStep(PAGE_ZOOM_MIN, -1)).toBe(PAGE_ZOOM_MIN);
    expect(clampPageZoom(9)).toBe(PAGE_ZOOM_MAX);
    expect(clampPageZoom(NaN)).toBe(1);
  });
  it('a zoomed page that fits its span stays centred on its column, inside the span', () => {
    const r = zoomColumn({ pageX: 290, pageW: 860 }, { a: 36, b: 1404 }, 1.5);
    expect(r.col.pageW).toBe(1290);
    expect(r.col.pageX).toBe(75);
    expect(r.maxPan).toBe(0);
    expect(zoomColumn({ pageX: 290, pageW: 860 }, { a: 36, b: 1404 }, 0.5).col).toEqual({ pageW: 430, pageX: 505 });
  });
  it('wider than its span, it pans within [0, maxPan]', () => {
    const span = { a: 36, b: 702 };
    const r = zoomColumn({ pageX: 36, pageW: 666 }, span, 2, 5000);
    expect(r.maxPan).toBe(666);
    expect(r.pan).toBe(666);
    expect(r.col.pageX).toBe(36 - 666);
    expect(zoomColumn({ pageX: 36, pageW: 666 }, span, 2, -10).col.pageX).toBe(36);
  });
  it('panFor keeps the point under the pointer', () => {
    const span = { a: 36, b: 702 };
    const pan = panFor(span, 1332, 0.4, 300);
    const { col } = zoomColumn({ pageX: 36, pageW: 666 }, span, 2, pan);
    expect(col.pageX + 0.4 * col.pageW).toBeCloseTo(300);
  });
});

describe('readingOffset (F46: no sliver of the page above under the chrome)', () => {
  it('centres, but never lets the page above reach into the top fade', () => {
    expect(readingOffset(663, 645, 24)).toBe(9);
    expect(readingOffset(663, 602, 24)).toBe(24 - MASK_FADE);
    expect(readingOffset(400, 645, 24)).toBe(0);
  });
});

describe('labels that read as broken glyphs are dropped (F44)', () => {
  it('garbled: implausible glyphs or > 30% symbols', () => {
    expect(garbled('⇥⇠ ✏ Loss')).toBe(true);
    expect(garbled('∑∫∂ ≤ ≈ x')).toBe(true);
    expect(garbled('The Law of Demand')).toBe(false);
    expect(garbled('8.1 Confidence intervals (part 2)')).toBe(false);
    expect(garbled('Bayes’ rule: P(A|B)')).toBe(false);
  });
  it('the page title skips a garbled line for the next readable one; a garbled bookmark gives no label', () => {
    const r = (text: string, y: number, h: number): TextRun => ({ text, rect: { x: 50, y, w: 400, h } });
    expect(pageTitle(textLines([r('⇥⇠✓ ◆◆ ab', 40, 40), r('Gradient descent', 120, 30)], 1))).toBe('Gradient descent');
    expect(sectionFor([{ title: '⇥⇠ ✏✓', page: 2, depth: 0 }] as never, 3)).toBeUndefined();
  });
});
