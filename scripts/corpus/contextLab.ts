// scripts/corpus/contextLab.ts — measurements behind the huge-PDF context design
// (docs/superpowers/specs/2026-10-28-huge-pdf-context.md). $0, no API calls. Prints numbers only.
//   node --experimental-strip-types scripts/corpus/contextLab.ts [--only ost-econ]
// Per document: the size of a full document map (every bookmark with its page range, or detected
// headings when there are none), the caption/label index (Figure 8.12, Table 1, Example 11.1,
// equation numbers), and, over the q3 questions, how often each candidate source reaches the visible
// page and the pages the question needs (the question writer's own notes on what each needs).
import { readFileSync } from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { textUsable } from '../../src/agent/context/build.ts';
import { itemsToRuns } from '../../src/pdf/textRuns.ts';
import { textLines } from '../../src/agent/context/textLines.ts';
import { boilerplate } from '../../src/agent/context/digest.ts';
import { rankPages } from '../../src/agent/context/search.ts';
import { CORPUS, corpusPath } from './sources.ts';
import { Q3_ROWS } from '../eval/q3.ts';
import { deckPath } from '../eval/decks.ts';

type TextItem = { str: string; transform: number[]; width: number; height: number };
type Node = { title: string; dest: unknown; items: Node[] };
type MapEntry = { title: string; depth: number; from: number; to: number };

const argv = process.argv.slice(2);
const only = (() => { const i = argv.indexOf('--only'); return i >= 0 ? argv[i + 1].split(',') : null; })();
const tok = (chars: number) => Math.round(chars / 3.3);

/**
 * Pages the q3 writer said a question needs besides its own page (from its hand-back notes), as
 * page numbers or labels resolved through the document's own index.
 */
const NEEDS: Record<string, (number | string)[]> = {
  'ost-physics:748': [749], 'ost-econ:128': [129], 'ost-stats:477': ['section 9.2'], 'ax-attention:6': [7],
  'ax-conformal:6': ['appendix d'], 'ax-conformal:15': [14], 'ax-ricci:9': [8], 'ax-kallisto:3': [11],
};

const LABEL = /^(figure|fig\.|table|example|theorem|lemma|definition|proposition|corollary|algorithm|appendix|section|chapter)\s*([a-z]?\d+(?:\.\d+)*|[a-z])\b/i;
const EQNUM = /^\(?(\d+\.\d+|\d+)\)$/;
const HEADING = /^((\d+(\.\d+){0,3})\.?|[IVX]+\.|Appendix [A-Z]|[A-Z]\.)\s+\p{Lu}[^.!?]{2,70}$/u;

const spans = (es: MapEntry[]) => { const xs = es.map((e) => e.to - e.from + 1).sort((a, b) => a - b); return xs.length ? `${xs[Math.floor(xs.length / 2)]}/${xs[xs.length - 1]}` : '–'; };

