// src/script/parseScene.ts
/**
 * Board v2 tags (spec "Board v2: one connected scene"): things placed by relation and the relations
 * between them. Each draws into a scene (`on=s`); placement is by relation, never by coordinates:
 *
 *   {{node on=s id=a "buyers" right=b}}        a labelled thing; value=0.4 or value=p[2] shows a small value under it
 *   {{flow on=s id=f "A" "B" "C" arrows}}      a sequence of chips (parts f[1]…); values=p shows p's values under them; down stacks it
 *   {{link on=s from=a to=b strength=0.6 "label"}}   a relation; strength (0–1, or a part p[2]) sets its weight; plain = no head
 *   {{link on=s from=f[3] to=f strength=p}}    one to every part of f, each weighted by p's value
 *   {{note on=s "text" annotate=f[2]}}         a callout with a leader line;  {{note on=s "text" below=a}} plain text by relation
 */
import type { SceneShape, ValueRef } from './types';
import { isBlockRef, NAME, normName } from './pointExpr';
import { sceneRel } from './parseKit';

export const SCENE_TAGS = new Set(['node', 'flow', 'link', 'note']);
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
      if (!text || (args.annotate != null && !annotate) || (annotate && rel)) return null;
      return { kind: 'note', text, ...(annotate ? { annotate } : {}), ...place };
    }
  }
  return null;
}
