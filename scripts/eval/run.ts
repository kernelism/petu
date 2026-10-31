// scripts/eval/run.ts — the eval runner.
//   node --experimental-strip-types scripts/eval/run.ts --split dev --config terra-none [--only D4,T2] [--n 2]
//        [--replay <runId>] [--judge|--no-judge] [--webkit] [--prewarm] [--qset q2|q1] [--rubric r3|r2]
// Eval v3 defaults: question set q2, rubric r3 (judged on a timeline of frames: see frames.ts).
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
import { deckPath, deckUrlPath, pathOfSrc, pdfDirs } from './decks.ts';
import { computeMetrics, type Metrics } from './metrics.ts';
import { parseAnswer } from './scriptTags.ts';
import { buildJudgeRequest, buildJudgeRequestR3, estimateJudgeTokens, fakeJudgeFetch, judgeAnswer, JUDGE_MODEL, renderTranscript, RUBRICS, type JudgeFrame, type JudgeRequest, type JudgeResult } from './judge.ts';
import { JUDGE_MAX_OUTPUT } from './configs.ts';
import { worstCaseUsd } from '../../server/prices.ts';
import { readCalibration } from './calibrate.ts';
import { assertSplitAllowed, QSETS, SHARED_PAGES_OK, qsetId, validateSet, freeze, type Question } from './questions.ts';
import { boardProbeScript, boardScrollScript, boardSegments, downscaleScript, frameCaptions, frameSchedule, pagesTouched, pdfDigest, stitchScript } from './frames.ts';
import { checkBudget, gateQuery, parseArgs, selectQuestions, spendsOnRepairs, wantsJudge, type Args } from './plan.ts';
import { renderReport, type ReportItem } from './report.ts';
import { composeScript, pickStills } from './sheet.ts';
import { buildSummary, hostLoadOf, runIdOf, type HostLoad, type QuestionSummary } from './summary.ts';
import { promptVersionOf } from '../../server/prompt/system.ts';
import { SCOUT_VERSION } from '../../server/prompt/scout.ts';
import { SCOUT_MODEL } from './configs.ts';
import { cpus, loadavg } from 'node:os';
/** The prompt this run's server uses (PETU_PROMPT_VARIANT: an experiment variant, recorded in the run id). */
const PROMPT_VERSION = promptVersionOf(process.env.PETU_PROMPT_VARIANT?.trim() || undefined);
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

type TestUse = { runId: string; at: string; qset?: string };
/** Earlier runs that touched this set's test split (entries without a set are q1's, from checkpoint 2). */
export const testUsesOf = (uses: TestUse[], qset: string): number => uses.filter((u) => (u.qset ?? 'q1') === qset).length;
const allTestUses = (): TestUse[] => (existsSync(TEST_USES) ? readJson<TestUse[]>(TEST_USES) : []);
const noteTestUse = (runId: string, qset: string) => writeJson(TEST_USES, [...allTestUses(), { runId, at: new Date().toISOString(), qset }]);

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

/** After a turn: the settled final state, and the whole board when the layout has one (stitched strips). */
export async function captureEnd(chrome: Chrome, qdir: string, prefix: string): Promise<void> {
  await sleep(700); // trailing ink and layout settle
  writeFileSync(join(qdir, `${prefix}final.png`), await chrome.shot());
  const probe = await chrome.eval<{ x: number; y: number; w: number; h: number; scrollHeight: number; clientHeight: number; scrollTop: number } | null>(boardProbeScript);
  if (!probe) return;
  const ys = boardSegments(probe.scrollHeight, probe.clientHeight);
  const urls: string[] = [];
  for (const y of ys) {
    await chrome.eval(boardScrollScript(y));
    urls.push(`data:image/png;base64,${(await chrome.shot('png', probe)).toString('base64')}`);
  }
  await chrome.eval(boardScrollScript(probe.scrollTop));
  const out = await chrome.eval<string>(stitchScript(urls, ys, probe.h));
  writeFileSync(join(qdir, `${prefix}board.jpg`), Buffer.from(out.split(',')[1], 'base64'));
}

