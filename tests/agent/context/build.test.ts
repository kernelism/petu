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

  it('builds the deck digest, the visible page, and its ground (no scout: the visible page alone)', async () => {
    const { doc } = fakeDoc(deck);
    const b = new ContextBuilder(doc, 'lec.pdf', { OPS: O });
    const { context, grounds } = await b.build(5, 'what is this?', []);
    expect(context.docHash).toBe('fp-abc');
    expect(context.numPages).toBe(9);
    expect(context.page).toBe(5);
    expect(context.image.b64).toBe('JPEG');
    expect(grounds.map((g) => g.page)).toEqual([5]);
    expect(context.pageText.split('\n').slice(0, 4)).toEqual(['PAGE 5 (visible; 16:9 slide; image attached)', 't1 94 50–196: Slide 5 title', 't2 183 50–219: body of slide 5', '#d1 dot 505,556']);
    const digest = context.docText.split('\n');
    expect(digest[0]).toMatch(/^DECK lec\.pdf \(9 pages\)/);
    expect(digest).toHaveLength(10);
    expect(digest).toContain('p8: Lucas Kanade · least squares optical flow · aperture problem');
    expect(context.pagesText).toBeUndefined();
    expect(context.images).toBeUndefined();
    expect(context.ink).toBeUndefined();
    b.destroy();
  });

  it('the digest is the same string for the scout, the prewarm and the answer (one cacheable prefix)', async () => {
    const { doc } = fakeDoc(deck);
    const b = new ContextBuilder(doc, 'lec.pdf', { OPS: O });
    const d = await b.digest(5, 'least squares');
    expect((await b.pagePrefix(5)).docText).toBe(d);
    expect((await b.build(2, 'other', [], { pages: [8], plan: '' })).context.docText).toBe(d);
    b.destroy();
  });

  it("multi-page: the scout's pages get full listings and marks in its order, the first three images, and every page's grounds", async () => {
    const { doc } = fakeDoc(deck);
    const b = new ContextBuilder(doc, 'lec.pdf', { OPS: O });
    const { context, grounds } = await b.build(5, 'how does it work?', [], { pages: [8, 2, 5, 3, 1, 9], plan: 'walk 8 then 2' });
    expect(grounds.map((g) => g.page)).toEqual([5, 8, 2, 3, 1, 9]);
    expect(context.images?.map((i) => i.page)).toEqual([8, 2, 3]);
    expect(context.images?.every((i) => i.b64 === 'JPEG')).toBe(true);
    const heads = context.pagesText!.split('\n').filter((l) => l.startsWith('PAGE'));
    expect(heads).toEqual([
      'PAGE 8 (16:9 slide; image attached)', 'PAGE 2 (16:9 slide; image attached)', 'PAGE 3 (16:9 slide; image attached)',
      'PAGE 1 (16:9 slide; listing only, no image)', 'PAGE 9 (16:9 slide; listing only, no image)',
    ]);
    expect(context.pagesText).toContain('#d1 dot 505,556');
    expect(context.scout).toEqual({ pages: [8, 2, 5, 3, 1, 9], plan: 'walk 8 then 2' });
    // Marks and lines on non-visible pages resolve for the director (addressed with p=).
    const g = groundingOf(grounds);
    expect(g.mark(8, '#t1')).toMatchObject({ kind: 'text', text: 'Lucas Kanade' });
    expect(g.mark(9, '#d1')).toMatchObject({ kind: 'dot' });
    expect(g.mark(4, '#t1')).toBeUndefined(); // not sent with a listing
    b.destroy();
  });

  it("caps the other pages' listings in total", async () => {
    const long = Array.from({ length: 9 }, () => ({ lines: Array.from({ length: 40 }, (_, i) => `${'word '.repeat(60)}${i}`) }));
    const { doc } = fakeDoc(long);
    const b = new ContextBuilder(doc, 'x.pdf', { OPS: O });
    const { context } = await b.build(5, 'q', [], { pages: [1, 2, 3, 4, 6, 7], plan: '' });
    expect(context.pagesText!.length).toBeLessThanOrEqual(12000 * 3.3 + 10);
    expect(context.pagesText).toContain('PAGE 7 (16:9 slide; listing only, no image)');
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

describe('groundPage bounds', () => {
  it('falls back to text only when the operator list is slow', async () => {
    const { doc } = fakeDoc(deck);
    const p = await doc.getPage(1) as unknown as Record<string, unknown>;
    const slow = { ...p, getOperatorList: () => new Promise(() => {}) };
    const t0 = Date.now();
    const g = await groundPage(slow as never, O, { opsMs: 50 });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(g.lines.map((l) => l.text)).toEqual(['Slide 1 title', 'body of slide 1']);
    expect(g.marks).toEqual([]);
    expect(g.noText).toBe(false);
  });
});
