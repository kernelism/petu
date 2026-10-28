// tests/desk/expr.test.ts
import { describe, it, expect } from 'vitest';
import { compile, ExprError } from '../../src/desk/expr';

const at = (src: string, x: number) => compile(src)(x);

describe('compile', () => {
  it('numbers, x, precedence and parentheses', () => {
    expect(at('1 + 2 * 3', 0)).toBe(7);
    expect(at('(1 + 2) * 3', 0)).toBe(9);
    expect(at('1/x', 4)).toBe(0.25);
    expect(at('10 - 4 - 3', 0)).toBe(3);
    expect(at('2.5e1', 0)).toBe(25);
  });
  it('power is right-associative and binds tighter than unary minus', () => {
    expect(at('2^3^2', 0)).toBe(512);
    expect(at('-x^2', 3)).toBe(-9);
    expect(at('2^-1', 0)).toBe(0.5);
    expect(at('x**2', 3)).toBe(9);
  });
  it('functions and pi', () => {
    expect(at('sin(pi/2)', 0)).toBeCloseTo(1);
    expect(at('cos(0) + exp(0) + log(1) + sqrt(4) + abs(-3)', 0)).toBeCloseTo(7);
    expect(at('π', 0)).toBeCloseTo(Math.PI);
  });
  it('implicit multiplication', () => {
    expect(at('2x', 3)).toBe(6);
    expect(at('2(x+1)', 3)).toBe(8);
    expect(at('x sin(pi/2)', 5)).toBeCloseTo(5);
    expect(at('(x)(x)', 4)).toBe(16);
  });
  it('unicode operators', () => {
    expect(at('6 × 2 ÷ 4 − 1', 0)).toBe(2);
  });
  it('rejects anything outside the grammar (no eval)', () => {
    for (const bad of ['', 'alert(1)', 'x.constructor', 'y', 'this', '1 +', '(1', 'sin x', '1;2', 'x[0]', '"a"', 'x,y', 'constructor']) {
      expect(() => compile(bad), bad).toThrow(ExprError);
    }
    expect(() => compile('1+'.repeat(80) + '1')).toThrow(ExprError);
    expect(() => compile('('.repeat(40) + 'x' + ')'.repeat(40))).toThrow(ExprError);
  });
  it('returns non-finite values instead of throwing (plot breaks the path there)', () => {
    expect(at('1/x', 0)).toBe(Infinity);
    expect(Number.isNaN(at('sqrt(x)', -1))).toBe(true);
  });
});
