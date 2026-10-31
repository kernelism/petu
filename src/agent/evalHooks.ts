// src/agent/evalHooks.ts — dev-only. App installs it under `?eval`; the eval runner drives it over CDP.
// It records one answer (chunks, events, words, sentences, action timings) and reads the engine's
// own state for geometry, so metrics never look at pixels. The recording is replayable.
import type { AskEvent } from './protocol';
import type { ActionTiming } from '../playback/director';
import type { Target } from '../script/types';
import type { GateLogEvent } from '../gate/events';

type Pt = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };

export type RegistryRow = { id: string; kind: string; target: Target; bbox: Rect; boxes: Rect[]; strokes: Pt[][] };
/** An ActionTiming with times in ms since Enter (t0); NaN/unset become null. The action is plain JSON. */
export type SerialTiming = { action: Record<string, unknown>; firedAt: number | null; queuedAt: number | null; startedAt: number | null; endedAt: number | null; skipped?: string };
export type EvalResult = {
  question: string;
  chunks: { t: number; d: string }[];
  events: AskEvent[];
  words: { text: string; t: number }[];
  sentences: { text: string; endMs: number }[];
  timings: SerialTiming[];
  registry: RegistryRow[];
  /** Points that landed outside a fitted region's frame (summed over regions). */
  outOfFrame: number;
  /** Points defined by meet/along/foot that sit off their defining lines after resolve (a resolver guard; expected 0). */
  onLineErrors?: number;
  /** performance.now() at Enter, for the runner's cross-checks. */
  t0: number;
};

/** What the recorder offers the app while an answer plays. All times come from the hooks' clock. */
export type Recorder = {
  chunk(d: string): void;
  event(ev: AskEvent): void;
  word(text: string): void;
  /** A sentence finished being spoken. Triggers `window.petuShot(i)`. */
  sentenceEnd(text: string): void;
  timing(t: ActionTiming): void;
};

/** Implemented by App (Lane C wiring): the real agent path and the engine's state. */
export type EvalBackend = {
  /** Doc loaded, `?page=` shown, context warm. */
  ready(): Promise<void>;
  /** Runs the real agent path. Resolves when the session is done, stopped or errored. */
  ask(q: string, rec: Recorder): Promise<void>;
  /** Plays recorded chunks through the same session (no generation); `gapMs` is the recorded offset before each. */
  replay(chunks: { t: number; d: string }[], rec: Recorder, events?: AskEvent[]): Promise<void>;
  addInk(page: number, pts: Pt[]): void;
  /** Scrolls the PDF to `page` as the student would (the next question is asked from there). */
  goto?(page: number): Promise<void>;
  /** The largest labelled figure mark on `page`, in page coords (0-1000), or null (App reads its PageGround). */
  largestMark?(page: number): Rect | null;
  registry(): RegistryRow[];
  outOfFrame(): number;
  /** Optional resolver guard (Lane R's Figure): defined points that are > 1 unit from their lines. */
  onLineErrors?(): number;
};

const num = (n: number | undefined): number | null => (n == null || !Number.isFinite(n) ? null : n);
const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export class EvalHooks {
  private r: EvalResult = emptyResult('', 0);
  constructor(private be: EvalBackend, private now: () => number = () => performance.now(),
    // A CDP binding takes one string argument.
    private shot: (i: number) => void = (i) => { (globalThis as { petuShot?: (s: string) => void }).petuShot?.(String(i)); }) {}

  ready(): Promise<void> { return this.be.ready(); }
  goto(page: number): Promise<void> { return this.be.goto ? this.be.goto(page) : Promise.resolve(); }
  addInk(page: number, pts: Pt[]): void { this.be.addInk(page, pts); }

  /** Draws a student loop around the page's largest labelled mark. Returns false when the page has none. */
  inkAroundLargestMark(page: number): boolean {
    const r = this.be.largestMark?.(page);
    if (!r) return false;
    this.be.addInk(page, loopAround(r));
    return true;
  }

  private begin(question: string): Recorder {
    const t0 = this.now();
    this.r = emptyResult(question, t0);
    const rel = (x: number) => x - t0;
    return {
      chunk: (d) => { this.r.chunks.push({ t: rel(this.now()), d }); },
      event: (ev) => { this.r.events.push(ev); },
      word: (text) => { this.r.words.push({ text, t: rel(this.now()) }); },
      sentenceEnd: (text) => {
        const i = this.r.sentences.length;
        this.r.sentences.push({ text, endMs: rel(this.now()) });
        try { this.shot(i); } catch { /* the runner's binding is optional */ }
      },
      timing: (t) => {
        const a = plain(t.action) as unknown as Record<string, unknown>;
        const row: SerialTiming = { action: a, firedAt: num(t.firedAt - t0), queuedAt: num(t.queuedAt - t0), startedAt: num(t.startedAt - t0), endedAt: t.endedAt == null ? null : num(t.endedAt - t0) };
        if (t.skipped) row.skipped = t.skipped;
        // The director reports a timing when it starts and again when it ends: keep one row per action.
        const k = this.r.timings.findIndex((x) => sameAction(x.action, a) && x.endedAt == null && x.firedAt === row.firedAt);
        if (k >= 0) this.r.timings[k] = row; else this.r.timings.push(row);
      },
    };
  }

  async ask(q: string): Promise<void> {
    const rec = this.begin(q);
    try { await this.be.ask(q, rec); } finally { this.snapshot(); }
  }

  async replay(log: Pick<EvalResult, 'chunks' | 'events' | 'question'>): Promise<void> {
    const rec = this.begin(log.question);
    try { await this.be.replay(log.chunks, rec, log.events); } finally { this.snapshot(); }
  }

  private snapshot(): void {
    this.r.registry = plain(this.be.registry());
    this.r.outOfFrame = this.be.outOfFrame();
    if (this.be.onLineErrors) this.r.onLineErrors = this.be.onLineErrors();
  }

  result(): EvalResult { return plain(this.r); }
}

