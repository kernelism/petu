// tests/desk/route.test.ts
import { describe, it, expect } from 'vitest';
import { routeConnector, edgeFor, END_GAP, maskBlocker } from '../../src/desk/route';
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

describe('routeConnector', () => {
  it('right, without content info: a short vertical exit toward the element, then across the edge once', () => {
    const el = { x: 1100, y: 150, w: 20, h: 20 };
    const s = routeConnector(anchor, el, edgeFor('right', page));
    expect(s[0]).toEqual({ x: 415, y: 300 - END_GAP }); // leaves the top of the anchor (the element is above)
    expect(s[s.length - 1].x).toBeCloseTo(1100 - END_GAP);
    expect(s[s.length - 1].y).toBeCloseTo(160);
    expect(crossings(s, 1000)).toBe(1);
    for (let i = 1; i < s.length; i++) expect(s[i].x).toBeGreaterThanOrEqual(s[i - 1].x - 1e-9); // no doubling back
    expect(s.some((p) => inside(p, el))).toBe(false);
    expect(s.some((p) => inside(p, anchor))).toBe(false);
    // The exit is short: the sideways run sits just above the anchor, not at the element's height.
    const run = s.filter((p) => p.x > 440 && p.x < 760);
    for (const p of run) expect(p.y).toBeGreaterThan(260);
  });
  it('right, at the same height: leaves sideways', () => {
    const el = { x: 1100, y: 305, w: 20, h: 20 };
    const s = routeConnector(anchor, el, edgeFor('right', page));
    expect(s[0]).toEqual({ x: 430 + END_GAP, y: 315 });
  });
  it('a clear line at the anchor height is used as is', () => {
    const el = { x: 1100, y: 150, w: 20, h: 20 };
    const s = routeConnector(anchor, el, edgeFor('right', page), { page, blocked: blocker([]) });
    expect(s[0]).toEqual({ x: 430 + END_GAP, y: 315 });
    expect(crossings(s, 1000)).toBe(1);
  });
  it('detours around a figure at the anchor height through the nearest clear band, and never crosses it', () => {
    const fig = { x: 600, y: 250, w: 200, h: 150 }; // between the anchor and the page edge
    const text = { x: 240, y: 120, w: 700, h: 100 }; // bullets above it
    const el = { x: 1100, y: 280, w: 20, h: 20 };
    const s = routeConnector(anchor, el, edgeFor('right', page), { page, blocked: blocker([fig, text]) });
    const pad = (r: R, k: number) => ({ x: r.x - k, y: r.y - k, w: r.w + 2 * k, h: r.h + 2 * k });
    expect(s.some((p) => inside(p, pad(fig, 2)))).toBe(false);
    expect(s.some((p) => inside(p, text))).toBe(false);
    expect(crossings(s, 1000)).toBe(1);
    expect(s[s.length - 1].x).toBeCloseTo(1100 - END_GAP);
    expect(s[s.length - 1].y).toBeCloseTo(290);
    for (let i = 1; i < s.length; i++) expect(s[i].x).toBeGreaterThanOrEqual(s[i - 1].x - 1e-9);
    // The gap above the figure (220–250) is closer than the one below (400+): it goes up.
    expect(Math.min(...s.filter((p) => p.x > 600 && p.x < 800).map((p) => p.y))).toBeLessThan(250);
  });
  it('is one smooth path: no sharp turns between samples', () => {
    const fig = { x: 600, y: 250, w: 200, h: 150 };
    const el = { x: 1100, y: 450, w: 20, h: 20 };
    const s = routeConnector(anchor, el, edgeFor('right', page), { page, blocked: blocker([fig]) });
    for (let i = 2; i < s.length; i++) {
      const a = { x: s[i - 1].x - s[i - 2].x, y: s[i - 1].y - s[i - 2].y }, b = { x: s[i].x - s[i - 1].x, y: s[i].y - s[i - 1].y };
      const la = Math.hypot(a.x, a.y), lb = Math.hypot(b.x, b.y);
      if (la < 1e-6 || lb < 1e-6) continue;
      expect((a.x * b.x + a.y * b.y) / (la * lb)).toBeGreaterThan(0.5); // under 60° per step
    }
  });
  it('a page with no clear band anywhere still routes (straight out at the anchor height)', () => {
    const el = { x: 1100, y: 150, w: 20, h: 20 };
    const s = routeConnector(anchor, el, edgeFor('right', page), { page, blocked: () => true });
    expect(s[0]).toEqual({ x: 430 + END_GAP, y: 315 });
    expect(crossings(s, 1000)).toBe(1);
  });
  it('arrives from below instead of along a sketch line that runs into the element', () => {
    // The element sits at the right end of a drawn horizontal line (and its label under the line's left part).
    const el = { x: 1200, y: 280, w: 16, h: 16 };
    const sketchLine = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ x: 1060 + i * 18, y: 285, w: 18, h: 6 }));
    const label = { x: 1062, y: 296, w: 50, h: 14 };
    const fig = { x: 600, y: 200, w: 200, h: 150 };
    const s = routeConnector(anchor, el, edgeFor('right', page), { page, blocked: blocker([fig]), avoid: [...sketchLine, label] });
    const end = s[s.length - 1];
    expect(end.x).toBeCloseTo(1208);
    expect(end.y).toBeCloseTo(296 + END_GAP); // just under the element
    const near = (p: SPt) => Math.hypot(p.x - end.x, p.y - end.y) < 14;
    expect(s.some((p) => !near(p) && [...sketchLine, label].some((b) => inside(p, b)))).toBe(false);
    expect(crossings(s, 1000)).toBe(1);
  });
  it('keeps the side arrival when nothing is in its way', () => {
    const el = { x: 1200, y: 280, w: 16, h: 16 };
    const fig = { x: 600, y: 200, w: 200, h: 150 };
    const s = routeConnector(anchor, el, edgeFor('right', page), { page, blocked: blocker([fig]), avoid: [] });
    expect(s[s.length - 1].x).toBeCloseTo(1200 - END_GAP);
    expect(s[s.length - 1].y).toBeCloseTo(288);
  });
  it('left mirrors right', () => {
    const el = { x: 40, y: 305, w: 20, h: 20 };
    const s = routeConnector(anchor, el, edgeFor('left', page));
    expect(s[0].x).toBe(400 - END_GAP);
    expect(s[s.length - 1].x).toBeCloseTo(60 + END_GAP);
    for (let i = 1; i < s.length; i++) expect(s[i].x).toBeLessThanOrEqual(s[i - 1].x + 1e-9);
    const fig = { x: 250, y: 250, w: 120, h: 150 };
    const t = routeConnector(anchor, el, edgeFor('left', page), { page, blocked: blocker([fig]) });
    expect(t.some((p) => inside(p, fig))).toBe(false);
    expect(crossings(t, 200)).toBe(1);
  });
  it('below goes down through the bottom edge, around content under the anchor', () => {
    const el = { x: 405, y: 700, w: 20, h: 20 };
    const s = routeConnector(anchor, el, edgeFor('below', page));
    expect(s[0].y).toBe(330 + END_GAP);
    expect(s[s.length - 1].y).toBeCloseTo(700 - END_GAP);
    for (let i = 1; i < s.length; i++) expect(s[i].y).toBeGreaterThanOrEqual(s[i - 1].y - 1e-9);
    const fig = { x: 380, y: 400, w: 80, h: 100 };
    const t = routeConnector(anchor, el, edgeFor('below', page), { page, blocked: blocker([fig]) });
    expect(t.some((p) => inside(p, fig))).toBe(false);
    expect(crossings(t, 550, 'y')).toBe(1);
  });
});

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
