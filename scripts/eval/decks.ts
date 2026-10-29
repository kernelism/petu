// scripts/eval/decks.ts — the founder's PDFs, read in place (never copied), and the committed synthetic
// decks (public/fixtures, `npm run decks`). Ids are short names.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CORPUS, corpusDir } from '../corpus/sources.ts';

export const DECK_FILES: Record<string, string> = {
  lec02: 'lec02_image_formation',
  lec03: 'lec03_light_shading_color',
  lec04: 'lec04_light_shading_color2',
  lec05: 'lec05_modeling_images',
  lec06: 'lec06_conv',
  lec07: 'lec07_image_alignment',
  lec08: 'lec08_image_alignment_2',
  lec09: 'lec09_optical_flow',
  lec10: 'lec10_alignment_applications',
  hw1: 'hw1',
  hw2: 'hw2',
  'midterm-review': 'midterm-review',
  szeliski: 'Szeliski_CVAABook_2ndEd-2',
};

/** Synthetic decks in other domains (Eval v3), committed under public/fixtures and served by Vite at /fixtures/. */
export const FIXTURE_DECKS: Record<string, string> = {
  econ: 'econ',
  mechanics: 'mechanics',
  bio: 'bio',
};
export const isFixtureDeck = (deck: string): boolean => deck in FIXTURE_DECKS;
/** The hard corpus (q3): openly licensed documents in .petu/corpus, served like the course PDFs at /api/dev-pdf/. */
export const CORPUS_DECKS: Record<string, string> = Object.fromEntries(CORPUS.map((d) => [d.id, d.file]));
export const isCorpusDeck = (deck: string): boolean => deck in CORPUS_DECKS;
/** Every deck a question may name. */
export const knownDeck = (deck: string): boolean => deck in DECK_FILES || isFixtureDeck(deck) || isCorpusDeck(deck);
/** A non-fixture deck's file name (without .pdf). */
const fileOf = (deck: string): string | undefined => DECK_FILES[deck] ?? CORPUS_DECKS[deck];

/** Where the PDFs live: PETU_PDF_DIRS (comma-separated) or the default places (course, dev, corpus). */
export function pdfDirs(root = process.cwd()): string[] {
  const env = process.env.PETU_PDF_DIRS;
  if (env) return env.split(',').map((s) => s.trim()).filter(Boolean);
  return [join(homedir(), 'Documents/670/contents'), join(root, 'public/dev'), corpusDir(root)];
}

export function deckPath(deck: string, dirs = pdfDirs(), root = process.cwd()): string {
  if (isFixtureDeck(deck)) return join(root, 'public/fixtures', `${FIXTURE_DECKS[deck]}.pdf`);
  const file = fileOf(deck);
  if (!file) throw new Error(`unknown deck ${deck}`);
  for (const d of dirs) {
    const p = join(d, `${file}.pdf`);
    if (existsSync(p)) return p;
  }
  throw new Error(`deck ${deck} (${file}.pdf) not found in ${dirs.join(', ')}`);
}

/** The URL path the dev server serves a deck at (Lane S: /api/dev-pdf/<file>.pdf; fixtures: /fixtures/<file>.pdf). */
export const deckUrlPath = (deck: string): string => (isFixtureDeck(deck) ? `/fixtures/${FIXTURE_DECKS[deck]}.pdf` : `/api/dev-pdf/${fileOf(deck)}.pdf`);
/** Deck id from a PDF file name (`lec06_conv.pdf` → `lec06`, `econ.pdf` → `econ`), or null. */
export function deckIdOfFile(file: string): string | null {
  const base = file.replace(/^.*\//, '').replace(/\.pdf$/i, '');
  for (const [id, f] of Object.entries(DECK_FILES)) if (f === base) return id;
  for (const [id, f] of Object.entries(FIXTURE_DECKS)) if (f === base) return id;
  for (const [id, f] of Object.entries(CORPUS_DECKS)) if (f === base) return id;
  return null;
}

/** The local file behind a URL the app opened (`/fixtures/x.pdf`, `/api/dev-pdf/x.pdf`), or null. */
export function pathOfSrc(src: string, dirs = pdfDirs(), root = process.cwd()): string | null {
  const fx = /^\/fixtures\/([^/]+\.pdf)$/i.exec(src);
  if (fx) { const p = join(root, 'public/fixtures', fx[1]); return existsSync(p) ? p : null; }
  const dev = /^\/api\/dev-pdf\/([^/]+\.pdf)$/i.exec(src);
  if (dev) {
    const name = decodeURIComponent(dev[1]);
    for (const d of dirs) { const p = join(d, name); if (existsSync(p)) return p; }
  }
  return null;
}
