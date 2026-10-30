// server/voice.ts — the narration's voice: OpenAI's Realtime API (gpt-realtime-2.1-mini) read as a
// streaming text-to-speech engine. POST /api/voice { text, voice?, speed? } → raw PCM (24 kHz, 16-bit
// signed little-endian, mono), streamed as it arrives.
//
// The Speech endpoint's models (tts-1, gpt-4o-mini-tts) shut down 2027-01-06; OpenAI points to the
// Realtime API. One WebSocket per dev server is kept warm and reused: opening one costs ~1.4 s, a
// response on an open one starts its audio in ~0.5 s. Each sentence is an out-of-band response
// (`conversation: "none"`, its own input), so nothing accumulates in the session and every response
// costs the same. Responses run one at a time, in arrival order: the browser plays them in order
// and asks ahead, so a queue never delays what is being heard.
//
// The text is the gated narration (the browser sends only words the scheduler has released), read
// verbatim under strict instructions. The model can still change a word; the transcript it returns
// is compared and a mismatch is logged (`voice: said …`), never shown.
//
// Spend: every response reserves its worst case on the ledger (kind `voice`) and settles from usage.
// The key never leaves this file's WebSocket headers.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Ledger, Phase } from './ledger';
import { REALTIME_PRICES } from './prices';

export const VOICE_MODEL = 'gpt-realtime-2.1-mini';
export const VOICES = ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse'] as const;
export type Voice = (typeof VOICES)[number];
/** One request's text: a sentence or two of narration. */
export const VOICE_MAX_CHARS = 1200;
/** Realtime sessions end at 60 minutes; reconnect before that. */
const SESSION_MS = 55 * 60_000;
/** A response that has produced nothing for this long is cancelled. */
const STALL_MS = 15_000;

export const VOICE_INSTRUCTIONS =
  'You are the voice of a calm, clear lecturer reading a tutor\'s narration aloud. Read the user\'s text aloud ' +
  'exactly as written, word for word: do not add, drop, reorder or change any word, and do not answer or comment ' +
  'on it. No greeting, no preamble, no filler. Say numbers and symbols the natural spoken way. Keep a steady, ' +
  'unhurried teaching pace.';

/** Audio tokens per second of speech (measured 2026-10-30: 99–176 tokens for 4.6–8.8 s), rounded up. */
const AUDIO_TOKENS_PER_S = 25;

/** Worst case for `chars` of text: ~15 chars per spoken second at the slowest pace, plus reasoning and text tokens. */
export function voiceWorstUsd(chars: number): number {
  const p = REALTIME_PRICES[VOICE_MODEL];
  const secs = chars / 10 + 2;
  const audioOut = secs * AUDIO_TOKENS_PER_S;
  const textOut = chars / 2 + 200; // transcript + reasoning
  const textIn = 300 + chars / 3;
  return (audioOut * p.audioOut + textOut * p.out + textIn * p.in) / 1e6;
}

export type RealtimeUsage = {
  input_tokens?: number; output_tokens?: number;
  input_token_details?: { text_tokens?: number; audio_tokens?: number; cached_tokens?: number };
  output_token_details?: { text_tokens?: number; audio_tokens?: number; reasoning_tokens?: number };
};

/** Cost of one response from its usage (`reasoning_tokens` are billed as text output, inside `text_tokens` or alongside). */
export function voiceUsd(u: RealtimeUsage): number {
  const p = REALTIME_PRICES[VOICE_MODEL];
  const cached = u.input_token_details?.cached_tokens ?? 0;
  const inTok = Math.max(0, (u.input_tokens ?? 0) - cached);
  const audioOut = u.output_token_details?.audio_tokens ?? 0;
  const textOut = Math.max(0, (u.output_tokens ?? 0) - audioOut);
  return (inTok * p.in + cached * p.cached + textOut * p.out + audioOut * p.audioOut) / 1e6;
}

/** Lowercase words, punctuation dropped: how a transcript is compared to the text it was asked to read. */
export const normWords = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean).join(' ');

/** How a response ended: `transcript` is what the model said (ok only). */
export type SpeakResult = { ok: true; usage: RealtimeUsage; transcript: string } | { ok: false; error: string; usage?: RealtimeUsage };

type Job = {
  id: string; text: string; voice: Voice; speed: number;
  onAudio(pcm: Buffer): void;
  /** Ends the job. `usage` whenever the response ran (a failed or cancelled one is billed too). */
  done(r: SpeakResult): void;
  cancelled: boolean;
};

