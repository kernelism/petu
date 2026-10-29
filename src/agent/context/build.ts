// src/agent/context/build.ts — assembles what the model reads for a question, and the handles the
// director resolves (both from one PageGround per page: what the model sees is what it can hit).
// Value imports carry `.ts` so scripts/ground.ts can run these modules under plain Node.
import type { PDFPageProxy } from 'pdfjs-dist';
import type { PdfDoc } from '../../pdf/loadPdf';
import type { AskContext } from '../protocol';
import type { StudentStroke } from '../../ink/student/store';
import type { PageGround } from './types';
import type { TextLine } from './textLines';
import { itemsToRuns } from '../../pdf/textRuns.ts';
import { fontLookup } from '../../pdf/mathGlyphs.ts';
import { textLines } from './textLines.ts';
import { figureMarks, glyphCount, GLYPH_FLOOD } from './marks.ts';
import { paintedFromOperatorList } from './operatorList.ts';
import { chartMarks } from './charts.ts';
import { formatPage, formatVisible } from './format.ts';
import { resolveOutline, type Bookmark } from './outline.ts';
import { deckDigest } from './digest.ts';
import { answerPages, imagePages } from '../scout.ts';
import { PageIndex } from './search.ts';
import { bucketMap, capMap, formatMap, headingLines, headingMap, outlineTree, withRanges, type DocCard, type MapEntry } from './docmap.ts';
import { LabelIndex } from './labels.ts';
import { candidates as findCandidates, formatCandidates, resolveFind, type Candidate } from './candidates.ts';
import { offsetFromHeaders, offsetFromLabels, samplePages } from './printed.ts';
import { sectionCard, sectionWindow, tierOf, tokens, windowBoilerplate, type Tier } from './tiers.ts';
import { boilerplate } from './digest.ts';
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
/** How long a page's operator list may take before the page is grounded from its text alone. */
export const OPS_MS = 3000;

export async function groundPage(page: PDFPageProxy, OPS: Record<string, number>, opts: { opsMs?: number } = {}): Promise<PageGround> {
  const vp = page.getViewport({ scale: 1 });
  const aspect = vp.height / vp.width;
  const tc = await page.getTextContent();
  const items = (tc.items as unknown[]).filter((i): i is TextItem => typeof (i as TextItem).str === 'string');
  // The operator list first: it loads the page's fonts, which the math-font repair reads.
  // A pathological page (huge pattern fills, thousands of images) can take seconds: past OPS_MS it
  // is grounded from its text alone (no marks), so a question never waits on it.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ol = await Promise.race([
    page.getOperatorList().catch(() => null),
    new Promise<null>((ok) => { timer = setTimeout(() => ok(null), opts.opsMs ?? OPS_MS); }),
  ]);
  clearTimeout(timer);
  const runs = itemsToRuns(items, vp.transform, vp.width, vp.height, tc.styles as Styles, fontLookup(page.commonObjs as never));
  const text = textUsable(runs.map((r) => r.text).join(''));
  const { paths, images } = ol ? paintedFromOperatorList(ol as unknown as { fnArray: number[]; argsArray: unknown[][] }, OPS, vp.transform, vp.width, vp.height) : { paths: [], images: [] };
  const largeImage = images.some((im) => im.rect.w * im.rect.h > 0.25e6);
  // Few characters on a page that paints a scan or outlined glyphs, or a broken text layer.
  const noText = (text.few && (largeImage || paths.length >= 20)) || (!text.few && !text.usable);
  const lines = noText ? [] : textLines(runs, aspect);
  const mathOutlines = !noText && glyphCount(paths, aspect) >= GLYPH_FLOOD;
  const charts = noText ? [] : chartMarks(paths, lines, aspect);
  return { page: page.pageNumber, aspect, lines, marks: figureMarks(paths, images, lines, aspect), noText, ...(mathOutlines ? { mathOutlines } : {}), ...(charts.length ? { charts } : {}) };
}

