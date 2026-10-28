// src/report/capture.ts — the in-app Report (top bar, Shift+R): what an engineer needs to look at an
// answer without anyone relaying screenshots or descriptions. App keeps one AnswerLog per answer
// (always on, cheap: plain objects, no DOM); Report turns the last one plus the app's state into a
// ReportBody that POST /api/report saves under .petu/reports/ (server/report.ts).
//
// Never in a report: the PDF's content (name, hash and page only), page images, the key or env.
import type { AskEvent } from '../agent/protocol';
import type { ActionTiming } from '../playback/director';

export const REPORT_VERSION = 1;

/** One action as the director reported it, times in ms from Enter (null: not reached). */
export type ReportTiming = {
  action: Record<string, unknown>;
  firedAt: number | null; queuedAt: number | null; startedAt: number | null; endedAt: number | null;
  skipped?: string;
};

export type ReportAnswer = {
  question: string;
  page: number;
  /** Wall-clock start (ISO). */
  startedAt: string;
  /** Canned script (demo / ?script=) or the agent. */
  source: 'agent' | 'script';
  /** idle | playing | done | error | stopped — the session's last state. */
  state: string;
  error?: string;
  /** The scout: opener, pages (teaching order), plan, latency and cost (agent answers). */
  scout?: Extract<AskEvent, { t: 'scout' }>;
  meta?: Extract<AskEvent, { t: 'meta' }>;
  done?: Extract<AskEvent, { t: 'done' }>;
  handoff?: Extract<AskEvent, { t: 'handoff' }>;
  notes: string[];
  /** Every chunk the player received, with its ms from Enter. */
  chunks: { t: number; d: string }[];
  /** The whole script as played (opener + stage 2). */
  script: string;
  /** Stage 2's script alone (the chunks from the handoff on); the whole script when there was no handoff. */
  stage2: string;
  /** The narration as spoken. */
  spoken: string;
  timings: ReportTiming[];
  /** Debug timings, ms from Enter. */
  firstChunkMs: number | null;
  firstWordMs: number | null;
  firstActionMs: number | null;
  lastWordMs: number | null;
};

export type BoardSection = { id: string; page: number | null; size: string | null; elements: { id: string; kind: string; bbox: { x: number; y: number; w: number; h: number } }[] };
export type BoardData = { split: string; stacked: boolean; following: boolean; rect?: { x: number; y: number; w: number; h: number }; sections: BoardSection[] };

export type ReportBody = {
  v: number;
  createdAt: string;
  note: string;
  doc: { name: string; hash: string | null; page: number; numPages: number };
  answer: ReportAnswer | null;
  board: BoardData | null;
  viewport: { w: number; h: number; dpr: number };
  browser: { userAgent: string; platform?: string; language?: string };
  url: { path: string; params: string };
  settings?: Record<string, unknown>;
};

const num = (n: number | undefined | null): number | null => (n == null || !Number.isFinite(n) ? null : Math.round(n));
const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/** Records one answer. All times come from `now` (performance.now in the app) relative to `t0`. */
export class AnswerLog {
  readonly a: ReportAnswer;
  private handoffAt = -1;
  constructor(question: string, page: number, source: 'agent' | 'script', private t0: number, private now: () => number = () => performance.now(), wall = new Date()) {
    this.a = {
      question, page, startedAt: wall.toISOString(), source, state: 'loading', notes: [], chunks: [], script: '', stage2: '', spoken: '',
      timings: [], firstChunkMs: null, firstWordMs: null, firstActionMs: null, lastWordMs: null,
    };
  }
  private rel() { return Math.round(this.now() - this.t0); }

