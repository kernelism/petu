import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Scheduler, actionLeadMs, FLUSH_MS } from '../../src/playback/scheduler';
import { PacedClock, syllables, type NarrationClock } from '../../src/playback/clock';
import type { Action, ScriptEvent } from '../../src/script/types';

/** Every word lasts 100ms; time is Date.now() (faked). */
const fixedClock = () => new PacedClock(() => 170, () => Date.now(), () => 100);
const w = (text: string): ScriptEvent => ({ type: 'word', text });
const SKETCH: Action = { kind: 'sketch', id: 's', page: 1, size: 'm', place: 'auto' };
const act = (kind: 'clear' | 'sketch' = 'clear'): ScriptEvent => ({ type: 'action', action: kind === 'clear' ? { kind } : SKETCH });
const words = (s: string) => s.split(' ').map(w);
const END: ScriptEvent = { type: 'end' };

describe('Scheduler', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => vi.useRealTimers());

  function make(opts: { clock?: NarrationClock; lead?: (a: Action) => number } = {}) {
    const log: string[] = [];
    const ats: number[] = [];
    const s = new Scheduler(opts.clock ?? fixedClock(), {
      onWord: (t) => log.push(`${Date.now()}:${t}`),
      onAction: (a, at) => { log.push(`${Date.now()}:<${a.kind}>`); ats.push(at); },
      onDone: () => log.push(`${Date.now()}:done`),
    }, { leadMs: opts.lead });
    return { s, log, ats };
  }

  it('starts on the first clause end, then paces words', () => {
    const { s, log } = make();
    s.push(words('Hello there'));
    expect(log).toEqual([]);
    s.push([w('friend,')]);
    expect(log).toEqual(['0:Hello']);
    s.push([...words('how are you?'), END]);
    vi.advanceTimersByTime(2000);
    expect(log).toEqual(['0:Hello', '100:there', '200:friend,', '300:how', '400:are', '500:you?', '600:done']);
  });

  it('starts once ~1.5s of narration is buffered, even without punctuation', () => {
    const { s, log } = make();
    s.push(words('a b c d e f g h i j k l m n')); // 1400ms
    expect(log).toEqual([]);
    s.push([w('o')]); // 1500ms
    expect(log).toEqual(['0:a']);
  });

  it('fires actions with the next word; sharing a word, they fire together', () => {
    const { s, log, ats } = make();
    s.push([w('a'), w('b.'), act(), act('sketch'), w('c'), END]);
    vi.advanceTimersByTime(1000);
    expect(log).toEqual(['0:a', '100:b.', '200:<clear>', '200:<sketch>', '200:c', '300:done']);
    expect(ats).toEqual([200, 200]);
  });

  it('fires an action up to its lead early, reporting its word time', () => {
    const { s, log, ats } = make({ lead: (a) => (a.kind === 'sketch' ? 250 : 0) });
    s.push([...words('one two three four five.'), act('sketch'), w('six.'), END]);
    vi.advanceTimersByTime(2000);
    expect(log.slice(0, 4)).toEqual(['0:one', '100:two', '200:three', '250:<sketch>']);
    expect(ats).toEqual([500]);
    expect(log).toContain('500:six.');
  });

  it('never fires an action before an earlier one', () => {
    const { s, log } = make({ lead: (a) => (a.kind === 'sketch' ? 1000 : 0) });
    s.push([w('a'), w('b.'), act(), w('c'), act('sketch'), w('d.'), END]);
    vi.advanceTimersByTime(1000);
    expect(log.slice(0, 5)).toEqual(['0:a', '100:b.', '200:<clear>', '200:<sketch>', '200:c']);
  });

  it('never outruns the stream, and pauses between clauses rather than mid-phrase', () => {
    const { s, log } = make();
    s.push(words('One two,'));
    s.push(words('three four'));
    vi.advanceTimersByTime(1000);
    // "three four" is an unfinished clause with < 1s of words: it waits whole.
    expect(log).toEqual(['0:One', '100:two,']);
    s.push([w('five.')]);
    expect(log).toEqual(['0:One', '100:two,', '1000:three']);
    vi.advanceTimersByTime(200);
    expect(log.at(-1)).toBe('1200:five.');
  });

  it('after running dry mid-clause, resumes only with a clause or ~1s buffered', () => {
    const { s, log } = make();
    s.push(words('a b c d e f g h i j k l m n o')); // 1.5s, starts
    vi.advanceTimersByTime(1700);
    expect(log.at(-1)).toBe('1400:o');
    s.push([w('p')]);
    expect(log.at(-1)).toBe('1400:o'); // dry: wait for more
    s.push([w('q.')]);
    expect(log.at(-1)).toBe('1700:p');
  });

  it('a word that arrives just after the narration ran dry plays at once', () => {
    const { s, log } = make();
    s.push(words('a b c d e f g h i j k l m n o'));
    vi.advanceTimersByTime(1550);
    s.push([w('p')]);
    expect(log.at(-1)).toBe('1550:p');
  });

  it('leads a sketch by 450ms, so its glide lands on its word', () => {
    expect(actionLeadMs(SKETCH)).toBe(450);
    expect(actionLeadMs({ kind: 'scroll', page: 1 })).toBe(450);
    expect(actionLeadMs({ kind: 'clear' })).toBe(0);
  });

  it('flushes actions waiting on a stalled word after FLUSH_MS of silence', () => {
    const { s, log, ats } = make({ lead: actionLeadMs });
    s.push([w('Take,'), act()]);
    vi.advanceTimersByTime(100 + FLUSH_MS - 1);
    expect(log).toEqual(['0:Take,']);
    vi.advanceTimersByTime(1);
    expect(log).toEqual(['0:Take,', `${100 + FLUSH_MS}:<clear>`]);
    expect(ats).toEqual([100 + FLUSH_MS]);
    vi.advanceTimersByTime(5000);
    s.push([w('this.'), END]);
    vi.advanceTimersByTime(500);
    expect(log.slice(2)).toEqual(['5300:this.', '5400:done']);
  });

  it('flushes trailing actions at the end; stop() cancels everything', () => {
    const { s, log } = make();
    s.push([w('x.'), act(), END]);
    vi.advanceTimersByTime(1000);
    expect(log).toEqual(['0:x.', '100:<clear>', '100:done']);

    vi.setSystemTime(0);
    const b = make();
    b.s.push(words('a. b c'));
    b.s.stop();
    vi.advanceTimersByTime(1000);
    expect(b.log).toEqual(['0:a.']);
  });

  it('schedules from absolute word times a clock supplies (TTS seam)', () => {
    const starts: (number | null)[] = [];
    let end = -Infinity;
    const tts: NarrationClock = {
      now: () => Date.now(),
      durationMs: () => 100,
      enqueue: () => starts.push(null) - 1,
      wordStart: (i) => starts[i] ?? null,
      endsAt: () => end,
    };
    const { s, log } = make({ clock: tts });
    s.push([w('hi'), act(), w('there.'), END]);
    vi.advanceTimersByTime(300);
    expect(log).toEqual([]); // no audio timings yet
    starts[0] = 400; starts[1] = 700; end = 900;
    vi.advanceTimersByTime(1000);
    expect(log).toEqual(['400:hi', '700:<clear>', '700:there.', '900:done']);
  });

  it('is chunking-independent for a script fed word by word', () => {
    const ev: ScriptEvent[] = [...words('Here is the idea.'), act(), ...words('Take this point, then that one.'), END];
    const a = make(); a.s.push(ev); vi.advanceTimersByTime(5000);
    vi.setSystemTime(0);
    const b = make(); for (const e of ev) b.s.push([e]); vi.advanceTimersByTime(5000);
    expect(b.log).toEqual(a.log);
  });
});