/** A page's text lines only (the search index, headings and outline first lines). */
async function pageLines(page: PDFPageProxy): Promise<TextLine[]> {
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const items = (tc.items as unknown[]).filter((i): i is TextItem => typeof (i as TextItem).str === 'string');
  if (!textUsable(items.map((i) => i.str).join('')).usable) return [];
  return textLines(itemsToRuns(items, vp.transform, vp.width, vp.height), vp.height / vp.width);
}

/** `old`: one digest for every document (as before the tiers). `new`: the tiered context (tiers.ts). */
export type CtxMode = 'old' | 'new';

/** What ?debug shows about the context of one question. */
export type CtxInfo = { mode: CtxMode; tier: Tier | 'old'; tokens: Record<string, number>; candidates: string[]; printedOffset?: number; ms: number };

/** Everything the scout reads for one question (src/agent/scout.ts ScoutRequest fields). */
export type ScoutContext = {
  /** The cached document block: the digest (old, small), or the card + map (+ digest on medium). */
  digest: string;
  /** Huge tier: the visible section at full detail (its own cache breakpoint). */
  section?: string;
  pageText: string;
  ground: PageGround;
  /** Per question (uncached tail): CANDIDATES and the printed-page note. */
  candidates?: string;
  /** A scanned page or one whose math is drawn as outlines: its image, sent at low detail. */
  image?: Jpeg;
  info: CtxInfo;
};

const NEIGHBOURS = 2;
/** Small documents: the CANDIDATES block stays under ≈ 0.8k tokens (the digest already shows every page). */
const SMALL_CANDIDATE_CHARS = 2600;
const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);
const waitFor = async (p: Promise<unknown>, ms: number) => {
  let t: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([p, new Promise<void>((ok) => { t = setTimeout(ok, ms); })]);
  clearTimeout(t);
};
const candLabel = (c: Candidate) => `p${c.page} ${c.why === 'label' || c.why === 'page' ? c.label : c.why}`;
const CHARS_PER_TOKEN = 3.3;
/** The scout's other pages share this many tokens of listings; one page gets at most PAGE_TOKENS. */
const PAGES_TOKENS = 12000;
const PAGE_TOKENS = 3500;
/** How long a question waits for the text index to finish before the digest is built from what is read. */
export const DIGEST_WAIT_MS = 2500;
/**
 * New mode, small and medium tiers: how long a question waits for the index so the digest is complete
 * (a digest built from a partial index differs from the next question's: a second cache write).
 */
