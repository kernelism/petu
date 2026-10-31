// src/ui/captionWindow.ts
/**
 * The caption's reading window: which display tokens are on screen. It holds the current sentence
 * (short sentences share it while they fit two lines); a sentence that no longer fits opens a new
 * window at its own start, and one longer than the window is split at a clause mark. A window never
 * opens on the tail of the previous sentence. Pure: widths come from an injected measure.
 */

const CLOSERS = `["'”’)\\]]*$`;
const SENTENCE = new RegExp(`[.?!]${CLOSERS}`);
const CLAUSE = new RegExp(`[,;:–—]${CLOSERS}`);

/** Ends a sentence ("far.", "right?”"); "1.5" doesn't. */
export const endsSentence = (t: string | undefined): boolean => !!t && SENTENCE.test(t);
/** Ends a clause: a comma, semicolon, colon or dash ("C,", "line:", a lone "—"). */
export const endsClause = (t: string | undefined): boolean => !!t && (CLAUSE.test(t) || /^[-–—]$/.test(t));

/** Lines `tokens` wrap to in `width`, greedily by word (the browser may also break at hyphens, so it never needs more). */
export function countLines(tokens: string[], width: number, measure: (s: string) => number): number {
  let lines = 0, line = '';
  for (const t of tokens) {
    const next = line ? `${line} ${t}` : t;
    if (line && measure(next) > width) { lines++; line = t; } else line = next;
  }
  return line ? lines + 1 : lines;
}

/**
 * Where the window starts once token `i` has arrived, given it started at `start` (≤ i). Moves only
 * forward: to a sentence that would open on the window's last line; on overflow, to the latest
 * sentence start in the window, then to the latest clause start that fits, and to `i` itself (a
 * word break) as the last resort.
 */
export function windowStart(tokens: string[], start: number, i: number, width: number, measure: (s: string) => number, maxLines = 2): number {
  const lines = (from: number) => countLines(tokens.slice(from, i + 1), width, measure);
  const fits = (from: number) => lines(from) <= maxLines;
  // A sentence that would open on the window's last line opens the next window instead: its start
  // is read once, at the top, not glimpsed at the bottom and then repeated.
  if (i > start && endsSentence(tokens[i - 1]) && lines(start) >= maxLines) return i;
  if (fits(start)) return start;
  let base = start;
  for (let k = i; k > start; k--) {
    if (endsSentence(tokens[k - 1])) { base = k; break; }
  }
  if (base > start && fits(base)) return base;
  for (let k = i; k > base; k--) {
    if (endsClause(tokens[k - 1]) && fits(k)) return k;
  }
  return i;
}

/**
 * The one mid-answer wait cue (a faint "…" after the last word) shows only after a real pause: every
 * word so far spoken (`endsAt`) and nothing new for this long. Shorter gaps (a sentence break, the
 * opener handing over on time) show nothing; before the first word the narration line holds the same
 * ellipsis (the opener wait). No status text.
 */
export const PAUSE_CUE_MS = 1500;
/** Ms from `now` until the wait cue may show, given when the words queued so far end. */
export const pauseCueIn = (endsAt: number, now: number): number => Math.max(0, endsAt - now) + PAUSE_CUE_MS;
