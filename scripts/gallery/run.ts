// scripts/gallery/run.ts — `npm run gallery [-- --baseline] [--only side,kit] [--browsers webkit] [--sizes 1440x900]`
// Starts its own dev server, renders every scene (scenes.ts) at fixed moments in Chromium and WebKit
// at each size, saves stills to <gallery root>/<run>/shots/, diffs them against the baseline run and
// writes <run>/index.html (the contact sheet). The page clock is Playwright's fake clock, stepped in
// fixed increments: a moment is the same frame on every run. No API calls (demos and dev scripts only;
// the server also gets a $0 cap).
//
// The gallery root is shared by every worktree of the repo: <main checkout>/.petu/gallery (override
// with PETU_GALLERY_DIR), so a baseline made on main serves every branch.
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from './png.ts';
import { diffImages, shotName, DEFAULT_DIFF, type ShotRow } from './diff.ts';
import { SCENES, SIZES, BROWSERS, audited, type Scene } from './scenes.ts';
import { auditGate } from './audit.ts';
import { renderSheet } from './sheet.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Fake-clock step. Animation frames still run every 16ms inside a step. */
const STEP_MS = 200;
/** Real time the page gets, clock paused, before a screenshot (pdf.js workers and paint catch up). */
const SETTLE_MS = 350;
const FAKE_EPOCH = Date.UTC(2026, 0, 1);
const PER_BROWSER = Number(process.env.PETU_GALLERY_CONCURRENCY ?? 6);

export function galleryRoot(): string {
  if (process.env.PETU_GALLERY_DIR) return resolve(process.env.PETU_GALLERY_DIR);
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: ROOT, encoding: 'utf8' }).trim();
    return join(dirname(common), '.petu/gallery');
  } catch { return join(ROOT, '.petu/gallery'); }
}

export type Shot = { name: string; scene: string; moment: string; browser: string; size: string; file: string };
export type Manifest = {
  id: string; at: string; ms: number; commit: string; baseline: string | null; isBaseline: boolean;
  shots: Shot[]; rows: ShotRow[]; skipped: string[]; errors: string[]; diff: typeof DEFAULT_DIFF; /** A --baseline run that became the baseline. */ marked?: boolean;
};
export type GalleryOptions = { baseline?: boolean; only?: string[]; browsers?: string[]; sizes?: string[]; label?: string; quiet?: boolean };

const freePort = (): Promise<number> => new Promise((res, rej) => {
  const s = createServer();
  s.once('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); });
});

async function startServer(): Promise<{ base: string; stop(): void }> {
  let port = await freePort();
  while (port === 5180 || port === 5181) port = await freePort();
  const p: ChildProcess = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', join(ROOT, 'scripts/gallery/serve.ts'), String(port)], {
    cwd: ROOT, stdio: 'ignore',
    // Belt and braces: the gallery never asks, and a $0 cap refuses any call before it is sent.
    env: { ...process.env, PETU_TOTAL_CAP_USD: '0', PETU_DAILY_CAP_USD: '0' },
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 300; i++) {
    try { if ((await fetch(`${base}/`)).ok) return { base, stop: () => p.kill() }; } catch { /* not up yet */ }
    await sleep(100);
  }
  p.kill();
  throw new Error('dev server did not come up');
}

const MAC_PLAYWRIGHT = '/Users/arjuns/.npm/_npx/9833c18b2d85bc59/node_modules/';
const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** Where to look for playwright-core: PLAYWRIGHT_DIR, else the Mac's npx cache, else any npx cache (newest version first). */
function playwrightDirs(): string[] {
  if (process.env.PLAYWRIGHT_DIR) return [process.env.PLAYWRIGHT_DIR];
  const npx = join(homedir(), '.npm/_npx');
  const found = existsSync(npx) ? readdirSync(npx).map((d) => join(npx, d, 'node_modules/')).filter((d) => existsSync(join(d, 'playwright-core/package.json'))) : [];
  const version = (d: string) => (JSON.parse(readFileSync(join(d, 'playwright-core/package.json'), 'utf8')).version as string).split('.').map(Number);
  found.sort((a, b) => { const va = version(a), vb = version(b); return (vb[0] - va[0]) || (vb[1] - va[1]) || (vb[2] - va[2]); });
  return [MAC_PLAYWRIGHT, ...found];
}

