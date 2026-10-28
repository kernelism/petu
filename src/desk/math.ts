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
  }).catch((e) => { katexP = null; throw e; }); // a failed chunk load (offline blip) is retried next time
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

/** el: the formula as native SVG (a `.desk-math` group translated to the box's top-left). */
export type MathBox = { el: SVGGElement; box: SRect; chars: number };

/**
 * Lays out KaTeX HTML with its left edge at at.x and its vertical middle at at.y, font `size`
 * target units, as native SVG: text runs, rules and KaTeX's own svg pieces.
 *
 * The formula is laid out once in plain HTML off screen at `size` CSS px (so 1 px = 1 target
 * unit, whatever the target's scale), measured, then rebuilt in SVG. It is not left as HTML in a
 * foreignObject: WebKit (Safari) paints a foreignObject's positioned HTML (KaTeX's `.base` is
 * position:relative) without the region's viewBox scale, so a formula landed at its unscaled y
 * (below its row by y × (1 − scale)) and at its unscaled size.
 * jsdom (no layout) falls back to one text run and an estimated box.
 */
export function placeMath(g: SVGGElement, at: SPt, html: string, size: number, color: string): MathBox {
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;contain:layout style';
  const div = host.appendChild(document.createElement('div'));
  div.style.cssText = `display:inline-block;white-space:nowrap;font-size:${size}px;line-height:1.2;color:${color}`;
  div.innerHTML = html;
  document.body.appendChild(host);
  const el = document.createElementNS(SVG, 'g') as SVGGElement;
  el.setAttribute('class', 'desk-math');
  const chars = (div.textContent ?? '').replace(/\s/g, '').length || 1;
  let w: number, h: number;
  try {
    const root = div.getBoundingClientRect();
    if (root.width > 0 && root.height > 0) {
      flatten(div, root, el);
      w = root.width;
      h = root.height;
    } else {
      const t = el.appendChild(document.createElementNS(SVG, 'text'));
      w = chars * size * 0.6;
      h = size * 1.4;
      setAttrs(t, { x: 0, y: h / 2, 'dominant-baseline': 'middle', 'font-size': size, 'font-family': 'KaTeX_Math', 'font-style': 'italic', fill: color });
      t.textContent = div.textContent ?? '';
    }
  } finally {
    host.remove();
  }
  g.appendChild(el);
  const m: MathBox = { el, box: { x: at.x, y: at.y - h / 2, w, h }, chars };
  setMathAt(m, m.box.x, m.box.y);
  return m;
}

/** Moves placed math so its box's top-left is (x, y) target units. */
export function setMathAt(m: MathBox, x: number, y: number): void {
  m.box = { ...m.box, x, y };
  m.el.setAttribute('transform', `translate(${x} ${y})`);
}

const setAttrs = (el: Element, a: Record<string, string | number>) => Object.entries(a).forEach(([k, v]) => el.setAttribute(k, String(v)));
const n2 = (v: number) => Math.round(v * 100) / 100;
const painted = (c: string) => !!c && c !== 'transparent' && !/^rgba\(.*,\s*0\)$/.test(c);

