// scripts/eval/sheet.ts — contact sheet layout: up to 8 sentence-end stills, 4x2, 1536x864 JPEG.
// The pixels are composed in the runner's Chrome with a canvas (no image libraries); this file holds
// the pure layout and the script the runner evaluates.
export const SHEET_W = 1536;
export const SHEET_H = 864;
export const COLS = 4;
export const ROWS = 2;
export const MAX_CELLS = COLS * ROWS;
const GAP = 6;

/** Which of `n` stills to put on the sheet: all if ≤ 8, else 8 spread evenly keeping first and last. */
export function pickStills(n: number): number[] {
  if (n <= MAX_CELLS) return Array.from({ length: n }, (_, i) => i);
  return Array.from({ length: MAX_CELLS }, (_, i) => Math.round((i * (n - 1)) / (MAX_CELLS - 1)));
}

export type Cell = { x: number; y: number; w: number; h: number };
/** Cell rectangles for `n` stills (row-major), uniform sizes. */
export function cells(n: number): Cell[] {
  const w = Math.floor((SHEET_W - GAP * (COLS + 1)) / COLS);
  const h = Math.floor((SHEET_H - GAP * (ROWS + 1)) / ROWS);
  return Array.from({ length: Math.min(n, MAX_CELLS) }, (_, i) => ({
    x: GAP + (i % COLS) * (w + GAP), y: GAP + Math.floor(i / COLS) * (h + GAP), w, h,
  }));
}

/** Largest rect of aspect `ar` (w/h) that fits in the cell, centred. */
export function fitIn(c: Cell, ar: number): Cell {
  let w = c.w, h = w / ar;
  if (h > c.h) { h = c.h; w = h * ar; }
  return { x: c.x + (c.w - w) / 2, y: c.y + (c.h - h) / 2, w, h };
}

/** JS (an async expression for Runtime.evaluate) that draws the stills and returns a JPEG data URL. */
export function composeScript(dataUrls: string[]): string {
  const cs = cells(dataUrls.length);
  return `(async () => {
  const urls = ${JSON.stringify(dataUrls)}, cells = ${JSON.stringify(cs)};
  const c = document.createElement('canvas'); c.width = ${SHEET_W}; c.height = ${SHEET_H};
  const g = c.getContext('2d'); g.fillStyle = '#e9e9ee'; g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < urls.length; i++) {
    const im = new Image(); im.src = urls[i]; await im.decode();
    const k = cells[i], ar = im.width / im.height; let w = k.w, h = w / ar; if (h > k.h) { h = k.h; w = h * ar; }
    g.drawImage(im, k.x + (k.w - w) / 2, k.y + (k.h - h) / 2, w, h);
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.font = '600 14px sans-serif'; g.fillText(String(i + 1), k.x + 8, k.y + 18);
  }
  return c.toDataURL('image/jpeg', 0.85);
})()`;
}
