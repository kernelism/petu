// src/playback/voiceClock.ts — the narration timeline from a real voice (server/voice.ts: OpenAI's
// Realtime model reading each sentence aloud). Same interface as PacedClock, so the scheduler, the
// director and the gate are unchanged: words start when their audio does.
//
// Words are grouped into pieces as the scheduler releases them: a piece ends at a sentence (the first
// at its first clause, so the voice starts sooner; a long sentence at a clause), or when no word has
// come for FLUSH_MS (the stream ended mid-sentence or stalled). Each piece is sent the moment it closes;
// the scheduler releases words well ahead of speech, so pieces are fetched while earlier ones play.
// A piece plays once its whole audio is in and every earlier piece is placed, right after the one
// before. The API gives no word timings: a piece's words are spread over its real duration in
// proportion to PacedClock's length model (syllables, pauses at punctuation), so a sentence's ends are
// exact and the words between are estimates.
//
// A piece whose audio fails (no key, a cap, a network error) keeps the paced timing, silently: the
// lesson never waits on the voice. Pause stops the audio (`halt`); resume, seek and a journey's hold
// re-time from a word (`retime`), which restarts its piece's audio from that word's offset. A speed
// change reaches the pieces requested after it (the voice's pace is set per request); the audio
// already fetched keeps its pace.
import { endsClause, endsSentence, PacedClock, type NarrationClock } from './clock';

/** No new word for this long: the words waiting are sent as a piece. */
export const FLUSH_MS = 220;
/** A sentence this long (words) is cut at its next clause. */
const LONG_PIECE = 24;
/** The first piece of an answer is cut at its first clause once it has this many words. */
const FIRST_PIECE = 5;
/** PCM from the server: 24 kHz, 16-bit signed little-endian, mono. */
export const SAMPLE_RATE = 24000;

/** Plays PCM at a time on the clock's timebase (performance.now() ms), from `offsetMs` into it. */
export type AudioOut = {
  play(pcm: Int16Array, at: number, offsetMs: number): { stop(): void };
};
/** Fetches one piece's audio; null when there is none (the piece keeps paced timing). */
export type Speak = (text: string, speed: number, signal: AbortSignal) => Promise<Int16Array | null>;

type Piece = {
  from: number; to: number;
  state: 'loading' | 'ready' | 'silent';
  pcm?: Int16Array;
  /** Each word's start, ms from the piece's start (audio time at speed 1 of the audio). */
  offsets: number[];
  durMs: number;
  placed: boolean;
  handle?: { stop(): void };
};

export class VoiceClock implements NarrationClock {
  private words: string[] = [];
  private starts: (number | null)[] = [];
  private pieces: Piece[] = [];
  /** First word not yet in a piece. */
  private open = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ctl = new AbortController();
  /** The next piece to place, and when the timeline may resume (a retime's start or the previous piece's end). */
  private nextPiece = 0;
  private resumeAt = -Infinity;
  /** Where the next placed piece starts playing from (a retime into the middle of a piece). */
  private resumeWord: number | null = null;
  private end = -Infinity;
  /** Rate 1: proportions within a piece and silent pieces (the voice's pace is set per request). */
  private paced: PacedClock;
  /** At the playback rate: the scheduler's buffering estimates. */
  private pacedAtRate: PacedClock;
  private halted = false;

  constructor(
    private speak: Speak,
    private out: AudioOut,
    wpm: () => number,
    private rate: () => number = () => 1,
    private clockNow: () => number = () => performance.now(),
  ) {
    this.paced = new PacedClock(wpm, clockNow);
    this.pacedAtRate = new PacedClock(wpm, clockNow, undefined, rate);
  }

  now(): number { return this.clockNow(); }
  durationMs(word: string): number { return this.pacedAtRate.durationMs(word); }
  wordStart(i: number): number | null { return this.starts[i] ?? null; }
  endsAt(): number { return this.end; }

  enqueue(word: string): number {
    const i = this.words.length;
    this.words.push(word);
    this.starts.push(null);
    const n = i + 1 - this.open;
    const first = this.pieces.length === 0;
    if (endsSentence(word) || (endsClause(word) && ((first && n >= FIRST_PIECE) || n >= LONG_PIECE))) this.close();
    else this.arm();
    return i;
  }

