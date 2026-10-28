// tests/script/parseTagV2.test.ts
import { describe, it, expect } from 'vitest';
import { parseTag, normalizeTex } from '../../src/script/parseTag';
import { Figures } from '../../src/geometry/resolve';

describe('parseTag v2: regions', () => {
  it('sketch appends a board section; near= names its slide, place= is accepted and ignored', () => {
    expect(parseTag('sketch id=side near=p3 size=s place=right')).toEqual({ kind: 'sketch', id: 'side', page: 3, size: 's' });
    expect(parseTag('sketch id=Side near=3')).toEqual({ kind: 'sketch', id: 'side', page: 3, size: 'm' });
    expect(parseTag('sketch id=s size=l')).toEqual({ kind: 'sketch', id: 's', size: 'l' }); // the slide in view
    expect(parseTag('sketch id=s near=p0 place=up')).toEqual({ kind: 'sketch', id: 's', size: 'm' }); // ignored, not malformed
    for (const bad of ['sketch near=p3', 'sketch id=s near=p3 size=xl', 'sketch id=9x near=p3']) {
      expect(parseTag(bad), bad).toBeNull();
    }
  });
  it('on=<region> keeps world coords at parse time; the resolver clamps to 1000 × 700 (rule 5)', () => {
    expect(parseTag('line on=side from=-5,10 to=1200,900 dash em id=ray')).toEqual({
      kind: 'line', region: 'side', from: { x: -5, y: 10 }, to: { x: 1200, y: 900 }, dash: true, em: true, id: 'ray',
    });
    const f = new Figures({ mark: () => undefined });
    expect(f.resolve(parseTag('circle on=side at=100,800 r=9')!)).toEqual({ kind: 'circle', region: 'side', at: { x: 100, y: 700 }, rx: 9, ry: 9 });
  });
  it('write, axes, plot and math are region-only', () => {
    expect(parseTag('write p=3 at=1,1 "x"')).toBeNull();
    expect(parseTag('math p=3 at=1,1 "x"')).toBeNull();
    expect(parseTag('axes p=3 at=100,600 size=500,400')).toBeNull();
    expect(parseTag('plot p=3 fn="x" domain=0,1')).toBeNull();
  });
});

