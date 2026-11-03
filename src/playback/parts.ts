// src/playback/parts.ts
import type { ParsedScript } from './session';
import { endsSentence } from './clock';

/**
 * Answer chapters (spec "Flow across the document"): an answer that travels is split into parts at
 * each journey (a move to a page that isn't next to the one before). A part that only glances at a
 * page (fewer than MIN_PART_WORDS words) folds into the part before it; a short lead-in on the
 * starting page folds into the first journey's part.
 */
export const MIN_PART_WORDS = 12;

/** A move between pages that aren't next to each other. */
export const isJourney = (from: number, to: number) => Math.abs(to - from) > 1;

/**
 * Whether a move gets the journey beat (route, hold, arrival rest): it travels (isJourney) and the
 * answer has already said something where it was. An answer's opening move, before its first word,
 * goes to the page the question is about: it frames the answer, it isn't a journey (the same rule
 * as deriveParts, where a move at word 0 replaces the starting part).
 */
export const journeyBeat = (from: number, to: number, spoken: number) => spoken > 0 && isJourney(from, to);

/**
 * "Back to pN": N is the page in view when the question was asked. It shows only once the answer
 * has moved on to a later part (`reached` = the furthest part played) and the view is elsewhere; an
 * answer that opens by moving to the page it is about has one part and never offers it.
 */
export function returnTarget(askedOn: number, inView: number, reached: number): number | null {
  return reached > 0 && inView !== askedOn ? askedOn : null;
}

/** `start`: the index of its first word; `page`: where it plays; `back`: it returns to the page the answer started on. */
export type Part = { start: number; page: number; back: boolean };

export function deriveParts(script: ParsedScript, origin: number): Part[] {
  const raw: Part[] = [{ start: 0, page: origin, back: false }];
  let cur = origin;
  for (const { action: a, word } of script.acts) {
    if (a.kind !== 'scroll') continue;
    const p = a.page;
    const last = raw[raw.length - 1];
    // A move before a part has said a word sets where that part plays, near or far: the answer's
    // opening move to its home page (src/agent/twoStage.ts) makes the first part that page's, even
    // when it is next to the page asked on.
    if (last.start === word) raw[raw.length - 1] = { start: word, page: p, back: p === origin && raw.length > 1 };
    else if (isJourney(cur, p)) raw.push({ start: word, page: p, back: p === origin });
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

/** How far through part `i` the narration is at `pos` (0–1), against the words known so far. */
export function partProgress(parts: Part[], i: number, pos: number, wordCount: number): number {
  const p = parts[i];
  if (!p) return 0;
  const end = parts[i + 1]?.start ?? wordCount;
  if (end <= p.start) return 0;
  return Math.max(0, Math.min(1, (pos - p.start) / (end - p.start)));
}

/** The first word of the sentence word `i` belongs to. */
export function sentenceStart(words: string[], i: number): number {
  let k = Math.max(0, Math.min(i, words.length));
  while (k > 0 && !endsSentence(words[k - 1])) k--;
  return k;
}

/**
 * Replay (R): back to the start of the sentence being spoken (`pos` = the next word to speak). Within
 * the first REPLAY_AGAIN_WORDS word of a sentence it goes to the one before, so pressing R twice
 * steps back a sentence at a time.
 */
export const REPLAY_AGAIN_WORDS = 1;
export function replayTarget(words: string[], pos: number): number {
  const cur = sentenceStart(words, Math.max(0, pos - 1));
  if (pos - cur > REPLAY_AGAIN_WORDS || cur === 0) return cur;
  return sentenceStart(words, cur - 1);
}

/**
 * Skip ahead (Shift+→): the start of the next sentence after `pos` (at a sentence boundary, the one
 * after the sentence about to start). Null while it hasn't streamed in.
 */
export function nextSentence(words: string[], pos: number): number | null {
  for (let i = Math.max(0, pos); i < words.length - 1; i++) if (endsSentence(words[i])) return i + 1;
  return null;
}

/**
 * The pages an answer taught from, in the order it reached them: where its first part played (its home,
 * src/agent/twoStage.ts), then every page it moved to or pointed at. What the trail header and the
 * session list record (was: the page the question was asked on, "p.1" for an answer taught on p87,
 * and only the pages that began a part, so a walk 86 → 87 → 88 was recorded as 86). Board sections and
 * their `near=` are not counted: they explain a page, they do not teach on it.
 */
export function taughtPages(script: ParsedScript, parts: Part[]): number[] {
  const out: number[] = parts.length ? [parts[0].page] : [];
  for (const { action: a } of script.acts) {
    if (a.kind === 'sketch' || !('page' in a) || typeof a.page !== 'number') continue;
    if (!out.includes(a.page)) out.push(a.page);
  }
  return out;
}
