// What did the model see? Prints the grounding listing (exactly as sent) for pages of a PDF.
//   node --experimental-strip-types scripts/ground.ts <pdf> <page…>   (pages: 3 5 7-9; default 1)
// Uses the app's own modules with pdf.js's legacy (Node) build. Prints to stdout only.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { groundPage } from '../src/agent/context/build.ts';
import { estimateTokens, formatNeighbour, formatVisible } from '../src/agent/context/format.ts';

const [file, ...args] = process.argv.slice(2);
if (!file) {
  console.error('usage: node --experimental-strip-types scripts/ground.ts <pdf> <page…> [--neighbours]');
  process.exit(1);
}
const neighbours = args.includes('--neighbours');
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0, isEvalSupported: false, fontExtraProperties: true }).promise;
const pages = args.filter((a) => !a.startsWith('--')).flatMap((a) => {
  const m = /^(\d+)-(\d+)$/.exec(a);
  return m ? Array.from({ length: +m[2] - +m[1] + 1 }, (_, i) => +m[1] + i) : [Number(a)];
}).filter((n) => n >= 1 && n <= doc.numPages);
const OPS = pdfjs.OPS as unknown as Record<string, number>;

for (const n of pages.length ? pages : [1]) {
  const t0 = performance.now();
  const g = await groundPage(await doc.getPage(n) as never, OPS);
  const ms = Math.round(performance.now() - t0);
  const text = formatVisible(g);
  console.log(`=== ${basename(file)} p${n}/${doc.numPages}  lines=${g.lines.length} marks=${g.marks.length} ~${estimateTokens(text)} tok  ${ms}ms`);
  console.log(text);
  if (neighbours) {
    for (const p of [n - 1, n + 1, n - 2, n + 2].filter((p) => p >= 1 && p <= doc.numPages)) {
      console.log(formatNeighbour(await groundPage(await doc.getPage(p) as never, OPS), 1500 * 3.3 / 4));
    }
  }
}
await doc.destroy();
