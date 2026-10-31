// src/desk/preview.ts — a folded answer card's preview (founder 2026-10-30: "the thumbnail is illegible…
// rather show a better thumbnail when hovered").
/**
 * A folded card in the lane shows its number, question and page · time. Hovering it (or focusing it
 * from the keyboard) shows, after a short delay, a popover beside it with the answer's drawing: a
 * vector copy of the board's own SVG (never a raster), wide enough that its labels read. The popover
 * sits on the side of the card with room, inside the window, and never over the card. A click still
 * opens the card in place; Esc closes the popover; touch never shows it (a tap opens the card).
 */

/** Hover this long before the preview shows (a pointer passing over shows nothing). */
export const PREVIEW_DELAY_MS = 250;
/** Leaving the card, this long to reach the popover before it closes. */
export const PREVIEW_GRACE_MS = 160;
/** Within this long of a preview closing, the next card's shows at once (moving down the list). */
export const PREVIEW_WARM_MS = 400;
/** The preview's width range (px): its labels must read. */
export const PREVIEW_MIN_W = 360;
export const PREVIEW_MAX_W = 560;
/** The width it starts from before its labels are measured. */
export const PREVIEW_W = 380;
/** Its labels' median size on screen is raised to at least this (px), within the width range. */
export const PREVIEW_TEXT_PX = 11.5;
/** Air between the card and the popover, and between the popover and the window's edge. */
const GAP = 10;
const EDGE = 12;
/** The popover's padding around the drawing. */
export const PREVIEW_PAD = 12;

type Rect = { left: number; top: number; right: number; bottom: number };
export type Placement = { x: number; y: number; w: number; side: 'left' | 'right' | 'below' | 'above' };

/**
 * Where the popover goes: beside the card (right when it fits there, else left), level with it and
 * kept inside the band between `top` and `H − bottom`; when neither side has room for `w`, the wider
 * side takes it narrowed (to no less than `minW`); when neither has even that, below or above the card.
 * It never overlaps the card. `h(w)`: the popover's height at width w.
 */
export function placePreview(card: Rect, w: number, h: (w: number) => number, win: { W: number; H: number }, band: { top: number; bottom: number }, minW = PREVIEW_MIN_W): Placement {
  const lo = band.top + EDGE, hi = win.H - band.bottom - EDGE;
  const ly = (ph: number) => Math.round(Math.max(lo, Math.min(hi - ph, (card.top + card.bottom) / 2 - ph / 2)));
  const roomR = win.W - EDGE - card.right - GAP, roomL = card.left - GAP - EDGE;
  if (roomR >= w) return { x: Math.round(card.right + GAP), y: ly(h(w)), w, side: 'right' };
  if (roomL >= w) return { x: Math.round(card.left - GAP - w), y: ly(h(w)), w, side: 'left' };
  const room = Math.max(roomR, roomL);
  if (room >= minW) {
    const nw = Math.floor(room);
    return roomR >= roomL ? { x: Math.round(card.right + GAP), y: ly(h(nw)), w: nw, side: 'right' } : { x: Math.round(card.left - GAP - nw), y: ly(h(nw)), w: nw, side: 'left' };
  }
  const nw = Math.min(w, win.W - 2 * EDGE);
  const x = Math.round(Math.max(EDGE, Math.min(win.W - EDGE - nw, (card.left + card.right) / 2 - nw / 2)));
  const below = hi - (card.bottom + GAP), above = card.top - GAP - lo;
  return below >= above || below >= h(nw)
    ? { x, y: Math.round(card.bottom + GAP), w: nw, side: 'below' }
    : { x, y: Math.round(Math.max(lo, card.top - GAP - h(nw))), w: nw, side: 'above' };
}

/** The width that lifts the labels' median on-screen size `textPx` (measured at width `at`) to PREVIEW_TEXT_PX, within the range. */
export function legibleWidth(at: number, textPx: number | null): number {
  if (!(textPx && textPx > 0)) return at;
  return Math.round(Math.max(PREVIEW_MIN_W, Math.min(PREVIEW_MAX_W, (at * PREVIEW_TEXT_PX) / textPx)));
}

let copies = 0;

