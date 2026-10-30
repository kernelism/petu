import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Dictation, joinWords, type DictationDeps, type DictationSocket } from '../../src/agent/dictation';
import { mintSttToken, STT_MINT_URL } from '../../server/stt';

function fakes() {
  const sent: (string | ArrayBufferLike)[] = [];
  let frame: ((p: Float32Array) => void) | null = null;
  let micClosed = false;
  const sock: DictationSocket & { emit(m: object): void } = {
    readyState: 1, binaryType: 'blob', onopen: null, onmessage: null, onclose: null, onerror: null,
    send: (d) => sent.push(d), close: () => {},
    emit: (m) => sock.onmessage?.({ data: JSON.stringify(m) }),
  };
  let url = '';
  const deps: DictationDeps = {
    token: async () => ({ jwt: 'j w', url: 'wss://x/v2' }),
    mic: async () => ({ sampleRate: 16000, onFrame: (f) => { frame = f; }, close: () => { micClosed = true; } }),
    socket: (u) => { url = u; return sock; },
  };
  const texts: string[] = [];
  const ends: { text: string; auto: boolean; error?: string }[] = [];
  const d = new Dictation({ onText: (t) => texts.push(t), onEnd: (r) => ends.push(r) }, deps);
  return { d, sock, sent, texts, ends, url: () => url, frame: (n = 1600) => frame!(new Float32Array(n)), micClosed: () => micClosed };
}
const json = (sent: (string | ArrayBufferLike)[]) => sent.filter((x): x is string => typeof x === 'string').map((x) => JSON.parse(x));

