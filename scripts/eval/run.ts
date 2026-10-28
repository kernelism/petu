// scripts/eval/run.ts — the eval runner.
//   node --experimental-strip-types scripts/eval/run.ts --split dev --config terra-none [--only D4,T2] [--n 2]
//        [--replay <runId>] [--judge|--no-judge] [--webkit] [--prewarm]
// Real app, real speed, headless Chrome over CDP. Outputs live in .petu/eval/ (gitignored).
// Every model/judge call goes through the dev server (and its ledger); this file holds no key.
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { Chrome } from './cdp.ts';
import { CONFIGS, configEnv } from './configs.ts';
import { deckUrlPath, pdfDirs } from './decks.ts';
import { computeMetrics, type Metrics } from './metrics.ts';
import { buildJudgeRequest, judgeAnswer, renderTranscript, RUBRIC, type JudgeResult } from './judge.ts';
import { assertSplitAllowed, QSET, QUESTIONS, validateSet, freeze, type Question } from './questions.ts';
import { checkBudget, parseArgs, selectQuestions, wantsJudge, type Args } from './plan.ts';
import { renderReport, type ReportItem } from './report.ts';
import { composeScript, pickStills } from './sheet.ts';
import { buildSummary, runIdOf, type QuestionSummary } from './summary.ts';
import { PROMPT_VERSION } from '../../server/prompt/system.ts';
import type { EvalResult } from '../../src/agent/evalHooks.ts';
import type { SpendSummary } from '../../src/agent/protocol.ts';

const ROOT = process.cwd();
export const EVAL_DIR = join(ROOT, '.petu/eval');
const RUNS = join(EVAL_DIR, 'runs');
const TEST_USES = join(EVAL_DIR, 'test-uses.json');
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Stored per question: where it opened, and every turn's recording. */
export type StoredQuestion = { open: { src: string; page: number }; turns: EvalResult[]; errors: string[] };

const readJson = <T,>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;
const writeJson = (p: string, v: unknown) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, JSON.stringify(v, null, 1)); };

const testUses = (): number => (existsSync(TEST_USES) ? readJson<unknown[]>(TEST_USES).length : 0);
const noteTestUse = (runId: string) => writeJson(TEST_USES, [...(existsSync(TEST_USES) ? readJson<unknown[]>(TEST_USES) : []), { runId, at: new Date().toISOString() }]);

/** Eval dev servers use ports from PETU_EVAL_PORTS (default 5186-5195), never the founder's 5180. */
export function evalPorts(spec = process.env.PETU_EVAL_PORTS ?? '5186-5195'): number[] {
  const m = /^(\d+)-(\d+)$/.exec(spec.trim());
  if (!m) return spec.split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const out: number[] = [];
  for (let p = Number(m[1]); p <= Number(m[2]); p++) out.push(p);
  return out;
}

const portFree = (port: number): Promise<boolean> => new Promise((res) => {
  // Vite binds 127.0.0.1 here; probe the same address and the IPv6 loopback a founder server may hold.
  const s = createServer();
  s.once('error', () => res(false));
  s.listen(port, '127.0.0.1', () => s.close(() => {
    const s6 = createServer();
    s6.once('error', (e: NodeJS.ErrnoException) => res(e.code === 'EADDRNOTAVAIL'));
    s6.listen(port, '::1', () => s6.close(() => res(true)));
  }));
});

async function freePort(): Promise<number> {
  for (const p of evalPorts()) if (await portFree(p)) return p;
  throw new Error(`no free eval port in ${process.env.PETU_EVAL_PORTS ?? '5186-5195'}`);
}