/**
 * A vector copy of sections' drawings (each section's layer svgs, at its cropped viewBox, stacked):
 * ids are renamed so the copy's own patterns and markers resolve to themselves (the originals sit in a
 * folded card, display: none), and the "now" state (the part drawing, a hover focus) is dropped.
 */
export function previewOf(sections: Element[]): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'lane-preview-art';
  for (const sec of sections) {
    const layers = Array.from(sec.querySelectorAll(':scope > svg.desk-region-layer'));
    const ink = layers.find((l) => l.classList.contains('desk-region-ink')) ?? layers[layers.length - 1];
    if (!ink) continue;
    const vb = (ink.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
    const box = document.createElement('div');
    box.className = 'lane-preview-sec';
    if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) box.style.aspectRatio = `${vb[2]} / ${vb[3]}`;
    for (const l of layers) {
      if (l.classList.contains('desk-region-paper')) continue;
      const c = l.cloneNode(true) as SVGSVGElement;
      c.removeAttribute('style');
      c.setAttribute('preserveAspectRatio', 'xMidYMin meet');
      box.appendChild(c);
    }
    wrap.appendChild(box);
  }
  renameIds(wrap, `pv${++copies}`);
  wrap.querySelectorAll('[data-live],[data-focus]').forEach((e) => { e.removeAttribute('data-live'); e.removeAttribute('data-focus'); });
  return wrap;
}

