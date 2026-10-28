import { describe, it, expect } from 'vitest';
import { measureToRun } from '../../src/board/boardText';
import { locateQuote } from '../../src/locate/locateQuote';

describe('measureToRun', () => {
  it('converts a board-space bbox to model coords (y scaled by 1000/700)', () => {
    expect(measureToRun({ x: 100, y: 70, width: 50, height: 35 }, 'Fx')).toEqual({ text: 'Fx', rect: { x: 100, y: 100, w: 50, h: 50 } });
  });
  it('makes board text findable by locateQuote', () => {
    const runs = [measureToRun({ x: 600, y: 280, width: 24, height: 35 }, "l'"), measureToRun({ x: 60, y: 620, width: 500, height: 35 }, "every point on the ray → a point on l'")];
    const r = locateQuote(runs, "l'", { x: 610, y: 425 });
    expect(r).toHaveLength(1);
    expect(r[0].x).toBe(600);
    expect(r[0].y).toBeCloseTo(400);
  });
});
