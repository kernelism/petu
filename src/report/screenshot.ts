// src/report/screenshot.ts — a PNG of the window, composed in the browser from what it paints:
// pdf.js page canvases, every visible SVG (agent ink, the board, connectors) and canvas (student ink),
// in document order, each clipped to its scrolling ancestors; the chrome (top bar, caption, ask bar)
// is drawn as plain boxes with its text. No library, no foreignObject (it taints the canvas in Safari).
//
// SVGs are serialized with their computed paint inlined (classes and CSS variables do not survive
// into an <img>). Web fonts (KaTeX) fall back to system fonts; external <image>s are dropped.

type Rect = { x: number; y: number; w: number; h: number };

const PAINT = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'stroke-opacity', 'fill-opacity', 'opacity', 'visibility', 'display', 'font-family', 'font-size', 'font-style', 'font-weight', 'text-anchor', 'dominant-baseline', 'paint-order', 'color'];
const CHROME = ['.topbar', '.toolbar', '.caption', '.askbar', '.follow-pill', '.debug'];

const intersect = (a: Rect, b: Rect): Rect | null => {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w), btm = Math.min(a.y + a.h, b.y + b.h);
  return r > x && btm > y ? { x, y, w: r - x, h: btm - y } : null;
};

/** The element's visible box: its rect clipped by every ancestor that clips overflow. Null when hidden. */
function clipOf(el: Element, view: Rect): Rect | null {
  const b = el.getBoundingClientRect();
  let r: Rect | null = intersect({ x: b.left, y: b.top, w: b.width, h: b.height }, view);
  for (let p = el.parentElement; p && r; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return null;
    if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
      const pb = p.getBoundingClientRect();
      r = intersect(r, { x: pb.left, y: pb.top, w: pb.width, h: pb.height });
    }
  }
  return r;
}

function opacityOf(el: Element): number {
  let o = 1;
  for (let p: Element | null = el; p; p = p.parentElement) { const v = parseFloat(getComputedStyle(p).opacity); if (Number.isFinite(v)) o *= v; }
  return o;
}

/** The SVG as a standalone image URL, its computed paint inlined. */
export function svgUrl(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const src = [svg, ...svg.querySelectorAll('*')];
  const dst = [clone, ...clone.querySelectorAll('*')];
  for (let i = 0; i < src.length; i++) {
    const cs = getComputedStyle(src[i]);
    const d = dst[i] as SVGElement;
    let style = '';
    for (const p of PAINT) { const v = cs.getPropertyValue(p); if (v) style += `${p}:${v};`; }
    const tr = cs.getPropertyValue('transform');
    if (tr && tr !== 'none' && i > 0) style += `transform:${tr};transform-origin:${cs.getPropertyValue('transform-origin')};transform-box:${cs.getPropertyValue('transform-box') || 'view-box'};`;
    d.setAttribute('style', style);
  }
  clone.querySelectorAll('foreignObject, script').forEach((n) => n.remove());
  clone.querySelectorAll('image').forEach((n) => { const h = n.getAttribute('href') ?? n.getAttribute('xlink:href') ?? ''; if (!h.startsWith('data:')) n.remove(); });
  const b = svg.getBoundingClientRect();
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(b.width));
  clone.setAttribute('height', String(b.height));
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
}

const load = (url: string) => new Promise<HTMLImageElement | null>((resolve) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => resolve(null);
  img.src = url;
});

/** Composes the window into a PNG data URL (scale ≤ 2; ~1 when the result would be large). */
export async function screenshot(opts: { scale?: number; doc?: Document } = {}): Promise<string> {
  const doc = opts.doc ?? document;
  const W = window.innerWidth, H = window.innerHeight;
  const scale = opts.scale ?? Math.min(2, window.devicePixelRatio || 1);
  const view: Rect = { x: 0, y: 0, w: W, h: H };
  const out = doc.createElement('canvas');
  out.width = Math.round(W * scale);
  out.height = Math.round(H * scale);
  const g = out.getContext('2d')!;
  g.scale(scale, scale);
  const bg = getComputedStyle(doc.body).backgroundColor;
  g.fillStyle = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' ? bg : '#f6f5f2';
  g.fillRect(0, 0, W, H);

  // Outermost SVGs and every canvas, in document order (≈ paint order for this app's layers).
  const els = [...doc.querySelectorAll('canvas, svg')].filter((el) => !(el.tagName.toLowerCase() === 'svg' && el.parentElement?.closest('svg')) && !el.closest(CHROME.join(',')) && el !== out);
  for (const el of els) {
    const clip = clipOf(el, view);
    if (!clip) continue;
    const o = opacityOf(el);
    if (o <= 0.01) continue;
    const b = el.getBoundingClientRect();
    let src: CanvasImageSource | null = null;
    if (el instanceof HTMLCanvasElement) { if (el.width && el.height) src = el; }
    else src = await load(svgUrl(el as SVGSVGElement));
    if (!src) continue;
    g.save();
    g.globalAlpha = o;
    g.beginPath();
    g.rect(clip.x, clip.y, clip.w, clip.h);
    g.clip();
    try { g.drawImage(src, b.left, b.top, b.width, b.height); } catch { /* a tainted or broken source: skip it */ }
    g.restore();
  }

  // Chrome: a translucent box with its visible text, so the caption and question read in the still.
  for (const sel of CHROME) {
    for (const el of doc.querySelectorAll<HTMLElement>(sel)) {
      if (el.closest('.report-pop')) continue;
      const clip = clipOf(el, view);
      if (!clip || opacityOf(el) < 0.05) continue;
      const cs = getComputedStyle(el);
      g.save();
      g.fillStyle = 'rgba(255,255,255,.88)';
      g.strokeStyle = 'rgba(0,0,0,.12)';
      const rr = parseFloat(cs.borderTopLeftRadius) || 0;
      g.beginPath();
      if (typeof g.roundRect === 'function') g.roundRect(clip.x, clip.y, clip.w, clip.h, rr);
      else g.rect(clip.x, clip.y, clip.w, clip.h);
      g.fill();
      g.stroke();
      g.fillStyle = '#1d1d1f';
      g.font = `13px ${cs.fontFamily || 'system-ui'}`;
      g.textBaseline = 'middle';
      const lines = (el.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean);
      const lh = 17;
      const top = clip.y + Math.max(lh / 2 + 2, (clip.h - lines.length * lh) / 2 + lh / 2);
      lines.slice(0, Math.max(1, Math.floor(clip.h / lh))).forEach((t, i) => g.fillText(t, clip.x + 12, top + i * lh, clip.w - 24));
      g.restore();
    }
  }
  const url = out.toDataURL('image/png');
  // Keep the upload small: past ~8 MB, redo at 1×.
  if (url.length > 8e6 && scale > 1) return screenshot({ ...opts, scale: 1 });
  return url;
}
