import { describe, expect, it } from 'vitest';
import { parseTag } from '../../src/script/parseTag';

describe('the slide as canvas: grammar', () => {
  it('page drawings on a calibrated chart take data coordinates (unclamped)', () => {
    expect(parseTag('line p=12 on=#c1 from=20,8 to=25,7')).toEqual({ kind: 'line', page: 12, from: { x: 20, y: 8 }, to: { x: 25, y: 7 }, chart: '#c1' });
    expect(parseTag('point p=12 on=#c1 at=2000,-3 "E"')).toMatchObject({ kind: 'point', page: 12, at: { x: 2000, y: -3 }, text: 'E', chart: '#c1' });
    expect(parseTag('shade p=12 on=#c1 pts=0,12 20,8 0,8')).toMatchObject({ kind: 'shade', chart: '#c1', pts: [{ x: 0, y: 12 }, { x: 20, y: 8 }, { x: 0, y: 8 }] });
  });
  it('a chart plot needs no domain and no axes of its own', () => {
    expect(parseTag('plot p=12 on=#c1 fn="2+x/5+2" "S + t"')).toMatchObject({ kind: 'plot', page: 12, fn: '2+x/5+2', chart: '#c1', label: 'S + t' });
    expect(parseTag('plot p=12 on=#c1 fn="x" domain=0,30')).toMatchObject({ domain: [0, 30], chart: '#c1' });
    expect(parseTag('plot p=12 on=#c1 fn="x" axes=a')).toBeNull();
    expect(parseTag('plot p=12 fn="x" domain=0,1')).toBeNull(); // a page plot needs a chart
  });
  it('kinds that make no sense on a chart are malformed there', () => {
    expect(parseTag('highlight p=12 on=#c1 "x"')).toBeNull();
    expect(parseTag('circle p=12 on=#c1 mark=#d1')).toBeNull();
    expect(parseTag('line on=#c1 from=1,1 to=2,2')).toBeNull(); // no page
  });
  it('lets name data points on a chart', () => {
    expect(parseTag('let p=12 on=#c1 E=20,8')).toEqual({ kind: 'let', page: 12, chart: '#c1', defs: [['E', { x: 20, y: 8 }]] });
  });
  it('lift: a page mark or box onto a section', () => {
    expect(parseTag('lift p=4 mark=#g1 on=s id=fig')).toEqual({ kind: 'lift', region: 's', srcPage: 4, srcMark: '#g1', id: 'fig' });
    expect(parseTag('lift p=4 box=50,500,310,170 on=s at=100,80 w=500')).toEqual({ kind: 'lift', region: 's', srcPage: 4, src: { x: 50, y: 500, w: 310, h: 170 }, at: { x: 100, y: 80 }, w: 500 });
    expect(parseTag('lift p=4 on=s')).toBeNull(); // nothing to lift
    expect(parseTag('lift p=4 mark=#g1 box=1,1,2,2 on=s')).toBeNull(); // both
    expect(parseTag('lift mark=#g1 on=s')).toBeNull(); // no source page
    expect(parseTag('lift p=4 mark=#g1')).toBeNull(); // no section
  });
  it('page notes annotate a mark, a quote or a point', () => {
    expect(parseTag('note p=4 "the slope" annotate=#e2')).toEqual({ kind: 'annot', page: 4, text: 'the slope', annotate: '#e2' });
    expect(parseTag('note p=4 "rate limit" annotate="Vmax is unchanged" near=100,200')).toEqual({ kind: 'annot', page: 4, text: 'rate limit', quote: 'Vmax is unchanged', near: { x: 100, y: 200 } });
    expect(parseTag('note p=12 on=#c1 at=20,8 "buyers pay"')).toEqual({ kind: 'annot', page: 12, text: 'buyers pay', at: { x: 20, y: 8 }, chart: '#c1' });
    expect(parseTag('note p=4 annotate=#e2')).toBeNull(); // no text
    expect(parseTag('note p=4 "x"')).toBeNull(); // nothing annotated
    // A note on a section is still the scene's.
    expect(parseTag('note on=s "x" annotate=w')).toMatchObject({ kind: 'note', region: 's' });
  });
});