export const FULL_WAIT_MS = 8000;
/** Pages grounded ahead while the scout thinks (its likely picks: the best keyword matches). */
const SPECULATE = 3;
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
  readonly mode: CtxMode;
  /** Heading candidates per indexed page (a document without bookmarks gets its map from them). */
  private heads = new Map<number, string[]>();
  private labels = new LabelIndex();
  private mapP: Promise<{ text: string; map: MapEntry[]; card: DocCard }> | null = null;
  private fullDigest: string | null = null;
  private searchPages: { n: number; pages: Map<number, string[]> } | null = null;

  constructor(doc: PdfDoc, name: string, opts: { OPS?: Record<string, number>; ctx?: CtxMode } = {}) {
    this.doc = doc;
    this.name = name;
    this.mode = opts.ctx ?? 'old';
    if (opts.OPS) this.ops = Promise.resolve(opts.OPS);
    // The index reads text only (no operator list) and never touches the page LRU.
    this.index = new PageIndex(doc.numPages, async (p) => {
      if (this.dead) return [];
      const cached = this.cache.get(p);
      const ls = cached ? (await cached.ground).lines : await pageLines(await this.doc.getPage(p));
      const h = headingLines(ls);
      if (h.length) this.heads.set(p, h);
      return ls.map((l) => l.text);
    });
  }

  get tier(): Tier { return tierOf(this.doc.numPages); }

  /** On scroll idle (600ms after the last call): grounds and renders `page`, text for p±2. */
  warm(page: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (this.dead) return;
      this.warmNow(page).catch(() => undefined);
    }, WARM_DELAY);
  }

  /**
   * Stage 1 (scout): the deck digest, built from every page's text. It waits up to DIGEST_WAIT_MS for
   * the index to finish; meanwhile the best keyword pages for `question` are grounded ahead, since
   * the scout usually picks them.
   */
  async digest(page: number, question = ''): Promise<string> {
    if (question) for (const { page: p } of this.index.topPages(question, SPECULATE, new Set([page]))) void this.entry(p, false).ground.catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([this.index.fill(), new Promise<void>((ok) => { timer = setTimeout(ok, DIGEST_WAIT_MS); })]);
    clearTimeout(timer);
    return deckDigest(this.name, this.doc.numPages, (p) => this.index.lines(p), await this.outline());
  }

  /**
   * Stage 2 (perform): everything for the question. The visible page always comes first (listing +
   * image); then the scout's pages, in its order, with full listings, the first of them as images
   * (4 images in all). `grounds` covers every page sent with a listing, so marks on any of them resolve.
   */
  async build(page: number, _question: string, ink: StudentStroke[], scout0?: { pages: number[]; plan: string; find?: string[] }): Promise<{ context: AskContext; grounds: PageGround[]; found?: { q: string; page: number; via: 'label' | 'search' }[] }> {
    // The scout's `find` strings resolve locally, after its own pages (within its 6-page limit).
    const found = scout0?.find?.length ? this.find(scout0.find, [page, ...scout0.pages]) : [];
    const scout = scout0 && { pages: [...scout0.pages, ...found.map((f) => f.page)].slice(0, Math.max(scout0.pages.length, 6)), plan: scout0.plan };
    const { context, grounds: [visible] } = await this.assemble(page);
    const pages = answerPages(page, scout?.pages ?? []).slice(1);
    const withImage = new Set(imagePages(page, scout?.pages ?? []));
    const [others, images] = await Promise.all([
      Promise.all(pages.map((p) => this.entry(p, withImage.has(p)).ground.catch(() => null))),
      Promise.all(pages.filter((p) => withImage.has(p)).map(async (p) => {
        try { return { page: p, ...(await this.entry(p, true).image!).jpeg }; } catch { return null; }
      })),
    ]);
    const sentImages = images.filter((x): x is NonNullable<typeof x> => x != null);
    const imaged = new Set(sentImages.map((x) => x.page));
    const blocks: string[] = [];
    let budget = PAGES_TOKENS * CHARS_PER_TOKEN;
    const got = others.filter((g): g is PageGround => g != null);
    got.forEach((g, i) => {
      const share = Math.min(PAGE_TOKENS * CHARS_PER_TOKEN, budget / (got.length - i));
      const s = formatPage(g, { image: imaged.has(g.page), maxChars: share });
      blocks.push(s);
      budget -= s.length + 1;
    });
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
    return {
      context: {
        ...context,
        ...(blocks.length ? { pagesText: blocks.join('\n') } : {}),
        ...(sentImages.length ? { images: sentImages } : {}),
        ...(scout ? { scout: { pages: scout.pages, plan: scout.plan } } : {}),
        ...(inkPart ? { ink: inkPart } : {}),
      },
      grounds: [visible, ...got],
      ...(found.length ? { found } : {}),
    };
  }

  /**
   * Stage 1 (scout), whatever the mode: the cached document block, the section card (huge), the visible
   * page and the per-question CANDIDATES (session MEMORY is added by useAgent). Old mode: the digest and the page only.
   */
  async scout(page: number, question: string, prior?: { q: string }): Promise<ScoutContext> {
    const t0 = performance.now();
    const n = this.doc.numPages;
    if (this.mode === 'old') {
      const [digest, vis] = await Promise.all([this.digest(page, question), this.visible(page)]);
      return { digest, pageText: vis.pageText, ground: vis.ground, info: { mode: 'old', tier: 'old', tokens: { digest: tokens(digest), page: tokens(vis.pageText) }, candidates: [], ms: Math.round(performance.now() - t0) } };
    }
    const tier = this.tier;
    const [m, vis] = await Promise.all([this.docMap(), this.visible(page)]);
    const [digest, section] = await Promise.all([this.docBlock(), tier === 'huge' ? this.section(page) : Promise.resolve(undefined)]);
    const w = tier === 'huge' ? sectionWindow(m.map, page, n) : null;
    const pages = this.searchIndex();
    // Pages the cached blocks already show in full are not repeated as neighbours: the section card
    // (huge), every page (small: the digest gives each its full 360 characters).
    const shown = w ? new Set(range(w.from, w.to)) : tier === 'small' ? new Set(range(1, n)) : undefined;
    const cs = findCandidates({ page, numPages: n, question, ...(prior ? { prior: prior.q } : {}), map: m.map, labels: this.labels, printedOffset: m.card.printedOffset, pages, ...(shown ? { shown } : {}) });
    // Ground ahead what stage 2 will likely be built from: named pages, the next/previous page, the best match.
    for (const c of cs.filter((x) => x.why !== 'neighbour' || Math.abs(x.page - page) === 1).slice(0, 4)) void this.entry(c.page, false).ground.catch(() => undefined);
    const note = m.card.printedOffset ? `The student is on PDF page ${page}, printed page ${page - m.card.printedOffset}.` : '';
    const block = formatCandidates(cs, { question, map: m.map, pages }, !this.index.ready(), tier === 'small' ? SMALL_CANDIDATE_CHARS : undefined);
    const cand = [note, block].filter(Boolean).join('\n');
    let image: Jpeg | undefined;
    if (vis.ground.noText || vis.ground.mathOutlines) { try { image = (await this.entry(page, true).image!).jpeg; } catch { /* listing only */ } }
    return {
      digest, ...(section ? { section } : {}), pageText: vis.pageText, ground: vis.ground,
      ...(cand ? { candidates: cand } : {}), ...(image ? { image } : {}),
      info: {
        mode: 'new', tier, ms: Math.round(performance.now() - t0),
        tokens: { [tier === 'huge' ? 'map' : tier === 'medium' ? 'map+digest' : 'digest']: tokens(digest), ...(section ? { section: tokens(section) } : {}), page: tokens(vis.pageText), ...(image ? { image: 85 } : {}), candidates: tokens(cand) },
        candidates: cs.map(candLabel), ...(m.card.printedOffset ? { printedOffset: m.card.printedOffset } : {}),
      },
    };
  }

  /** The scout's `find` strings → pages (label index, then keyword search), excluding `exclude`. */
  find(find: string[], exclude: number[]): { q: string; page: number; via: 'label' | 'search' }[] {
    if (this.mode !== 'new' || !find.length) return [];
    return resolveFind(find, this.labels, this.searchIndex(), new Set(exclude));
  }

  /**
   * The visible page's listing (byte-identical to the answer's pageText) and ground: what the scout's
   * opener may point at, and the grounding its tags resolve against.
   */
  async visible(page: number): Promise<{ pageText: string; ground: PageGround }> {
    const ground = await this.entry(page, false).ground;
    return { pageText: formatVisible(ground), ground };
  }

  /** For prewarm: the cacheable prefix (digest + visible page), nothing question-specific. */
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
    if (this.mode === 'new') {
      void this.docMap().catch(() => undefined);
      // The visible section is read first, so its card and candidates never wait on the whole book.
      if (this.tier === 'huge') void this.docMap().then(({ map }) => { const w = sectionWindow(map, page, this.doc.numPages); return this.index.ensure(range(w.from, w.to)); }).catch(() => undefined);
    }
  }

  /** The visible page first, then neighbours nearest first (the earlier page wins a tie). */
  private window(page: number): number[] {
    const out = [page];
    for (let k = 1; k <= NEIGHBOURS; k++) for (const p of [page - k, page + k]) if (p >= 1 && p <= this.doc.numPages) out.push(p);
    return out;
  }

  /** The digest and the visible page (listing + image): the answer's cacheable prefix. */
  private async assemble(page: number): Promise<{ context: AskContext; grounds: PageGround[] }> {
    const img = this.entry(page, true).image!;
    const [ground, image, docText] = await Promise.all([this.entry(page, false).ground, img, this.mode === 'new' ? this.docBlock() : this.digest(page)]);
    if (!this.index.has(page)) this.index.set(page, ground.lines.map((l) => l.text));
    const context: AskContext = {
      docName: this.name,
      docHash: this.doc.fingerprints?.[0] ?? this.name,
      numPages: this.doc.numPages,
      page,
      docText,
      pageText: formatVisible(ground),
      image: image.jpeg,
      ...(this.mode === 'new' && this.tier === 'huge' ? { scoutSection: await this.section(page) } : {}),
    };
    return { context, grounds: [ground] };
  }

  /**
   * The document card + map, built once per document from the outline (every bookmark) and a fixed
   * sample of pages (printed page numbers, scans). Without bookmarks, from detected headings once the
   * index is full (bounded by FULL_WAIT_MS), else first lines every 20 pages. Memoised: every question
   * gets the same bytes.
   */
  docMap(): Promise<{ text: string; map: MapEntry[]; card: DocCard }> {
    return (this.mapP ??= (async () => {
      const n = this.doc.numPages;
      const d = this.doc as unknown as { getPageLabels?: () => Promise<(string | null)[] | null> };
      const [tree, labels] = await Promise.all([
        outlineTree(this.doc as never).catch(() => []),
        d.getPageLabels ? d.getPageLabels().catch(() => null) : Promise.resolve(null),
      ]);
      const sample = samplePages(n);
      await this.index.ensure(sample);
      const ss = sample.map((p) => ({ page: p, lines: this.index.lines(p) ?? [] }));
      const printedOffset = offsetFromLabels(labels) ?? offsetFromHeaders(ss);
      const scanned = ss.every((x) => !x.lines.length);
      let map = withRanges(tree, n);
      let source: DocCard['source'] = map.length ? 'bookmarks' : 'none';
      if (!map.length && n > 60 && !scanned) {
        await waitFor(this.index.fill(), FULL_WAIT_MS);
        const hm = headingMap(this.heads, n);
        if (hm.length >= 5) { map = hm; source = 'headings'; } else { map = bucketMap((p) => this.index.firstLine(p), n); source = 'pages'; }
      }
      map = capMap(map);
      this.labels.addMap(map);
      const card: DocCard = { name: this.name, numPages: n, printedOffset, scanned, source };
      return { text: formatMap(card, map), map, card };
    })());
  }

  /** The cached document block of new mode: small → the digest; medium → card + map + digest; huge → card + map. */
  private async docBlock(): Promise<string> {
    const tier = this.tier;
    if (tier === 'small') return this.completeDigest();
    const m = await this.docMap();
    return tier === 'medium' ? `${m.text}\n${await this.completeDigest()}` : m.text;
  }

  /** The digest from the whole index (waits up to FULL_WAIT_MS for it), memoised once complete. */
  private async completeDigest(): Promise<string> {
    if (this.fullDigest) return this.fullDigest;
    await waitFor(this.index.fill(), FULL_WAIT_MS);
    const d = deckDigest(this.name, this.doc.numPages, (p) => this.index.lines(p));
    if (this.index.ready()) this.fullDigest = d;
    return d;
  }

  /** Huge tier: the visible page's section card (its pages read first if not indexed yet). */
  private async section(page: number): Promise<string> {
    const m = await this.docMap();
    const w = sectionWindow(m.map, page, this.doc.numPages);
    await this.index.ensure(range(w.from, w.to));
    const at = (p: number) => this.index.lines(p);
    return sectionCard(w, at, windowBoilerplate(w, at));
  }

  /** The indexed pages without running headers/footers (for BM25 and snippets); labels updated. */
  private searchIndex(): Map<number, string[]> {
    const all = this.index.all();
    if (this.searchPages?.n === all.size) return this.searchPages.pages;
    const skip = boilerplate(this.doc.numPages, (p) => all.get(p));
    const sq = (l: string) => l.replace(/\s+/g, ' ').trim();
    const pages = new Map<number, string[]>();
    for (const [p, ls] of all) { pages.set(p, skip.size ? ls.filter((l) => !skip.has(sq(l))) : ls); this.labels.addPage(p, ls); }
    this.searchPages = { n: all.size, pages };
    return pages;
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
