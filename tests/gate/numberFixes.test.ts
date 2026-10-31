// A spoken number the board contradicts is said as the board's value (check.ts numberFixes).
import { describe, expect, it } from 'vitest';
import { namedBefore, numberFixes } from '../../src/gate/check';
import { tokenize, type Word } from '../../src/gate/segment';
import type { Value } from '../../src/gate/engine';
import { valueLabel } from '../../src/svgboard/data';

const words = (t: string): Word[] => tokenize(t).filter((x): x is Word => x.kind === 'word');
const computed = (v: number, label?: string): Value => ({ v, source: 'computed', of: 'svg', beat: 1, ...(label ? { label } : {}) });

describe('numberFixes', () => {
  it('a plain number said of a readout the board names is said as the board\'s value (founder lec09: "SSD is 155" beside SSD = 149)', () => {
    const w = words('Their differences are six, seven and eight, so SSD is 155. Then more.');
    expect(numberFixes(w, [computed(149, 'ssd')])).toMatchObject([{ from: '155', to: '149', of: 'svg' }]);
  });
  it('the label may sit a few words before, with "=" or "comes to"; a number in between breaks the link', () => {
    expect(numberFixes(words('so the SSD comes to 155 here'), [computed(149, 'ssd')])).toHaveLength(1);
    expect(numberFixes(words('SSD of the 3 pixels is 155'), [computed(149, 'ssd')])).toHaveLength(0);
  });
  it('a plain number with no readout named before it is never rewritten (it may be the page\'s own)', () => {
    expect(numberFixes(words('the page lists 155 samples'), [computed(149, 'ssd')])).toHaveLength(0);
    expect(numberFixes(words('and 155 again'), [computed(149)])).toHaveLength(0);
  });
  it('a number that already equals the readout stays; a hedged number within 5% of an unlabelled value is still fixed', () => {
    expect(numberFixes(words('so SSD is 149 exactly'), [computed(149, 'ssd')])).toHaveLength(0);
    expect(numberFixes(words('leaving about 92.9 after normalization'), [computed(91.8)])).toMatchObject([{ from: '92.9', to: '91.8' }]);
  });
  it('namedBefore: the label words directly or up to three words before the number', () => {
    const w = words('center output is 55');
    expect(namedBefore(w, 3, 'center output')).toBe(true);
    expect(namedBefore(w, 3, 'output')).toBe(true);
    expect(namedBefore(w, 3, 'median')).toBe(false);
  });
  it('valueLabel: the words a readout writes before its number', () => {
    expect(valueLabel('SSD = {}')).toBe('ssd');
    expect(valueLabel('center output: {}')).toBe('center output');
    expect(valueLabel('{} min')).toBeUndefined();
    expect(valueLabel('a very long label of many words here = {}')).toBeUndefined();
  });
});
