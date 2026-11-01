import type { RawAction as Action, ScriptEvent } from '../script/types';
import { endsClause, endsSentence, type NarrationClock } from './clock';
import { REST_MS, WORD_EST_MS, type BeatWord } from './pace';

export type SchedulerCallbacks = {
  onWord(text: string, index: number): void;
  /**
   * Fires an action. `at` is when its word starts (clock timebase); an action can fire up to its
   * lead ahead of that, so layout (scrolls, sketches) can be under way when the word is spoken.
   * `word`: the index of the word it fires with, so ink can follow that word if the timeline moves
   * (pause, speed); absent for actions a forward seek fast-forwards (they are behind on purpose).
   */
  onAction(action: Action, at: number, word?: number): void;
  onDone(): void;
};

export type SchedulerOptions = {
  /** How far ahead of its word an action may fire, in ms. Default 0. */
  leadMs?(action: Action): number;
};

/**
 * Start once a whole clause is buffered, or this much narration (~2 words). A model streams words
 * 20–30× faster than they are spoken, so a short head start never runs dry; a longer one only
 * delays the first caption word (P2 measured 1500ms costing up to ~60ms on the first word).
 */
export const START_MS = 600;
/** After running dry, resume once a whole clause is buffered, or this much narration (or the stream ended). */
export const RESUME_MS = 1000;
/** Out of words for this long with actions waiting on the next word: fire them anyway so ink keeps moving. */
export const FLUSH_MS = 200;
/** A word arriving this soon after the narration ran dry plays at once (a hiccup, not a stall). */
const GRACE_MS = 120;
/** After a resume or a seek, the next word starts this much later (a breath, not a jolt). */
export const RESUME_GAP_MS = 250;
/** Actions skipped over by a forward seek fire this far "behind" their word: the director fades them in quickly. */
export const SEEK_LAG_MS = 1500;

/**
 * The look (founder 2026-10-31, teaching rhythm): after a page mark lands the student needs a moment to
 * find and read what was marked before the board draws something new. The board waits this long after
 * the mark's word, longer for a longer quoted phrase, capped; the narration goes on unheld (it may keep
 * talking about the page), and the next board group draws with the first words spoken once the look is
 * over. A group whose own first sentence marks the page waits for that mark too (the sentence is about the
 * page). Page marks, scrolls and words are never held: the first words still come first.
 */
export const LOOK_MIN_MS = 1200;
export const LOOK_MAX_MS = 2000;
export const LOOK_PER_CHAR_MS = 25;

/** Ink on a page (a highlight, circle, box, underline, arrow…): not a scroll, not the board. */
export function isPageMark(a: Action): boolean {
  if (a.kind === 'scroll' || a.kind === 'sketch' || a.kind === 'clear' || a.kind === 'svg') return false;
  const x = a as { page?: number; region?: string };
  return x.page != null && x.region == null;
}
/** A drawing on the board: an svg group, or ink in a board section. */
export function drawsBoard(a: Action): boolean {
  if (a.kind === 'svg') return !a.defs;
  if (a.kind === 'scroll' || a.kind === 'sketch' || a.kind === 'clear') return false;
  return (a as { region?: string }).region != null;
}
/** An svg group that draws (not a withheld beat's definitions). */
const drawsSvg = (a: Action): boolean => a.kind === 'svg' && !a.defs;
/** How long the board waits after this page mark lands: by the quoted words' length, within [LOOK_MIN_MS, LOOK_MAX_MS]. */
export function lookMs(a: Action): number {
  const q = (a as { quote?: string }).quote;
  return Math.min(LOOK_MAX_MS, LOOK_MIN_MS + (typeof q === 'string' ? q.length * LOOK_PER_CHAR_MS : 0));
}

