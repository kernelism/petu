// src/desk/kit/text.ts
/** Kit type: the UI sans with tabular numerals, centred on its point. Measured with a canvas (estimated in jsdom). */
const SVGNS = 'http://www.w3.org/2000/svg';
export const KIT_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif';

let ctx2d: CanvasRenderingContext2D | null | undefined;
/** Width of `s` at `px` CSS px (weight 400 unless given). */
export function textWidth(s: string, px: number, weight = 400): number {
  if (ctx2d === undefined) {
    try {
      const c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
      ctx2d = c && typeof c.getContext === 'function' && !/jsdom/i.test(navigator.userAgent) ? c.getContext('2d') : null;
    } catch { ctx2d = null; }
  }
  if (ctx2d) {
    ctx2d.font = `${weight} ${px}px ${KIT_FONT}`;
    try { (ctx2d as unknown as { fontVariantNumeric: string }).fontVariantNumeric = 'tabular-nums'; } catch { /* older engines */ }
    return ctx2d.measureText(s).width;
  }
  return Array.from(s).length * px * 0.58;
}

export type TextLook = { size: number; fill: string; anchor?: 'start' | 'middle' | 'end'; weight?: number; opacity?: number; halo?: string; haloW?: number };

const set = (el: Element, a: Record<string, string | number>) => Object.entries(a).forEach(([k, v]) => el.setAttribute(k, String(v)));

/** A text element whose vertical centre is at y. */
export function kitText(g: Element, x: number, y: number, s: string, o: TextLook): SVGTextElement {
  const t = document.createElementNS(SVGNS, 'text');
  set(t, {
    x, y, 'font-size': o.size, 'font-family': KIT_FONT, 'text-anchor': o.anchor ?? 'middle', 'dominant-baseline': 'central',
    fill: o.fill, 'font-weight': o.weight ?? 400,
  });
  t.style.fontVariantNumeric = 'tabular-nums';
  if (o.opacity != null) t.setAttribute('opacity', String(o.opacity));
  if (o.halo) set(t, { 'paint-order': 'stroke', stroke: o.halo, 'stroke-width': o.haloW ?? o.size * 0.3, 'stroke-linejoin': 'round' });
  t.textContent = s;
  g.appendChild(t);
  return t;
}

export function svg<K extends keyof SVGElementTagNameMap>(parent: Element, tag: K, a: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVGNS, tag);
  set(el, a);
  parent.appendChild(el);
  return el;
}
export const setAttrs = set;
