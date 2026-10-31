// The voice changed mid-answer (founder report: "changing voice mid-answer does nothing"): Off stops the
// audio at once and the reading pace goes on from the current word; a new voice takes over at the next
// sentence boundary. No word is lost or said twice; the scheduler's captions and actions follow.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VoiceClock, SAMPLE_RATE, type AudioOut, type Speak } from '../../src/playback/voiceClock';
import { PacedClock } from '../../src/playback/clock';
import { SwitchClock } from '../../src/playback/switchClock';
import { Scheduler } from '../../src/playback/scheduler';
import type { ScriptEvent } from '../../src/script/types';

const pcmOf = (ms: number) => new Int16Array(Math.round((ms / 1000) * SAMPLE_RATE));
/** A fake voice: every piece answers at once with 100 ms per word; plays are recorded with their voice. */
function voiceFactory(log: { voice: string; text: string; at: number; stopped: boolean }[]) {
  return (voice: string) => () => {
    const texts = new WeakMap<Int16Array, string>();
    const speak: Speak = async (text) => { const pcm = pcmOf(text.split(' ').length * 100); texts.set(pcm, text); return pcm; };
    const out: AudioOut = {
      play(pcm, at) {
        const p = { voice, text: texts.get(pcm) ?? '', at, stopped: false };
        log.push(p);
        return { stop: () => { p.stopped = true; } };
      },
    };
    return new VoiceClock(speak, out, () => 170, () => 1, () => Date.now());
  };
}
const paced = () => new PacedClock(() => 170, () => Date.now(), () => 100);
const words = (s: string): ScriptEvent[] => s.split(' ').map((text) => ({ type: 'word', text }));
const TEXT = 'One two three. Four five six. Seven eight nine.';

function play(make: () => SwitchClock) {
  const said: string[] = [];
  const clock = make();
  const s = new Scheduler(clock, { onWord: (w) => said.push(w), onAction: () => {}, onDone: () => said.push('<done>') });
  s.push([...words(TEXT), { type: 'end' }]);
  return { said, clock, s };
}

describe('SwitchClock', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => vi.useRealTimers());

  it('with no switch, plays exactly as the clock it wraps', async () => {
    const a = play(() => new SwitchClock(paced));
    await vi.advanceTimersByTimeAsync(5000);
    expect(a.said.join(' ')).toBe(`${TEXT} <done>`);
    expect(a.clock.wordStart(3)).toBe(300);
  });

  it('voice → Off: the audio stops at once, the words go on at reading pace from the current one, none lost or repeated', async () => {
    const log: { voice: string; text: string; at: number; stopped: boolean }[] = [];
    const voice = voiceFactory(log);
    const { said, clock, s } = play(() => new SwitchClock(voice('marin')));
    await vi.advanceTimersByTimeAsync(330); // "One two three. Four" said
    expect(said).toEqual(['One', 'two', 'three.', 'Four']);
    clock.switchTo(paced, s.position(), 'now');
    s.respeed();
    // Every placed piece of the voice is silenced now.
    expect(log.every((p) => p.stopped)).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(said.join(' ')).toBe(`${TEXT} <done>`);
    expect(log.filter((p) => !p.stopped)).toHaveLength(0);
  });

  it('Marin → Cedar: Cedar takes over at the next sentence; Marin finishes its sentence and says nothing after', async () => {
    const log: { voice: string; text: string; at: number; stopped: boolean }[] = [];
    const voice = voiceFactory(log);
    const { said, clock, s } = play(() => new SwitchClock(voice('marin')));
    await vi.advanceTimersByTimeAsync(330);
    // A sentence switch needs no re-time (the scheduler waits on the new voice's words as on any loading voice).
    clock.switchTo(voice('cedar'), s.position(), 'sentence');
    await vi.advanceTimersByTimeAsync(5000);
    expect(said.join(' ')).toBe(`${TEXT} <done>`);
    const heard = log.filter((p) => !p.stopped);
    expect(heard.map((p) => `${p.voice}:${p.text}`)).toEqual(['marin:One two three.', 'marin:Four five six.', 'cedar:Seven eight nine.']);
    // Back to back: Cedar starts when Marin's sentence ends, never over it.
    expect(heard[2].at).toBeCloseTo(heard[1].at + 300, 3);
  });

  it('Off → a voice: the voice starts on the next sentence, after the paced one ends', async () => {
    const log: { voice: string; text: string; at: number; stopped: boolean }[] = [];
    const voice = voiceFactory(log);
    const { said, clock, s } = play(() => new SwitchClock(paced));
    await vi.advanceTimersByTimeAsync(150); // "One two" said
    expect(said).toEqual(['One', 'two']);
    clock.switchTo(voice('cedar'), s.position(), 'sentence');
    await vi.advanceTimersByTimeAsync(5000);
    expect(said.join(' ')).toBe(`${TEXT} <done>`);
    expect(log.map((p) => p.text)).toEqual(['Four five six.', 'Seven eight nine.']);
    expect(log[0].at).toBeGreaterThanOrEqual(300 - 1);
  });

  it('a switch asked for before the boundary has streamed waits for it (words enqueued later)', async () => {
    const log: { voice: string; text: string; at: number; stopped: boolean }[] = [];
    const voice = voiceFactory(log);
    const said: string[] = [];
    const clock = new SwitchClock(paced);
    const s = new Scheduler(clock, { onWord: (w) => said.push(w), onAction: () => {}, onDone: () => said.push('<done>') });
    s.push(words('One two three, four'));
    await vi.advanceTimersByTimeAsync(150);
    clock.switchTo(voice('cedar'), s.position(), 'sentence');
    s.respeed();
    s.push([...words('five. Six seven.'), { type: 'end' }]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(said.join(' ')).toBe('One two three, four five. Six seven. <done>');
    expect(log.map((p) => p.text)).toEqual(['Six seven.']);
  });

  it('a pause, then a voice change, then resume: nothing plays while paused; the words go on once', async () => {
    const log: { voice: string; text: string; at: number; stopped: boolean }[] = [];
    const voice = voiceFactory(log);
    const { said, clock, s } = play(() => new SwitchClock(paced));
    await vi.advanceTimersByTimeAsync(150);
    s.pause();
    clock.switchTo(voice('marin'), s.position(), 'sentence');
    s.respeed();
    await vi.advanceTimersByTimeAsync(2000);
    expect(log).toHaveLength(0);
    s.resume();
    await vi.advanceTimersByTimeAsync(5000);
    expect(said.join(' ')).toBe(`${TEXT} <done>`);
  });
});
