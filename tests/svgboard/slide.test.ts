// The engine's sliding window (src/svgboard/slide.ts): the model names data and a step, the engine draws.
import { describe, expect, it } from 'vitest';
import { newScope, resolveData } from '../../src/svgboard/data';
import { parseGroup } from '../../src/svgboard/sanitize';
import { checkGroups, newBoardState } from '../../src/svgboard/check';
import { slideOut } from '../../src/svgboard/slide';
import type { CalcTable } from '../../src/calc/stream';

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
    // The kernel as given, then turned around (the one the working uses).
    expect(texts(el)).toEqual(expect.arrayContaining(['kernel', 'turned']));
    const k = texts(el).indexOf('kernel'), t = texts(el).indexOf('turned');
    expect(texts(el).slice(k - 9, k - 6)).toEqual(['1', '0', '−1']);
    expect(texts(el).slice(t - 9, t - 6)).toEqual(['−1', '0', '1']);
    expect(slideOut(sc, 'conv', 'out[0][0]')).toBe(6); // turned: right column minus left, 3 rows × 2
  });

  it('zero padding gives one output per input cell', () => {
    const sc = scope(), el = g('data-slide="img.f" data-op="max" data-size="3x3" data-same=""');
    resolveData(el, sc);
    expect(slideOut(sc, 'conv', 'out[0][0]')).toBe(7);
    expect(slideOut(sc, 'conv', 'out[4][4]')).toBe(25);
  });

  it('an image whose window fits one row down still gives rows (live D2.2: median.out[0][0] was unbound); a signal gives a row', () => {
    const sc = newScope(); sc.consts.k = 0;
    sc.calcs = new Map([['img', { f: [[10, 11, 12, 18], [13, 200, 14, 19], [15, 16, 17, 20]], r: [10, 40, 10, 70, 70] }]]);
    resolveData(g('data-slide="img.f" data-op="median" data-size="3x3"'), sc);
    expect(slideOut(sc, 'conv', 'out[0][0]')).toBe(14);
    expect(slideOut(sc, 'conv', 'out[0][1]')).toBe(17);
    resolveData(g('data-slide="img.r" data-op="mean" data-size="1x3"'), sc);
    expect(slideOut(sc, 'conv', 'out[0]')).toBe(20);
    // A signal written as one row of a matrix ([[2, 3, 20, 4, 5]]) is indexed as rows (live D2.3).
    sc.calcs.set('img', { s: [[2, 3, 20, 4, 5]] });
    expect(resolveData(g('data-slide="img.s" data-op="median" data-size="1x3"'), sc)).toEqual([]);
    expect(slideOut(sc, 'conv', 'out[0][0]')).toBe(3);
    expect(slideOut(sc, 'conv', 'out[0][2]')).toBe(5);
  });

  it('the data bridge: a free readout after the window reads its outputs (data-val="conv.out[r][c]")', () => {
    const sc = scope(), el = g(MEAN);
    resolveData(el, sc);
    const t = parseGroup('<g id="note"><text x="20" y="300" data-val="conv.out[0][0], conv.out[2][2]" data-fmt="0">first {} last {}</text></g>') as Element;
    expect(resolveData(t, sc)).toEqual([]);
    expect(t.querySelector('text')!.textContent).toBe('first 7 last 19');
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

describe('data-slide over a picture (raster)', () => {
  // A 16x16 picture: a dark square (level 20) on a bright field (200), as the page-image table brings it.
  const PIC = Array.from({ length: 16 }, (_, r) => Array.from({ length: 16 }, (_, c) => (r >= 6 && r < 10 && c >= 6 && c < 10 ? 20 : 200)));
  const BOX = [[1, 1, 1], [1, 1, 1], [1, 1, 1]].map((r) => r.map((v) => v / 9));
  const pic = (k = 0) => { const sc = newScope(); sc.consts.k = k; sc.calcs = new Map<string, CalcTable>([['px_i1_24', { f: PIC }], ['b', { box: BOX }]]); return sc; };
  const eye = (attrs = '') => parseGroup(`<g id="eye" data-slide="#i1" data-kernel="b.box" ${attrs}/>`) as Element;

  it('reads the page image\'s table, draws pixels as a few paths (not a numeral per cell), outputs whole levels', () => {
    const sc = pic(), el = eye();
    expect(resolveData(el, sc)).toEqual([]);
    expect(el.querySelectorAll('path').length).toBeLessThanOrEqual(4); // two gray levels in, none out yet
    expect(texts(el).filter((t) => /^\d+$/.test(t ?? ''))).toEqual([]);
    expect(slideOut(sc, 'eye', 'out[0][0]')).toBe(200);
    // Window from (5, 5): a 3x3 with 4 dark cells → (5·200 + 4·20) / 9 = 120.
    expect(slideOut(sc, 'eye', 'out[5][5]')).toBe(120);
    expect(texts(el)).toContain("the slide's image (16×16)");
  });

  it('at a step, the zoom row shows the window\'s real values, the kernel and the result, with the working', () => {
    const sc = pic(14 * 5 + 6), el = eye(); // output 76 (0-based 75): row 5, col 5
    resolveData(el, sc);
    const t = texts(el);
    expect(t.filter((x) => x === '20').length).toBe(4);
    expect(t.filter((x) => x === '1/9').length).toBe(9);
    expect(t).toContain('120');
    expect(el.querySelector('[data-slide-line]')!.textContent).toMatch(/^1\/9·200 \+ .* = 120$/);
    expect(el.querySelector('[data-slide-frame]')).not.toBeNull();
  });

  it('data-fmt keeps decimals; a calc matrix over 12 wide is drawn as pixels too', () => {
    const sc = pic(), el = eye('data-fmt="2"');
    resolveData(el, sc);
    expect(slideOut(sc, 'eye', 'out[4][4]')).toBe(Number(((8 * 200 + 20) / 9).toFixed(2)));
    sc.calcs!.set('img', { f: PIC });
    const el2 = parseGroup('<g id="m" data-slide="img.f" data-op="median" data-size="3x3"/>') as Element;
    resolveData(el2, sc);
    expect(texts(el2)).toContain('input (16×16)');
  });

  it('an image that was not read is a clear error, naming the mark', () => {
    const sc = newScope(), el = eye();
    sc.calcs = new Map([['b', { box: BOX }]]);
    sc.consts.k = 0;
    const errs = resolveData(el, sc);
    expect(JSON.stringify(errs)).toMatch(/page image #i1 could not be read/);
  });
});

describe('raster layout', () => {
  it('a data-cell too large for the board is shrunk so the output stays on it (live D9)', () => {
    const PIC = Array.from({ length: 24 }, () => Array.from({ length: 24 }, () => 100));
    const sc = newScope(); sc.consts.k = 0; sc.calcs = new Map<string, CalcTable>([['px_i1_24', { f: PIC }]]);
    const el = parseGroup('<g id="eye" data-slide="#i1" data-op="mean" data-size="3x3" data-origin="20,55" data-cell="16"/>') as Element;
    resolveData(el, sc);
    const right = Math.max(...Array.from(el.querySelectorAll('rect')).map((r) => Number(r.getAttribute('x')) + Number(r.getAttribute('width'))));
    expect(right).toBeLessThanOrEqual(560);
  });
});
