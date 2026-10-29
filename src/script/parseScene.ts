// src/script/parseScene.ts
/**
 * Board v2 tags (spec "Board v2: one connected scene"): things placed by relation and the relations
 * between them. Each draws into a scene (`on=s`); placement is by relation, never by coordinates:
 *
 *   {{node on=s id=a "buyers" right=b}}        a labelled thing; value=0.4 or value=p[2] shows a small value under it
 *   {{flow on=s id=f "A" "B" "C" arrows}}      a sequence of chips (parts f[1]…); values=p shows p's values under them; down stacks it
 *   {{link on=s from=a to=b strength=0.6 "label"}}   a relation; strength (0–1, or a part p[2]) sets its weight; plain = no head
 *   {{link on=s from=f[3] to=f strength=p}}    one to every part of f, each weighted by p's value
 *   {{note on=s "text" annotate=f[2]}}         a callout with a leader line;  {{note on=s "text" below=a}} plain text by relation; value=p[2] adds p[2]'s live value
 *   {{group on=s id=g of=a,b,c "System 1"}}    a loose outline around things (follows them when they move)
 *   {{pair on=s from=a to=b "equal and opposite"}}   a bracket joining two things or parts
 *   {{merge on=s id=m of=a,b "both"}}          things glide together into one new chip
 *   {{split id=a "x" "y"}}                     a chip becomes several (parts a[1]…)
 */
import type { SceneShape, ValueRef } from './types';
import { isBlockRef, NAME, normName } from './pointExpr';
import { sceneRel } from './parseKit';

export const SCENE_TAGS = new Set(['node', 'flow', 'link', 'note', 'group', 'pair', 'merge']);
const MAX_TEXT = 60;
const eid = (s?: string) => { const n = s ? normName(s.trim().replace(/-/g, '_')) : ''; return n && NAME.test(n) ? n : undefined; };
/** An id or a part (`f[2]`). */
const ref = (s?: string) => (s && isBlockRef(s.trim()) ? s.trim() : eid(s));
/** A value: a number, or a block / part whose value is shown (live). */
export function valueRef(s?: string): ValueRef | undefined | null {
  if (s == null) return undefined;
  const n = Number(s.replace(/−/g, '-'));
  if (s.trim() !== '' && Number.isFinite(n)) return n;
  return ref(s) ?? null;
}

export function parseScene(name: string, args: Record<string, string>, quotes: string[], flags: Set<string>): SceneShape | null {
  const text = quotes[0]?.trim().slice(0, MAX_TEXT);
  const rel = sceneRel(args);
  if (rel === null) return null;
  const place = rel ? { place: rel } : {};
  switch (name) {
    case 'node': {
      const value = valueRef(args.value);
      if (!text || value === null) return null;
      return { kind: 'node', text, ...(value != null ? { value } : {}), ...place };
    }
    case 'flow': {
      const items = quotes.map((q) => q.trim().slice(0, MAX_TEXT)).filter(Boolean);
      const values = args.values != null ? eid(args.values) : undefined;
      if (items.length < 2 || items.length > 12 || (args.values != null && !values)) return null;
      return { kind: 'flow', items, ...(flags.has('arrows') ? { arrows: true } : {}), ...(flags.has('down') ? { down: true } : {}), ...(values ? { values } : {}), ...place };
    }
    case 'link': {
      const from = ref(args.from), to = ref(args.to);
      const strength = valueRef(args.strength);
      if (!from || !to || from === to || strength === null || rel) return null;
      if (typeof strength === 'number' && !(strength >= 0 && strength <= 1)) return null;
      return { kind: 'link', from, to, ...(strength != null ? { strength } : {}), ...(text ? { text } : {}), ...(flags.has('plain') ? { plain: true } : {}), ...(flags.has('dash') ? { dash: true } : {}), ...(flags.has('show') ? { showWeight: true } : {}) };
    }
    case 'note': {
      const annotate = args.annotate != null ? ref(args.annotate) : undefined;
      const value = valueRef(args.value);
      if (!text || (args.annotate != null && !annotate) || (annotate && rel) || value === null) return null;
      return { kind: 'note', text, ...(annotate ? { annotate } : {}), ...(value != null ? { value } : {}), ...place };
    }
    case 'group': {
      const of = refs(args.of);
      if (!of || rel) return null;
      return { kind: 'group', of, ...(text ? { text } : {}) };
    }
    case 'pair': {
      const from = ref(args.from), to = ref(args.to);
      if (!from || !to || from === to || rel) return null;
      return { kind: 'pair', from, to, ...(text ? { text } : {}) };
    }
    case 'merge': {
      const of = refs(args.of);
      if (!of || of.length < 2 || !text) return null;
      return { kind: 'merge', of, text, ...place };
    }
  }
  return null;
}

/** A list of things or parts: `of=a,b,f[2]` (1–12, each valid, no repeats). */
function refs(s?: string): string[] | null {
  if (!s) return null;
  const out = s.split(',').map((x) => ref(x));
  if (!out.length || out.length > 12 || out.some((x) => !x) || new Set(out).size !== out.length) return null;
  return out as string[];
}

/** `{{split id=a "x" "y"}}`: a chip becomes several. */
export function parseSplit(args: Record<string, string>, quotes: string[]): { kind: 'split'; ref: string; items: string[] } | null {
  const r = eid(args.id);
  const items = quotes.map((q) => q.trim().slice(0, MAX_TEXT)).filter(Boolean);
  return r && items.length >= 2 && items.length <= 8 ? { kind: 'split', ref: r, items } : null;
}
