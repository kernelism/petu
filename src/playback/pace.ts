// src/playback/pace.ts — pace the drawing to the speech (founder 2026-10-30: "drawing races,
// explanation races"). Pure timing math, shared by the svg board's renderer (src/svgboard/render.ts)
// and the scheduler (src/playback/scheduler.ts); no DOM, so it is unit-tested on its own.
//
// A beat's group draws across the narration span it is tied to: the beat's words as the active clock
// times them (the estimated reading pace, or the real audio when a voice is on). Each part of the group
// gets a share of that span: a part the narration names draws from the word that names it, the others
// are spread over the span in pen order, and each draws across its share, from a sensible minimum (a
// short span still reads as drawing, not a blink) to a cap (a long span does not crawl). Several groups
// in one beat (no words between them) split its span in turn. After a group's beat the narration rests
// a moment before the next sentence (REST_MS, applied by the scheduler).
import { namesWord } from './scheduler';

/** A beat word: how soon it is spoken (ms from now) and, when known, when it ends. */
export type BeatWord = { text: string; inMs: number; endMs?: number;
  /** On the last word: the beat is still streaming (its end isn't known yet). */
  open?: boolean };
/** The k-th (0-based) of n groups that share one beat's words. */
export type Slot = { k: number; n: number };

/** A paced part draws over at least this long (shorter only when the span can't hold every part at it). */
export const PART_MIN_MS = 450;
/** And never longer than this, however long its share of the span: a long span does not crawl. */
export const PART_MAX_MS = 2600;
/** The pen lifts this long between one part and the next. */
export const PART_GAP_MS = 80;
/** A beat this short or shorter is still spread over this long (two quick words don't make a blink). */
export const SPAN_MIN_MS = 1200;
/** The narration's rest after a drawn beat, before the next beat's first sentence (scheduler). */
export const REST_MS = 400;
/** Words assumed for a word whose time isn't known yet. */
export const WORD_EST_MS = 300;

/**
 * A group's words may still be streaming when it starts drawing (the group comes before its
 * sentences): when the beat's end has moved by more than this, the parts not yet drawn are re-planned.
 */
export const REPLAN_MS = 400;
/**
 * A beat still streaming is assumed to run at least this long from its first word (a sentence or two),
 * so its first parts don't all draw in the words known so far; the re-plan corrects it either way.
 */
export const OPEN_SPAN_MS = 6000;

/**
 * When the beat's narration ends, ms from now: its last word's end (else its start plus a word); a
 * beat still streaming, at least OPEN_SPAN_MS after its first word.
 */
export function beatEnd(words: readonly BeatWord[]): number {
  if (!words.length) return 0;
  const last = words[words.length - 1];
  const end = Math.max(last.endMs ?? last.inMs + WORD_EST_MS, last.inMs);
  return last.open ? Math.max(end, words[0].inMs + OPEN_SPAN_MS) : end;
}

/**
 * The window (ms from now) a group draws in: its slot's share of the beat's span, from the first word
 * (or `start`: when the beat began, ms from now, ≤ 0 once it has) to the last word's end (at least
 * SPAN_MIN_MS long). One group (no slot): the whole span.
 */
export function beatWindow(words: readonly BeatWord[], slot?: Slot, start = words.length ? Math.max(0, words[0].inMs) : 0): { from: number; to: number } {
  const end = Math.max(start + SPAN_MIN_MS, beatEnd(words));
  const n = slot && slot.n > 1 ? slot.n : 1;
  const k = slot && n > 1 ? Math.max(0, Math.min(n - 1, slot.k)) : 0;
  const len = (end - start) / n;
  return { from: start + k * len, to: start + (k + 1) * len };
}

/** Id words that are structure, not names (a group, a label, a line…). */
const NOT_NAMES = /^(g|grp|group|lbl|label|txt|text|line|path|\d+)$/;
/**
 * The words a part's id answers to in the narration: its id split at hyphens, underscores and
 * camelCase, lowercased, without structure words and without the words its group's id already has
 * (`masses-in` in group `masses` answers to "in", not to every "masses"). Two-letter words ("in",
 * "up") count: namesWord matches them only as whole words.
 */
export function partWords(id: string, groupId?: string): string[] {
  const split = (s: string) => s.split(/[^A-Za-z0-9]+|(?<=[a-z])(?=[A-Z])/).map((w) => w.toLowerCase()).filter((w) => w.length >= 2 && !NOT_NAMES.test(w));
  const all = split(id);
  const group = new Set(groupId ? split(groupId) : []);
  const own = all.filter((w) => !group.has(w));
  return own.length ? own : all.filter((w) => w.length >= 3);
}

/** A part to schedule: its pen category (lower draws first), the words that name it, its natural pen time. */
export type PartIn = { cat: number; words: readonly string[]; naturalMs: number };
/** When a part starts (ms from now) and how long it draws, by its index in the input. */
export type PartTime = { i: number; at: number; dur: number };

/**
 * The schedule of a group's parts over its beat, in drawing order, or null when the beat gives
 * nothing to pace by (fewer than two words and not still streaming: the caller draws at pen speed). `start`: when the beat
 * began (ms from now; a re-plan once more of the beat has streamed in: the parts left are spread over
 * what is left of the window).
 *
 * Pen order (category, then the group's own order) spreads the parts evenly over the window; a part
 * whose words the narration says inside the window starts on that word instead. Each part draws over
 * its share, up to the next part's start, less a pen lift, clamped to [min, PART_MAX_MS], where min
 * is PART_MIN_MS unless the window is too short to give every part that much (then an equal share).
 */
export function paceParts(parts: readonly PartIn[], words: readonly BeatWord[], slot?: Slot, start?: number): PartTime[] | null {
  if (!parts.length || (words.length < 2 && !words[words.length - 1]?.open)) return null;
  const win = beatWindow(words, slot, start);
  // Re-planned mid-beat (`start` in the past): what is left of the window, from now.
  const from = Math.max(0, win.from), to = Math.max(from + 1, win.to);
  const span = to - from;
  const n = parts.length;
  const order = parts.map((p, i) => ({ p, i })).sort((a, z) => a.p.cat - z.p.cat || a.i - z.i);
  const at = order.map((x, j) => {
    let t = from + (j / n) * span;
    if (x.p.words.length) {
      const w = words.find((y) => y.inMs >= from - 1 && y.inMs < to && namesWord(y.text, x.p.words));
      if (w) t = w.inMs;
    }
    return { i: x.i, at: t };
  });
  at.sort((a, z) => a.at - z.at);
  const min = Math.min(PART_MIN_MS, Math.max(120, span / n - PART_GAP_MS));
  return at.map((x, j) => {
    const next = j + 1 < at.length ? at[j + 1].at : to;
    const dur = Math.max(min, Math.min(PART_MAX_MS, next - x.at - PART_GAP_MS));
    return { i: x.i, at: Math.round(x.at), dur: Math.round(dur) };
  });
}

/**
 * A part's draw time split over its steps (strokes, labels) in proportion to their natural pen time:
 * the part's pace is the narration's, its strokes keep their relative lengths.
 */
export function splitPart(dur: number, naturals: readonly number[]): number[] {
  const total = naturals.reduce((a, b) => a + Math.max(0, b), 0);
  if (!(total > 0)) return naturals.map(() => dur / Math.max(1, naturals.length));
  return naturals.map((d) => (Math.max(0, d) / total) * dur);
}
