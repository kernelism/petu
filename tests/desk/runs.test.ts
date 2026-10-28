// tests/desk/runs.test.ts
import { describe, it, expect } from 'vitest';
import { measureToRun, regionRuns } from '../../src/desk/runs';
import { locateQuote } from '../../src/locate/locateQuote';

describe('region text runs', () => {
  it('a written text\'s bbox is already in region coords (no scaling)', () => {
    expect(measureToRun({ x: 100, y: 70, width: 50, height: 35 }, 'Fx')).toEqual({ text: 'Fx', rect: { x: 100, y: 70, w: 50, h: 35 } });
  });
  it('makes region text findable by locateQuote', () => {
    const runs = [measureToRun({ x: 600, y: 280, width: 24, height: 35 }, "l'"), measureToRun({ x: 60, y: 620, width: 500, height: 35 }, "every point on the ray → a point on l'")];
    const r = locateQuote(runs, "l'", { x: 610, y: 297 });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ x: 600, y: 280 });
  });
  it('no root, no runs', () => expect(regionRuns(null)).toEqual([]));
});
