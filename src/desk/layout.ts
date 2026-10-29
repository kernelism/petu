import type { Column, DeskRect, PageLayout } from './types';

export type { Column, PageLayout } from './types';

/**
 * Window geometry, all pure. Desk px = CSS px in the scroll content (.pv-sizer): x from its left
 * edge (= the viewport's, there is no horizontal scroll), y from its top. View px = viewport px.
 *
 * Two states (spec "Lessons v3" L): `reading`, the slides centred as a column of pages; `split`,
 * the slide column pinned to the left edge and the board on the right (stacked below it in a
 * narrow window). Everything derives from the window, never from the screen.
 */

export const TOP_PAD = 72;
export const BOTTOM_PAD = 200;
/** Between pages. */
export const PAGE_GAP = 24;
/** Reading: the page is never wider than this. */
export const MAX_PAGE_W = 860;
/** Reading: side margin total (32 each side). */
export const SIDE = 64;
export const MIN_PAGE_W = 200;
/** The chrome row (canvas toolbar left, top bar right): the slide column and the board start under it. */
export const SAFE_TOP = 64;
/** The least the bottom chrome covers; the app raises it to the caption dock's measured height (setSafeBottom). */
export const SAFE_BOTTOM = 156;
/** Split: the slide column is never narrower than this beside the board; below it the layout stacks. */
export const MIN_SLIDE_COL = 440;
/** Split wide (a `size=l` sketch): the slide column's share of the room. Normal is 1:1. */
export const WIDE_SHARE = 0.4;
/** Stacked: the slides' share of the height between the chrome and the dock. */
export const STACK_SHARE = 0.45;
/** Stacked: air above and below the page inside its band. */
export const STACK_PAD = 8;
/** The viewer's visible area ends this far above the dock. */
export const DOCK_GAP = 10;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The outer margin of the window, and the gutter between the slide column and the board. */
export const margin = (W: number) => Math.round(clamp(0.025 * W, 16, 40));

let dockPx = SAFE_BOTTOM;
let stackPx: number | null = null;
/** The bottom band framing keeps clear of: the dock at its tallest (or, stacked, everything under the slides). */
export const safeBottom = () => stackPx ?? dockPx;
/** The dock (caption + ask bar) at its tallest, measured by the app. */
export const dockReserve = () => dockPx;
export function setSafeBottom(px: number): void { dockPx = Math.max(SAFE_BOTTOM, Math.ceil(px)); }
/** Stacked: the viewer's band ends at the board (window px from the bottom); null when not stacked. Set by the viewer on layout. */
export function setStackBottom(px: number | null): void { stackPx = px == null ? null : Math.max(0, Math.ceil(px)); }

export const band = (H: number) => Math.max(0, H - SAFE_TOP - safeBottom());

/** reading: no board. normal: 1:1. wide: the board takes ~0.6 (a `size=l` sketch). */
export type Split = 'none' | 'normal' | 'wide';
export type Rect = { x: number; y: number; w: number; h: number };

export type Frame = {
  /** The split asked for ('none' = reading). */
  split: Split;
  /** The ratio that fit: a wide split falls back to normal when its slide column would be too narrow. */
  ratio: 'normal' | 'wide' | null;
  /** Board under the slides (the window is too narrow for side by side). */
  stacked: boolean;
  m: number;
  /** The slide column, view px: from the chrome row to the bottom edge (the dock sits at its foot). Stacked: the slides' band. */
  slides: Rect;
  /** The board, view px; null in reading. */
  board: Rect | null;
  /** The page column inside the viewer. */
  page: Column;
};

/** Reading: the page column, centred (unchanged from the viewer before the split layout). */
export function readingColumn(W: number): Column {
  const pageW = Math.max(MIN_PAGE_W, Math.min(W - SIDE, MAX_PAGE_W));
  return { pageW, pageX: (W - pageW) / 2 };
}

