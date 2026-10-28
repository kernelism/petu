import { describe, it, expect, vi } from 'vitest';
import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';

vi.mock('../../../src/agent/context/image', () => ({
  renderPage: vi.fn(async () => ({ jpeg: { b64: 'JPEG', w: 1280, h: 720 }, canvas: {} })),
  inkCrop: vi.fn(async () => ({ b64: 'CROP', w: 300, h: 300 })),
}));

import { capMap, formatMap, headingLines, headingMap, outlineTree, withRanges, MAP_TOKENS, type MapEntry } from '../../../src/agent/context/docmap';
import { LabelIndex, mentions, pageLabels } from '../../../src/agent/context/labels';
import { candidates, formatCandidates, neighbourhood, resolveFind } from '../../../src/agent/context/candidates';
import { edgeNumbers, offsetFromHeaders, offsetFromLabels, pagesNamed, samplePages } from '../../../src/agent/context/printed';
import { sectionCard, sectionWindow, tierOf } from '../../../src/agent/context/tiers';
import { SessionMemory, boardObjects, MAX_TURNS } from '../../../src/agent/context/memory';
import { deckDigest, DIGEST_CHARS } from '../../../src/agent/context/digest';
import { ContextBuilder } from '../../../src/agent/context/build';
import type { PdfDoc } from '../../../src/pdf/loadPdf';

const O = OPS as unknown as Record<string, number>;
const node = (title: string, page: number, items: unknown[] = []) => ({ title, dest: [{ num: page, gen: 0 }], items });
const outlineDoc = (roots: unknown[]) => ({ getOutline: async () => roots, getDestination: async () => null, getPageIndex: async (r: { num: number }) => r.num - 1 });

describe('document map', () => {
  it('keeps every bookmark, in page order, with page ranges to the next entry at its depth or above', async () => {
    const tree = await outlineTree(outlineDoc([node('1 Kinematics', 3, [node('1.1 Speed', 3), node('1.2 Velocity', 6)]), node('2 Forces', 10, [node('2.1 Newton', 10)]), node('Index', 20)]) as never);
    const map = withRanges(tree, 25);
    expect(map.map((e) => `${e.depth}:${e.title} ${e.from}-${e.to}`)).toEqual([
      '0:1 Kinematics 3-9', '1:1.1 Speed 3-5', '1:1.2 Velocity 6-9', '0:2 Forces 10-19', '1:2.1 Newton 10-19', '0:Index 20-25',
    ]);
    expect(formatMap({ name: 'b.pdf', numPages: 25, printedOffset: 2, scanned: false, source: 'bookmarks' }, map).split('\n').slice(0, 4)).toEqual([
      'DOCUMENT b.pdf (25 PDF pages; printed page numbers run 2 behind PDF pages: printed page X = PDF page X+2; page numbers here are PDF pages)',
      "MAP (the document's own outline; every entry with its page range)",
      '1 Kinematics p3–9',
      '  1.1 Speed p3–5',
    ]);
  });

  it('is no map when bookmarks outnumber pages (bookmarks that lie)', () => {
    expect(withRanges(Array.from({ length: 30 }, (_, i) => ({ title: `b${i}`, page: 1 + (i % 10), depth: 0 })), 10)).toEqual([]);
  });

  it('over budget, drops the deepest level chapter by chapter from the back; chapter titles survive', () => {
    const es: MapEntry[] = [];
    for (let c = 0; c < 40; c++) {
      es.push({ title: `${c + 1} Chapter ${'x'.repeat(40)}`, depth: 0, from: c * 25 + 1, to: c * 25 + 25 });
      for (let s = 0; s < 12; s++) es.push({ title: `${c + 1}.${s + 1} Section ${'y'.repeat(50)}`, depth: 1, from: c * 25 + 1 + 2 * s, to: c * 25 + 2 + 2 * s });
    }
    const cut = capMap(es, 3000);
    expect(cut.filter((e) => e.depth === 0)).toHaveLength(40);
    expect(cut.map((e) => e.title).join('\n').length / 3.3).toBeLessThanOrEqual(3000);
    // Each chapter keeps all of its sections or none, and the kept ones are the front chapters.
    const per = Array.from({ length: 40 }, (_, c) => cut.filter((e) => e.depth === 1 && e.title.startsWith(`${c + 1}.`)).length);
    expect(per.every((n) => n === 0 || n === 12)).toBe(true);
    expect(per.indexOf(0)).toBeGreaterThan(0);
    expect(per.slice(per.indexOf(0)).every((n) => n === 0)).toBe(true);
    expect(capMap(es.slice(0, 13))).toEqual(es.slice(0, 13));
    expect(MAP_TOKENS).toBe(6000);
  });

  it('detects headings only in a taller font, and maps them', () => {
    const l = (text: string, h: number) => ({ text, rect: { x: 0, y: 0, w: 100, h } });
    expect(headingLines([l('3.2 Identity Mapping by Shortcuts', 14), l('body text here', 10), l('more body', 10), l('4. Use the limit laws', 10)])).toEqual(['3.2 Identity Mapping by Shortcuts']);
    const m = headingMap(new Map([[2, ['1 Introduction']], [5, ['2 Method']], [6, ['2.1 Setup']]]), 9);
    expect(m.map((e) => `${e.depth}:${e.title} ${e.from}-${e.to}`)).toEqual(['0:1 Introduction 2-4', '0:2 Method 5-9', '1:2.1 Setup 6-9']);
  });
});

