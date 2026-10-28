import { describe, expect, it } from 'vitest';
import { joinWords } from '../../src/ui/Caption';

describe('joinWords', () => {
  it('joins words with single spaces', () => {
    expect(joinWords(['the', 'epipolar', 'line'])).toBe('the epipolar line');
  });
  it('glues punctuation-only tokens to the previous word', () => {
    expect(joinWords(['x', '.'])).toBe('x.');
    expect(joinWords(['so', ',', 'then', '?!'])).toBe('so, then?!');
    expect(joinWords(['wait', '…', 'yes', ';', 'no', ':'])).toBe('wait… yes; no:');
  });
  it('handles empty input and leading punctuation', () => {
    expect(joinWords([])).toBe('');
    expect(joinWords(['.', 'a'])).toBe('. a');
  });
  it('ignores empty tokens', () => {
    expect(joinWords(['a', '', 'b'])).toBe('a b');
  });
});
