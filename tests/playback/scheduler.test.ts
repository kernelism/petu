import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Scheduler, actionLeadMs, FLUSH_MS, LOOK_MIN_MS, LOOK_MAX_MS, LOOK_PER_CHAR_MS, lookMs, isPageMark } from '../../src/playback/scheduler';
import { PacedClock, syllables, type NarrationClock } from '../../src/playback/clock';
import type { Action, ScriptEvent } from '../../src/script/types';

/** Every word lasts 100ms; time is Date.now() (faked). */
const fixedClock = () => new PacedClock(() => 170, () => Date.now(), () => 100);
const w = (text: string): ScriptEvent => ({ type: 'word', text });
const SKETCH: Action = { kind: 'sketch', id: 's', page: 1, size: 'm' };
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

  it('starts once ~0.6s of narration is buffered, even without punctuation', () => {
    const { s, log } = make();
    s.push(words('a b c d e')); // 500ms
    expect(log).toEqual([]);
    s.push([w('f')]); // 600ms
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
  it('beatWords: an svg group sees its beat\'s words and when each is spoken, up to the next group', () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const got: { text: string; inMs: number }[][] = [];
    const svg = (id: string): ScriptEvent => ({ type: 'action', action: { kind: 'svg', id, svg: `<g id="${id}"/>` } as Action });
    const s: Scheduler = new Scheduler(fixedClock(), {
      onWord: () => {}, onAction: (a) => { if (a.kind === 'svg') got.push(s.beatWords()); }, onDone: () => {},
    }, { leadMs: () => 0 });
    s.push([...words('Start here.'), svg('one'), ...words('the curve falls fast.'), svg('two'), ...words('then it flattens.'), END]);
    vi.advanceTimersByTime(3000);
    expect(got[0].map((x) => x.text)).toEqual(['the', 'curve', 'falls', 'fast.']);
    expect(got[0].map((x) => x.inMs)).toEqual([0, 100, 200, 300]);
    expect(got[1].map((x) => x.text)).toEqual(['then', 'it', 'flattens.']);
    vi.useRealTimers();
  });
});

