// scripts/eval/frames.ts — the r3 judge's timeline: which sentence-end stills become frames, what each
// frame's caption says, how the whole board is captured, and the deck digest. Pure, except the
// scripts the runner evaluates in Chrome (strings).
import type { EvalResult } from '../../src/agent/evalHooks.ts';

export type FrameOpts = {
  /** A frame once at least this many words were spoken since the previous one (at a sentence end). */
  everyWords: number;
  /** Most timeline frames per answer (the final state and the board come on top). */
  max: number;
};
export const FRAME_OPTS: FrameOpts = { everyWords: 35, max: 6 };

const wordsIn = (s: string): number => s.split(/\s+/).filter(Boolean).length;

/**
 * Sentence indices whose end-of-sentence still becomes a frame: a frame after every ~`everyWords`
 * spoken words (so every few sentences, short or long), always the last sentence; if that is more
 * than `max`, `max` of them spread evenly, keeping the last.
 */
export function frameSchedule(sentences: { text: string }[], o: FrameOpts = FRAME_OPTS): number[] {
  const n = sentences.length;
  if (!n) return [];
  const picks: number[] = [];
  let acc = 0;
  sentences.forEach((s, i) => {
    acc += wordsIn(s.text);
    if (acc >= o.everyWords || i === n - 1) { picks.push(i); acc = 0; }
  });
  if (picks.length <= o.max) return picks;
  if (o.max <= 1) return [picks[picks.length - 1]];
  // Spread evenly over the candidates, the last one always in.
  return [...new Set(Array.from({ length: o.max }, (_, k) => picks[Math.round(((k + 1) * (picks.length - 1)) / o.max)]))];
}

/** Captions for scheduled frames: when it was taken and what was said since the previous frame. */
export function frameCaptions(sentences: { text: string; endMs: number }[], picks: number[], maxChars = 600): string[] {
  let from = 0;
  return picks.map((i) => {
    const said = sentences.slice(from, i + 1).map((s) => s.text.trim()).join(' ');
    from = i + 1;
    const t = (sentences[i].endMs / 1000).toFixed(1);
    const text = said.length > maxChars ? `${said.slice(0, maxChars - 1)}…` : said;
    return `After sentence ${i + 1} of ${sentences.length} (${t}s). Said since the previous frame: "${text}"`;
  });
}

/**
 * Scroll offsets that capture a scrolled board whole: one viewport-high strip at a time, the last one
 * aligned to the bottom, at most `max` strips (a taller board keeps its top strips and its bottom).
 */
export function boardSegments(scrollHeight: number, clientHeight: number, max = 4): number[] {
  if (clientHeight <= 0 || scrollHeight <= 0) return [];
  const bottom = Math.max(0, scrollHeight - clientHeight);
  const out: number[] = [];
  for (let y = 0; y < bottom; y += clientHeight) out.push(y);
  out.push(bottom);
  const uniq = [...new Set(out)];
  return uniq.length <= max ? uniq : [...uniq.slice(0, max - 1), bottom];
}

/** The board panel (Lessons v3 layout). The layout marks it with this attribute; no board → no board frame. */
export const BOARD_SELECTOR = '[data-petu-board]';

/** JS (for Runtime.evaluate): the board's inner rect in the viewport and its scroll sizes, or null. */
export const boardProbeScript = `(() => {
  const el = document.querySelector(${JSON.stringify(BOARD_SELECTOR)});
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return null;
  // Layout C (the anchored lane): the board is the lane, one sheet on the viewer's scroll, as tall as the
  // whole document (800,000 px); a clip that size hangs the screenshot. It doesn't scroll itself: take
  // the part in the window, what the student sees.
  if (el.scrollHeight <= el.clientHeight + 1 && r.height > innerHeight) {
    const y0 = Math.max(0, r.y), y1 = Math.min(innerHeight, r.y + r.height);
    if (y1 - y0 < 2) return null;
    return { x: r.x, y: y0, w: r.width, h: y1 - y0, scrollHeight: y1 - y0, clientHeight: y1 - y0, scrollTop: 0 };
  }
  // The inner (scrolling) area: inside the border, without a scrollbar.
  return { x: r.x + el.clientLeft, y: r.y + el.clientTop, w: el.clientWidth, h: el.clientHeight, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, scrollTop: el.scrollTop };
})()`;
export const boardScrollScript = (y: number) => `(async () => { const el = document.querySelector(${JSON.stringify(BOARD_SELECTOR)}); if (el) el.scrollTop = ${Math.round(y)}; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); })()`;

/**
 * JS that stacks strips (data URLs, each `h` px of the board at offsets `ys`) into one JPEG of the
 * whole board, scaled to at most `maxW` wide. Strip k covers [ys[k], ys[k] + h); overlaps are drawn over.
 */
