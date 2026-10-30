// src/svgboard/sanitize.ts — one model SVG group → a safe, board-styled element.
/**
 * Safety: parsed as XML (a parse error rejects the group); script, foreignObject, style, images,
 * media, animation and anything unknown are removed; event handlers, external hrefs and url()s that
 * point outside the group's own ids are dropped; size is capped. Ids are namespaced per board
 * (`<board>-<id>`) and references rewritten, so markers and gradients never collide with the page's
 * or another answer's.
 * Style (style.ts): colours to the board palette, fonts to the board's faces, text never under
 * `minFont` user units (the board body size), strokes in the board's widths (non-scaling), a paper
 * halo behind text so a label stays legible where it meets a line. A full-board white backing rect is
 * dropped (the board is the paper).
 */
import { FONT_SANS, INK, mapColor, mapFont, mapStrokeWidth, type Palette } from './style';

const NS = 'http://www.w3.org/2000/svg';
/** Elements kept (lowercase). */
const ALLOWED = new Set(['g', 'defs', 'path', 'line', 'polyline', 'polygon', 'rect', 'circle', 'ellipse', 'text', 'tspan', 'marker', 'lineargradient', 'radialgradient', 'stop', 'clippath', 'pattern', 'use', 'title', 'desc', 'symbol']);
/** Attributes kept (lowercase), besides the presentation ones normalised below. */
const ATTRS = new Set(['id', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'd', 'points', 'transform', 'dx', 'dy',
  'text-anchor', 'dominant-baseline', 'alignment-baseline', 'font-weight', 'font-style', 'font-size', 'font-family', 'letter-spacing',
  'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'fill-opacity', 'stroke-opacity', 'fill-rule',
  'marker-start', 'marker-mid', 'marker-end', 'viewbox', 'refx', 'refy', 'markerwidth', 'markerheight', 'markerunits', 'orient', 'preserveaspectratio',
  'offset', 'stop-color', 'stop-opacity', 'gradientunits', 'gradienttransform', 'x1', 'fx', 'fy', 'clip-path', 'href', 'xlink:href', 'patternunits', 'rotate', 'textlength', 'lengthadjust', 'baseline-shift']);
/** Style properties lifted into attributes. */
const STYLE_PROPS = new Set(['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'fill-opacity', 'stroke-opacity',
  'font-size', 'font-family', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'marker-start', 'marker-mid', 'marker-end', 'letter-spacing']);
export const MAX_ELEMENTS = 800;
export const MAX_CHARS = 20000;
const SHAPES = new Set(['path', 'line', 'polyline', 'polygon', 'rect', 'circle', 'ellipse']);

export type SanitizeOpts = {
  /** Namespace for ids (the board section's id). */
  ns: string;
  palette: Palette;
  /** Smallest text, in the board's user units. */
  minFont: number;
  /** The board canvas (a full-canvas white backing is dropped). */
  w: number; h: number;
  /** Ids already defined on this board: model id → namespaced id (shared across its groups). */
  ids: Map<string, string>;
  doc?: Document;
  /** Runs on the parsed group before styling (exact data, text fitting): src/svgboard/{data,polish}.ts. */
  prepare?: (g: Element) => void;
};

export type Sanitized = { el: SVGGElement; id?: string; notes: string[] };

const num = (v: string | null | undefined): number | null => { if (v == null) return null; const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

/** Parses one group (raw SVG markup). A string is the reason it was rejected. */
export function parseGroup(src: string): Element | string {
  if (src.length > MAX_CHARS) return `svg group over ${MAX_CHARS} characters`;
  if (typeof DOMParser === 'undefined') return 'no DOMParser';
  const xml = `<svg xmlns="${NS}" xmlns:xlink="http://www.w3.org/1999/xlink">${src}</svg>`;
  const doc = new DOMParser().parseFromString(xml, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length) return 'svg does not parse';
  const kids = Array.from(root.children);
  if (!kids.length) return 'empty svg group';
  if (kids.length === 1 && kids[0].nodeName.toLowerCase() === 'g') return kids[0];
  // Several top-level elements: one anonymous group around them.
  const g = doc.createElementNS(NS, 'g');
  for (const k of kids) g.appendChild(k);
  return g;
}

/** Rough area of a filled shape (user units²), for softening large fills. */
function areaOf(el: Element, name: string): number {
  const n = (k: string) => num(el.getAttribute(k)) ?? 0;
  // A bar or a dot is a mark (it stays solid); a wide area is a wash.
  if (name === 'rect') return Math.min(n('width'), n('height')) > 40 ? n('width') * n('height') : 0;
  if (name === 'circle') return n('r') > 24 ? Math.PI * n('r') ** 2 : 0;
  if (name === 'ellipse') return Math.PI * n('rx') * n('ry');
  const v = (name === 'path' ? el.getAttribute('d') : el.getAttribute('points'))?.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];
  if (v.length < 4) return 0;
  const xs = v.filter((_, i) => i % 2 === 0), ys = v.filter((_, i) => i % 2 === 1);
  // The bounding box, halved (a curve's region is rarely its whole box).
  return ((Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))) / 2;
}

