import type { SPt, SRect } from '../../geometry/space';

const SVG = 'http://www.w3.org/2000/svg';
export type InkStyle = 'live' | 'hand' | 'clean';

/** Label font size in page-space units (scales with the page like ink on paper). */
const LABEL = {
  live: { size: 17, family: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif', weight: 600 },
  clean: { size: 15, family: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif', weight: 600 },
  hand: { size: 21, family: '"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive', weight: 700 },
};

export function drawLabel(g: SVGGElement, at: SPt, text: string, style: InkStyle, color: string): Promise<void> {
  const f = LABEL[style];
  const wrap = document.createElementNS(SVG, 'g');
  const t = document.createElementNS(SVG, 'text');
  t.setAttribute('x', String(at.x));
  t.setAttribute('y', String(at.y));
  t.setAttribute('font-size', String(f.size));
  t.setAttribute('font-family', f.family);
  t.setAttribute('font-weight', String(f.weight));
  t.setAttribute('dominant-baseline', 'middle');
  t.textContent = text;
  wrap.appendChild(t);
  g.appendChild(wrap);
  if (style === 'clean') {
    const b = t.getBBox();
    const r = document.createElementNS(SVG, 'rect');
    Object.entries({ x: b.x - 7, y: b.y - 4, width: b.width + 14, height: b.height + 8, rx: 6, fill: color })
      .forEach(([k, v]) => r.setAttribute(k, String(v)));
    wrap.insertBefore(r, t);
    t.setAttribute('fill', '#fff');
  } else t.setAttribute('fill', color);
  wrap.style.opacity = '0';
  wrap.style.transform = 'translateY(2px)';
  wrap.style.transition = 'opacity 260ms ease-out, transform 260ms ease-out';
  requestAnimationFrame(() => { wrap.style.opacity = '1'; wrap.style.transform = 'none'; });
  return new Promise((r) => setTimeout(r, 260));
}

/** One rect per line behind the text. Sweeps left to right, line by line (~550ms total). */
export async function drawHighlight(g: SVGGElement, rects: SRect[], color: string, opacity = 0.5): Promise<void> {
  const total = rects.reduce((s, r) => s + r.w, 0) || 1;
  for (const r of rects) {
    const el = document.createElementNS(SVG, 'rect');
    const pad = r.h * 0.12;
    Object.entries({ x: r.x - pad, y: r.y, width: r.w + pad * 2, height: r.h, rx: Math.min(4, r.h * 0.2), fill: color, opacity })
      .forEach(([k, v]) => el.setAttribute(k, String(v)));
    const ms = Math.max(160, Math.round(550 * (r.w / total)));
    el.style.transformBox = 'fill-box';
    el.style.transformOrigin = 'left center';
    el.style.transform = 'scaleX(0)';
    el.style.transition = `transform ${ms}ms cubic-bezier(.3,0,.2,1)`;
    g.appendChild(el);
    await new Promise((res) => requestAnimationFrame(res));
    el.style.transform = 'scaleX(1)';
    await new Promise((res) => setTimeout(res, ms));
  }
}

/** Fades out and removes all children of the given groups. */
export function fadeOut(groups: SVGGElement[], ms = 300): Promise<void> {
  for (const g of groups) { g.style.transition = `opacity ${ms}ms ease-out`; g.style.opacity = '0'; }
  return new Promise((r) => setTimeout(() => {
    for (const g of groups) { g.replaceChildren(); g.style.transition = ''; g.style.opacity = '1'; }
    r();
  }, ms));
}
