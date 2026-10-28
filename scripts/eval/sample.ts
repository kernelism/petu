// scripts/eval/sample.ts — seeded page sampler for the eval question set.
//   node --experimental-strip-types scripts/eval/sample.ts --seed 670 --n 7 --decks lec02,lec05 [--split dev]
// Prints the picks as JSON. Pages are read in place; nothing is copied. Page renders (png) and
// listings (txt) are written by the runner's `pages` step, not here.
import { DECK_FILES, deckPath } from './decks.ts';

/** mulberry32: small, fast, seedable. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pages that never enter the eval: the few-shot topic (epipolar), a copy of it, and the fixture. */
export const EXCLUDED: ReadonlySet<string> = new Set([
  'lec09:40', 'lec09:41', 'lec09:42', 'lec10:12', 'lec10:14',
]);
export const pageKey = (deck: string, page: number): string => `${deck}:${page}`;

export type DeckPages = { deck: string; eligible: number[] };
export type Pick = { deck: string; page: number };

/**
 * Picks `n` distinct pages. Deck first (uniform, each deck once before any repeats), then a page
 * uniformly among that deck's eligible pages, so a 1,232-page book can't swamp the slide decks.
 * `exclude` (keys "deck:page") removes pages, e.g. the hand-picked ones.
 */
export function pickPages(opts: { seed: number; n: number; decks: DeckPages[]; exclude?: Iterable<string> }): Pick[] {
  const rnd = mulberry32(opts.seed);
  const banned = new Set<string>([...EXCLUDED, ...(opts.exclude ?? [])]);
  const pools = opts.decks
    .map((d) => ({ deck: d.deck, pages: d.eligible.filter((p) => !banned.has(pageKey(d.deck, p))) }))
    .filter((d) => d.pages.length > 0);
  const out: Pick[] = [];
  let round: typeof pools = [];
  while (out.length < opts.n && pools.some((p) => p.pages.length > 0)) {
    if (round.length === 0) {
      round = pools.filter((p) => p.pages.length > 0);
      for (let i = round.length - 1; i > 0; i--) { // shuffle the round
        const j = Math.floor(rnd() * (i + 1));
        [round[i], round[j]] = [round[j], round[i]];
      }
    }
    const d = round.pop()!;
    if (d.pages.length === 0) continue;
    const k = Math.floor(rnd() * d.pages.length);
    out.push({ deck: d.deck, page: d.pages.splice(k, 1)[0] });
  }
  return out;
}

/** Eligible = at least 40 characters of text (marks need the grounding listing; see report). */
export const MIN_TEXT_CHARS = 40;
export const isEligible = (textChars: number, marks = 0): boolean => textChars >= MIN_TEXT_CHARS || marks >= 1;

/** Text length per page of a PDF, read in place through pdf.js (legacy build, no canvas). */
export async function pageTextChars(path: string): Promise<number[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { readFileSync } = await import('node:fs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)), useSystemFonts: true, verbosity: 0 }).promise;
  const out: number[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    out.push(tc.items.map((it) => ('str' in it ? it.str : '')).join(' ').replace(/\s+/g, ' ').trim().length);
  }
  await doc.destroy();
  return out;
}

export async function eligibleOf(deck: string): Promise<DeckPages> {
  const chars = await pageTextChars(deckPath(deck));
  return { deck, eligible: chars.flatMap((c, i) => (isEligible(c) ? [i + 1] : [])) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
  const seed = Number(arg('seed', '670'));
  const n = Number(arg('n', '7'));
  const decks = (arg('decks') ?? Object.keys(DECK_FILES).join(',')).split(',');
  const exclude = (arg('exclude') ?? '').split(',').filter(Boolean);
  const pools = await Promise.all(decks.map(eligibleOf));
  console.log(JSON.stringify(pickPages({ seed, n, decks: pools, exclude }), null, 1));
}
