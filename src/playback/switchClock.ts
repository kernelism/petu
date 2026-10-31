// src/playback/switchClock.ts — the narration clock the student can change mid-answer (Settings → Voice).
//
// It wraps the clock of the voice chosen (PacedClock for Off, VoiceClock for Marin/Cedar) and hands the
// timeline over to another one without the scheduler knowing: word indices stay the answer's own.
// - 'now' (a voice turned Off): every clock is disposed (the audio stops at once); the words from the
//   current one on are timed by the new clock from now. Words already said keep their times.
// - 'sentence' (a voice chosen, or changed): the old clock keeps the words up to the next sentence end
//   (a VoiceClock forgets the rest, `truncate`); the new one takes the words after it and starts when
//   the old one's last word ends. Until then its words are untimed (the scheduler waits on them as on
//   any voice still loading), and a new VoiceClock is halted: it fetches ahead and plays nothing.
// The caller re-times through the scheduler's usual hand-off (AnswerSession.respeed), so captions,
// marks and the board follow the new timeline.
import { endsSentence, type NarrationClock } from './clock';

type Make = () => NarrationClock;
type Seg = {
  clock: NarrationClock;
  /** Its first word (answer index); it holds the words from here to the next segment's `from`. */
  from: number;
  /** Not timed yet: it starts when the segment before it has placed its last word. */
  waiting: boolean;
};
type Truncatable = NarrationClock & { truncate(at: number): void };
const truncatable = (c: NarrationClock): c is Truncatable => typeof (c as Partial<Truncatable>).truncate === 'function';

export class SwitchClock implements NarrationClock {
  private words: string[] = [];
  /** Starts of the words before the first segment (said before a 'now' switch). */
  private frozen: (number | null)[] = [];
  private segs: Seg[];
  /** A 'sentence' switch whose boundary has not streamed in yet: it happens at the first one after `pendingFrom`. */
  private pending: Make | null = null;
  private pendingFrom = 0;
  /** No earlier than this the timeline ends (a 'now' switch's start). */
  private floor = -Infinity;
  private halted = false;

  constructor(private make: Make, private clockNow: () => number = () => performance.now()) {
    this.segs = [{ clock: make(), from: 0, waiting: false }];
  }

  /**
   * Another clock from word `from` (the next word to be spoken) on: at once ('now') or from the next
   * sentence boundary ('sentence'). Call the session's `respeed` after it to re-arm the scheduler.
   */
  switchTo(make: Make, from: number, when: 'now' | 'sentence'): void {
    this.make = make;
    this.pending = null;
    const at = Math.max(0, Math.min(from, this.words.length));
    if (when === 'now' || at === 0) { this.restart(at, this.clockNow()); return; }
    for (let b = Math.max(at, this.cur.from + 1); b <= this.words.length; b++) {
      if (endsSentence(this.words[b - 1])) { this.split(b); return; }
    }
    // The boundary hasn't been released yet: the switch waits for it (enqueue).
    if (this.cur.waiting && this.segs.length > 1 && at <= this.cur.from) { this.dropCur(); }
    this.pending = make;
    this.pendingFrom = at;
  }

  now(): number { return this.clockNow(); }
  durationMs(word: string): number { return this.cur.clock.durationMs(word); }

  enqueue(word: string): number {
    const i = this.words.length;
    if (this.pending && i > this.pendingFrom && i > this.cur.from && endsSentence(this.words[i - 1])) this.split(i);
    this.words.push(word);
    this.cur.clock.enqueue(word);
    return i;
  }

  wordStart(i: number): number | null {
    this.settle();
    const k = this.segAt(i);
    if (k < 0) return this.frozen[i] ?? null;
    const s = this.segs[k];
    return s.waiting ? null : s.clock.wordStart(i - s.from);
  }

  endsAt(): number {
    this.settle();
    return Math.max(this.segEnd(this.segs.length - 1), this.floor);
  }

