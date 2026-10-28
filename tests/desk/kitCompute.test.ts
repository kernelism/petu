// tests/desk/kitCompute.test.ts — the visual kit's arithmetic: every number the board shows.
import { describe, it, expect } from 'vitest';
import * as C from '../../src/desk/kit/compute';

const W = (w: C.Mat, extra: Partial<C.WinSpec> = {}): C.WinSpec => ({ kind: 'weights', w, ...extra } as C.WinSpec);

describe('values', () => {
  it('parses rows with ; and cells with commas or spaces, all the same length', () => {
    expect(C.parseVals('1,2,3;4,5,6')).toEqual([[1, 2, 3], [4, 5, 6]]);
    expect(C.parseVals('1 2; −3 4')).toEqual([[1, 2], [-3, 4]]);
    expect(C.parseVals('1,2;3')).toBeNull();
    expect(C.parseVals('1,x')).toBeNull();
    expect(C.parseVals('1/9,1/9;-1/4,2^3')).toEqual([[1 / 9, 1 / 9], [-0.25, 8]]);
    expect(C.parseVals(Array(13).fill('1').join(','))).toBeNull();
  });
  it('formats with a true minus, no trailing zeros, ~2 decimals', () => {
    expect(C.fmt(-27)).toBe('−27');
    expect(C.fmt(0.3333)).toBe('0.33');
    expect(C.fmt(1 / 3)).toBe('0.33'); // computed values are decimals
    expect(C.fmt(400 / 3)).toBe('133.3'); // a pixel mean is never "400/3"
    expect(C.fmt(40 / 3)).toBe('13.3');
    expect(C.fmt(12.54)).toBe('12.5');
    expect(C.fmt(2.5)).toBe('2.5');
    expect(C.fmt(-0)).toBe('0');
    expect(C.fmt(1 / 3, 3)).toBe('0.333');
    expect(C.term(-1)).toBe('(−1)');
    // only literal fractions the model wrote keep that form (frac = true)
    expect(C.fmt(1 / 9, undefined, true)).toBe('1/9');
    expect(C.fmt(-2 / 3, undefined, true)).toBe('−2/3');
    expect(C.term(-1 / 4, undefined, true)).toBe('(−0.25)');
    expect(C.fmt(0.25)).toBe('0.25');
    expect(C.fmt(0.123)).toBe('0.12');
    expect(C.fmt(5 / 7)).toBe('0.71');
    expect(C.fractions([3, 1.4, 5 / 7, 1 / 3])).toBe(false); // a column never mixes 1/3 with 0.71
    expect(C.fractions([1 / 9, 1 / 9, 0])).toBe(true);
  });
  it('a mean (and a fn of the form (A)/B) shows the sum before the division', () => {
    const e = C.reduce('mean', [106, 100, 994]);
    expect([...e.parts, e.result].join('')).toBe('(106 + 100 + 994) / 3 = 1200 / 3 = 400');
    const m = C.reduce('mean', [100, 100, 200]);
    expect([...m.parts, m.result].join('')).toBe('(100 + 100 + 200) / 3 = 400 / 3 = 133.3');
    const w = C.winCell([[1, 2, 4]], 0, 0, { kind: 'fn', kr: 1, kc: 3, src: '(a+b+c)/3', fn: C.compileFn('(a+b+c)/3', ['a', 'b', 'c'])! });
    expect([...w!.parts, w!.result].join('')).toBe('(1 + 2 + 4) / 3 = 7 / 3 = 2.33');
    // (A)/B*C: the division is not the last step, so no "A / B" step (it would read 350 for B*C)
    expect(C.divisionStep('(b-a)/((a+b)/2)*100', { a: 4, b: 3 }, ['a', 'b'])).toBeNull();
    expect(C.divisionStep('(b-a)/((a+b)/2)', { a: 4, b: 3 }, ['a', 'b'])).toBe('−1 / 3.5 = ');
    expect(C.divisionStep('(a+b)/n', { a: 4, b: 3, n: 2 }, ['a', 'b', 'n'])).toBe('7 / 2 = ');
  });
  it('kernel weights written as fractions stay fractions in the expansion; the result is a decimal', () => {
    const w = [[1 / 9, 1 / 9, 1 / 9]];
    const e = C.winCell([[100, 100, 200]], 0, 0, { kind: 'weights', w, frac: true });
    expect([...e!.parts, e!.result].join('')).toBe('1/9·100 + 1/9·100 + 1/9·200 = 44.4');
  });
  it('forgiving expressions: comparisons in parentheses, min/max/mean of several values, degrees', () => {
    expect(C.compileFn('x+(x==2)')!({ x: 2 })).toBe(3);
    expect(C.compileFn('(x>12)*100', ['x'])!({ x: 13 })).toBe(100);
    expect(C.compileFn('min(a,b)', ['a', 'b'])!({ a: 3, b: 2 })).toBe(2);
    expect(C.compileFn('max(x, 0) + mean(1,2,3)')!({ x: -4, max: 99 })).toBe(2);
    expect(C.compileFn('sin(rad(30))')!({})).toBeCloseTo(0.5, 12);
    expect(C.compileFn('deg(atan(1))')!({})).toBeCloseTo(45, 12);
    expect(C.substitute('min(a,b)', { a: 3, b: 2 })).toBe('min(3, 2)');
    expect(C.substitute('max(x,0)', { x: 3, max: 7 })).toBe('max(3, 0)');
  });
  it('seeded noise: rand() and randn() repeat for one seed, differ across seeds', () => {
    const f = (seed: string) => { const fn = C.compileFn('rand() + 10*randn()', ['r', 'c'], C.seededRand(seed))!; return [fn({}), fn({}), fn({})]; };
    expect(f('g')).toEqual(f('g'));
    expect(f('g')).not.toEqual(f('h'));
    expect(C.compileFn('rand()', ['x'])).toBeNull(); // no generator: not in the language
    const u = C.compileFn('rand()', ['r'], C.seededRand('u'))!;
    const xs = Array.from({ length: 2000 }, () => u({}));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
    const n = C.compileFn('randn()', ['r'], C.seededRand('n'))!;
    const ys = Array.from({ length: 4000 }, () => n({}));
    const mean = ys.reduce((a, b) => a + b, 0) / ys.length, sd = Math.sqrt(ys.reduce((a, b) => a + (b - mean) ** 2, 0) / ys.length);
    expect(Math.abs(mean)).toBeLessThan(0.08);
    expect(Math.abs(sd - 1)).toBeLessThan(0.08);
  });
});

