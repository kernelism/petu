import { ScriptParser } from '../script/parser';
import { Scheduler, actionLeadMs } from './scheduler';
import type { NarrationClock } from './clock';
import type { RawAction as Action, ScriptEvent } from '../script/types';

export type SessionState = 'idle' | 'loading' | 'playing' | 'done' | 'stopped' | 'error';
type Deps = {
  clock: NarrationClock;
  /**
   * `at`: when the action's word starts (clock timebase). Actions fire up to their lead before it.
   * `live`: the word's start as it stands now (null while paused): pause, speed and seek move words
   * after the action fired, and ink that waits for its word follows it. Absent when the action is
   * behind on purpose (a forward seek's fast-forward).
   */
  onAction(a: Action, at: number, live?: () => number | null): void;
  onWord(words: string[]): void;
  onState(s: SessionState, error?: string): void;
  /** Called as soon as an action is parsed, before it fires (lets the director warm caches). */
  onParsed?(a: Action): void;
  /** Resolves once every fired action has finished drawing. 'done' waits for it. */
  idle?(): Promise<void>;
  /** How far ahead of its word each action fires. Defaults to actionLeadMs. */
  leadMs?(a: Action): number;
  /** The script so far (all words parsed, every action with the index of the word it fires with), after each chunk. */
  onScript?(s: ParsedScript): void;
};

/** The parsed script: `acts[i].word` is the index of the word the action fires with (= words.length for trailing actions). */
export type ParsedScript = { words: string[]; acts: { action: Action; word: number }[]; ended: boolean };

/** One answer: stream → parser → scheduler. Abortable. */
export class AnswerSession {
  private ctrl = new AbortController();
  private scheduler: Scheduler | null = null;
  private words: string[] = [];
  private parsed: ParsedScript = { words: [], acts: [], ended: false };
  constructor(private d: Deps) {}

  /** Pause/resume/seek (see Scheduler). False when nothing changed. */
  pause(): boolean { return this.scheduler?.pause() ?? false; }
  resume(): boolean { return this.scheduler?.resume() ?? false; }
  isPaused(): boolean { return this.scheduler?.isPaused() ?? false; }
  canPause(): boolean { return this.scheduler?.canPause() ?? false; }
  /** Index of the next word to be spoken. */
  position(): number { return this.scheduler?.position() ?? 0; }
  /** Words that start before `t` (see Scheduler.wordsBefore). */
  wordsBefore(t: number): number { return this.scheduler?.wordsBefore(t) ?? 0; }
  /** The narration from the current word to the end of its beat, with how soon each word is spoken (Scheduler.beatWords). */
  beatWords(): { text: string; inMs: number }[] { return this.scheduler?.beatWords() ?? []; }
  seek(word: number): boolean { return this.scheduler?.seek(word) ?? false; }
  /** The playback speed changed (the clock's rate): re-times the words not yet spoken. */
  respeed(): boolean { return this.scheduler?.respeed() ?? false; }
  /** The script parsed so far (every word, spoken or not). */
  script(): ParsedScript { return this.parsed; }
  /** A journey's arrival beat: `ms` of silence before the first word at or after `at`. */
  hold(at: number, ms: number): void { this.scheduler?.hold(at, ms); }

  async start(source: (signal: AbortSignal) => AsyncIterable<string>): Promise<void> {
    const parser = new ScriptParser();
    const signal = this.ctrl.signal;
    this.d.onState('loading');
    const scheduler = new Scheduler(this.d.clock, {
      // A seek back repeats words: the shown narration is cut back to the word being spoken.
      onWord: (w, i) => { if (i === 0 && !this.words.length) this.d.onState('playing'); this.words = [...this.words.slice(0, i), w]; this.d.onWord(this.words); },
      onAction: (a, at, word) => this.d.onAction(a, at, word == null ? undefined : () => {
        const t = scheduler.liveStart(word);
        return t === undefined ? at : t;
      }),
      // Done means the narration has ended and the last ink has landed.
      onDone: () => {
        void Promise.resolve(this.d.idle?.())
          .catch(() => {})
          .then(() => { if (!signal.aborted && this.scheduler === scheduler) this.d.onState('done'); });
      },
    }, { leadMs: this.d.leadMs ?? actionLeadMs });
    this.scheduler = scheduler;
    const feed = (events: ScriptEvent[]) => {
      if (this.d.onParsed) for (const e of events) if (e.type === 'action') this.d.onParsed(e.action);
      if (events.length) {
        const s = this.parsed;
        const words = [...s.words], acts = [...s.acts];
        let ended = s.ended;
        for (const e of events) {
          if (e.type === 'word') words.push(e.text);
          else if (e.type === 'action') acts.push({ action: e.action, word: words.length });
          else ended = true;
        }
        this.parsed = { words, acts, ended };
        this.d.onScript?.(this.parsed);
      }
      scheduler.push(events);
    };
    try {
      for await (const chunk of source(signal)) {
        if (signal.aborted) return;
        feed(parser.push(chunk));
      }
      if (!signal.aborted) feed(parser.end());
    } catch (e) {
      if (!signal.aborted) {
        scheduler.stop();
        this.scheduler = null;
        this.d.onState('error', e instanceof Error ? e.message : String(e));
      }
    }
  }

  stop(): void {
    if (this.ctrl.signal.aborted) return;
    this.ctrl.abort();
    this.scheduler?.stop();
    this.d.onState('stopped');
  }
}
