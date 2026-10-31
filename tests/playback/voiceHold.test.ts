// Founder lec06 (2026-10-31): "voice glitches when the slide moves". A journey's hold landed inside a
// sentence the voice was already playing: the piece stopped and restarted at an estimated offset.
import { describe, expect, it } from 'vitest';
import { VoiceClock, webAudioOut } from '../../src/playback/voiceClock';
import { SwitchClock } from '../../src/playback/switchClock';

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

function voice() {
  let t = 0;
  const plays: { at: number; off: number; stopped: boolean }[] = [];
  const out = { play: (_p: Int16Array, at: number, off: number) => { const r = { at, off, stopped: false }; plays.push(r); return { stop() { r.stopped = true; } }; } };
  const v = new VoiceClock(async () => new Int16Array(24000 * 2), out, () => 155, () => 1, () => t);
  return { v, plays, set: (x: number) => { t = x; } };
}

describe('voice: holds rest between pieces only', () => {
  it('a hold inside a playing sentence is refused; at the next sentence start it is allowed', async () => {
    const { v, plays, set } = voice();
    for (const w of 'The median filter sorts the window. It keeps the middle value.'.split(' ')) v.enqueue(w);
    await flush();
    expect(plays.length).toBe(2);
    set(500);
    expect(v.holdable(3)).toBe(false); // mid-piece, playing
    expect(v.holdable(0)).toBe(false); // its piece already playing
    expect(v.holdable(6)).toBe(true); // the next sentence, not yet started
    expect(plays.every((p) => !p.stopped)).toBe(true);
  });

  it('SwitchClock answers for its voice, and passes rests through', async () => {
    const sent: string[] = [];
    const out = { play: () => ({ stop() {} }) };
    const s = new SwitchClock(() => new VoiceClock(async (t) => { sent.push(t); return new Int16Array(2400); }, out, () => 155, () => 1, () => 0), () => 0);
    for (const w of 'One two three.'.split(' ')) s.enqueue(w);
    s.enqueue('Four', 600);
    s.enqueue('five.');
    await flush();
    expect(s.holdable(1)).toBe(false);
    expect(sent).toEqual(['One two three.', 'Four five.']);
  });

  it('web audio: a piece that follows the last one starts at its exact audio end', () => {
    const starts: number[] = [];
    const ctx = {
      currentTime: 10,
      destination: {},
      createBuffer: (_c: number, n: number, rate: number) => ({ duration: n / rate, getChannelData: () => new Float32Array(n) }),
      createBufferSource: () => ({ buffer: null as unknown, connect() {}, disconnect() {}, stop() {}, onended: null, start: (w: number) => { starts.push(w); } }),
    } as unknown as AudioContext;
    const o = webAudioOut(ctx);
    const now = performance.now();
    o.play(new Int16Array(24000), now + 100, 0); // 1 s
    o.play(new Int16Array(24000), now + 1100 + 15, 0); // placed 15 ms off by a busy thread
    expect(starts[1]).toBeCloseTo(starts[0] + 1, 6);
  });
});
