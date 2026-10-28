import type { Action, ScriptEvent } from '../script/types';
import { endsSentence, type NarrationClock } from './clock';

export type SchedulerCallbacks = {
  onWord(text: string, index: number): void;
  onAction(action: Action): void;
  onDone(): void;
};

const START_WORDS = 8;

/** Plays words at clock pace; actions fire together with the first word after them. */
export class Scheduler {
  private queue: ScriptEvent[] = [];
  private pending: Action[] = [];
  private started = false;
  private ended = false;
  private stopped = false;
  private waiting = false;
  private index = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private clock: NarrationClock, private cb: SchedulerCallbacks) {}

  push(events: ScriptEvent[]): void {
    if (this.stopped) return;
    for (const e of events) {
      if (e.type === 'end') this.ended = true;
      else this.queue.push(e);
    }
    if (!this.started) {
      if (this.ready()) {
        this.started = true;
        this.step();
      }
    } else if (this.waiting) {
      this.waiting = false;
      this.step();
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.queue = [];
    this.pending = [];
  }

  private ready(): boolean {
    if (this.ended) return true;
    let n = 0;
    for (const e of this.queue) {
      if (e.type !== 'word') continue;
      n++;
      if (n >= START_WORDS || endsSentence(e.text)) return true;
    }
    return false;
  }

  private step = (): void => {
    this.timer = null;
    if (this.stopped) return;
    while (this.queue[0]?.type === 'action') {
      this.pending.push((this.queue.shift() as { type: 'action'; action: Action }).action);
    }
    const next = this.queue.shift();
    if (!next) {
      if (this.ended) {
        this.flush();
        this.stopped = true;
        this.cb.onDone();
      } else this.waiting = true;
      return;
    }
    this.flush();
    const text = (next as { type: 'word'; text: string }).text;
    this.cb.onWord(text, this.index++);
    this.timer = setTimeout(this.step, this.clock.durationMs(text));
  };

  private flush(): void {
    const p = this.pending;
    this.pending = [];
    for (const a of p) this.cb.onAction(a);
  }
}
