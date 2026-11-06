// scripts/eval/provenance.ts — check (b), inputs (teaching-engine §3.6, as §0 revised it: a number the page or the
// question gives is data; anything else is drawn and noted), measured offline. The live gate sees a calc's
// results, not its source, so the eval reads the wire: each calc's data (its array literals of 3+ numbers) is
// "from the document" when most of its numbers appear in the text of the pages the answer teaches from (the
// scout's, and the page asked on) or in the question, else invented.
// This is the evidence §7 decision 4 needed: how often answers invent. The rule itself is src/calc/provenance.ts,
// which the app runs live to label examples.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { unescapeCalc } from '../../src/svgboard/wire.ts';
import { textNumbers } from '../../src/gate/numbers.ts';
import { dataNumbers, fromDocument, isExample } from '../../src/calc/provenance.ts';
import { pdfDirs } from './decks.ts';

/** Each calc's data: the numbers of its array literals that hold 3 or more numbers. */
export function calcData(wire: string): { id: string; nums: number[]; code: string }[] {
  const srcs = [...wire.matchAll(/\{\{calcsrc\s+id=([A-Za-z]\w*)\s([\s\S]*?)\}\}/g)].map((m) => [m[1], unescapeCalc(m[2])])
    .concat([...wire.matchAll(/<calc\s+id=["']?([A-Za-z]\w*)["']?\s*>([\s\S]*?)<\/calc>/g)].map((m) => [m[1], m[2]]));
  return srcs.map(([id, src]) => ({ id, nums: dataNumbers(src), code: src })).filter((c) => c.nums.length);
}

export { fromDocument, isExample };

/** Each page's numbers, by deck file (pdf.js legacy, read once per deck). */
const cache = new Map<string, number[][]>();
async function pageNumbers(src: string): Promise<number[][] | null> {
  const file = src.split('/').pop()!;
  if (cache.has(file)) return cache.get(file)!;
  const path = [join(process.cwd(), 'public/fixtures', file), ...pdfDirs().map((d) => join(d, file))].find((p) => existsSync(p));
  if (!path) return null;
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { readFileSync } = await import('node:fs');
  const doc = await getDocument({ data: new Uint8Array(readFileSync(path)), verbosity: 0 }).promise;
  const pages: number[][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const t = await (await doc.getPage(p)).getTextContent();
    pages.push(textNumbers((t.items as { str?: string }[]).map((i) => i.str ?? '').join(' ')));
  }
  cache.set(file, pages);
  return pages;
}

/** The numbers the answer's pages hold (the scout's pages, and the page asked on): what it may use as data. */
export async function documentNumbers(src: string, pages: number[]): Promise<Set<number> | null> {
  const all = await pageNumbers(src);
  return all ? new Set(pages.flatMap((p) => all[p - 1] ?? [])) : null;
}
