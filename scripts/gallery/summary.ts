// scripts/gallery/summary.ts — the gate's verdict and printed summary (pure; scripts/gate.ts runs the steps).
import { expectedBy, unexpectedChanges, type ShotRow } from './diff.ts';
import { AUDIT_PREFIX } from './audit.ts';

export type StepResult = { name: string; ok: boolean; ms: number; detail?: string; skipped?: boolean };

/** The gallery step: fails on changed/missing/errored shots no `--expect` covers, with no baseline, or on a gate audit failure. */

export function galleryStep(rows: ShotRow[], expect: string[], o: { ms: number; baseline: string | null; sheet: string; errors?: string[]; /** Scenes or browsers the run left out. */ skipped?: string[] }): StepResult {
  if (!o.baseline) return { name: 'gallery', ok: false, ms: o.ms, detail: `no baseline: run \`npm run gallery -- --baseline\` on main first (sheet ${o.sheet})` };
  const bad = unexpectedChanges(rows, expect);
  const intended = rows.filter((r) => r.status !== 'same' && r.status !== 'new' && expectedBy(r.name, expect));
  const fresh = rows.filter((r) => r.status === 'new');
  const unused = expect.filter((p) => !rows.some((r) => r.status !== 'same' && expectedBy(r.name, [p])));
  const lines: string[] = [];
  for (const r of bad) lines.push(`${r.status} ${r.name}${r.pixels != null ? ` (${r.pixels} px, ${((r.ratio ?? 0) * 100).toFixed(3)}%)` : ''}${r.error ? ` ${r.error}` : ''}`);
  if (intended.length) lines.push(`${intended.length} intended change(s) (--expect)`);
  if (fresh.length) lines.push(`${fresh.length} new shot(s) without a baseline`);
  if (unused.length) lines.push(`--expect matched no change: ${unused.join(', ')}`);
  for (const e of (o.errors ?? []).filter((e) => !e.includes('console:'))) lines.push(`error: ${e}`);
  for (const s of o.skipped ?? []) lines.push(`skipped: ${s}`);
  const same = rows.filter((r) => r.status === 'same').length;
  lines.unshift(`${same}/${rows.length} shots unchanged vs ${o.baseline}`);
  lines.push(`sheet: ${o.sheet}`);
  // A dev script the live gate flagged, dropped or saw drift on (scripts/gallery/audit.ts) fails the gallery.
  const audit = (o.errors ?? []).filter((e) => e.includes(AUDIT_PREFIX));
  return { name: 'gallery', ok: bad.length === 0 && audit.length === 0, ms: o.ms, detail: lines.join('\n') };
}

/** The replay-stress step: the skip rate must not rise above the last recorded value (a tiny epsilon for float noise). */
export function stressStep(rate: number | null, last: number | null, ms: number): StepResult {
  if (rate == null) return { name: 'replay-stress', ok: false, ms, detail: 'could not read a skip rate from the output (expected "skip rate: N%" or "skipRate": N)' };
  if (last == null) return { name: 'replay-stress', ok: true, ms, detail: `skip rate ${fmtRate(rate)} (first recorded value)` };
  const ok = rate <= last + 1e-9;
  return { name: 'replay-stress', ok, ms, detail: `skip rate ${fmtRate(rate)} vs last ${fmtRate(last)}${ok ? '' : ' — rose'}` };
}

const fmtRate = (r: number) => `${(r * 100).toFixed(2)}%`;

/** Per-script counts as replay-stress writes them (`--json`: `scripts`, keyed by the script's hash). */
export type StressScripts = Record<string, { label?: string; checked: number; skipped: number }>;
/** The gate's replay-stress baseline (<gallery root>/../gate/replay-stress.json). Older files have only skipRate. */
export type StressBaseline = { skipRate: number; at?: string; recordings?: number; scripts?: StressScripts };

/**
 * The replay-stress step, corpus-stable: the skip rate over the scripts the baseline recorded must not
 * rise (current counts vs the baseline's, same scripts). Scripts recorded since then are reported with
 * their own rate but never fail the gate (the next passing gate adds them to the baseline); scripts
 * gone since are left out. A baseline without per-script counts (older gates) cannot be compared on the
 * same set: the step passes and says so, and this gate's per-script record becomes the baseline.
 */
