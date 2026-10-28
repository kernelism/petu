// tests/desk/route.test.ts
import { describe, it, expect } from 'vitest';
import { routeGutter, END_GAP, maskBlocker } from '../../src/desk/route';
import type { SPt } from '../../src/geometry/space';

type R = { x: number; y: number; w: number; h: number };
const page = { x: 200, y: 100, w: 800, h: 450 };
const anchor = { x: 400, y: 300, w: 30, h: 30 };
const inside = (p: SPt, r: R) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
const hits = (a: R, b: R) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const crossings = (s: SPt[], at: number, k: 'x' | 'y' = 'x') => {
  let n = 0;
  for (let i = 1; i < s.length; i++) if ((s[i - 1][k] >= at) !== (s[i][k] >= at)) n++;
  return n;
};
/** Content boxes on the page; `blocked` says whether a frame rect touches any of them. */
const blocker = (boxes: R[]) => (r: R) => boxes.some((b) => hits(b, r));

describe('maskBlocker', () => {
  it('maps a frame rect onto the page grid', () => {
    // 10 × 5 grid over the page; one inked cell at col 6, row 2.
    const cells = new Uint8Array(50);
    cells[2 * 10 + 6] = 1;
    const b = maskBlocker({ cols: 10, rows: 5, cells }, page);
    const cell = { x: page.x + 6 * 80, y: page.y + 2 * 90, w: 80, h: 90 };
    expect(b({ x: cell.x + 10, y: cell.y + 10, w: 5, h: 5 })).toBe(true);
    expect(b({ x: cell.x - 30, y: cell.y + 10, w: 5, h: 5 })).toBe(false);
    expect(b({ x: 0, y: 0, w: 50, h: 50 })).toBe(false); // off the page
  });
});

describe('routeGutter (split layout)', () => {
  const page = { x: 36, y: 64, w: 666, h: 375 };
  const gutterX = 36 + 666 + 18;
  const el = { x: 900, y: 700, w: 10, h: 10 };
  const anchor = { x: 200, y: 200, w: 20, h: 20 };
  const hits = (s: { x: number; y: number }[], r: { x: number; y: number; w: number; h: number }) => s.some((p) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h);

  it('runs level to the page edge, vertically in the gutter, then into the board: no diagonal across the slide', () => {
    const s = routeGutter(anchor, el, { page, gutterX })!;
    expect(s).not.toBeNull();
    const onPage = s.filter((p) => p.x < page.x + page.w);
    expect(Math.max(...onPage.map((p) => p.y)) - Math.min(...onPage.map((p) => p.y))).toBeLessThan(1); // level on the page
    const vertical = s.filter((p) => Math.abs(p.x - gutterX) < 0.5);
    expect(Math.max(...vertical.map((p) => p.y)) - Math.min(...vertical.map((p) => p.y))).toBeGreaterThan(400); // the gutter run
    expect(s[s.length - 1].x).toBeCloseTo(el.x - END_GAP);
    expect(s[s.length - 1].y).toBeCloseTo(el.y + el.h / 2);
  });
  it('never crosses page content: it takes a clear band, or no route at all', () => {
    const text = { x: 260, y: 150, w: 400, h: 120 }; // right of the anchor, at its height
    const blocked = (r: { x: number; y: number; w: number; h: number }) => r.x < text.x + text.w && text.x < r.x + r.w && r.y < text.y + text.h && text.y < r.y + r.h;
    const s = routeGutter(anchor, el, { page, gutterX, blocked })!;
    expect(s).not.toBeNull();
    expect(hits(s, text)).toBe(false);
    expect(routeGutter(anchor, el, { page, gutterX, blocked: () => true })).toBeNull();
  });
  it('stays inside the visible band', () => {
    const s = routeGutter(anchor, el, { page, gutterX, band: { y0: 250, y1: 400 } })!;
    const run = s.filter((p) => p.x > anchor.x + 40 && p.x < page.x + page.w);
    for (const p of run) expect(p.y).toBeGreaterThanOrEqual(250);
  });
});
