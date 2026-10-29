import { describe, expect, it } from 'vitest';
import { placeNote } from '../../src/desk/annotate';

const page = { x: 0, y: 0, w: 1000, h: 560 };
const hits = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('placeNote', () => {
  it('sits right beside its target when that is free', () => {
    const t = { x: 400, y: 200, w: 60, h: 20 };
    const p = placeNote(t, 80, 16, [], page, 4)!;
    expect(p.box.x).toBeGreaterThan(t.x + t.w);
    expect(p.box.x - (t.x + t.w)).toBeLessThan(20);
    expect(p.leader).toBeUndefined();
  });
  it('never covers the page text, and draws a leader when it has to sit apart', () => {
    const t = { x: 400, y: 200, w: 60, h: 20 };
    // Text all around the target: lines above, below and on both sides of it.
    const text = [
      { x: 100, y: 150, w: 800, h: 20 }, { x: 100, y: 175, w: 800, h: 20 }, { x: 100, y: 200, w: 290, h: 20 }, { x: 470, y: 200, w: 430, h: 20 },
      { x: 100, y: 225, w: 800, h: 20 }, { x: 100, y: 250, w: 800, h: 20 },
    ];
    const p = placeNote(t, 80, 16, text, page, 4)!;
    expect(p).not.toBeNull();
    for (const r of text) expect(hits(p.box, r)).toBe(false);
    expect(hits(p.box, t)).toBe(false);
    expect(p.leader).toBeDefined();
  });
  it('the figure around a target is not an obstacle; its text is', () => {
    const fig = { x: 100, y: 100, w: 500, h: 400 };
    const t = { x: 300, y: 300, w: 4, h: 4 };
    const label = { x: 310, y: 290, w: 60, h: 16 };
    const p = placeNote(t, 50, 14, [fig, label], page, 3)!;
    expect(hits(p.box, label)).toBe(false);
    expect(hits(p.box, fig)).toBe(true); // in the figure's empty space, near its point
  });
  it('gives up (null) rather than cover the page when there is no room', () => {
    const full = [{ x: 0, y: 0, w: 1000, h: 195 }, { x: 0, y: 225, w: 1000, h: 335 }, { x: 0, y: 195, w: 395, h: 30 }, { x: 465, y: 195, w: 535, h: 30 }];
    expect(placeNote({ x: 400, y: 200, w: 60, h: 20 }, 80, 16, full, page, 4)).toBeNull();
  });
});