describe('labels', () => {
  it('indexes captions and numbered things where they start a line, and standalone equation numbers', () => {
    expect(pageLabels(['Figure 15.26 The amplitude of a damped oscillator', 'as Figure 15.27 shows', 'TABLE 15.5 Income shares', '(3.4)', 'by (3.4) we get', 'Appendix D Proofs'])).toEqual(['figure 15.26', 'table 15.5', 'eq 3.4', 'appendix d']);
  });
  it('finds the labels a question names', () => {
    expect(mentions('next to the envelope picture in fig 15.26 and Table 15.5')).toEqual(['figure 15.26', 'table 15.5']);
    expect(mentions("how does that give mu <= W(0) < 0 'by (3.4)'? see appendix D, eq. (1.4)")).toEqual(['appendix d', 'eq 1.4', 'eq 3.4']);
    expect(mentions('in example 11.1 part b')).toEqual(['example 11.1']);
    expect(mentions('figure 2a: so RSEM')).toEqual(['figure 2']);
  });
  it('resolves to the earliest page, sections through the map', () => {
    const li = new LabelIndex();
    li.addPage(749, ['Figure 15.27 Forced oscillation']);
    li.addPage(748, ['Figure 15.26 Damping', 'Figure 15.27 (continued)']);
    li.addMap([{ title: '9.2 Outcomes and the Type I and Type II Errors', depth: 1, from: 476, to: 477 }, { title: 'Appendix D Proofs', depth: 0, from: 50, to: 51 }]);
    expect(li.resolve('fig 15.27 and figure 15.26')).toEqual([['figure 15.27', 748], ['figure 15.26', 748]]);
    expect(li.resolve('see section 9.2')).toEqual([['section 9.2', 476]]);
    expect(li.resolve('appendix D for a proof')).toEqual([['appendix d', 50]]);
  });
});

describe('printed page numbers', () => {
  it('reads the offset from numeric page labels', () => {
    expect(offsetFromLabels(['i', 'ii', 'iii', ...Array.from({ length: 20 }, (_, i) => String(i + 1))])).toBe(3);
    expect(offsetFromLabels(null)).toBeNull();
    expect(offsetFromLabels(['a', 'b'])).toBeNull();
  });
  it('reads it from running headers and footers that recur at one offset', () => {
    expect(edgeNumbers(['530 5 • Integration', 'body', '5.1 Approximating Areas'])).toEqual([530]);
    expect(edgeNumbers(['Chapter 11 | Angular Momentum 519'])).toEqual([519]);
    const sample = samplePages(959).map((p) => ({ page: p, lines: [`${p - 12} Chapter • Title`, 'body text', 'Access for free at openstax.org'] }));
    expect(offsetFromHeaders(sample)).toBe(12);
    expect(offsetFromHeaders([{ page: 5, lines: ['body'] }])).toBe(0);
  });
  it('finds the page numbers a question names', () => {
    expect(pagesNamed('on page 512 and p. 13, pg 7')).toEqual([512, 13, 7]);
  });
});