async function startServer(env: Record<string, string>): Promise<{ base: string; token: string; stop(): void }> {
  const port = await freePort();
  // Our own judge token: the server uses it and leaves .petu/eval-token (another server's) alone.
  const token = randomBytes(24).toString('hex');
  const p: ChildProcess = spawn('npx', ['vite', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
    { env: { ...process.env, ...env, PETU_PDF_DIRS: pdfDirs(ROOT).join(','), PETU_EVAL_TOKEN: token }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 200; i++) { try { if ((await fetch(`${base}/api/spend`)).ok) return { base, token, stop: () => p.kill() }; } catch { /* not up yet */ } await sleep(150); }
  p.kill();
  throw new Error('dev server did not come up (is Lane S in place? GET /api/spend)');
}

const urlFor = (base: string, open: StoredQuestion['open'], nogen: boolean) => `${base}/?src=${encodeURIComponent(open.src)}&page=${open.page}&eval${nogen ? '&nogen' : ''}`;
const sha = (b: Buffer | string) => createHash('sha1').update(b).digest('hex');

type Ctx = { base: string; dir: string; args: Args; phase: string; judge: boolean; replay: Record<string, StoredQuestion> | null };

async function runQuestion(chrome: Chrome, ctx: Ctx, q: Question, rep: number): Promise<{ stored: StoredQuestion; qdir: string; pageShot: Buffer }> {
  const id = rep ? `${q.id}.${rep + 1}` : q.id;
  const qdir = join(ctx.dir, id);
  mkdirSync(qdir, { recursive: true });
  const prior = ctx.replay?.[q.id];
  const open = prior?.open ?? { src: deckUrlPath(q.deck), page: q.page };
  let turn = 0;
  const shots: Promise<void>[] = [];
  await chrome.binding('petuShot', (payload) => {
    const t = turn, i = Number(payload);
    shots.push(chrome.shot().then((b) => writeFileSync(join(qdir, `${t ? `t${t + 1}-` : ''}s${i}.png`), b)));
  });
  await chrome.goto(urlFor(ctx.base, open, !!prior));
  await chrome.eval(`new Promise((r) => { const t = setInterval(() => { if (window.__petu) { clearInterval(t); r(); } }, 100); setTimeout(r, 30000); })`);
  await chrome.eval('window.__petu.ready()');
  const pageShot = await chrome.shot();
  writeFileSync(join(qdir, 'page.png'), pageShot);
  const turns: EvalResult[] = [];
  if (prior) {
    for (const log of prior.turns) { turn = turns.length; turns.push(await chrome.eval<EvalResult>(`window.__petu.replay(${JSON.stringify(log)}).then(() => window.__petu.result())`)); }
  } else {
    if (q.ink) await chrome.eval(`window.__petu.inkAroundLargestMark(${q.page})`);
    // --prewarm: the student's intent (ask bar focus) warms the page's cache, as typing would, before Enter.
    if (ctx.args.prewarmMs) { await chrome.eval(`document.querySelector('.askbar input, .askbar textarea')?.focus()`); await sleep(ctx.args.prewarmMs); }
    turns.push(await chrome.eval<EvalResult>(`window.__petu.ask(${JSON.stringify(q.question)}).then(() => window.__petu.result())`));
    if (q.followUp) { turn = 1; turns.push(await chrome.eval<EvalResult>(`window.__petu.ask(${JSON.stringify(q.followUp)}).then(() => window.__petu.result())`)); }
  }
  await Promise.all(shots);
  const stored: StoredQuestion = { open, turns, errors: [...chrome.errors] };
  writeJson(join(qdir, 'result.json'), stored);
  return { stored, qdir, pageShot };
}

async function sheetOf(chrome: Chrome, qdir: string, turn: number, nStills: number): Promise<Buffer | null> {
  const files = pickStills(nStills).map((i) => join(qdir, `${turn ? `t${turn + 1}-` : ''}s${i}.png`)).filter(existsSync);
  if (!files.length) return null;
  const urls = files.map((f) => `data:image/png;base64,${readFileSync(f).toString('base64')}`);
  const out = await chrome.eval<string>(composeScript(urls));
  return Buffer.from(out.split(',')[1], 'base64');
}

/** Renders each final state in WebKit by replay (no generation). playwright-core is looked up, not installed. */
async function webkitStills(base: string, items: { id: string; stored: StoredQuestion; qdir: string }[]): Promise<void> {
  const req = createRequire(process.env.PLAYWRIGHT_DIR ?? '/Users/arjuns/.npm/_npx/9833c18b2d85bc59/node_modules/');
  const { webkit } = req('playwright-core');
  const browser = await webkit.launch();
  try {
    for (const it of items) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      await page.goto(urlFor(base, it.stored.open, true), { waitUntil: 'commit' });
      await page.waitForFunction('window.__petu', null, { timeout: 30000 });
      await page.evaluate('window.__petu.ready()');
      for (let t = 0; t < it.stored.turns.length; t++) {
        await page.evaluate(`window.__petu.replay(${JSON.stringify(it.stored.turns[t])})`);
        await page.screenshot({ path: join(it.qdir, `${t ? `t${t + 1}-` : ''}webkit.png`) });
      }
      await ctx.close();
    }
  } finally { await browser.close(); }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cfg = CONFIGS[args.config];
  const phase = process.env.PETU_PHASE ?? 'dev';
  const errs = validateSet(QUESTIONS);
  if (errs.length) throw new Error(`question set invalid: ${errs.join('; ')}`);
  await freeze(EVAL_DIR);
  if (args.finish && args.replay) throw new Error('--finish and --replay are exclusive');
  let qs = selectQuestions(args, cfg);
  // --finish completes a run that already generated (e.g. a crash in the judge step): it makes no new
  // answers, so it is not a new use of the test split.
  if (args.finish) qs = qs.filter((q) => existsSync(join(RUNS, args.finish!, q.id, 'result.json')));
  if (!qs.length) throw new Error('no questions selected');
  if (!args.finish) assertSplitAllowed(qs.map((q) => q.id), phase, testUses());
  const judge = wantsJudge(args, cfg);

  const date = new Date().toISOString().slice(0, 10);
  const tag = args.config + (args.replay ? '-replay' : '') + (args.prewarmMs ? '-prewarm' : '');
  let runId = args.finish ?? runIdOf(date, tag, PROMPT_VERSION, QSET);
  if (!args.finish) for (let i = 2; existsSync(join(RUNS, runId)); i++) runId = `${runIdOf(date, tag, PROMPT_VERSION, QSET)}-${i}`;
  const dir = join(RUNS, runId);
  mkdirSync(dir, { recursive: true });

  let replay: Record<string, StoredQuestion> | null = null;
  if (args.replay) {
    const src = join(RUNS, args.replay);
    if (!existsSync(src)) throw new Error(`no such run ${args.replay}`);
    replay = {};
    for (const q of qs) { const f = join(src, q.id, 'result.json'); if (existsSync(f)) replay[q.id] = readJson<StoredQuestion>(f); }
  }
  const todo = qs.filter((q) => !replay || replay[q.id]);

  const server = await startServer(configEnv(cfg, phase));
  const chromes: Chrome[] = [];
  try {
    const spend = (await (await fetch(`${server.base}/api/spend`)).json()) as SpendSummary;
    const planGenerates = !replay && !args.finish;
    const budget = checkBudget(spend, cfg, planGenerates ? todo : [], args.n, judge);
    console.log(`budget: ${budget.message}`);
    if (!budget.ok) throw new Error(`refusing to start: ${budget.message}`);
    if (!args.finish && todo.some((q) => q.split === 'test')) noteTestUse(runId);

    for (let i = 0; i < (args.finish ? 1 : Math.min(args.parallel, todo.length * args.n)); i++) chromes.push(await Chrome.launch({ dir: join(EVAL_DIR, 'tmp') }));
    const jobs = todo.flatMap((q) => Array.from({ length: replay ? 1 : args.n }, (_, rep) => ({ q, rep })));
    const done: { q: Question; rep: number; stored: StoredQuestion; qdir: string; pageShot: Buffer }[] = [];
    let next = 0;
    if (args.finish) {
      // Every repetition the run made (D1, D1.2, …), not just the first.
      for (const q of todo) for (let rep = 0; ; rep++) {
        const qdir = join(dir, rep ? `${q.id}.${rep + 1}` : q.id);
        if (!existsSync(join(qdir, 'result.json'))) break;
        done.push({ q, rep, stored: readJson<StoredQuestion>(join(qdir, 'result.json')), qdir, pageShot: readFileSync(join(qdir, 'page.png')) });
      }
      next = jobs.length;
    }
    await Promise.all(chromes.map(async (chrome) => {
      while (next < jobs.length) {
        const { q, rep } = jobs[next++];
        try { done.push({ q, rep, ...(await runQuestion(chrome, { base: server.base, dir, args, phase, judge, replay }, q, rep)) }); console.log('ran', q.id); }
        catch (e) { console.error(`${q.id} failed: ${(e as Error).message}`); }
      }
    }));

    // Metrics, sheets, judge.
    const priorRun = args.replay ? join(RUNS, args.replay) : args.finish ? dir : null;
    const summaries: QuestionSummary[] = [];
    const items: ReportItem[] = [];
    const sheeter = chromes[0];
    for (const d of done.sort((a, b) => QUESTIONS.indexOf(a.q) - QUESTIONS.indexOf(b.q) || a.rep - b.rep)) {
      const id = d.rep ? `${d.q.id}.${d.rep + 1}` : d.q.id;
      const metrics = d.stored.turns.map(computeMetrics);
      writeJson(join(d.qdir, 'metrics.json'), { turns: metrics });
      for (let t = 0; t < d.stored.turns.length; t++) {
        const res = d.stored.turns[t];
        const last = t === d.stored.turns.length - 1;
        const sheetName = `${t ? `t${t + 1}-` : ''}sheet.jpg`;
        // --finish keeps the sheet the run already composed (its judgement key hashes it).
        const sheet = args.finish && existsSync(join(d.qdir, sheetName)) ? readFileSync(join(d.qdir, sheetName)) : await sheetOf(sheeter, d.qdir, t, res.sentences.length);
        if (sheet) writeFileSync(join(d.qdir, sheetName), sheet);
        const transcript = renderTranscript(res);
        let judgeRes: JudgeResult | undefined; let judgeUsd = 0;
        if (judge && last && sheet) {
          const key = sha(`${sha(sheet)}|${transcript}|${res.question}|${sha(RUBRIC)}`); // a rubric change re-judges
          const old = priorRun ? join(priorRun, args.finish ? id : d.q.id, 'judge.json') : null;
          if (old && existsSync(old) && readJson<{ key: string; judge: JudgeResult }>(old).key === key) {
            const prev = readJson<{ key: string; judge: JudgeResult; usd?: number }>(old);
            judgeRes = prev.judge; // unchanged answer: no new spend
            if (args.finish) judgeUsd = prev.usd ?? 0; // the same run: keep what it cost
          } else try {
            const out = await judgeAnswer(buildJudgeRequest({ phase, question: res.question, result: res,
              page: { b64: d.pageShot.toString('base64'), w: 1440, h: 900 }, sheet: { b64: sheet.toString('base64'), w: 1536, h: 864 } }), { base: server.base, token: server.token });
            judgeRes = out.judge; judgeUsd = out.usd;
          } catch (e) {
            // One failed judgement must not lose the run: the answer stays unjudged (finish it later with --finish).
            if (/cap/.test(String(e))) throw e;
            console.error(`${id} judge failed: ${(e as Error).message}`);
          }
          if (judgeRes) writeJson(join(d.qdir, 'judge.json'), { key, judge: judgeRes, usd: judgeUsd });
        }
        const qsum: QuestionSummary = { id, split: d.q.split, type: d.q.type, ...(t ? { turn: t } : {}), metrics: metrics[t], judge: judgeRes, judgeUsd };
        summaries.push(qsum);
        const n = res.sentences.length;
        items.push({ q: d.q, summary: qsum, asked: res.question, transcript, sheet: sheet ? `${id}/${sheetName}` : undefined,
          stills: Array.from({ length: n }, (_, i) => `${id}/${t ? `t${t + 1}-` : ''}s${i}.png`).filter((p) => existsSync(join(dir, p))),
          page: `${id}/page.png`, webkit: args.webkit ? [`${id}/${t ? `t${t + 1}-` : ''}webkit.png`] : undefined });
      }
    }
    if (args.webkit) {
      await webkitStills(server.base, done.map((d) => ({ id: d.q.id, stored: d.stored, qdir: d.qdir })));
    }
    const summary = buildSummary({ runId, config: args.config, qset: QSET, promptVersion: PROMPT_VERSION, phase, questions: summaries });
    writeJson(join(dir, 'summary.json'), summary);
    writeJson(join(dir, 'run.json'), { args, config: cfg, phase, replayOf: args.replay, ...(args.finish ? { finishedAt: new Date().toISOString() } : {}) });
    writeFileSync(join(dir, 'report.html'), renderReport(summary, items));
    console.log(`run ${runId}\n  answers ${summary.run.n}  judge mean ${summary.judge.mean?.toFixed(2) ?? '-'}  fatal ${summary.judge.fatal}  gen $${summary.genUsd.toFixed(3)}  judge $${summary.judge.usd.toFixed(3)}\n  open ${join(dir, 'report.html')}`);
  } finally {
    for (const c of chromes) await c.close();
    server.stop();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(() => process.exit(0), (e) => { console.error(String(e instanceof Error ? e.message : e)); process.exit(1); });
}