describe('Scheduler: the look after a page mark (teaching rhythm)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => vi.useRealTimers());
  const svg = (id: string): ScriptEvent => ({ type: 'action', action: { kind: 'svg', id, svg: `<g id="${id}"/>` } as Action });
  const mark = (quote?: string): ScriptEvent => ({ type: 'action', action: (quote == null ? { kind: 'circle', page: 1, mark: '#d1' } : { kind: 'highlight', page: 1, quote }) as unknown as Action });
  const words = (s: string) => s.split(' ').map((t): ScriptEvent => ({ type: 'word', text: t }));
  function run(events: ScriptEvent[], ms = 20000) {
    const heard: Record<string, number> = {};
    const fired: { kind: string; id?: string; at: number; when: number; word?: number }[] = [];
    const s = new Scheduler(fixedClock(), {
      onWord: (t, i) => { heard[`${i}:${t}`] = Date.now(); },
      onAction: (a, at, word) => { fired.push({ kind: a.kind, id: (a as { id?: string }).id, at, when: Date.now(), word }); },
      onDone: () => {},
    }, { leadMs: () => 0 });
    s.push(events);
    vi.advanceTimersByTime(ms);
    return { heard, fired, s };
  }

  it('after a page mark lands, the next board group waits LOOK_MIN_MS; the words go on unheld', () => {
    const { heard, fired } = run([mark('k'), ...words('See this term. The bar grows as we said.'), svg('bar'), ...words('Then it falls.'), END]);
    // 100 ms a word: the mark lands on "See" (0); the group's own word "Then" is at 900 — too soon.
    expect(fired[0]).toMatchObject({ kind: 'highlight', at: 0 });
    const g = fired.find((f) => f.kind === 'svg')!;
    expect(g.at).toBeGreaterThanOrEqual(LOOK_MIN_MS + 25);
    expect(g.when).toBe(g.at);
    // The words were never delayed (no dead air): the first word at 0, "Then" at 900.
    expect(heard['0:See']).toBe(0);
    expect(heard['9:Then']).toBe(900);
    expect(heard['11:falls.']).toBe(1100);
  });

  it('the look scales with the quoted words, capped at LOOK_MAX_MS; a mark with no quote gets the minimum', () => {
    expect(lookMs({ kind: 'highlight', page: 1, quote: 'a'.repeat(80) } as unknown as Action)).toBe(LOOK_MAX_MS);
    expect(lookMs({ kind: 'circle', page: 1, mark: '#d1' } as unknown as Action)).toBe(LOOK_MIN_MS);
    expect(lookMs({ kind: 'highlight', page: 1, quote: 'ten chars.' } as unknown as Action)).toBe(LOOK_MIN_MS + 10 * LOOK_PER_CHAR_MS);
    // Not a page mark: a scroll, a board group, board ink.
    expect(isPageMark({ kind: 'scroll', page: 3 } as Action)).toBe(false);
    expect(isPageMark({ kind: 'svg', svg: '<g/>' } as Action)).toBe(false);
    expect(isPageMark({ kind: 'circle', region: 's', at: { x: 1, y: 1 } } as unknown as Action)).toBe(false);
    expect(isPageMark({ kind: 'box', page: 2, mark: '#e1' } as unknown as Action)).toBe(true);
  });

  it('a group re-anchors to the first word spoken once the look is over, so it draws with those words', () => {
    const many = words('See this term here now. ' + 'w '.repeat(30).trim() + '.');
    const { fired } = run([mark(), ...many.slice(0, 5), svg('g'), ...many.slice(5), END]);
    const g = fired.find((f) => f.kind === 'svg')!;
    // The mark at 0 holds the board LOOK_MIN_MS; the group's word is the first at or after it (word 12 at 1200), not "w" at 500.
    expect(g.at).toBe(LOOK_MIN_MS);
    expect(g.word).toBe(12);
  });

  it('a page mark inside the group\'s own first sentence: the mark fires first, the group waits for the look after it', () => {
    const { fired } = run([...words('Look here.'), svg('g'), ...words('The'), mark('kernel'), ...words('kernel weights add up. ' + 'w '.repeat(30).trim() + '.'), END]);
    const kinds = fired.map((f) => f.kind);
    expect(kinds.indexOf('highlight')).toBeLessThan(kinds.indexOf('svg'));
    const m = fired.find((f) => f.kind === 'highlight')!, g = fired.find((f) => f.kind === 'svg')!;
    expect(m.at).toBe(300); // "kernel"
    expect(g.at).toBeGreaterThanOrEqual(m.at + LOOK_MIN_MS + 6 * LOOK_PER_CHAR_MS);
  });

  it('groups that came together move together and keep their slots', () => {
    const { fired } = run([mark(), ...words('See this term here now. ' + 'w '.repeat(30).trim() + '.').slice(0, 5), svg('axes'), svg('curve'), ...words('w '.repeat(30).trim() + '.'), END]);
    const gs = fired.filter((f) => f.kind === 'svg');
    expect(gs.map((g) => g.id)).toEqual(['axes', 'curve']);
    expect(gs[0].at).toBe(gs[1].at);
    expect(gs[0].at).toBeGreaterThanOrEqual(LOOK_MIN_MS);
  });

  it('no page mark: groups fire on their word as before', () => {
    const { fired } = run([...words('Look here.'), svg('one'), ...words('The curve falls.'), END]);
    expect(fired[0]).toMatchObject({ kind: 'svg', at: 200 });
  });

  it('a mark after the group\'s sentence does not hold it; the one before does, from the mark\'s word not its fire time', () => {
    const { fired } = run([...words('Look here.'), svg('one'), ...words('The curve falls.'), mark(), ...words('See it.'), END]);
    expect(fired.find((f) => f.kind === 'svg')!.at).toBe(200);
  });

  it('a seek back rewinds the steps after the target and replays them on their words; other ink stays', () => {
    const log: string[] = [];
    const step = (ref: string): ScriptEvent => ({ type: 'action', action: { kind: 'step', ref } as Action });
    const s = new Scheduler(fixedClock(), {
      onWord: (t) => log.push(t),
      onAction: (a) => log.push(`<${a.kind}${'ref' in a ? ` ${(a as { ref: string }).ref}` : ''}>`),
      onRewind: (a) => log.push(`rewind ${(a as { ref: string }).ref}`),
      onDone: () => log.push('done'),
    });
    s.push([w('a.'), act('sketch'), w('b.'), step('o[1]'), w('c.'), step('o[2]'), w('d.')]); // the stream still open: the answer plays on
    while (!log.includes('d.')) vi.advanceTimersByTime(50);
    expect(log).toEqual(['a.', '<sketch>', 'b.', '<step o[1]>', 'c.', '<step o[2]>', 'd.']);
    log.length = 0;
    expect(s.seek(1)).toBe(true); // back to "b."
    expect(log).toEqual(['rewind o[2]', 'rewind o[1]']); // latest first: the earliest one's state wins
    vi.advanceTimersByTime(3000);
    // The sketch is not drawn again; each step plays again with its word.
    expect(log).toEqual(['rewind o[2]', 'rewind o[1]', 'b.', '<step o[1]>', 'c.', '<step o[2]>', 'd.']);
    // A second seek back rewinds again from the replayed state.
    log.length = 0;
    expect(s.seek(3)).toBe(true); // back to "d.", which o[2] fires with
    expect(log).toEqual(['rewind o[2]']);
  });

  it('a seek back hides the svg groups after the target and shows them again on their words (Phase 2 seek-to-state)', () => {
    const log: string[] = [];
    const g = (id: string): ScriptEvent => ({ type: 'action', action: { kind: 'svg', id, svg: `<g id="${id}"/>` } as Action });
    const s = new Scheduler(fixedClock(), {
      onWord: (t) => log.push(t),
      onAction: (a) => log.push(`<${a.kind} ${(a as { id?: string }).id ?? ''}>`),
      onRewind: (a) => log.push(`hide ${(a as { id: string }).id}`),
      onDone: () => log.push('done'),
    });
    s.push([g('one'), w('a.'), g('two'), w('b.'), g('three'), w('c.'), w('d.')]);
    while (!log.includes('d.')) vi.advanceTimersByTime(50);
    log.length = 0;
    expect(s.seek(1)).toBe(true); // back to "b.": groups two and three were drawn after it
    expect(log).toEqual(['hide three', 'hide two']);
    vi.advanceTimersByTime(3000);
    expect(log).toEqual(['hide three', 'hide two', '<svg two>', 'b.', '<svg three>', 'c.', 'd.']);
  });
});

describe('holds after a process step (teaching-engine §3.4)', () => {
  it('the sentence a step moves in ends on STEP_HOLD_MS; one without a step on no hold', async () => {
    const { STEP_HOLD_MS } = await import('../../src/playback/pace');
    const rests: [string, number | undefined][] = [];
    const clock = fixedClock();
    const enqueue = clock.enqueue.bind(clock);
    clock.enqueue = ((word: string, rest?: number) => { rests.push([word, rest]); return enqueue(word, rest); }) as typeof clock.enqueue;
    const s = new Scheduler(clock, { onWord: () => {}, onAction: () => {}, onDone: () => {} });
    const tw: ScriptEvent = { type: 'action', action: { kind: 'tween', defs: [['k', '1']] } as unknown as Action };
    s.push([w('Here'), w('it'), w('is.'), tw, w('Put'), w('it'), w('down.'), w('Then'), w('more.'), w('End.'), { type: 'end' }]);
    const held = rests.filter(([, r]) => r).map(([x, r]) => `${x}:${r}`);
    expect(held).toEqual([`Then:${STEP_HOLD_MS}`]);
  });
});
