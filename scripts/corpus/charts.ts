// Chart calibration over the fixtures and a sample of corpus pages with plots. No API call.
//   node --experimental-strip-types scripts/corpus/charts.ts                 fixtures (all pages) + the corpus sample
//   node --experimental-strip-types scripts/corpus/charts.ts --scan <pdf> [from-to]   pages with charts / plot-like pages
//   node --experimental-strip-types scripts/corpus/charts.ts --render <pdf> <page>    PNG with a dot at every tick label's
//        calibrated position (and the plot box), in .petu/charts/ — check by eye that dots sit on the ticks
//   add --why to print the detector's trace per page.
// The corpus lives in PETU_CORPUS_DIR (default ~/petu-local/petu/corpus, else .petu/corpus). Renders use pdftoppm.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { deflateSync, crc32 } from 'node:zlib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { groundPage } from '../../src/agent/context/build.ts';
import { paintedFromOperatorList } from '../../src/agent/context/operatorList.ts';
import { chartToPage, chartTrace, formatCharts, parseTick, type Chart } from '../../src/agent/context/charts.ts';
import type { PageGround } from '../../src/agent/context/types.ts';

const OPS = pdfjs.OPS as unknown as Record<string, number>;
const local = join(homedir(), 'petu-local/petu/corpus');
const CORPUS = process.env.PETU_CORPUS_DIR ?? (existsSync(local) ? local : '.petu/corpus');
const args = process.argv.slice(2);
const why = args.includes('--why');

/**
 * Corpus pages that show at least one chart with numeric axes (picked by --scan and checked by eye).
 * `n`: charts with numbered axes visible on the page (what a reader would call calibratable).
 */
const SAMPLE: { file: string; pages: Record<number, number> }[] = [
  // matplotlib frames; p15: histograms without y labels (not calibratable)
  { file: 'arxiv-2107.07511', pages: { 15: 0, 21: 2, 24: 2, 42: 2, 43: 1 } },
  // MATLAB-style frames with dashed gridlines, small subplots
  { file: 'arxiv-1512.03385', pages: { 1: 2, 5: 2, 8: 5 } },
  // ggplot2 panels; p12: a categorical bar chart (one numeric axis); p17: the second facet has no y labels
  { file: 'arxiv-1505.02710', pages: { 12: 0, 15: 1, 17: 1, 20: 1, 21: 1 } },
  // eight panels whose labels are glyph outlines (not in the text layer)
  { file: 'arxiv-1602.03837', pages: { 2: 0 } },
  // raster figures (axes and labels inside the image); econ p67/68: tables with rules and numbers
  { file: 'openstax-introductory-statistics-2e', pages: { 26: 0, 84: 0 } },
  { file: 'openstax-principles-economics-3e', pages: { 67: 0, 68: 0 } },
];

async function open(file: string) {
  return pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0, isEvalSupported: false, fontExtraProperties: true }).promise;
}
async function ground(doc: Awaited<ReturnType<typeof open>>, n: number): Promise<{ g: PageGround; trace?: string[] }> {
  const page = await doc.getPage(n);
  const g = await groundPage(page as never, OPS);
  if (!why) return { g };
  const vp = page.getViewport({ scale: 1 });
  const { paths } = paintedFromOperatorList(await page.getOperatorList() as never, OPS, vp.transform as number[], vp.width, vp.height);
  return { g, trace: chartTrace(paths, g.lines, g.aspect).trace };
}
const show = (name: string, n: number, g: PageGround, trace?: string[]) => {
  const cs = g.charts ?? [];
  if (cs.length || trace?.length) console.log(`${name} p${n}: ${cs.length ? `\n  ${formatCharts(cs).replace(/\n/g, '\n  ')}` : 'none'}`);
  if (trace) for (const t of trace) console.log(`    · ${t}`);
};

/** Expected calibratable charts per fixture page (from scripts/make-decks.ts: axes() with ticks). */
const FIXTURES: Record<string, Record<number, number>> = {
  econ: { 2: 1, 4: 1, 5: 1, 6: 1, 7: 1, 9: 1, 10: 2, 11: 1, 12: 1 },
  mechanics: { 2: 1, 3: 1, 5: 1, 6: 1, 9: 1, 12: 1 },
  bio: { 3: 1, 4: 1 },
};

async function main() {
  if (args[0] === '--scan') return scan(args[1], args[2]);
  if (args[0] === '--render') return render(args[1], Number(args[2]));
  let exp = 0, got = 0, extra = 0;
  for (const [deck, want] of Object.entries(FIXTURES)) {
    const doc = await open(`public/fixtures/${deck}.pdf`);
    for (let n = 1; n <= doc.numPages; n++) {
      const { g, trace } = await ground(doc, n);
      show(deck, n, g, trace);
      const k = g.charts?.length ?? 0, w = want[n] ?? 0;
      exp += w; got += Math.min(k, w); extra += Math.max(0, k - w);
    }
    await doc.destroy();
  }
  console.log(`\nfixtures: ${got}/${exp} charts calibrated, ${extra} unexpected`);
  let pages = 0, cexp = 0, cgot = 0, cextra = 0;
  for (const s of SAMPLE) {
    const f = join(CORPUS, `${s.file}.pdf`);
    if (!existsSync(f)) { console.log(`(missing ${f})`); continue; }
    const doc = await open(f);
    for (const [p, w] of Object.entries(s.pages)) {
      const { g, trace } = await ground(doc, Number(p));
      console.log(`${s.file} p${p} (expect ${w}): ${g.charts?.length ? `\n  ${formatCharts(g.charts).replace(/\n/g, '\n  ')}` : 'none'}`);
      if (trace) for (const t of trace) console.log(`    · ${t}`);
      pages++; cexp += w; cgot += Math.min(g.charts?.length ?? 0, w); cextra += Math.max(0, (g.charts?.length ?? 0) - w);
    }
    await doc.destroy();
  }
  if (pages) console.log(`corpus sample: ${pages} pages, ${cgot}/${cexp} charts calibrated, ${cextra} beyond the expected count (check renders)`);
}

