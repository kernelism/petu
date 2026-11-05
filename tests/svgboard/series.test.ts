// The plot view: a program's trace on a frame (data-series), and formulas that index a calc by a step (nw.x[k]).
import { describe, expect, it } from 'vitest';
import { newScope, resolveData } from '../../src/svgboard/data';
import { parseGroup } from '../../src/svgboard/sanitize';

// Newton's method for x² = 2 from x = 1: 1, 1.5, 1.41667, 1.41422.
const xs = [1]; for (let i = 0; i < 3; i++) xs.push(xs[i] - (xs[i] ** 2 - 2) / (2 * xs[i]));
const scope = (k: number) => { const sc = newScope(); sc.consts.k = k; sc.calcs = new Map([['nw', { x: xs, y: xs.map((x) => x * x - 2) }]]); return sc; };
const board = (inner: string) => parseGroup(`<g><g data-axes="ax" data-x="0,2" data-y="-2,2" data-box="40,40,400,300"/>${inner}</g>`) as Element;

describe('data-series and stepped indexes', () => {
  it('a path through the trace shows points 0…k; a g shows dots, the latest accented', () => {
    const el = board('<path id="tr" data-series="nw.x, nw.y" data-axes="ax" data-upto="k"/><g id="dots" data-series="nw.x, nw.y" data-axes="ax" data-upto="k"/>');
    expect(resolveData(el, scope(1))).toEqual([]);
    const d = el.querySelector('#tr, [id$="tr"]')!.getAttribute('d')!;
    expect(d.split('L')).toHaveLength(2);
    expect(d.startsWith('M240 265L')).toBe(true); // (1, −1): x 40 + 400/2, y 340 − 300/4
    const dots = el.querySelectorAll('circle');
    expect(dots).toHaveLength(2);
    expect(dots[1].getAttribute('fill')).toBe('#7c3aed');
    resolveData(el, scope(3));
    expect(el.querySelectorAll('circle')).toHaveLength(4);
  });

  it('a formula reads the trace at the step: pt(ax, nw.x[k], 0) moves with k; past the end fails', () => {
    const el = board('<circle id="p" r="4" data-at="pt(ax, nw.x[k], 0)" data-axes="ax"/><text id="v" data-val="nw.x[k]" data-fmt="4">x = {}</text>');
    resolveData(el, scope(1));
    expect(el.querySelector('text:not([data-engine])')!.textContent).toBe('x = 1.5000');
    resolveData(el, scope(1.6)); // a tween between steps reads the step reached
    expect(el.querySelector('text:not([data-engine])')!.textContent).toBe('x = 1.5000');
    resolveData(el, scope(2));
    expect(el.querySelector('text:not([data-engine])')!.textContent).toBe('x = 1.4167');
    expect(resolveData(el, scope(9)).map((p) => JSON.stringify(p)).join(' ')).toMatch(/exports no number x\[9\]/);
  });
});
