import { describe, it, expect } from 'vitest';
import { VoiceLine, normWords, validateVoice, voiceUsd, voiceWorstUsd, type SpeakResult, type VoiceSocket } from '../../server/voice';

/** A fake Realtime socket: records what is sent; `emit` plays server events. */
function fakeSocket() {
  const sent: any[] = [];
  const s: VoiceSocket & { emit(e: object): void } = {
    readyState: 1, onopen: null, onmessage: null, onclose: null, onerror: null,
    send: (d) => sent.push(JSON.parse(d)),
    close: () => {},
    emit: (e) => s.onmessage?.({ data: JSON.stringify(e) }),
  };
  return { s, sent };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const pcm = (n: number) => Buffer.alloc(n).toString('base64');

describe('VoiceLine', () => {
  function line() {
    const { s, sent } = fakeSocket();
    let opened = 0;
    const l = new VoiceLine('k', (url, key) => { opened++; expect(url).toContain('gpt-realtime-2.1-mini'); expect(key).toBe('k'); setTimeout(() => s.onopen?.(), 0); return s; });
    return { l, s, sent, opened: () => opened };
  }
  const job = (text: string, out: { audio: number; done?: SpeakResult }) => ({
    id: text, text, voice: 'marin' as const, speed: 1,
    onAudio: (b: Buffer) => { out.audio += b.length; },
    done: (r: SpeakResult) => { out.done = r; },
  });

  it('reads each text as an out-of-band response and streams its audio', async () => {
    const { l, s, sent } = line();
    const out = { audio: 0 } as { audio: number; done?: SpeakResult };
    l.speak(job('Supply rises.', out));
    await tick();
    expect(sent[0]).toMatchObject({ type: 'session.update', session: { audio: { output: { voice: 'marin', speed: 1, format: { type: 'audio/pcm', rate: 24000 } } } } });
    expect(sent[1]).toMatchObject({ type: 'response.create', response: { conversation: 'none', output_modalities: ['audio'] } });
    expect(sent[1].response.input[0].content[0].text).toBe('Supply rises.');
    s.emit({ type: 'response.output_audio.delta', delta: pcm(480) });
    s.emit({ type: 'response.output_audio_transcript.delta', delta: 'Supply rises.' });
    s.emit({ type: 'response.done', response: { status: 'completed', usage: { input_tokens: 80, output_tokens: 120, output_token_details: { audio_tokens: 100 } } } });
    expect(out.audio).toBe(480);
    expect(out.done).toMatchObject({ ok: true, transcript: 'Supply rises.' });
  });

  it('runs responses one at a time, updating the session only when voice or speed change', async () => {
    const { l, s, sent, opened } = line();
    const a = { audio: 0 }, b = { audio: 0 }, c = { audio: 0 };
    l.speak(job('One.', a));
    l.speak(job('Two.', b));
    l.speak({ ...job('Three.', c), speed: 1.5 });
    await tick();
    expect(sent.map((m) => m.type)).toEqual(['session.update', 'response.create']);
    s.emit({ type: 'response.done', response: { status: 'completed', usage: {} } });
    await tick();
    expect(sent.map((m) => m.type)).toEqual(['session.update', 'response.create', 'response.create']);
    s.emit({ type: 'response.done', response: { status: 'completed', usage: {} } });
    await tick();
    expect(sent.slice(3).map((m) => m.type)).toEqual(['session.update', 'response.create']);
    expect(sent[3].session.audio.output.speed).toBe(1.5);
    expect(opened()).toBe(1);
  });

  it('cancels a queued job without sending it, and the running one with response.cancel', async () => {
    const { l, s, sent } = line();
    const a = { audio: 0 } as { audio: number; done?: SpeakResult }, b = { audio: 0 } as { audio: number; done?: SpeakResult };
    const ha = l.speak(job('One.', a));
    const hb = l.speak(job('Two.', b));
    await tick();
    hb.cancel();
    ha.cancel();
    expect(sent.at(-1)).toEqual({ type: 'response.cancel' });
    s.emit({ type: 'response.done', response: { status: 'cancelled', usage: { output_tokens: 10 } } });
    await tick();
    expect(a.done).toMatchObject({ ok: false, error: 'cancelled', usage: { output_tokens: 10 } });
    expect(sent.filter((m) => m.type === 'response.create')).toHaveLength(1);
  });

  it('fails the job in flight on an error event or a closed socket', async () => {
    const { l, s } = line();
    const a = { audio: 0 } as { audio: number; done?: SpeakResult }, b = { audio: 0 } as { audio: number; done?: SpeakResult };
    l.speak(job('One.', a));
    await tick();
    s.emit({ type: 'error', error: { message: 'bad' } });
    expect(a.done).toMatchObject({ ok: false, error: 'bad' });
    l.speak(job('Two.', b));
    await tick();
    s.onclose?.({ code: 1006, reason: '' });
    expect(b.done).toMatchObject({ ok: false });
  });
});

describe('voice helpers', () => {
  it('prices audio output at the audio rate and the rest as text', () => {
    // 103 text in at $0.60, 39 text out at $2.40, 99 audio out at $20 (per 1M)
    expect(voiceUsd({ input_tokens: 103, output_tokens: 138, output_token_details: { audio_tokens: 99 } })).toBeCloseTo((103 * 0.6 + 39 * 2.4 + 99 * 20) / 1e6, 9);
    expect(voiceUsd({ input_tokens: 100, output_tokens: 0, input_token_details: { cached_tokens: 64 } })).toBeCloseTo((36 * 0.6 + 64 * 0.06) / 1e6, 9);
    expect(voiceWorstUsd(120)).toBeGreaterThan(voiceUsd({ input_tokens: 103, output_tokens: 300, output_token_details: { audio_tokens: 250 } }));
  });
  it('compares transcripts by words only', () => {
    expect(normWords('Supply, rises!')).toBe(normWords('supply rises'));
    expect(normWords('P* = 7')).toBe('p 7');
  });
  it('validates the request', () => {
    expect(validateVoice({ text: 'Hi.' })).toBeNull();
    expect(validateVoice({ text: '' })).toMatch(/text/);
    expect(validateVoice({ text: 'x'.repeat(1201) })).toMatch(/1200/);
    expect(validateVoice({ text: 'Hi.', voice: 'robot' })).toMatch(/voice/);
    expect(validateVoice({ text: 'Hi.', speed: 3 })).toMatch(/speed/);
  });
});