/**
 * The window's frame for a split state. `aspect` (page h / w) sizes the slides' band when stacked.
 * Split: margin m all round, a gutter of m, slide column : board = 1:1 (or 0.4:0.6 wide), sharing
 * top (under the chrome row) and bottom (m above the window edge) edges. The page fills its column.
 */
export function frameFor(W: number, H: number, split: Split, aspect: number): Frame {
  const m = margin(W);
  const bottom = H - m;
  if (split === 'none') {
    const page = readingColumn(W);
    return { split, ratio: null, stacked: false, m, slides: { x: page.pageX, y: SAFE_TOP, w: page.pageW, h: Math.max(0, bottom - SAFE_TOP) }, board: null, page };
  }
  const room = W - 3 * m;
  const ratio = split === 'wide' && room * WIDE_SHARE >= MIN_SLIDE_COL ? 'wide' : 'normal';
  const colW = Math.floor(room * (ratio === 'wide' ? WIDE_SHARE : 0.5));
  if (colW >= MIN_SLIDE_COL) {
    const bx = m + colW + m;
    const h = Math.max(0, bottom - SAFE_TOP);
    return {
      split, ratio, stacked: false, m,
      slides: { x: m, y: SAFE_TOP, w: colW, h },
      board: { x: bx, y: SAFE_TOP, w: Math.max(0, W - m - bx), h },
      page: { pageX: m, pageW: colW },
    };
  }
  // Stacked: the slides on top (the page fitted to its band), the board under them, the dock at the foot.
  const w = Math.max(0, W - 2 * m);
  const foot = H - dockReserve();
  const share = Math.max(0, foot - SAFE_TOP) * STACK_SHARE;
  const pageW = Math.max(Math.min(MIN_PAGE_W, w), Math.min(w, MAX_PAGE_W, (share - 2 * STACK_PAD) / Math.max(aspect, 0.05)));
  const sh = Math.round(pageW * aspect + 2 * STACK_PAD);
  const by = SAFE_TOP + sh + m;
  return {
    split, ratio, stacked: true, m,
    slides: { x: m, y: SAFE_TOP, w, h: sh },
    board: { x: m, y: by, w, h: Math.max(0, foot - by) },
    page: { pageX: (W - pageW) / 2, pageW },
  };
}

/**
 * Page tops for a column. `H` (the window height) lets the last page scroll up to the top of the
 * band: a short band (stacked) must still be able to frame the last page.
 */
export function computeLayout(col: Column, aspects: Float64Array, H = 0): PageLayout {
  const n = aspects.length;
  const tops = new Float64Array(n), heights = new Float64Array(n);
  let y = TOP_PAD;
  for (let i = 0; i < n; i++) {
    tops[i] = y;
    heights[i] = col.pageW * aspects[i];
    y += heights[i] + (i < n - 1 ? PAGE_GAP : 0);
  }
  const last = n ? heights[n - 1] : 0;
  return { ...col, tops, heights, total: y + Math.max(BOTTOM_PAD, H - SAFE_TOP - last) };
}

/** 1-based page whose slot (including the gap below it) contains content-y `y`. */
export function pageAt(L: { tops: Float64Array }, y: number): number {
  let lo = 0, hi = L.tops.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (L.tops[mid] <= y) lo = mid; else hi = mid - 1;
  }
  return lo + 1;
}

// ------------------------------------------------------------------------------------------------
// The board: sections stacked top to bottom, each scaled uniformly into the board's width.

/** Board chrome: the row holding the close button, above the first section. */
export const BOARD_HEAD = 40;
/** A section's whole-text floor: board text never renders smaller (the board scrolls instead). */
export const MIN_TEXT_PX = 12;
/** Body text past this is a heading-only slide, not body: board text stops growing here. */
export const MAX_BODY_PX = 36;
/**
 * The type cap: `size=m` text is at least this many section units tall, so a slide with small
 * body text gets a smaller section (text stays in proportion to the drawing) instead of tiny
 * labels on a huge picture.
 */
