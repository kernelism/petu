// tests/desk/route.test.ts
import { describe, it, expect } from 'vitest';
import { routeConnector, edgeFor, END_GAP } from '../../src/desk/route';

const page = { x: 200, y: 100, w: 800, h: 450 };
const anchor = { x: 400, y: 300, w: 30, h: 30 };
const inside = (p: { x: number; y: number }, r: typeof page) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;

describe('routeConnector', () => {
  it('right: leaves the anchor, crosses the page edge once, ends just before the element', () => {
    const el = { x: 1100, y: 150, w: 20, h: 20 };
    const s = routeConnector(anchor, el, edgeFor('right', page));
    expect(s[0]).toEqual({ x: 430 + END_GAP, y: 315 });
    expect(s[s.length - 1].x).toBeCloseTo(1100 - END_GAP);
    expect(s[s.length - 1].y).toBeCloseTo(160);
    let crossings = 0;
    for (let i = 1; i < s.length; i++) if ((s[i - 1].x - 1000) * (s[i].x - 1000) < 0) crossings++;
    expect(crossings).toBe(1);
    for (let i = 1; i < s.length; i++) expect(s[i].x).toBeGreaterThanOrEqual(s[i - 1].x); // no doubling back
    expect(s.some((p) => inside(p, el))).toBe(false);
    expect(s.some((p) => inside(p, anchor))).toBe(false);
  });
  it('left mirrors right', () => {
    const el = { x: 40, y: 400, w: 20, h: 20 };
    const s = routeConnector(anchor, el, edgeFor('left', page));
    expect(s[0].x).toBe(400 - END_GAP);
    expect(s[s.length - 1].x).toBeCloseTo(60 + END_GAP);
    for (let i = 1; i < s.length; i++) expect(s[i].x).toBeLessThanOrEqual(s[i - 1].x);
  });
  it('below goes down through the bottom edge', () => {
    const el = { x: 500, y: 700, w: 20, h: 20 };
    const s = routeConnector(anchor, el, edgeFor('below', page));
    expect(s[0].y).toBe(330 + END_GAP);
    expect(s[s.length - 1].y).toBeCloseTo(700 - END_GAP);
    for (let i = 1; i < s.length; i++) expect(s[i].y).toBeGreaterThanOrEqual(s[i - 1].y);
  });
});