describe('candidates', () => {
  const map: MapEntry[] = [
    { title: '15 Oscillations', depth: 0, from: 730, to: 760 },
    { title: '15.5 Damped Oscillations', depth: 1, from: 746, to: 748 },
    { title: '15.6 Forced Oscillations', depth: 1, from: 749, to: 755 },
  ];
  it('the neighbourhood: ±2, and the whole section when it is short', () => {
    expect(neighbourhood(748, 959, map)).toEqual([747, 749, 746, 750]);
    expect(neighbourhood(1, 3, [])).toEqual([2, 3]);
  });
  it('named labels and printed page numbers first, then neighbours, then keyword hits (each page once, ≤ 8)', () => {
    const labels = new LabelIndex();
    labels.addPage(385, ['Table 15.5 Income distribution']);
    const pages = new Map<number, string[]>([[385, ['Table 15.5 Income distribution', 'quintile shares']], [900, ['lorenz curve explained', 'lorenz curve area']], [747, ['previous page']]]);
    const cs = candidates({ page: 748, numPages: 959, question: 'how do the dots on the lorenz curve come from table 15.5? see page 500', map, labels, printedOffset: 12, pages });
    expect(cs.slice(0, 3)).toEqual([{ page: 385, why: 'label', label: 'table 15.5' }, { page: 512, why: 'page', label: 'page 500' }, { page: 747, why: 'neighbour' }]);
    expect(cs.some((c) => c.page === 900 && c.why === 'search')).toBe(true);
    expect(cs.length).toBeLessThanOrEqual(8);
    const block = formatCandidates(cs, { question: 'lorenz curve table 15.5', map, pages }, false);
    expect(block.split('\n')[1]).toBe('p385 · "table 15.5" named: Table 15.5 Income distribution · quintile shares');
    expect(block).toContain('p747 · 15.5 Damped Oscillations · neighbour: previous page');
    expect(block).toContain('p512 · printed page 500 named: (not read yet)');
  });
  it('pages already shown in full are not repeated as neighbours', () => {
    const cs = candidates({ page: 748, numPages: 959, question: 'why', map, labels: new LabelIndex(), printedOffset: 0, pages: new Map(), shown: new Set([746, 747, 748]) });
    expect(cs.map((c) => c.page)).toEqual([749, 750]);
  });
  it('resolves the scout\'s find strings: a label, else the best keyword page, never a page already chosen', () => {
    const labels = new LabelIndex();
    labels.addPage(50, ['Appendix D Proofs']);
    const pages = new Map<number, string[]>([[8, ['the conjugate heat equation is defined here']], [50, ['Appendix D Proofs']], [9, ['conjugate heat equation used']]]);
    expect(resolveFind(['Appendix D', 'conjugate heat equation', ''], labels, pages, new Set([9]))).toEqual([
      { q: 'Appendix D', page: 50, via: 'label' }, { q: 'conjugate heat equation', page: 8, via: 'search' },
    ]);
  });
});

describe('tiers', () => {
  it('by page count', () => {
    expect([12, 60, 61, 400, 401, 1232].map(tierOf)).toEqual(['small', 'small', 'medium', 'medium', 'huge', 'huge']);
  });
  it('the section card: the section when ≤ 36 pages, else 21 pages around a multiple of 10 near the page', () => {
    const map: MapEntry[] = [{ title: '8 Long chapter', depth: 0, from: 400, to: 606 }, { title: '8.2 Short', depth: 1, from: 420, to: 430 }];
    expect(sectionWindow(map, 425, 1232)).toEqual({ from: 420, to: 430, title: '8.2 Short' });
    expect(sectionWindow(map, 538, 1232)).toEqual({ from: 530, to: 550, title: '8 Long chapter' });
    expect(sectionWindow(map, 536, 1232)).toEqual(sectionWindow(map, 543, 1232));
    expect(sectionWindow([], 3, 900)).toEqual({ from: 1, to: 11 });
    const card = sectionCard({ from: 1, to: 2, title: 'T' }, (p) => (p === 1 ? ['Head', 'body'] : undefined));
    expect(card.split('\n')).toEqual(["SECTION T (p1–2; the student's part of the document, every page at full detail)", 'p1: Head · body', 'p2: …']);
  });
});

describe('session memory', () => {
  it('is append-only (each turn\'s block starts with the last one\'s) and rolls the oldest half past 20 turns', () => {
    const m = new SessionMemory();
    expect(m.text()).toBe('');
    m.add({ question: 'why is s = sqrt(SSE/(n-2))', page: 650, pages: [650, 648], board: boardObjects('{{sketch id=side near=p650}} x {{grid id=g on=side}} {{emph id=g}}') });
    const one = m.text();
    expect(one.split('\n')[1]).toBe('1. (on p650) "why is s = sqrt(SSE/(n-2))" → taught p650 p648; board: sketch side, grid g');
    m.add({ question: 'and the outlier?', page: 651, pages: [651], board: [] });
    expect(m.text().startsWith(one)).toBe(true);
    for (let i = 0; i < MAX_TURNS; i++) m.add({ question: `q${i}`, page: i + 1, pages: [], board: [] });
    const lines = m.text().split('\n');
    expect(lines[1]).toMatch(/^earlier: 10 earlier answers on p/);
    expect(lines.length).toBeLessThanOrEqual(MAX_TURNS + 2);
  });
});