/** Rebuilds laid-out KaTeX HTML (`div`, box `root`) as SVG in `out`, coordinates relative to root's top-left. */
function flatten(div: HTMLElement, root: DOMRect, out: SVGGElement): void {
  // A zero-size inline-block's bottom sits on its line's baseline: one before each text run gives that run's baseline.
  const runs: { node: Text; mark: HTMLSpanElement }[] = [];
  const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    if (!t.data.trim() || t.parentElement?.closest('svg')) continue;
    const mark = document.createElement('span');
    mark.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
    t.parentNode!.insertBefore(mark, t);
    runs.push({ node: t, mark });
  }
  const range = document.createRange();
  const pieces: { x: number; el: SVGElement }[] = [];
  for (const { node, mark } of runs) {
    range.selectNodeContents(node);
    const r = typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : node.parentElement!.getBoundingClientRect();
    const cs = getComputedStyle(node.parentElement!);
    const t = document.createElementNS(SVG, 'text');
    setAttrs(t, {
      x: n2(r.left - root.left), y: n2(mark.getBoundingClientRect().bottom - root.top),
      'font-family': cs.fontFamily, 'font-size': cs.fontSize, 'font-style': cs.fontStyle, 'font-weight': cs.fontWeight, fill: cs.color,
    });
    t.setAttribute('xml:space', 'preserve');
    t.textContent = node.data;
    pieces.push({ x: r.left, el: t });
  }
  for (const e of div.querySelectorAll('*')) {
    if (e.closest('svg') && e.tagName.toLowerCase() !== 'svg') continue;
    const r = e.getBoundingClientRect();
    if (r.width <= 0 && r.height <= 0) continue;
    const cs = getComputedStyle(e);
    const x = r.left - root.left, y = r.top - root.top;
    if (e.namespaceURI === SVG) {
      // KaTeX's own svg pieces (radicals, stretchy braces and arrows): kept as svg, placed where they laid out.
      // KaTeX lays them out oversize (a radical's tail is 400em) inside an overflow:hidden span: clip to it.
      let clip: DOMRect = root;
      for (let a = e.parentElement; a && a !== div; a = a.parentElement) {
        const o = getComputedStyle(a);
        if (/hidden|clip/.test(o.overflowX + o.overflowY)) { clip = a.getBoundingClientRect(); break; }
      }
      const cx = Math.max(r.left, clip.left), cy = Math.max(r.top, clip.top);
      const cw = Math.min(r.right, clip.right) - cx, ch = Math.min(r.bottom, clip.bottom) - cy;
      if (cw <= 0 || ch <= 0) continue;
      const box = document.createElementNS(SVG, 'svg');
      setAttrs(box, { x: n2(cx - root.left), y: n2(cy - root.top), width: n2(cw), height: n2(ch), overflow: 'hidden' });
      const c = box.appendChild(e.cloneNode(true)) as SVGSVGElement;
      c.removeAttribute('style');
      setAttrs(c, { x: n2(r.left - cx), y: n2(r.top - cy), width: n2(r.width), height: n2(r.height), fill: cs.color, stroke: cs.color });
      pieces.push({ x: r.left, el: box });
      continue;
    }
    // Rules (fraction bars, over/underlines, \rule) are borders; \colorbox is a background.
    const rect = (rx: number, ry: number, rw: number, rh: number, fill: string) => {
      const b = document.createElementNS(SVG, 'rect');
      setAttrs(b, { x: n2(rx), y: n2(ry), width: n2(rw), height: n2(rh), fill });
      pieces.push({ x: root.left + rx, el: b });
    };
    if (painted(cs.backgroundColor)) rect(x, y, r.width, r.height, cs.backgroundColor);
    const bw = (side: 'Top' | 'Bottom' | 'Left' | 'Right') => (cs[`border${side}Style`] !== 'none' ? parseFloat(cs[`border${side}Width`]) || 0 : 0);
    const top = bw('Top'), bottom = bw('Bottom'), left = bw('Left'), right = bw('Right');
    if (top) rect(x, y, r.width, top, cs.borderTopColor);
    if (bottom) rect(x, y + r.height - bottom, r.width, bottom, cs.borderBottomColor);
    if (left) rect(x, y, left, r.height, cs.borderLeftColor);
    if (right) rect(x + r.width - right, y, right, r.height, cs.borderRightColor);
  }
  // Writing order: left to right (the reveal takes them in this order).
  pieces.sort((a, b) => a.x - b.x).forEach((p) => out.appendChild(p.el));
}

/** Reveals placed math left to right at writing pace (or fades it in). */
export function revealMath(g: SVGGElement, m: MathBox, o: { style: InkStyle; signal?: AbortSignal } & Pace): Promise<void> {
  return reveal(g, m.box, m.chars, o);
}
