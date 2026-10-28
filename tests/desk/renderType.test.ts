// tests/desk/renderType.test.ts — math symbols in labels share KaTeX's math italic
import { describe, it, expect } from 'vitest';
import { textSegments, makeText, own, reveal } from '../../src/desk/render';

const SVG = 'http://www.w3.org/2000/svg';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const layer = () => own(document.createElementNS(SVG, 'svg').appendChild(document.createElementNS(SVG, 'g')) as SVGGElement);

describe('textSegments', () => {
  it('a whole label that is one symbol is math', () => {
    for (const s of ['x', 'C', 'O', 'B', 'f', 'z', 'θ', 'a']) expect(textSegments(s), s).toEqual([{ text: s, math: true }]);
    expect(textSegments("x'")).toEqual([{ text: 'x′', math: true }]);
    expect(textSegments('l′')).toEqual([{ text: 'l′', math: true }]);
    expect(textSegments('x_L')).toEqual([{ text: 'x', math: true, sub: 'L' }]);
    expect(textSegments('x₁')).toEqual([{ text: 'x', math: true, sub: '1' }]);
  });
  it('words stay plain', () => {
    for (const s of ['near', 'far', 'image 1', 'depth', 'Ox']) expect(textSegments(s).every((g) => !g.math), s).toBe(true);
  });
  it('symbols in running text are picked out; a, A and I stay words; punctuation stays plain', () => {
    expect(textSegments('a match for x sits on l′')).toEqual([
      { text: 'a match for ' }, { text: 'x', math: true }, { text: ' sits on ' }, { text: 'l′', math: true },
    ]);
    expect(textSegments('depth z, then x′.')).toEqual([
      { text: 'depth ' }, { text: 'z', math: true }, { text: ', then ' }, { text: 'x′', math: true }, { text: '.' },
    ]);
  });
});

describe('makeText', () => {
  it('plain text is one text node in the label weight', () => {
    const t = makeText(layer(), { x: 0, y: 10 }, 'near', { size: 15, style: 'live', color: '#3A3A3C' });
    expect(t.querySelector('tspan')).toBeNull();
    expect(t.getAttribute('font-weight')).toBe('450');
    expect(t.getAttribute('fill')).toBe('#3A3A3C');
  });
  it('symbols are set in the math italic, in their own color', () => {
    const t = makeText(layer(), { x: 0, y: 10 }, 'x′ must be on l′', { size: 20, style: 'live', color: '#3A3A3C', symColor: '#1D1D1F' });
    const spans = [...t.querySelectorAll('tspan')];
    expect(spans.map((s) => s.textContent)).toEqual(['x′', ' must be on ', 'l′']);
    expect(spans[0].getAttribute('font-family')).toMatch(/^KaTeX_Math/);
    expect(spans[0].getAttribute('font-style')).toBe('italic');
    expect(spans[0].getAttribute('fill')).toBe('#1D1D1F');
    expect(spans[1].getAttribute('font-family')).toBeNull();
    expect(t.textContent).toBe('x′ must be on l′');
  });
  it('a subscript drops and the next piece comes back up', () => {
    const t = makeText(layer(), { x: 0, y: 10 }, 'x_L is left', { size: 20, style: 'live', color: '#000' });
    const spans = [...t.querySelectorAll('tspan')];
    expect(spans.map((s) => s.textContent)).toEqual(['x', 'L', ' is left']);
    expect(Number(spans[1].getAttribute('dy'))).toBeGreaterThan(0);
    expect(Number(spans[2].getAttribute('dy'))).toBe(-Number(spans[1].getAttribute('dy')));
  });
  it('hand style stays all handwriting', () => {
    const t = makeText(layer(), { x: 0, y: 10 }, 'x′', { size: 15, style: 'hand', color: '#000' });
    expect(t.querySelector('tspan')).toBeNull();
  });
  it('reveal writes a mixed text glyph by glyph and restores its pieces', async () => {
    const g = layer();
    makeText(g, { x: 0, y: 10 }, 'on l′', { size: 15, style: 'live', color: '#000' });
    const p = reveal(g, { x: 0, y: 0, w: 50, h: 20 }, 5, { style: 'live', speed: 1 });
    await sleep(30);
    expect(g.querySelectorAll('tspan tspan').length).toBeGreaterThan(1);
    await p;
    const spans = [...g.querySelectorAll('text > tspan')];
    expect(spans.map((s) => s.textContent)).toEqual(['on ', 'l′']);
    expect(g.querySelector('tspan tspan')).toBeNull();
  });
});
