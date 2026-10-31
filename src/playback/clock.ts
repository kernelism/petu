/**
 * The narration timeline. The scheduler hands words over in order (`enqueue`) and reads back when
 * each one starts (`wordStart`), on the clock's own `now()` timebase. PacedClock is a synthetic
 * timeline; VoiceClock (voiceClock.ts) implements the same interface from the voice's audio (returning
 * null from `wordStart` until the audio for that word is scheduled).
 */
export interface NarrationClock {
  /** Current time, in the same timebase as `wordStart` (performance.now() ms for the real clocks). */
  now(): number;
  /** Estimated duration of a word including its trailing pause, in ms. Used for buffering decisions. */
  durationMs(word: string): number;
  /**
   * Queues the next word for speaking. Returns its index (0, 1, 2, … in call order). `restMs`: a
   * silence before it (at playback rate 1), after the word before it ends: the scheduler's rest after
   * a drawn beat. It stays through re-timing, except when the word itself is the one re-timed to.
   */
  enqueue(word: string, restMs?: number): number;
  /** Absolute start time of word `i`, or null while it isn't known yet. */
  wordStart(i: number): number | null;
  /** When the last queued word finishes (≤ now() once everything has been spoken). */
  endsAt(): number;
  /**
   * Re-times the timeline from word `from` on: word `from` starts at `start`, the rest follow at their
   * own pace (`from` = the number of queued words: the next word queued starts no earlier than
   * `start`). Pause, seek and a journey's arrival beat use it; a clock without it can't pause.
   */
  retime?(from: number, start: number): void;
  /** Silences what is being heard now (a pause; a clock with audio). Resume re-times from the next word. */
  halt?(): void;
  /** The answer is over: release audio and requests. */
  dispose?(): void;
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
  private words: string[] = [];
  private rests: number[] = [];
  private end = -Infinity;
  /**
   * `duration` overrides the word-length model (tests). `rate` is the playback speed (1 = the
   * narration's wpm; 1.5 plays every word and pause in 1/1.5 of the time). Read on every word, so a
   * change applies to words timed after it (Scheduler.respeed re-times the queued ones).
   */
  constructor(
    private wpm: () => number,
    private clockNow: () => number = () => performance.now(),
    private duration?: (word: string) => number,
    private rate: () => number = () => 1,
  ) {}

  now(): number { return this.clockNow(); }

  durationMs(word: string): number {
    const r = this.rate();
    const k = Number.isFinite(r) && r > 0 ? r : 1;
    return this.baseMs(word) / k;
  }

  private baseMs(word: string): number {
    if (this.duration) return this.duration(word);
    const syl = syllables(word);
    const base = NO_LETTERS.test(word) || syl === 0 ? 0 : (60000 / this.wpm()) * (FIXED_SHARE + ((1 - FIXED_SHARE) * syl) / MEAN_SYLLABLES);
    const pause = SENTENCE_END.test(word) ? 380 : CLAUSE_END.test(word) ? 160 : 0;
    return base + pause;
  }

  enqueue(word: string, restMs = 0): number {
    const rest = this.atRate(restMs);
    const start = Math.max(this.now(), this.end + rest);
    this.starts.push(start);
    this.words.push(word);
    this.rests.push(rest > 0 ? restMs : 0);
    this.end = start + this.durationMs(word);
    return this.starts.length - 1;
  }

  retime(from: number, start: number): void {
    let t = start;
    for (let i = Math.max(0, from); i < this.starts.length; i++) {
      if (i > from) t += this.atRate(this.rests[i]);
      this.starts[i] = t;
      t += this.durationMs(this.words[i]);
    }
    this.end = t;
  }

  /** `ms` at the playback rate. */
  private atRate(ms: number): number {
    if (!(ms > 0)) return 0;
    const r = this.rate();
    return ms / (Number.isFinite(r) && r > 0 ? r : 1);
  }

  wordStart(i: number): number | null { return this.starts[i] ?? null; }
  endsAt(): number { return this.end; }
}

export const endsSentence = (w: string) => /[.!?]["')\]’”]?$/.test(w);
/** A clause boundary: the narration can pause after this word without sounding cut off. */
export const endsClause = (w: string) => /[.!?:,;]["')\]’”]?$/.test(w);
