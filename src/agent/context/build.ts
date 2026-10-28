// src/agent/context/build.ts — assembles what the model reads for a question, and the handles the
// director resolves (both from one PageGround per page: what the model sees is what it can hit).
// Value imports carry `.ts` so scripts/ground.ts can run these modules under plain Node.
import type { PDFPageProxy } from 'pdfjs-dist';
import type { PdfDoc } from '../../pdf/loadPdf';
import type { AskContext } from '../protocol';
import type { StudentStroke } from '../../ink/student/store';
import type { PageGround } from './types';
import { itemsToRuns } from '../../pdf/textRuns.ts';
import { textLines } from './textLines.ts';
import { figureMarks } from './marks.ts';
import { paintedFromOperatorList } from './operatorList.ts';
import { formatNeighbour, formatVisible } from './format.ts';
import { docHeader, resolveOutline, type Bookmark } from './outline.ts';
import { PageIndex } from './search.ts';
import { inkSummary } from './ink.ts';
import { inkCrop, renderPage, type Jpeg } from './image.ts';

type Styles = Record<string, { fontFamily?: string }>;
type TextItem = { str: string; transform: number[]; width: number; height: number; fontName?: string };

/** Text with < 3 real characters, or > 30% U+FFFD / private-use glyphs (broken ToUnicode). */
export function textUsable(chars: string): { usable: boolean; few: boolean } {
  const cs = Array.from(chars.replace(/\s+/g, ''));
  const bad = cs.filter((c) => c === '�' || /[-]/.test(c) || /\p{Co}/u.test(c)).length;
  return { usable: cs.length >= 3 && bad <= 0.3 * cs.length, few: cs.length < 3 };
}

/**
 * One page's ground: text lines and figure marks in model coords. `OPS` is pdf.js's OPS table
 * (passed in so this runs with the browser build and with Node's legacy build alike).
 */
export async function groundPage(page: PDFPageProxy, OPS: Record<string, number>): Promise<PageGround> {
  const vp = page.getViewport({ scale: 1 });
  const aspect = vp.height / vp.width;
  const tc = await page.getTextContent();
  const items = (tc.items as unknown[]).filter((i): i is TextItem => typeof (i as TextItem).str === 'string');
  const runs = itemsToRuns(items, vp.transform, vp.width, vp.height, tc.styles as Styles);
  const text = textUsable(items.map((i) => i.str).join(''));
  const ol = await page.getOperatorList();
  const { paths, images } = paintedFromOperatorList(ol as unknown as { fnArray: number[]; argsArray: unknown[][] }, OPS, vp.transform, vp.width, vp.height);
  const largeImage = images.some((im) => im.rect.w * im.rect.h > 0.25e6);
  // Few characters on a page that paints a scan or outlined glyphs, or a broken text layer.
  const noText = (text.few && (largeImage || paths.length >= 20)) || (!text.few && !text.usable);
  const lines = noText ? [] : textLines(runs, aspect);
  return { page: page.pageNumber, aspect, lines, marks: figureMarks(paths, images, lines, aspect), noText };
}

/** A page's text lines only (the search index and outline first lines). */
async function pageLines(page: PDFPageProxy): Promise<string[]> {
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const items = (tc.items as unknown[]).filter((i): i is TextItem => typeof (i as TextItem).str === 'string');
  if (!textUsable(items.map((i) => i.str).join('')).usable) return [];
  return textLines(itemsToRuns(items, vp.transform, vp.width, vp.height), vp.height / vp.width).map((l) => l.text);
}

const NEIGHBOURS = 2;
const NEIGHBOUR_TOKENS = 1500;
const CHARS_PER_TOKEN = 3.3;
const LRU = 10;
const CANVASES = 2;
const WARM_DELAY = 600;

type Entry = {
  ground: Promise<PageGround>;
  image?: Promise<{ jpeg: Jpeg; canvas: OffscreenCanvas | HTMLCanvasElement | null }>;
  pixels?: boolean; // image still holds its canvas (for the ink crop)
};

export class ContextBuilder {
  private doc: PdfDoc;
  private name: string;
  private cache = new Map<number, Entry>(); // insertion order = LRU order
  private index: PageIndex;
  private bookmarks: Promise<Bookmark[]> | null = null;
  private ops: Promise<Record<string, number>> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private dead = false;

  constructor(doc: PdfDoc, name: string, opts: { OPS?: Record<string, number> } = {}) {
    this.doc = doc;
    this.name = name;
    if (opts.OPS) this.ops = Promise.resolve(opts.OPS);
    // The index reads text only (no operator list) and never touches the page LRU.
    this.index = new PageIndex(doc.numPages, async (p) => {
      if (this.dead) return [];
      const cached = this.cache.get(p);
      if (cached) return (await cached.ground).lines.map((l) => l.text);
      return pageLines(await this.doc.getPage(p));
    });
  }

