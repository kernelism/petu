import type { Action, ScriptEvent } from '../script/types';
import { endsClause, type NarrationClock } from './clock';

export type SchedulerCallbacks = {
  onWord(text: string, index: number): void;
  /**
   * Fires an action. `at` is when its word starts (clock timebase); an action can fire up to its
   * lead ahead of that, so layout (scrolls, the board) can be under way when the word is spoken.
   */
  onAction(action: Action, at: number): void;
  onDone(): void;
};

export type SchedulerOptions = {
  /** How far ahead of its word an action may fire, in ms. Default 0. */
  leadMs?(action: Action): number;
};

/** Start once a whole clause is buffered, or this much narration. */
export const START_MS = 1500;
/** After running dry, resume once a whole clause is buffered, or this much narration (or the stream ended). */
export const RESUME_MS = 1000;
/** Out of words for this long with actions waiting on the next word: fire them anyway so ink keeps moving. */
export const FLUSH_MS = 200;
/** A word arriving this soon after the narration ran dry plays at once (a hiccup, not a stall). */
const GRACE_MS = 120;

type PendingAction = { action: Action; word: number };

/**
 * Plays words on the clock's timeline; actions fire with the first word after them.
 *
 * Buffering: narration starts on the first complete clause (or START_MS of words). A new clause only
 * starts once it is fully buffered (or RESUME_MS of it), so a slow stream pauses between phrases
 * rather than mid-phrase. Words are handed to the clock as soon as that allows; the clock decides
 * when each one starts, and the scheduler emits words and fires actions at those times.
 */
export class Scheduler {
  private words: string[] = [];
  private acts: PendingAction[] = [];
  private released = 0;
  private spoken = 0;
  private fired = 0;
  private lastFire = -Infinity;
  private started = false;
  private ended = false;
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private clock: NarrationClock, private cb: SchedulerCallbacks, private opts: SchedulerOptions = {}) {}

  push(events: ScriptEvent[]): void {
    if (this.stopped) return;
    for (const e of events) {
      if (e.type === 'end') this.ended = true;
      else if (e.type === 'word') this.words.push(e.text);
      else this.acts.push({ action: e.action, word: this.words.length });
    }
    this.tick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.words = [];
    this.acts = [];
  }

  // -----------------------------------------------------------------------------------------------

  private bufferedMs(from: number): number {
    let ms = 0;
    for (let i = from; i < this.words.length; i++) ms += this.clock.durationMs(this.words[i]);
    return ms;
  }

  private clauseBuffered(from: number): boolean {
    for (let i = from; i < this.words.length; i++) if (endsClause(this.words[i])) return true;
    return false;
  }

  /** Whether the next word may be handed to the clock now. */
  private canRelease(now: number): boolean {
    const i = this.released;
    if (i >= this.words.length) return false;
    if (this.ended) return true;
    if (!this.started) return this.clauseBuffered(i) || this.bufferedMs(i) >= START_MS;
    const dry = now > this.clock.endsAt() + GRACE_MS;
    const newClause = endsClause(this.words[i - 1] ?? '.');
    if (dry || newClause) return this.clauseBuffered(i) || this.bufferedMs(i) >= RESUME_MS;
    return true;
  }

  /** When action `a` should fire and the time of its word; null while that isn't known yet. */
  private timing(a: PendingAction, now: number): { fireAt: number; at: number } | null {
    const lead = this.opts.leadMs?.(a.action) ?? 0;
    if (a.word < this.released) {
      const at = this.clock.wordStart(a.word);
      return at == null ? null : { fireAt: Math.max(this.lastFire, at - lead), at };
    }
    if (a.word >= this.words.length && this.ended) {
      // Trailing actions: with the end of the narration.
      const at = Math.max(now, this.clock.endsAt());
      return { fireAt: Math.max(this.lastFire, at - lead), at };
    }
    // Waiting on a word that isn't playable yet: once the narration has run dry, flush.
    if (this.started && a.word === this.released) {
      const flushAt = this.clock.endsAt() + FLUSH_MS;
      return { fireAt: Math.max(this.lastFire, flushAt), at: Math.max(now, flushAt) };
    }
    return null;
  }

  private tick = (): void => {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.stopped) return;
    const now = this.clock.now();

    while (this.canRelease(now)) {
      this.clock.enqueue(this.words[this.released++]);
      this.started = true;
    }

    let next = Infinity;
    // Actions first, so their ink can start in the same frame as the word's caption.
    while (this.fired < this.acts.length) {
      const a = this.acts[this.fired];
      const t = this.timing(a, now);
      if (!t) break;
      if (t.fireAt > now) { next = Math.min(next, t.fireAt); break; }
      this.fired++;
      this.lastFire = Math.max(this.lastFire, t.fireAt);
      this.cb.onAction(a.action, t.at);
      if (this.stopped) return;
    }
    while (this.spoken < this.released) {
      const s = this.clock.wordStart(this.spoken);
      if (s == null) { next = Math.min(next, now + 50); break; } // a clock still waiting on audio
      if (s > now) { next = Math.min(next, s); break; }
      this.cb.onWord(this.words[this.spoken], this.spoken);
      this.spoken++;
      if (this.stopped) return;
    }

    const allOut = this.ended && this.released === this.words.length && this.spoken === this.released && this.fired === this.acts.length;
    if (allOut) {
      const end = this.clock.endsAt();
      if (now >= end) { this.stopped = true; this.cb.onDone(); return; }
      next = Math.min(next, end);
    }
    if (next < Infinity) this.timer = setTimeout(this.tick, Math.max(0, next - now));
  };
}

/** How far ahead of its word each action fires: layout glides ahead so it lands on the word. */
export function actionLeadMs(a: Action): number {
  switch (a.kind) {
    case 'scroll': return 450;
    // A sketch may glide the page column (420ms) or open the stage before its first stroke.
    case 'sketch': return 450;
    case 'board': return 380; // @deprecated, removed in Task E1
    case 'clear': return 0;
    // Ink fires early too, so the director can resolve its anchor and reveal it; the ink itself
    // still starts on the word.
    default: return 450;
  }
}