/** Pages with charts, and plot-like pages without (a "Figure" caption, long strokes, ≥ 6 numbers). */
async function scan(file: string, range?: string) {
  const doc = await open(file);
  const [a, b] = range ? range.split('-').map(Number) : [1, doc.numPages];
  for (let n = a; n <= Math.min(b, doc.numPages); n++) {
    const { g, trace } = await ground(doc, n);
    const nums = g.lines.filter((l) => parseTick(l.text)).length;
    const fig = g.lines.some((l) => /^(Figure|Fig\.)\s*\d/.test(l.text));
    const figMarks = g.marks.filter((m) => m.kind === 'figure' || m.kind === 'arrow' || m.kind === 'line').length;
    if (g.charts?.length) show(basename(file), n, g, trace);
    else if (fig && nums >= 6 && figMarks >= 1) console.log(`${basename(file)} p${n}: plot-like, no chart (numbers ${nums}, marks ${figMarks})${trace ? '\n    · ' + trace.join('\n    · ') : ''}`);
  }
}

/** pdftoppm → PPM, dots at each tick label's calibrated position (red) and the plot box corners (blue) → PNG. */
async function render(file: string, n: number) {
  const doc = await open(file);
  const { g } = await ground(doc, n);
  const out = '.petu/charts';
  mkdirSync(out, { recursive: true });
  const base = join(out, `${basename(file, '.pdf')}-p${n}`);
  // Zoomed onto the charts (--full: the whole page at 110 dpi).
  const cs = g.charts ?? [];
  const full = args.includes('--full') || !cs.length;
  const vp = (await doc.getPage(n)).getViewport({ scale: 1 });
  const dpi = full ? 110 : 300, k = dpi / 72;
  const PW = Math.round(vp.width * k), PH = Math.round(vp.height * k);
  const m = 60;
  const bx0 = full ? 0 : Math.max(0, Math.min(...cs.map((c) => c.rect.x)) - m), by0 = full ? 0 : Math.max(0, Math.min(...cs.map((c) => c.rect.y)) - m);
  const bx1 = full ? 1000 : Math.min(1000, Math.max(...cs.map((c) => c.rect.x + c.rect.w)) + m), by1 = full ? 1000 : Math.min(1000, Math.max(...cs.map((c) => c.rect.y + c.rect.h)) + m);
  const ox = Math.round((bx0 / 1000) * PW), oy = Math.round((by0 / 1000) * PH);
  const crop = full ? [] : ['-x', String(ox), '-y', String(oy), '-W', String(Math.round(((bx1 - bx0) / 1000) * PW)), '-H', String(Math.round(((by1 - by0) / 1000) * PH))];
  execFileSync('pdftoppm', ['-f', String(n), '-l', String(n), '-r', String(dpi), ...crop, '-singlefile', file, base]);
  const ppm = readFileSync(`${base}.ppm`);
  const head = /^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(ppm.subarray(0, 40).toString('latin1'))!;
  const W = +head[1], H = +head[2], px = ppm.subarray(head[0].length);
  const dot = (x: number, y: number, rgb: [number, number, number], r = 3) => {
    const X = Math.round((x / 1000) * PW) - ox, Y = Math.round((y / 1000) * PH) - oy;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r || X + dx < 0 || Y + dy < 0 || X + dx >= W || Y + dy >= H) continue;
      const i = ((Y + dy) * W + X + dx) * 3;
      px[i] = rgb[0]; px[i + 1] = rgb[1]; px[i + 2] = rgb[2];
    }
  };
  for (const c of (g.charts ?? []) as Chart[]) {
    const { rect: r } = c;
    for (const [x, y] of [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]]) dot(x, y, [0, 90, 255], 4);
    // Every "nice" value between lo and hi along each axis, at the other axis's lo.
    // Round values between lo and hi (log: every decade), which should land on the page's own ticks.
    const vals = (a: Chart['x']) => {
      if (a.log) return Array.from({ length: Math.floor(Math.log10(a.hi / a.lo) + 1e-9) + 1 }, (_, i) => a.lo * 10 ** i);
      const raw = (a.hi - a.lo) / 6, mag = 10 ** Math.floor(Math.log10(raw));
      const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw)!;
      const out: number[] = [];
      for (let v = Math.ceil(a.lo / step - 1e-9) * step; v <= a.hi + 1e-9; v += step) out.push(v);
      return out;
    };
    for (const v of vals(c.x)) { const p = chartToPage(c, { x: v, y: c.y.lo }); if (p) dot(p.x, p.y, [230, 0, 0]); }
    for (const v of vals(c.y)) { const p = chartToPage(c, { x: c.x.lo, y: v }); if (p) dot(p.x, p.y, [230, 0, 0]); }
    const m = chartToPage(c, { x: (c.x.lo + c.x.hi) / 2, y: (c.y.lo + c.y.hi) / 2 });
    if (m && !c.x.log && !c.y.log) dot(m.x, m.y, [0, 170, 0], 5);
  }
  writeFileSync(`${base}.png`, png(W, H, px));
  console.log(`${base}.png\n${formatCharts(g.charts ?? []) || '(no charts)'}`);
  await doc.destroy();
}

function png(w: number, h: number, rgb: Buffer): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

await main();
