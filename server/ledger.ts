// server/ledger.ts
import { closeSync, existsSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { formatUsd, type SpendSummary } from '../src/agent/protocol';

export type Phase = 'dev' | 'bakeoff' | 'iterate' | 'validate' | 'founder' | 'lessondev' | 'lessonbake' | 'lessoniter' | 'lessonval' | 'bench';
export type Entry = {
  id: string; at: string; phase: Phase; kind: 'answer' | 'scout' | 'storyboard' | 'prewarm' | 'judge' | 'repair' | 'voice';
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
 * Every read-modify-write runs under an exclusive lockfile (`<path>.lock`, created with O_EXCL),
 * so two processes never overwrite each other's entries, and a check and its reservation are one
 * step (two processes cannot both pass a cap that only one fits under). The file format is unchanged.
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
    this.f = { version: 1, priorUsd, entries: [] };
    this.mutate(() => undefined, true);
  }

  private read(): File | null {
    return existsSync(this.path) ? (JSON.parse(readFileSync(this.path, 'utf8')) as File) : null;
  }
  /** Picks up entries other processes booked since the last read, and books dead processes' reservations. */
  private sync() {
    this.f = this.read() ?? this.f;
    if (this.deadOpen()) this.mutate(() => undefined);
  }
  /**
   * Under the lock: re-reads the file, books dead reservations, applies `fn`, writes the file if
   * anything changed (or `always`). The only way the file is written.
   */
  private mutate<T>(fn: () => T, always = false): T {
    mkdirSync(dirname(this.path), { recursive: true });
    const release = acquireLock(`${this.path}.lock`, this.alive);
    try {
      const disk = this.read();
      this.f = disk ?? this.f;
      const before = JSON.stringify(this.f);
      this.recover();
      const r = fn();
      if (always && !disk || JSON.stringify(this.f) !== before) this.flush();
      return r;
    } finally {
      release();
    }
  }
  private deadOpen(): boolean {
    return Object.values(this.f.open ?? {}).some((o) => o.pid !== process.pid && !this.alive(o.pid));
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
  private heldUsd(phase?: Phase): number { let s = 0; for (const o of Object.values(this.f.open ?? {})) if (phase == null || o.phase === phase) s += o.worstUsd; return s; }
  /** The local calendar day (the founder's day), not UTC. */
  private today = (e: Entry) => localDay(new Date(e.at)) === localDay(this.now());
  /** The daily cap limits the founder's own testing: only founder-phase entries of the local day count. */
  private todayFounder = (e: Entry) => e !== PRIOR && e.phase === 'founder' && this.today(e);

  /**
   * Books `worstUsd` for request `id`, or refuses. `meta.estUsd` is what a crash mid-request books
   * (a cache-aware estimate with the full output budget); without it the worst case is booked.
   */
  reserve(id: string, phase: Phase, worstUsd: number, meta: { kind?: Entry['kind']; model?: string; estUsd?: number } = {}): Refusal | null {
    return this.mutate(() => {
      const r = this.refusal(phase, worstUsd);
      if (!r) (this.f.open ??= {})[id] = { at: this.now().toISOString(), pid: process.pid, phase, kind: meta.kind ?? 'answer', model: meta.model ?? 'unknown', worstUsd, ...(meta.estUsd != null ? { estUsd: meta.estUsd } : {}) };
      return r;
    });
  }

  /** Would a request of `worstUsd` be refused right now? (Reserves nothing.) */
  check(phase: Phase, worstUsd: number): Refusal | null {
    this.sync();
    return this.refusal(phase, worstUsd);
  }
  private refusal(phase: Phase, worstUsd: number): Refusal | null {
    const held = this.heldUsd();
    const total = this.spent() + held;
    if (total + worstUsd > this.caps.totalUsd) return refusal('total', total, this.caps.totalUsd);
    if (this.caps.dailyUsd != null && phase === 'founder') {
      const day = this.spent(this.todayFounder) + this.heldUsd('founder');
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
    this.mutate(() => {
      if (this.f.open) delete this.f.open[e.id];
      this.f.entries.push({ ...e, at: this.now().toISOString() });
    });
  }
  /** Drops a reservation that sent nothing (refused upstream before any token). */
  release(id: string): void {
    this.mutate(() => { if (this.f.open?.[id]) delete this.f.open[id]; });
  }

  summary(): SpendSummary & Required<Pick<SpendSummary, 'byPhase' | 'byModel' | 'n'>> {
    this.sync();
    const by = (k: keyof Entry) => this.f.entries.reduce<Record<string, number>>((m, e) => ({ ...m, [String(e[k])]: (m[String(e[k])] ?? 0) + e.usd }), {});
    return { totalUsd: this.spent(), capUsd: this.caps.totalUsd, ...(this.caps.dailyUsd != null ? { dailyCapUsd: this.caps.dailyUsd } : {}), todayUsd: this.spent(this.todayFounder), todayAllUsd: this.spent((e) => e !== PRIOR && this.today(e)), byPhase: by('phase'), byModel: by('model'), n: this.f.entries.length };
  }

  /** Atomic replace (temp file + rename). Called only under the lock. */
  private flush() {
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.f, null, 1));
    renameSync(tmp, this.path);
  }
}

const localDay = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

/** A lock older than this is stale (a read-modify-write takes milliseconds). */
export const LOCK_STALE_MS = 5000;
const LOCK_WAIT_MS = 15000;
const nap = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Takes the exclusive lock at `lock` (O_EXCL create holding "<pid> <ms> <nonce>"), waiting with
 * back-off. A lock whose holder is dead, or older than LOCK_STALE_MS, is taken over: renamed aside,
 * checked to be the one judged stale (else put back), removed. Returns the release function, which
 * removes the lock only while it is still ours.
 */
export function acquireLock(lock: string, alive: (pid: number) => boolean = pidAlive): () => void {
  const mine = `${process.pid} ${Date.now()} ${Math.random().toString(36).slice(2)}`;
  const t0 = Date.now();
  for (let i = 0; ; i++) {
    try {
      const fd = openSync(lock, 'wx');
      try { writeSync(fd, mine); } finally { closeSync(fd); }
      return () => { try { if (readFileSync(lock, 'utf8') === mine) unlinkSync(lock); } catch { /* already gone */ } };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    let held = '';
    let age = 0;
    try { held = readFileSync(lock, 'utf8'); age = Date.now() - statSync(lock).mtimeMs; } catch { continue; } // released meanwhile
    const [pid, at] = held.split(' ').map(Number);
    const written = Number.isFinite(at) ? Date.now() - at : age;
    const stale = held !== '' && ((Number.isInteger(pid) && pid > 0 && pid !== process.pid && !alive(pid)) || Math.max(written, age) > LOCK_STALE_MS);
    if (stale || (held === '' && age > LOCK_STALE_MS)) {
      const aside = `${lock}.${process.pid}.${i}.stale`;
      try {
        renameSync(lock, aside);
        if (readFileSync(aside, 'utf8') !== held) { try { linkSync(aside, lock); } catch { /* someone else holds it now */ } }
        unlinkSync(aside);
      } catch { /* another process took it over first */ }
      continue;
    }
    if (Date.now() - t0 > LOCK_WAIT_MS) throw new Error(`ledger: lock ${lock} held too long`);
    nap(Math.min(50, 1 + i) + Math.random() * 3);
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