describe('digest budget', () => {
  it('counts the outline inside DIGEST_CHARS (it used to overrun by 1–3k)', () => {
    const n = 1232;
    const pages: Record<number, string[]> = {};
    for (let p = 1; p <= n; p++) pages[p] = [`Section ${p} heading`, 'body text '.repeat(40)];
    const bms = Array.from({ length: 200 }, (_, i) => ({ title: `Chapter ${i + 1} ${'t'.repeat(40)}`, page: i * 6 + 1, depth: 0 }));
    expect(deckDigest('book.pdf', n, (p) => pages[p], bms).length).toBeLessThanOrEqual(DIGEST_CHARS);
    expect(deckDigest('book.pdf', 959, (p) => pages[p], bms).length).toBeLessThanOrEqual(DIGEST_CHARS);
  });
});

/** A 500-page book: running header "<printed> Chapter" (printed = PDF − 10), an outline of 10 chapters × 5 sections, one caption per page. */
function bookDoc(n = 500) {
  const lines = (p: number) => [`${p - 10} Chapter ${Math.ceil(p / 50)} • Running`, `Body text about topic${p} and more words`, `Figure ${Math.ceil(p / 50)}.${p % 50} caption of page ${p} here`];
  const page = (p: number) => ({
    pageNumber: p,
    getViewport: ({ scale }: { scale: number }) => ({ transform: [scale, 0, 0, -scale, 0, 800 * scale], width: 600 * scale, height: 800 * scale }),
    getTextContent: async () => ({ items: lines(p).map((str, i) => ({ str, transform: [10, 0, 0, 10, 40, 800 - 40 - 20 * i], width: str.length * 5, height: 10 })), styles: {} }),
    getOperatorList: async () => ({ fnArray: [], argsArray: [] }),
  });
  const outline = Array.from({ length: 10 }, (_, c) => node(`${c + 1} Chapter ${c + 1}`, c * 50 + 1, Array.from({ length: 5 }, (_, s) => node(`${c + 1}.${s + 1} Section`, c * 50 + 1 + s * 10))));
  return { numPages: n, fingerprints: ['fp-book', null], getPage: async (p: number) => page(p), ...outlineDoc(outline), getPageLabels: async () => null } as unknown as PdfDoc;
}

describe('ContextBuilder, ctx=new', () => {
  it('huge tier: the cached blocks are the same bytes before and after the index fills; candidates are per question', async () => {
    const b = new ContextBuilder(bookDoc(), 'book.pdf', { OPS: O, ctx: 'new' });
    expect(b.tier).toBe('huge');
    const first = await b.scout(255, 'what does figure 9.12 show next to page 300?');
    const index = (b as unknown as { index: { fill(): Promise<void>; ready(): boolean } }).index;
    await index.fill();
    expect(index.ready()).toBe(true);
    const later = await b.scout(255, 'why?');
    expect(later.digest).toBe(first.digest);
    expect(later.section).toBe(first.section);
    expect(first.digest.split('\n')[0]).toBe('DOCUMENT book.pdf (500 PDF pages; printed page numbers run 10 behind PDF pages: printed page X = PDF page X+10; page numbers here are PDF pages)');
    expect(first.digest).toContain('  6.1 Section p251–260');
    expect(first.section!.split('\n')[0]).toBe("SECTION 6.1 Section (p251–260; the student's part of the document, every page at full detail)");
    expect(first.info.tier).toBe('huge');
    // "figure 9.12" → its caption's page; printed page 300 → PDF 310; both named first.
    const again = await b.scout(255, 'what does figure 9.12 show next to page 300?');
    expect(again.info.candidates.slice(0, 2)).toEqual(['p412 figure 9.12', 'p310 page 300']);
    expect(again.candidates).toContain('The student is on PDF page 255, printed page 245.');
    // Stage 2 gets the map (not a digest) as its document block; prewarm carries the section card.
    const pre = await b.pagePrefix(255);
    expect(pre.docText).toBe(first.digest);
    expect(pre.scoutSection).toBe(first.section);
    // The scout's find list resolves before stage 2 and adds pages after its own.
    const { context, found } = await b.build(255, 'q', [], { pages: [256], plan: '', find: ['Figure 3.7'] });
    expect(found).toEqual([{ q: 'Figure 3.7', page: 107, via: 'label' }]);
    expect(context.scout!.pages).toEqual([256, 107]);
    b.destroy();
  });

  it('old mode keeps the digest path (no map, no candidates)', async () => {
    const b = new ContextBuilder(bookDoc(80), 'book.pdf', { OPS: O });
    const s = await b.scout(5, 'q');
    expect(s.digest.startsWith('DECK book.pdf (80 pages)')).toBe(true);
    expect(s.candidates).toBeUndefined();
    expect(s.info.mode).toBe('old');
    b.destroy();
  });
});
