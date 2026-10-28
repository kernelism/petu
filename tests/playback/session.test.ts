import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnswerSession, type SessionState } from '../../src/playback/session';
import type { Action } from '../../src/script/types';

const clock = { durationMs: () => 100 };

function make() {
  const states: SessionState[] = [];
  const actions: Action[] = [];
  let words: string[] = [];
  const s = new AnswerSession({
    clock,
    onAction: (a) => actions.push(a),
    onWord: (w) => { words = w; },
    onState: (st) => states.push(st),
  });
  return { s, states, actions, words: () => words };
}

describe('AnswerSession', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('plays a streamed answer: loading → playing → done', async () => {
    const { s, states, actions, words } = make();
    async function* src() { yield 'Hello there. {{clear}} Bye.'; }
    void s.start(src);
    await vi.advanceTimersByTimeAsync(2000);
    expect(states).toEqual(['loading', 'playing', 'done']);
    expect(words()).toEqual(['Hello', 'there.', 'Bye.']);
    expect(actions).toEqual([{ kind: 'clear' }]);
  });

  it('stop() mid-stream reports stopped and plays no further words', async () => {
    const { s, states, words } = make();
    async function* src(signal: AbortSignal) {
      for (const c of ['One two. ', 'three four ', 'five six ', 'seven eight.']) {
        if (signal.aborted) return;
        yield c;
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    void s.start(src);
    await vi.advanceTimersByTimeAsync(150);
    s.stop();
    const at = words().length;
    expect(at).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(words().length).toBe(at);
    expect(states[states.length - 1]).toBe('stopped');
    expect(states).not.toContain('done');
  });

  it('a throwing source reports error', async () => {
    const { s, states } = make();
    async function* src(): AsyncGenerator<string> { yield 'Hi'; throw new Error('boom'); }
    await s.start(src);
    expect(states).toEqual(['loading', 'error']);
  });
});