export function stitchScript(urls: string[], ys: number[], h: number, maxW = 1152): string {
  return `(async () => {
  const urls = ${JSON.stringify(urls)}, ys = ${JSON.stringify(ys)}, h = ${h};
  const ims = [];
  for (const u of urls) { const im = new Image(); im.src = u; await im.decode(); ims.push(im); }
  const W = ims[0].width, total = ys[ys.length - 1] + h, k = Math.min(1, ${maxW} / W);
  const c = document.createElement('canvas'); c.width = Math.round(W * k); c.height = Math.round(total * k);
  const g = c.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
  ims.forEach((im, i) => g.drawImage(im, 0, Math.round(ys[i] * k), Math.round(W * k), Math.round(h * k)));
  return c.toDataURL('image/jpeg', 0.85);
})()`;
}

/** JS that re-encodes one image as a JPEG at most `maxW` wide (the judge's frame size). */
export function downscaleScript(url: string, maxW = 1152): string {
  return `(async () => {
  const im = new Image(); im.src = ${JSON.stringify(url)}; await im.decode();
  const k = Math.min(1, ${maxW} / im.width);
  const c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
  c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
})()`;
}

/** Pages an answer showed or marked: scroll and sketch pages and every page target, in first-touch order. */
export function pagesTouched(r: Pick<EvalResult, 'timings'>): number[] {
  const out: number[] = [];
  const add = (p: unknown) => { if (typeof p === 'number' && Number.isInteger(p) && p > 0 && !out.includes(p)) out.push(p); };
  for (const t of [...r.timings].sort((a, b) => (a.firedAt ?? 0) - (b.firedAt ?? 0))) {
    if (t.skipped) continue;
    const a = t.action as { page?: unknown; target?: { page?: unknown }; from?: { page?: unknown }; to?: { page?: unknown } };
    add(a.page); add(a.target?.page); add(a.from?.page); add(a.to?.page);
  }
  return out;
}

export type DigestOpts = { visible: number; touched?: number[]; maxPages?: number; window?: number; linesPerPage?: number; lineChars?: number };

/**
 * Which pages the digest lists: all of a deck of ≤ maxPages pages; for a longer one (a book) the
 * visible page ± window and the pages the answer touched ± 1.
 */
export function digestPages(n: number, o: DigestOpts): number[] {
  if (n <= (o.maxPages ?? 80)) return Array.from({ length: n }, (_, i) => i + 1);
  const win = o.window ?? 10;
  const set = new Set<number>();
  for (let p = o.visible - win; p <= o.visible + win; p++) set.add(p);
  for (const t of o.touched ?? []) for (let p = t - 1; p <= t + 1; p++) set.add(p);
  return [...set].filter((p) => p >= 1 && p <= n).sort((a, b) => a - b);
}

/**
 * The deck as the judge sees it: one line per listed page, `p12: <first lines>`, gaps said out loud,
 * the visible page marked. `lines` maps page → its text lines (only listed pages are needed).
 */
export function deckDigest(n: number, lines: Map<number, string[]>, o: DigestOpts): string {
  const per = o.linesPerPage ?? 2, chars = o.lineChars ?? 140;
  const out: string[] = [];
  let prev = 0;
  for (const p of digestPages(n, o)) {
    if (p > prev + 1) out.push(`… (pages ${prev + 1}-${p - 1} not listed)`);
    const text = (lines.get(p) ?? []).map((l) => l.trim()).filter(Boolean).slice(0, per).join(' / ');
    const t = text.length > chars ? `${text.slice(0, chars - 1)}…` : text;
    out.push(`p${p}${p === o.visible ? ' (visible)' : ''}: ${t || '(no text)'}`);
    prev = p;
  }
  if (prev < n) out.push(`… (pages ${prev + 1}-${n} not listed)`);
  return `${n} pages.\n${out.join('\n')}`;
}

/** Groups pdf.js text items into lines (top to bottom, left to right). */
export function itemsToLines(items: { s: string; x: number; y: number; h: number }[]): string[] {
  const sorted = [...items].filter((i) => i.s.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { y: number; h: number; parts: { s: string; x: number }[] }[] = [];
  for (const it of sorted) {
    const l = lines.find((L) => Math.abs(L.y - it.y) < Math.max(L.h, it.h) * 0.5);
    if (l) l.parts.push(it); else lines.push({ y: it.y, h: it.h, parts: [it] });
  }
  return lines.sort((a, b) => b.y - a.y).map((l) => l.parts.sort((a, b) => a.x - b.x).map((p) => p.s).join(' ').replace(/\s+/g, ' ').trim());
}

/**
 * The digest of a PDF, read in place through pdf.js in Node (legacy build, no canvas). Only the listed
 * pages are read; nothing is written to disk.
 */
export async function pdfDigest(path: string, o: DigestOpts): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { readFileSync } = await import('node:fs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)), useSystemFonts: true, verbosity: 0 }).promise;
  try {
    const lines = new Map<number, string[]>();
    for (const p of digestPages(doc.numPages, o)) {
      const tc = await (await doc.getPage(p)).getTextContent();
      lines.set(p, itemsToLines(tc.items.flatMap((it) => ('str' in it ? [{ s: it.str, x: it.transform[4] as number, y: it.transform[5] as number, h: Math.abs(it.transform[3] as number) || 10 }] : []))));
    }
    return deckDigest(doc.numPages, lines, o);
  } finally { await doc.destroy(); }
}
