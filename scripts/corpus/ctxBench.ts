// scripts/corpus/ctxBench.ts — offline benchmark of the scout's context, old vs new (design
// "Huge-PDF context"). $0: no API calls. For every q3 and q2 question whose PDF is present: does each
// page the answer needs reach the scout's context with real detail (old: the digest; new: the tiered
// blocks), the tokens per block, the estimated cost per answer (warm / cold cache, server/prices.ts)
// and the local time to build the per-question context. Also: are the cached blocks of the first
// question (asked before the index is full) the same bytes as later questions'?
//
//   npm run ctx-bench [-- --only ost-econ,szeliski] [--qset q3|q2] [--verbose]
//
// Uses the app's own ContextBuilder (src/agent/context/build.ts) on pdf.js's legacy (Node) build.
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { ContextBuilder, DIGEST_WAIT_MS, type ScoutContext } from '../../src/agent/context/build.ts';
import { tierOf } from '../../src/agent/context/tiers.ts';
import { PRICES } from '../../server/prices.ts';
import { Q3_ROWS } from '../eval/q3.ts';
import { Q2_ROWS } from '../eval/q2.ts';
import { deckPath, isFixtureDeck } from '../eval/decks.ts';
import { NEEDS } from './needs.ts';

const argv = process.argv.slice(2);
const opt = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const only = opt('--only')?.split(',');
const qset = opt('--qset');
const verbose = argv.includes('--verbose');
const MAIN = '/Users/arjuns/projects/pdf-tutor';
if (!process.env.PETU_PDF_DIRS) process.env.PETU_PDF_DIRS = [`${homedir()}/Documents/670/contents`, `${MAIN}/public/dev`, `${MAIN}/.petu/corpus`].join(',');

const OPS = pdfjs.OPS as unknown as Record<string, number>;
type Row = { set: string; deck: string; page: number; question: string };
const rows: Row[] = [
  ...(qset && qset !== 'q3' ? [] : Q3_ROWS.map((r) => ({ set: 'q3', deck: r.deck, page: r.page, question: r.question }))),
  ...(qset && qset !== 'q2' ? [] : Q2_ROWS.map((r) => ({ set: 'q2', deck: r.deck, page: r.page, question: r.question }))),
].filter((r) => !only || only.includes(r.deck));

/** Pages with real detail in a block: `pN: …` digest/section lines and `pN · …: …` candidate lines, chars per page. */
function detail(blocks: (string | undefined)[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const b of blocks) for (const l of (b ?? '').split('\n')) {
    const m = /^p(\d+)(?:: | · [^:]*: )(.*)$/.exec(l);
    if (!m) continue;
    const body = m[2].trim();
    if (body === '…' || body === '(no text)' || body === '(not read yet)') continue;
    out.set(Number(m[1]), (out.get(Number(m[1])) ?? 0) + body.length);
  }
  return out;
}
/** A page counts as seen when ≥ 100 chars of it are in the context, or all of its own text (short pages). */
const seen = (d: Map<number, number>, page: number, own: number) => (d.get(page) ?? 0) >= Math.min(100, Math.max(1, own - 5));

const P = PRICES['gpt-6.1-terra'];
const SCOUT_SYSTEM = 1300, STAGE2_SYSTEM = 6400, PAGE_IMAGE = 1100, STAGE2_TAIL = 10000, QUESTION = 120, SCOUT_OUT = 250, STAGE2_OUT = 800;
/** $ per answer: scout + stage 2. Warm: every cacheable block cached. Cold: those blocks written (30m), the system prompts cached. */
function cost(scoutCached: number, scoutTail: number, stage2Doc: number, page: number) {
  const s2Cached = stage2Doc + page + PAGE_IMAGE;
  const warm = (SCOUT_SYSTEM + scoutCached) * P.cached + scoutTail * P.in + SCOUT_OUT * P.out
    + (STAGE2_SYSTEM + s2Cached) * P.cached + STAGE2_TAIL * P.in + STAGE2_OUT * P.out;
  const cold = SCOUT_SYSTEM * P.cached + scoutCached * P.write30m + scoutTail * P.in + SCOUT_OUT * P.out
    + STAGE2_SYSTEM * P.cached + s2Cached * P.write30m + STAGE2_TAIL * P.in + STAGE2_OUT * P.out;
  return { warm: warm / 1e6, cold: cold / 1e6 };
}

