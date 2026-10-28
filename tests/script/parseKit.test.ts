// tests/script/parseKit.test.ts — the visual kit's tags.
import { describe, it, expect, vi } from 'vitest';
import { parseTag } from '../../src/script/parseTag';
import { blockPart } from '../../src/script/pointExpr';
import { Figures } from '../../src/geometry/resolve';

const P = (s: string) => parseTag(s) as Record<string, unknown> | null;

describe('kit blocks', () => {
  it('grid: literal values, shading, labels, caption, placement with a glyph', () => {
    expect(P('grid on=s id=img vals=10,10,90;10,10,90 shade cols=a,b,c "patch"')).toMatchObject({
      kind: 'grid', region: 's', id: 'img', src: { vals: [[10, 10, 90], [10, 10, 90]] }, shade: 'heat', cols: ['a', 'b', 'c'], caption: 'patch',
    });
    expect(P('grid on=s id=k vals=1,0,-1 right=img op=⊛')).toMatchObject({ right: 'img', op: '⊛' });
    expect(P('grid on=s id=o over=img slide=k right=k op==')).toMatchObject({ src: { over: 'img', slide: 'k' }, op: '=' });
    expect(P('grid on=s id=o over=img slide=k same flip')).toMatchObject({ src: { over: 'img', slide: 'k', same: true, flip: true } });
    expect(P('grid on=s vals=1,2 shade=image')).toMatchObject({ shade: 'image' });
  });
  it('windows by reduction or fn; maps, zips, generated grids, table columns', () => {
    expect(P('grid on=s id=m over=t win=1x3 reduce=mean below=t')).toMatchObject({ src: { over: 't', win: [1, 3], reduce: 'mean' }, below: 't' });
    expect(P('grid on=s id=m over=t win=2x2 fn="(d-c)/(b-a)" stride=2')).toMatchObject({ src: { win: [2, 2], fn: '(d-c)/(b-a)', stride: 2 } });
    expect(P('bars on=s id=z map=v fn="(x-mean)/std"')).toMatchObject({ kind: 'bars', src: { map: 'v', fn: '(x-mean)/std' } });
    expect(P('grid on=s id=z zip=a,b fn="(x-y)^2"')).toMatchObject({ src: { zip: ['a', 'b'] } });
    expect(P('grid on=s id=z size=6x6 fn="r+c"')).toMatchObject({ src: { gen: [6, 6], fn: 'r+c' } });
    expect(P('bars on=s id=w vals=t.c labels=t.a')).toMatchObject({ src: { col: ['t', 2] }, labelsFrom: ['t', 0] });
    // any block is a source: a table column directly, no re-declared copy
    expect(P('bars on=s id=z map=t.b fn="x/2"')).toMatchObject({ src: { map: 't.b' } });
    expect(P('grid on=s id=z zip=u,t.c fn="x-y"')).toMatchObject({ src: { zip: ['u', 't.c'] } });
  });
  it('op=none: placed beside, no glyph', () => {
    expect(P('bars on=s id=z map=u fn="x+1" right=u op=none')).toMatchObject({ right: 'u', op: '' });
    expect(P('bars on=s id=z map=u fn="x+1" op=none')).toBeNull();
  });
  it('table, scatter (literal or a table’s columns), calc, fit', () => {
    expect(P('table on=s id=t cols=P,Q,|ε| vals=10,50;8,60')).toMatchObject({ kind: 'table', heads: ['P', 'Q', '|ε|'], vals: [[10, 50], [8, 60]] });
    expect(P('scatter on=s id=d pts=1,2 2,3.5 -1,0 x="hours" y="score"')).toMatchObject({ data: [{ x: 1, y: 2 }, { x: 2, y: 3.5 }, { x: -1, y: 0 }], xLabel: 'hours' });
    expect(P('scatter on=s id=d pts=t.a,t.b right=t')).toMatchObject({ cols: { id: 't', x: 0, y: 1 }, right: 't' });
    expect(P('calc on=s of=d reduce=sum "SSD"')).toMatchObject({ kind: 'calc', of: ['d'], reduce: 'sum', label: 'SSD' });
    expect(P('calc on=s of=u,v reduce=dot')).toMatchObject({ of: ['u', 'v'], reduce: 'dot' });
    expect(P('calc on=s of=u,v fn="(x-y)^2" reduce=sum')).toMatchObject({ fn: '(x-y)^2' });
    expect(P('fit on=s id=f of=d pick=2,7 em')).toMatchObject({ kind: 'fit', of: 'd', pick: [2, 7], em: true });
  });
  it('malformed blocks are skipped, never guessed', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const bad of [
      'grid p=3 vals=1,2', // pages have no kit
      'grid on=s vals=1,2;3', // ragged
      'grid on=s vals=1,2 map=a fn="x"', // two sources
      'grid on=s id=k vals=1 right=a below=b',
      'grid on=s id=k vals=1 op=⊛', // a glyph needs a neighbour
      'grid on=s id=o over=g win=3x3', // a window needs reduce or fn
      'grid on=s id=o over=g win=1x3 reduce=median',
      'bars on=s vals=1,2;3,4', // bars are one row
      'calc on=s of=u,v reduce=sum', // two blocks need dot, cos or a fn
      'calc on=s of=u reduce=dot',
      'scatter on=s pts=1,2',
      'fit on=s of=d pick=3,3',
      'table on=s cols=a vals=1,2',
    ]) expect(parseTag(bad), bad).toBeNull();
    warn.mockRestore();
  });
});

