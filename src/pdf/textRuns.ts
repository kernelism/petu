import type { TextRun } from '../locate/locateQuote';

type Item = { str: string; transform: number[]; width: number; height: number };
type Mat = [number, number, number, number, number, number];

const mul = (m: number[], n: number[]): Mat => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];

/** viewportTransform/vw/vh come from page.getViewport({ scale: 1 }). */
export function itemsToRuns(items: Item[], viewportTransform: number[], vw: number, vh: number): TextRun[] {
  const runs: TextRun[] = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const t = mul(viewportTransform, it.transform);
    const fontH = Math.hypot(t[2], t[3]);
    const x = t[4], baseline = t[5];
    const top = baseline - fontH * 0.88;
    runs.push({
      text: it.str,
      rect: { x: (x / vw) * 1000, y: (top / vh) * 1000, w: (it.width / vw) * 1000, h: ((fontH * 1.12) / vh) * 1000 },
    });
  }
  return runs;
}

/** Loads and caches runs per page. `page` is a pdf.js PDFPageProxy. */
export async function getTextRuns(page: { getViewport(o: { scale: number }): { transform: number[]; width: number; height: number }; getTextContent(): Promise<{ items: unknown[] }> }): Promise<TextRun[]> {
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const items = tc.items.filter((i): i is Item => typeof (i as Item).str === 'string');
  return itemsToRuns(items, vp.transform, vp.width, vp.height);
}