/** The socket the voice uses; WebSocket-like (tests pass a fake). */
export type VoiceSocket = {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((m: { data: unknown }) => void) | null;
  onclose: ((e: { code: number; reason: string }) => void) | null;
  onerror: ((e: unknown) => void) | null;
};
export type OpenSocket = (url: string, key: string) => VoiceSocket;

const defaultOpen: OpenSocket = (url, key) =>
  // Node's WebSocket (undici) takes request headers in its init; a browser's would not.
  new WebSocket(url, { headers: { Authorization: `Bearer ${key}` } } as unknown as string[]) as unknown as VoiceSocket;

/** One warm Realtime session, its responses run one at a time. */
export class VoiceLine {
  private sock: VoiceSocket | null = null;
  private ready: Promise<void> | null = null;
  private openedAt = 0;
  private queue: Job[] = [];
  private current: Job | null = null;
  private transcript = '';
  private stall: ReturnType<typeof setTimeout> | null = null;
  private session = { voice: '', speed: 0 };

  constructor(private key: string, private open: OpenSocket = defaultOpen, private now: () => number = Date.now) {}

  /** Opens the session ahead of the first sentence (a question was just asked). */
  warm(): Promise<void> {
    return this.connect().catch(() => {});
  }

  speak(job: Omit<Job, 'cancelled'>): { cancel(): void } {
    const j: Job = { ...job, cancelled: false };
    this.queue.push(j);
    void this.pump();
    return {
      cancel: () => {
        if (j.cancelled) return;
        j.cancelled = true;
        if (this.current === j) this.send({ type: 'response.cancel' });
        else if (this.queue.includes(j)) {
          // Never sent: it ends here (its request settles its reservation in done).
          this.queue = this.queue.filter((q) => q !== j);
          j.done({ ok: false, error: 'cancelled' });
        }
      },
    };
  }

  close(): void {
    this.sock?.close();
    this.sock = null;
    this.ready = null;
  }

  private connect(): Promise<void> {
    if (this.ready && this.sock && this.now() - this.openedAt < SESSION_MS) return this.ready;
    if (this.sock) { this.sock.onclose = null; this.sock.close(); }
    this.session = { voice: '', speed: 0 };
    const sock = this.open(`wss://api.openai.com/v1/realtime?model=${VOICE_MODEL}`, this.key);
    this.sock = sock;
    this.openedAt = this.now();
    this.ready = new Promise<void>((resolve, reject) => {
      sock.onopen = () => resolve();
      sock.onerror = () => reject(new Error('voice: connection failed'));
      sock.onclose = (e) => {
        reject(new Error(`voice: closed ${e.code}`));
        if (this.sock === sock) { this.sock = null; this.ready = null; }
        this.fail(`connection closed (${e.code})`);
      };
      sock.onmessage = (m) => this.onEvent(JSON.parse(String(m.data)));
    });
    return this.ready;
  }

  private send(o: unknown) {
    if (this.sock && this.sock.readyState === 1) this.sock.send(JSON.stringify(o));
  }

  private async pump(): Promise<void> {
    if (this.current) return;
    const j = this.queue.shift();
    if (!j) return;
    this.current = j;
    try { await this.connect(); } catch (e) {
      this.finish({ ok: false, error: e instanceof Error ? e.message : String(e) });
      return;
    }
    if (this.current !== j) return;
    if (j.cancelled) { this.finish({ ok: false, error: 'cancelled' }); return; }
    // Voice and speed are session settings (speed only between responses); update when they change.
    if (this.session.voice !== j.voice || this.session.speed !== j.speed) {
      this.send({ type: 'session.update', session: { type: 'realtime', output_modalities: ['audio'], instructions: VOICE_INSTRUCTIONS,
        audio: { output: { format: { type: 'audio/pcm', rate: 24000 }, voice: j.voice, speed: j.speed } } } });
      this.session = { voice: j.voice, speed: j.speed };
    }
    this.transcript = '';
    this.send({ type: 'response.create', response: {
      conversation: 'none', output_modalities: ['audio'], instructions: VOICE_INSTRUCTIONS, metadata: { job: j.id },
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: j.text }] }],
    } });
    this.arm();
  }

  private arm() {
    if (this.stall) clearTimeout(this.stall);
    this.stall = setTimeout(() => { this.send({ type: 'response.cancel' }); this.finish({ ok: false, error: 'stalled' }); }, STALL_MS);
  }

  private onEvent(e: { type: string; delta?: string; response?: { status?: string; usage?: RealtimeUsage; status_details?: unknown }; error?: { message?: string; code?: string } }) {
    const j = this.current;
    if (e.type === 'error') {
      // A cancel with nothing to cancel is harmless; anything else fails the response in flight.
      if (e.error?.code === 'response_cancel_not_active') return;
      if (j) this.finish({ ok: false, error: e.error?.message ?? 'error' });
      return;
    }
    if (!j) return;
    if (e.type === 'response.output_audio.delta' && e.delta) {
      this.arm();
      if (!j.cancelled) j.onAudio(Buffer.from(e.delta, 'base64'));
      } else if (e.type === 'response.output_audio_transcript.delta' && e.delta) this.transcript += e.delta;
    else if (e.type === 'response.done') {
      const usage = e.response?.usage ?? {};
      if (e.response?.status === 'completed' && !j.cancelled) this.finish({ ok: true, usage, transcript: this.transcript });
      else this.finish({ ok: false, error: j.cancelled ? 'cancelled' : `response ${e.response?.status ?? 'failed'}`, usage });
    }
  }

  private finish(r: SpeakResult) {
    if (this.stall) clearTimeout(this.stall);
    this.stall = null;
    const j = this.current;
    this.current = null;
    if (j) j.done(r);
    void this.pump();
  }

  private fail(error: string) {
    if (this.current) this.finish({ ok: false, error });
  }
}

