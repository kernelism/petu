// server/prompt/variants/index.ts — EXPERIMENT prompt variants (PETU_PROMPT_VARIANT; server/env.ts).
/**
 * Each variant rewrites a copy of the default prompt's parts (server/prompt/system.ts PROMPT_PARTS)
 * and nothing else, so an arm differs from p5.x only where it says. The default (no variant) never
 * passes through here. Not for production: these exist to test causes in
 * docs/superpowers/reference/live-vs-demo-boards.md §8.
 */
import type { Example } from '../examples.ts';
import { exdemos } from './exdemos.ts';
import { boardfirst } from './boardfirst.ts';

export type Parts = { sections: string[]; examples: Example[]; head: string };
export const VARIANTS: Record<string, (base: Parts) => Parts> = { exdemos, boardfirst };
export const VARIANT_NAMES = Object.keys(VARIANTS);

export function variantParts(name: string, base: Parts): Parts {
  const f = VARIANTS[name];
  if (!f) throw new Error(`petu: unknown prompt variant "${name}" (have: ${VARIANT_NAMES.join(', ')})`);
  return f({ ...base, sections: [...base.sections], examples: [...base.examples] });
}

/** Replaces `from` with `to` in `s`, which must contain it exactly once (a variant never edits silently). */
export function once(s: string, from: string, to: string): string {
  const i = s.indexOf(from);
  if (i < 0 || s.indexOf(from, i + 1) >= 0) throw new Error(`prompt variant: expected exactly one ${JSON.stringify(from.slice(0, 60))}`);
  return s.slice(0, i) + to + s.slice(i + from.length);
}

/** Applies `once` to whichever section holds `from`. */
export function edit(sections: string[], from: string, to: string): string[] {
  const hits = sections.filter((s) => s.includes(from));
  if (hits.length !== 1) throw new Error(`prompt variant: ${JSON.stringify(from.slice(0, 60))} is in ${hits.length} sections`);
  return sections.map((s) => (s.includes(from) ? once(s, from, to) : s));
}