describe('kit verbs and parts', () => {
  it('step, sweep, set, band, dist, col, level, emph where', () => {
    expect(P('step id=o[1,2]')).toEqual({ kind: 'step', ref: 'o[1,2]' });
    expect(P('step id=o[3]')).toEqual({ kind: 'step', ref: 'o[3]' });
    expect(P('sweep id=o dur=5')).toEqual({ kind: 'sweep', ref: 'o', dur: 5 });
    expect(P('set id=v fn="x+20"')).toEqual({ kind: 'set', ref: 'v', fn: 'x+20' });
    expect(P('set id=g[2,3] to=7')).toEqual({ kind: 'set', ref: 'g[2,3]', to: 7 });
    expect(P('band id=f w=0.5 "inliers"')).toEqual({ kind: 'band', ref: 'f', w: 0.5, label: 'inliers' });
    expect(P('dist from=d[4] to=f')).toEqual({ kind: 'dist', ref: 'f', from: 'd[4]' });
    expect(P('col id=t.c fn="(b-pb)/pb" dur=4')).toEqual({ kind: 'col', ref: 't.c', head: '', fn: '(b-pb)/pb', dur: 4 });
    expect(P('col id=t "v" fn="20-10*a"')).toEqual({ kind: 'col', ref: 't', head: 'v', fn: '20-10*a' });
    expect(P('level id=t.c at=1 "|ε| = 1"')).toEqual({ kind: 'level', ref: 't', at: 1, col: 2, label: '|ε| = 1' });
    // a column by its header
    expect(P('col id=t.Ed fn="(b-pb)/pb"')).toEqual({ kind: 'col', ref: 't.Ed', head: '', fn: '(b-pb)/pb' });
    expect(P('level id=t.price at=3')).toEqual({ kind: 'level', ref: 't', at: 3, col: -1, colName: 'price' });
    expect(P('bars on=s id=w vals=t.Q labels=t.P')).toMatchObject({ src: { col: ['t', -1, 'Q'] }, labelsFrom: ['t', -1, 'P'] });
    expect(P('bars on=s id=w map=t.Q fn="2*x"')).toMatchObject({ src: { map: 't.Q' } });
    expect(P('scatter on=s id=d pts=t.P,t.Q')).toMatchObject({ cols: { id: 't', x: -1, y: -1, xName: 'P', yName: 'Q' } });
    expect(P('bars on=s id=w vals=1,2 below=u op=↓')).toMatchObject({ below: 'u', op: '↓' });
    expect(P('emph id=s where="x==7"')).toEqual({ kind: 'emph', ref: 's', where: 'x==7' });
    expect(P('emph id=g[1:2,2:3]')).toEqual({ kind: 'emph', ref: 'g[1:2,2:3]' });
    expect(P('sweep id=o[1,1]')).toBeNull();
    expect(P('step id=o')).toBeNull();
  });
  it('parts: 1-based, ranges inclusive; one index is a vector position', () => {
    expect(blockPart('g[2,3]')).toEqual({ id: 'g', r0: 1, r1: 1, c0: 2, c1: 2 });
    expect(blockPart('g[1:2,2:4]')).toEqual({ id: 'g', r0: 0, r1: 1, c0: 1, c1: 3 });
    expect(blockPart('v[4]')).toEqual({ id: 'v', r0: 0, r1: 0, c0: 3, c1: 3, one: true });
    expect(blockPart('v[0]')).toBeNull();
    expect(blockPart('g[3:2,1]')).toBeNull();
  });
  it('parts are points for strokes and connectors; the resolver leaves them to the kit', () => {
    const a = parseTag('arrow on=s from=g[2,3] to=o[1,2]')!;
    expect(a).toMatchObject({ from: { ref: 'g[2,3]' }, to: { ref: 'o[1,2]' } });
    const figs = new Figures({ mark: () => undefined });
    expect(figs.resolve(a)).toMatchObject({ from: { ref: 'g[2,3]' } });
    expect(parseTag('box on=s at=g[1:3,1:3]')).toMatchObject({ kind: 'box', at: { ref: 'g[1:3,1:3]' }, w: 0, h: 0 });
    expect(parseTag('connect from=p4:"words" to=s:g[2,2]')).toMatchObject({ to: { region: 's', ref: 'g[2,2]' } });
  });
  it('centred placement for boxes and text', () => {
    expect(parseTag('box on=s center=500,300 size=200,100')).toMatchObject({ kind: 'box', at: { x: 500, y: 300 }, w: 200, h: 100, centered: true });
    expect(parseTag('write on=s center=500,300 "label" size=m')).toMatchObject({ kind: 'write', centered: true });
    const figs = new Figures({ mark: () => undefined });
    // a centred box is not clipped as if `at` were its corner
    expect(figs.resolve(parseTag('box on=s center=950,300 size=200,100')!)).toMatchObject({ w: 200 });
  });
});