describe('maps, zips and reductions', () => {
  it('maps with the source stats as constants', () => {
    const f = C.compileFn('(x-mean)/std')!;
    const z = C.mapMat([[2, 4, 3, 5]], f)[0];
    expect(z.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 9);
    expect(Math.sqrt(z.reduce((a, b) => a + b * b, 0) / 4)).toBeCloseTo(1, 9);
  });
  it('zips two blocks of the same shape, refuses others', () => {
    const f = C.compileFn('(x-y)^2')!;
    expect(C.zipMat([[2, 4]], [[5, 9]], f)).toEqual([[9, 25]]);
    expect(C.zipMat([[1]], [[1, 2]], f)).toBeNull();
  });
  it('reduces with an expansion and the engine’s result', () => {
    expect(C.reduce('sum', [9, 25, 16, 36])).toMatchObject({ result: '86', value: 86 });
    expect(C.reduce('sum', [1, -2]).parts.join('')).toBe('1 + (−2) = ');
    expect(C.reduce('mean', [1, 2, 3, 4]).value).toBe(2.5);
    expect(C.reduce('max', [1, 7, 3]).value).toBe(7);
    expect(C.reduce('norm', [3, 4]).value).toBe(5);
    expect(C.reduce('count', [0, 1, 1, 0, 1])).toMatchObject({ value: 3, result: '3/5' });
    expect(C.reduce('dot', [1, 2], [3, 4])).toMatchObject({ value: 11, parts: ['1·3 + ', '2·4', ' = '] });
    expect(C.reduce('cos', [1, 2], [2, 4]).value).toBeCloseTo(1, 12);
  });
  it('writes a fn with values substituted, as a board would', () => {
    expect(C.substitute('(x-y)^2', { x: 2, y: 5 })).toBe('(2 − 5)²');
    expect(C.substitute('2*a-pa', { a: 3, pa: -1 })).toBe('2·3 − (−1)');
    expect(C.substitute('abs((b-a)/a)', { a: 10, b: 8 })).toBe('|(8 − 10) / 10|');
  });
  it('compares (1 or 0) for counts and selections', () => {
    const f = C.compileFn('x==7')!;
    expect([6, 7, 8].map((x) => f({ x }))).toEqual([0, 1, 0]);
    expect(C.compileFn('x>=2')!({ x: 2 })).toBe(1);
  });
});