async function lab(id: string, path: string) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)), verbosity: 0, isEvalSupported: false }).promise;
  const n = doc.numPages;
  const lines = new Map<number, string[]>();
  for (let p = 1; p <= n; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = (tc.items as unknown[]).filter((i): i is TextItem => typeof (i as TextItem).str === 'string');
    lines.set(p, textUsable(items.map((i) => i.str).join('')).usable ? textLines(itemsToRuns(items, vp.transform, vp.width, vp.height), vp.height / vp.width).map((l) => l.text) : []);
  }

  // The full document map: every bookmark (all levels), with its page range.
  const flat: { title: string; depth: number; page: number }[] = [];
  const walk = async (ns: Node[], depth: number) => {
    for (const x of ns) {
      try {
        const dest = typeof x.dest === 'string' ? await doc.getDestination(x.dest) : x.dest as unknown[];
        const ref = dest?.[0];
        const idx = typeof ref === 'number' ? ref : ref && typeof ref === 'object' ? await doc.getPageIndex(ref as never) : -1;
        if (idx >= 0) flat.push({ title: x.title.replace(/\s+/g, ' ').trim(), depth, page: idx + 1 });
      } catch { /* unresolvable */ }
      await walk(x.items ?? [], depth + 1);
    }
  };
  await walk(((await doc.getOutline()) ?? []) as Node[], 0);
  flat.sort((a, b) => a.page - b.page || a.depth - b.depth);
  const map: MapEntry[] = flat.map((e, i) => {
    const next = flat.slice(i + 1).find((f) => f.depth <= e.depth);
    return { title: e.title, depth: e.depth, from: e.page, to: next ? Math.max(e.page, next.page - 1) : n };
  });
  const mapText = map.map((e) => `${'  '.repeat(Math.min(e.depth, 3))}${e.title} p${e.from}${e.to > e.from ? `–${e.to}` : ''}`).join('\n');

  // Without bookmarks: detected headings (numbered, short, sentence-case lines), first per page.
  const skip = boilerplate(n, (p) => lines.get(p));
  const headings: { title: string; page: number }[] = [];
  for (let p = 1; p <= n; p++) for (const l of lines.get(p) ?? []) if (!skip.has(l) && HEADING.test(l.trim())) headings.push({ title: l.trim(), page: p });
  const headText = headings.map((h) => `${h.title} p${h.page}`).join('\n');

  // Label index: captions and numbered things → the page where the label starts a line.
  const labels = new Map<string, number>();
  for (let p = 1; p <= n; p++) for (const l of lines.get(p) ?? []) {
    const m = LABEL.exec(l.trim());
    if (m) { const k = `${m[1].toLowerCase().replace('fig.', 'figure')} ${m[2].toLowerCase()}`; if (!labels.has(k)) labels.set(k, p); }
    const e = EQNUM.exec(l.trim());
    if (e && !labels.has(`eq ${e[1]}`)) labels.set(`eq ${e[1]}`, p);
  }
  for (const e of map) { const m = /^(?:(\d+(?:\.\d+)*)\s|(?:appendix\s+)?([A-Z])\s+\p{Lu})/iu.exec(e.title); if (m) { const k = m[1] ? `section ${m[1]}` : `appendix ${m[2].toLowerCase()}`; if (!labels.has(k)) labels.set(k, e.from); } }
  for (const h of headings) { const m = /^(\d+(?:\.\d+)*)\.?\s/.exec(h.title); if (m && !labels.has(`section ${m[1]}`)) labels.set(`section ${m[1]}`, h.page); }

  // Questions on this document.
  const qs = Q3_ROWS.filter((r) => r.deck === id).map((r) => {
    const refs = [...r.question.matchAll(/\b(fig(?:ure)?\.?|table|example|eq(?:uation)?\.?|theorem|section|appendix|chapter)\s*\(?([a-z]?\d+(?:\.\d+)*[a-z]?|[a-z]\b)\)?/gi)]
      .map((m) => `${m[1].toLowerCase().replace(/^fig(ure)?\.?$/, 'figure').replace(/^eq(uation)?\.?$/, 'eq')} ${m[2].toLowerCase().replace(/[a-z]$/, (c) => (/^\d/.test(m[2]) ? '' : c))}`);
    const refPages = refs.map((k) => labels.get(k)).filter((p): p is number => p != null);
    const bm = rankPages(lines, r.question, n).map((x) => x.page);
    const rank = bm.indexOf(r.page) + 1;
    const needs = (NEEDS[`${id}:${r.page}`] ?? []).map((x) => (typeof x === 'number' ? x : labels.get(x))).filter((p): p is number => p != null);
    const near = new Set([r.page - 2, r.page - 1, r.page + 1, r.page + 2]);
    const top = (k: number) => new Set(bm.filter((p) => Math.abs(p - r.page) > 2).slice(0, k));
    const inSection = (() => { const s = map.filter((e) => e.from <= r.page && e.to >= r.page).sort((a, b) => b.depth - a.depth)[0]; return s ? { title: s.title, from: s.from, to: s.to } : null; })();
    return {
      page: r.page, kind: r.kind, refs, refPages, visibleRank: rank,
      needs: needs.map((p) => ({ page: p, neighbour: near.has(p), bm25top5: top(5).has(p), bm25top10: top(10).has(p), label: refPages.includes(p), section: !!inSection && p >= inSection.from && p <= inSection.to })),
      section: inSection ? `${inSection.title} (p${inSection.from}–${inSection.to})` : null,
    };
  });
  await doc.destroy();
  return {
    id, pages: n,
    map: { entries: map.length, chars: mapText.length, tokens: tok(mapText.length), maxDepth: map.reduce((m, e) => Math.max(m, e.depth + 1), 0),
      /** Top-level (chapter) and second-level (section) lengths in pages: p50 / max. */
      chapter: spans(map.filter((e) => e.depth === 0)), section: spans(map.filter((e) => e.depth === 1)) },
    headings: { found: headings.length, chars: headText.length, tokens: tok(headText.length) },
    labels: labels.size,
    questions: qs,
  };
}

const targets = [
  ...CORPUS.filter((d) => !only || only.includes(d.id)).map((d) => ({ id: d.id, path: corpusPath(d) })),
  ...(!only || only.includes('szeliski') ? [{ id: 'szeliski', path: deckPath('szeliski') }] : []),
];
for (const t of targets) {
  const r = await lab(t.id, t.path);
  console.log(`${r.id.padEnd(13)} ${String(r.pages).padStart(5)}p  map ${r.map.entries} entries ~${r.map.tokens} tok (depth ${r.map.maxDepth}; chapter p50/max ${r.map.chapter} pages, section ${r.map.section})  headings ${r.headings.found} ~${r.headings.tokens} tok  labels ${r.labels}`);
  for (const q of r.questions) {
    console.log(`   p${q.page} ${q.kind.padEnd(13)} visible-page bm25 rank ${q.visibleRank || '–'}  refs [${q.refs.join(', ')}]→[${q.refPages.join(', ')}]  ${q.section ?? ''}`);
    for (const nd of q.needs) console.log(`      needs p${nd.page}: neighbour ${nd.neighbour} · bm25 top5 ${nd.bm25top5} top10 ${nd.bm25top10} · label ${nd.label} · same section ${nd.section}`);
  }
}
