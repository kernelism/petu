// src/playback/pace.ts — pace the drawing to the speech (founder 2026-10-30: "drawing races,
// explanation races"). Pure timing math, shared by the svg board's renderer (src/svgboard/render.ts)
// and the scheduler (src/playback/scheduler.ts); no DOM, so it is unit-tested on its own.
//
// A beat's group draws across the narration span it is tied to: the beat's words as the active clock
// times them (the estimated reading pace, or the real audio when a voice is on). Each part of the group
// gets a share of that span: a part the narration names draws from the word that names it (its id, its
// data-say, its label's words and numbers: paceParts), the others go next to their named neighbours in the
// group's order, and each draws across its share, from a sensible minimum (a short span still reads as
// drawing, not a blink); an unnamed one up to a cap (a long span does not crawl). Several groups
// in one beat (no words between them) split its span in turn. After a group's beat the narration rests
// a moment before the next sentence (REST_MS, applied by the scheduler).
import { mentions, tolerance, type Mention } from '../gate/numbers';
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

/**
 * A part to schedule: the words that name it (`words`: its data-say, else its id's words) and, when none
 * of those is said in its beat, its label's (`label`: labelNames). A name is a word (namesWord) or a
 * number as written ("37", "2.5"), which matches the number said however it is said ("37°", "thirty-seven",
 * "two point five") to the label's precision. `naturalMs`: its pen time.
 */
export type PartIn = { words: readonly string[]; label?: readonly string[]; naturalMs: number };
/** When a part starts (ms from now) and how long it draws, by its index in the input. */
export type PartTime = { i: number; at: number; dur: number };

const NUM = /[−-]?\d+(?:,\d{3})*(?:\.\d+)?%?/g;
/** A name that is a number as written: its value and the half-unit of its last written place. */
function numName(t: string): { v: number; tol: number } | null {
  if (!/^[−-]?\d+(?:,\d{3})*(?:\.\d+)?%?$/.test(t)) return null;
  const s = t.replace(/[,%]/g, '').replace('−', '-');
  return { v: Number(s), tol: 0.5 * 10 ** -(s.split('.')[1]?.length ?? 0) + 1e-9 };
}
/** The names a text gives (a label's text, or a data-say): its numbers as written, then its words (2+ letters for a data-say; a label's first three of 4+). */
export function labelNames(text: string, say = false): string[] {
  const nums = text.match(NUM) ?? [];
  const words = text.replace(NUM, ' ').toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= (say ? 2 : 4));
  return [...nums, ...(say ? words : words.slice(0, 3))];
}
/**
 * The numbers said in a beat (src/gate/numbers.ts: "37", "37°", "thirty-seven", "two point five"), without
 * references ("page 4") and without a bare spelled one or two (a word, far more often than a number).
 */
function spokenNumbers(words: readonly BeatWord[]): Mention[] {
  return mentions(words.map((w) => w.text.replace(/°/g, ''))).filter((m) => !m.ref && !(m.spelled && !m.frac && m.dp === 0 && m.value < 3));
}
/** The first word in [lo, hi) a name says (its first word and its last, for a number said in several). */
function named(names: readonly string[], words: readonly BeatWord[], said: readonly Mention[], ok: (k: number) => boolean): { w0: number; w1: number } | null {
  if (!names.length) return null;
  const nums = names.map(numName).filter((x): x is { v: number; tol: number } => !!x);
  const plain = names.filter((n) => !numName(n));
  let best: { w0: number; w1: number } | null = null;
  if (plain.length) for (let k = 0; k < words.length; k++) if (ok(k) && namesWord(words[k].text, plain)) { best = { w0: k, w1: k }; break; }
  for (const m of said) {
    if (best && m.w0 >= best.w0) break;
    if (ok(m.w0) && nums.some((n) => Math.abs(m.value - n.v) <= Math.min(n.tol, tolerance(m, n.v)))) { best = { w0: m.w0, w1: m.w1 }; break; }
  }
  return best;
}