/** PETU_CTX=old|new: which scout context the app builds (?ctx=; src/agent/context/tiers.ts). Unset: the app's default (new over 60 pages). */
const CTX = process.env.PETU_CTX === 'new' ? '&ctx=new' : process.env.PETU_CTX === 'old' ? '&ctx=old' : '';
/** EXPERIMENT: PETU_EVAL_URL_EXTRA (e.g. `&e5`) is appended to the app's URL, and PETU_EVAL_TAG to the run id. */
const URL_EXTRA = process.env.PETU_EVAL_URL_EXTRA ?? '';
/** What the first word depends on: the scout's prompt version, model and effort, and the app's context options. */
const SCOUT_ID = `${SCOUT_VERSION}/${process.env.PETU_SCOUT_MODEL?.trim() || SCOUT_MODEL}/${process.env.PETU_SCOUT_EFFORT?.trim() || 'none'}${CTX}${URL_EXTRA}`;
const urlFor = (base: string, open: StoredQuestion['open'], nogen: boolean, gate = '') => `${base}/?src=${encodeURIComponent(open.src)}&page=${open.page}&eval${nogen ? '&nogen' : ''}${CTX}${gate}${URL_EXTRA}`;
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
  await chrome.goto(urlFor(ctx.base, open, !!prior, gateQuery(ctx.args)));
  // PETU_EVAL_VOICE=marin|cedar: the answer is read aloud (Settings → Voice), as the founder hears it.
  const voice = process.env.PETU_EVAL_VOICE?.trim();
  if (voice) {
    await chrome.eval(`localStorage.setItem('pdf-tutor.settings', JSON.stringify({ ...JSON.parse(localStorage.getItem('pdf-tutor.settings') ?? '{}'), voice: ${JSON.stringify(voice)} }))`);
    await chrome.goto(urlFor(ctx.base, open, !!prior, gateQuery(ctx.args)));
  }
  await chrome.eval(`new Promise((r) => { const t = setInterval(() => { if (window.__petu) { clearInterval(t); r(); } }, 100); setTimeout(r, 30000); })`);
  await chrome.eval('window.__petu.ready()');
  const pageShot = await chrome.shot();
  writeFileSync(join(qdir, 'page.png'), pageShot);
  const turns: EvalResult[] = [];
  if (prior) {
    for (const log of prior.turns) {
      turn = turns.length;
      turns.push(await chrome.eval<EvalResult>(`window.__petu.replay(${JSON.stringify(log)}).then(() => window.__petu.result())`));
      await Promise.all(shots); await captureEnd(chrome, qdir, turn ? `t${turn + 1}-` : '');
    }
  } else {
    if (q.ink) await chrome.eval(`window.__petu.inkAroundLargestMark(${q.page})`);
    // --prewarm: the student's intent (ask bar focus) warms the page's cache, as typing would, before Enter.
    if (ctx.args.prewarmMs) { await chrome.eval(`document.querySelector('.askbar input, .askbar textarea')?.focus()`); await sleep(ctx.args.prewarmMs); }
    turns.push(await chrome.eval<EvalResult>(`window.__petu.ask(${JSON.stringify(q.question)}).then(() => window.__petu.result())`));
    await Promise.all(shots); await captureEnd(chrome, qdir, '');
    if (q.followUp) {
      turn = 1;
      turns.push(await chrome.eval<EvalResult>(`window.__petu.ask(${JSON.stringify(q.followUp)}).then(() => window.__petu.result())`));
      await Promise.all(shots); await captureEnd(chrome, qdir, 't2-');
    }
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

/** The r3 judge's images for one turn: scheduled sentence-end stills, final state, board (JPEG ≤ 1152 px wide, written next to the stills). */
export type TurnFrames = { frames: (JudgeFrame & { file: string; sentence: number })[]; final?: { b64: string; w: number; h: number; file: string }; board?: { b64: string; w: number; h: number; file: string } };
async function judgeFramesOf(chrome: Chrome, qdir: string, turn: number, res: EvalResult, reuse: boolean): Promise<TurnFrames> {
  const pre = turn ? `t${turn + 1}-` : '';
  const jpeg = async (src: string, dst: string): Promise<{ b64: string; w: number; h: number; file: string } | undefined> => {
    if (!existsSync(join(qdir, src))) return undefined;
    if (!(reuse && existsSync(join(qdir, dst)))) {
      const url = `data:image/${src.endsWith('.jpg') ? 'jpeg' : 'png'};base64,${readFileSync(join(qdir, src)).toString('base64')}`;
      const out = await chrome.eval<string>(downscaleScript(url));
      writeFileSync(join(qdir, dst), Buffer.from(out.split(',')[1], 'base64'));
    }
    const b = readFileSync(join(qdir, dst));
    const size = jpegDims(b);
    return { b64: b.toString('base64'), ...size, file: dst };
  };
  const picks = frameSchedule(res.sentences);
  const caps = frameCaptions(res.sentences, picks);
  const frames: TurnFrames['frames'] = [];
  for (let k = 0; k < picks.length; k++) {
    const f = await jpeg(`${pre}s${picks[k]}.png`, `${pre}f${k + 1}.jpg`);
    if (f) frames.push({ ...f, caption: caps[k], sentence: picks[k] });
  }
  return { frames, final: await jpeg(`${pre}final.png`, `${pre}final.jpg`), board: await jpeg(`${pre}board.jpg`, `${pre}board-judge.jpg`) };
}

/** Width and height from a JPEG's SOF header. */
export function jpegDims(b: Buffer): { w: number; h: number } {
  for (let i = 2; i + 9 < b.length;) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + b.readUInt16BE(i + 2);
  }
  return { w: 0, h: 0 };
}