  chunk(d: string): void {
    const t = this.rel();
    if (this.a.firstChunkMs == null) this.a.firstChunkMs = t;
    this.a.chunks.push({ t, d });
  }
  event(e: AskEvent): void {
    if (e.t === 'scout') this.a.scout = plain(e);
    else if (e.t === 'meta') this.a.meta = plain(e);
    else if (e.t === 'done') this.a.done = plain(e);
    else if (e.t === 'handoff') { this.a.handoff = plain(e); this.handoffAt = this.a.chunks.length; }
    else if (e.t === 'note') this.a.notes.push(e.message);
    else if (e.t === 'error') this.a.error = `${e.code}: ${e.message}`;
  }
  note(m: string): void { this.a.notes.push(m); }
  words(ws: string[]): void {
    const t = this.rel();
    if (this.a.firstWordMs == null) this.a.firstWordMs = t;
    this.a.lastWordMs = t;
    this.a.spoken = ws.join(' ');
  }
  state(s: string, err?: string): void {
    // 'stopped' after 'done'/'error' is the session tearing down, not news.
    if (s === 'stopped' && (this.a.state === 'done' || this.a.state === 'error')) return;
    this.a.state = s;
    if (err && !this.a.error) this.a.error = err;
  }
  /** The director reports an action when it starts and again when it ends: one row per action. */
  timing(t: ActionTiming): void {
    const action = plain(t.action) as unknown as Record<string, unknown>;
    const row: ReportTiming = { action, firedAt: num(t.firedAt - this.t0), queuedAt: num(t.queuedAt - this.t0), startedAt: num(t.startedAt - this.t0), endedAt: t.endedAt == null ? null : num(t.endedAt - this.t0) };
    if (t.skipped) row.skipped = t.skipped;
    if (this.a.firstActionMs == null && row.firedAt != null) this.a.firstActionMs = row.firedAt;
    const key = JSON.stringify(action);
    const k = this.a.timings.findIndex((x) => x.endedAt == null && x.firedAt === row.firedAt && JSON.stringify(x.action) === key);
    if (k >= 0) this.a.timings[k] = row; else this.a.timings.push(row);
  }

  /** A JSON-safe copy with the scripts joined. */
  snapshot(): ReportAnswer {
    const a = plain(this.a);
    a.script = a.chunks.map((c) => c.d).join('');
    a.stage2 = this.handoffAt >= 0 ? a.chunks.slice(this.handoffAt).map((c) => c.d).join('') : a.script;
    return a;
  }
}

export type ReportInput = {
  note: string;
  doc: { name: string; hash: string | null; page: number; numPages: number };
  answer: AnswerLog | null;
  board: BoardData | null;
  viewport: { w: number; h: number; dpr: number };
  userAgent: string;
  platform?: string;
  language?: string;
  search: string;
  path: string;
  settings?: Record<string, unknown>;
  now?: Date;
};

/** URL params kept in a report: everything but a `src` that is not a dev-pdf or fixture path (it may name a private location). */
export function safeParams(search: string): string {
  const p = new URLSearchParams(search);
  const src = p.get('src');
  if (!src || /^\/(api\/dev-pdf|fixtures)\//.test(src)) return search.replace(/^\?/, '');
  p.set('src', `…/${src.split(/[?#]/)[0].split('/').pop() ?? ''}`);
  return p.toString();
}

export function buildReport(i: ReportInput): ReportBody {
  return {
    v: REPORT_VERSION,
    createdAt: (i.now ?? new Date()).toISOString(),
    note: i.note.trim().slice(0, 2000),
    doc: { ...i.doc },
    answer: i.answer ? i.answer.snapshot() : null,
    board: i.board ? plain(i.board) : null,
    viewport: { ...i.viewport },
    browser: { userAgent: i.userAgent, ...(i.platform ? { platform: i.platform } : {}), ...(i.language ? { language: i.language } : {}) },
    url: { path: i.path, params: safeParams(i.search) },
    ...(i.settings ? { settings: plain(i.settings) } : {}),
  };
}

/** The board's sections from the registry's region targets and the desk's own region info. */
export function boardOf(
  state: { split: string; stacked: boolean; following: boolean; board?: { x: number; y: number; w: number; h: number } } | null,
  entries: { id: string; kind: string; target: { region?: string }; bbox: { x: number; y: number; w: number; h: number } }[],
  region: (id: string) => { page: number; size: string } | null,
): BoardData | null {
  if (!state) return null;
  const by = new Map<string, BoardSection>();
  for (const e of entries) {
    const r = e.target.region;
    if (r == null) continue;
    let s = by.get(r);
    if (!s) { const info = region(r); s = { id: r, page: info?.page ?? null, size: info?.size ?? null, elements: [] }; by.set(r, s); }
    const b = e.bbox;
    s.elements.push({ id: e.id, kind: e.kind, bbox: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) } });
  }
  return { split: String(state.split), stacked: state.stacked, following: state.following, ...(state.board ? { rect: plain(state.board) } : {}), sections: [...by.values()] };
}
