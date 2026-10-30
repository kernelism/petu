// @vitest-environment jsdom
// Exact data on the svg board: formulas resolved by the engine, never computed in the model's head.
import { describe, expect, it } from 'vitest';
import { constDefs, fmtValue, newScope, point, resolveData } from '../../src/svgboard/data';
import { parseGroup } from '../../src/svgboard/sanitize';
import { checkGroups, newBoardState } from '../../src/svgboard/check';

const g = (src: string) => parseGroup(src) as Element;
const MARKET = `<g id="mk" data-const="a=1200 b=5 c=400 e=5 pc=900">
  <g data-axes="ax" data-x="0,140" data-y="400,1300" data-box="100,60,500,400" data-frame="" data-ticks-x="0,40,80,120"/>
  <path id="d" data-fn="a-b*x" data-axes="ax" stroke="#333" fill="none"/>
  <path id="s" data-fn="c+e*x" data-axes="ax" stroke="#333" fill="none"/>
  <circle id="E" data-at="cross(d,s)" r="6"/>
  <circle id="qs" data-at="at(s, y=pc)" r="5"/>
  <circle id="qd" data-at="at(d, y=pc)" r="5"/>
  <line data-from="E" data-to="onx(E)" stroke="#999"/>
  <text id="short" data-val="xof(qd)-xof(qs)" x="300" y="40">shortage {} flats</text>
  <path data-between="d,s" data-x="60,80" data-axes="ax" fill="#888"/>
</g>`;