  retime(from: number, start: number): void {
    this.halted = false;
    const k = this.segAt(from);
    if (k < 0) { this.restart(from, start); return; }
    // The segment holding `from` re-times; the ones after it wait for it again (a pause or a speed
    // change before a pending sentence switch keeps the switch where it was).
    const s = this.segs[k];
    s.waiting = false;
    s.clock.retime?.(from - s.from, start);
    for (const later of this.segs.slice(k + 1)) { later.clock.halt?.(); later.waiting = true; }
    this.settle();
  }

  halt(): void {
    this.halted = true;
    for (const s of this.segs) s.clock.halt?.();
  }

  dispose(): void {
    this.pending = null;
    for (const s of this.segs) s.clock.dispose?.();
  }

  // -----------------------------------------------------------------------------------------------

  private get cur(): Seg { return this.segs[this.segs.length - 1]; }

  private segAt(i: number): number {
    for (let k = this.segs.length - 1; k >= 0; k--) if (i >= this.segs[k].from) return k;
    return -1;
  }

  /** Every clock goes; a new one times the words from `from` on, starting at `start`. */
  private restart(from: number, start: number) {
    for (let i = this.frozen.length; i < from; i++) this.frozen[i] = this.rawStart(i);
    this.frozen.length = from;
    for (const s of this.segs) s.clock.dispose?.();
    const clock = this.make();
    if (this.halted) clock.halt?.();
    this.segs = [{ clock, from, waiting: false }];
    for (let i = from; i < this.words.length; i++) clock.enqueue(this.words[i]);
    if (!this.halted) clock.retime?.(0, start);
    this.floor = start;
  }

  /** The words from `b` (a sentence's first) go to a new clock, which waits for the one before. */
  private split(b: number) {
    const make = this.pending ?? this.make;
    this.pending = null;
    if (this.segs.length > 1 && b <= this.cur.from) this.dropCur();
    const old = this.cur;
    if (truncatable(old.clock)) old.clock.truncate(b - old.from);
    const clock = make();
    clock.halt?.();
    this.segs.push({ clock, from: b, waiting: true });
    for (let i = b; i < this.words.length; i++) clock.enqueue(this.words[i]);
    this.settle();
  }

  /** A waiting segment replaced before it started (two changes within one sentence). */
  private dropCur() {
    this.segs.pop()?.clock.dispose?.();
  }

  /** A waiting segment starts once the one before it has placed its last word. */
  private settle() {
    if (this.halted) return;
    for (let k = 1; k < this.segs.length; k++) {
      const s = this.segs[k];
      if (!s.waiting) continue;
      const end = this.placedEnd(k - 1);
      if (end == null) return;
      s.waiting = false;
      s.clock.retime?.(0, Math.max(this.clockNow(), end));
    }
  }

  /** When segment `k`'s last word ends, once it is placed; null while it isn't. */
  private placedEnd(k: number): number | null {
    const s = this.segs[k];
    const to = this.segs[k + 1]?.from ?? this.words.length;
    if (s.waiting) return null;
    if (to <= s.from) return k > 0 ? this.placedEnd(k - 1) : this.floor;
    const last = s.clock.wordStart(to - 1 - s.from);
    if (last == null) return null;
    // A truncated voice ends with its audio; a paced clock holds words past `to`: its word's own length.
    return truncatable(s.clock) ? s.clock.endsAt() : last + s.clock.durationMs(this.words[to - 1]);
  }

  /** Segment `k`'s end: placed, or estimated at the reading pace while it waits. */
  private segEnd(k: number): number {
    const s = this.segs[k];
    if (!s.waiting) {
      const placed = k < this.segs.length - 1 ? this.placedEnd(k) : s.clock.endsAt();
      if (placed != null) return placed;
    }
    const to = this.segs[k + 1]?.from ?? this.words.length;
    let ms = 0;
    for (let i = s.from; i < to; i++) ms += s.clock.durationMs(this.words[i]);
    const before = k > 0 ? this.segEnd(k - 1) : this.clockNow();
    return Math.max(before, this.clockNow()) + ms;
  }

  private rawStart(i: number): number | null {
    const k = this.segAt(i);
    if (k < 0) return this.frozen[i] ?? null;
    const s = this.segs[k];
    return s.waiting ? null : s.clock.wordStart(i - s.from);
  }
}
