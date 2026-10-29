// tests/desk/expr.test.ts
import { describe, it, expect } from 'vitest';
import { compile, compileVars, ExprError } from '../../src/desk/expr';

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

// Evidence C1 (draw benchmark): constant names with digits were lexed as name × number.
describe('identifiers with digits', () => {
  it('K2, n10, T0, rate0, s160 are one name each', () => {
    expect(compileVars('Vmax*x/(K2+x)', ['vmax', 'k2', 'x'])({ vmax: 10, k2: 4, x: 4 })).toBe(5);
    expect(compileVars('mu+sigma/sqrt(n10)', ['mu', 'sigma', 'n10'])({ mu: 2, sigma: 1, n10: 4 })).toBe(2.5);
    expect(compileVars('T0*(1+x^2/16)', ['t0', 'x'])({ t0: 2, x: 0 })).toBe(2);
    expect(compileVars('rate0+add', ['rate0', 'add'])({ rate0: 5, add: 5 })).toBe(10);
    expect(compileVars('exp(-x^2/(2*s160^2))', ['s160', 'x'])({ s160: 1, x: 0 })).toBe(1);
    expect(compileVars('q0-d', ['q0', 'd'])({ q0: 7, d: 2 })).toBe(5);
    expect(compileVars('a_1+1', ['a_1'])({ a_1: 1 })).toBe(2);
  });
  it('a digit-leading term still multiplies (2x, 3pi)', () => {
    expect(at('2x', 3)).toBe(6);
    expect(at('3pi', 0)).toBeCloseTo(3 * Math.PI);
  });
  it('x2 is a name, not x·2', () => {
    expect(() => compile('x2')).toThrow(ExprError);
  });
});

describe('if()', () => {
  it('if(c, a, b) picks a when c holds, else b', () => {
    const f = compileVars('if(r<0.8, 1, 0)', ['r']);
    expect(f({ r: 0.5 })).toBe(1);
    expect(f({ r: 0.9 })).toBe(0);
    expect(at('if(x>=0, x, -x)', -3)).toBe(3);
  });
  it('needs three arguments', () => {
    expect(() => compile('if(x>0, 1)')).toThrow(ExprError);
  });
});

describe('integral()', () => {
  it('integral(f, a, b) integrates over t', () => {
    expect(at('integral(t^2, 0, 3)', 0)).toBeCloseTo(9, 9);
    expect(at('integral(sin(t), 0, pi)', 0)).toBeCloseTo(2, 9);
    expect(at('integral(x*t, 0, 1)', 4)).toBeCloseTo(2, 9);
  });
  it('integral(f, u, a, b) names its variable', () => {
    expect(at('integral(u*x, u, 0, 2)', 3)).toBeCloseTo(6, 9);
    expect(compileVars('integral(t*s, s, 0, 1)', ['t'])({ t: 4 })).toBeCloseTo(2, 9);
  });
  it('handles an integrable endpoint singularity', () => {
    expect(at('integral(1/sqrt(t), 0, 1)', 0)).toBeCloseTo(2, 6);
  });
  it('the true pendulum period at 60° is 1.0732 × the small-angle one', () => {
    const r = at('2/pi*integral(1/sqrt(1-sin(rad(x)/2)^2*sin(t)^2), 0, pi/2)', 60);
    expect(r.toFixed(4)).toBe('1.0732');
  });
  it('reversed limits flip the sign; equal limits give 0', () => {
    expect(at('integral(1, 2, 0)', 0)).toBeCloseTo(-2, 9);
    expect(at('integral(t, 1, 1)', 0)).toBe(0);
  });
  it('rejects a bad call', () => {
    expect(() => compile('integral(t, 0)')).toThrow(ExprError);
    expect(() => compile('integral(t, 1, 0, 1)')).toThrow(ExprError);
  });
});
