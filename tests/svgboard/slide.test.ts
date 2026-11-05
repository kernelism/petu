// The engine's sliding window (src/svgboard/slide.ts): the model names data and a step, the engine draws.
import { describe, expect, it } from 'vitest';
import { newScope, resolveData } from '../../src/svgboard/data';
import { parseGroup } from '../../src/svgboard/sanitize';
import { checkGroups, newBoardState } from '../../src/svgboard/check';
import { slideOut } from '../../src/svgboard/slide';

const IMG = Array.from({ length: 5 }, (_, r) => Array.from({ length: 5 }, (_, c) => 5 * r + c + 1));
const scope = (k = 0) => { const sc = newScope(); sc.consts.k = k; sc.calcs = new Map([['img', { f: IMG, k: [[1, 0, -1], [1, 0, -1], [1, 0, -1]] }]]); return sc; };
const g = (attrs: string) => parseGroup(`<g id="conv" ${attrs}/>`) as Element;
const filled = (el: Element) => Array.from(el.querySelectorAll('text[fill="#7c3aed"]')).map((t) => t.textContent);
const texts = (el: Element) => Array.from(el.querySelectorAll('text')).map((t) => t.textContent);
const frame = (el: Element) => { const f = el.querySelector('[data-slide-frame]'); return f && [Number(f.getAttribute('x')), Number(f.getAttribute('y'))]; };
const MEAN = 'data-slide="img.f" data-op="mean" data-size="3x3"';

describe('data-slide', () => {
  it('lays out a 5x5 input and 3x3 output; at k=0 the output is empty and no frame shows', () => {
    const sc = scope(), el = g(MEAN);
    expect(resolveData(el, sc)).toEqual([]);
    expect(el.querySelectorAll('rect').length).toBe(25 + 9);
    expect(filled(el)).toEqual([]);
    expect(frame(el)).toBeNull();
    expect(slideOut(sc, 'conv', 'out[0][0]')).toBe(7);
    expect(slideOut(sc, 'conv', 'out[2][2]')).toBe(19);
  });

  it('at k = j the frame is on output j, outputs 1…j are filled, the working is output j\'s', () => {
    const sc = scope(5), el = g(MEAN);
    resolveData(el, sc);
    expect(filled(el)).toEqual(['7', '8', '9', '12', '13']);
    expect(frame(el)).toEqual([20 + 36 - 2, 60 + 36 - 2]); // output 5: row 1, col 1, window from input (1, 1)
    expect(el.querySelector('[data-slide-line]')!.textContent).toMatch(/= 13$/);
  });

  it('a group data-const of the step defines it, and a later step value is kept on a redraw', () => {
    const sc = scope(), el = parseGroup(`<g id="conv" data-const="k=0" ${MEAN}/>`) as Element;
    delete sc.consts.k;
    expect(resolveData(el, sc)).toEqual([]);
    sc.consts.k = 3;
    resolveData(el, sc);
    expect(filled(el)).toEqual(['7', '8', '9']);
  });

  it('between steps the frame glides; a kernel is drawn and turned for convolution', () => {
    const sc = scope(1.5), el = g('data-slide="img.f" data-kernel="img.k" data-flip=""');
    resolveData(el, sc);
    expect(frame(el)).toEqual([20 + 18 - 2, 60 - 2]);
    expect(texts(el)).toContain('kernel, turned');
    expect(texts(el).slice(26, 29)).toEqual(['−1', '0', '1']); // the kernel as used: turned around
    expect(slideOut(sc, 'conv', 'out[0][0]')).toBe(6); // turned: right column minus left, 3 rows × 2
  });

  it('zero padding gives one output per input cell', () => {
    const sc = scope(), el = g('data-slide="img.f" data-op="max" data-size="3x3" data-same=""');
    resolveData(el, sc);
    expect(slideOut(sc, 'conv', 'out[0][0]')).toBe(7);
    expect(slideOut(sc, 'conv', 'out[4][4]')).toBe(25);
  });

  it('names what is missing, never draws a guess', () => {
    const sc = scope();
    expect(resolveData(g('data-slide="img.nope" data-op="mean" data-size="3x3"'), sc)[0].detail).toMatch(/exports no array nope/);
    expect(resolveData(g(`${MEAN} data-step="j"`), sc)[0].detail).toMatch(/define it first/);
  });

  it('passes the board checks: its numbers are the engine\'s, it fits the board', () => {
    const sc = scope(9);
    const r = checkGroups(['<g id="conv" data-slide="img.f" data-kernel="img.k"/>'], newBoardState(560, 420), 16, sc);
    expect(r.flags).toEqual([]);
    expect(r.notes.filter((n) => /typed by hand|grounded/.test(n))).toEqual([]);
    const b = r.geos[0].box!;
    expect(b.x + b.w).toBeLessThanOrEqual(560);
  });

  it('a box kernel of ninths is written 1/9, in its grid and in the working (live: "0.11" crowded the cells)', () => {
    const sc = scope(1);
    sc.calcs!.set('box', { k: [[1 / 9, 1 / 9, 1 / 9], [1 / 9, 1 / 9, 1 / 9], [1 / 9, 1 / 9, 1 / 9]] });
    const el = g('data-slide="img.f" data-kernel="box.k"');
    resolveData(el, sc);
    expect(texts(el).filter((t) => t === '1/9')).toHaveLength(9);
    expect(el.querySelector('[data-slide-line]')!.textContent).toMatch(/^1\/9·1 \+ 1\/9·2/);
    expect(slideOut(sc, 'conv', 'out[0][0]')).toBeCloseTo(7, 9);
  });
});
