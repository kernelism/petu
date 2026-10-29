import { describe, it, expect } from 'vitest';
import { softmax, normalize, l2, cumsum, rank, argmax, dot, wavg, matmul, applyOp } from '../../src/desk/kit/ops';
import { reduce } from '../../src/desk/kit/compute';
import { camFor } from '../../src/desk/scene/camera';
import { placeRel, overlaps } from '../../src/desk/scene/place';
import { routeLink, at } from '../../src/desk/scene/route';

const close = (a: number[], b: number[]) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], 4));

describe('standard ops (known values)', () => {
  it('softmax, with temperature', () => {
    close(softmax([1, 2, 3]), [0.09003, 0.24473, 0.66524]);
    close(softmax([1, 2, 3], 2), [0.18632, 0.30720, 0.50648]);
    close(softmax([1000, 1000]), [0.5, 0.5]); // stable
    expect(softmax([0.2, 3, 0.5]).reduce((a, b) => a + b)).toBeCloseTo(1, 12);
  });
  it('normalize, l2, cumsum, rank, argmax', () => {
    close(normalize([2, 1, 1]), [0.5, 0.25, 0.25]);
    close(l2([3, 4]), [0.6, 0.8]);
    expect(cumsum([1, 2, 3, 4])).toEqual([1, 3, 6, 10]);
    expect(rank([10, 30, 20, 30])).toEqual([4, 1, 3, 1]);
    expect(argmax([3, 9, 2, 9])).toBe(2);
  });
  it('dot, weighted average, matrix multiply', () => {
    expect(dot([1, 2, 3], [4, 5, 6])).toBe(32);
    expect(wavg([0.5, 0.25, 0.25], [10, 20, 40])).toBeCloseTo(20, 12);
    expect(wavg([2, 1, 1], [10, 20, 40])).toBeCloseTo(20, 12);
    expect(matmul([[1, 2], [3, 4]], [[5, 6], [7, 8]])).toEqual([[19, 22], [43, 50]]);
    expect(matmul([[1, 2, 3]], [[1, 0, 1]])).toEqual([[4]]); // a row times a vector laid as a column
    expect(applyOp('matmul', [[1, 2]], [[1, 2, 3]])).toMatch(/inner sizes/);
    expect(applyOp('softmax', [[0, 0], [1, 1]])).toEqual([[0.5, 0.5], [0.5, 0.5]]); // row by row
    expect(applyOp('normalize', [[1, -1]])).toMatch(/sum to 0/);
  });
  it('calc reductions: wavg and argmax with their expansions', () => {
    const w = reduce('wavg', [0.5, 0.5], [10, 30]);
    expect(w.value).toBe(20);
    expect(w.parts.join('')).toBe('0.5·10 + 0.5·30 = ');
    const a = reduce('argmax', [1, 7, 3]);
    expect(a.result).toBe('2');
  });
});

describe('scene placement and camera', () => {
  it('places beside an anchor without overlapping anything, and below with left edges aligned', () => {
    const a = { x: 100, y: 100, w: 80, h: 30 };
    const r = placeRel(60, 30, 'right', a, [a], { gap: 20, seed: 'n1' });
    expect(r.x).toBeGreaterThan(a.x + a.w);
    expect(Math.abs(r.y + r.h / 2 - (a.y + a.h / 2))).toBeLessThan(10);
    const b = placeRel(60, 30, 'below', a, [a], { gap: 20, seed: 'n2' });
    expect(b.y).toBeGreaterThan(a.y + a.h);
    expect(b.x).toBe(a.x);
    // something already in the way: the solver steps around it
    const block = { x: 180, y: 90, w: 200, h: 60 };
    const c = placeRel(60, 30, 'right', a, [a, block], { gap: 20, seed: 'n3' });
    expect(overlaps(c, block)).toBe(false);
  });
  it('the camera stays put while the ink is in view, pans minimally, zooms out only as far as it must', () => {
    const win = { w: 800, h: 600, s: 1 };
    expect(camFor({ x: 0, y: 0, z: 1 }, { x: 100, y: 100, w: 100, h: 100 }, null, win)).toBeNull();
    const c = camFor({ x: 0, y: 0, z: 1 }, { x: 900, y: 100, w: 100, h: 50 }, null, win)!;
    expect(c.z).toBe(1);
    expect(c.x).toBeGreaterThan(200);
    const z = camFor({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, w: 1100, h: 100 }, null, win)!;
    expect(z.z).toBeLessThan(1);
    expect(z.z).toBeGreaterThanOrEqual(0.62);
  });
  it('links in one row arc over it; others bend around content', () => {
    const a = { x: 0, y: 0, w: 40, h: 20 }, b = { x: 300, y: 0, w: 40, h: 20 };
    const q = routeLink(a, b, [{ x: 140, y: 0, w: 40, h: 20 }], 4, 4);
    expect(at(q, 0.5).y).toBeLessThan(0);
  });
});
