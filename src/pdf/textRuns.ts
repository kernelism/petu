import type { TextRun } from '../locate/locateQuote';
import { fontLookup, repairText } from './mathGlyphs.ts';

type Item = { str: string; transform: number[]; width: number; height: number; fontName?: string };
type Styles = Record<string, { fontFamily?: string }>;

function cssFont(fontName: string | undefined, styles?: Styles): string | undefined {
  const fam = fontName ? styles?.[fontName]?.fontFamily : undefined;
  if (!fam) return undefined;
  const weight = /bold|black|heavy|semibold/i.test(fam) ? 'bold' : 'normal';
  const style = /italic|oblique/i.test(fam) ? 'italic' : 'normal';
  return `${style} ${weight} 100px ${fam}`;
}
type Mat = [number, number, number, number, number, number];

const mul = (m: number[], n: number[]): Mat => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];

/**
 * Text no reader sees: control characters, private-use glyphs (bracket pieces of big delimiters,
 * symbol-font leftovers) and LaTeXiT's hidden source blocks (`<latexit sha1_base64=…>…</latexit>`,
 * invisible text that Keynote equations carry).
 */
export function clean(s: string): string {
  return s
    .replace(/<latexit[\s\S]*?(<\/latexit>|$)/g, '')
    .replace(/[\u0000-\u001f\ue000-\uf8ff]/g, '');
}

/** Per-font text repair (src/pdf/mathGlyphs.ts); null for a font that needs none. */
export type FontFix = (fontName: string) => Map<string, string> | null;

/**
 * viewportTransform/vw/vh come from page.getViewport({ scale: 1 }). `fonts` repairs math fonts with
 * a wrong ToUnicode map; control characters left after it are dropped.
 */
export function itemsToRuns(items: Item[], viewportTransform: number[], vw: number, vh: number, styles?: Styles, fonts?: FontFix): TextRun[] {
  const runs: TextRun[] = [];
  let hidden = false; // inside a <latexit …> block that spans several items
  for (const raw of items) {
    if (!raw.str) continue;
    if (hidden) {
      const end = raw.str.indexOf('</latexit>');
      if (end < 0) continue;
      hidden = false;
      if (!raw.str.slice(end + 10).trim()) continue;
    }
    if (/<latexit(?![\s\S]*<\/latexit>)/.test(raw.str)) hidden = true;
    const str = clean(repairText(raw.str, fonts && raw.fontName ? fonts(raw.fontName) : null));
    if (!str.trim()) continue;
    const it = str === raw.str ? raw : { ...raw, str };
    const t = mul(viewportTransform, it.transform);
    const fontH = Math.hypot(t[2], t[3]);
    if (!(fontH > 0)) continue;
    const font = cssFont(it.fontName, styles);
    // The glyph box (baseline − 0.24 em to + 0.88 em, `width` along the baseline) in viewport px, as
    // its axis-aligned bounds: upright text gives the usual box; sideways text (a rotated axis label,
    // a page drawn sideways) gives a tall box where it is drawn, never a wide box off the page.
    const ax = Math.hypot(t[0], t[1]) || 1;
    const ux = t[0] / ax, uy = t[1] / ax; // baseline direction
    const vx = -t[2] / fontH, vy = -t[3] / fontH; // "down" in text space (viewport y grows down)
    const xs: number[] = [], ys: number[] = [];
    for (const a of [0, it.width]) for (const b of [-0.88 * fontH, 0.24 * fontH]) { xs.push(t[4] + a * ux + b * vx); ys.push(t[5] + a * uy + b * vy); }
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    runs.push({
      text: it.str,
      ...(font ? { font } : {}),
      ...(Math.abs(uy) > Math.abs(ux) ? { vertical: true } : {}),
      rect: { x: (x0 / vw) * 1000, y: (y0 / vh) * 1000, w: ((x1 - x0) / vw) * 1000, h: ((y1 - y0) / vh) * 1000 },
    });
  }
  return runs;
}

type PageLike = {
  getViewport(o: { scale: number }): { transform: number[]; width: number; height: number };
  getTextContent(): Promise<{ items: unknown[]; styles?: Styles }>;
  getOperatorList?(): Promise<unknown>;
  commonObjs?: { has?(id: string): boolean; get(id: string): unknown };
};

/**
 * Loads a page's runs. `page` is a pdf.js PDFPageProxy. The operator list is fetched first (pdf.js
 * caches it for a rendered page) so the page's fonts are loaded for the math-font repair.
 */
export async function getTextRuns(page: PageLike): Promise<TextRun[]> {
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  try { await page.getOperatorList?.(); } catch { /* no fonts: no repair */ }
  const items = tc.items.filter((i): i is Item => typeof (i as Item).str === 'string');
  return itemsToRuns(items, vp.transform, vp.width, vp.height, tc.styles, fontLookup(page.commonObjs));
}