/** Renders each final state in WebKit by replay (no generation). playwright-core is looked up, not installed. */
async function webkitStills(base: string, items: { id: string; stored: StoredQuestion; qdir: string }[], gate = ''): Promise<void> {
  const req = createRequire(process.env.PLAYWRIGHT_DIR ?? '/Users/arjuns/.npm/_npx/9833c18b2d85bc59/node_modules/');
  const { webkit } = req('playwright-core');
  const browser = await webkit.launch();
  try {
    for (const it of items) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      await page.goto(urlFor(base, it.stored.open, true, gate), { waitUntil: 'commit' });
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

/** The selected questions whose deck PDF is not found (fixtures always are), one line per deck. */
export function missingDecks(qs: Pick<Question, 'id' | 'deck'>[], find: (deck: string) => string = (d) => deckPath(d)): string[] {
  const byDeck = new Map<string, string[]>();
  for (const q of qs) byDeck.set(q.deck, [...(byDeck.get(q.deck) ?? []), q.id]);
  const out: string[] = [];
  for (const [deck, ids] of byDeck) { try { find(deck); } catch (e) { out.push(`${(e as Error).message} (${ids.join(',')})`); } }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cfg = CONFIGS[args.config];
  const phase = process.env.PETU_PHASE ?? 'dev';
  const QUESTIONS: Question[] = args.ask ? [...QSETS[args.qset], { id: 'X1', split: 'dev', deck: args.ask.deck, page: args.ask.page, pick: 'hand', type: 'narrow', question: args.ask.question }] : QSETS[args.qset];
  const QSET = qsetId(QSETS[args.qset], args.qset);
  const rubric = RUBRICS[args.rubric];
  const errs = validateSet(QSETS[args.qset], { sharedPages: SHARED_PAGES_OK.has(args.qset) });
  if (errs.length) throw new Error(`question set invalid: ${errs.join('; ')}`);
  await freeze(EVAL_DIR, args.qset);
  if (args.finish && args.replay) throw new Error('--finish and --replay are exclusive');
  let qs = selectQuestions(args, cfg, QUESTIONS);
  // --finish completes a run that already generated (e.g. a crash in the judge step): it makes no new
  // answers, so it is not a new use of the test split.
  if (args.finish) qs = qs.filter((q) => existsSync(join(RUNS, args.finish!, q.id, 'result.json')));
  if (!qs.length) throw new Error('no questions selected');
  if (!args.finish) assertSplitAllowed(qs.map((q) => q.id), phase, testUsesOf(allTestUses(), args.qset), QUESTIONS);
  // A deck that is not on this machine would only show "Couldn't open that PDF" in the headless page,
  // and the run would wait on it forever: name the missing decks before anything starts.
  if (!args.finish) {
    const missing = missingDecks(qs);
    if (missing.length) throw new Error(`${missing.join('\n')}\n(set PETU_PDF_DIRS, or pick questions on present decks with --only)`);
  }
  const judge = wantsJudge(args, cfg);

  const date = new Date().toISOString().slice(0, 10);
  const tag = args.config + (args.ask ? '-ask' : '') + (args.replay ? '-replay' : '') + (args.prewarmMs ? '-prewarm' : '') + (args.gate ? `-gate${args.gate}` : '') + (args.gatefail ? '-gatefail' : '') + (args.rubric !== 'r3' ? `-${args.rubric}` : '') + (process.env.PETU_EVAL_TAG ? `-${process.env.PETU_EVAL_TAG}` : '');
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
    const budget = checkBudget(spend, cfg, planGenerates ? todo : [], args.n, judge && !args.fakeJudge, args.rubric, spendsOnRepairs(args));
    console.log(`budget: ${budget.message}`);
    if (!budget.ok) throw new Error(`refusing to start: ${budget.message}`);
    if (planGenerates && cfg.model.startsWith('claude-') && spend.keys && !spend.keys.anthropic) throw new Error('refusing to start: the config is a Claude model and the server found no Anthropic key in .env (PETU_ANTHROPIC_KEY or ANTHROPIC_API_KEY)');
    if (planGenerates && spend.model && spend.model !== cfg.model) throw new Error(`refusing to start: the server answers with ${spend.model}, not ${cfg.model}`);
    if (!args.finish && todo.some((q) => q.split === 'test')) noteTestUse(runId, args.qset);

    for (let i = 0; i < (args.finish ? 1 : Math.min(args.parallel, todo.length * args.n)); i++) chromes.push(await Chrome.launch({ dir: join(EVAL_DIR, 'tmp') }));
    // Machine load while answers play (first word and the other latencies are only comparable on a quiet machine).
    const loads: number[] = [loadavg()[0]];
    const sampler = setInterval(() => loads.push(loadavg()[0]), 5000);
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

    clearInterval(sampler);
    loads.push(loadavg()[0]);
    // Metrics, sheets, judge.
    const priorRun = args.replay ? join(RUNS, args.replay) : args.finish ? dir : null;
    const summaries: QuestionSummary[] = [];
    const items: ReportItem[] = [];
    const sheeter = chromes[0];
    for (const d of done.sort((a, b) => QUESTIONS.indexOf(a.q) - QUESTIONS.indexOf(b.q) || a.rep - b.rep)) {
      const id = d.rep ? `${d.q.id}.${d.rep + 1}` : d.q.id;
      // The app parser's view of each turn: honest malformed counts and transcript marks.
      const parsed = d.stored.turns.map(parseAnswer);
      const metrics = d.stored.turns.map((r, i) => computeMetrics(r, parsed[i]));
      writeJson(join(d.qdir, 'metrics.json'), { turns: metrics });
      // A follow-up's judge also sees the turn before it (judge.ts FOLLOW_UP_RUBRIC).
      let before: { question: string; tf: TurnFrames; res: EvalResult } | null = null;
      for (let t = 0; t < d.stored.turns.length; t++) {
        const res = { ...d.stored.turns[t], tags: parsed[t].tags };
        const last = t === d.stored.turns.length - 1;
        const sheetName = `${t ? `t${t + 1}-` : ''}sheet.jpg`;
        // --finish keeps the sheet the run already composed (its judgement key hashes it).
        const transcript = renderTranscript(res);
        const pre = t ? `t${t + 1}-` : '';
        // r2 judges a contact sheet; r3 a timeline of frames (made for every turn: the report shows them).
        // --finish keeps the images the run already composed (the judgement key hashes them).
        const sheet = rubric.version === 'r2'
          ? (args.finish && existsSync(join(d.qdir, sheetName)) ? readFileSync(join(d.qdir, sheetName)) : await sheetOf(sheeter, d.qdir, t, res.sentences.length))
          : null;
        if (sheet) writeFileSync(join(d.qdir, sheetName), sheet);
        const tf = rubric.version === 'r3' ? await judgeFramesOf(sheeter, d.qdir, t, res, !!args.finish) : null;
        let judgeRes: JudgeResult | undefined; let judgeUsd = 0;
        const page = { b64: d.pageShot.toString('base64'), w: 1440, h: 900 };
        let req: JudgeRequest | null = null, key = '';
        if (judge && last && sheet) {
          req = buildJudgeRequest({ phase, question: res.question, result: res, page, sheet: { b64: sheet.toString('base64'), w: 1536, h: 864 } });
          key = sha(`${sha(sheet)}|${transcript}|${res.question}|${sha(rubric.text)}`); // a rubric change re-judges
        } else if (judge && last && tf && tf.frames.length) {
          const src = pathOfSrc(d.stored.open.src);
          const digest = src ? await pdfDigest(src, { visible: d.stored.open.page, touched: pagesTouched(res) }) : '(document text unavailable)';
          const previous = before && d.q.followUp ? { question: before.question, frames: before.tf.frames, final: before.tf.final, board: before.tf.board, result: before.res } : undefined;
          req = buildJudgeRequestR3({ phase, question: res.question, result: res, page, digest, frames: tf.frames, final: tf.final, board: tf.board, ...(previous ? { previous } : {}) });
          key = sha(`${req.instructions}|${JSON.stringify(req.content)}`);
          writeJson(join(d.qdir, `${pre}judge-request.json`), { estTokens: estimateJudgeTokens(req), worstUsd: worstCaseUsd(JUDGE_MODEL, estimateJudgeTokens(req), JUDGE_MAX_OUTPUT),
            content: req.content.map((c) => (c.type === 'input_text' ? c : { type: c.type, w: c.w, h: c.h, detail: c.detail, bytes: Math.round(c.b64.length * 0.75) })) });
        }
        if (req) {
          const old = priorRun ? join(priorRun, args.finish ? id : d.q.id, 'judge.json') : null;
          // Reuse an unchanged answer's judgement, unless it was a fake one (or this run is fake).
          const prev = old && existsSync(old) ? readJson<{ key: string; judge: JudgeResult; usd?: number; fake?: boolean }>(old) : null;
          if (!args.fakeJudge && prev && !prev.fake && prev.key === key) {
            judgeRes = prev.judge; // unchanged answer: no new spend
            if (args.finish) judgeUsd = prev.usd ?? 0; // the same run: keep what it cost
          } else try {
            const out = await judgeAnswer(req, { base: server.base, token: server.token, rubric, ...(args.fakeJudge ? { fetch: fakeJudgeFetch(rubric) } : {}) });
            judgeRes = out.judge; judgeUsd = out.usd;
          } catch (e) {
            // One failed judgement must not lose the run: the answer stays unjudged (finish it later with --finish).
            if (/cap/.test(String(e))) throw e;
            console.error(`${id} judge failed: ${(e as Error).message}`);
          }
          if (judgeRes) writeJson(join(d.qdir, 'judge.json'), { key, judge: judgeRes, usd: judgeUsd, ...(args.fakeJudge ? { fake: true } : {}) });
        }
        if (tf) before = { question: res.question, tf, res };
        const qsum: QuestionSummary = { id, split: d.q.split, type: d.q.type, ...(t ? { turn: t } : {}), metrics: metrics[t], judge: judgeRes, judgeUsd };
        summaries.push(qsum);
        const n = res.sentences.length;
        const rel = (f: string) => `${id}/${f}`;
        items.push({ q: d.q, summary: qsum, asked: res.question, transcript, sheet: sheet ? rel(sheetName) : undefined,
          stills: Array.from({ length: n }, (_, i) => `${id}/${pre}s${i}.png`).filter((p) => existsSync(join(dir, p))),
          page: `${id}/page.png`, webkit: args.webkit ? [`${id}/${pre}webkit.png`] : undefined,
          ...(tf ? { timeline: {
            frames: tf.frames.map((f) => ({ src: rel(`${pre}s${f.sentence}.png`), caption: f.caption, sentence: f.sentence })),
            final: existsSync(join(d.qdir, `${pre}final.png`)) ? rel(`${pre}final.png`) : undefined,
            board: existsSync(join(d.qdir, `${pre}board.jpg`)) ? rel(`${pre}board.jpg`) : undefined,
          } } : {}) });
      }
    }
    if (args.webkit) {
      await webkitStills(server.base, done.map((d) => ({ id: d.q.id, stored: d.stored, qdir: d.qdir })), gateQuery({ ...args, repair: args.repair ?? 'recorded', replay: args.replay ?? 'webkit' }));
    }
    // --finish re-judges an earlier run: it keeps the prompt version that run generated with (not this checkout's).
    // Its scout and load too: the latencies are the ones it measured then.
    const priorSummary = args.finish && existsSync(join(dir, 'summary.json')) ? readJson<{ promptVersion?: string; scout?: string; load?: HostLoad }>(join(dir, 'summary.json')) : null;
    const summary = buildSummary({ runId, config: args.config, qset: QSET, promptVersion: priorSummary?.promptVersion ?? PROMPT_VERSION, phase, rubric: rubric.version, questions: summaries,
      ...(args.finish ? { scout: priorSummary?.scout, load: priorSummary?.load } : { scout: SCOUT_ID, load: hostLoadOf(loads, cpus().length) }) });
    if (args.fakeJudge) summary.fakeJudge = true;
    writeJson(join(dir, 'summary.json'), summary);
    writeJson(join(dir, 'run.json'), { args, config: cfg, phase, replayOf: args.replay, ...(args.finish ? { finishedAt: new Date().toISOString() } : {}) });
    writeFileSync(join(dir, 'report.html'), renderReport(summary, items, readCalibration(dir, args.fakeJudge)));
    console.log(`run ${runId}\n  skipped ${summary.run.sum.skippedTotal}  malformed ${summary.run.sum.malformed}  skip defects ${summary.run.skipDefects}/${summary.run.n}  first word p50 ${summary.run.firstWordMs.p50?.toFixed(0) ?? '-'} p90 ${summary.run.firstWordMs.p90?.toFixed(0) ?? '-'} ms  spoken mean ${summary.run.meanSpokenMs != null ? (summary.run.meanSpokenMs / 1000).toFixed(1) : '-'} s\n${summary.run.gate ? `  gate units ${summary.run.gate.sum.units}  fails ${summary.run.gate.sum.fails}  strips ${summary.run.gate.sum.strips}  drops ${summary.run.gate.sum.drops} (${summary.run.gate.sum.droppedWords} words)  repairs ${summary.run.gate.sum.repairOk}/${summary.run.gate.sum.repairs} ok, ${summary.run.gate.sum.repairLate} late  repair p50/p95 ${summary.run.gate.repairMs.p50 ?? '-'}/${summary.run.gate.repairMs.p95 ?? '-'} ms  holds>1s ${summary.run.gate.sum.holds}  live skips after pass ${summary.run.gate.sum.liveSkipAfterPass}  check p95 ${summary.run.gate.shadowMs.p95 ?? '-'} ms  repair $${summary.run.gate.repairUsd.toFixed(3)}\n` : ''}  answers ${summary.run.n}  judge mean ${summary.judge.mean?.toFixed(2) ?? '-'}  fatal ${summary.judge.fatal}  gen $${summary.genUsd.toFixed(3)}  judge $${summary.judge.usd.toFixed(3)}\n  open ${join(dir, 'report.html')}`);
  } finally {
    for (const c of chromes) await c.close();
    server.stop();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(() => process.exit(0), (e) => { console.error(String(e instanceof Error ? e.message : e)); process.exit(1); });
}

