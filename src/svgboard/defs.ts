// src/svgboard/defs.ts — a withheld beat's definitions, kept on the board without its ink.
/**
 * Later groups build on earlier ones: the first group usually names the case's constants (data-const)
 * and its frame (data-axes), and a later one places a point at cross(d,s) on curves drawn before it. When
 * the gate withholds a beat (src/gate/live.ts), its words and drawing go, but what it defined must not:
 * otherwise every later group fails "unknown constant" / "no curve" and the whole board cascades away.
 * So the gate releases the withheld group's definitions as a group that draws nothing (`data-defs`,
 * display none): its constants, frames, named curves and named points, in document order. The board
 * (element.ts defineSvgGroup) and the gate's state (engine.ts svgGroup) take them like any group's data;
 * neither draws, measures nor registers it. Its ids are not kept (a later group may still use them).
 */
import { parseGroup } from './sanitize';
import { DEFS_ATTR, isDefsGroup } from './wire';

export { DEFS_ATTR, isDefsGroup };

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const attrs = (o: Record<string, string | null | undefined>) => Object.entries(o).filter(([, v]) => v != null).map(([k, v]) => ` ${k}="${esc(v!)}"`).join('');

/** The definitions group `src` makes, as a group that draws nothing; null when it defines nothing (or does not parse). */
export function defsOf(src: string): string | null {
  const g = parseGroup(src);
  if (typeof g === 'string') return null;
  const parts: string[] = [];
  for (const el of [g, ...Array.from(g.querySelectorAll('*'))]) {
    const a = (k: string) => el.getAttribute(k);
    // The frame a curve inside an axes group uses by default (data.ts inheritAxes).
    let ax = el.hasAttribute('data-box') ? null : a('data-axes');
    for (let e = el.parentElement; !ax && e; e = e.parentElement) ax = e.getAttribute('data-axes');
    const name = a('data-name') ?? a('id');
    if (a('data-const') != null) parts.push(`<g${attrs({ 'data-const': a('data-const') })}/>`);
    if (a('data-axes') != null && a('data-box') != null) parts.push(`<g${attrs({ 'data-axes': a('data-axes'), 'data-x': a('data-x'), 'data-y': a('data-y'), 'data-box': a('data-box') })}/>`);
    if (name && (a('data-fn') != null || a('data-param') != null)) parts.push(`<path${attrs({ 'data-name': name, 'data-fn': a('data-fn'), 'data-param': a('data-param'), 'data-t': a('data-t'), 'data-x': a('data-x'), 'data-axes': ax })} fill="none"/>`);
    if (name && a('data-at') != null) parts.push(`<circle${attrs({ 'data-name': name, 'data-at': a('data-at') })} r="0"/>`);
  }
  return parts.length ? `<g ${DEFS_ATTR}="" display="none">${parts.join('')}</g>` : null;
}
