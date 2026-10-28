import { ScriptParser } from '../script/parser';
import { Scheduler, actionLeadMs } from './scheduler';
import type { NarrationClock } from './clock';
import type { RawAction as Action, ScriptEvent } from '../script/types';

export type SessionState = 'idle' | 'loading' | 'playing' | 'done' | 'stopped' | 'error';
type Deps = {
  clock: NarrationClock;
  /** `at`: when the action's word starts (clock timebase). Actions fire up to their lead before it. */
  onAction(a: Action, at: number): void;
  onWord(words: string[]): void;
  onState(s: SessionState, error?: string): void;
  /** Called as soon as an action is parsed, before it fires (lets the director warm caches). */
  onParsed?(a: Action): void;
  /** Resolves once every fired action has finished drawing. 'done' waits for it. */
  idle?(): Promise<void>;
  /** How far ahead of its word each action fires. Defaults to actionLeadMs. */
  leadMs?(a: Action): number;
};

/** One answer: stream → parser → scheduler. Abortable. */
export class AnswerSession {
  private ctrl = new AbortController();
  private scheduler: Scheduler | null = null;
  private words: string[] = [];
  constructor(private d: Deps) {}

  async start(source: (signal: AbortSignal) => AsyncIterable<string>): Promise<void> {
    const parser = new ScriptParser();
    const signal = this.ctrl.signal;
    this.d.onState('loading');
    const scheduler = new Scheduler(this.d.clock, {
      onWord: (w, i) => { if (i === 0) this.d.onState('playing'); this.words = [...this.words, w]; this.d.onWord(this.words); },
      onAction: (a, at) => this.d.onAction(a, at),
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
