// src/desk/svgBoard.ts — EXPERIMENT (PETU_PROMPT_VARIANT=svgboard; server/svgBoard.ts).
/**
 * The model's board as one free SVG: sanitized, mounted into a board section with every <g id> hidden,
 * and revealed group by group on the narration's {{show a,b}} — strokes draw on (stroke-dasharray),
 * fills and text fade in. Minimal on purpose.
 */
let pending: string | null = null;
/** The SVG of the answer in flight (its `svg` event arrives just before the {{svgboard}} tag). */
export const setPendingSvg = (s: string) => { pending = s; };
const takePending = () => { const s = pending; pending = null; return s; };

/** Groups by id of the boards mounted in this page (latest wins). */
const groups = new Map<string, SVGGElement>();

const BAD = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed', 'image', 'audio', 'video', 'animate', 'set', 'animatemotion', 'animatetransform']);

function sanitize(src: string): SVGSVGElement | null {
  const doc = new DOMParser().parseFromString(src, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) {
    console.warn('[svgboard] invalid svg');
    return null;
  }
  const walk = (el: Element) => {
    for (const c of Array.from(el.children)) {
      if (BAD.has(c.nodeName.toLowerCase())) { c.remove(); continue; }
      for (const a of Array.from(c.attributes)) {
        const n = a.name.toLowerCase(), v = a.value.trim();
        if (n.startsWith('on')) c.removeAttribute(a.name);
        else if ((n === 'href' || n === 'xlink:href') && !v.startsWith('#')) c.removeAttribute(a.name);
        else if (/url\(\s*['"]?(?!#)/i.test(v)) c.removeAttribute(a.name);
      }
      if (c.nodeName.toLowerCase() === 'style') c.textContent = (c.textContent ?? '').replace(/@import[^;]*;?/gi, '').replace(/url\(\s*['"]?(?!#)[^)]*\)/gi, 'none');
      walk(c);
    }
  };
  for (const a of Array.from(root.attributes)) if (a.name.toLowerCase().startsWith('on')) root.removeAttribute(a.name);
  walk(root);
  return document.importNode(root, true) as unknown as SVGSVGElement;
}

/** Mounts the pending SVG into `layer` (a section's ink layer, viewBox 0 0 1000 700). A string is a skip reason. */
export function mountSvgBoard(layer: SVGGElement): string | void {
  const src = takePending();
  if (!src) return 'no svg';
  const svg = sanitize(src);
  if (!svg) return 'invalid svg';
  svg.setAttribute('x', '0'); svg.setAttribute('y', '0'); svg.setAttribute('width', '1000'); svg.setAttribute('height', '700');
  if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', '0 0 1000 700');
  svg.setAttribute('overflow', 'visible');
  svg.setAttribute('data-svgboard', '');
  groups.clear();
  svg.querySelectorAll('g[id]').forEach((g) => {
    (g as SVGGElement).style.visibility = 'hidden';
    groups.set(g.id, g as SVGGElement);
  });
  layer.appendChild(svg);
}

const SHAPES = 'path,line,polyline,polygon,circle,ellipse,rect';
const DRAW_MS = 700, FADE_MS = 450;

/** Reveals groups `ids` (a group's own content; nested groups with ids wait for their own show). */
export function showSvgGroups(ids: string[]): string | void {
  const miss: string[] = [];
  for (const id of ids) {
    const g = groups.get(id);
    if (!g) { miss.push(id); continue; }
    if (g.style.visibility === 'visible') continue;
    // Its ancestors' wrappers must not hide it: visibility is inherited, so set it on the group itself.
    g.style.visibility = 'visible';
    g.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: 'ease-out' });
    g.querySelectorAll(SHAPES).forEach((el) => {
      if (el.closest('g[id]') !== g) return; // a nested group draws on its own show
      const sh = el as SVGGeometryElement;
      const cs = getComputedStyle(sh);
      if (!cs.stroke || cs.stroke === 'none' || (cs.strokeDasharray && cs.strokeDasharray !== 'none')) return;
      let len = 0;
      try { len = sh.getTotalLength(); } catch { return; }
      if (!(len > 0)) return;
      sh.animate([{ strokeDasharray: `${len} ${len}`, strokeDashoffset: `${len}` }, { strokeDasharray: `${len} ${len}`, strokeDashoffset: '0' }], { duration: Math.min(1400, DRAW_MS + len * 0.4), easing: 'ease-in-out' });
    });
  }
  if (miss.length) return `unknown svg group ${miss.join(',')}`;
}

/** Shows every group (the answer ended or was skipped). */
export function showAllSvgGroups(): void { groups.forEach((g) => { g.style.visibility = 'visible'; }); }
