// src/agent/dictation.ts — the student speaks a question: the microphone streamed to Speechmatics'
// real-time transcription, the words shown as they are recognised.
//
// POST /api/stt gives a 60 s key (server/stt.ts); the browser opens the realtime WebSocket with it
// and sends raw float32 PCM at the audio context's rate, ~100 ms per frame. Partials show at once
// and are replaced by finals; the question ends at a pause (Speechmatics' EndOfUtterance after
// END_SILENCE_S of silence, once something was said) or when the student stops it. Stopping sends
// EndOfStream and waits (briefly) for the last finals before handing back the text.
//
// The mic is opened with the browser's echo cancellation on, so a voice answer playing on the same
// page is not transcribed back as the student's.

/** Silence that ends the question. */
export const END_SILENCE_S = 0.8;
/** How long a stop waits for the last finals. */
const DRAIN_MS = 1500;
/** Samples per frame sent (~100 ms at 16 kHz; the context may run at another rate). */
const FRAME_S = 0.1;

export type DictationEvents = {
  /** The text so far: finals, then the partial still being recognised. */
  onText(text: string): void;
  /** Ended: by a pause (`auto`), a stop, or an error (`error` set; `text` is what was heard). */
  onEnd(r: { text: string; auto: boolean; error?: string }): void;
};

/** What dictation needs from the platform (tests pass fakes). */
export type DictationDeps = {
  token(): Promise<{ jwt: string; url: string }>;
  mic(): Promise<{ sampleRate: number; onFrame(f: (pcm: Float32Array) => void): void; close(): void }>;
  socket(url: string): DictationSocket;
};
export type DictationSocket = {
  readyState: number;
  binaryType: string;
  send(d: string | ArrayBufferLike): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((m: { data: unknown }) => void) | null;
  onclose: ((e: { code: number; reason: string }) => void) | null;
  onerror: ((e: unknown) => void) | null;
};

type Msg = { message: string; metadata?: { transcript?: string }; reason?: string; type?: string };

export class Dictation {
  private finals = '';
  private partial = '';
  private sock: DictationSocket | null = null;
  private mic: Awaited<ReturnType<DictationDeps['mic']>> | null = null;
  private seq = 0;
  private early: ArrayBufferLike[] = [];
  private started = false;
  private ended = false;
  private stopping = false;
  private drain: ReturnType<typeof setTimeout> | null = null;

  constructor(private ev: DictationEvents, private d: DictationDeps = browserDeps()) {}

