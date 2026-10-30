// The board grammar in the kit: one content size for every label, value, caption, table cell and calc
// line; ticks the only small text (never under 11px on screen).
import { describe, expect, it } from 'vitest';
import { metrics } from '../../src/desk/kit/kit';

describe('kit grammar: sizes', () => {
  it('labels and numerals share the content size; ticks are smaller but at least 11px', () => {
    for (const [scale, body] of [[0.5, 16], [1, 12], [0.8, 22], [1.4, 15]] as const) {
      const m = metrics(scale, body);
      expect(m.label).toBe(m.num);
      expect(m.labelPx).toBe(m.numPx);
      expect(m.tick).toBeLessThanOrEqual(m.num);
      expect(m.tick * m.s).toBeGreaterThanOrEqual(11 - 1e-9);
    }
  });
});
