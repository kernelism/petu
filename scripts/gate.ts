// scripts/gate.ts — `npm run gate [-- --expect side,kit@end] [--skip-gallery] [--browsers chromium,firefox]`
// The pre-merge check: typecheck, tests, build, the gallery diff against the baseline (fails only on
// changes beyond tolerance that no --expect covers) and, when package.json has `replay-stress`, its
// skip rate over the scripts the last passing gate recorded must not rise (per-script counts in
// <gallery root>/../gate/replay-stress.json; scripts recorded since are reported, not gated).
// Exits non-zero on failure. Makes no API calls.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { galleryRoot, runGallery } from './gallery/run.ts';
import { galleryStep, parseSkipRate, stressCorpusStep, stressStep, summarize, type StepResult, type StressBaseline, type StressScripts } from './gallery/summary.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function sh(cmd: string, args: string[], env: Record<string, string> = {}): Promise<{ code: number; out: string; ms: number }> {
  const t0 = Date.now();
  return new Promise((res) => {
    const p = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env } });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => res({ code: code ?? 1, out, ms: Date.now() - t0 }));
  });
}

const tail = (s: string, n = 25) => s.trimEnd().split('\n').slice(-n).join('\n');

async function step(name: string, cmd: string, args: string[]): Promise<StepResult> {
  const r = await sh(cmd, args);
  return { name, ok: r.code === 0, ms: r.ms, detail: r.code === 0 ? undefined : tail(r.out) };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const expect: string[] = [];
  let skipGallery = false;
  let browsers: string[] | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--expect') expect.push(...(argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean));
    else if (argv[i] === '--skip-gallery') skipGallery = true;
    else if (argv[i] === '--browsers') browsers = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    else { console.error(`unknown argument ${argv[i]}`); process.exit(2); }
  }
  const t0 = Date.now();
  console.log('gate: typecheck, tests, build (parallel)…');
  // tsc, vitest and vite build don't share outputs: run them together, then the gallery alone (it wants the CPU).
  const steps: StepResult[] = await Promise.all([
    step('typecheck', 'npx', ['tsc', '--noEmit']),
    step('tests', 'npx', ['vitest', 'run']),
    step('build', 'npx', ['vite', 'build']),
  ]);

  if (skipGallery) steps.push({ name: 'gallery', ok: true, skipped: true, ms: 0, detail: '--skip-gallery' });
  else {
    console.log('gate: gallery…');
    const g0 = Date.now();
    try {
      const m = await runGallery({ label: 'gate', quiet: true, browsers });
      steps.push(galleryStep(m.rows, expect, { ms: Date.now() - g0, baseline: m.baseline, sheet: join(m.dir, 'index.html'), errors: m.errors, skipped: m.skipped }));
    } catch (e) {
      steps.push({ name: 'gallery', ok: false, ms: Date.now() - g0, detail: String((e as Error).message ?? e) });
    }
  }

  let record: (() => void) | null = null;
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
  if (pkg.scripts?.['replay-stress']) {
    console.log('gate: replay-stress…');
    const file = join(galleryRoot(), '../gate/replay-stress.json');
    let base: StressBaseline | null = null;
    try { base = JSON.parse(readFileSync(file, 'utf8')) as StressBaseline; } catch { /* first run */ }
    // Per-script counts (--json) so the comparison runs on the baseline's own scripts: new recordings never fail the gate.
    const out = join(mkdtempSync(join(tmpdir(), 'petu-stress-')), 'stress.json');
    const r = await sh('npm', ['run', '--silent', 'replay-stress', '--', '--json', out]);
    let cur: { skipRate: number; scripts: StressScripts } | null = null;
    try { cur = r.code === 0 ? JSON.parse(readFileSync(out, 'utf8')) as { skipRate: number; scripts: StressScripts } : null; } catch { /* no JSON: fall back to the printed rate */ }
    let s: StepResult;
    if (r.code !== 0) s = { name: 'replay-stress', ok: false, ms: r.ms, detail: tail(r.out) };
    else if (cur?.scripts) s = stressCorpusStep(cur, base, r.ms);
    else s = stressStep(parseSkipRate(r.out), base?.skipRate ?? null, r.ms);
    steps.push(s);
    // Recorded only when the whole gate passes (below): a failing branch never moves the bar.
    if (s.ok && cur?.scripts) record = () => {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify({ skipRate: cur.skipRate, at: new Date().toISOString(), recordings: Object.keys(cur.scripts).length, scripts: cur.scripts } satisfies StressBaseline, null, 1));
    };
  } else steps.push({ name: 'replay-stress', ok: true, skipped: true, ms: 0, detail: 'no `replay-stress` script yet' });

  const { ok, text } = summarize(steps, Date.now() - t0);
  if (ok) record?.();
  console.log(`\n${text}`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