export function stressCorpusStep(cur: { skipRate: number; scripts: StressScripts }, base: StressBaseline | null, ms: number): StepResult {
  const name = 'replay-stress';
  const n = Object.keys(cur.scripts).length;
  if (!base) return { name, ok: true, ms, detail: `skip rate ${fmtRate(cur.skipRate)} over ${n} scripts (first recorded baseline)` };
  if (!base.scripts) return { name, ok: true, ms, detail: `skip rate ${fmtRate(cur.skipRate)} over ${n} scripts; the last baseline (${fmtRate(base.skipRate)}) has no per-script record, so no same-corpus comparison: this run becomes the baseline` };
  const rate = (k: number, c: number) => (c ? k / c : 0);
  let ck = 0, cc = 0, bk = 0, bc = 0, nk = 0, nc = 0, fresh = 0;
  const worse: { label: string; d: number; from: number; to: number }[] = [];
  let better = 0;
  for (const [key, c] of Object.entries(cur.scripts)) {
    const b = base.scripts[key];
    if (!b) { fresh++; nk += c.skipped; nc += c.checked; continue; }
    ck += c.skipped; cc += c.checked; bk += b.skipped; bc += b.checked;
    if (c.skipped > b.skipped) worse.push({ label: c.label ?? b.label ?? key.slice(0, 8), d: c.skipped - b.skipped, from: b.skipped, to: c.skipped });
    else if (c.skipped < b.skipped) better++;
  }
  const common = n - fresh, gone = Object.keys(base.scripts).length - common;
  const now = rate(ck, cc), was = rate(bk, bc);
  const ok = now <= was + 1e-9;
  const lines = [
    `skip rate on the ${common} baseline scripts ${fmtRate(now)} (${ck}/${cc}) vs ${fmtRate(was)} (${bk}/${bc})${ok ? '' : ' — rose'}; ${worse.length} script(s) worse, ${better} better`,
    `new scripts since the baseline: ${fresh}${fresh ? ` (${fmtRate(rate(nk, nc))}, ${nk}/${nc}: not gated)` : ''}${gone ? `; gone: ${gone}` : ''}; all ${n}: ${fmtRate(cur.skipRate)}`,
  ];
  if (!ok) for (const w of worse.sort((x, y) => y.d - x.d).slice(0, 5)) lines.push(`  ${w.label}: ${w.from} -> ${w.to} skipped`);
  return { name, ok, ms, detail: lines.join('\n') };
}

/** Reads a skip rate from replay-stress output as a fraction: the last `skip rate: 3.2%` / `skipRate: 0.032` / `"skipRate": 0.032`. */
export function parseSkipRate(out: string): number | null {
  const m = [...out.matchAll(/"?skip[ _-]?rate"?\s*[:=]?\s*([\d.]+)\s*(%?)/gi)].pop();
  if (!m) return null;
  const v = Number(m[1]);
  if (!Number.isFinite(v)) return null;
  return m[2] === '%' || v > 1 ? v / 100 : v;
}

/** `wallMs`: the gate's wall time (steps overlap, so their sum overstates it). */
export function summarize(steps: StepResult[], wallMs?: number): { ok: boolean; text: string } {
  const ok = steps.every((s) => s.ok || s.skipped);
  const w = Math.max(...steps.map((s) => s.name.length));
  const lines = steps.map((s) => {
    const mark = s.skipped ? 'SKIP' : s.ok ? 'PASS' : 'FAIL';
    const head = `${mark}  ${s.name.padEnd(w)}  ${(s.ms / 1000).toFixed(1).padStart(5)}s`;
    const detail = s.detail && (!s.ok || s.name === 'gallery' || s.name === 'replay-stress' || s.skipped)
      ? `\n${s.detail.split('\n').map((l) => `        ${l}`).join('\n')}` : '';
    return head + detail;
  });
  const total = wallMs ?? steps.reduce((a, s) => a + s.ms, 0);
  return { ok, text: `${lines.join('\n')}\n\nGATE ${ok ? 'PASSED' : 'FAILED'} (${(total / 1000).toFixed(1)}s)` };
}
