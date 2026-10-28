import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Scheduler } from '../../src/playback/scheduler';
import type { ScriptEvent } from '../../src/script/types';

const clock = { durationMs: () => 100 };
const w = (text: string): ScriptEvent => ({ type: 'word', text });
const act: ScriptEvent = { type: 'action', action: { kind: 'clear' } };

describe('Scheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function make() {
    const log: string[] = [];
    const s = new Scheduler(clock, {
      onWord: (t) => log.push(`${Date.now()}:${t}`),
      onAction: (a) => log.push(`${Date.now()}:<${a.kind}>`),
      onDone: () => log.push(`${Date.now()}:done`),
    });
    return { s, log };
  }

  it('waits for a sentence before starting, then paces words', () => {
    vi.setSystemTime(0);
    const { s, log } = make();
    s.push([w('Hello'), w('there')]);
    expect(log).toEqual([]);
    s.push([w('friend.'), { type: 'end' }]);
    vi.advanceTimersByTime(1000);
    expect(log).toEqual(['0:Hello', '100:there', '200:friend.', '300:done']);
  });

  it('fires actions at the next word, not when the tag arrives', () => {
    vi.setSystemTime(0);
    const { s, log } = make();
    s.push([w('a'), w('b.'), act, w('c'), { type: 'end' }]);
    vi.advanceTimersByTime(1000);
    expect(log).toEqual(['0:a', '100:b.', '200:<clear>', '200:c', '300:done']);
  });

  it('never outruns the stream', () => {
    vi.setSystemTime(0);
    const { s, log } = make();
    s.push([w('One.')]);
    vi.advanceTimersByTime(500);
    expect(log).toEqual(['0:One.']);
    s.push([w('Two')]);
    expect(log).toEqual(['0:One.', '500:Two']);
  });

  it('flushes trailing actions at end, and stop() cancels everything', () => {
    vi.setSystemTime(0);
    const { s, log } = make();
    s.push([w('x.'), act, { type: 'end' }]);
    vi.advanceTimersByTime(1000);
    expect(log).toEqual(['0:x.', '100:<clear>', '100:done']);

    vi.setSystemTime(0);
    const b = make();
    b.s.push([w('a.'), w('b'), w('c')]);
    b.s.stop();
    vi.advanceTimersByTime(1000);
    expect(b.log).toEqual(['0:a.']);
  });
});