type Out = { deck: string; tier: string; pages: number; q: number; needs: number; oldHit: number; newHit: number; tok: Record<string, number[]>; usd: Record<string, number[]>; ms: number[]; stableOld: boolean; stableNew: boolean };
const results: Out[] = [];
const decks = [...new Set(rows.map((r) => r.deck))];
for (const deck of decks) {
  let path: string;
  try { path = deckPath(deck); } catch { console.log(`skip ${deck}: PDF not found`); continue; }
  if (isFixtureDeck(deck) && !existsSync(path)) continue;
  const t0 = performance.now();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)), verbosity: 0, isEvalSupported: false, fontExtraProperties: true }).promise;
  const n = doc.numPages;
  const name = path.replace(/^.*\//, '');
  const b = new ContextBuilder(doc as never, name, { OPS, ctx: 'new' });
  const old = new ContextBuilder(doc as never, name, { OPS, ctx: 'old' });
  const qs = rows.filter((r) => r.deck === deck);
  // First question, asked at once (the index is still filling): the cached blocks as sent.
  const q0 = qs[0];
  const [firstOld, firstNew] = await Promise.all([old.digest(q0.page, q0.question), b.scout(q0.page, q0.question)]);
  const idx = (x: ContextBuilder) => (x as unknown as { index: { fill(): Promise<void>; all(): Map<number, string[]> } }).index;
  await idx(b).fill();
  (old as unknown as { index: unknown }).index = idx(b); // one index for both
  const lines = idx(b).all();
  const own = (p: number) => (lines.get(p) ?? []).join(' ').length;
  const out: Out = { deck, tier: tierOf(n), pages: n, q: qs.length, needs: 0, oldHit: 0, newHit: 0, tok: {}, usd: {}, ms: [], stableOld: true, stableNew: true };
  const later = await b.scout(q0.page, q0.question);
  out.stableNew = later.digest === firstNew.digest && later.section === firstNew.section;
  const oldDigest = await old.digest(q0.page, q0.question);
  out.stableOld = oldDigest === firstOld;
  const push = (k: string, v: number) => { (out.tok[k] ??= []).push(v); };
  const pushUsd = (k: string, v: number) => { (out.usd[k] ??= []).push(v); };
  for (const q of qs) {
    const t1 = performance.now();
    const ctx: ScoutContext = await b.scout(q.page, q.question);
    out.ms.push(performance.now() - t1);
    const vis = ctx.info.tokens.page;
    const needs = [q.page, ...(await resolveNeeds(b, deck, q.page))];
    const dOld = detail([oldDigest]), dNew = detail([ctx.digest, ctx.section, ctx.candidates]);
    dOld.set(q.page, 1e9); dNew.set(q.page, 1e9); // the visible page's listing
    const hitOld = needs.filter((p) => seen(dOld, p, own(p))), hitNew = needs.filter((p) => seen(dNew, p, own(p)));
    out.needs += needs.length; out.oldHit += hitOld.length; out.newHit += hitNew.length;
    const tOld = Math.ceil(oldDigest.length / 3.3);
    push('old digest', tOld);
    for (const [k, v] of Object.entries(ctx.info.tokens)) if (k !== 'page' && k !== 'image') push(`new ${k}`, v);
    push('page', vis);
    const cached = Object.entries(ctx.info.tokens).filter(([k]) => k !== 'candidates').reduce((a, [, v]) => a + v, 0);
    const doc2 = tierOf(n) === 'huge' ? (ctx.info.tokens.map ?? 0) : (ctx.info.tokens['map+digest'] ?? ctx.info.tokens.digest ?? 0);
    const co = cost(tOld + vis, QUESTION, tOld, vis), cn = cost(cached, QUESTION + ctx.info.tokens.candidates, doc2, vis);
    pushUsd('old warm', co.warm); pushUsd('old cold', co.cold + (out.stableOld ? 0 : (tOld * 2 * P.write30m) / 1e6)); pushUsd('new warm', cn.warm); pushUsd('new cold', cn.cold);
    if (verbose || needs.length > 1) console.log(`  ${q.set} ${deck} p${q.page}: needs [${needs.join(' ')}] old [${hitOld.join(' ')}] new [${hitNew.join(' ')}]  cands ${ctx.info.candidates.join(', ')}`);
  }
  console.log(`${deck} ${n}p ${out.tier}: ${Math.round(performance.now() - t0)}ms (index + ${qs.length} questions)`);
  results.push(out);
  b.destroy(); old.destroy();
  await doc.destroy();
}

