// src/agent/dictation.ts — the student speaks a question: the microphone streamed to Speechmatics'
// real-time transcription, the words shown as they are recognised.
//
// POST /api/stt gives a 60 s key (server/stt.ts); the browser opens the realtime WebSocket with it
// and sends raw float32 PCM at the audio context's rate, ~100 ms per frame. Partials show at once
// and are replaced by finals. The question ends when the student stops it, or on its own after a pause:
// Speechmatics' EndOfUtterance (END_SILENCE_S of silence) starts a short visible countdown
// (SEND_AFTER_MS, `onCountdown`), which new speech or a key (`hold`) cancels; an empty or one-word
// fragment never ends on its own. Stopping sends EndOfStream and waits (briefly) for the last finals
// before handing back the text.
//
// The mic is opened with the browser's echo cancellation on, so a voice answer playing on the same
// page is not transcribed back as the student's.

/**
 * Silence that ends the question: Speechmatics' maximum (end_of_utterance_silence_trigger, "Allowed
 * between 0 and 2 seconds", docs.speechmatics.com/speech-to-text/realtime/turn-detection). A student
 * thinking mid-question pauses longer than the 0.8 s this used to be.
 */
export const END_SILENCE_S = 2;
/** After that silence, the question goes this long later unless the student speaks or presses a key. */
export const SEND_AFTER_MS = 1000;
/** Fewer words than this never end on their own (a false start, "um"). */
const MIN_AUTO_WORDS = 2;
/** How long a stop waits for the last finals. */
const DRAIN_MS = 1500;
/** Samples per frame sent (~100 ms at 16 kHz; the context may run at another rate). */
const FRAME_S = 0.1;

export type DictationEvents = {
  /** The text so far: finals, then the partial still being recognised. */
  onText(text: string): void;
  /** Ended: by a pause (`auto`), a stop, or an error (`error` set; `text` is what was heard). */
  onEnd(r: { text: string; auto: boolean; error?: string }): void;
  /** A pause: the question goes in `ms` (a countdown to show); null: the countdown was cancelled. */
  onCountdown?(ms: number | null): void;
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
  private countdown: ReturnType<typeof setTimeout> | null = null;
  /** The end came from the pause's countdown. */
  private auto = false;

  constructor(private ev: DictationEvents, private d: DictationDeps = browserDeps()) {}

  async start(): Promise<void> {
    try {
      // The mic is owned as soon as it opens: a refused key (or a cancel) may end dictation first,
      // and Promise.all would drop the stream with its tracks still live.
      const micP = this.d.mic().then((m) => { this.mic = m; if (this.ended) m.close(); return m; });
      const [tok, mic] = await Promise.all([this.d.token(), micP]);
      if (this.ended) return;
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
  stop(): void { this.end(false); }

  /** A key was pressed: the pause's countdown is cancelled (listening goes on). */
  hold(): void { this.uncount(); }

  private end(auto: boolean) {
    this.uncount();
    if (this.ended || this.stopping) return;
    this.stopping = true;
    this.auto = auto;
    this.mic?.close();
    if (this.sock && this.sock.readyState === 1 && this.started) {
      this.sock.send(JSON.stringify({ message: 'EndOfStream', last_seq_no: this.seq }));
      this.drain = setTimeout(() => this.finish(auto), DRAIN_MS);
    } else this.finish(auto);
  }

  private uncount() {
    if (!this.countdown) return;
    clearTimeout(this.countdown);
    this.countdown = null;
    this.ev.onCountdown?.(null);
  }

  /** New words were heard: the student had not finished. */
  private spoke(t: string) { if (/[\p{L}\p{N}]/u.test(t)) this.uncount(); }

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
      case 'AddPartialTranscript': this.partial = (m.metadata?.transcript ?? '').trim(); this.spoke(this.partial); this.ev.onText(this.text()); break;
      case 'AddTranscript': {
        const t = (m.metadata?.transcript ?? '').trim();
        this.spoke(t);
        if (t) this.finals = joinWords(this.finals, t);
        this.partial = '';
        this.ev.onText(this.text());
        break;
      }
      case 'EndOfUtterance':
        if (!this.stopping && !this.countdown && wordCount(this.text()) >= MIN_AUTO_WORDS) {
          this.countdown = setTimeout(() => { this.countdown = null; this.end(true); }, SEND_AFTER_MS);
          this.ev.onCountdown?.(SEND_AFTER_MS);
        }
        break;
      case 'EndOfTranscript': this.finish(this.auto); break;
      case 'Error': this.finish(false, m.type === 'quota_exceeded' ? 'Dictation is over its quota.' : `Dictation error: ${m.reason ?? m.type ?? 'unknown'}`); break;
    }
  }

  private finish(auto: boolean, error?: string) {
    if (this.ended) return;
    this.ended = true;
    if (this.drain) clearTimeout(this.drain);
    if (this.countdown) { clearTimeout(this.countdown); this.countdown = null; }
    this.mic?.close();
    const s = this.sock;
    this.sock = null;
    if (s) { s.onclose = s.onerror = s.onmessage = null; try { s.close(); } catch { /* closed */ } }
    this.ev.onEnd({ text: this.text(), auto, ...(error ? { error } : {}) });
  }
}

/** Words with a letter or digit in them ("why?" is one). */
export const wordCount = (t: string) => t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/** Joins finals: Speechmatics sends punctuation as its own result ("seven" then "."), without a leading space. */
export function joinWords(a: string, b: string): string {
  if (!a) return b;
  return /^[.,!?;:%)\]'’]/.test(b) ? `${a}${b}` : `${a} ${b}`;
}

let available: Promise<boolean> | null = null;
/** Whether the server has a Speechmatics key (GET /api/stt → { on }); false on any failure. Asked once. */
export function dictationAvailable(): Promise<boolean> {
  available ??= fetch('/api/stt').then((r) => (r.ok ? r.json() : null)).then((b) => b?.on === true).catch(() => false);
  return available;
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
      // A graph that fails to build (a browser that won't connect the mic to a 16 kHz context, a
      // refused worklet) must not leave the mic live: the tracks are stopped and the context closed.
      let ctx: AudioContext | null = null;
      try {
        ctx = new AudioContext({ sampleRate: 16000 });
        return await graph(stream, ctx);
      } catch (e) {
        stream.getTracks().forEach((t) => t.stop());
        void ctx?.close().catch(() => {});
        throw e;
      }
    },
    socket: (url) => new WebSocket(url) as unknown as DictationSocket,
  };
}

/** The mic → AudioWorklet → ~FRAME_S float32 frames. */
async function graph(stream: MediaStream, ctx: AudioContext): Promise<Awaited<ReturnType<DictationDeps['mic']>>> {
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
}