describe('PacedClock', () => {
  it('weights words by syllables at the same average pace', () => {
    const c = new PacedClock(() => 120, () => 0);
    expect(syllables('the')).toBe(1);
    expect(syllables('epipolar')).toBe(4);
    expect(syllables('x-prime')).toBe(2);
    expect(syllables('—')).toBe(0);
    expect(c.durationMs('epipolar')).toBeGreaterThan(c.durationMs('the') * 2);
    expect(c.durationMs('—')).toBe(0);
    const sample = 'Take this point x in the left image and project the whole ray into the second camera'.split(' ');
    const mean = sample.reduce((s, x) => s + c.durationMs(x), 0) / sample.length;
    expect(mean).toBeGreaterThan(400);
    expect(mean).toBeLessThan(600); // 120 wpm = 500ms a word
  });

  it('lays words end to end on an absolute timeline', () => {
    let t = 1000;
    const c = new PacedClock(() => 170, () => t, () => 100);
    expect(c.enqueue('a')).toBe(0);
    expect(c.enqueue('b')).toBe(1);
    expect([c.wordStart(0), c.wordStart(1), c.endsAt()]).toEqual([1000, 1100, 1200]);
    t = 5000;
    c.enqueue('c');
    expect(c.wordStart(2)).toBe(5000); // after a gap, the next word starts now
  });
});