  retime(from: number, start: number): void {
    this.halted = false;
    for (const p of this.pieces) {
      if (p.to > from) { p.handle?.stop(); p.handle = undefined; p.placed = false; }
      // A piece wholly before `from` whose words were still to come at `start` (a forward seek skipped
      // it) goes quiet. One already heard by then keeps playing: a hold waits for it, and a respeed's
      // start (a paced estimate) may fall inside its last word.
      else if (p.handle && (this.starts[p.to - 1] ?? -Infinity) >= start) { p.handle.stop(); p.handle = undefined; }
    }
    for (let i = Math.max(0, from); i < this.starts.length; i++) this.starts[i] = null;
    let k = this.pieces.findIndex((p) => p.to > from);
    if (k < 0) k = this.pieces.length;
    this.nextPiece = k;
    this.resumeWord = k < this.pieces.length && from > this.pieces[k].from ? from : null;
    this.resumeAt = start;
    this.end = Math.min(this.end, start);
    this.place();
  }

  /** Silence now (a pause). The scheduler's resume re-times from the next word. */
  halt(): void {
    this.halted = true;
    for (const p of this.pieces) { p.handle?.stop(); p.handle = undefined; }
  }

  /** The answer is over (a stop, a skip, a new question): no more audio, no more requests. */
  dispose(): void {
    this.halt();
    this.ctl.abort();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  // -----------------------------------------------------------------------------------------------

  private arm() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; this.close(); }, FLUSH_MS);
  }

  private close() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.open >= this.words.length || this.ctl.signal.aborted) return;
    const p: Piece = { from: this.open, to: this.words.length, state: 'loading', offsets: [], durMs: 0, placed: false };
    this.open = p.to;
    this.pieces.push(p);
    const text = this.words.slice(p.from, p.to).join(' ');
    const speed = this.rate();
    this.speak(text, speed, this.ctl.signal).then(
      (pcm) => this.loaded(p, pcm && pcm.length ? pcm : null, speed),
      () => this.loaded(p, null, speed),
    );
  }

  private loaded(p: Piece, pcm: Int16Array | null, speed: number) {
    if (this.ctl.signal.aborted) return;
    const ws = this.words.slice(p.from, p.to);
    const est = ws.map((w) => this.paced.durationMs(w));
    const total = est.reduce((a, b) => a + b, 0) || 1;
    if (pcm) {
      p.pcm = pcm;
      p.durMs = (pcm.length / SAMPLE_RATE) * 1000;
      p.state = 'ready';
    } else {
      p.durMs = total / (speed > 0 ? speed : 1);
      p.state = 'silent';
    }
    let t = 0;
    p.offsets = est.map((d) => { const o = t; t += (d / total) * p.durMs; return o; });
    this.place();
  }

  /** Places every piece that can play now: loaded, and all before it placed. */
  private place() {
    if (this.halted) return;
    while (this.nextPiece < this.pieces.length) {
      const p = this.pieces[this.nextPiece];
      if (p.state === 'loading') return;
      const startWord = this.resumeWord ?? p.from;
      const skip = p.offsets[startWord - p.from];
      const at = Math.max(this.clockNow(), this.resumeAt, this.end);
      if (p.pcm) p.handle = this.out.play(p.pcm, at, skip);
      for (let i = startWord; i < p.to; i++) this.starts[i] = at + p.offsets[i - p.from] - skip;
      p.placed = true;
      this.end = at + p.durMs - skip;
      this.resumeWord = null;
      this.resumeAt = -Infinity;
      this.nextPiece++;
    }
  }
}

/** Web Audio output: one context per page, PCM scheduled on its timeline. */
export function webAudioOut(ctx: AudioContext): AudioOut {
  return {
    play(pcm, at, offsetMs) {
      const buf = ctx.createBuffer(1, pcm.length, SAMPLE_RATE);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      const when = ctx.currentTime + Math.max(0, (at - performance.now()) / 1000);
      src.start(when, Math.max(0, offsetMs / 1000));
      return { stop: () => { try { src.stop(); } catch { /* not started */ } src.disconnect(); } };
    },
  };
}

/** POST /api/voice → the piece's PCM, or null (no key, a cap, an error: the piece stays silent). */
export function fetchVoice(voice: string): Speak {
  return async (text, speed, signal) => {
    const res = await fetch('/api/voice', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, voice, speed }), signal });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return new Int16Array(buf, 0, Math.floor(buf.byteLength / 2));
  };
}

/** Opens the server's voice session ahead of the first sentence (fire and forget). */
export function warmVoice(): void {
  void fetch('/api/voice', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ warm: true }) }).catch(() => {});
}