async function resolveNeeds(b: ContextBuilder, deck: string, page: number): Promise<number[]> {
  const want = NEEDS[`${deck}:${page}`] ?? [];
  const out: number[] = [];
  for (const w of want) {
    if (typeof w === 'number') { out.push(w); continue; }
    const r = b.find([w], []);
    if (r[0]) out.push(r[0].page); else console.log(`  ! ${deck}:${page} need "${w}" did not resolve`);
  }
  return [...new Set(out.filter((p) => p !== page))];
}

const avg = (xs: number[] = []) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '–');
console.log(`\nRecall of needed pages (visible page + the pages the answer needs), old vs new; DIGEST_WAIT_MS ${DIGEST_WAIT_MS}`);
console.log('deck            pages tier    qs needed  old    new    | tokens (avg): old digest → new blocks                         | $/answer warm old→new | cold old→new        | local ms p50/max | cache stable old/new');
for (const r of results) {
  const tk = Object.entries(r.tok).filter(([k]) => k !== 'page').map(([k, v]) => `${k.replace('new ', '')} ${Math.round(avg(v))}`).join(' · ');
  const ms = [...r.ms].sort((a, b) => a - b);
  console.log(`${r.deck.padEnd(15)} ${String(r.pages).padStart(5)} ${r.tier.padEnd(7)} ${String(r.q).padStart(3)} ${String(r.needs).padStart(6)}  ${pct(r.oldHit, r.needs).padStart(5)}  ${pct(r.newHit, r.needs).padStart(5)}  | ${tk.padEnd(62)} | $${avg(r.usd['old warm']).toFixed(4)}→$${avg(r.usd['new warm']).toFixed(4)} | $${avg(r.usd['old cold']).toFixed(4)}→$${avg(r.usd['new cold']).toFixed(4)} | ${Math.round(ms[Math.floor(ms.length / 2)] ?? 0)}/${Math.round(ms.at(-1) ?? 0)} | ${r.stableOld ? 'yes' : 'NO'}/${r.stableNew ? 'yes' : 'NO'}`);
}
for (const tier of ['small', 'medium', 'huge']) {
  const rs = results.filter((r) => r.tier === tier);
  if (!rs.length) continue;
  const nd = rs.reduce((a, r) => a + r.needs, 0), o = rs.reduce((a, r) => a + r.oldHit, 0), nw = rs.reduce((a, r) => a + r.newHit, 0);
  console.log(`tier ${tier.padEnd(6)}: ${rs.length} docs, ${nd} needed pages: old ${pct(o, nd)} → new ${pct(nw, nd)}`);
}
const all = results.reduce((a, r) => ({ n: a.n + r.needs, o: a.o + r.oldHit, w: a.w + r.newHit }), { n: 0, o: 0, w: 0 });
const beyond = results.reduce((a, r) => a + r.needs - r.q, 0);
console.log(`all: ${all.n} needed pages (${beyond} beyond the visible page): old ${pct(all.o, all.n)} → new ${pct(all.w, all.n)}`);