describe('svg data: exact geometry', () => {
  it('parses constants in order, formulas included', () => {
    expect(constDefs('g=9.8 R=6.37e6 T=2*pi*sqrt(R/g)')).toEqual([['g', '9.8'], ['R', '6.37e6'], ['T', '2*pi*sqrt(R/g)']]);
    expect(constDefs('a=1; b = a+2')).toEqual([['a', '1'], ['b', 'a+2']]);
  });

  it('places the equilibrium exactly on the crossing, and the shortage from the curves', () => {
    const el = g(MARKET), sc = newScope();
    expect(resolveData(el, sc)).toEqual([]);
    // Demand 1200-5x meets supply 400+5x at x=80, P=800: board x = 100 + 80/140*500, y = 60+400-(800-400)/900*400.
    const E = el.querySelector('#E')!;
    expect(+E.getAttribute('cx')!).toBeCloseTo(100 + (80 / 140) * 500, 1);
    expect(+E.getAttribute('cy')!).toBeCloseTo(460 - (400 / 900) * 400, 1);
    // At the ceiling 900: qs = 100, qd = 60 → … qd-qs is negative here (a floor); the text says it exactly.
    expect(el.querySelector('#short')!.textContent).toBe('shortage −40 flats');
    expect(sc.values.some((v) => Math.abs(v.v + 40) < 1e-6)).toBe(true);
    // The guide drops to the x axis under E.
    const ln = el.querySelector('line[data-from]')!;
    expect(+ln.getAttribute('y2')!).toBeCloseTo(460, 1);
    expect(+ln.getAttribute('x2')!).toBeCloseTo(+E.getAttribute('cx')!, 2);
    // Curves are paths inside the frame; the region is closed.
    expect(el.querySelector('#d')!.getAttribute('d')).toMatch(/^M[\d.]+ [\d.]+L/);
    expect(el.querySelector('[data-between]')!.getAttribute('d')).toMatch(/Z$/);
    // The frame and ticks were drawn by the engine.
    expect(el.querySelectorAll('[data-engine]').length).toBeGreaterThan(4);
  });

  it('re-resolves when a constant changes (a tween frame)', () => {
    const el = g(MARKET), sc = newScope();
    resolveData(el, sc);
    sc.consts.pc = 700;
    expect(resolveData(el, sc)).toEqual([]);
    // qd at 700 = 100, qs = 60: shortage 40.
    expect(el.querySelector('#short')!.textContent).toBe('shortage 40 flats');
  });

  it('flags what does not resolve instead of drawing it wrong', () => {
    const el = g(`<g><circle data-at="cross(d,q)" r="4"/><text data-val="zz*2">x</text><circle data-at="at(f, y=5)" r="3"/></g>`);
    const sc = newScope();
    const ps = resolveData(el, sc);
    expect(ps.map((p) => p.detail)).toEqual(['no curve d', 'unknown constant zz in "zz*2"', 'no curve f']);
    const r = checkGroups(['<g id="m"><circle data-at="cross(d,q)" r="4"/></g>'], newBoardState(), 16);
    expect(r.flags.map((f) => f.detail).join()).toMatch(/no curve d/);
  });

  it('points: max of a curve, a parametric point, board formulas', () => {
    const sc = newScope({ th: Math.PI / 2 });
    const el = g(`<g data-const="k=2"><path id="f" data-fn="sin(x)" data-x="0,pi" fill="none"/><path id="o" data-param="300+100*cos(t), 200-100*sin(t)" data-t="0,2*pi"/></g>`);
    expect(resolveData(el, sc)).toEqual([]);
    const m = point('max(f)', sc);
    expect(m.dx).toBeCloseTo(Math.PI / 2, 5);
    expect(m.dy).toBeCloseTo(1, 8);
    const p = point('at(o, t=th)', sc);
    expect(p.x).toBeCloseTo(300, 6); expect(p.y).toBeCloseTo(100, 6);
    expect(point('k*10, 5', sc)).toMatchObject({ x: 20, y: 5 });
  });

  it('formats values', () => {
    expect(fmtValue(17.234)).toBe('17.2');
    expect(fmtValue(1234.5)).toBe('1235');
    expect(fmtValue(0.5, '2')).toBe('0.50');
    expect(fmtValue(-3)).toBe('−3');
    expect(fmtValue(63700)).toBe('63,700');
  });

  it('the gate sees resolved geometry: a curve through earlier text is caught', () => {
    const board = newBoardState();
    const a = checkGroups([`<g id="ax" data-axes="ax" data-x="0,10" data-y="0,10" data-box="100,100,400,400"><text x="290" y="305" font-size="20">label</text></g>`], board, 16);
    expect(a.flags).toEqual([]);
    board.texts.push(...a.geos[0].texts);
    const b = checkGroups([`<g id="c"><path data-fn="x" data-axes="ax" stroke="#000" fill="none"/></g>`], board, 16, a.scope);
    expect(b.flags.map((f) => f.detail).join()).toMatch(/crosses text "label"/);
  });
});

import { GateState } from '../../src/gate/engine';
import { checkNumbers } from '../../src/gate/check';
import type { RawAction } from '../../src/script/types';

describe('svg data: the gate knows the computed numbers', () => {
  it('a spoken number matches a data-val; after a tween, its new value', () => {
    const st = new GateState();
    const svg = (s: string) => ({ kind: 'svg', svg: s } as RawAction);
    expect(st.apply(svg(MARKET.replace('pc=900', 'pc=700')), 0)).toBeUndefined();
    expect(st.consts.pc).toBe(700);
    const say = (w: string) => checkNumbers(w.split(' '), { known: st.values, derived: [], intersections: [] }).flags;
    expect(say('a shortage of 40 flats')).toEqual([]);
    expect(say('a shortage of 37 flats').length).toBe(1);
    st.apply({ kind: 'tween', sets: [['pc', '600']] } as RawAction, 1);
    // At 600: qd = 120, qs = 40: the shortage is 80.
    expect(say('now 80 flats short')).toEqual([]);
    // A bad group is reported (the engine could not apply it).
    expect(st.apply(svg('<g><circle data-at="cross(d,zz)" r="3"/></g>'), 2)).toMatch(/no curve zz/);
  });
});