  /** On scroll idle (600ms after the last call): grounds and renders `page`, text for p±2. */
  warm(page: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (this.dead) return;
      this.warmNow(page).catch(() => undefined);
    }, WARM_DELAY);
  }

  /** On Enter: everything for the question. ≤ 5ms when warm; otherwise awaits the missing pieces. */
  async build(page: number, question: string, ink: StudentStroke[]): Promise<{ context: AskContext; grounds: PageGround[] }> {
    const { context, grounds } = await this.assemble(page);
    const sent = new Set(grounds.map((g) => g.page));
    const searchText = this.index.searchText(question, 3, sent);
    const visible = grounds[0];
    const summary = inkSummary(ink, visible);
    let inkPart: AskContext['ink'];
    if (summary) {
      let crop: Jpeg | undefined;
      try {
        const img = await this.entry(page, true).image!;
        if (img.canvas) crop = await inkCrop(img.canvas, ink.filter((s) => s.page === page), visible.aspect);
      } catch { /* the summary alone still helps */ }
      inkPart = { summary, ...(crop ? { crop } : {}) };
    }
    return { context: { ...context, ...(searchText ? { searchText } : {}), ...(inkPart ? { ink: inkPart } : {}) }, grounds };
  }

  /** For prewarm: the same context without question-specific parts (no search, no ink). */
  async pagePrefix(page: number): Promise<AskContext> {
    return (await this.assemble(page)).context;
  }

  destroy(): void {
    this.dead = true;
    clearTimeout(this.timer);
    this.index.stop();
    this.cache.clear();
  }

  private async warmNow(page: number) {
    const ps = this.window(page);
    this.entry(page, true);
    await Promise.all(ps.map((p) => this.entry(p, false).ground));
    void this.outline();
    void this.index.fill();
  }

  /** The visible page first, then neighbours nearest first (the earlier page wins a tie). */
  private window(page: number): number[] {
    const out = [page];
    for (let k = 1; k <= NEIGHBOURS; k++) for (const p of [page - k, page + k]) if (p >= 1 && p <= this.doc.numPages) out.push(p);
    return out;
  }

  private async assemble(page: number): Promise<{ context: AskContext; grounds: PageGround[] }> {
    const ps = this.window(page);
    const img = this.entry(page, true).image!;
    const [grounds, image, bookmarks] = await Promise.all([Promise.all(ps.map((p) => this.entry(p, false).ground)), img, this.outline()]);
    for (const g of grounds) if (!this.index.has(g.page)) this.index.set(g.page, g.lines.map((l) => l.text));
    void this.index.fill();
    const blocks = [formatVisible(grounds[0])];
    let budget = NEIGHBOUR_TOKENS * CHARS_PER_TOKEN;
    grounds.slice(1).forEach((g, i, rest) => {
      const share = budget / (rest.length - i);
      const s = formatNeighbour(g, share);
      blocks.push(s);
      budget -= s.length + 1;
    });
    const context: AskContext = {
      docName: this.name,
      docHash: this.doc.fingerprints?.[0] ?? this.name,
      numPages: this.doc.numPages,
      page,
      docText: docHeader(this.name, this.doc.numPages, page, this.index.firstLines(), bookmarks),
      pageText: blocks.join('\n'),
      image: image.jpeg,
    };
    return { context, grounds };
  }

  private outline(): Promise<Bookmark[]> {
    if (this.doc.numPages <= 80) return Promise.resolve([]);
    return (this.bookmarks ??= resolveOutline(this.doc as never).catch(() => []));
  }

  private opsTable(): Promise<Record<string, number>> {
    return (this.ops ??= import('pdfjs-dist').then((m) => m.OPS as unknown as Record<string, number>));
  }

  /** The cached entry for `page` (LRU of 10), creating its ground and, if asked, its image. */
  private entry(page: number, withImage: boolean): Entry {
    let e = this.cache.get(page);
    if (e) { this.cache.delete(page); this.cache.set(page, e); }
    else {
      const pp = this.doc.getPage(page);
      const ground = Promise.all([pp, this.opsTable()]).then(([p, OPS]) => groundPage(p, OPS));
      e = { ground };
      this.cache.set(page, e);
      // A failed ground is not cached: the next ask retries.
      ground.catch(() => { if (this.cache.get(page) === e) this.cache.delete(page); });
      while (this.cache.size > LRU) this.cache.delete(this.cache.keys().next().value!);
    }
    if (withImage && !e.image) {
      const entry = e;
      entry.image = this.doc.getPage(page).then(renderPage);
      entry.pixels = true;
      entry.image.catch(() => { entry.image = undefined; entry.pixels = false; });
      // Keep pixels only for the most recent pages; older entries keep their JPEG.
      let n = 0;
      for (const k of [...this.cache.keys()].reverse()) {
        const x = this.cache.get(k)!;
        if (x.image && x.pixels && ++n > CANVASES) { x.image = x.image.then((r) => ({ jpeg: r.jpeg, canvas: null })); x.pixels = false; }
      }
    }
    return e;
  }
}
