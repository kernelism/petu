import { describe, it, expect } from 'vitest';
import { itemsToRuns } from '../../src/pdf/textRuns';

describe('itemsToRuns', () => {
  it('maps pdf.js items to model-coord rects above the baseline', () => {
    const runs = itemsToRuns(
      [
        { str: 'Hi', transform: [20, 0, 0, 20, 80, 500], width: 40, height: 20 },
        { str: '  ', transform: [20, 0, 0, 20, 10, 400], width: 5, height: 20 },
      ],
      [1, 0, 0, -1, 0, 560], 800, 560,
    );
    expect(runs).toHaveLength(1);
    const { rect } = runs[0];
    expect(rect.x).toBeCloseTo(100, 5);
    expect(rect.w).toBeCloseTo(50, 5);
    const baseline = (60 / 560) * 1000;
    expect(rect.y).toBeGreaterThan(baseline - 40);
    expect(rect.y).toBeLessThan(baseline);
  });
});
