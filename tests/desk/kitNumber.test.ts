// Values shown outside their block (scene chip values, link weights) read as the kit's own numbers.
import { describe, expect, it } from 'vitest';
import { kitNumber } from '../../src/desk/kit/kit';

describe('kitNumber: scene values use the kit number formatting', () => {
  it('a literal or a block without dp= shows the kit decimals, never padded', () => {
    expect(kitNumber(100)).toBe('100');
    expect(kitNumber(2.5)).toBe('2.5');
    expect(kitNumber(400 / 3)).toBe('133.3');
    expect(kitNumber(0.3)).toBe('0.3');
    expect(kitNumber(-4)).toBe('−4');
    expect(kitNumber(100, { kind: 'bars', src: { vals: [[100, 50]] }, vals: [[100, 50]] })).toBe('100');
  });
  it("respects the source block's dp=", () => {
    expect(kitNumber(100, { kind: 'bars', dp: 2, src: { vals: [[100]] }, vals: [[100]] })).toBe('100.00');
    expect(kitNumber(2.456, { kind: 'grid', dp: 1, src: { map: 'g', fn: 'x' } as never, vals: [[2.456]] })).toBe('2.5');
  });
  it('fractions only when the model wrote them', () => {
    const w = [[1 / 9, 1 / 9, 1 / 9]];
    expect(kitNumber(1 / 9, { kind: 'grid', src: { vals: w, frac: true }, vals: w })).toBe('1/9');
    expect(kitNumber(1 / 9, { kind: 'grid', src: { map: 'g', fn: 'x/9' } as never, vals: w })).toBe('0.11');
  });
  it('shares as percentages; nothing for a value that is not finite', () => {
    expect(kitNumber(0.25, { kind: 'shares', vals: [[0.25, 0.75]] })).toBe('25%');
    expect(kitNumber(NaN)).toBe('');
    expect(kitNumber(Infinity)).toBe('');
  });
});
