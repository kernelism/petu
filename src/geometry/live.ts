// src/geometry/live.ts — live geometry: numbers in a figure written as formulas over the answer's
// {{const}} names (src/desk/expr.ts grammar). They are evaluated every time the figure resolves, so a
// constant that changes (a {{tween}}, a {{limit}}, a {{beforeafter}}) moves everything built from it.
import { compileVars, freeNames, type VarFn } from '../desk/expr';

const cache = new Map<string, { names: string; f: VarFn | null }>();

/** A formula's value with these constants, or why it has none (`unknown constant th`, `bad formula …`). */
export function evalConst(src: string, consts: Record<string, number>): number | string {
  // A name no constant has (an integral's own variable aside, which compiles): the reason, when it fails.
  const why = () => { const m = freeNames(src)?.find((n) => !(n in consts)); return m ? `unknown constant ${m}` : `bad formula ${src}`; };
  const names = Object.keys(consts).sort().join(',');
  let hit = cache.get(src);
  if (!hit || hit.names !== names) {
    let f: VarFn | null = null;
    try { f = compileVars(src, Object.keys(consts)); } catch { f = null; }
    hit = { names, f };
    if (cache.size > 500) cache.clear();
    cache.set(src, hit);
  }
  if (!hit.f) return why();
  const v = hit.f(consts);
  if (Number.isFinite(v)) return v;
  const w = why();
  return w.startsWith('unknown') ? w : `${src} has no value`;
}