/**
 * The schedule of a group's parts over its beat, in drawing order, or null when the beat gives
 * nothing to pace by (fewer than two words and not still streaming: the caller draws at pen speed). `start`: when the beat
 * began (ms from now; a re-plan once more of the beat has streamed in: the parts left are spread over
 * what is left of the window).
 *
 * The words are the part's contract (founder 2026-10-31, "what it says and what it draws don't match"):
 * a part named in the window (PartIn) starts on its first naming word, even one already spoken (it
 * draws now), and draws until the next part starts, at least through its naming words, never cut short
 * by PART_MAX_MS (the narration is still on it). An unnamed part goes with its nearest named neighbour in
 * the group's own order (a tie: the one before it): those after a named part draw right after it, those
 * before one right up to it, the first ones from the window's start; each over an even share of the gap,
 * clamped to [min, PART_MAX_MS] (a long gap does not crawl). Nothing named: the parts spread evenly over
 * the window in the group's order. Pen category is not an order: the group's order is the author's.
 * min is PART_MIN_MS unless the window is too short to give every part that much (then an equal share).
 */
export function paceParts(parts: readonly PartIn[], words: readonly BeatWord[], slot?: Slot, start?: number): PartTime[] | null {
  if (!parts.length || (words.length < 2 && !words[words.length - 1]?.open)) return null;
  const win = beatWindow(words, slot, start);
  // Re-planned mid-beat (`start` in the past): what is left of the window, from now.
  const from = Math.max(0, win.from), to = Math.max(from + 1, win.to);
  const span = to - from;
  const n = parts.length;
  const min = Math.min(PART_MIN_MS, Math.max(120, span / n - PART_GAP_MS));
  const unnamedDur = (len: number) => Math.max(min, Math.min(PART_MAX_MS, len - PART_GAP_MS));
  const said = spokenNumbers(words);
  const ok = (k: number) => words[k].inMs >= from - 1 && words[k].inMs < to;
  const hits = parts.map((p) => {
    const h = named(p.words, words, said, ok) ?? named(p.label ?? [], words, said, ok);
    if (!h) return null;
    const w1 = words[h.w1];
    return { at: Math.max(from, words[h.w0].inMs), until: Math.min(to, w1.endMs ?? w1.inMs + WORD_EST_MS) };
  });
  const at: { i: number; at: number; dur?: number }[] = [];
  const heads = parts.map((_, i) => i).filter((i) => hits[i]).sort((a, z) => hits[a]!.at - hits[z]!.at || a - z);
  if (!heads.length) {
    for (let i = 0; i < n; i++) at.push({ i, at: from + (i / n) * span, dur: unnamedDur(span / n) });
  } else {
    const after = parts.map((): number[] => []), before = parts.map((): number[] => []);
    for (let i = 0; i < n; i++) {
      if (hits[i]) continue;
      let p = i - 1, q = i + 1;
      while (p >= 0 && !hits[p]) p--;
      while (q < n && !hits[q]) q++;
      if (p < 0) before[q].push(i);
      else if (q >= n || i - p <= q - i) after[p].push(i);
      else before[q].push(i);
    }
    // Gap by gap: a named part (none before the first), its after-parts, the next one's before-parts.
    for (let k = 0; k <= heads.length; k++) {
      const h = k ? heads[k - 1] : -1, nx = k < heads.length ? heads[k] : -1;
      const a = h >= 0 ? hits[h]!.at : from, b = nx >= 0 ? hits[nx]!.at : to;
      const A = h >= 0 ? after[h] : [], B = nx >= 0 ? before[nx] : [];
      if (h >= 0) at.push({ i: h, at: a });
      if (!A.length && !B.length) continue;
      const lo = h >= 0 ? Math.min(b, Math.max(a + (b - a) / (1 + A.length + B.length), hits[h]!.until)) : a;
      const len = (b - lo) / (A.length + B.length), d = unnamedDur(len), step = Math.min(len, d + PART_GAP_MS);
      A.forEach((i, j) => at.push({ i, at: lo + j * step, dur: d }));
      B.forEach((i, j) => at.push({ i, at: b - (B.length - j) * step, dur: d }));
    }
  }
  at.sort((x, z) => x.at - z.at || x.i - z.i);
  return at.map((x, j) => {
    // A named part draws until the next one starts (less a pen lift): the narration is still on it.
    const dur = x.dur ?? Math.max(min, (j + 1 < at.length ? at[j + 1].at : to) - x.at - PART_GAP_MS);
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
