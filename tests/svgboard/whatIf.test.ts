// What if (src/svgboard/whatIf.ts + slide.ts): an edited kernel redraws the window, never the answer's numbers.
import { describe, expect, it } from 'vitest';
import { newScope, resolveData } from '../../src/svgboard/data';
import { parseGroup } from '../../src/svgboard/sanitize';
import { slideOut } from '../../src/svgboard/slide';
import { readWeight } from '../../src/svgboard/whatIf';

const IMG = Array.from({ length: 4 }, (_, r) => Array.from({ length: 4 }, (_, c) => 4 * r + c + 1));
const scope = (k: number) => { const sc = newScope(); sc.consts.k = k; sc.calcs = new Map([['img', { f: IMG, k: [[1, 0], [0, 0]] }]]); return sc; };
const win = () => parseGroup('<g id="conv" data-slide="img.f" data-kernel="img.k" data-step="k" data-origin="20,60" data-cell="36"/>') as Element;

describe('what if', () => {
  it('kernel cells carry their index for the editor', () => {
    const el = win(); resolveData(el, scope(1));
    expect(Array.from(el.querySelectorAll('rect[data-kcell]')).map((r) => r.getAttribute('data-kcell'))).toEqual(['0,0', '0,1', '1,0', '1,1']);
  });

  it('an edited weight redraws outputs and working, while {{val}} and the gate keep the answer\'s', () => {
    const sc = scope(1), el = win();
    resolveData(el, sc);
    expect(slideOut(sc, 'conv', 'out[0][0]')).toBe(1);
    const before = sc.values.length;
    sc.whatIf = new Map([['conv', [[1, 0], [0, 2]]]]);
    resolveData(el, sc);
    expect(el.querySelector('[data-slide-line]')!.textContent).toMatch(/= 13$/); // 1·1 + 2·6
    expect(Array.from(el.querySelectorAll('text')).some((t) => t.textContent === 'kernel (what if)')).toBe(true);
    expect(slideOut(sc, 'conv', 'out[0][0]')).toBe(1);
    expect(sc.values.length).toBe(before);
    sc.whatIf.clear();
    resolveData(el, sc);
    expect(el.querySelector('[data-slide-line]')!.textContent).toMatch(/= 1$/);
  });

  it('a what-if of another shape is ignored; weights read as typed', () => {
    const sc = scope(1), el = win();
    sc.whatIf = new Map([['conv', [[1, 2, 3]]]]);
    resolveData(el, sc);
    expect(el.querySelector('[data-slide-line]')!.textContent).toMatch(/= 1$/);
    expect([readWeight('1/9'), readWeight('−0.5'), readWeight('2'), readWeight('x'), readWeight('')]).toEqual([1 / 9, -0.5, 2, null, null]);
  });
});
