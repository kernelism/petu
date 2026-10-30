import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VoiceClock, FLUSH_MS, SAMPLE_RATE, type AudioOut, type Speak } from '../../src/playback/voiceClock';
import { Scheduler } from '../../src/playback/scheduler';
import type { ScriptEvent } from '../../src/script/types';

/** PCM lasting `ms`. */
const pcmOf = (ms: number) => new Int16Array(Math.round((ms / 1000) * SAMPLE_RATE));

/** A fake voice: each piece's text is recorded; tests resolve them by hand with a duration (or null). */
function fakeVoice() {
  const asked: { text: string; speed: number; resolve(ms: number | null): void; signal: AbortSignal }[] = [];
  const speak: Speak = (text, speed, signal) => new Promise((res) => asked.push({ text, speed, signal, resolve: (ms) => res(ms == null ? null : pcmOf(ms)) }));
  const played: { at: number; offset: number; ms: number; stopped: boolean }[] = [];
  const out: AudioOut = {
    play(pcm, at, offset) {
      const p = { at, offset, ms: (pcm.length / SAMPLE_RATE) * 1000, stopped: false };
      played.push(p);
      return { stop: () => { p.stopped = true; } };
    },
  };
  return { asked, speak, out, played };
}

const make = (rate = () => 1) => {
  const v = fakeVoice();
  const clock = new VoiceClock(v.speak, v.out, () => 170, rate, () => Date.now());
  return { ...v, clock };
};
const enqueueAll = (c: VoiceClock, s: string) => s.split(' ').forEach((w) => c.enqueue(w));
const flush = () => vi.advanceTimersByTimeAsync(0);

describe('VoiceClock', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => vi.useRealTimers());

  it('sends a piece per sentence, and the first piece at its first clause', () => {
    const { clock, asked } = make();
    enqueueAll(clock, 'At the equilibrium price of seven, both sides agree. Demand falls as price rises.');
    expect(asked.map((a) => a.text)).toEqual(['At the equilibrium price of seven,', 'both sides agree.', 'Demand falls as price rises.']);
  });

  it('sends a sentence still open after FLUSH_MS without a new word', () => {
    const { clock, asked } = make();
    enqueueAll(clock, 'and so the curve');
    expect(asked).toHaveLength(0);
    vi.advanceTimersByTime(FLUSH_MS);
    expect(asked.map((a) => a.text)).toEqual(['and so the curve']);
  });

  it('times words only once their audio is in, spreading them over its real duration', async () => {
    const { clock, asked, played } = make();
    enqueueAll(clock, 'Supply rises. Demand falls.');
    expect(clock.wordStart(0)).toBeNull();
    asked[0].resolve(1000);
    await flush();
    expect(played).toEqual([{ at: 0, offset: 0, ms: 1000, stopped: false }]);
    expect(clock.wordStart(0)).toBe(0);
    expect(clock.wordStart(1)).toBeGreaterThan(200);
    expect(clock.wordStart(1)).toBeLessThan(1000);
    expect(clock.endsAt()).toBe(1000);
    expect(clock.wordStart(2)).toBeNull();
  });

  it('plays pieces back to back, in order, even when a later one loads first', async () => {
    const { clock, asked, played } = make();
    enqueueAll(clock, 'Supply rises. Demand falls.');
    asked[1].resolve(800);
    await flush();
    expect(played).toHaveLength(0);
    vi.advanceTimersByTime(300);
    asked[0].resolve(1000);
    await flush();
    expect(played.map((p) => p.at)).toEqual([300, 1300]);
    expect(clock.wordStart(2)).toBe(1300);
    expect(clock.endsAt()).toBe(2100);
  });

  it('keeps paced timing, silently, for a piece without audio', async () => {
    const { clock, asked, played } = make();
    enqueueAll(clock, 'Supply rises.');
    asked[0].resolve(null);
    await flush();
    expect(played).toHaveLength(0);
    expect(clock.wordStart(0)).toBe(0);
    expect(clock.endsAt()).toBeGreaterThan(300);
  });

  it('halt stops the audio; retime restarts its piece from that word', async () => {
    const { clock, asked, played } = make();
    enqueueAll(clock, 'Supply rises fast. Demand falls.');
    asked[0].resolve(1500);
    asked[1].resolve(1000);
    await flush();
    vi.advanceTimersByTime(600);
    clock.halt();
    expect(played.every((p) => p.stopped)).toBe(true);
    const offset1 = clock.wordStart(1)!; // word 1's offset in the piece (it started at 0)
    clock.retime(1, 5000);
    const replay = played.slice(2);
    expect(replay[0]).toMatchObject({ at: 5000, offset: offset1, stopped: false });
    expect(clock.wordStart(1)).toBe(5000);
    expect(replay[1].at).toBe(5000 + 1500 - offset1);
    expect(clock.wordStart(3)).toBe(5000 + 1500 - offset1);
  });

  it('a retime past every piece delays the next one', async () => {
    const { clock, asked, played } = make();
    enqueueAll(clock, 'Supply rises.');
    asked[0].resolve(500);
    await flush();
    clock.retime(2, 4000);
    enqueueAll(clock, 'Demand falls.');
    asked[1].resolve(500);
    await flush();
    expect(played[1].at).toBe(4000);
  });

  it('asks at the playback speed of the moment', () => {
    let rate = 1;
    const { clock, asked } = make(() => rate);
    enqueueAll(clock, 'Supply rises.');
    rate = 1.5;
    enqueueAll(clock, 'Demand falls.');
    expect(asked.map((a) => a.speed)).toEqual([1, 1.5]);
  });

  it('dispose aborts requests and stops the audio', async () => {
    const { clock, asked, played } = make();
    enqueueAll(clock, 'Supply rises. Demand');
    asked[0].resolve(500);
    await flush();
    clock.dispose();
    expect(asked[0].signal.aborted).toBe(true);
    expect(played[0].stopped).toBe(true);
    vi.advanceTimersByTime(FLUSH_MS);
    expect(asked).toHaveLength(1);
  });

  it('drives the scheduler: words are shown as their audio plays, pause halts it', async () => {
    const { clock, asked, played } = make();
    const shown: string[] = [];
    const s = new Scheduler(clock, { onWord: (t) => shown.push(`${Date.now()}:${t}`), onAction: () => {}, onDone: () => shown.push(`${Date.now()}:done`) });
    const ev = (t: string): ScriptEvent[] => [...t.split(' ').map((text) => ({ type: 'word' as const, text })), { type: 'end' }];
    s.push(ev('Supply rises.'));
    await vi.advanceTimersByTimeAsync(400);
    expect(shown).toEqual([]); // waiting on audio
    asked[0].resolve(1000);
    await vi.advanceTimersByTimeAsync(50); // the scheduler polls a clock still waiting on audio
    expect(shown).toEqual(['450:Supply']);
    expect(s.pause()).toBe(true);
    expect(played[0].stopped).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(shown).toEqual(['450:Supply']);
    s.resume();
    await vi.advanceTimersByTimeAsync(3000);
    expect(shown.map((x) => x.split(':')[1])).toEqual(['Supply', 'rises.', 'done']);
    expect(played[1].stopped).toBe(false);
  });
});