  async start(): Promise<void> {
    try {
      const [tok, mic] = await Promise.all([this.d.token(), this.d.mic()]);
      this.mic = mic;
      if (this.ended) { mic.close(); return; }
      const sock = this.d.socket(`${tok.url}?jwt=${encodeURIComponent(tok.jwt)}`);
      sock.binaryType = 'arraybuffer';
      this.sock = sock;
      sock.onopen = () => sock.send(JSON.stringify({
        message: 'StartRecognition',
        audio_format: { type: 'raw', encoding: 'pcm_f32le', sample_rate: mic.sampleRate },
        transcription_config: { language: 'en', model: 'enhanced', enable_partials: true, max_delay: 1.0, max_delay_mode: 'flexible',
          conversation_config: { end_of_utterance_silence_trigger: END_SILENCE_S } },
      }));
      sock.onmessage = (m) => { if (typeof m.data === 'string') this.onMsg(JSON.parse(m.data) as Msg); };
      sock.onerror = () => this.finish(false, 'Dictation lost its connection.');
      sock.onclose = (e) => this.finish(false, e.code === 4001 ? 'Dictation key was refused.' : e.code === 4005 ? 'Dictation is over its quota.' : this.stopping ? undefined : `Dictation closed (${e.code}).`);
      // Frames before RecognitionStarted wait (the first words are spoken while the socket opens).
      mic.onFrame((pcm) => {
        if (this.stopping) return;
        const buf = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength);
        if (!this.started || sock.readyState !== 1) { this.early.push(buf); return; }
        sock.send(buf);
        this.seq++;
      });
    } catch (e) {
      this.finish(false, e instanceof Error && /denied|NotAllowed/i.test(`${e.name} ${e.message}`) ? 'Microphone access was blocked.' : e instanceof Error ? e.message : 'Dictation failed.');
    }
  }

  /** Ends the question now: the last words are recognised (briefly waited for), then onEnd. */
  stop(): void {
    if (this.ended || this.stopping) return;
    this.stopping = true;
    this.mic?.close();
    if (this.sock && this.sock.readyState === 1 && this.started) {
      this.sock.send(JSON.stringify({ message: 'EndOfStream', last_seq_no: this.seq }));
      this.drain = setTimeout(() => this.finish(false), DRAIN_MS);
    } else this.finish(false);
  }

  /** Drops the question: nothing is handed back. */
  cancel(): void {
    this.finals = this.partial = '';
    this.stopping = true;
    this.finish(false);
  }

  private text() { return `${this.finals}${this.finals && this.partial ? ' ' : ''}${this.partial}`.trim(); }

  private onMsg(m: Msg) {
    switch (m.message) {
      case 'RecognitionStarted':
        this.started = true;
        for (const b of this.early.splice(0)) { this.sock?.send(b); this.seq++; }
        break;
      case 'AddPartialTranscript': this.partial = (m.metadata?.transcript ?? '').trim(); this.ev.onText(this.text()); break;
      case 'AddTranscript': {
        const t = (m.metadata?.transcript ?? '').trim();
        if (t) this.finals = joinWords(this.finals, t);
        this.partial = '';
        this.ev.onText(this.text());
        break;
      }
      case 'EndOfUtterance': if (this.finals && !this.stopping) { this.stopping = true; this.mic?.close(); this.sock?.send(JSON.stringify({ message: 'EndOfStream', last_seq_no: this.seq })); this.finish(true); } break;
      case 'EndOfTranscript': this.finish(false); break;
      case 'Error': this.finish(false, m.type === 'quota_exceeded' ? 'Dictation is over its quota.' : `Dictation error: ${m.reason ?? m.type ?? 'unknown'}`); break;
    }
  }

  private finish(auto: boolean, error?: string) {
    if (this.ended) return;
    this.ended = true;
    if (this.drain) clearTimeout(this.drain);
    this.mic?.close();
    const s = this.sock;
    this.sock = null;
    if (s) { s.onclose = s.onerror = s.onmessage = null; try { s.close(); } catch { /* closed */ } }
    this.ev.onEnd({ text: this.text(), auto, ...(error ? { error } : {}) });
  }
}

/** Joins finals: Speechmatics sends punctuation as its own result ("seven" then "."), without a leading space. */
export function joinWords(a: string, b: string): string {
  if (!a) return b;
  return /^[.,!?;:%)\]'’]/.test(b) ? `${a}${b}` : `${a} ${b}`;
}

/** The browser: /api/stt for the key, getUserMedia + an AudioWorklet for the frames, a WebSocket. */
export function browserDeps(): DictationDeps {
  return {
    async token() {
      const res = await fetch('/api/stt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Dictation is unavailable.');
      return body as { jwt: string; url: string };
    },
    async mic() {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
      const ctx = new AudioContext({ sampleRate: 16000 });
      const src = ctx.createMediaStreamSource(stream);
      const code = `registerProcessor('petu-mic', class extends AudioWorkletProcessor {
        constructor() { super(); this.buf = new Float32Array(Math.round(sampleRate * ${FRAME_S})); this.n = 0; }
        process(inputs) {
          const ch = inputs[0] && inputs[0][0];
          if (ch) for (let i = 0; i < ch.length; i++) { this.buf[this.n++] = ch[i]; if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice(0)); this.n = 0; } }
          return true;
        }
      });`;
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const node = new AudioWorkletNode(ctx, 'petu-mic');
      src.connect(node);
      let closed = false;
      return {
        sampleRate: ctx.sampleRate,
        onFrame(f) { node.port.onmessage = (e) => { if (!closed) f(e.data as Float32Array); }; },
        close() {
          if (closed) return;
          closed = true;
          node.port.onmessage = null;
          src.disconnect();
          stream.getTracks().forEach((t) => t.stop());
          void ctx.close().catch(() => {});
        },
      };
    },
    socket: (url) => new WebSocket(url) as unknown as DictationSocket,
  };
}
