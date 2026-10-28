// src/agent/context/image.ts — the page JPEG sent with a question, and the student-ink crop.
import type { PDFPageProxy } from 'pdfjs-dist';
import type { PageRect } from '../../geometry/space';
import type { StudentStroke } from '../../ink/student/store';

export type Jpeg = { b64: string; w: number; h: number };

/** Vision input budget: 32 px patches per image (the model's low-cost tier), and a long-side cap. */
export const MAX_PATCHES = 1040;
const LONG_SIDE = 1280;
const QUALITY = 0.82;
const CROP_LONG = 512;

export const patches = (w: number, h: number) => Math.ceil(w / 32) * Math.ceil(h / 32);

/** The largest image of this shape (`aspect` = h / w) within the patch budget and long side. */
export function imageSize(aspect: number): { w: number; h: number } {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  for (let long = LONG_SIDE; long > 1; long--) {
    const w = Math.max(1, Math.round(a >= 1 ? long / a : long));
    const h = Math.max(1, Math.round(a >= 1 ? long : long * a));
    if (patches(w, h) <= MAX_PATCHES) return { w, h };
  }
  return { w: 1, h: 1 };
}

// One render at a time, behind the viewer: each job waits for an idle slot first.
let queue: Promise<unknown> = Promise.resolve();
const idle = () => new Promise<void>((res) => {
  const ric = (globalThis as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric(() => res(), { timeout: 500 }); else setTimeout(res, 0);
});
function serial<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(idle).then(job);
  queue = run.catch(() => undefined);
  return run;
}

type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

function makeCanvas(w: number, h: number): { canvas: AnyCanvas; ctx: Canvas2D } {
  const canvas: AnyCanvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d', { alpha: false }) as Canvas2D | null;
  if (!ctx) throw new Error('no 2d canvas');
  return { canvas, ctx };
}

async function toJpegB64(canvas: AnyCanvas): Promise<string> {
  const blob = 'convertToBlob' in canvas
    ? await canvas.convertToBlob({ type: 'image/jpeg', quality: QUALITY })
    : await new Promise<Blob>((res, rej) => (canvas as HTMLCanvasElement).toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/jpeg', QUALITY));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * Renders the page to a JPEG within the patch budget, on white. Returns the canvas too, so the
 * ink crop can reuse it without a second render.
 */
export function renderPage(page: PDFPageProxy): Promise<{ jpeg: Jpeg; canvas: AnyCanvas }> {
  return serial(async () => {
    const vp1 = page.getViewport({ scale: 1 });
    const { w, h } = imageSize(vp1.height / vp1.width);
    const viewport = page.getViewport({ scale: w / vp1.width });
    const { canvas, ctx } = makeCanvas(w, h);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    await page.render({ canvasContext: ctx as CanvasRenderingContext2D, viewport, background: '#fff' }).promise;
    return { jpeg: { b64: await toJpegB64(canvas), w, h }, canvas };
  });
}

export async function renderPageJpeg(page: PDFPageProxy): Promise<Jpeg> {
  return (await renderPage(page)).jpeg;
}

/**
 * The student's ink region in model coords: the ink bbox padded 25% a side (at least 300 units
 * square), kept on the page. Stroke points are in page space (x 0–1000, y 0–1000·aspect).
 */
export function inkCropRect(strokes: Pick<StudentStroke, 'points'>[], aspect: number): PageRect | undefined {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) for (const [x, ys] of s.points) {
    const y = ys / aspect;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  if (!Number.isFinite(x0)) return undefined;
  const fit = (lo: number, hi: number) => {
    const size = Math.min(1000, Math.max(300, (hi - lo) * 1.5));
    const start = Math.min(1000 - size, Math.max(0, (lo + hi) / 2 - size / 2));
    return [Math.round(start), Math.round(size)];
  };
  const [x, w] = fit(x0, x1), [y, h] = fit(y0, y1);
  return { x, y, w, h };
}

/**
 * The ink crop sent with a question about the student's drawing: the rendered page around the
 * ink, the strokes drawn on top in the student's colours, at most 512 px on the long side.
 */
export async function inkCrop(base: AnyCanvas | ImageBitmap, strokes: StudentStroke[], pageAspect: number): Promise<Jpeg | undefined> {
  const r = inkCropRect(strokes, pageAspect);
  if (!r) return undefined;
  const bw = base.width, bh = base.height;
  const sx = (r.x / 1000) * bw, sy = (r.y / 1000) * bh, sw = (r.w / 1000) * bw, sh = (r.h / 1000) * bh;
  const k = Math.min(1, CROP_LONG / Math.max(sw, sh)) || 1;
  const w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
  const { canvas, ctx } = makeCanvas(w, h);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(base as CanvasImageSource, sx, sy, sw, sh, 0, 0, w, h);
  // Page space → crop pixels.
  const px = (x: number) => ((x / 1000) * bw - sx) * k;
  const py = (ys: number) => ((ys / (1000 * pageAspect)) * bh - sy) * k;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of strokes) {
    if (!s.points.length) continue;
    ctx.strokeStyle = s.color;
    ctx.globalAlpha = s.tool === 'highlighter' ? 0.4 : 1;
    ctx.lineWidth = Math.max(1.5, (s.tool === 'highlighter' ? 12 : 3) * k * (bw / 1000));
    ctx.beginPath();
    s.points.forEach(([x, y], i) => (i ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y))));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return { b64: await toJpegB64(canvas), w, h };
}
