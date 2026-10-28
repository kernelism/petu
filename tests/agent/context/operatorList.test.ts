import { describe, it, expect } from 'vitest';
import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { paintedFromOperatorList } from '../../../src/agent/context/operatorList';

// A 200×100 pt page; pdf.js viewport at scale 1 flips y: [1,0,0,-1,0,100].
const VT = [1, 0, 0, -1, 0, 100];
const O = OPS as unknown as Record<string, number>;
const run = (ops: [number, unknown[]][]) => paintedFromOperatorList({ fnArray: ops.map((o) => o[0]), argsArray: ops.map((o) => o[1]) }, O, VT, 200, 100);

describe('paintedFromOperatorList', () => {
  it('maps a stroked path through the CTM to model coords', () => {
    const { paths } = run([
      [O.transform, [1, 0, 0, 1, 20, 10]],
      [O.constructPath, [[O.moveTo, O.lineTo], [0, 0, 100, 0]]],
      [O.stroke, []],
    ]);
    expect(paths).toHaveLength(1);
    expect(paths[0].paint).toBe('stroke');
    expect(paths[0].ops).toBe('ML');
    // (20,10) pt → x 100, y (100-10)/100 → 900; (120,10) → x 600.
    expect(paths[0].pts[0].x).toBeCloseTo(100);
    expect(paths[0].pts[0].y).toBeCloseTo(900);
    expect(paths[0].pts[1].x).toBeCloseTo(600);
  });

  it('restores the CTM on restore', () => {
    const { paths } = run([
      [O.save, []],
      [O.transform, [1, 0, 0, 1, 50, 0]],
      [O.restore, []],
      [O.constructPath, [[O.moveTo, O.lineTo], [0, 50, 10, 50]]],
      [O.stroke, []],
    ]);
    expect(paths[0].pts[0].x).toBeCloseTo(0);
    expect(paths[0].pts[0].y).toBeCloseTo(500);
  });

  it('turns a rectangle into 4 points', () => {
    const { paths } = run([[O.constructPath, [[O.rectangle], [10, 10, 40, 20]]], [O.fill, []]]);
    expect(paths[0].ops).toBe('R');
    expect(paths[0].pts).toHaveLength(4);
    expect(paths[0].paint).toBe('fill');
  });

  it('gives an image the unit square bbox under the CTM', () => {
    const { images } = run([[O.transform, [100, 0, 0, 50, 20, 30]], [O.paintImageXObject, ['img1', 100, 50]]]);
    expect(images).toHaveLength(1);
    const r = images[0].rect;
    expect(r.x).toBeCloseTo(100);
    expect(r.w).toBeCloseTo(500);
    expect(r.y).toBeCloseTo(200);
    expect(r.h).toBeCloseTo(500);
  });

  it('collapses a doubled moveTo (pdf-lib lines are "M M L")', () => {
    const { paths } = run([[O.constructPath, [[O.moveTo, O.moveTo, O.lineTo], [10, 50, 10, 50, 150, 50]]], [O.fillStroke, []]]);
    expect(paths[0].ops).toBe('ML');
    expect(paths[0].pts).toHaveLength(2);
  });

  it('thins a very long path but keeps its ends and extent', () => {
    const n = 5000;
    const ops = [O.moveTo, ...Array(n - 1).fill(O.lineTo)];
    const coords = Array.from({ length: n }, (_, i) => [i * 0.04, 50 + 40 * Math.sin(i / 50)]).flat();
    const { paths } = run([[O.constructPath, [ops, coords]], [O.stroke, []]]);
    const p = paths[0];
    expect(p.pts.length).toBeLessThan(500);
    expect(p.pts[0].x).toBeCloseTo(0);
    expect(p.pts[p.pts.length - 1].x).toBeCloseTo(((n - 1) * 0.04 / 200) * 1000);
    expect(Math.min(...p.pts.map((q) => q.y))).toBeCloseTo(100, -1);
  });

  it('drops a path ended without painting (clip)', () => {
    const { paths } = run([[O.constructPath, [[O.rectangle], [0, 0, 200, 100]]], [O.endPath, []]]);
    expect(paths).toHaveLength(0);
  });
});

describe('paintedFromOperatorList bounds', () => {
  it('keeps at most MAX_IMAGES images', async () => {
    const { MAX_IMAGES } = await import('../../../src/agent/context/operatorList');
    const ops: [number, unknown[]][] = Array.from({ length: MAX_IMAGES + 500 }, () => [O.paintImageXObject, ['img', 1, 1]]);
    expect(run(ops).images).toHaveLength(MAX_IMAGES);
  });
});
