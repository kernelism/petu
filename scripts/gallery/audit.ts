// scripts/gallery/audit.ts — the live gate's audit of dev scripts (design 2026-10-29 §8). Under
// `&gate=audit` the app publishes every gate verdict and repair to `window.__petuGateLog`
// (src/agent/evalHooks.ts publishGate); a dev script is hand-written and must pass whole, so any fail
// flag, drop or shadow drift is a gallery error (and fails `npm run gate`). Notes (checks whose precision
// is not measured yet) are not failures. Pure: no imports from the app.
export const AUDIT_PREFIX = 'gate audit:';

type Logged = { t?: string; k?: string; result?: string; action?: string; flags?: { check?: string; detail?: string }[]; notes?: string[]; text?: string };

/** One line per problem in a scene's gate log (empty when the script passed). */
export function auditGate(log: unknown): string[] {
  if (!Array.isArray(log)) return [];
  const out: string[] = [];
  for (const e of log as Logged[]) {
    if (e?.t !== 'gate') continue;
    const flags = (e.flags ?? []).map((f) => `${f.check}: ${f.detail}`);
    const drift = (e.notes ?? []).filter((n) => /drift/i.test(n));
    if (!flags.length && e.action !== 'drop' && e.result !== 'fail' && !drift.length) continue;
    const what = [e.action === 'drop' ? 'dropped' : e.result === 'fail' ? 'failed' : e.result === 'strip' ? 'stripped' : 'flagged', ...flags, ...drift].join('; ');
    out.push(`${AUDIT_PREFIX} unit ${e.k ?? '?'} ${what}${e.text ? ` — "${e.text.slice(0, 80)}"` : ''}`);
  }
  return out;
}
