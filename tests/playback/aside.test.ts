// An aside over a paused answer (v1 learner UX): the answer waits on its word while a second session
// plays to its end, then resumes from the very next word; neither repeats nor skips a word.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnswerSession } from '../../src/playback/session';
import { PacedClock } from '../../src/playback/clock';

describe('aside: pause on the word, play the side answer, resume where it paused', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => vi.useRealTimers());

  const session = (said: string[]) => new AnswerSession({
    clock: new PacedClock(() => 170, () => performance.now(), () => 100, () => 1),
    onAction: () => {},
    onWord: (ws) => { said.push(ws[ws.length - 1]); },
    onState: () => {},
  });

  it('the answer holds through the aside and goes on from its next word', async () => {
    const main: string[] = [], side: string[] = [];
    const m = session(main);
    void m.start(async function* () { yield 'one two three four five six seven eight.'; });
    await vi.advanceTimersByTimeAsync(700);
    expect(m.pause()).toBe(true);
    const at = main.length;
    expect(at).toBeGreaterThan(0);
    const a = session(side);
    void a.start(async function* () { yield 'alpha beta gamma.'; });
    await vi.advanceTimersByTimeAsync(5000);
    expect(side).toEqual(['alpha', 'beta', 'gamma.']);
    expect(main).toHaveLength(at); // nothing spoken under the aside
    a.stop();
    expect(m.resume()).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(main).toEqual(['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight.']);
  });
});
