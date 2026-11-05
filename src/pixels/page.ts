// src/pixels/page.ts — reads a page image's own pixels (the PDF's image object, not a render of the page),
// so the browser and node see the same bytes. Value imports carry `.ts` so node scripts can run it.
import type { PDFPageProxy } from 'pdfjs-dist';
import { groundPage } from '../agent/context/build.ts';
import { paintedFromOperatorList } from '../agent/context/operatorList.ts';
import { grayGrid, imageUnder, type RawImage } from './gray.ts';

export class PixelError extends Error {}

type Decoded = Partial<RawImage> & { bitmap?: CanvasImageSource & { width: number; height: number } };

/** The image object's bytes. In the browser pdf.js may hand over an ImageBitmap: drawn 1:1 and read back. */
async function bytesOf(page: PDFPageProxy, name: string): Promise<RawImage> {
  const store = (name.startsWith('g_') ? page.commonObjs : page.objs) as unknown as { get(n: string, cb: (o: Decoded) => void): void };
  const o = await new Promise<Decoded>((res, rej) => {
    const t = setTimeout(() => rej(new PixelError(`image ${name} did not load`)), 3000);
    store.get(name, (v) => { clearTimeout(t); res(v); });
  });
  if (o?.data && o.width && o.height && o.kind) return o as RawImage;
  if (o?.bitmap) {
    const { width: w, height: h } = o.bitmap;
    const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const ctx = cv.getContext('2d') as CanvasRenderingContext2D | null;
    if (!ctx) throw new PixelError('no 2d canvas');
    ctx.drawImage(o.bitmap, 0, 0);
    return { width: w, height: h, kind: 3, data: ctx.getImageData(0, 0, w, h).data };
  }
  throw new PixelError(`image ${name} has no pixels pdf.js can give`);
}

/**
 * Page `page`'s figure mark `mark` ("#i1", as the model's page listing names it) as `cols` columns of
 * gray levels. `OPS` is pdf.js's OPS table (the browser build's or node's legacy build's).
 */
export async function pagePixels(page: PDFPageProxy, OPS: Record<string, number>, mark: string, cols: number): Promise<number[][]> {
  const g = await groundPage(page, OPS);
  const m = g.marks.find((x) => x.id === mark);
  if (!m || m.kind !== 'image') throw new PixelError(`page ${page.pageNumber} has no image ${mark}`);
  const vp = page.getViewport({ scale: 1 });
  const ol = await page.getOperatorList();
  const { images } = paintedFromOperatorList(ol as unknown as { fnArray: number[]; argsArray: unknown[][] }, OPS, vp.transform, vp.width, vp.height);
  const im = imageUnder(images.filter((x) => x.name), m.rect);
  if (!im?.name) throw new PixelError(`image ${mark} on page ${page.pageNumber} is not one picture pdf.js can read`);
  return grayGrid(await bytesOf(page, im.name), cols, im);
}
