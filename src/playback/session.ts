import { ScriptParser } from '../script/parser';
import { Scheduler } from './scheduler';
import type { NarrationClock } from './clock';
import type { Action, ScriptEvent } from '../script/types';

export type SessionState = 'idle' | 'loading' | 'playing' | 'done' | 'stopped' | 'error';
type Deps = {
  clock: NarrationClock;
  onAction(a: Action): void;
  onWord(words: string[]): void;
  onState(s: SessionState, error?: string): void;
  /** Called as soon as an action is parsed, before it fires (lets the director warm caches). */
  onParsed?(a: Action): void;
};

/** One answer: stream → parser → scheduler. Abortable. */
export class AnswerSession {
  private ctrl = new AbortController();
  private scheduler: Scheduler | null = null;
  private words: string[] = [];
  constructor(private d: Deps) {}

  async start(source: (signal: AbortSignal) => AsyncIterable<string>): Promise<void> {
    const parser = new ScriptParser();
    this.d.onState('loading');
    this.scheduler = new Scheduler(this.d.clock, {
      onWord: (w, i) => { if (i === 0) this.d.onState('playing'); this.words = [...this.words, w]; this.d.onWord(this.words); },
      onAction: (a) => this.d.onAction(a),
      onDone: () => this.d.onState('done'),
    });
    const feed = (events: ScriptEvent[]) => {
      if (this.d.onParsed) for (const e of events) if (e.type === 'action') this.d.onParsed(e.action);
      this.scheduler!.push(events);
    };
    try {
      for await (const chunk of source(this.ctrl.signal)) {
        if (this.ctrl.signal.aborted) return;
        feed(parser.push(chunk));
      }
      if (!this.ctrl.signal.aborted) feed(parser.end());
    } catch (e) {
      if (!this.ctrl.signal.aborted) { this.scheduler.stop(); this.d.onState('error', e instanceof Error ? e.message : String(e)); }
    }
  }

  stop(): void {
    if (this.ctrl.signal.aborted) return;
    this.ctrl.abort();
    this.scheduler?.stop();
    this.d.onState('stopped');
  }
}
