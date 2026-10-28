/**
 * The narration timeline. The scheduler hands words over in order (`enqueue`) and reads back when
 * each one starts (`wordStart`), on the clock's own `now()` timebase. PacedClock is a synthetic
 * timeline; a TTS clock will implement the same interface from audio word timings (returning null
 * from `wordStart` until the audio for that word is scheduled).
 */
export interface NarrationClock {
  /** Current time, in the same timebase as `wordStart` (performance.now() ms for the real clocks). */
  now(): number;
  /** Estimated duration of a word including its trailing pause, in ms. Used for buffering decisions. */
  durationMs(word: string): number;
  /** Queues the next word for speaking. Returns its index (0, 1, 2, … in call order). */
  enqueue(word: string): number;
  /** Absolute start time of word `i`, or null while it isn't known yet. */
  wordStart(i: number): number | null;
  /** When the last queued word finishes (≤ now() once everything has been spoken). */
  endsAt(): number;
}

const SENTENCE_END = /[.!?:]["')\]’”]?$/;
const CLAUSE_END = /[,;]["')\]’”]?$/;
const NO_LETTERS = /^[^\p{L}\p{N}]+$/u;
/** Mean syllables per word of lecture narration (measured on the demo scripts); keeps the average pace at `wpm`. */
export const MEAN_SYLLABLES = 1.42;
/** Share of a word's time that is fixed rather than proportional to its syllables. */
const FIXED_SHARE = 0.4;

/**
 * Rough English syllable count. Each letter run counts its vowel groups (minus a silent final e,
 * and at least one, so "x" or "F" is one); each digit counts one. "x-prime" → 2, "3D" → 2.
 */
export function syllables(word: string): number {
  const parts = word.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z]+|\d/g);
  if (!parts) return 0;
  let n = 0;
  for (const p of parts) {
    if (/\d/.test(p)) { n++; continue; }
    let v = (p.match(/[aeiouy]+/g) ?? []).length;
    if (v > 1 && /[^aeiouy]e$/.test(p) && !/[^aeiouy]le$/.test(p)) v--;
    n += Math.max(1, v);
  }
  return Math.min(n, 8);
}

export class PacedClock implements NarrationClock {
  private starts: number[] = [];
  private end = -Infinity;
  /** `duration` overrides the word-length model (tests). */
  constructor(
    private wpm: () => number,
    private clockNow: () => number = () => performance.now(),
    private duration?: (word: string) => number,
  ) {}

  now(): number { return this.clockNow(); }

  durationMs(word: string): number {
    if (this.duration) return this.duration(word);
    const syl = syllables(word);
    const base = NO_LETTERS.test(word) || syl === 0 ? 0 : (60000 / this.wpm()) * (FIXED_SHARE + ((1 - FIXED_SHARE) * syl) / MEAN_SYLLABLES);
    const pause = SENTENCE_END.test(word) ? 380 : CLAUSE_END.test(word) ? 160 : 0;
    return base + pause;
  }

  enqueue(word: string): number {
    const start = Math.max(this.now(), this.end);
    this.starts.push(start);
    this.end = start + this.durationMs(word);
    return this.starts.length - 1;
  }

  wordStart(i: number): number | null { return this.starts[i] ?? null; }
  endsAt(): number { return this.end; }
}

export const endsSentence = (w: string) => /[.!?]["')\]’”]?$/.test(w);
/** A clause boundary: the narration can pause after this word without sounding cut off. */
export const endsClause = (w: string) => /[.!?:,;]["')\]’”]?$/.test(w);