/** Renames every id under `root` (suffix `-tag`) and the references to them (url(#…), href="#…"). */
export function renameIds(root: Element, tag: string): void {
  const map = new Map<string, string>();
  root.querySelectorAll('[id]').forEach((e) => { const id = e.id; const n = `${id}-${tag}`; map.set(id, n); e.id = n; });
  if (!map.size) return;
  const swap = (v: string) => v.replace(/url\(\s*(['"]?)#([^'")\s]+)\1\s*\)/g, (m, q, id) => (map.has(id) ? `url(${q}#${map.get(id)}${q})` : m));
  const all = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const e of all) {
    for (const a of Array.from(e.attributes)) {
      if (a.value.includes('url(')) e.setAttribute(a.name, swap(a.value));
      else if ((a.name === 'href' || a.name === 'xlink:href') && a.value.startsWith('#') && map.has(a.value.slice(1))) {
        if (a.name === 'xlink:href') e.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', `#${map.get(a.value.slice(1))}`);
        else e.setAttribute('href', `#${map.get(a.value.slice(1))}`);
      }
    }
  }
}

/** The median on-screen size (px) of the copy's text, null when it has none. */
function textPx(art: HTMLElement): number | null {
  const sizes: number[] = [];
  art.querySelectorAll('text').forEach((t) => {
    const r = t.getBoundingClientRect();
    if (!(r.height > 0)) return;
    const fs = parseFloat(t.getAttribute('font-size') ?? getComputedStyle(t).fontSize);
    const m = (t as SVGTextElement).getScreenCTM?.();
    if (m && fs > 0) sizes.push(fs * Math.hypot(m.a, m.b));
  });
  if (!sizes.length) return null;
  sizes.sort((a, b) => a - b);
  return sizes[Math.floor(sizes.length / 2)];
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export type PreviewCard = {
  /** The card's element (pointer and focus events; its rect places the popover). */
  item: HTMLElement;
  /** Whether it is a folded card now (only folded cards preview). */
  folded(): boolean;
  /** The section elements whose drawings the preview shows. */
  sections(): Element[];
  /** Opens the card in place (a click on the popover). */
  open(): void;
};

/** One popover for the whole lane; cards attach to it. */
export class CardPreview {
  private pop: HTMLDivElement | null = null;
  private card: PreviewCard | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private grace: ReturnType<typeof setTimeout> | null = null;
  private closedAt = -Infinity;
  private off: (() => void)[] = [];

  constructor(private o: { band(): { top: number; bottom: number } }) {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !this.pop) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.hide();
    };
    const away = () => { if (this.pop || this.timer) this.hide(); };
    window.addEventListener('keydown', key, true);
    window.addEventListener('scroll', away, true);
    window.addEventListener('resize', away);
    this.off.push(() => window.removeEventListener('keydown', key, true), () => window.removeEventListener('scroll', away, true), () => window.removeEventListener('resize', away));
  }

  /** Wires a card's hover and focus. */
  attach(c: PreviewCard): void {
    const it = c.item;
    it.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse' || e.pointerType === 'pen') this.want(c); });
    it.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' || e.pointerType === 'pen') this.leave(c); });
    it.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') this.hide(); });
    // Keyboard focus only (a click focuses the button too: that opens the card instead).
    it.addEventListener('focusin', (e) => { if ((e.target as Element).matches?.(':focus-visible')) this.want(c); });
    it.addEventListener('focusout', (e) => { if (!this.pop?.contains(e.relatedTarget as Node | null)) this.leave(c, 0); });
    it.addEventListener('click', () => { if (this.card === c || this.timer) this.hide(); }, true);
  }

  /** The card was opened, moved or removed: its preview goes. */
  hide(): void {
    this.clearTimers();
    if (this.pop) { this.pop.remove(); this.pop = null; this.closedAt = performance.now(); }
    this.card = null;
  }

  isOpen(): boolean { return !!this.pop; }

  destroy(): void { this.hide(); this.off.forEach((f) => f()); this.off = []; }

  private clearTimers() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.grace) { clearTimeout(this.grace); this.grace = null; }
  }

  private want(c: PreviewCard) {
    if (!c.folded()) return;
    if (this.grace) { clearTimeout(this.grace); this.grace = null; }
    if (this.card === c && this.pop) return;
    if (this.timer) clearTimeout(this.timer);
    const warm = !!this.pop || performance.now() - this.closedAt < PREVIEW_WARM_MS;
    this.timer = setTimeout(() => { this.timer = null; this.show(c); }, warm ? 0 : PREVIEW_DELAY_MS);
  }

  private leave(c: PreviewCard, grace = PREVIEW_GRACE_MS) {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.pop || this.card !== c) return;
    if (this.grace) clearTimeout(this.grace);
    this.grace = setTimeout(() => { this.grace = null; this.hide(); }, grace);
  }

  private show(c: PreviewCard) {
    if (!c.folded() || !c.item.isConnected) return;
    const secs = c.sections();
    if (!secs.length) return;
    if (this.pop) { this.pop.remove(); this.pop = null; }
    const pop = document.createElement('div');
    pop.className = 'lane-preview';
    // A picture of what the card's button opens: the button itself names the answer.
    pop.setAttribute('aria-hidden', 'true');
    const art = previewOf(secs);
    if (!art.childElementCount) return;
    pop.appendChild(art);
    pop.style.width = `${PREVIEW_W}px`;
    pop.style.visibility = 'hidden';
    document.body.appendChild(pop);
    // Measured at the starting width, widened so its labels read (vector: it stays crisp at any width).
    const inner = PREVIEW_W - 2 * PREVIEW_PAD;
    const w = legibleWidth(inner, textPx(art)) + 2 * PREVIEW_PAD;
    const k = art.getBoundingClientRect().height / Math.max(1, inner);
    const band = this.o.band();
    const H = window.innerHeight, W = window.innerWidth;
    const maxH = H - band.top - band.bottom - 24;
    const hAt = (pw: number) => Math.min(maxH, (pw - 2 * PREVIEW_PAD) * k + 2 * PREVIEW_PAD);
    const at = placePreview(c.item.getBoundingClientRect(), w, hAt, { W, H }, band);
    pop.style.width = `${at.w}px`;
    pop.style.maxHeight = `${maxH}px`;
    pop.classList.toggle('is-clipped', (at.w - 2 * PREVIEW_PAD) * k + 2 * PREVIEW_PAD > maxH);
    pop.style.left = `${at.x}px`;
    pop.style.top = `${at.y}px`;
    pop.dataset.side = at.side;
    pop.style.visibility = '';
    if (!reducedMotion()) { pop.classList.add('is-entering'); requestAnimationFrame(() => requestAnimationFrame(() => pop.classList.remove('is-entering'))); }
    pop.addEventListener('pointerenter', () => { if (this.grace) { clearTimeout(this.grace); this.grace = null; } });
    pop.addEventListener('pointerleave', () => this.leave(c));
    pop.addEventListener('click', () => { this.hide(); c.open(); });
    this.pop = pop;
    this.card = c;
  }
}
