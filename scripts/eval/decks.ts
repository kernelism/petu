// scripts/eval/decks.ts — the founder's PDFs, read in place (never copied). Ids are short names.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

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

/** Where the PDFs live: PETU_PDF_DIRS (comma-separated) or the two default places. */
export function pdfDirs(root = process.cwd()): string[] {
  const env = process.env.PETU_PDF_DIRS;
  if (env) return env.split(',').map((s) => s.trim()).filter(Boolean);
  return [join(homedir(), 'Documents/670/contents'), join(root, 'public/dev')];
}

export function deckPath(deck: string, dirs = pdfDirs()): string {
  const file = DECK_FILES[deck];
  if (!file) throw new Error(`unknown deck ${deck}`);
  for (const d of dirs) {
    const p = join(d, `${file}.pdf`);
    if (existsSync(p)) return p;
  }
  throw new Error(`deck ${deck} (${file}.pdf) not found in ${dirs.join(', ')}`);
}

/** The URL path the dev server serves a deck at (Lane S: /api/dev-pdf/<file>.pdf). */
export const deckUrlPath = (deck: string): string => `/api/dev-pdf/${DECK_FILES[deck]}.pdf`;
