import { describe, it, expect } from 'vitest';
import { readFormat } from '../../src/values/format';
import { fmtValue } from '../../src/svgboard/data';
import { parseVal } from '../../src/script/parseValues';

describe('a number format in any notation the model writes', () => {
  it('reads decimal counts, pictures, printf and percent pictures', () => {
    expect(readFormat('2')).toEqual({ dp: 2, percent: false });
    expect(readFormat('0')).toEqual({ dp: 0, percent: false });
    expect(readFormat('0.00')).toEqual({ dp: 2, percent: false });
    expect(readFormat('#,##0.0')).toEqual({ dp: 1, percent: false });
    expect(readFormat('.2f')).toEqual({ dp: 2, percent: false });
    expect(readFormat('%.1f')).toEqual({ dp: 1, percent: false });
    expect(readFormat('0%')).toEqual({ dp: 0, percent: true });
    expect(readFormat('0.0%')).toEqual({ dp: 1, percent: true });
    expect(readFormat('abc')).toBeNull();
    expect(readFormat(null)).toBeNull();
  });
  it('the board writes the decimals asked for (OpenStax stats p.379: "0.667" under data-fmt="0.00")', () => {
    expect(fmtValue(2 / 3, '0.00')).toBe('0.67');
    expect(fmtValue(0.69968, '0.0000')).toBe('0.6997');
    expect(fmtValue(2.0412, '.2f')).toBe('2.04');
    expect(fmtValue(0.95, '0%')).toBe('95');
    // No format, or one it cannot read: about 3 significant figures, trailing zeros dropped.
    expect(fmtValue(0.7, 'nonsense')).toBe('0.7');
    expect(fmtValue(2 / 3)).toBe('0.667');
  });
  it('{{val fmt=}} takes the same notations; a percent picture says a percent', () => {
    expect(parseVal({ id: 'z', fmt: '0.00' })).toMatchObject({ fmt: 2 });
    expect(parseVal({ id: 'z', fmt: '.2f' })).toMatchObject({ fmt: 2 });
    expect(parseVal({ id: 'z', fmt: '0%' })).toMatchObject({ fmt: 0, as: 'percent' });
    expect(parseVal({ id: 'z', fmt: 'x' })).toBeNull();
  });
});