describe('sliding windows', () => {
  const img = [[10, 10, 10, 90, 90, 90], [10, 10, 10, 90, 90, 90], [10, 10, 10, 90, 90, 90]];
  const k = [[-1, 0, 1], [-1, 0, 1], [-1, 0, 1]];
  it('valid: one output per position the window fits, sum of products', () => {
    expect(C.winApply(img, W(k))).toEqual([[0, 240, 240, 0]]);
    const e = C.winCell(img, 0, 1, W(k))!;
    expect(e.result).toBe('240');
    expect(e.parts.join('')).toContain('(−1)·10 + 0·10 + 1·90');
  });
  it('flip turns correlation into a flipped kernel', () => {
    expect(C.winApply(img, W(k, { flip: true }))).toEqual([[0, -240, -240, 0]]);
  });
  it('same: zero padding, one output per input cell', () => {
    const out = C.winApply([[1, 2, 3]], W([[1, 1, 1]], { same: true }))!;
    expect(out).toEqual([[3, 6, 5]]);
    const wv = C.winValues([[1, 2, 3]], 0, 0, W([[1, 1, 1]], { same: true }))!;
    expect(wv.inside).toEqual([false, true, true]);
  });
  it('a reduction window and a fn window (cells a b c…, row-major)', () => {
    expect(C.winApply([[1, 2, 3, 4]], { kind: 'reduce', kr: 1, kc: 2, op: 'mean' })).toEqual([[1.5, 2.5, 3.5]]);
    const fn = C.compileFn('(d-c)/(b-a)', C.WIN_LETTERS.slice(0, 4))!;
    // a 2×2 window over rows (t; y): average velocity
    expect(C.winApply([[0, 1, 2], [0, 15, 20]], { kind: 'fn', kr: 2, kc: 2, src: '(d-c)/(b-a)', fn })).toEqual([[15, 5]]);
  });
  it('stride skips positions; a window bigger than the grid has no valid output', () => {
    expect(C.winApply([[1, 2, 3, 4]], { kind: 'reduce', kr: 1, kc: 2, op: 'max', stride: 2 })).toEqual([[2, 4]]);
    expect(C.winApply([[1, 2]], W([[1, 1, 1]]))).toBeNull();
  });
  it('a sweep visits unfilled cells in reading order, ~0.45s each within 1.5–8s, or dur', () => {
    expect(C.sweepOrder([[true, false], [false, false]])).toEqual([[0, 1], [1, 0], [1, 1]]);
    expect(C.sweepStepMs(2)).toBe(750);
    expect(C.sweepStepMs(4)).toBe(450);
    expect(C.sweepStepMs(100)).toBe(80);
    expect(C.sweepStepMs(5, 5)).toBe(1000);
  });
});

describe('lines through data', () => {
  it('least squares recovers a line exactly, and labels it', () => {
    const l = C.lstsq([0, 1, 2, 3].map((x) => ({ x, y: 2 * x + 1 })))!;
    expect(C.slopeOf(l)!.m).toBeCloseTo(2, 9);
    expect(C.slopeOf(l)!.k).toBeCloseTo(1, 9);
    expect(C.lineLabel(l)).toBe('y = 2x + 1');
  });
  it('a vertical fit, and a line through two points', () => {
    expect(C.lineLabel(C.lstsq([{ x: 3, y: 0 }, { x: 3, y: 5 }])!)).toBe('x = 3');
    const l = C.lineThrough({ x: 0, y: 0 }, { x: 1, y: 1 })!;
    expect(C.distTo({ x: 0, y: 2 }, l)).toBeCloseTo(Math.SQRT2, 12);
    expect(C.footOn({ x: 0, y: 2 }, l)).toEqual({ x: expect.closeTo(1, 9), y: expect.closeTo(1, 9) });
  });
  it('inliers are the points within the band', () => {
    const l = C.lineThrough({ x: 0, y: 0 }, { x: 10, y: 0 })!;
    expect(C.inliers([{ x: 1, y: 0.5 }, { x: 2, y: -0.5 }, { x: 3, y: 2 }], l, 0.5)).toEqual([0, 1]);
  });
  it('nice ticks', () => {
    expect(C.ticks(0, 10)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(C.ticks(0.2, 9.2, 4)).toEqual([2, 4, 6, 8]);
  });
});
