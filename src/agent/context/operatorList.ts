// src/agent/context/operatorList.ts
import type { PaintedImage, PaintedPath } from './marks';

type Mat = number[];
const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];

/** Painted paths kept per page. Pages past this (text drawn as outlines, pattern fills, dense
 *  plots) keep the first ones: marks cluster them into figures anyway. */
export const MAX_PATHS = 6000;
/** Images kept per page (a page tiled from thousands of tiny images keeps the first ones). */
export const MAX_IMAGES = 1000;
/** Points kept per path (a 10k-point plot curve only needs its outline for a bbox). */
const MAX_PTS = 400;

/**
 * Walks a pdf.js 4.x operator list (`page.getOperatorList()`), tracking the CTM, and returns painted
 * paths and images in model coords. `OPS` is pdfjs's OPS table; `vt`, `vw`, `vh` come from
 * `page.getViewport({ scale: 1 })`. pdf.js 5 changed constructPath's arguments: re-check on upgrade.
 */
export function paintedFromOperatorList(ol: { fnArray: number[]; argsArray: unknown[][] }, OPS: Record<string, number>, vt: Mat, vw: number, vh: number) {
  const paths: PaintedPath[] = [], images: PaintedImage[] = [];
  let ctm: Mat = [1, 0, 0, 1, 0, 0];
  let t: Mat = mul(vt, ctm);
  const stack: Mat[] = [];
  let pending: { ops: string; pts: { x: number; y: number }[] } | null = null;
  const setCtm = (m: Mat) => { ctm = m; t = mul(vt, ctm); };
  const ap = (x: number, y: number) => ({ x: ((t[0] * x + t[2] * y + t[4]) / vw) * 1000, y: ((t[1] * x + t[3] * y + t[5]) / vh) * 1000 });
  const STROKE = new Set([OPS.stroke, OPS.closeStroke]);
  const FILL = new Set([OPS.fill, OPS.eoFill]);
  const BOTH = new Set([OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  for (let i = 0; i < ol.fnArray.length; i++) {
    const f = ol.fnArray[i], a = ol.argsArray[i] as unknown[];
    if (f === OPS.save) stack.push(ctm);
    else if (f === OPS.restore) setCtm(stack.pop() ?? ctm);
    else if (f === OPS.transform) setCtm(mul(ctm, a as number[]));
    else if (f === OPS.paintFormXObjectBegin) { stack.push(ctm); if (Array.isArray(a?.[0])) setCtm(mul(ctm, a[0] as number[])); }
    else if (f === OPS.paintFormXObjectEnd) setCtm(stack.pop() ?? ctm);
    else if (f === OPS.constructPath) {
      if (paths.length >= MAX_PATHS) continue;
      const [ops, coords] = a as [number[], number[]];
      if (!pending) pending = { ops: '', pts: [] };
      const p = pending;
      const push = (op: string, ...q: { x: number; y: number }[]) => {
        // A moveTo right after a moveTo replaces it (pdf-lib's drawLine writes "M M L").
        if (op === 'M' && p.ops.endsWith('M')) { p.ops = p.ops.slice(0, -1); p.pts.pop(); }
        p.ops += op;
        p.pts.push(...q);
      };
      let k = 0;
      for (const op of ops) {
        if (op === OPS.moveTo) { push('M', ap(coords[k], coords[k + 1])); k += 2; }
        else if (op === OPS.lineTo) { push('L', ap(coords[k], coords[k + 1])); k += 2; }
        else if (op === OPS.curveTo) { push('C', ap(coords[k + 4], coords[k + 5])); k += 6; }
        else if (op === OPS.curveTo2 || op === OPS.curveTo3) { push('C', ap(coords[k + 2], coords[k + 3])); k += 4; }
        else if (op === OPS.rectangle) {
          const [x, y, w, h] = coords.slice(k, k + 4); k += 4;
          push('R', ap(x, y), ap(x + w, y), ap(x + w, y + h), ap(x, y + h));
        } else if (op === OPS.closePath) p.ops += 'Z';
      }
    } else if (STROKE.has(f) || FILL.has(f) || BOTH.has(f)) {
      if (pending && pending.pts.length && paths.length < MAX_PATHS) {
        const ops = pending.ops.replace(/M$/, '');
        const pts = ops.length < pending.ops.length ? pending.pts.slice(0, -1) : pending.pts;
        if (pts.length) paths.push({ paint: STROKE.has(f) ? 'stroke' : FILL.has(f) ? 'fill' : 'both', ops, pts: thin(pts) });
      }
      pending = null;
    } else if (f === OPS.endPath) pending = null;
    else if (f === OPS.paintImageXObject || f === OPS.paintInlineImageXObject || f === OPS.paintImageMaskXObject || f === OPS.paintImageXObjectRepeat) {
      if (images.length >= MAX_IMAGES) continue;
      const c = [ap(0, 0), ap(1, 0), ap(0, 1), ap(1, 1)];
      const xs = c.map((q) => q.x), ys = c.map((q) => q.y);
      images.push({ rect: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) } });
    }
  }
  return { paths, images };
}

/** Long paths keep their first point, last point and the bbox extremes (enough to classify). */
function thin(pts: { x: number; y: number }[]) {
  if (pts.length <= MAX_PTS) return pts;
  const step = Math.ceil(pts.length / MAX_PTS);
  const out = pts.filter((_, i) => i % step === 0);
  let a = pts[0], b = pts[0], c = pts[0], d = pts[0];
  for (const p of pts) { if (p.x < a.x) a = p; if (p.x > b.x) b = p; if (p.y < c.y) c = p; if (p.y > d.y) d = p; }
  out.push(a, b, c, d, pts[pts.length - 1]);
  return out;
}
