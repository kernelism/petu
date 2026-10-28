// scripts/corpus/browserBench.ts — times the browser text index (ContextBuilder's PageIndex: pdf.js
// worker, idle-time slices of 4 pages) on corpus documents in headless Chrome. $0: no API call.
//   node --experimental-strip-types scripts/corpus/browserBench.ts [--only ost-econ,ax-resnet] [--extra szeliski]
// Starts its own Vite dev server on port 5197 (PETU_PDF_DIRS = corpus + course dirs) and merges
// the timings into <corpus>/profile.json under `browser`.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Chrome } from '../eval/cdp.ts';
import { CORPUS, corpusDir } from './sources.ts';
import { DECK_FILES, pdfDirs } from '../eval/decks.ts';

const argv = process.argv.slice(2);
const opt = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const only = opt('--only')?.split(',');
const extra = opt('--extra')?.split(',') ?? [];
const PORT = 5197;
const root = process.cwd();
const dir = corpusDir(root);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const docs = [
  ...CORPUS.filter((d) => !only || only.includes(d.id)).map((d) => ({ id: d.id, file: `${d.file}.pdf` })),
  ...extra.map((id) => ({ id, file: `${DECK_FILES[id]}.pdf` })),
];
const vite = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'],
  { env: { ...process.env, PETU_PDF_DIRS: [dir, ...pdfDirs(root)].join(',') }, stdio: 'ignore' });
try {
  for (let i = 0; i < 100; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await sleep(200); } }
  const tmp = join(dir, '.bench');
  mkdirSync(tmp, { recursive: true });
  const out: Record<string, unknown> = {};
  for (const d of docs) {
    const c = await Chrome.launch({ dir: tmp });
    try {
      await c.goto(`http://localhost:${PORT}/scripts/corpus/bench.html?src=${encodeURIComponent(`/api/dev-pdf/${d.file}`)}`);
      let r: unknown = null;
      for (let i = 0; i < 1200 && !r; i++) {
        await sleep(250);
        r = await c.eval('window.__bench ?? (window.__benchErr ? {error: window.__benchErr} : null)').catch(() => null);
      }
      out[d.id] = r ?? { error: 'timeout' };
      console.log(d.id, JSON.stringify(r));
    } finally { await c.close(); }
  }
  const p = join(dir, 'profile.json');
  const prof = (() => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return {}; } })();
  prof.browser = { ...(prof.browser ?? {}), ...out, at: new Date().toISOString() };
  writeFileSync(p, JSON.stringify(prof, null, 1));
} finally { vite.kill(); }
