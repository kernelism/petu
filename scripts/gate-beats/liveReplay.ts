// scripts/gate-beats/liveReplay.ts — the live gate over recorded answers, offline ($0): recorded
// chunks at their recorded times (a fake clock), handoff at the recorded stage-2 chunk, narration
// paced by the app's PacedClock, the preflight with the recorded board's skips standing in for the
// shadow board. Reports what the gate would have done (units, fails, strips, drops) and what it costs
// in latency (first word, opener→stage-2 seam), modelled the same way with and without the gate.
//   node --import ./scripts/lib/tsResolve.mjs --experimental-transform-types --no-warnings scripts/gate-beats/liveReplay.ts <runId…> [--gatefail 2,o1] [--json out]
import { readFileSync } from 'node:fs';
import { withCalcs } from '../../src/calc/stream.ts';
import { runCalcNode } from '../../src/calc/node.ts';
import { join } from 'node:path';
import { LiveGate, GatePreflight, type Preflight } from '../../src/gate/live.ts';
import { parseFaults } from '../../src/gate/faults.ts';
import { PacedClock } from '../../src/playback/clock.ts';
import { tokenize, type Tag } from '../../src/gate/segment.ts';
import type { GateEvent, GateLogEvent } from '../../src/gate/events.ts';
import { liveSkips } from './gateRun.ts';
import type { Recording } from './recordings.ts';

/** A fake timeline: `now` moves only when advanced; sleeps resolve in time order. */
export class FakeTime {
  t = 0;
  private timers: { at: number; r: () => void }[] = [];
  now = () => this.t;
  sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((r) => {
    const e = { at: this.t + Math.max(0, ms), r };
    this.timers.push(e);
    signal?.addEventListener('abort', () => { this.timers = this.timers.filter((x) => x !== e); r(); }, { once: true });
  });
  next(): number | null { return this.timers.length ? Math.min(...this.timers.map((x) => x.at)) : null; }
  advanceTo(end: number) {
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at);
      const n = this.timers[0];
      if (!n || n.at > end) break;
      this.timers.shift();
      this.t = Math.max(this.t, n.at);
      n.r();
    }
    this.t = Math.max(this.t, end);
  }
}
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

export type Released = { text: string; at: number };
export type ReplayResult = {
  label: string;
  events: GateLogEvent[];
  released: Released[];
  /** Tag bodies the recorded board skipped (the stand-in shadow's skips). */
  skippedBodies: Set<string>;
  firstWord: { before: number | null; after: number | null };
  seam: { before: number | null; after: number | null };
  /** Real ms of preflight checks. */
  checkMs: number[];
  stats: LiveGate['stats'];
  /** Released tags that the recorded live board skipped: 0 by construction offline (the recorded skips are the shadow's). */
  liveSkipAfterPass: number;
};

const hasWord = (s: string) => tokenize(s).some((t) => t.kind === 'word');

/** Replays one recorded answer through the gate. */
export async function replayGate(rec: Recording, o: { gatefail?: string; seed?: number; pages?: Map<number, string>; severity?: 'default' | 'design' } = {}): Promise<ReplayResult> {
  const time = new FakeTime();
  const clock = new PacedClock(() => 170, time.now);
  // The recorded board's skips, by tag body (the director's timings, matched to tags in order).
  const skips = liveSkips(rec.script, rec.timings);
  const skippedBodies = new Set<string>();
  for (const t of tokenize(rec.script)) if (t.kind === 'tag' && skips.has(t.start)) skippedBodies.add((t as Tag).body);
  const pre = new GatePreflight({ recorded: (b) => (skippedBodies.has(b) ? 'recorded skip' : undefined), pages: o.pages ? () => o.pages! : undefined, question: rec.question, severity: o.severity ?? 'default' });
  const checkMs: number[] = [];
  const timed: Preflight = {
    async check(u) { const t0 = performance.now(); const r = await pre.check(u); checkMs.push(performance.now() - t0); return r; },
    accept: (u) => pre.accept(u), reject: (u) => pre.reject(u),
  };
  const events: GateLogEvent[] = [];
  const gate = new LiveGate({ clock, preflight: timed, faults: parseFaults(o.gatefail), onEvent: (e) => events.push(e), sleep: time.sleep });
  const released: Released[] = [];
  const s2 = rec.stage2At > 0 ? rec.stage2Chunk : 0;
  const src = async function* () {
    if (s2 === 0) gate.handoff();
    for (const [i, c] of rec.chunks.entries()) {
      if (c.t > time.t) await time.sleep(c.t - time.t);
      if (i === s2 && s2 > 0) gate.handoff();
      yield c.d;
    }
  };
  let done = false;
  // Calcs run before the gate reads the stream, as in the app (App.tsx: withCalcs before gate.wrap).
  const it = gate.wrap(() => withCalcs(src(), runCalcNode))(new AbortController().signal)[Symbol.asyncIterator]();
  const consume = (async () => {
    for (;;) {
      const r = await it.next();
      if (r.done) break;
      // The check's own cost delays the release by that much (real ms, not the fake clock's).
      const at = time.t + (checkMs[checkMs.length - 1] ?? 0);
      released.push({ text: r.value, at });
      for (const t of tokenize(r.value)) if (t.kind === 'word') clock.enqueue(t.text);
    }
    done = true;
  })();
  for (let i = 0; i < 100000 && !done; i++) {
    await flush();
    if (done) break;
    const n = time.next();
    if (n == null) { await flush(); if (!done) await new Promise((r) => setTimeout(r, 0)); continue; }
    time.advanceTo(n);
  }
  await consume;

  // Latency, modelled the same way with and without the gate: a word plays when its text has arrived
  // (or been released) and the narration before it has ended.
  let acc = 0;
  let firstArrival: number | null = null, s2Arrival: number | null = null;
  for (const [i, c] of rec.chunks.entries()) {
    const before = rec.script.slice(0, acc);
    acc += c.d.length;
    if (firstArrival == null && hasWord(rec.script.slice(0, acc))) firstArrival = c.t;
    if (i >= s2 && s2Arrival == null && hasWord(rec.script.slice(rec.stage2At, acc))) s2Arrival = c.t;
    void before;
  }
  const firstAfter = released.find((r) => hasWord(r.text))?.at ?? null;
  const unitEvents = events.filter((e): e is GateEvent => e.t === 'gate');
  // Stage 2's first released words: the first released piece after the opener's.
  const openerPieces = unitEvents.filter((e) => e.unit === 'opener' && e.action === 'release').length;
  const s2After = released.slice(openerPieces).find((r) => hasWord(r.text))?.at ?? null;
  const openerEnd = openerEndOf(rec);
  const seamOf = (arr: number | null) => (arr == null || openerEnd == null ? null : Math.max(0, arr - openerEnd));
  return {
    label: `${rec.run}/${rec.q}`, events, released, skippedBodies, checkMs, stats: gate.stats, liveSkipAfterPass: 0,
    firstWord: { before: firstArrival, after: firstAfter },
    seam: rec.stage2At > 0 ? { before: seamOf(s2Arrival), after: seamOf(s2After) } : { before: null, after: null },
  };
}

