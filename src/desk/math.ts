// src/desk/math.ts
import type { SPt, SRect } from '../geometry/space';
import type { InkStyle } from '../ink/agent/marks';
import { reveal } from './render';
import type { Pace } from './types';

type Katex = typeof import('katex').default;
let katexP: Promise<Katex> | null = null;

/**
 * KaTeX loads lazily (its own chunk plus its CSS and fonts, all bundled by Vite from
 * node_modules: no CDN). The director calls this when a math tag is parsed, seconds before its word.
 */
export function preloadMath(): Promise<Katex> {
  katexP ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(async ([m]) => {
    // Measure with the real glyphs: a formula laid out in fallback fonts measures too narrow.
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    if (fonts?.load) await Promise.all(['KaTeX_Main', 'KaTeX_Math', 'KaTeX_Size1', 'KaTeX_Size2'].map((f) => fonts.load(`20px ${f}`).catch(() => []))).catch(() => {});
    return m.default;
  });
  return katexP;
}

/** TeX → KaTeX HTML, or null if it doesn't parse (a garbled formula is worse than none). */
export function texToHtml(katex: Katex, tex: string): string | null {
  try {
    return katex.renderToString(tex, { throwOnError: true, output: 'html', displayMode: false, trust: false, strict: 'ignore', maxSize: 10, maxExpand: 200 });
  } catch {
    return null;
  }
}

const SVG = 'http://www.w3.org/2000/svg';
const XHTML = 'http://www.w3.org/1999/xhtml';

export type MathBox = { fo: SVGForeignObjectElement; box: SRect; chars: number };

/**
 * Lays out KaTeX HTML in a foreignObject: left edge at at.x, vertical middle at at.y, font `size`
 * target units (CSS px inside the foreignObject are target units, so it scales with its target).
 * Measures the rendered box; jsdom (no layout) falls back to an estimate.
 */
export function placeMath(g: SVGGElement, at: SPt, html: string, size: number, color: string): MathBox {
  const fo = document.createElementNS(SVG, 'foreignObject') as SVGForeignObjectElement;
  fo.style.overflow = 'visible'; // a foreignObject clips its content by default
  const div = document.createElementNS(XHTML, 'div') as HTMLDivElement;
  div.style.cssText = `display:inline-block;white-space:nowrap;font-size:${size}px;line-height:1.2;color:${color}`;
  div.innerHTML = html;
  fo.appendChild(div);
  fo.setAttribute('x', String(at.x));
  fo.setAttribute('width', String(Math.max(1, 1000 - at.x)));
  fo.setAttribute('height', String(size * 4));
  g.appendChild(fo);
  const r = div.getBoundingClientRect(), svg = g.ownerSVGElement;
  const k = svg && svg.getBoundingClientRect().width > 0 ? svg.viewBox.baseVal.width / svg.getBoundingClientRect().width : 1;
  const chars = (div.textContent ?? '').replace(/\s/g, '').length || 1;
  const w = r.width > 0 ? r.width * k : chars * size * 0.6;
  const h = r.height > 0 ? r.height * k : size * 1.4;
  fo.setAttribute('width', String(w + 2));
  fo.setAttribute('height', String(h + 2));
  fo.setAttribute('y', String(at.y - h / 2));
  return { fo, box: { x: at.x, y: at.y - h / 2, w, h }, chars };
}

/** Reveals placed math left to right at writing pace (or fades it in). */
export function revealMath(g: SVGGElement, m: MathBox, o: { style: InkStyle; signal?: AbortSignal } & Pace): Promise<void> {
  return reveal(g, m.box, m.chars, o);
}
