// scripts/gate-beats/recordings.ts — eval recordings (result.json) as scripts with a generation
// timeline (chunk arrival) and a playback timeline (word start times). Read-only; no API.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';

export type Chunk = { t: number; d: string };
export type RecWord = { text: string; t: number };
export type RecTiming = { action?: Record<string, unknown> & { kind?: string }; firedAt?: number; startedAt?: number; endedAt?: number; skipped?: string };
export type RecEntry = { id: string; kind: string; target: { page?: number; region?: string }; bbox: { x: number; y: number; w: number; h: number }; boxes: { x: number; y: number; w: number; h: number }[]; strokes: { x: number; y: number }[][] };
export type Recording = {
  run: string; q: string; dir: string;
  question: string; src?: string; page?: number; scoutPages?: number[]; scoutPlan?: string;
  script: string;
  /** Offset in `script` where stage 2 starts (0 when there was no opener). */
  stage2At: number;
  chunks: Chunk[];
  /** Chunk index where stage 2 starts. */
  stage2Chunk: number;
  words: RecWord[];
  timings: RecTiming[];
  registry: RecEntry[];
  ttftMs?: number;
  effort?: string;
  judge?: { fatal: string[]; defects: string[]; notes: string; scores: Record<string, number> };
};

const isDir = (p: string) => { try { return statSync(p).isDirectory(); } catch { return false; } };

/** `.petu/eval/runs`: this checkout's, else the main checkout's (worktrees share it), or PETU_RUNS_DIR. */
export function runsDir(cwd = process.cwd()): string {
  if (process.env.PETU_RUNS_DIR) return process.env.PETU_RUNS_DIR;
  const local = join(cwd, '.petu/eval/runs');
  if (isDir(local)) return local;
  try {
    const common = execSync('git rev-parse --git-common-dir', { cwd, encoding: 'utf8' }).trim();
    const main = join(resolve(cwd, common), '..', '.petu/eval/runs');
    if (isDir(main)) return main;
  } catch { /* not a git checkout */ }
  return local;
}

export function loadRecording(dir: string, run = '', q = ''): Recording | null {
  const f = join(dir, 'result.json');
  if (!existsSync(f)) return null;
  let r: { open?: { src: string; page: number }; turns?: Record<string, unknown>[] };
  try { r = JSON.parse(readFileSync(f, 'utf8')); } catch { return null; }
  const t = r.turns?.[0] as { question?: string; chunks?: Chunk[]; events?: Record<string, unknown>[]; words?: RecWord[]; timings?: RecTiming[]; registry?: RecEntry[] } | undefined;
  if (!t?.chunks?.length) return null;
  const events = t.events ?? [];
  const handoff = events.find((e) => e.t === 'handoff') as { ms?: number } | undefined;
  const scout = events.find((e) => e.t === 'scout') as { pages?: number[]; plan?: string; opener?: string } | undefined;
  const done = events.find((e) => e.t === 'done') as { ttftMs?: number } | undefined;
  const meta = events.find((e) => e.t === 'meta') as { effort?: string } | undefined;
  // Stage 2's first chunk: the first one at or after the handoff.
  let s2 = 0;
  if (handoff?.ms != null && scout?.opener) { s2 = t.chunks.findIndex((c) => c.t >= handoff.ms! - 1); if (s2 < 0) s2 = t.chunks.length; }
  const script = t.chunks.map((c) => c.d).join('');
  const stage2At = t.chunks.slice(0, s2).reduce((n, c) => n + c.d.length, 0);
  let judge: Recording['judge'];
  const jf = join(dir, 'judge.json');
  if (existsSync(jf)) { try { judge = JSON.parse(readFileSync(jf, 'utf8')).judge; } catch { /* none */ } }
  return {
    run, q, dir, question: t.question ?? '', src: r.open?.src, page: r.open?.page, scoutPages: scout?.pages, scoutPlan: scout?.plan,
    script, stage2At, chunks: t.chunks, stage2Chunk: s2, words: t.words ?? [], timings: t.timings ?? [], registry: t.registry ?? [],
    ttftMs: done?.ttftMs, effort: meta?.effort, judge,
  };
}

/** Every question of a run, in order (D1, D2, … D10). */
export function loadRun(runId: string, root = runsDir()): Recording[] {
  const rd = join(root, runId);
  if (!isDir(rd)) throw new Error(`no run ${runId} under ${root}`);
  const qs = readdirSync(rd).filter((q) => existsSync(join(rd, q, 'result.json')));
  qs.sort((a, b) => a.replace(/\d+/g, '') .localeCompare(b.replace(/\d+/g, '')) || Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')));
  return qs.map((q) => loadRecording(join(rd, q), runId, q)).filter((x): x is Recording => x != null);
}

export function listRuns(root = runsDir()): string[] {
  return isDir(root) ? readdirSync(root).filter((r) => isDir(join(root, r))).sort() : [];
}
