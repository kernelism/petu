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
import { constDefs } from './data';
import { DEFS_ATTR, isDefsGroup } from './wire';

export { DEFS_ATTR, isDefsGroup };

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const attrs = (o: Record<string, string | null | undefined>) => Object.entries(o).filter(([, v]) => v != null).map(([k, v]) => ` ${k}="${esc(v!)}"`).join('');

/** Every definition a group makes, in document order: constants, frames, named curves and named points. */
function definitions(src: string): { kind: 'const' | 'axes' | 'curve' | 'point'; name: string; el: string }[] | null {
  const g = parseGroup(src);
  if (typeof g === 'string') return null;
  const out: { kind: 'const' | 'axes' | 'curve' | 'point'; name: string; el: string }[] = [];
  for (const el of [g, ...Array.from(g.querySelectorAll('*'))]) {
    const a = (k: string) => el.getAttribute(k);
    // The frame a curve inside an axes group uses by default (data.ts inheritAxes).
    let ax = el.hasAttribute('data-box') ? null : a('data-axes');
    for (let e = el.parentElement; !ax && e; e = e.parentElement) ax = e.getAttribute('data-axes');
    const name = a('data-name') ?? a('id');
    for (const [k, v] of constDefs(a('data-const') ?? '')) out.push({ kind: 'const', name: k, el: `${k}=${v}` });
    if (a('data-axes') != null && a('data-box') != null) out.push({ kind: 'axes', name: a('data-axes')!, el: `<g${attrs({ 'data-axes': a('data-axes'), 'data-x': a('data-x'), 'data-y': a('data-y'), 'data-box': a('data-box') })}/>` });
    if (name && (a('data-fn') != null || a('data-param') != null)) out.push({ kind: 'curve', name, el: `<path${attrs({ 'data-name': name, 'data-fn': a('data-fn'), 'data-param': a('data-param'), 'data-t': a('data-t'), 'data-x': a('data-x'), 'data-axes': ax })} fill="none"/>` });
    if (name && a('data-at') != null) out.push({ kind: 'point', name, el: `<circle${attrs({ 'data-name': name, 'data-at': a('data-at') })} r="0"/>` });
  }
  return out;
}

/** The names a group defines (lowercase, as data.ts reads them). */
export function definedNames(src: string): Set<string> {
  return new Set((definitions(src) ?? []).map((d) => `${d.kind}:${d.name.toLowerCase()}`));
}

/**
 * The definitions group `src` makes, as a group that draws nothing; null when it defines nothing (or does
 * not parse). `except` (definedNames of a repair that replaced it): names the replacement defines itself are
 * left out, so the original never overrides what the repair drew from (a frame moved, a curve rewritten).
 */
export function defsOf(src: string, except: Set<string> = new Set()): string | null {
  const ds = (definitions(src) ?? []).filter((d) => !except.has(`${d.kind}:${d.name.toLowerCase()}`));
  const parts: string[] = [];
  // Constants in their order, one data-const per run (a formula may read the ones before it).
  for (let i = 0; i < ds.length; i++) {
    if (ds[i].kind !== 'const') { parts.push(ds[i].el); continue; }
    const run: string[] = [];
    while (i < ds.length && ds[i].kind === 'const') run.push(ds[i++].el);
    i--;
    parts.push(`<g${attrs({ 'data-const': run.join('; ') })}/>`);
  }
  return parts.length ? `<g ${DEFS_ATTR}="" display="none">${parts.join('')}</g>` : null;
}