export type VoiceRequest = { text: string; voice?: string; speed?: number };

export function validateVoice(b: unknown): string | null {
  if (!b || typeof b !== 'object') return 'body must be an object';
  const v = b as Record<string, unknown>;
  if (typeof v.text !== 'string' || !v.text.trim()) return 'text: a non-empty string';
  if (v.text.length > VOICE_MAX_CHARS) return `text: at most ${VOICE_MAX_CHARS} characters`;
  if (v.voice != null && !(VOICES as readonly string[]).includes(String(v.voice))) return `voice: one of ${VOICES.join(', ')}`;
  if (v.speed != null && !(typeof v.speed === 'number' && v.speed >= 0.25 && v.speed <= 1.5)) return 'speed: 0.25–1.5';
  return null;
}

/**
 * POST /api/voice: streams the PCM for one piece of narration. 402 when the ledger refuses, 503
 * without a key. A closed request cancels its response (a skip, a new question).
 */
export async function routeVoice(req: IncomingMessage, res: ServerResponse, body: VoiceRequest, d: {
  line: VoiceLine; ledger: Ledger; phase: Phase; id: () => string; log?: (rec: object) => void;
}): Promise<void> {
  const text = body.text.trim();
  const id = d.id();
  const worst = voiceWorstUsd(text.length);
  const refused = d.ledger.reserve(id, d.phase, worst, { kind: 'voice', model: VOICE_MODEL });
  if (refused) { res.statusCode = 402; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ error: refused.message })); return; }
  res.statusCode = 200;
  res.setHeader('content-type', 'application/octet-stream');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-accel-buffering', 'no');
  res.flushHeaders();
  const t0 = Date.now();
  let first = 0;
  await new Promise<void>((resolve) => {
    const h = d.line.speak({
      id, text, voice: (body.voice as Voice) ?? 'marin', speed: body.speed ?? 1,
      onAudio: (pcm) => { if (!first) first = Date.now(); if (!res.writableEnded && !res.destroyed) res.write(pcm); },
      done: (r) => {
        res.off('close', onClose);
        const usage = r.usage;
        if (usage && (usage.output_tokens ?? 0) > 0) {
          const out = usage.output_tokens ?? 0;
          d.ledger.settle({ id, phase: d.phase, kind: 'voice', model: VOICE_MODEL, usd: voiceUsd(usage),
            tokens: { in: usage.input_tokens ?? 0, cached: usage.input_token_details?.cached_tokens ?? 0, out } });
        } else if (!r.ok && !first) d.ledger.release(id);
        else d.ledger.settle({ id, phase: d.phase, kind: 'voice', model: VOICE_MODEL, usd: worst, estimated: true });
        const said = r.ok ? normWords(r.transcript) : '';
        const verbatim = r.ok ? said === normWords(text) : undefined;
        d.log?.({ at: new Date().toISOString(), kind: 'voice', chars: text.length, firstAudioMs: first ? first - t0 : null, ok: r.ok,
          ...(r.ok ? { verbatim, ...(verbatim ? {} : { text, said: r.transcript }) } : { error: r.error }) });
        if (!r.ok && !first && !res.writableEnded) res.destroy(new Error(r.error)); // the browser falls back to silent timing
        else if (!res.writableEnded) res.end();
        resolve();
      },
    });
    const onClose = () => { if (!res.writableEnded) h.cancel(); };
    res.on('close', onClose);
  });
}
