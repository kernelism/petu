import { describe, expect, it } from 'vitest';
import { teachMetrics } from '../../scripts/eval/metrics';
import { QSETS, validateSet } from '../../scripts/eval/questions';

describe('teachMetrics', () => {
  it('counts calcs, bound numbers, windows, steps and the numerals the narration typed', () => {
    const chunks = [{ t: 0, d: '<plan>3 steps, 25 cells</plan> {{calcsrc id=img export const f = 1;}} {{svg <g id="a" data-slide="img.f"><text data-val="img.f">{}</text></g>}} The sum is {{val conv.out[0]}}. {{tween k=2 dur=0.8}} Then 7 plus 8 is 15.' }];
    const events = [{ t: 'gate', k: '1', unit: 'beat', result: 'fail', action: 'drop', flags: [{ check: 'unbound', detail: '15 is not computed' }, { check: 'skip', detail: 'calc img failed: x' }] }];
    const m = teachMetrics({ chunks, events, timings: [] } as never);
    expect(m).toEqual({ calcs: 1, calcFailed: 1, vals: 1, dataVals: 1, slides: 1, pageSlides: 0, grids: 0, series: 0, tweens: 1, stepped: true, typedNumbers: 3, numberFlags: 1 });
  });
});

describe('question set teach', () => {
  it('is dev only, on known decks, one page per question', () => {
    expect(QSETS.teach).toHaveLength(12);
    expect(QSETS.teach.every((q) => q.split === 'dev')).toBe(true);
    expect(validateSet(QSETS.teach)).toEqual([]);
  });
  it('counts windows over a page image apart (Phase 3)', () => {
    const m = teachMetrics({ chunks: [{ t: 0, d: '{{svg <g id="eye" data-slide="#i1" data-kernel="b.k"/>}} {{svg <g id="c" data-slide="img.f"/>}}' }], events: [], timings: [] } as never);
    expect([m.slides, m.pageSlides]).toEqual([2, 1]);
  });
});