/** playwright-core, from the first candidate that loads and (unless `own` is false) has browser `name` downloaded. */
function playwright(name: string, own: boolean): { chromium: any; webkit: any } {
  // playwright-core is looked up, not installed (as the eval's --webkit does); PLAYWRIGHT_DIR overrides.
  const dirs = playwrightDirs();
  for (const dir of dirs) {
    let pw: { chromium: any; webkit: any };
    try { pw = createRequire(dir)('playwright-core'); } catch { continue; }
    if (!own || existsSync(pw[name as 'chromium' | 'webkit'].executablePath())) return pw;
  }
  throw new Error(`playwright-core with ${name} not found under ${dirs.join(', ')}: run \`npx playwright-core install ${name}\` once or set PLAYWRIGHT_DIR`);
}

async function launch(name: string): Promise<any> {
  if (name === 'webkit') return playwright('webkit', true).webkit.launch();
  // System Chrome (CHROME overrides); without one (Linux), Playwright's own Chromium.
  const chrome = process.env.CHROME ?? (existsSync(MAC_CHROME) ? MAC_CHROME : undefined);
  return playwright('chromium', !chrome).chromium.launch({ ...(chrome ? { executablePath: chrome } : {}), args: ['--hide-scrollbars'] });
}

/** [answer playing, worker messages so far, finite CSS transitions/animations still running (real time)]. */
const STATE = `[!!document.querySelector('.askbar-btn.is-stop, .pb-stop'), window.__galleryMsgs || 0,
  document.getAnimations().filter((a) => a.playState === 'running' && Number.isFinite(a.effect?.getComputedTiming().endTime)).length,
  (() => { // scroll offsets of the scrollers (smooth scrolling runs on real time); the list is refreshed every 25 calls
    const w = window; w.__galleryN = (w.__galleryN || 0) + 1;
    if (!w.__galleryScrollers || w.__galleryN % 25 === 1) w.__galleryScrollers = [...document.querySelectorAll('*')].filter((e) => e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1);
    return w.__galleryScrollers.map((e) => e.scrollTop + ',' + e.scrollLeft).join(';') + '|' + scrollX + ',' + scrollY;
  })()]`;
/** Counts messages to and from every Worker (the pdf.js worker): real async work the fake clock can't see. */
const WORKER_COUNTER = `(() => {
  const W = window.Worker; if (!W) return;
  const bump = () => { window.__galleryMsgs = (window.__galleryMsgs || 0) + 1; };
  window.Worker = class extends W {
    constructor(...a) { super(...a); this.addEventListener('message', bump); }
    postMessage(...a) { bump(); return super.postMessage(...a); }
  };
})()`;
const QUIET_MS = 24;
const QUIET_POLL_MS = 8;

