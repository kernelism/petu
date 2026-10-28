// scripts/corpus/profile.ts — the engine stress profile of the hard corpus ($0, no API calls).
//   node --expose-gc --experimental-strip-types scripts/corpus/profile.ts [--only ost-econ,ax-resnet] [--extra szeliski,lec06] [--sample 10]
// For every document: the text index pass the browser runs (every page's text lines, in order, as
// ContextBuilder's PageIndex does) with timing and memory, the digest the scout reads, the PDF
// outline, the grounding listing (lines + marks) of ~10 sampled pages, two-column and no-text
// pages, and a retrieval proxy (BM25 over the index, queried with the outline's section titles).
// Writes <corpus>/manifest.json and <corpus>/profile.json; prints a summary. Never prints page text.
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { groundPage, textUsable, DIGEST_WAIT_MS } from '../../src/agent/context/build.ts';
import { itemsToRuns } from '../../src/pdf/textRuns.ts';
import { textLines, columnGutter } from '../../src/agent/context/textLines.ts';
import { deckDigest, pageShare, DIGEST_CHARS } from '../../src/agent/context/digest.ts';
import { resolveOutline, type Bookmark } from '../../src/agent/context/outline.ts';
import { rankPages } from '../../src/agent/context/search.ts';
import { estimateTokens, formatVisible } from '../../src/agent/context/format.ts';
import { paintedFromOperatorList } from '../../src/agent/context/operatorList.ts';
import { CORPUS, SKIPPED, corpusDir, corpusPath } from './sources.ts';
import { deckPath } from '../eval/decks.ts';
import { digestPageStats, pct, rankOf, samplePages, sizeHistogram } from './stats.ts';

type TextItem = { str: string; transform: number[]; width: number; height: number };
type OutlineNode = { title: string; items: OutlineNode[] };

const argv = process.argv.slice(2);
const opt = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const only = opt('--only')?.split(',');
const extra = opt('--extra')?.split(',') ?? [];
const SAMPLE = Number(opt('--sample') ?? 10);
const OPS = pdfjs.OPS as unknown as Record<string, number>;
const dir = corpusDir();

type Target = { id: string; path: string; corpus: boolean };
const targets: Target[] = [
  ...CORPUS.filter((d) => !only || only.includes(d.id)).map((d) => ({ id: d.id, path: corpusPath(d), corpus: true })),
  ...extra.map((id) => ({ id, path: deckPath(id), corpus: false })),
];

const mb = (b: number) => Math.round(b / 1e5) / 10;