/** A closed, slightly wobbly ellipse around `r` (page coords), padded by `pad` units, clamped to 0-1000. */
export function loopAround(r: Rect, pad = 14, n = 40): Pt[] {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const rx = r.w / 2 + pad, ry = r.h / 2 + pad;
  const c = (v: number) => Math.max(0, Math.min(1000, v));
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const k = 1 + 0.03 * Math.sin(a * 3); // a hand-drawn wobble, deterministic
    pts.push({ x: c(cx + rx * k * Math.cos(a)), y: c(cy + ry * k * Math.sin(a)) });
  }
  return pts;
}

/**
 * The live gate's events outside an eval answer (dev scripts under `&gate=audit`, the gallery's audit):
 * the app publishes each GateEvent / RepairEvent here (dev builds only), the gallery reads the list.
 */
export const GATE_LOG_KEY = '__petuGateLog';
type GateHost = { [GATE_LOG_KEY]?: GateLogEvent[] };
export function publishGate(ev: GateLogEvent, w: object = globalThis): void {
  const h = w as GateHost;
  (h[GATE_LOG_KEY] ??= []).push(JSON.parse(JSON.stringify(ev)) as GateLogEvent);
}
export const isGateEvent = (e: { t: string }): e is GateLogEvent => e.t === 'gate' || e.t === 'repair';
/** The gate's events of the answer being recorded, else what the app published (dev scripts). */
export function gateEvents(r: Pick<EvalResult, 'events'>, w: object = globalThis): GateLogEvent[] {
  const own = r.events.filter(isGateEvent);
  return own.length ? own : [...((w as GateHost)[GATE_LOG_KEY] ?? [])];
}

const sameAction = (a: Record<string, unknown>, b: Record<string, unknown>) => JSON.stringify(a) === JSON.stringify(b);

export function emptyResult(question: string, t0: number): EvalResult {
  return { question, chunks: [], events: [], words: [], sentences: [], timings: [], registry: [], outOfFrame: 0, t0 };
}

/** Sum of `outOfFrame` over the fitted regions (Lane R: `director.figures.figure({region}).outOfFrame`). */
export function outOfFrameOf(figures: { figure(t: { region: string }): { outOfFrame: number } }, regionIds: Iterable<string>): number {
  let n = 0;
  for (const id of regionIds) n += figures.figure({ region: id }).outOfFrame;
  return n;
}

/** Installs `window.__petu`. Call once from App under `?eval`. */
export function installEvalHooks(be: EvalBackend, w: Window & { __petu?: unknown } = window): EvalHooks {
  const h = new EvalHooks(be);
  w.__petu = {
    ready: () => h.ready(),
    ask: (q: string) => h.ask(q),
    goto: (page: number) => h.goto(page),
    addInk: (page: number, pts: Pt[]) => h.addInk(page, pts),
    inkAroundLargestMark: (page: number) => h.inkAroundLargestMark(page),
    replay: (log: EvalResult) => h.replay(log),
    result: () => h.result(),
    /** The live gate's verdicts and repairs (design §8): this answer's, else the dev script's. */
    gate: () => gateEvents(h.result(), w),
  };
  return h;
}
