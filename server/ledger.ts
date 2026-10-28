// server/ledger.ts
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { formatUsd, type SpendSummary } from '../src/agent/protocol';

export type Phase = 'dev' | 'bakeoff' | 'iterate' | 'validate' | 'founder';
export type Entry = {
  id: string; at: string; phase: Phase; kind: 'answer' | 'prewarm' | 'judge';
  model: string; usd: number; estimated?: boolean; tokens?: { in: number; cached: number; out: number };
  /** Booked at start-up from a reservation whose process died mid-request. */
  recovered?: boolean;
};
/** A request in flight: persisted so a crash books it as an estimate instead of losing it. */
export type Open = { at: string; pid: number; phase: Phase; kind: Entry['kind']; model: string; worstUsd: number; estUsd?: number };
type File = { version: 1; priorUsd: number; entries: Entry[]; open?: Record<string, Open> };
export type Caps = { totalUsd: number; dailyUsd?: number; phaseUsd?: Partial<Record<Phase, number>> };
export type Refusal = { code: 'total' | 'daily' | 'phase'; message: string; spentUsd: number; capUsd: number };

/**
 * The spend ledger: one JSON file (gitignored), written atomically after every request. Before a
 * request, `reserve()` books its worst case; `settle()` replaces that with the real cost (or an
 * estimate when the stream was aborted before usage arrived). A request whose worst case would
 * cross a cap is refused before anything is sent. Entries are re-read from disk before every
 * check and write, so several processes on one file (the founder's dev server and the eval runner's
 * dev servers) all count each other's settled spend and open reservations.
 *
 * Open reservations are persisted with their process id. One whose process is gone (the dev server
 * crashed or was killed mid-request) is booked as an estimate (`recovered`) at the next read: it may
 * have been billed, so it is never silently dropped.
 */
export class Ledger {
  private f: File;
  private alive: (pid: number) => boolean;
  constructor(private path: string, private caps: Caps, private now: () => Date = () => new Date(), priorUsd = 0, opts: { alive?: (pid: number) => boolean } = {}) {
    this.alive = opts.alive ?? pidAlive;
    this.f = this.read() ?? { version: 1, priorUsd, entries: [] };
    this.recover();
    this.flush();
  }

  private read(): File | null {
    return existsSync(this.path) ? (JSON.parse(readFileSync(this.path, 'utf8')) as File) : null;
  }
  /** Picks up entries other processes booked since the last read, and books dead processes' reservations. */
  private sync() {
    this.f = this.read() ?? this.f;
    if (this.recover()) this.flush();
  }
  /** Books every open reservation whose process is gone, as an estimate. True if any was booked. */
  private recover(): boolean {
    let any = false;
    for (const [id, o] of Object.entries(this.f.open ?? {})) {
      if (o.pid === process.pid || this.alive(o.pid)) continue;
      delete this.f.open![id];
      this.f.entries.push({ id, at: this.now().toISOString(), phase: o.phase, kind: o.kind, model: o.model, usd: o.estUsd ?? o.worstUsd, estimated: true, recovered: true });
      any = true;
    }
    return any;
  }

  spent(filter: (e: Entry) => boolean = () => true): number {
    return this.f.entries.filter(filter).reduce((s, e) => s + e.usd, filter(PRIOR) ? this.f.priorUsd : 0);
  }
  private heldUsd(): number { let s = 0; for (const o of Object.values(this.f.open ?? {})) s += o.worstUsd; return s; }
  private today = (e: Entry) => e.at.slice(0, 10) === this.now().toISOString().slice(0, 10);

  /**
   * Books `worstUsd` for request `id`, or refuses. `meta.estUsd` is what a crash mid-request books
   * (a cache-aware estimate with the full output budget); without it the worst case is booked.
   */
  reserve(id: string, phase: Phase, worstUsd: number, meta: { kind?: Entry['kind']; model?: string; estUsd?: number } = {}): Refusal | null {
    const r = this.check(phase, worstUsd);
    if (!r) {
      (this.f.open ??= {})[id] = { at: this.now().toISOString(), pid: process.pid, phase, kind: meta.kind ?? 'answer', model: meta.model ?? 'unknown', worstUsd, ...(meta.estUsd != null ? { estUsd: meta.estUsd } : {}) };
      this.flush();
    }
    return r;
  }

  /** Would a request of `worstUsd` be refused right now? (Reserves nothing.) */
  check(phase: Phase, worstUsd: number): Refusal | null {
    this.sync();
    const held = this.heldUsd();
    const total = this.spent() + held;
    if (total + worstUsd > this.caps.totalUsd) return refusal('total', total, this.caps.totalUsd);
    if (this.caps.dailyUsd != null) {
      const day = this.spent((e) => e !== PRIOR && this.today(e)) + held;
      if (day + worstUsd > this.caps.dailyUsd) return refusal('daily', day, this.caps.dailyUsd);
    }
    const pc = this.caps.phaseUsd?.[phase];
    if (pc != null) {
      const ph = this.spent((e) => e !== PRIOR && e.phase === phase) + held;
      if (ph + worstUsd > pc) return refusal('phase', ph, pc);
    }
    return null;
  }

  /** Replaces the reservation with the real (or estimated) cost and persists it. */
  settle(e: Omit<Entry, 'at'>): void {
    this.sync();
    if (this.f.open) delete this.f.open[e.id];
    this.f.entries.push({ ...e, at: this.now().toISOString() });
    this.flush();
  }
  /** Drops a reservation that sent nothing (refused upstream before any token). */
  release(id: string): void {
    this.sync();
    if (this.f.open?.[id]) { delete this.f.open[id]; this.flush(); }
  }

  summary(): SpendSummary & Required<Pick<SpendSummary, 'byPhase' | 'byModel' | 'n'>> {
    this.sync();
    const by = (k: keyof Entry) => this.f.entries.reduce<Record<string, number>>((m, e) => ({ ...m, [String(e[k])]: (m[String(e[k])] ?? 0) + e.usd }), {});
    return { totalUsd: this.spent(), capUsd: this.caps.totalUsd, ...(this.caps.dailyUsd != null ? { dailyCapUsd: this.caps.dailyUsd } : {}), todayUsd: this.spent((e) => e !== PRIOR && this.today(e)), byPhase: by('phase'), byModel: by('model'), n: this.f.entries.length };
  }

  private flush() {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.f, null, 1));
    renameSync(tmp, this.path);
  }
}

/** Is process `pid` still running? (Signal 0 probes without signalling; EPERM means it exists.) */
function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}

/** Stands for the prior (pre-ledger) spend in filters: it counts toward the total only. */
const PRIOR = { id: '_prior' } as Entry;

function refusal(code: Refusal['code'], spentUsd: number, capUsd: number): Refusal {
  const what = code === 'total' ? 'total budget' : code === 'daily' ? "today's cap" : 'this phase’s budget';
  return { code, spentUsd, capUsd, message: `Spending stopped: ${formatUsd(spentUsd)} of ${what} (${formatUsd(capUsd)}) is used.` };
}
