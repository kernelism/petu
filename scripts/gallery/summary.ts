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