export const TEXT_UNITS = 18;
/** Fallback body text when a page has no text layer: this fraction of the page width. */
export const BODY_FALLBACK = 0.018;
/** Section-local size (script units). */
export const SECTION_W = 1000;
export const SECTION_H = 700;
/** Air kept around a finished section's ink when it is cropped (section units). */
export const CROP_PAD = 36;

/**
 * The span a finished section keeps: its ink's vertical extent (section units) padded by CROP_PAD,
 * within the section. Nothing drawn (or no layout to measure): the whole section.
 */
export function cropSpan(ink: { y: number; h: number } | null, full = SECTION_H): { y0: number; y1: number } {
  if (!ink || !(ink.h > 0) || !Number.isFinite(ink.y)) return { y0: 0, y1: full };
  const y0 = Math.max(0, ink.y - CROP_PAD), y1 = Math.min(full, ink.y + ink.h + CROP_PAD);
  return y1 - y0 >= 2 * CROP_PAD ? { y0, y1 } : { y0: 0, y1: full };
}

/** Inner padding of the board, from its width. */
export const boardPad = (w: number) => Math.round(clamp(w * 0.04, 16, 32));

export type SectionBox = { x: number; y: number; w: number; h: number; s: number };

/**
 * Sections laid out in the board's content box (px from the board's top-left, before scrolling).
 * Each section's scale s = min(width fit, type cap), uniform; sections are centred and stacked with
 * one even gap. `body`: the section's slide body text in px; `span`: the height it shows, in section
 * units (all 700 while it is being drawn; a finished section is cropped to its ink).
 */
export function boardLayout(boardW: number, secs: { body: number; span?: number; fill?: number }[]): { boxes: SectionBox[]; height: number; pad: number } {
  const pad = boardPad(boardW);
  const cw = Math.max(1, boardW - 2 * pad);
  let y = BOARD_HEAD;
  const boxes = secs.map(({ body: b, span = SECTION_H, fill }) => {
    const s = Math.min(cw / SECTION_W, Math.max(b, MIN_TEXT_PX) / TEXT_UNITS);
    // A scene fills the board's content width and `fill` px of height: a window onto its world.
    const w = fill != null ? cw : SECTION_W * s, h = fill != null ? Math.max(1, fill) : span * s;
    const box = { x: pad + (cw - w) / 2, y, w, h, s };
    y += h + pad;
    return box;
  });
  return { boxes, height: boxes.length ? y : BOARD_HEAD + pad, pad };
}

type Run = { text: string; rect: { y: number; h: number }; vertical?: boolean };
/** Running headers and footers (course name, author, page number) live in these bands of the page: not body text. */
export const MARGIN_BAND = 0.07;
/**
 * The page's body text size as a fraction of the page width: the median glyph height of its text,
 * weighted by characters (body text outweighs a title), leaving out the header and footer bands,
 * from text runs in page model coords (y 0–1000 of the page height; a run's box is 1.12 em tall).
 * Null without text.
 */
export function bodyFraction(runs: Run[], aspect: number): number | null {
  const hs: { h: number; n: number }[] = [];
  const pick = (inBands: boolean) => {
    for (const r of runs) {
      const n = r.text.replace(/\s/g, '').length;
      const c = (r.rect.y + r.rect.h / 2) / 1000;
      if (!n || r.vertical || !(r.rect.h > 0)) continue;
      if (!inBands && (c < MARGIN_BAND || c > 1 - MARGIN_BAND)) continue;
      hs.push({ h: r.rect.h, n });
    }
  };
  pick(false);
  if (!hs.length) pick(true); // a page whose only text sits in the margins: better than nothing
  if (!hs.length) return null;
  hs.sort((a, b) => a.h - b.h);
  const total = hs.reduce((s, x) => s + x.n, 0);
  let acc = 0, h = hs[hs.length - 1].h;
  for (const x of hs) { acc += x.n; if (acc >= total / 2) { h = x.h; break; } }
  return ((h / 1000) * aspect) / 1.12;
}