type PendingAction = { action: Action; word: number;
  /** An svg group: the first word of its beat (the `{{beat}}` it came after; legacy: its own word). */ beat?: number;
  /** An svg group: the first of its own sentences (its beat's; legacy: the words since the group before). */ from?: number;
  /** A board action held past its words (the look): it fires no earlier than this (clock time). */ until?: number };

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
  private paused = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private clock: NarrationClock, private cb: SchedulerCallbacks, private opts: SchedulerOptions = {}) {}

  push(events: ScriptEvent[]): void {
    if (this.stopped) return;
    for (const e of events) {
      if (e.type === 'end') this.ended = true;
      else if (e.type === 'word') this.words.push(e.text);
      else if (e.action.kind === 'beat') { this.anchorOf(e.action); this.beatStarts.push(this.words.length); } // a boundary: nothing fires
      else {
        const from = this.beatFrom, word = this.anchorOf(e.action);
        this.acts.push({ action: e.action, word, ...(drawsSvg(e.action) ? { beat: this.tagged ? from : word, from } : {}) });
      }
    }
    this.tick();
  }

  /** Where the current beat's words start: its `{{beat}}`; legacy streams (none), right after the last group. */
  private beatFrom = 0;
  /** Where each `{{beat}}` stood (the first word of its beat), in order. */
  private beatStarts: number[] = [];
  /** The stream writes `{{beat}}` boundaries (src/svgboard/beat.ts). */
  private tagged = false;
  /** Whether an svg group has come yet (the narration rests only after a drawn beat). */
  private drawn = false;
  /**
   * Words the narration rests before (REST_MS): the first word of a sentence that opens a new beat,
   * after a beat that drew. A pause after a drawn step, not a rule for the model: the scheduler reads
   * it from where the groups stand, whatever the beat sizes.
   */
  private rests = new Set<number>();
  /**
   * The word an action fires with: the next one, except an svg board group, which fires on the first
   * word of its own beat already here that names it (its id's words), else with the next word. Only its
   * own beat's words are searched (src/svgboard/beat.ts): from its `{{beat}}` to the group. A group that
   * opens its beat (lead order) has none before it and fires on its beat's first word; one that closes
   * its sentences (trailing order) fires on the word in them that names it, else on its beat's first. A word of an earlier beat
   * never anchors a group (the ferry's "aim" drew five words before its beat). Legacy streams (no
   * `{{beat}}`): its sentences are the words since the group before.
   */
  private anchorOf(a: Action): number {
    const n = this.words.length;
    if (a.kind === 'beat') { this.tagged = true; this.beatFrom = n; return n; }
    if (a.kind === 'sketch' && a.svgboard) this.beatFrom = n; // the opener's words never name a group
    if (a.kind !== 'svg' || a.defs) return n;
    const from = this.beatFrom;
    if (!this.tagged) this.beatFrom = n;
    const want = (a.anchor ?? []).filter((w) => w.length >= 2);
    if (want.length) for (let i = from; i < n; i++) if (namesWord(this.words[i], want)) return i;
    // At a sentence boundary after a drawn beat: the next sentence starts after a rest.
    if (this.drawn && n > 0 && endsSentence(this.words[n - 1])) this.rests.add(n);
    this.drawn = true;
    // After its own sentences (trailing order) and none names it: with them, from its beat's first word.
    // On the next word it drew on the next beat's first one (frame, axes, title are rarely said), with
    // its own beat already spoken, and in a gated stream only once the gate let that next beat out.
    return this.tagged && from < n ? from : n;
  }

  /** When the board is free to draw again (clock time): the look after the last page mark that landed. */
  private boardFree = -Infinity;

  /** The index of the last word of the sentence word `i` is in (what has streamed of it). */
  private sentenceEndFrom(i: number): number {
    let j = i;
    while (j < this.words.length - 1 && !endsSentence(this.words[j])) j++;
    return j;
  }

  /**
   * When the board may draw action `j` (clock time): after the look of every page mark already landed and
   * of every page mark inside the sentence the action opens. -Infinity: nothing holds it. null: a mark in
   * that sentence isn't timed yet (its word not released) and the narration hasn't run dry: wait.
   */
  private boardFreeFor(j: number, now: number): number | null {
    const a = this.acts[j];
    let free = this.boardFree;
    const end = this.sentenceEndFrom(a.word);
    const dry = this.started && now > this.clock.endsAt() + FLUSH_MS;
    for (let i = j + 1; i < this.acts.length; i++) {
      const x = this.acts[i];
      if (x.word > end) break;
      if (!isPageMark(x.action)) continue;
      if (x.word < this.released) { const t = this.clock.wordStart(x.word); if (t == null) return null; free = Math.max(free, t + lookMs(x.action)); }
      else if (this.ended && x.word >= this.words.length) free = Math.max(free, Math.max(now, this.clock.endsAt()) + lookMs(x.action));
      else if (!dry) return null;
    }
    return free;
  }

  /**
   * The look: holds board action `j` (and the groups that came with it) until the board is free, moving
   * it to the first word spoken from then on and behind every action on earlier words, so page marks
   * keep firing on their words meanwhile. Never past its own beat's last word: a look that outlasts a
   * short beat draws the group on that word (moved into the next beat, it drew over that beat's words,
   * after that beat's group, its own words already spoken). 'ok': it may fire now (its word is already late enough);
   * 'moved': it was re-anchored and re-ordered (look at acts[fired] again); null: not known yet.
   */
  private lookHold(j: number, now: number): 'ok' | 'moved' | null {
    const a = this.acts[j];
    const free = this.boardFreeFor(j, now);
    if (free == null) return null;
    if (free === -Infinity) return 'ok';
    // Groups that came together (one word) move together and keep their slots.
    let k = j + 1;
    while (k < this.acts.length && drawsSvg(a.action) && drawsSvg(this.acts[k].action) && this.acts[k].word === a.word && this.acts[k].beat === a.beat) k++;
    const group = this.acts.slice(j, k);
    const last = this.tagged && a.beat != null ? (this.beatStarts.find((b) => b > a.beat!) ?? Infinity) - 1 : Infinity;
    let w = a.word;
    while (w < last && w < this.released && (this.clock.wordStart(w) ?? Infinity) < free) w++;
    const capped = w >= last;
    // No word to anchor to (the narration ended, or ran dry): the board draws when the look is over.
    const dry = this.started && now > this.clock.endsAt() + FLUSH_MS;
    const trailing = !capped && w >= this.released && ((this.ended && w >= this.words.length) || dry);
    if (w >= this.released && !trailing && !capped) return null; // the word that ends the look isn't released yet
    for (const g of group) { g.word = w; if (trailing) g.until = free; else delete g.until; }
    // Behind every action on an earlier word, and page marks on the same word (they fire first).
    let at = k;
    while (at < this.acts.length && (this.acts[at].word < w || (this.acts[at].word === w && !drawsBoard(this.acts[at].action)))) at++;
    if (at === k) return 'ok';
    this.acts.splice(j, group.length);
    this.acts.splice(at - group.length, 0, ...group);
    return 'moved';
  }

  /** The k-th of n svg groups of one beat that fire on word `word` (they came together and share its beat). */
  private slotOf(j: number): { k: number; n: number } {
    let k = 0, n = 0;
    for (let i = 0; i < this.acts.length; i++) {
      const x = this.acts[i];
      if (!drawsSvg(x.action) || x.word !== this.acts[j].word || x.beat !== this.acts[j].beat) continue;
      if (i < j) k++;
      n++;
    }
    return { k, n };
  }

  /**
   * The words of a beat, each with how soon it is spoken (ms from now; words not yet timed are estimated
   * at 300 ms each, words already spoken at 0). An svg group paces its parts across them.
   *
   * `from` (the director passes the group's `beatFrom`): the beat that starts at that word, fixed by the
   * beat structure: up to the next `{{beat}}` (legacy streams: the next svg group's word, fired or not),
   * open while that isn't here yet. A re-plan reads the same words (it can only lose those that pass),
   * never the next beat's: a group whose next beat's group had already fired used to pace its leftovers
   * over the next beat. Without `from`: from the word being spoken to the next svg group not yet fired.
   */
  beatWords(from?: number, max = 80): BeatWord[] {
    const now = this.clock.now();
    let to = this.words.length;
    let closed = this.ended;
    let i0 = this.spoken;
    if (from != null) {
      i0 = Math.max(0, Math.min(from, this.words.length));
      const next = this.tagged ? this.beatStarts.find((b) => b > from)
        : this.acts.reduce<number | undefined>((m, x) => drawsSvg(x.action) && x.word > from && (m == null || x.word < m) ? x.word : m, undefined);
      if (next != null) { to = Math.min(to, next); closed = true; }
    } else {
      // The next beat's group (one that came with this group, on its word, shares its beat).
      for (let i = this.fired; i < this.acts.length; i++) if (drawsSvg(this.acts[i].action) && this.acts[i].word > this.spoken) { to = Math.min(to, this.acts[i].word); closed = true; break; }
    }
    const out: BeatWord[] = [];
    let last = now;
    for (let i = i0; i < Math.min(to, i0 + max); i++) {
      const s = i < this.released ? this.clock.wordStart(i) : null;
      // Not timed yet (a voice still loading, a word not released): after the one before, at the clock's estimate.
      const t = s ?? last;
      const d = this.clock.durationMs(this.words[i]) || WORD_EST_MS;
      out.push({ text: this.words[i], inMs: Math.max(0, t - now), endMs: Math.max(0, t + d - now), ...(i === i0 && t < now ? { sinceMs: now - t } : {}) });
      last = Math.max(now, t + d);
    }
    // Its end isn't known while the stream may still add words to it.
    if (!closed && out.length < max) {
      // A group that fired before its words (the narration ran dry): the beat is coming, still unknown.
      if (!out.length) out.push({ text: '', inMs: Math.max(0, last - now), endMs: Math.max(0, last - now) });
      out[out.length - 1].open = true;
    }
    return out;
  }

  /** Whether pause, resume, hold and seek work (the clock can re-time its words). */
  canPause(): boolean { return !!this.clock.retime; }
  isPaused(): boolean { return this.paused; }
  /** Index of the next word to be spoken (= the number spoken so far). */
  position(): number { return this.spoken; }

  /** How many words of the timeline start before `t` (an action's `at`: the words said before it). */
  wordsBefore(t: number): number {
    let n = 0;
    while (n < this.released && (this.clock.wordStart(n) ?? Infinity) < t - 1) n++;
    return n;
  }

  /**
   * Stops handing out words and actions at the current word. Words keep streaming in (buffered);
   * ink already under way finishes.
   */
  pause(): boolean {
    if (this.stopped || this.paused || !this.clock.retime) return false;
    this.paused = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.clock.halt?.();
    return true;
  }

  /** Continues from the next unspoken word, after a short breath. */
  resume(): boolean {
    if (this.stopped || !this.paused) return false;
    this.paused = false;
    this.retimeFrom(this.spoken, this.clock.now() + RESUME_GAP_MS);
    this.tick();
    return true;
  }

  /**
   * Inserts `ms` of silence before the first word that starts at or after `at` (a journey's arrival
   * beat: the view travels and settles before the narration goes on).
   */
  hold(at: number, ms: number): void {
    if (this.stopped || !this.clock.retime || ms <= 0) return;
    let i = this.spoken;
    while (i < this.released && (this.clock.wordStart(i) ?? Infinity) < at - 1) i++;
    // A voice rests only between its pieces: a hold inside a playing sentence would cut the audio and
    // restart it mid-word (founder lec06, 2026-10-31: "voice glitches when the slide moves"). The view
    // still travels; the narration just goes on.
    if (this.clock.holdable && !this.clock.holdable(i)) return;
    // A released word not yet timed (its voice still loading) starts no earlier than the narration's end.
    const base = (i < this.released ? this.clock.wordStart(i) : null) ?? Math.max(at, this.clock.now(), this.clock.endsAt());
    this.retimeFrom(i, base + ms);
    if (!this.paused) this.tick();
  }

  /**
   * Plays on from word `target`. Forward: the words in between are shown at once and their actions
   * fire fast (they land quickly, so the board is what it would have been). Back: the narration
   * repeats from there; actions already fired are not fired again (the ink is still on the page).
   * Unpauses. False when the clock can't seek.
   */
  seek(target: number): boolean {
    if (this.stopped || !this.clock.retime) return false;
    const to = Math.max(0, Math.min(Math.round(target), this.words.length));
    const now = this.clock.now();
    this.paused = false;
    if (to >= this.spoken) {
      while (this.released < to) this.release();
      this.started = true;
      while (this.fired < this.acts.length && this.acts[this.fired].word < to) {
        const a = this.acts[this.fired++];
        this.cb.onAction(a.action, now - SEEK_LAG_MS);
        if (this.stopped) return true;
      }
      while (this.spoken < to) { this.cb.onWord(this.words[this.spoken], this.spoken); this.spoken++; if (this.stopped) return true; }
    } else this.spoken = to;
    this.lastFire = Math.min(this.lastFire, now);
    this.retimeFrom(to, now + RESUME_GAP_MS);
    this.tick();
    return true;
  }

  /**
   * When word `i` starts now that the timeline may have moved: null while paused (it waits for the
   * resume), undefined while the word isn't timed yet (the stream hasn't reached it).
   */
  liveStart(i: number): number | null | undefined {
    if (this.paused) return null;
    if (i >= this.released) return undefined;
    return this.clock.wordStart(i) ?? undefined;
  }

  /**
   * The clock's speed changed: the words queued after the next one are re-timed at the new pace. The
   * next word keeps its start (a journey's hold before it stays), so the change is heard on the word
   * after it. Actions not yet fired follow their words; fired ink follows them through liveStart.
   */
  respeed(): boolean {
    if (this.stopped || !this.clock.retime) return false;
    if (this.paused) return true; // resume re-times from the next word
    const now = this.clock.now();
    const next = this.spoken < this.released ? this.clock.wordStart(this.spoken) : null;
    const prev = this.spoken > 0 ? this.clock.wordStart(this.spoken - 1) : null;
    // The next word: where it was (if timed and still ahead), else right after the word being spoken at the new pace.
    const start = next != null && next >= now ? next
      : Math.max(now, prev != null ? prev + this.clock.durationMs(this.words[this.spoken - 1]) : now);
    this.retimeFrom(this.spoken, start);
    this.tick();
    return true;
  }

  private retimeFrom(i: number, start: number) {
    this.clock.retime?.(Math.min(i, this.released), start);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.clock.dispose?.();
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

  /** Hands the next word to the clock (with its rest, after a drawn beat). */
  private release(): void {
    const i = this.released++;
    if (this.rests.has(i)) this.clock.enqueue(this.words[i], REST_MS);
    else this.clock.enqueue(this.words[i]);
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
      // Trailing actions: with the end of the narration (a held board action: when its look is over).
      const at = Math.max(now, this.clock.endsAt(), a.until ?? -Infinity);
      return { fireAt: Math.max(this.lastFire, at - lead), at };
    }
    // Waiting on a word that isn't playable yet: once the narration has run dry, flush. Not a board
    // group whose own sentences aren't playable yet: it draws over them, so it waits for the first
    // (flushed into the silence of a gate still checking them, it drew over a guessed window with nothing
    // said). One after its sentences (legacy, trailing) has them out already: held, it drew one beat late.
    if (this.started && a.word >= this.released && (!drawsSvg(a.action) || (a.from ?? a.word) < this.released)) {
      const flushAt = Math.max(this.clock.endsAt() + FLUSH_MS, a.until ?? -Infinity);
      return { fireAt: Math.max(this.lastFire, flushAt), at: Math.max(now, flushAt) };
    }
    return null;
  }

  private tick = (): void => {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.stopped || this.paused) return;
    const now = this.clock.now();

    while (this.canRelease(now)) {
      this.release();
      this.started = true;
    }

    let next = Infinity;
    // Actions first, so their ink can start in the same frame as the word's caption.
    while (this.fired < this.acts.length) {
      const a = this.acts[this.fired];
      if (drawsBoard(a.action)) {
        // The look: a board drawing waits for the page marks the student is still reading.
        const h = this.lookHold(this.fired, now);
        if (h == null) { next = Math.min(next, Math.max(now + 50, this.clock.endsAt() + FLUSH_MS)); break; }
        if (h === 'moved') continue;
      }
      const t = this.timing(a, now);
      if (!t) break;
      if (t.fireAt > now) { next = Math.min(next, t.fireAt); break; }
      const j = this.fired++;
      this.lastFire = Math.max(this.lastFire, t.fireAt);
      if (isPageMark(a.action)) this.boardFree = Math.max(this.boardFree, t.at + lookMs(a.action));
      const slot = drawsSvg(a.action) ? this.slotOf(j) : null;
      const x = slot ? { ...a.action, ...(slot.n > 1 ? { slot } : {}), beatFrom: a.beat ?? a.word } as Action : a.action;
      this.cb.onAction(x, t.at, a.word);
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
    case 'clear': return 0;
    // Ink fires early too, so the director can resolve its anchor and reveal it; the ink itself
    // still starts on the word.
    default: return 450;
  }
}

/** Does narration word `w` name one of `anchor` (lowercase id words)? Plurals and possessives count. */
export function namesWord(w: string, anchor: readonly string[]): boolean {
  const x = w.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[’']s$/, '').replace(/[^a-z0-9]+/g, '');
  if (!x) return false;
  // A two-letter name ("in", "up") only as the whole word.
  return anchor.some((a) => a.length <= 2 ? x === a : x === a || x === `${a}s` || x === `${a}es` || (a.length >= 4 && x.startsWith(a) && x.length - a.length <= 3) || (x.length >= 4 && a.startsWith(x) && a.length - x.length <= 2));
}