export function sanitizeGroup(src: string, o: SanitizeOpts): Sanitized | string {
  const parsed = parseGroup(src);
  if (typeof parsed === 'string') return parsed;
  const notes: string[] = [];
  let count = 0;
  o.prepare?.(parsed);
  const modelId = parsed.getAttribute('id') ?? undefined;
  // Ids defined in the group join the board's map before any reference is rewritten.
  parsed.querySelectorAll('[id]').forEach((e) => { const id = e.getAttribute('id')!; o.ids.set(id, `${o.ns}-${id}`); });
  if (modelId) o.ids.set(modelId, `${o.ns}-${modelId}`);
  const ref = (id: string) => o.ids.get(id) ?? null;
  const fixUrl = (v: string): string | null => {
    // url(#id) to a known id only; anything else is dropped.
    let ok = true;
    const out = v.replace(/url\(\s*['"]?([^'")]*)['"]?\s*\)/gi, (_m, u: string) => {
      const r = u.startsWith('#') ? ref(u.slice(1)) : null;
      if (!r) { ok = false; return 'none'; }
      return `url(#${r})`;
    });
    return ok ? out : null;
  };

  const walk = (el: Element, fontUp: number | null, depth: number) => {
    const name = el.nodeName.toLowerCase().replace(/^svg:/, '');
    // Styles move into attributes first (so normalisation sees one place).
    const style = el.getAttribute('style');
    if (style) {
      for (const decl of style.split(';')) {
        const i = decl.indexOf(':');
        if (i < 0) continue;
        const k = decl.slice(0, i).trim().toLowerCase(), v = decl.slice(i + 1).trim();
        if (STYLE_PROPS.has(k) && !el.hasAttribute(k)) el.setAttribute(k, v);
      }
      el.removeAttribute('style');
    }
    for (const a of Array.from(el.attributes)) {
      const n = a.name.toLowerCase();
      if (n.startsWith('on') || !ATTRS.has(n) && !n.startsWith('data-')) { el.removeAttribute(a.name); continue; }
      if (n === 'href' || n === 'xlink:href') {
        const r = a.value.startsWith('#') ? ref(a.value.slice(1)) : null;
        if (r) el.setAttribute(a.name, `#${r}`); else el.removeAttribute(a.name);
        continue;
      }
      if (/url\(/i.test(a.value)) { const v = fixUrl(a.value); if (v == null) el.removeAttribute(a.name); else el.setAttribute(a.name, v); }
    }
    const id = el.getAttribute('id');
    if (id) { el.setAttribute('id', ref(id) ?? `${o.ns}-${id}`); }
    // Presentation: colours, fonts, widths.
    const isText = name === 'text' || name === 'tspan';
    const opacity = (k: 'fill-opacity' | 'stroke-opacity', f: number) => { if (f === 1) return; const cur = num(el.getAttribute(k)) ?? 1; el.setAttribute(k, String(Math.round(cur * f * 1000) / 1000)); };
    for (const k of ['fill', 'stroke', 'stop-color'] as const) {
      const v = el.getAttribute(k);
      if (v == null || /^url\(/i.test(v)) continue;
      const m = mapColor(v, k === 'stroke' ? 'stroke' : isText ? 'text' : 'fill', o.palette);
      if (!m) continue;
      el.setAttribute(k, m.color);
      if (k === 'stop-color') { if (m.alpha !== 1) el.setAttribute('stop-opacity', String(m.alpha)); }
      else opacity(k === 'fill' ? 'fill-opacity' : 'stroke-opacity', m.alpha);
    }
    if (el.hasAttribute('font-family')) el.setAttribute('font-family', mapFont(el.getAttribute('font-family')));
    let font = fontUp;
    const fs = el.getAttribute('font-size');
    if (fs != null) { const v = num(fs); if (v != null && !/%|em/.test(fs)) font = v; }
    if (isText) {
      // Legible ink: text never fades below 0.8 (a faint label is a missed label).
      for (const k of ['opacity', 'fill-opacity'] as const) { const v = num(el.getAttribute(k)); if (v != null && v < 0.8) el.setAttribute(k, '0.8'); }
      const eff = font ?? 16;
      if (eff < o.minFont) { el.setAttribute('font-size', String(Math.round(o.minFont * 10) / 10)); font = o.minFont; }
      if (name === 'text') {
        if (!el.hasAttribute('font-family')) el.setAttribute('font-family', FONT_SANS);
        if (!el.hasAttribute('fill') && !el.closest('[fill]')) el.setAttribute('fill', INK.ink);
        // A paper halo: text stays legible where a line passes behind it.
        if (!el.hasAttribute('stroke')) {
          el.setAttribute('stroke', INK.paper); el.setAttribute('stroke-width', '4'); el.setAttribute('stroke-linejoin', 'round');
          el.setAttribute('paint-order', 'stroke'); el.setAttribute('vector-effect', 'non-scaling-stroke');
        }
      }
    }
    if (SHAPES.has(name) || name === 'g') {
      const sw = el.getAttribute('stroke-width');
      if (sw != null || (SHAPES.has(name) && (el.getAttribute('stroke') ?? '') !== '')) el.setAttribute('stroke-width', String(mapStrokeWidth(num(sw))));
      if (SHAPES.has(name)) el.setAttribute('vector-effect', 'non-scaling-stroke');
      // Dashes in CSS px, like the board's own (non-scaling).
      const da = el.getAttribute('stroke-dasharray');
      if (da && da !== 'none') el.setAttribute('stroke-dasharray', da.split(/[\s,]+/).map((x) => String(Math.max(2, Math.min(12, (num(x) ?? 4))))).join(' '));
    }
    // Strokes stay visible (a guide may be faint, never invisible).
    if (SHAPES.has(name)) { const so = num(el.getAttribute('stroke-opacity')); if (so != null && so < 0.4 && (el.getAttribute('stroke') ?? 'none') !== 'none') el.setAttribute('stroke-opacity', '0.4'); }
    // Soft fills: a large area in a strong colour becomes a wash (dots and small marks stay solid).
    if (SHAPES.has(name) && name !== 'line') {
      const f = el.getAttribute('fill');
      const area = areaOf(el, name);
      if (f && f !== 'none' && f !== INK.paper && f !== INK.sheet && !/^url/i.test(f) && area > 2400) {
        const fo = (num(el.getAttribute('fill-opacity')) ?? 1) * (num(el.getAttribute('opacity')) ?? 1);
        const cap = f === o.palette.accent ? 0.2 : f === INK.line ? 0.9 : 0.16;
        if (fo > cap) { el.setAttribute('fill-opacity', String(cap / (num(el.getAttribute('opacity')) ?? 1))); notes.push('fill softened'); }
      }
    }
    // A backing rect over (nearly) the whole canvas: the board is already paper.
    if (name === 'rect' && depth <= 1) {
      const w = num(el.getAttribute('width')) ?? 0, h = num(el.getAttribute('height')) ?? 0;
      const f = el.getAttribute('fill');
      if (w >= o.w * 0.9 && h >= o.h * 0.9 && (f === INK.paper || f === INK.sheet)) { el.remove(); notes.push('backing rect dropped'); return; }
    }
    for (const c of Array.from(el.children)) {
      const cn = c.nodeName.toLowerCase().replace(/^svg:/, '');
      if (!ALLOWED.has(cn)) { c.remove(); notes.push(`removed <${cn}>`); continue; }
      if (++count > MAX_ELEMENTS) { c.remove(); continue; }
      walk(c, font, depth + 1);
    }
  };
  walk(parsed, null, 0);
  // A data attribute that did not resolve: never drawn wrong, so not drawn (data.ts; the gate flagged it).
  parsed.querySelectorAll('[data-bad]').forEach((e) => { e.setAttribute('display', 'none'); e.setAttribute('data-hid', ''); notes.push(`hidden: ${e.getAttribute('data-bad')}`); });
  if (count > MAX_ELEMENTS) notes.push(`over ${MAX_ELEMENTS} elements: cut`);
  if (modelId) { parsed.setAttribute('data-svg-id', modelId); }
  parsed.setAttribute('data-svg-group', '');
  const doc = o.doc ?? document;
  const el = doc.importNode(parsed, true) as unknown as SVGGElement;
  return { el, ...(modelId ? { id: modelId } : {}), notes };
}
