import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';

vi.mock('../../../src/agent/context/image', () => ({
  renderPage: vi.fn(async () => ({ jpeg: { b64: 'JPEG', w: 1280, h: 720 }, canvas: {} })),
  inkCrop: vi.fn(async () => ({ b64: 'CROP', w: 300, h: 300 })),
}));

import { ContextBuilder, groundPage, textUsable } from '../../../src/agent/context/build';
import { groundingOf } from '../../../src/agent/context/types';
import type { PdfDoc } from '../../../src/pdf/loadPdf';

const O = OPS as unknown as Record<string, number>;
const W = 800, H = 450; // 16:9

type FakePage = { lines: string[]; image?: boolean; raw?: string };
/** A slide: each line 20pt tall, 40pt apart, starting at y 40 (top-down). */
function fakeDoc(pages: FakePage[]) {
  const calls = { text: 0, ops: 0 };
  const page = (n: number) => {
    const p = pages[n - 1];
    return {
      pageNumber: n,
      getViewport: ({ scale }: { scale: number }) => ({ transform: [scale, 0, 0, -scale, 0, H * scale], width: W * scale, height: H * scale }),
      getTextContent: async () => {
        calls.text++;
        const strs = p.raw !== undefined ? [p.raw] : p.lines;
        return { items: strs.map((str, i) => ({ str, transform: [20, 0, 0, 20, 40, H - 40 - 40 * i - 20], width: str.length * 9, height: 20 })), styles: {} };
      },
      getOperatorList: async () => {
        calls.ops++;
        return p.image
          ? { fnArray: [O.save, O.transform, O.paintImageXObject, O.restore], argsArray: [[], [700, 0, 0, 400, 50, 25], ['img', 10, 10], []] }
          : { fnArray: [O.constructPath, O.fill], argsArray: [[[O.moveTo, O.curveTo, O.curveTo, O.curveTo, O.curveTo], [400, 200, 400, 202, 402, 204, 404, 204, 406, 204, 408, 202, 408, 200, 408, 198, 406, 196, 404, 196, 402, 196, 400, 198, 400, 200]], []] };
      },
    };
  };
  const doc = { numPages: pages.length, fingerprints: ['fp-abc', null], getPage: async (n: number) => page(n), getOutline: async () => null };
  return { doc: doc as unknown as PdfDoc, calls };
}

const deck = Array.from({ length: 9 }, (_, i) => ({ lines: [`Slide ${i + 1} title`, `body of slide ${i + 1}`] }));
deck[7] = { lines: ['Lucas Kanade', 'least squares optical flow', 'aperture problem'] };

describe('groundPage', () => {
  it('lists lines and marks in model coords', async () => {
    const { doc } = fakeDoc(deck);
    const g = await groundPage(await doc.getPage(1) as never, O);
    expect(g.page).toBe(1);
    expect(g.aspect).toBeCloseTo(0.5625);
    expect(g.lines.map((l) => l.text)).toEqual(['Slide 1 title', 'body of slide 1']);
    expect(g.marks).toHaveLength(1);
    expect(g.marks[0].kind).toBe('dot');
    expect(g.noText).toBe(false);
  });
  it('flags a scan (no text, large image) and a broken text layer as noText', async () => {
    const { doc } = fakeDoc([{ lines: [], image: true }, { lines: [], raw: '���ab' }]);
    const scan = await groundPage(await doc.getPage(1) as never, O);
    expect(scan.noText).toBe(true);
    expect(scan.marks.map((m) => m.kind)).toEqual(['image']);
    const broken = await groundPage(await doc.getPage(2) as never, O);
    expect(broken.noText).toBe(true);
    expect(broken.lines).toEqual([]);
  });
  it('textUsable', () => {
    expect(textUsable('ab').usable).toBe(false);
    expect(textUsable('abc').usable).toBe(true);
    expect(textUsable('ab��').usable).toBe(false);
  });
});

