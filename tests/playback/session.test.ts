import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnswerSession, type SessionState } from '../../src/playback/session';
import { PacedClock } from '../../src/playback/clock';
import type { Action } from '../../src/script/types';

function make(idle?: () => Promise<void>) {
  const states: SessionState[] = [];
  const actions: Action[] = [];
  const ats: number[] = [];
  let words: string[] = [];
  const s = new AnswerSession({
    clock: new PacedClock(() => 170, () => Date.now(), () => 100),
    onAction: (a, at) => { actions.push(a); ats.push(at); },
    onWord: (w) => { words = w; },
    onState: (st) => states.push(st),
    idle,
  });
  return { s, states, actions, ats, words: () => words };
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

  it("'done' waits for the director to go idle", async () => {
    let release = () => {};
    const idle = vi.fn(() => new Promise<void>((r) => { release = r; }));
    const { s, states, ats } = make(idle);
    vi.setSystemTime(0);
    async function* src() { yield 'One two. {{clear}} Three.'; }
    void s.start(src);
    await vi.advanceTimersByTimeAsync(2000);
    expect(ats).toEqual([200]);
    expect(idle).toHaveBeenCalledTimes(1);
    expect(states).toEqual(['loading', 'playing']);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(states).toEqual(['loading', 'playing', 'done']);
  });

  it("stop() while the ink finishes never reports 'done'", async () => {
    let release = () => {};
    const { s, states } = make(() => new Promise<void>((r) => { release = r; }));
    async function* src() { yield 'One two. Three.'; }
    void s.start(src);
    await vi.advanceTimersByTimeAsync(2000);
    s.stop();
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(states).toEqual(['loading', 'playing', 'stopped']);
  });

  it('a throwing source reports error', async () => {
    const { s, states } = make();
    async function* src(): AsyncGenerator<string> { yield 'Hi'; throw new Error('boom'); }
    await s.start(src);
    expect(states).toEqual(['loading', 'error']);
  });
});