/** Plays one scene in one page and screenshots each moment. */
async function renderScene(browser: any, browserName: string, base: string, scene: Scene, size: string, dir: string, errors: string[]): Promise<Shot[]> {
  const [width, height] = size.split('x').map(Number);
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const tag = `${scene.name}.${browserName}.${size}`;
  page.on('pageerror', (e: Error) => errors.push(`${tag}: ${e.message}`));
  page.on('console', (m: any) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${tag}: console: ${m.text()}`); });
  page.on('response', (r: any) => { if (r.status() >= 400) errors.push(`${tag}: console: HTTP ${r.status()} ${new URL(r.url()).pathname}`); });
  const shots: Shot[] = [];
  try {
    let inflight = 0;
    page.on('request', () => { inflight++; });
    page.on('requestfinished', () => { inflight--; });
    page.on('requestfailed', () => { inflight--; });
    await page.addInitScript(WORKER_COUNTER);
    await page.clock.install({ time: FAKE_EPOCH });
    await page.clock.pauseAt(FAKE_EPOCH + 1000); // a moment ahead: real ms pass between the two calls
    await page.goto(`${base}/?${scene.query}`, { waitUntil: 'commit' });
    let msgs = 0, scroll = '';
    let fake = 0, start: number | null = null, done: number | null = null;
    const pending = [...scene.moments];
    const t0 = Date.now();
    while (pending.length) {
      // The real-time cap leaves room for slower machines (the kit scene takes ~150s of real time on a Linux box).
      if (fake > 240_000 || Date.now() - t0 > 400_000) throw new Error(`timed out (fake ${fake}ms, start ${start}, done ${done}, waiting for ${pending.map((m) => m.name)})`);
      await page.clock.runFor(STEP_MS);
      fake += STEP_MS;
      // Fake time stands still while real-time work runs (fetches, the pdf.js worker, CSS transitions):
      // wait until nothing is in flight, no transition runs and the worker has been silent for QUIET_MS,
      // so each step sees the same world.
      let busy = false, quiet = 0;
      for (const s0 = Date.now(); Date.now() - s0 < 3000;) {
        const st = await page.evaluate(STATE) as [boolean, number, number, string];
        busy = st[0];
        if (inflight > 0 || st[1] !== msgs || st[2] > 0 || st[3] !== scroll) { msgs = st[1]; scroll = st[3]; quiet = 0; } else if (quiet >= QUIET_MS) break;
        await sleep(QUIET_POLL_MS); quiet += QUIET_POLL_MS;
      }
      if (busy && start == null) start = fake;
      if (!busy && start != null && done == null) done = fake;
      if (process.env.PETU_GALLERY_DEBUG && fake % 5000 === 0) console.log(`${tag} fake ${fake} start ${start} done ${done} real ${Date.now() - t0}`);
      for (const m of [...pending]) {
        const anchor = m.after === 'start' ? start : done;
        if (anchor == null || fake < anchor + m.ms) continue;
        for (const k of m.keys ?? []) await page.keyboard.press(k);
        await sleep(SETTLE_MS);
        const name = shotName({ scene: scene.name, moment: m.name, browser: browserName, size });
        const file = `shots/${name}.png`;
        await page.screenshot({ path: join(dir, file) });
        shots.push({ name, scene: scene.name, moment: m.name, browser: browserName, size, file });
        pending.splice(pending.indexOf(m), 1);
      }
    }
    if (audited(scene)) for (const p of auditGate(await page.evaluate('window.__petuGateLog || []'))) errors.push(`${tag}: ${p}`);
  } catch (e) {
    errors.push(`${tag}: ${(e as Error).message.split('\n')[0]}`);
  } finally { await ctx.close(); }
  return shots;
}

async function pool<T>(jobs: (() => Promise<T>)[], n: number): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => {
    while (next < jobs.length) { const i = next++; out[i] = await jobs[i](); }
  }));
  return out;
}

const readJson = <T>(p: string): T | null => { try { return JSON.parse(readFileSync(p, 'utf8')) as T; } catch { return null; } };

export function baselineId(root = galleryRoot()): string | null {
  return readJson<{ id: string }>(join(root, 'baseline.json'))?.id ?? null;
}

/** Compares this run's shots with the baseline's; writes diff images for changed shots. */
export function compareRun(root: string, dir: string, shots: Shot[], base: Manifest | null, scope: { scenes: Set<string>; browsers: Set<string>; sizes: Set<string> }, failed: Set<string>): ShotRow[] {
  const rows: ShotRow[] = [];
  const baseByName = new Map((base?.shots ?? []).map((s) => [s.name, s]));
  for (const s of shots) {
    const b = baseByName.get(s.name);
    if (!base || !b) { rows.push({ name: s.name, status: 'new' }); continue; }
    const curBuf = readFileSync(join(dir, s.file)), baseBuf = readFileSync(join(root, base.id, b.file));
    if (curBuf.equals(baseBuf)) { rows.push({ name: s.name, status: 'same', pixels: 0, ratio: 0, box: null }); continue; }
    const d = diffImages(decodePng(baseBuf), decodePng(curBuf));
    if (d.changed && d.image) writeFileSync(join(dir, `diff/${s.name}.png`), encodePng(d.image));
    rows.push({ name: s.name, status: d.changed ? 'changed' : 'same', pixels: d.pixels, ratio: d.ratio, box: d.box });
  }
  // Baseline shots in this run's scope that did not render: missing (or an error when the scene failed).
  const have = new Set(shots.map((s) => s.name));
  for (const b of base?.shots ?? []) {
    if (have.has(b.name) || !scope.scenes.has(b.scene) || !scope.browsers.has(b.browser) || !scope.sizes.has(b.size)) continue;
    const scene = `${b.scene}.${b.browser}.${b.size}`;
    rows.push(failed.has(scene) ? { name: b.name, status: 'error', error: 'scene failed to render' } : { name: b.name, status: 'missing' });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export async function runGallery(o: GalleryOptions = {}): Promise<Manifest & { dir: string }> {
  const t0 = Date.now();
  const log = (s: string) => { if (!o.quiet) console.log(s); };
  const root = galleryRoot();
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const id = `${stamp}-${o.label ?? (o.baseline ? 'baseline' : 'run')}-${randomBytes(2).toString('hex')}`;
  const dir = join(root, id);
  mkdirSync(join(dir, 'shots'), { recursive: true });
  mkdirSync(join(dir, 'diff'), { recursive: true });
  const browsers = (o.browsers?.length ? o.browsers : [...BROWSERS]);
  const sizes = (o.sizes?.length ? o.sizes : [...SIZES]);
  const skipped: string[] = [];
  const scenes = SCENES.filter((s) => !o.only?.length || o.only.includes(s.name)).filter((s) => {
    if (s.needs && !existsSync(join(ROOT, s.needs))) { skipped.push(`${s.name} (needs ${s.needs})`); return false; }
    return true;
  });
  let commit = '';
  try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { /* not a checkout */ }

  log(`gallery ${id}: ${scenes.length} scenes × ${browsers.join('+')} × ${sizes.join(', ')}`);
  const server = await startServer();
  const errors: string[] = [];
  const failed = new Set<string>();
  let shots: Shot[] = [];
  try {
    // One throwaway load warms Vite's transform cache before the parallel pages hit it.
    const warmB = await launch(browsers.includes('chromium') ? 'chromium' : browsers[0]);
    try {
      const warm = await warmB.newPage();
      await warm.goto(`${server.base}/?demo=1&noplay`).catch(() => {});
      await warm.waitForFunction('!!window.__desk', null, { timeout: 30_000 }).catch(() => {});
    } finally { await warmB.close(); }
    // One browser process per job: several pages in one WebKit process stall each other's clocks.
    const perBrowser = await Promise.all(browsers.map(async (bn) => {
      const jobs = scenes.flatMap((sc) => sizes.map((sz) => async () => {
        const browser = await launch(bn);
        try {
          const got = await renderScene(browser, bn, server.base, sc, sz, dir, errors);
          if (got.length < sc.moments.length) failed.add(`${sc.name}.${bn}.${sz}`);
          return got;
        } finally { await browser.close(); }
      }));
      return (await pool(jobs, PER_BROWSER)).flat();
    }));
    shots = perBrowser.flat().sort((a, b) => a.name.localeCompare(b.name));
  } finally { server.stop(); }
  const renderMs = Date.now() - t0;

  const prevId = o.baseline ? null : baselineId(root);
  const base = prevId ? readJson<Manifest>(join(root, prevId, 'manifest.json')) : null;
  const rows = compareRun(root, dir, shots, base, { scenes: new Set(scenes.map((s) => s.name)), browsers: new Set(browsers), sizes: new Set(sizes) }, failed);
  const manifest: Manifest = {
    id, at: new Date().toISOString(), ms: Date.now() - t0, commit, baseline: base ? base.id : null, isBaseline: !!o.baseline,
    shots, rows, skipped, errors, diff: DEFAULT_DIFF,
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1));
  writeFileSync(join(dir, 'index.html'), renderSheet(manifest, base));
  if (o.baseline) {
    if (failed.size) log(`not marked as baseline: ${failed.size} scene(s) failed to render`);
    else { writeFileSync(join(root, 'baseline.json'), JSON.stringify({ id, at: manifest.at, commit }, null, 1)); manifest.marked = true; }
  }
  log(`rendered ${shots.length} shots in ${(renderMs / 1000).toFixed(1)}s, total ${(manifest.ms / 1000).toFixed(1)}s`);
  return { ...manifest, dir };
}

function parseArgs(argv: string[]): GalleryOptions {
  const o: GalleryOptions = {};
  const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--baseline') o.baseline = true;
    else if (a === '--only') o.only = list(argv[++i]);
    else if (a === '--browsers') o.browsers = list(argv[++i]);
    else if (a === '--sizes') o.sizes = list(argv[++i]);
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const o = parseArgs(process.argv.slice(2));
  runGallery(o).then((m) => {
    const changed = m.rows.filter((r) => r.status !== 'same' && r.status !== 'new');
    for (const e of m.errors) console.log(`  error: ${e}`);
    for (const s of m.skipped) console.log(`  skipped: ${s}`);
    if (m.isBaseline) console.log(m.marked ? `baseline: ${m.id}` : 'NOT marked as baseline (see errors)');
    else if (!m.baseline) console.log('no baseline yet: run `npm run gallery -- --baseline`');
    else console.log(`vs baseline ${m.baseline}: ${changed.length ? changed.map((r) => `${r.status} ${r.name}`).join('\n  ') : 'no changes'}`);
    console.log(`contact sheet: ${join(m.dir, 'index.html')}`);
    process.exit(m.errors.some((e) => !e.includes('console:')) || (m.isBaseline && !m.marked) ? 1 : 0);
  }).catch((e) => { console.error(e); process.exit(1); });
}
