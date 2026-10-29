// tests/desk/render.test.ts
import { describe, it, expect } from 'vitest';
import { textUnits, unitStarts, reveal, makeText, own, measureText, heightKey } from '../../src/desk/render';

const SVG = 'http://www.w3.org/2000/svg';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('text reveal', () => {
  it('splits short text into whole characters, spaces riding with the glyph before them', () => {
    expect(textUnits('x is')).toEqual(['x ', 'i', 's']);
    expect(textUnits('x′ = 2')).toEqual(['x', '′ ', '= ', '2']);
    expect(textUnits('🙂a')).toEqual(['🙂', 'a']); // never half a code point
  });
  it('splits long text into whole words', () => {
    const long = 'wherever the real point is, x-prime must be on l-prime';
    const u = textUnits(long);
    expect(u.join('')).toBe(long);
    expect(u[0]).toBe('wherever ');
    expect(u.length).toBe(long.split(' ').length);
  });
  it('spreads the units over the whole duration: the last one lands exactly at the end', () => {
    const s = unitStarts(5, 500, 100);
    expect(s[0]).toBe(0);
    expect(s[4] + 100).toBeCloseTo(500);
    for (let i = 1; i < s.length; i++) expect(s[i]).toBeGreaterThan(s[i - 1]);
    expect(unitStarts(1, 300, 100)).toEqual([0]);
  });
  it('writes glyph by glyph without a clip: mid-way some glyphs are in, others not, none cut', async () => {
    const svg = document.createElementNS(SVG, 'svg');
    const g = own(svg.appendChild(document.createElementNS(SVG, 'g')) as SVGGElement);
    makeText(g, { x: 10, y: 10 }, 'image 1', { size: 14, style: 'hand', color: '#000' });
    const box = { x: 10, y: 0, w: 60, h: 20 };
    const p = reveal(g, box, 7, { style: 'hand', speed: 2 }); // 440ms, units start 0…220ms
    await sleep(110);
    expect(g.getAttribute('clip-path')).toBeNull();
    expect(g.querySelector('clipPath')).toBeNull();
    const ops = [...g.querySelectorAll('tspan')].map((t) => Number((t as SVGElement).style.fillOpacity || '1'));
    expect(ops.length).toBe(6);
    expect(ops[0]).toBeGreaterThan(0.2);
    expect(ops[ops.length - 1]).toBe(0);
    await p;
    const t = g.querySelector('text')!;
    expect(t.textContent).toBe('image 1');
    expect(t.querySelector('tspan')).toBeNull(); // back to plain text once written
  });
});

describe('label halo', () => {
  it('a made text paints a surface-colored stroke behind its fill', () => {
    const g = document.createElementNS(SVG, 'g') as SVGGElement;
    const t = makeText(g, { x: 0, y: 0 }, 'x', { size: 20, style: 'clean', color: '#000' });
    expect(t.getAttribute('paint-order')).toBe('stroke');
    expect(t.getAttribute('stroke')).toBeTruthy();
    expect(Number(t.getAttribute('stroke-width'))).toBeCloseTo(4.4);
    expect(t.getAttribute('stroke-linejoin')).toBe('round');
  });
});

describe('measureText', () => {
  // An engine that rounds the font's ascent (1.07 em) and descent (0.3 em) up to whole device px at a
  // 0.666 layer scale, as Gecko does: the measured height is not proportional to the size.
  const roundingBBox = function (this: SVGTextElement) {
    const size = Number(this.getAttribute('font-size'));
    const dev = 0.666 * size;
    return { x: 0, y: 0, width: 0.5 * size * (this.textContent ?? '').length, height: (Math.ceil(1.07 * dev) + Math.ceil(0.3 * dev)) / 0.666 } as DOMRect;
  };
  const withBBox = <T,>(f: () => T): T => {
    const proto = SVGElement.prototype as unknown as { getBBox?: unknown };
    const was = proto.getBBox;
    proto.getBBox = roundingBBox;
    try { return f(); } finally { if (was) proto.getBBox = was; else delete proto.getBBox; }
  };
  const layer = () => own(document.createElementNS(SVG, 'svg').appendChild(document.createElementNS(SVG, 'g')) as SVGGElement);
  const o = { size: 22, style: 'clean' as const, color: '#000' };

  it('keeps the measured width and scales the height linearly from a large reference size', () => {
    const [a, b] = withBBox(() => [measureText(layer(), 'average from', o), measureText(layer(), 'average from', { ...o, size: 11 })]);
    expect(a.w).toBeCloseTo(0.5 * 22 * 12);
    // At 22 this engine says (16 + 5) / 0.666 = 31.5 (1.43 em); at the reference size, 1.38 em.
    expect(a.h / 22).toBeCloseTo((Math.ceil(1.07 * 66.6) + Math.ceil(0.3 * 66.6)) / 66.6, 3);
    expect(b.h / 11).toBeCloseTo(a.h / 22, 6);
  });
  it('keys the height by font setup, not glyphs', () => {
    expect(heightKey('Hxg', o)).toBe(heightKey('ace', o));
    expect(heightKey('x_1 rises', o)).not.toBe(heightKey('rises', o));
    expect(heightKey('rises', { ...o, weight: 600 })).not.toBe(heightKey('rises', o));
  });
});
