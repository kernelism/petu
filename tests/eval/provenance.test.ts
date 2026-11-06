// Check (b), measured offline (scripts/eval/provenance.ts): is a calc's data the document's, or invented?
import { describe, expect, it } from 'vitest';
import { calcData, fromDocument } from '../../scripts/eval/provenance';

describe('calcData', () => {
  it('reads array literals of 3+ numbers from wire calcs and raw ones, not scalars or short pairs', () => {
    const wire = '{{calcsrc id=box &#10;const a = [[0,3,6],[3,6,9]];&#10;export const k = 2;}} <calc id="r">export const r = [10, 40, 1/2]; const p = [1, 2];</calc>';
    expect(calcData(wire).map(({ id, nums }) => ({ id, nums }))).toEqual([{ id: 'box', nums: [0, 3, 6, 3, 6, 9] }, { id: 'r', nums: [10, 40, 0.5] }]);
    expect(calcData(wire)[1].code).toContain('export const r');
  });
  it('data is the document\'s when most of its distinct numbers are in it', () => {
    expect(fromDocument([2, 4, 4, 4, 5, 5, 7, 9], new Set([2, 4, 5, 7, 9]))).toBe(true);
    expect(fromDocument([0, 3, 6, 9, 12], new Set([0, 1]))).toBe(false);
  });
});