async function profile(t: Target) {
  const bytes = readFileSync(t.path);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  (globalThis as { gc?: () => void }).gc?.();
  const heap0 = process.memoryUsage().heapUsed;
  const t0 = performance.now();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0, isEvalSupported: false, fontExtraProperties: true }).promise;
  const loadMs = performance.now() - t0;
  const n = doc.numPages;

  // Outline: every node (the raw tree) and what resolveOutline keeps (≤ 120, levels first).
  const o0 = performance.now();
  const raw = ((await doc.getOutline()) ?? []) as OutlineNode[];
  let nodes = 0, depth = 0;
  const walk = (ns: OutlineNode[], d: number) => { for (const x of ns) { nodes++; depth = Math.max(depth, d + 1); walk(x.items ?? [], d + 1); } };
  walk(raw, 0);
  const bookmarks: Bookmark[] = await resolveOutline(doc as never);
  const outlineMs = performance.now() - o0;
  const keptDepth = bookmarks.reduce((m, b) => Math.max(m, (b.depth ?? 0) + 1), 0);
  // Levels first, cut at 120: the deepest kept level may stop part-way through the book.
  const deepest = bookmarks.filter((b) => (b.depth ?? 0) === keptDepth - 1).map((b) => b.page);
  const deepestLastPage = deepest.length ? Math.max(...deepest) : 0;

  // The index pass: what PageIndex.fill does per page (text content → runs → lines), page order.
  const lines = new Map<number, string[]>();
  const perPageMs: number[] = [], charsPer: number[] = [], sizes: string[] = [];
  let unusable = 0, few = 0, twoCol = 0, readBy2500 = 0, indexChars = 0;
  const i0 = performance.now();
  for (let p = 1; p <= n; p++) {
    const s = performance.now();
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    sizes.push(`${Math.round(vp.width)}x${Math.round(vp.height)}`);
    const tc = await page.getTextContent();
    const items = (tc.items as unknown[]).filter((i): i is TextItem => typeof (i as TextItem).str === 'string');
    const u = textUsable(items.map((i) => i.str).join(''));
    if (u.few) few++;
    let ls: ReturnType<typeof textLines> = [];
    if (u.usable) ls = textLines(itemsToRuns(items, vp.transform, vp.width, vp.height), vp.height / vp.width);
    else unusable++;
    if (ls.length && columnGutter(ls) != null) twoCol++;
    const texts = ls.map((l) => l.text);
    lines.set(p, texts);
    const c = texts.reduce((a, l) => a + l.length, 0);
    charsPer.push(c);
    indexChars += c;
    perPageMs.push(performance.now() - s);
    if (performance.now() - i0 <= DIGEST_WAIT_MS) readBy2500 = p;
  }
  const indexMs = performance.now() - i0;
  (globalThis as { gc?: () => void }).gc?.();
  const heapAfterIndex = process.memoryUsage().heapUsed;

  // The digest as the scout gets it once the index is full, and as the first question gets it
  // when only DIGEST_WAIT_MS of indexing has happened (unread pages are `pN: …`).
  const d0 = performance.now();
  const digest = deckDigest(t.id, n, (p) => lines.get(p), n > 80 ? bookmarks : []);
  const digestMs = performance.now() - d0;
  const partial = deckDigest(t.id, n, (p) => (p <= readBy2500 ? lines.get(p) : undefined), n > 80 ? bookmarks : []);
  const dstats = digestPageStats(digest);
  const outlineChars = digest.split('\n').filter((l) => !/^p\d+: /.test(l)).join('\n').length;

  // Retrieval proxy: each bookmark title (sections, not the top level when deeper levels exist) as
  // a query; is its page (±1) in BM25's top 1 / 5 / 10? Plus the query time.
  const qs = bookmarks.filter((b) => keptDepth <= 1 || (b.depth ?? 0) >= 1);
  const ranks: number[] = [], qMs: number[] = [];
  for (const b of qs) {
    const s = performance.now();
    const top = rankPages(lines, b.title, 10).map((r) => r.page);
    qMs.push(performance.now() - s);
    ranks.push(rankOf(top, b.page, 1));
  }
  const hit = (k: number) => (ranks.length ? Math.round((100 * ranks.filter((r) => r > 0 && r <= k).length) / ranks.length) : null);

  // Grounding on sampled pages: exactly what the visible-page listing would be.
  const sample = [];
  for (const p of samplePages(n, SAMPLE)) {
    const s = performance.now();
    const g = await groundPage(await doc.getPage(p) as never, OPS);
    const ms = Math.round(performance.now() - s);
    const text = formatVisible(g);
    // Glyphs drawn as outlines (math typeset to paths): small filled paths, which carry no text.
    const pg = await doc.getPage(p);
    const vp = pg.getViewport({ scale: 1 });
    const { paths } = paintedFromOperatorList(await pg.getOperatorList() as never, OPS, vp.transform, vp.width, vp.height);
    const glyphPaths = paths.filter((q) => q.paint !== 'stroke' && (() => { const xs = q.pts.map((t) => t.x), ys = q.pts.map((t) => t.y); return Math.max(...xs) - Math.min(...xs) < 15 && Math.max(...ys) - Math.min(...ys) < 15; })()).length;
    const kinds: Record<string, number> = {};
    for (const m of g.marks) kinds[m.kind] = (kinds[m.kind] ?? 0) + 1;
    sample.push({
      page: p, ms, paths: paths.length, glyphPaths, lines: g.lines.length, math: g.lines.filter((l) => l.math).length, marks: g.marks.length, kinds,
      noText: g.noText, twoColumn: g.lines.length ? columnGutter(g.lines) != null : false,
      tokens: estimateTokens(text), cut: text.split('\n').includes('…'), opsTimeout: ms >= 3000 && g.marks.length === 0,
    });
  }
  const gc = (globalThis as { gc?: () => void }).gc;
  gc?.();
  const heapEnd = process.memoryUsage().heapUsed;
  await doc.destroy();

  const usableRatio = Math.round((1000 * (n - unusable)) / n) / 1000;
  return {
    id: t.id, corpus: t.corpus, file: t.path.replace(/^.*\//, ''), bytes: bytes.length, sha256, pages: n,
    pageSizes: sizeHistogram(sizes),
    text: { usableRatio, unusable, fewChars: few, twoColumnPages: twoCol, charsPerPage: pct(charsPer), indexChars },
    outline: { nodes, depth, kept: bookmarks.length, keptDepth, deepestLastPage, ms: Math.round(outlineMs) },
    index: { loadMs: Math.round(loadMs), totalMs: Math.round(indexMs), perPageMs: pct(perPageMs.map((x) => Math.round(x))), pagesReadIn2500ms: readBy2500, heapMB: mb(heapAfterIndex - heap0) },
    digest: {
      chars: digest.length, tokens: estimateTokens(digest), budget: DIGEST_CHARS, share: pageShare(n), outlineChars, ms: Math.round(digestMs),
      ...dstats,
      partialAt2500: { chars: partial.length, unread: digestPageStats(partial).unread },
    },
    retrieval: { queries: qs.length, top1: hit(1), top5: hit(5), top10: hit(10), queryMs: pct(qMs.map((x) => Math.round(x * 10) / 10)) },
    sample,
    heapEndMB: mb(heapEnd - heap0),
  };
}

