import { describe, it, expect } from 'vitest';
import { primes, takeSentences } from '../../src/ui/text';
import { joinWords } from '../../src/ui/Caption';

describe('primes', () => {
  it('renders symbol primes', () => {
    expect(primes("x'")).toBe('x′');
    expect(primes("l',")).toBe('l′,');
    expect(primes("(C')")).toBe('(C′)');
    expect(primes('x’ and l’')).toBe('x′ and l′');
    expect(primes("f''")).toBe('f″');
  });
  it('leaves contractions and possessives alone', () => {
    expect(primes("don't it's I'm")).toBe("don't it's I'm");
    expect(primes("students' notes")).toBe("students' notes");
  });
});

describe('takeSentences', () => {
  it('emits whole sentences only, and where the next one starts', () => {
    const w = ['So', 'x', 'is', 'here', '.', 'Then', 'the', 'line'];
    expect(takeSentences(w, 0, joinWords)).toEqual({ sentences: ['So x is here.'], from: 5 });
    expect(takeSentences([...w, 'ends', '?'], 5, joinWords)).toEqual({ sentences: ['Then the line ends?'], from: 10 });
  });
  it('handles end punctuation attached to words', () => {
    expect(takeSentences(['One.', 'Two!', 'three'], 0, joinWords).sentences).toEqual(['One.', 'Two!']);
  });
});
