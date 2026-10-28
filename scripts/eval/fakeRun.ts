// scripts/eval/fakeRun.ts — a hand-made run for E7 (no spend): the demo scripts recorded as chunk logs.
//   npx vite-node scripts/eval/fakeRun.ts            # writes .petu/eval/runs/fake-demo/
//   node --experimental-strip-types scripts/eval/run.ts --split dev --only D1,D2,D3 --replay fake-demo --no-judge [--webkit]
// vite-node resolves the app's extensionless imports (plain node can't). Opens the committed fixture.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEMOS } from '../../src/demo/demoScript';
import { mulberry32 } from './sample';
import type { EvalResult } from '../../src/agent/evalHooks';
import { emptyResult } from '../../src/agent/evalHooks';

/** The script cut into 3-14 character chunks at ~35ms spacing (what streamDemo does, but seeded). */
export function chunkLog(script: string, question: string, seed = 1): EvalResult {
  const rnd = mulberry32(seed);
  const r = emptyResult(question, 0);
  let i = 0, t = 350;
  while (i < script.length) {
    const n = 3 + Math.floor(rnd() * 12);
    r.chunks.push({ t, d: script.slice(i, i + n) });
    i += n; t += 20 + Math.round(rnd() * 30);
  }
  r.events = [{ t: 'done', usd: 0, spentUsd: 0, capUsd: 0, ttftMs: 350 }];
  return r;
}

export function writeFakeRun(root: string, id = 'fake-demo'): string {
  const dir = join(root, '.petu/eval/runs', id);
  DEMOS.forEach((d, k) => {
    const qdir = join(dir, `D${k + 1}`);
    mkdirSync(qdir, { recursive: true });
    writeFileSync(join(qdir, 'result.json'), JSON.stringify({ open: { src: '/fixtures/epipolar.pdf', page: 3 }, turns: [chunkLog(d.script, d.question, k + 1)], errors: [] }, null, 1));
  });
  return dir;
}

if (!process.env.VITEST) console.log('wrote', writeFakeRun(process.cwd()));
