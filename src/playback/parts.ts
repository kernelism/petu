// src/playback/parts.ts
import type { ParsedScript } from './session';

/**
 * Answer chapters (spec "Flow across the document"): an answer that travels is split into parts at
 * each journey (a move to a page that isn't next to the one before). A part that only glances at a
 * page (fewer than MIN_PART_WORDS words) folds into the part before it; a short lead-in on the
 * starting page folds into the first journey's part.
 */
export const MIN_PART_WORDS = 12;

/** A move between pages that aren't next to each other. */
export const isJourney = (from: number, to: number) => Math.abs(to - from) > 1;

/** `start`: the index of its first word; `page`: where it plays; `back`: it returns to the page the answer started on. */
export type Part = { start: number; page: number; back: boolean };

export function deriveParts(script: ParsedScript, origin: number): Part[] {
  const raw: Part[] = [{ start: 0, page: origin, back: false }];
  let cur = origin;
  for (const { action: a, word } of script.acts) {
    if (a.kind !== 'scroll') continue;
    const p = a.page;
    if (isJourney(cur, p)) {
      const last = raw[raw.length - 1];
      if (last.start === word) raw[raw.length - 1] = { start: word, page: p, back: p === origin && raw.length > 1 };
      else raw.push({ start: word, page: p, back: p === origin });
    }
    cur = p;
  }
  // Fold glances: a part is final once the next one has started (or the script ended).
  const n = script.words.length;
  const out: Part[] = [];
  raw.forEach((p, i) => {
    const end = raw[i + 1]?.start ?? n;
    const final = i + 1 < raw.length || script.ended;
    if (!final || end - p.start >= MIN_PART_WORDS || !out.length) { out.push(p); return; }
    // A glance mid-answer: the words stay with the part before it.
  });
  // A short lead-in on the starting page becomes part of the first journey's part.
  if (out.length > 1 && out[1].start - out[0].start < MIN_PART_WORDS) out.splice(0, 2, { ...out[1], start: 0 });
  // Two parts in a row on the same page (a glance between them folded away) are one.
  return out.filter((p, i) => i === 0 || p.page !== out[i - 1].page);
}

/** The part playing at word `pos` (the index of the next word to speak). */
export function partAt(parts: Part[], pos: number): number {
  let k = 0;
  parts.forEach((p, i) => { if (p.start <= pos) k = i; });
  return k;
}

/** A part's stepper title: where it goes, by its section. */
export function partTitle(p: Part, origin: number, label?: string): string {
  if (p.back) return `Back to p${origin}`;
  return label ? label : `Page ${p.page}`;
}

/** The narration of one part, for the "go deeper" follow-up's context. */
export function partText(script: ParsedScript, parts: Part[], i: number): string {
  const end = parts[i + 1]?.start ?? script.words.length;
  return script.words.slice(parts[i]?.start ?? 0, end).join(' ');
}