const out: Awaited<ReturnType<typeof profile>>[] = [];
for (const t of targets) {
  process.stderr.write(`${t.id} … `);
  const r = await profile(t);
  process.stderr.write(`${r.pages}p index ${r.index.totalMs}ms\n`);
  out.push(r);
}

const prev = (() => { try { return JSON.parse(readFileSync(`${dir}/profile.json`, 'utf8')) as { docs: typeof out }; } catch { return { docs: [] as typeof out }; } })();
const merged = [...prev.docs.filter((d) => !out.some((o) => o.id === d.id)), ...out];
writeFileSync(`${dir}/profile.json`, JSON.stringify({ at: new Date().toISOString(), node: process.version, docs: merged }, null, 1));

// The manifest: corpus documents only.
const manifest = {
  at: new Date().toISOString(),
  dir,
  totalBytes: 0,
  docs: CORPUS.map((d) => {
    const r = merged.find((x) => x.id === d.id);
    return {
      id: d.id, file: `${d.file}.pdf`, title: d.title, kind: d.kind, sourceUrls: d.urls, licence: d.licence, ...(d.note ? { note: d.note } : {}),
      bytes: (() => { try { return statSync(corpusPath(d)).size; } catch { return null; } })(),
      pages: r?.pages ?? null, textExtractableRatio: r?.text.usableRatio ?? null, sha256: r?.sha256 ?? null,
    };
  }),
  skipped: SKIPPED,
};
manifest.totalBytes = manifest.docs.reduce((a, d) => a + (d.bytes ?? 0), 0);
writeFileSync(`${dir}/manifest.json`, JSON.stringify(manifest, null, 1));

for (const r of out) {
  console.log(`${r.id.padEnd(14)} ${String(r.pages).padStart(5)}p ${String(mb(r.bytes)).padStart(6)}MB text ${r.text.usableRatio} 2col ${r.text.twoColumnPages} | outline ${r.outline.nodes}→${r.outline.kept} (deepest level to p${r.outline.deepestLastPage}) | index ${r.index.totalMs}ms (${r.index.pagesReadIn2500ms}p by 2.5s) heap ${r.index.heapMB}MB | digest ${r.digest.chars}ch ~${r.digest.tokens}tok share ${r.digest.share} avg ${r.digest.avgChars} clipped ${r.digest.clipped} | bm25 top1/5/10 ${r.retrieval.top1}/${r.retrieval.top5}/${r.retrieval.top10} (${r.retrieval.queries}q, p50 ${r.retrieval.queryMs.p50}ms)`);
  console.log(`  sample: ${r.sample.map((s) => `p${s.page}:${s.lines}l/${s.marks}m/${s.glyphPaths}g${s.noText ? '/noText' : ''}${s.twoColumn ? '/2col' : ''}${s.cut ? '/cut' : ''} ${s.ms}ms`).join(' ')}`);
}