describe('parseTag v2: toolkit', () => {
  it('point with label and compass', () => {
    expect(parseTag('point on=side at=160,600 "C" id=c dir=sw')).toEqual({ kind: 'point', region: 'side', at: { x: 160, y: 600 }, text: 'C', dir: 'sw', id: 'c' });
    expect(parseTag('point on=side at=1,1 dir=up')).toBeNull();
  });
  it('curve and shade take a point list', () => {
    expect(parseTag('curve on=side pts=0,0 100,50 200,0 dash')).toEqual({
      kind: 'curve', region: 'side', pts: [{ x: 0, y: 0 }, { x: 100, y: 50 }, { x: 200, y: 0 }], dash: true,
    });
    expect(parseTag('curve on=side pts=0,0')).toBeNull();
    expect(parseTag('shade on=side pts=0,0 100,0 50,80 em')).toEqual({ kind: 'shade', region: 'side', pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 80 }], em: true });
    expect(parseTag('shade on=side at=500,300 rx=80 ry=40')).toEqual({ kind: 'shade', region: 'side', at: { x: 500, y: 300 }, rx: 80, ry: 40 });
    expect(parseTag('shade on=side pts=0,0 1,1')).toBeNull();
  });
  it('angle and brace', () => {
    expect(parseTag('angle on=side at=100,600 from=300,600 to=200,400 r=40 "θ"')).toEqual({
      kind: 'angle', region: 'side', at: { x: 100, y: 600 }, from: { x: 300, y: 600 }, to: { x: 200, y: 400 }, r: 40, text: 'θ',
    });
    expect(parseTag('brace on=side from=700,620 to=300,620 "B"')).toEqual({ kind: 'brace', region: 'side', from: { x: 700, y: 620 }, to: { x: 300, y: 620 }, text: 'B' });
  });
  it('axes and plot', () => {
    expect(parseTag('axes on=side at=100,600 size=600,500 x="depth z" y="disparity" id=ax')).toEqual({
      kind: 'axes', region: 'side', at: { x: 100, y: 600 }, w: 600, h: 500, xLabel: 'depth z', yLabel: 'disparity', id: 'ax',
    });
    expect(parseTag('plot on=side fn="1/x" domain=0.5,5 em')).toEqual({ kind: 'plot', region: 'side', fn: '1/x', domainSrc: ['0.5', '5'], domain: [0.5, 5], em: true });
    // engine graphs: domains over constants, a parametric curve over t, a label and axis names
    expect(parseTag('plot on=s fn="v*x" domain=0,2*v/g "speed" xlabel=time')).toMatchObject({ fn: 'v*x', domainSrc: ['0', '2*v/g'], label: 'speed', xLabel: 'time' });
    expect(parseTag('plot on=s id=p30 x="v*cos(rad(30))*t" y="v*sin(rad(30))*t-g*t^2/2" t=0,2*v*sin(rad(30))/g "30°" label=top axes=p45')).toEqual({
      kind: 'plot', region: 's', id: 'p30', x: 'v*cos(rad(30))*t', y: 'v*sin(rad(30))*t-g*t^2/2', t: ['0', '2*v*sin(rad(30))/g'], label: '30°', labelAt: 'top', axes: 'p45' });
    expect(parseTag('const v=20 g=9.8 T=2*v/g')).toEqual({ kind: 'const', defs: [['v', '20'], ['g', '9.8'], ['T', '2*v/g']] });
    expect(parseTag('let on=s v=20 g=9.8')).toEqual({ kind: 'const', defs: [['v', '20'], ['g', '9.8']] });
    expect(parseTag('let v=20')).toEqual({ kind: 'const', defs: [['v', '20']] });
    expect(parseTag('let on=s A=0,0 B=10,0')).toMatchObject({ kind: 'let' });
    expect(parseTag('plot on=side fn="1/x" domain=0.5,5 range=0,2 axes=ax')).toMatchObject({ range: [0, 2], axes: 'ax' });
    expect(parseTag('plot on=side fn="1/x" domain=5,1')).toBeNull();
    expect(parseTag(`plot on=side fn="${'x+'.repeat(70)}x" domain=0,1`)).toBeNull();
  });
  it('math keeps TeX, collapsing JSON-escaped backslashes before commands', () => {
    expect(parseTag('math on=side at=100,200 "\\\\frac{B f}{z}" size=l')).toEqual({ kind: 'math', region: 'side', at: { x: 100, y: 200 }, tex: '\\frac{B f}{z}', size: 'l' });
    expect(normalizeTex('a \\\\ b')).toBe('a \\\\ b');
  });
});

describe('parseTag v2: references and connectors', () => {
  it('emph, move, fade reference an id', () => {
    expect(parseTag('emph id=lp')).toEqual({ kind: 'emph', ref: 'lp' });
    expect(parseTag('fade id=lp')).toEqual({ kind: 'fade', ref: 'lp' });
    expect(parseTag('move id=x to=300,200')).toEqual({ kind: 'move', ref: 'x', to: { x: 300, y: 200 } });
    expect(parseTag('emph')).toBeNull();
  });
  it('label with at is placed; label with only id is attached to that element', () => {
    expect(parseTag('label on=side at=10,10 "l′" id=lab')).toEqual({ kind: 'label', region: 'side', at: { x: 10, y: 10 }, text: 'l′', id: 'lab' });
    expect(parseTag('label id=lp "l′" dir=se em')).toEqual({ kind: 'label', ref: 'lp', text: 'l′', dir: 'se', em: true });
  });
  it('connect joins a page anchor and a region element', () => {
    expect(parseTag('connect from=p3:"x" to=side:xpt near=316,454')).toEqual({
      kind: 'connect', from: { page: 3, quote: 'x', near: { x: 316, y: 454 } }, to: { region: 'side', ref: 'xpt' },
    });
    expect(parseTag('connect from=p3:305,459 to=side:271,410')).toEqual({
      kind: 'connect', from: { page: 3, at: { x: 305, y: 459 } }, to: { region: 'side', at: { x: 271, y: 410 } },
    });
    expect(parseTag('connect from=side:x to=p3:"image 1"')).toMatchObject({ to: { page: 3, quote: 'image 1' } });
    expect(parseTag('connect from=p3:"x" to=p4:"y"')).toBeNull();
    expect(parseTag('connect from=side:x to=other:y')).toBeNull();
  });
});
