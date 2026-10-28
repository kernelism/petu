// tests/desk/math.test.ts
import { describe, it, expect } from 'vitest';
import { preloadMath, texToHtml, placeMath } from '../../src/desk/math';

describe('math (KaTeX, local)', () => {
  it('renders TeX to KaTeX HTML and refuses TeX that does not parse', async () => {
    const k = await preloadMath();
    expect(texToHtml(k, "x - x' = \\frac{B\\,f}{z}")).toContain('katex');
    expect(texToHtml(k, '\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}')).toContain('katex');
    expect(texToHtml(k, '\\frac{')).toBeNull();
    expect(texToHtml(k, '\\href{javascript:alert(1)}{x}')).not.toContain('javascript:');
  });
  it('places it left-edge / middle at `at`, sized in target units', async () => {
    const k = await preloadMath();
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g') as SVGGElement;
    const m = placeMath(g, { x: 100, y: 200 }, texToHtml(k, 'x^2')!, 30, '#000');
    expect(m.box.x).toBe(100);
    expect(m.box.y + m.box.h / 2).toBeCloseTo(200);
    expect(g.querySelector('foreignObject')).not.toBeNull();
  });
});
