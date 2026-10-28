// tests/desk/math.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
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
    expect(g.querySelector('foreignObject')).toBeNull();
    expect(g.querySelector('.desk-math')).not.toBeNull();
  });
});

describe('math placement across region scales (regression: labels below their rows in WebKit)', () => {
  afterEach(() => vi.restoreAllMocks());
  const SVGNS = 'http://www.w3.org/2000/svg';
  /** A region svg (viewBox 0 0 1000 700) drawn `px` wide, and a stand-in layout: KaTeX's box is 1.2 em tall, 0.6 em per glyph. */
  function region(px: number) {
    const svg = document.createElementNS(SVGNS, 'svg') as SVGSVGElement;
    svg.setAttribute('viewBox', '0 0 1000 700');
    const g = svg.appendChild(document.createElementNS(SVGNS, 'g')) as SVGGElement;
    document.body.appendChild(svg);
    const rect = (x: number, y: number, w: number, h: number) => ({ x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, toJSON() {} }) as DOMRect;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this === svg) return rect(800, 100, px, px * 0.7);
      const fs = parseFloat((this as HTMLElement).style?.fontSize || '') || parseFloat(getComputedStyle(this).fontSize) || 17;
      const n = (this.textContent ?? '').length;
      return rect(0, 0, n * fs * 0.6, fs * 1.2);
    });
    return { svg, g };
  }
  it('the formula is native svg in target units: its middle stays on `at` y at every region width and DPR', async () => {
    const k = await preloadMath();
    const html = texToHtml(k, '2z')!;
    const seen: string[] = [];
    for (const px of [300, 518, 600, 1000, 1400]) {
      const { svg, g } = region(px);
      const m = placeMath(g, { x: 50, y: 470 }, html, 17, '#1D1D1F');
      expect(m.box.y + m.box.h / 2).toBeCloseTo(470);
      expect(m.box.h).toBeCloseTo(17 * 1.2); // laid out at 17 CSS px = 17 target units, not divided by the region's scale
      expect(g.querySelector('foreignObject')).toBeNull(); // WebKit paints foreignObject HTML without the viewBox scale
      seen.push(m.el.getAttribute('transform')!);
      svg.remove();
      vi.restoreAllMocks();
    }
    expect(new Set(seen).size).toBe(1);
  });
});
