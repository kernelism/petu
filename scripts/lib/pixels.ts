// scripts/lib/pixels.ts — the app's page-image reader (src/pixels/page.ts) under node, for replays of recorded answers.
import { readFileSync } from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pagePixels } from '../../src/pixels/page.ts';
import type { PixelSource } from '../../src/pixels/stream.ts';
import { pathOfSrc } from '../eval/decks.ts';

const docs = new Map<string, Promise<pdfjs.PDFDocumentProxy>>();

/** Reads page images from the PDF a recorded answer was asked on (`src` as the app opened it, `page` its page). */
export function nodePixels(src: string | undefined, page: number | undefined): PixelSource {
  return async (mark, cols, pg) => {
    const file = src ? pathOfSrc(src) : null;
    if (!file) throw new Error(`the PDF ${src ?? '(none)'} is not on this machine`);
    const at = pg ?? page;
    if (!at) throw new Error('no page to read the image from');
    if (!docs.has(file)) docs.set(file, pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0, isEvalSupported: false }).promise);
    const doc = await docs.get(file)!;
    return pagePixels((await doc.getPage(at)) as never, pdfjs.OPS as unknown as Record<string, number>, mark, cols);
  };
}