describe('Dictation', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts recognition with the mic rate, holds early frames, shows partials then finals, and sends on a pause', async () => {
    const f = fakes();
    await f.d.start();
    expect(f.url()).toBe('wss://x/v2?jwt=j%20w');
    f.sock.onopen?.();
    expect(json(f.sent)[0]).toMatchObject({ message: 'StartRecognition', audio_format: { type: 'raw', encoding: 'pcm_f32le', sample_rate: 16000 },
      transcription_config: { language: 'en', enable_partials: true, conversation_config: { end_of_utterance_silence_trigger: 0.8 } } });
    f.frame();
    expect(f.sent).toHaveLength(1); // held until RecognitionStarted
    f.sock.emit({ message: 'RecognitionStarted' });
    f.frame();
    expect(f.sent.filter((x) => typeof x !== 'string')).toHaveLength(2);
    f.sock.emit({ message: 'AddPartialTranscript', metadata: { transcript: 'why is' } });
    f.sock.emit({ message: 'AddTranscript', metadata: { transcript: 'why is P star seven' } });
    f.sock.emit({ message: 'AddTranscript', metadata: { transcript: '?' } });
    expect(f.texts).toEqual(['why is', 'why is P star seven', 'why is P star seven?']);
    f.sock.emit({ message: 'EndOfUtterance' });
    expect(f.ends).toEqual([{ text: 'why is P star seven?', auto: true }]);
    expect(json(f.sent).at(-1)).toEqual({ message: 'EndOfStream', last_seq_no: 2 });
    expect(f.micClosed()).toBe(true);
  });

  it('ignores a pause before anything was said', async () => {
    const f = fakes();
    await f.d.start();
    f.sock.emit({ message: 'RecognitionStarted' });
    f.sock.emit({ message: 'EndOfUtterance' });
    expect(f.ends).toEqual([]);
  });

  it('stop sends EndOfStream and hands back the text at EndOfTranscript (or after a wait)', async () => {
    const f = fakes();
    await f.d.start();
    f.sock.emit({ message: 'RecognitionStarted' });
    f.sock.emit({ message: 'AddPartialTranscript', metadata: { transcript: 'what is elasticity' } });
    f.d.stop();
    expect(json(f.sent).at(-1)).toMatchObject({ message: 'EndOfStream' });
    f.sock.emit({ message: 'AddTranscript', metadata: { transcript: 'what is elasticity' } });
    f.sock.emit({ message: 'EndOfTranscript' });
    expect(f.ends).toEqual([{ text: 'what is elasticity', auto: false }]);

    const g = fakes();
    await g.d.start();
    g.sock.emit({ message: 'RecognitionStarted' });
    g.sock.emit({ message: 'AddPartialTranscript', metadata: { transcript: 'hello' } });
    g.d.stop();
    vi.advanceTimersByTime(1500);
    expect(g.ends).toEqual([{ text: 'hello', auto: false }]);
  });

  it('cancel hands back nothing; errors are reported with what was heard', async () => {
    const f = fakes();
    await f.d.start();
    f.sock.emit({ message: 'RecognitionStarted' });
    f.sock.emit({ message: 'AddPartialTranscript', metadata: { transcript: 'oops' } });
    f.d.cancel();
    expect(f.ends).toEqual([{ text: '', auto: false }]);

    const g = fakes();
    await g.d.start();
    g.sock.emit({ message: 'Error', type: 'quota_exceeded' });
    expect(g.ends[0]).toMatchObject({ text: '', error: 'Dictation is over its quota.' });
  });

  it('reports a refused key or a blocked mic', async () => {
    const f = fakes();
    await f.d.start();
    f.sock.onclose?.({ code: 4001, reason: '' });
    expect(f.ends[0].error).toMatch(/refused/);

    const ends: { error?: string }[] = [];
    const d = new Dictation({ onText: () => {}, onEnd: (r) => ends.push(r) }, {
      token: async () => ({ jwt: 'j', url: 'u' }),
      mic: async () => { const e = new Error('Permission denied'); e.name = 'NotAllowedError'; throw e; },
      socket: () => { throw new Error('no'); },
    });
    await d.start();
    expect(ends[0].error).toBe('Microphone access was blocked.');
  });

  it('closes a mic that opens after the key was refused (either order)', async () => {
    const run = async (micFirst: boolean) => {
      const close = vi.fn();
      const ends: { error?: string }[] = [];
      const tick = () => Promise.resolve().then(() => {}).then(() => {});
      const d = new Dictation({ onText: () => {}, onEnd: (r) => ends.push(r) }, {
        token: async () => { if (micFirst) await tick(); throw new Error('Dictation is unavailable.'); },
        mic: async () => { if (!micFirst) await tick(); return { sampleRate: 16000, onFrame: () => {}, close }; },
        socket: () => { throw new Error('no'); },
      });
      await d.start();
      for (let i = 0; i < 5; i++) await Promise.resolve();
      expect(ends).toEqual([{ text: '', auto: false, error: 'Dictation is unavailable.' }]);
      expect(close).toHaveBeenCalled();
    };
    await run(false);
    await run(true);
  });

  it('joins punctuation finals without a space', () => {
    expect(joinWords('', 'why')).toBe('why');
    expect(joinWords('why', 'is')).toBe('why is');
    expect(joinWords('why is it', '?')).toBe('why is it?');
  });
});

describe('mintSttToken', () => {
  it('asks Speechmatics for a 60 s realtime key and returns it with the endpoint', async () => {
    const f = vi.fn(async (_u: string, _i: RequestInit) => new Response(JSON.stringify({ key_value: 'tmp' }), { status: 201 }));
    const t = await mintSttToken('acct', f as unknown as typeof fetch);
    expect(t).toEqual({ jwt: 'tmp', url: 'wss://global.rt.speechmatics.com/v2' });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(STT_MINT_URL);
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer acct');
    expect(JSON.parse(String(init.body))).toEqual({ ttl: 60 });
  });
  it('throws without echoing the key', async () => {
    const f = async () => new Response('nope', { status: 401 });
    await expect(mintSttToken('acct', f as unknown as typeof fetch)).rejects.toThrow(/401/);
    await expect(mintSttToken('acct', f as unknown as typeof fetch)).rejects.not.toThrow(/acct/);
  });
});
