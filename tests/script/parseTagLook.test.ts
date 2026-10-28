// tests/script/parseTagLook.test.ts — line weights and shade styles (design polish, 2026-10-28)
import { describe, it, expect } from 'vitest';
import { parseTag } from '../../src/script/parseTag';

describe('parseTag: weight=primary|secondary|faint', () => {
  it('is carried on every stroked kind', () => {
    expect(parseTag('line on=side from=0,0 to=100,0 weight=secondary')).toEqual({ kind: 'line', region: 'side', from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, weight: 'secondary' });
    expect(parseTag('arrow p=3 from=0,0 to=100,0 weight=Faint')).toMatchObject({ kind: 'arrow', weight: 'faint' });
    expect(parseTag('curve on=side pts=0,0 50,50 100,0 weight=primary dash')).toMatchObject({ kind: 'curve', weight: 'primary', dash: true });
    expect(parseTag('circle on=side at=100,100 r=20 weight=secondary')).toMatchObject({ kind: 'circle', weight: 'secondary' });
    expect(parseTag('circle p=3 "hello" weight=faint')).toMatchObject({ kind: 'circle', quote: 'hello', weight: 'faint' });
    expect(parseTag('box on=side at=10,10 size=50,50 weight=faint')).toMatchObject({ kind: 'box', weight: 'faint' });
    expect(parseTag('angle on=side at=0,0 from=100,0 to=0,100 weight=primary')).toMatchObject({ kind: 'angle', weight: 'primary' });
    expect(parseTag('brace on=side from=0,0 to=100,0 weight=primary')).toMatchObject({ kind: 'brace', weight: 'primary' });
    expect(parseTag('axes on=side at=100,600 size=300,300 weight=primary')).toMatchObject({ kind: 'axes', weight: 'primary' });
    expect(parseTag('plot on=side fn="x" domain=0,1 weight=secondary')).toMatchObject({ kind: 'plot', weight: 'secondary' });
  });
  it('is absent when not given (the renderer picks the kind default)', () => {
    expect(parseTag('line on=side from=0,0 to=100,0')).not.toHaveProperty('weight');
  });
  it('an unknown weight is malformed', () => {
    expect(parseTag('line on=side from=0,0 to=100,0 weight=bold')).toBeNull();
    expect(parseTag('line on=side from=0,0 to=100,0 weight=')).toBeNull();
  });
});

describe('parseTag: shade outline', () => {
  it('outline is a flag on polygon and ellipse shades', () => {
    expect(parseTag('shade on=big pts=150,250 410,210 410,600 outline')).toEqual({
      kind: 'shade', region: 'big', pts: [{ x: 150, y: 250 }, { x: 410, y: 210 }, { x: 410, y: 600 }], outline: true,
    });
    expect(parseTag('shade on=big at=500,300 r=40 outline em')).toMatchObject({ kind: 'shade', outline: true, em: true });
    expect(parseTag('shade on=big pts=0,0 100,0 50,80 em')).not.toHaveProperty('outline');
  });
});