/** Body text px for a section: its page's body fraction × the page width now, within the floor and the heading cap. */
export const bodyPx = (frac: number | null | undefined, pageW: number) => clamp((frac ?? BODY_FALLBACK) * pageW, MIN_TEXT_PX, MAX_BODY_PX);

// ------------------------------------------------------------------------------------------------
// Visibility and framing (rules 1–3), in desk px against a scroll position.

export type View = { top: number; H: number; max: number };

/**
 * Scroll top that shows a page whole (`top`, `h`: its slot in the page column; W × H the scroller).
 * Reading: centred in the room between the chrome (top-aligned when it doesn't fit). Split: its top
 * edge on the board's top edge, always, so the slide column and the board read as one fitted frame
 * and no sliver of the page above shows. Every move to a page (a scroll, a journey, the reframe when
 * the board opens) lands here.
 */
export function pageFrameTop(page: { top: number; h: number }, W: number, H: number, split: Split, aspect: number): number {
  if (split !== 'none') return page.top - SAFE_TOP - (frameFor(W, H, split, aspect).stacked ? STACK_PAD : 0);
  const room = H - SAFE_TOP - safeBottom();
  return page.top - SAFE_TOP - Math.max(0, (room - page.h) / 2);
}

/** Whether a desk rect is on screen clear of the chrome. A rect taller than the band counts when its top is in the band's top 15%. */
export function inView(r: DeskRect, v: View): boolean {
  const lo = v.top + SAFE_TOP, hi = v.top + v.H - safeBottom();
  if (r.h <= hi - lo) return r.y >= lo - 1 && r.y + r.h <= hi + 1;
  return r.y >= lo - 1 && r.y <= lo + (hi - lo) * 0.15;
}

/** Scroll top that centers rect `r` in the band (top-aligned when taller), clamped to [0, max]. A rect that isn't finite stays at `v.top`. */
export function frameTop(r: DeskRect, v: { H: number; max: number; top?: number }): number {
  if (!Number.isFinite(r.y) || !Number.isFinite(r.h)) return v.top ?? 0;
  const b = band(v.H);
  const t = r.h <= b ? r.y - SAFE_TOP - (b - r.h) / 2 : r.y - SAFE_TOP;
  return clamp(t, 0, Math.max(0, v.max));
}

/** Air kept around page ink when it is framed: a line's endpoint labels and a circle's letter sit just outside its box. */
export const INK_PAD = 40;

const union = (a: DeskRect, b: DeskRect): DeskRect => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

/**
 * Scroll top that frames page ink `r` in the band between the top bar and the dock: padded for its
 * labels (as room allows, after the context), together with as much of `ctx` (earlier ink on the same page, most recent first) as fits,
 * so pointing at a bullet doesn't push the drawing it explains under the caption. A box taller than
 * the band keeps `anchor` (the part it starts from) in the band, as much of the box with it as fits.
 */
export function frameInk(r: DeskRect, ctx: DeskRect[], v: { H: number; max: number; top?: number }, anchor?: DeskRect): number {
  if (!Number.isFinite(r.y) || !Number.isFinite(r.h)) return v.top ?? 0;
  const b = band(v.H);
  if (r.h > b) {
    if (!anchor || !Number.isFinite(anchor.y)) return frameTop(r, v);
    const a = { ...anchor, h: Math.min(anchor.h, b) };
    // Top-aligned on the box, but never so far that the anchor drops under the dock (or above the bar).
    const t = clamp(r.y - SAFE_TOP, a.y + a.h - SAFE_TOP - b, a.y - SAFE_TOP);
    return clamp(t, 0, Math.max(0, v.max));
  }
  let u = r;
  for (const c of ctx) {
    if (!Number.isFinite(c.y) || !Number.isFinite(c.h)) continue;
    const next = union(u, c);
    if (next.h > b) break;
    u = next;
  }
  // Then the air around it, as much as is left.
  const pad = Math.min(INK_PAD, (b - u.h) / 2);
  return frameTop({ ...u, y: u.y - pad, h: u.h + 2 * pad }, v);
}
