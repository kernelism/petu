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

  it('sideways text (a rotated axis label) gets a tall box where it is drawn, not a wide one', () => {
    // Text rotated 90° counter-clockwise in PDF space: baseline runs up the page.
    const [r] = itemsToRuns([{ str: 'Accuracy', transform: [0, 20, -20, 0, 100, 200], width: 80, height: 20 }], [1, 0, 0, -1, 0, 560], 800, 560);
    expect(r.rect.w).toBeLessThan(r.rect.h);
    expect(r.rect.h).toBeCloseTo((80 / 560) * 1000, 3);
    // Baseline origin at viewport (100, 360); the text rises to y = 280; glyphs extend left of x = 100.
    expect(r.rect.x + r.rect.w).toBeCloseTo(((100 + 0.24 * 20) / 800) * 1000, 3);
    expect(r.rect.y).toBeCloseTo((280 / 560) * 1000, 3);
  });

  it('attaches a CSS font from textContent.styles', () => {
    const runs = itemsToRuns(
      [{ str: 'Hi', transform: [20, 0, 0, 20, 80, 500], width: 40, height: 20, fontName: 'f1' }],
      [1, 0, 0, -1, 0, 560], 800, 560,
      { f1: { fontFamily: 'Times-Bold, serif' } },
    );
    expect(runs[0].font).toMatch(/bold/);
    expect(runs[0].font).toContain('Times-Bold, serif');
  });
  it('leaves font undefined when styles are unknown', () => {
    const runs = itemsToRuns([{ str: 'Hi', transform: [20, 0, 0, 20, 80, 500], width: 40, height: 20 }], [1, 0, 0, -1, 0, 560], 800, 560);
    expect(runs[0].font).toBeUndefined();
  });
});
