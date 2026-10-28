// server/ledger.ts
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SpendSummary } from '../src/agent/protocol';

export type Phase = 'dev' | 'bakeoff' | 'iterate' | 'validate' | 'founder';
export type Entry = {
  id: string; at: string; phase: Phase; kind: 'answer' | 'prewarm' | 'judge';
  model: string; usd: number; estimated?: boolean; tokens?: { in: number; cached: number; out: number };
};
type File = { version: 1; priorUsd: number; entries: Entry[] };
export type Caps = { totalUsd: number; dailyUsd?: number; phaseUsd?: Partial<Record<Phase, number>> };
export type Refusal = { code: 'total' | 'daily' | 'phase'; message: string; spentUsd: number; capUsd: number };

/**
 * The spend ledger: one JSON file (gitignored), written atomically after every request. Before a
 * request, `reserve()` books its worst case; `settle()` replaces that with the real cost (or an
 * estimate when the stream was aborted before usage arrived). A request whose worst case would
 * cross a cap is refused before anything is sent. Entries are re-read from disk before every
 * check and write, so several processes on one file (the founder's dev server and the eval runner's
 * dev servers) all count each other's settled spend; reservations stay per process.
 */
export class Ledger {
  private f: File;
  private held = new Map<string, number>();
  constructor(private path: string, private caps: Caps, private now: () => Date = () => new Date(), priorUsd = 0) {
    this.f = this.read() ?? { version: 1, priorUsd, entries: [] };
    this.flush();
  }

  private read(): File | null {
    return existsSync(this.path) ? (JSON.parse(readFileSync(this.path, 'utf8')) as File) : null;
  }
  /** Picks up entries other processes booked since the last read. */
  private sync() { this.f = this.read() ?? this.f; }

  spent(filter: (e: Entry) => boolean = () => true): number {
    return this.f.entries.filter(filter).reduce((s, e) => s + e.usd, filter(PRIOR) ? this.f.priorUsd : 0);
  }
  private heldUsd(): number { let s = 0; for (const v of this.held.values()) s += v; return s; }
  private today = (e: Entry) => e.at.slice(0, 10) === this.now().toISOString().slice(0, 10);

  /** Books `worstUsd` for request `id`, or refuses. */
  reserve(id: string, phase: Phase, worstUsd: number): Refusal | null {
    const r = this.check(phase, worstUsd);
    if (!r) this.held.set(id, worstUsd);
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
    this.held.delete(e.id);
    this.sync();
    this.f.entries.push({ ...e, at: this.now().toISOString() });
    this.flush();
  }
  /** Drops a reservation that sent nothing (refused upstream before any token). */
  release(id: string): void { this.held.delete(id); }

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

/** Stands for the prior (pre-ledger) spend in filters: it counts toward the total only. */
const PRIOR = { id: '_prior' } as Entry;

function refusal(code: Refusal['code'], spentUsd: number, capUsd: number): Refusal {
  const what = code === 'total' ? 'total budget' : code === 'daily' ? "today's cap" : 'this phase’s budget';
  return { code, spentUsd, capUsd, message: `Spending stopped: $${spentUsd.toFixed(2)} of ${what} ($${capUsd.toFixed(2)}) is used.` };
}