/** When the opener's words were due to end (the recorded handoff event), ms from Enter. */
function openerEndOf(rec: Recording): number | null {
  try {
    const r = JSON.parse(readFileSync(join(rec.dir, 'result.json'), 'utf8'));
    const h = (r.turns?.[0]?.events ?? []).find((e: { t: string }) => e.t === 'handoff');
    return typeof h?.openerEndMs === 'number' ? h.openerEndMs : null;
  } catch { return null; }
}

export const p50 = (xs: number[]) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN; };
export const p95 = (xs: number[]) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.floor(0.95 * (s.length - 1))] : NaN; };

if (import.meta.url === `file://${process.argv[1]}`) {
  const { loadRun, runsDir } = await import('./recordings.ts');
  const { grounder } = await import('./run.ts');
  const argv = process.argv.slice(2);
  const opt = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const runs = argv.filter((a, i) => !a.startsWith('--') && !['--gatefail', '--json', '--note'].includes(argv[i - 1]));
  const g = await grounder();
  const rows: ReplayResult[] = [];
  for (const run of runs) for (const rec of loadRun(run, runsDir())) {
    const { text } = await g.pages(rec);
    rows.push(await replayGate(rec, { gatefail: opt('--gatefail'), pages: text, severity: argv.includes('--design') ? 'design' : 'default' }));
  }
  await g.close();
  const sum = (f: (r: ReplayResult) => number) => rows.reduce((n, r) => n + f(r), 0);
  const gates = rows.flatMap((r) => r.events.filter((e): e is GateEvent => e.t === 'gate'));
  const byCheck = new Map<string, number>();
  for (const e of gates) if (e.action === 'drop') for (const f of new Set(e.flags.map((x) => x.check))) byCheck.set(f, (byCheck.get(f) ?? 0) + 1);
  const fw = rows.map((r) => [r.firstWord.before, r.firstWord.after]).filter(([a, b]) => a != null && b != null) as number[][];
  const sm = rows.map((r) => [r.seam.before, r.seam.after]).filter(([a, b]) => a != null && b != null) as number[][];
  const words = sum((r) => r.released.reduce((n, x) => n + tokenize(x.text).filter((t) => t.kind === 'word').length, 0));
  console.log(`answers ${rows.length}`);
  console.log(`gate units ${sum((r) => r.stats.units)}, fails ${sum((r) => r.stats.fails)}, strips ${sum((r) => r.stats.strips)}, drops ${sum((r) => r.stats.drops)} (${(100 * sum((r) => r.stats.drops) / Math.max(1, sum((r) => r.stats.units))).toFixed(1)}% of units), droppedWords ${sum((r) => r.stats.droppedWords)} of ${words + sum((r) => r.stats.droppedWords)}, liveSkipAfterPass ${sum((r) => r.liveSkipAfterPass)}`);
  console.log(`drops by check: ${[...byCheck].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`);
  console.log(`first word p50 ${p50(fw.map((x) => x[0])).toFixed(0)} → ${p50(fw.map((x) => x[1])).toFixed(0)} ms (Δ p50 ${p50(fw.map((x) => x[1] - x[0])).toFixed(1)}, max ${Math.max(...fw.map((x) => x[1] - x[0])).toFixed(0)})`);
  console.log(`seam p50 ${p50(sm.map((x) => x[0])).toFixed(0)} → ${p50(sm.map((x) => x[1])).toFixed(0)} ms (Δ p50 ${p50(sm.map((x) => x[1] - x[0])).toFixed(1)}, n ${sm.length})`);
  console.log(`check ms p50 ${p50(rows.flatMap((r) => r.checkMs)).toFixed(1)} p95 ${p95(rows.flatMap((r) => r.checkMs)).toFixed(1)}`);
  if (argv.includes('--drops')) for (const e of gates) if (e.action === 'drop') console.log(`  drop ${e.k} [${e.flags.map((f) => `${f.check}: ${f.detail}`).join(' | ').slice(0, 220)}] "${(e.text ?? '').slice(0, 120)}"`);
  const json = opt('--json');
  if (json) (await import('node:fs')).writeFileSync(json, JSON.stringify(rows.map((r) => ({ ...r, skippedBodies: [...r.skippedBodies] })), null, 1));
}
