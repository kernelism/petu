// The live check's shape: a voice whose pieces arrive late (one playing, one loaded, one loading) is
// turned Off mid-piece: the reading pace goes on from the current word.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VoiceClock, SAMPLE_RATE, type AudioOut, type Speak } from '../../src/playback/voiceClock';
import { PacedClock } from '../../src/playback/clock';
import { SwitchClock } from '../../src/playback/switchClock';
import { Scheduler } from '../../src/playback/scheduler';
import type { ScriptEvent } from '../../src/script/types';

const pcmOf = (ms: number) => new Int16Array(Math.round((ms / 1000) * SAMPLE_RATE));
const words = (s: string): ScriptEvent[] => s.split(' ').map((text) => ({ type: 'word', text }));

describe('SwitchClock: Off while the voice is still loading pieces', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => vi.useRealTimers());

  it('goes on at reading pace from the current word', async () => {
    const asked: { text: string; resolve(ms: number): void }[] = [];
    const speak: Speak = (text) => new Promise((res) => asked.push({ text, resolve: (ms) => res(pcmOf(ms)) }));
    const out: AudioOut = { play: () => ({ stop: () => {} }) };
    const voice = () => new VoiceClock(speak, out, () => 170, () => 1, () => Date.now());
    const paced = () => new PacedClock(() => 170, () => Date.now());
    const said: string[] = [];
    const clock = new SwitchClock(voice);
    const s = new Scheduler(clock, { onWord: (w) => said.push(w), onAction: () => {}, onDone: () => said.push('<done>') });
    s.push([...words('Renters want fewer flats as rent rises, landlords offer more, and the two lines meet where the market settles. That crossing sits at eight hundred. Now the city caps rent.'), { type: 'end' }]);
    await vi.advanceTimersByTimeAsync(2700);
    asked[0].resolve(3100);
    await vi.advanceTimersByTimeAsync(1000);
    asked[1].resolve(4100);
    await vi.advanceTimersByTimeAsync(1200);
    asked[2].resolve(5200);
    await vi.advanceTimersByTimeAsync(2600); // piece 2 playing; piece 3 placed; piece 4 loading
    const at = said.length;
    expect(at).toBeGreaterThan(7);
    clock.switchTo(paced, s.position(), 'now');
    s.respeed();
    await vi.advanceTimersByTimeAsync(2500);
    expect(said.length).toBeGreaterThan(at + 3);
    await vi.advanceTimersByTimeAsync(20000);
    expect(said.at(-1)).toBe('<done>');
  });
});