describe('ContextBuilder', () => {
  beforeEach(() => vi.useRealTimers());

  it('builds the visible page, ±2 neighbours nearest first, and their grounds', async () => {
    const { doc } = fakeDoc(deck);
    const b = new ContextBuilder(doc, 'lec.pdf', { OPS: O });
    const { context, grounds } = await b.build(5, 'what is this?', []);
    expect(context.docHash).toBe('fp-abc');
    expect(context.numPages).toBe(9);
    expect(context.page).toBe(5);
    expect(context.image.b64).toBe('JPEG');
    expect(grounds.map((g) => g.page)).toEqual([5, 4, 6, 3, 7]);
    const heads = context.pageText.split('\n').filter((l) => l.startsWith('PAGE'));
    expect(heads).toEqual(['PAGE 5 (visible; 16:9 slide; image attached)', 'PAGE 4 (text only)', 'PAGE 6 (text only)', 'PAGE 3 (text only)', 'PAGE 7 (text only)']);
    expect(context.pageText.split('\n').slice(0, 4)).toEqual(['PAGE 5 (visible; 16:9 slide; image attached)', 't1 94 50–196: Slide 5 title', 't2 183 50–219: body of slide 5', '#d1 dot 505,556']);
    expect(context.docText.split('\n')[0]).toBe('DOCUMENT lec.pdf (9 pages)');
    // Neighbour #t ids resolve for the director.
    expect(groundingOf(grounds).mark(4, '#t1')).toMatchObject({ kind: 'text', text: 'Slide 4 title' });
    expect(context.searchText).toBeUndefined();
    expect(context.ink).toBeUndefined();
    b.destroy();
  });

  it('caps neighbours at ~1,500 tokens in total', async () => {
    const long = Array.from({ length: 9 }, () => ({ lines: Array.from({ length: 10 }, (_, i) => `${'word '.repeat(60)}${i}`) }));
    const { doc } = fakeDoc(long);
    const b = new ContextBuilder(doc, 'x.pdf', { OPS: O });
    const { context } = await b.build(5, 'q', []);
    const visible = context.pageText.indexOf('PAGE 4');
    expect(context.pageText.length - visible).toBeLessThanOrEqual(1500 * 3.3 + 10);
    expect(context.pageText).toContain('PAGE 7 (text only)');
    b.destroy();
  });

  it('adds search hits from pages not already sent, once the index has them', async () => {
    const { doc } = fakeDoc(deck);
    const b = new ContextBuilder(doc, 'lec.pdf', { OPS: O });
    await (b as unknown as { index: { fill(): Promise<void> } }).index.fill();
    const { context } = await b.build(2, 'least squares optical flow', []);
    expect(context.searchText).toBe('PAGE 8 (search hit)\nLucas Kanade\nleast squares optical flow\naperture problem');
    const near = await b.build(7, 'least squares optical flow', []);
    expect(near.context.searchText).toBeUndefined(); // page 8 is a neighbour of 7
    expect(near.context.docText).toContain('p8: Lucas Kanade');
    b.destroy();
  });

  it('describes student ink on the visible page and attaches a crop', async () => {
    const { doc } = fakeDoc(deck);
    const b = new ContextBuilder(doc, 'lec.pdf', { OPS: O });
    const loop = Array.from({ length: 20 }, (_, i) => [505 + 30 * Math.cos(i / 3.3), (556 + 30 * Math.sin(i / 3.3)) * 0.5625, 0.5] as [number, number, number]);
    const { context } = await b.build(1, 'why?', [{ id: 1, page: 1, tool: 'pen', color: '#E5484D', points: loop }]);
    expect(context.ink?.summary).toBe('- a loop around #d1');
    expect(context.ink?.crop?.b64).toBe('CROP');
    const pre = await b.pagePrefix(1);
    expect(pre.ink).toBeUndefined();
    expect(pre.searchText).toBeUndefined();
    b.destroy();
  });

  it('is cached: a second build reads nothing again and is fast', async () => {
    const { doc, calls } = fakeDoc(deck);
    const b = new ContextBuilder(doc, 'lec.pdf', { OPS: O });
    await b.build(5, 'q', []);
    const before = { ...calls };
    const t0 = performance.now();
    await b.build(5, 'another question', []);
    expect(performance.now() - t0).toBeLessThan(25);
    expect(calls).toEqual(before);
    b.destroy();
  });

  it('warm() grounds the window after 600ms of quiet', async () => {
    vi.useFakeTimers();
    const { doc, calls } = fakeDoc(deck);
    const b = new ContextBuilder(doc, 'lec.pdf', { OPS: O });
    b.warm(3);
    b.warm(4);
    await vi.advanceTimersByTimeAsync(599);
    expect(calls.ops).toBe(0);
    await vi.advanceTimersByTimeAsync(5);
    expect(calls.ops).toBe(5); // pages 2–6
    b.destroy();
    vi.useRealTimers();
  });
});
