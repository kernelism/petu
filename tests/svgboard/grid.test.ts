// A grid the engine fills by rule (src/svgboard/grid.ts): outer products, Punnett squares, a table from a formula.
import { describe, expect, it } from 'vitest';
import { newScope, resolveData } from '../../src/svgboard/data';
import { parseGroup } from '../../src/svgboard/sanitize';
import { joinLabels } from '../../src/svgboard/grid';
import { slideOut } from '../../src/svgboard/slide';

const scope = (k = 0) => { const sc = newScope(); sc.consts.k = k; sc.calcs = new Map(); return sc; };
const g = (attrs: string) => parseGroup(`<g id="sep" ${attrs}/>`) as Element;
const cells = (el: Element) => Array.from(el.querySelectorAll('text')).map((t) => t.textContent);
const line = (el: Element) => el.querySelector('[data-grid-line]')?.textContent ?? null;

describe('data-grid', () => {
  it('an outer product of 1/3s fills 1/9 cell by cell, framing the cell and its row and column', () => {
    const sc = scope(0), el = g('data-grid="mul" data-rows="1/3,1/3,1/3" data-cols="1/3,1/3,1/3"');
    expect(resolveData(el, sc)).toEqual([]);
    expect(cells(el).filter((t) => t === '1/9')).toHaveLength(0);
    expect(el.querySelector('[data-grid-frame]')).toBeNull();
    sc.consts.k = 4;
    resolveData(el, sc);
    expect(cells(el).filter((t) => t === '1/9')).toHaveLength(4);
    expect(line(el)).toBe('1/3 × 1/3 = 1/9');
    expect(el.querySelectorAll('rect[fill-opacity="0.14"]')).toHaveLength(2); // row 2's and column 1's headers
    expect(slideOut(sc, 'sep', 'out[2][2]')).toBeCloseTo(1 / 9);
    expect(sc.values.filter((v) => v.of === 'sep').length % 9).toBe(0);
  });

  it('a calc matrix with named headers: the Gaussian table, working "y = …, x = …: value"', () => {
    const G = [-1, 0, 1].map((y) => [-1, 0, 1].map((x) => Math.exp(-(x * x + y * y) / 2) / (2 * Math.PI)));
    const sc = scope(5); sc.calcs!.set('g', { G, xs: [-1, 0, 1] });
    const el = g('data-grid="g.G" data-rows="g.xs" data-cols="g.xs" data-rows-name="y" data-cols-name="x" data-fmt="3"');
    resolveData(el, sc);
    expect(line(el)).toBe('y = 0, x = 0: 0.159');
    expect(cells(el)).toContain('0.097');
    expect(cells(el)).toContain('y \\ x');
  });

  it('a Punnett square joins the alleles, capital first, and registers no numbers', () => {
    const sc = scope(4), el = g('data-grid="join" data-rows="A,a" data-cols="A,a"');
    resolveData(el, sc);
    expect(cells(el).filter((t) => /^[Aa]{2}$/.test(t ?? ''))).toEqual(['AA', 'Aa', 'Aa', 'aa']);
    expect(line(el)).toBe('a + a → aa');
    expect(sc.calcs!.has('sep')).toBe(false);
    expect(joinLabels('aB', 'Ab')).toBe('AaBb');
  });

  it('negative headers are bracketed in the working; a wrong header count fails, never draws', () => {
    const sc = scope(1), el = g('data-grid="mul" data-rows="-1,2" data-cols="3,4"');
    resolveData(el, sc);
    expect(line(el)).toBe('(−1) × 3 = −3');
    expect(resolveData(g('data-grid="1,2;3,4" data-rows="a,b,c"'), scope(1)).map((e) => JSON.stringify(e)).join(' ')).toMatch(/3 labels for 2 rows/);
    expect(resolveData(g('data-grid="mul" data-rows="1,2"'), scope(1)).map((e) => JSON.stringify(e)).join(' ')).toMatch(/data-rows and data-cols/);
  });

  it('shrinks the cells so a wide grid fits the board', () => {
    const sc = scope(0), el = g('data-grid="mul" data-rows="1,2" data-cols="1,2,3,4,5,6,7,8,9,10,11,12" data-cell="60"');
    resolveData(el, sc);
    const xs = Array.from(el.querySelectorAll('rect')).map((r) => Number(r.getAttribute('x')) + Number(r.getAttribute('width')));
    expect(Math.max(...xs)).toBeLessThanOrEqual(552.01);
  });
});
