import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import type { RenderTask } from 'pdfjs-dist';
import type { PdfDoc } from './loadPdf';
import type { GoReason, PageLayers, ViewerApi } from './viewerApi';
import type { TextRun } from '../locate/locateQuote';
import { getTextRuns } from './textRuns';
import { canvasMask } from './contentMask';
import type { ContentMask } from '../desk/route';
import { animateScrollTo } from './scroll';
import { prefersReducedMotion } from '../ink/agent/animate';
import { ink } from '../ink/student/store';
import { PageSlot, type SlotHandle } from './PageSlot';
import { computeLayout, dockReserve, frameFor, PAGE_GAP, pageAt, pageFrameTop, SAFE_TOP, safeBottom, setStackBottom, type Frame, type PageLayout, type Split } from '../desk/layout';
import { ScrollOwner, isScrollKey } from '../desk/follow';
import { clampPageZoom, fitColumn, PAGE_ZOOM_MAX, PAGE_ZOOM_MIN, pageZoomStep, panFor, readingOffset, zoomColumn, type Span } from './column';
import { boardZoomKey, isMacPlatform } from '../ui/zoomKeys';
import type { Column } from '../desk/types';
import type { DeskHost } from '../desk/types';
import './viewer.css';

type Props = {
  doc: PdfDoc;
  onReady(api: ViewerApi): void;
  onPageChange(page: number): void;
  renderOverlay?(page: number, spaceH: number): ReactNode;
};

/** Pages further than this from the current page lose their canvas once they leave the render range. */
const KEEP_RADIUS = 3;
/** Concurrent pdf.js renders. More than 2 starves the main thread while scrolling. */
const MAX_INFLIGHT = 2;
/** Canvas backing-store cap (iOS Safari refuses canvases above ~16.7M px). */
const MAX_CANVAS_PX = 16_000_000;
/** Student-ink overlays mount only this close to the current page (ink lives in its store). */
const OVERLAY_RADIUS = 8;
const CURRENT_LINE = 0.35;
const SCROLL_ANCHOR = 0.28;
const VISIBLE_BAND = 0.15;
const RESIZE_RERENDER_MS = 160;
/** A reveal (making an ink target visible) glides at most this long. */
const REVEAL_MAX_MS = 450;
/** A jump to a page further than this many pages cuts to just short of it and glides the rest. */
const JUMP_CUT_PAGES = 3;
/** Pinch (ctrl+wheel) zoom: e^(−deltaY × this) per event. */
const PINCH_RATE = 0.01;

const dpr = () => Math.min(2, window.devicePixelRatio || 1);

// ---------------------------------------------------------------------------------------------
// Layout: absolute tops computed in JS (src/desk/layout.ts), so scroll math never reads the DOM.

type Layout = PageLayout;

// ---------------------------------------------------------------------------------------------
// Renderer: owns every canvas. Renders pages near the viewport, closest-to-current first, at most
// MAX_INFLIGHT at a time; cancels renders for pages that scroll away; frees far canvases.

/** key = what the shown canvas was rendered at; taskKey = what an in-flight render targets ('' if none). */
type PageState = { canvas: HTMLCanvasElement | null; key: string; task: RenderTask | null; taskKey: string };

export class PageRenderer {
  near = new Set<number>();
  /** Pages wanted regardless of the viewport (destinations of programmatic scrolls), refcounted. */
  pinned = new Map<number, number>();
  private states = new Map<number, PageState>();
  /** Content masks, per page (resolution-independent, so they outlive the canvas they came from). */
  private masks = new Map<number, ContentMask | null>();
  private inflight = 0;
  private dead = false;
  /** Target render width in CSS px. Lags the live layout width during a resize (debounced). */
  renderW = 0;

  constructor(
    private doc: PdfDoc,
    private slot: (page: number) => SlotHandle | undefined,
    private current: () => number,
    private onAspect: (page: number, aspect: number) => void,
  ) {}

  private key() { return `${Math.round(this.renderW)}@${dpr()}`; }
  private st(p: number): PageState {
    let s = this.states.get(p);
    if (!s) { s = { canvas: null, key: '', task: null, taskKey: '' }; this.states.set(p, s); }
    return s;
  }
  private wanted(p: number) { return this.near.has(p) || this.pinned.has(p); }
  pin(p: number) { this.pinned.set(p, (this.pinned.get(p) ?? 0) + 1); this.pump(); }
  unpin(p: number) {
    const n = (this.pinned.get(p) ?? 0) - 1;
    if (n > 0) this.pinned.set(p, n); else this.pinned.delete(p);
  }

  setNear(p: number, isNear: boolean) {
    if (isNear) { this.near.add(p); this.pump(); return; }
    this.near.delete(p);
    if (this.pinned.has(p)) return;
    this.states.get(p)?.task?.cancel(); // fast scroll: don't finish pages nobody will see
    if (Math.abs(p - this.current()) > KEEP_RADIUS) this.release(p);
  }

  /** Frees canvases of far pages. Called when the current page changes. */
  sweep() {
    const cur = this.current();
    for (const p of [...this.states.keys()]) {
      if (!this.wanted(p) && Math.abs(p - cur) > KEEP_RADIUS) this.release(p);
    }
  }

  pump() {
    // A document destroyed under us (unmount, HMR) can't render: stop, or a failing render would re-pump forever.
    if (!this.dead && docGone(this.doc)) this.dead = true;
    if (this.dead || this.renderW <= 0) return;
    const key = this.key();
    const cur = this.current();
    while (this.inflight < MAX_INFLIGHT) {
      let best = -1, bestScore = Infinity;
      for (const set of [this.pinned.keys(), this.near]) {
        const isPinned = set !== this.near;
        for (const p of set) {
          const s = this.states.get(p);
          if (s && (s.key === key || s.taskKey === key)) continue; // done, or already in flight
          // Pinned pages jump the queue; otherwise closest to the current page first.
          const score = Math.abs(p - cur) - (isPinned ? 1e6 : 0);
          if (score < bestScore) { bestScore = score; best = p; }
        }
      }
      if (best < 0) return;
      void this.render(best, key);
    }
  }

  private async render(p: number, key: string) {
    const s = this.st(p);
    s.task?.cancel();
    s.taskKey = key;
    this.inflight++;
    let canvas: HTMLCanvasElement | null = null;
    try {
      const page = await pageOf(this.doc, p);
      const base = page.getViewport({ scale: 1 });
      this.onAspect(p, base.height / base.width);
      // The state may have been released (and recreated) while we waited: never write into a stale one.
      if (this.dead || this.states.get(p) !== s || !this.wanted(p) || s.taskKey !== key) return;
      let scale = (this.renderW * dpr()) / base.width;
      const px = base.width * base.height * scale * scale;
      if (px > MAX_CANVAS_PX) scale *= Math.sqrt(MAX_CANVAS_PX / px);
      const vp = page.getViewport({ scale });
      canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      const ctx = canvas.getContext('2d', { alpha: false })!;
      const task = page.render({ canvasContext: ctx, viewport: vp });
      s.task = task;
      await task.promise;
      if (this.dead || this.states.get(p) !== s || s.taskKey !== key) return;
      const host = this.slot(p)?.canvasHost;
      if (!host) return;
      const fresh = !s.canvas;
      if (fresh) canvas.classList.add('pv-fade-in');
      // Swap in only once painted: the old (CSS-scaled) canvas stays up until then, so no flash.
      host.replaceChildren(canvas);
      if (s.canvas) zap(s.canvas);
      s.canvas = canvas;
      s.key = key;
      canvas = null;
    } catch (err) {
      if ((err as { name?: string })?.name !== 'RenderingCancelledException') {
        // Not retried at this size (a page that can't render would otherwise re-render in a loop).
        if (!this.dead) { console.warn(`page ${p} render failed`, err); if (this.states.get(p) === s && s.taskKey === key) s.key = key; }
      }
    } finally {
      if (canvas) zap(canvas);
      if (s.taskKey === key) { s.task = null; s.taskKey = ''; }
      this.inflight--;
      this.pump();
    }
  }

  /**
   * A crisp copy of a page region (model coords 0–1000 on both axes), rendered `pxW` device px wide on
   * a transparent background, as a PNG data URL (a lift on the board). null if the page can't render.
   */
  async crop(p: number, r: { x: number; y: number; w: number; h: number }, pxW: number): Promise<string | null> {
    if (this.dead || docGone(this.doc) || !(r.w > 0 && r.h > 0)) return null;
    try {
      const page = await pageOf(this.doc, p);
      const base = page.getViewport({ scale: 1 });
      let scale = pxW / ((r.w / 1000) * base.width);
      const area = (r.w / 1000) * (r.h / 1000) * base.width * base.height * scale * scale;
      if (area > MAX_CANVAS_PX) scale *= Math.sqrt(MAX_CANVAS_PX / area);
      const vp = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil((r.w / 1000) * vp.width));
      canvas.height = Math.max(1, Math.ceil((r.h / 1000) * vp.height));
      const ctx = canvas.getContext('2d')!;
      const transform = [1, 0, 0, 1, -(r.x / 1000) * vp.width, -(r.y / 1000) * vp.height];
      await page.render({ canvasContext: ctx, viewport: vp, transform, background: 'rgba(0,0,0,0)' }).promise;
      const url = canvas.toDataURL('image/png');
      zap(canvas);
      return url;
    } catch (err) {
      console.warn(`page ${p} crop failed`, err);
      return null;
    }
  }

  /** Where page `p` has content, from its rendered canvas; null until it has one. */
  mask(p: number): ContentMask | null {
    if (this.masks.has(p)) return this.masks.get(p)!;
    const c = this.states.get(p)?.canvas;
    if (!c || this.dead) return null;
    const m = canvasMask(c);
    this.masks.set(p, m);
    return m;
  }

  release(p: number) {
    const s = this.states.get(p);
    if (!s) return;
    s.task?.cancel();
    if (s.canvas) { s.canvas.remove(); zap(s.canvas); }
    this.states.delete(p);
    // Drop the page's operator list and decoded images; getPage re-fetches cheaply later. A torn-down
    // viewer (or a document already destroyed: unmount, HMR) has nothing left to clean.
    if (this.dead || docGone(this.doc)) return;
    void pageOf(this.doc, p).then((pg) => pg.cleanup()).catch(() => {});
  }

  destroy() {
    this.dead = true;
    for (const p of [...this.states.keys()]) this.release(p);
    this.masks.clear();
  }
}

/** Whether the document has been destroyed (its pages can no longer be fetched). */
const docGone = (doc: PdfDoc) => !!(doc as { loadingTask?: { destroyed?: boolean } }).loadingTask?.destroyed;
/** doc.getPage, but a destroyed document rejects instead of throwing synchronously. */
function pageOf(doc: PdfDoc, p: number): ReturnType<PdfDoc['getPage']> {
  if (docGone(doc)) return Promise.reject(new Error('document destroyed'));
  try { return doc.getPage(p); } catch (e) { return Promise.reject(e); }
}

/** Releases a canvas backing store immediately (Safari otherwise holds it until GC). */
function zap(c: HTMLCanvasElement) { c.width = 0; c.height = 0; }

/**
 * The column the viewer lays out for a window frame: the frame's page column with a slide fitted to
 * the band between the chrome and the dock (stacked, frameFor has already fitted it to its band), at
 * the student's zoom. `span`: where a zoomed page may spread (its column beside the board, else the
 * window inside its margins).
 */
function columnFor(frame: Frame, W: number, H: number, aspect: number, zoom: number, pan: number): { col: Column; base: Column; span: Span; pan: number; maxPan: number } {
  const base = frame.stacked ? frame.page : fitColumn(frame.page, aspect, H - SAFE_TOP - dockReserve());
  const span = frame.split === 'none' || frame.stacked
    ? { a: Math.min(frame.m, base.pageX), b: Math.max(W - frame.m, base.pageX + base.pageW) }
    : { a: frame.page.pageX, b: frame.page.pageX + frame.page.pageW };
  return { ...zoomColumn(base, span, zoom, pan), base, span };
}

// ---------------------------------------------------------------------------------------------

const docIds = new WeakMap<PdfDoc, number>();
let nextDocId = 1;

/** Remounts the viewer per document so no state leaks between PDFs. */
export function PdfViewer(props: Props) {
  let id = docIds.get(props.doc);
  if (!id) { id = nextDocId++; docIds.set(props.doc, id); }
  return <ViewerInner key={id} {...props} />;
}
export default PdfViewer;

function ViewerInner({ doc, onReady, onPageChange, renderOverlay }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sizerRef = useRef<HTMLDivElement>(null);
  /** The scroller's size; the page column follows from it and the split state the desk sets. */
  const [viewW, setViewW] = useState(0);
  const [viewH, setViewH] = useState(0);
  const [split, setSplitState] = useState<Split>('none');
  /** The split state for the framing maths (read inside the long-lived effect). */
  const splitRef = useRef<Split>('none');
  splitRef.current = split;
  /** Desk subscribers, told after every committed layout (resize, a page's true size, the column). */
  const layoutSubs = useRef(new Set<() => void>());
  /** Every programmatic scrollTop write goes through this, so the student's scrolls stand out (rule 6). */
  const owner = useRef(new ScrollOwner()).current;
  /** While the column glides, pages scale by transform and the width isn't re-measured per frame. */
  const glideRef = useRef<{ timer: number; finish(): void; origin(): string; done(): void } | null>(null);
  /** h/w per page. Seeded from page 1, corrected per page as pages load. */
  const aspectsRef = useRef<Float64Array | null>(null);
  const [aspectsVersion, setAspectsVersion] = useState(0);
  const slots = useRef(new Map<number, SlotHandle>());
  const layoutRef = useRef<Layout | null>(null);
  const currentRef = useRef(1);
  const anchorRef = useRef<{ page: number; frac: number } | null>(null);
  const rendererRef = useRef<PageRenderer | null>(null);
  const ioRef = useRef<IntersectionObserver | null>(null);
  const cbRef = useRef({ onReady, onPageChange });
  cbRef.current = { onReady, onPageChange };
  // Callers typically pass an inline renderOverlay. Read it through a ref so a parent re-render
  // doesn't re-render every slot; overlay content should subscribe to its own state.
  const overlayRef = useRef(renderOverlay);
  overlayRef.current = renderOverlay;
  const stableOverlay = useCallback((p: number, H: number) => overlayRef.current?.(p, H), []);
  const [center, setCenter] = useState(1);
  /**
   * The page the agent last steered to (a scroll or reveal), until the reader scrolls themselves.
   * It is the page "in frame": at the end of a document the reading line can sit on the page above it.
   */
  const [focus, setFocus] = useState<number | null>(null);
  const focusRef = useRef<number | null>(null);
  const setFocusPage = useCallback((p: number | null) => { focusRef.current = p; setFocus(p); }, []);
  /**
   * The page the tutor last acted on (scrolled to, revealed, or inked in view), until the student
   * takes the view. Only then are the other pages set back while an answer draws (app.css).
   */
  const [acted, setActed] = useState<number | null>(null);
  const actedRef = useRef<number | null>(null);
  const actedSubs = useRef(new Set<(p: number | null) => void>());
  const setActedPage = useCallback((p: number | null) => {
    if (actedRef.current === p) return;
    actedRef.current = p;
    setActed(p);
    actedSubs.current.forEach((f) => f(p));
  }, []);
  /** The student's page zoom (1 = fitted) and, when the page is wider than its span, its pan (px). */
  const [view, setView] = useState({ zoom: 1, pan: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  /** A zoom's anchor line (viewport px), used once by the next layout instead of the reading line. */
  const anchorLineRef = useRef<number | null>(null);
  /** Zoom actions for the control (set by the main effect). */
  const zoomRef = useRef<{ to(z: number): void; step(dir: -1 | 1): void } | null>(null);

  // Seed page sizes from page 1.
  useEffect(() => {
    let live = true;
    void pageOf(doc, 1).then((p) => {
      if (!live) return;
      const vp = p.getViewport({ scale: 1 });
      aspectsRef.current = new Float64Array(doc.numPages).fill(vp.height / vp.width);
      setAspectsVersion((v) => v + 1);
    }).catch((e) => { if (!docGone(doc)) console.warn('[viewer] could not read page 1', e); }); // gone: unmount or HMR
    return () => { live = false; };
  }, [doc]);

  // Fit-to-width, tracked with a ResizeObserver.
  useLayoutEffect(() => {
    const el = scrollRef.current!;
    const measure = () => { setViewW(el.clientWidth); setViewH(el.clientHeight); };
    measure();
    const ro = new ResizeObserver(() => { if (!glideRef.current) measure(); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** The window's frame for the split state: the page column, and (stacked) where the slides' band ends. */
  const frame = useMemo(
    () => (viewW > 0 && aspectsRef.current ? frameFor(viewW, viewH, split, aspectsRef.current[0]) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viewW, viewH, split, aspectsVersion],
  );
  // The dock's reserve is module state the app measures; read per render so a change re-fits the column.
  const dock = dockReserve();
  const column = useMemo(
    () => (frame && aspectsRef.current ? columnFor(frame, viewW, viewH, aspectsRef.current[0], view.zoom, view.pan) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [frame, viewW, viewH, view, dock],
  );
  const columnRef = useRef(column);
  columnRef.current = column;
  const layout = useMemo(
    () => (column && aspectsRef.current ? computeLayout(column.col, aspectsRef.current, viewH) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [column?.col.pageW, column?.col.pageX, viewH, aspectsVersion],
  );
  // Stacked, the slides' band ends at the board: framing keeps ink above it.
  useLayoutEffect(() => {
    setStackBottom(frame?.stacked ? viewH - (frame.slides.y + frame.slides.h) : null);
  }, [frame, viewH]);

  const saveAnchor = useCallback(() => {
    const el = scrollRef.current, L = layoutRef.current;
    if (!el || !L) return;
    const y = el.scrollTop + el.clientHeight * CURRENT_LINE;
    const page = pageAt(L, y);
    anchorRef.current = { page, frac: (y - L.tops[page - 1]) / L.heights[page - 1] };
  }, []);

  // Whenever the layout changes (resize, a page's true size arriving), keep the reading position:
  // the same point of the current page stays under the 35% line.
  useLayoutEffect(() => {
    if (!layout) return;
    layoutRef.current = layout;
    const el = scrollRef.current!;
    const a = anchorRef.current;
    const line = anchorLineRef.current ?? el.clientHeight * CURRENT_LINE;
    anchorLineRef.current = null;
    if (a) {
      const want = layout.tops[a.page - 1] + a.frac * layout.heights[a.page - 1] - line;
      if (Math.abs(el.scrollTop - want) > 0.5) owner.write(el, want);
    }
    saveAnchor();
    layoutSubs.current.forEach((f) => f());
  }, [layout, saveAnchor]);


  const register = useCallback((page: number, h: SlotHandle | null) => {
    const prev = slots.current.get(page);
    // unobserve() throws on a non-Element, so only hand it a real one.
    if (prev && prev !== h && prev.el instanceof Element) ioRef.current?.unobserve(prev.el);
    if (h) { slots.current.set(page, h); if (h.el instanceof Element) ioRef.current?.observe(h.el); }
    else slots.current.delete(page);
  }, []);

  // The page indicator names the page in frame: the agent's focus page, else the reading line's.
  const shownPage = focus ?? center;
  useEffect(() => { cbRef.current.onPageChange(shownPage); }, [shownPage]);

  const ready = layout !== null;

  // Renderer + IntersectionObserver + scroll tracking + API, once per document.
  useEffect(() => {
    if (!ready) return;
    const el = scrollRef.current!;
    const setAspect = (page: number, aspect: number) => {
      const arr = aspectsRef.current;
      if (!arr || Math.abs(arr[page - 1] - aspect) < 1e-4) return;
      arr[page - 1] = aspect;
      setAspectsVersion((v) => v + 1);
    };
    const renderer = new PageRenderer(doc, (p) => slots.current.get(p), () => currentRef.current, setAspect);
    renderer.renderW = layoutRef.current!.pageW;
    rendererRef.current = renderer;

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) renderer.setNear(Number((e.target as HTMLElement).dataset.page), e.isIntersecting);
      },
      { root: el, rootMargin: '150% 0px' },
    );
    ioRef.current = io;
    for (const h of slots.current.values()) io.observe(h.el);

    const computeCurrent = () => {
      const L = layoutRef.current!;
      return pageAt(L, el.scrollTop + el.clientHeight * CURRENT_LINE);
    };
    const publishCurrent = () => {
      const cur = computeCurrent();
      if (cur === currentRef.current) return;
      currentRef.current = cur;
      setCenter(cur);
      renderer.sweep();
      renderer.pump();
    };
    let raf = 0;
    const onScroll = () => {
      if (owner.isForeign(el.scrollTop, el.scrollHeight - el.clientHeight)) intent(); // scrollbar drag, find-in-page, focus…
      subs.scroll.forEach((f) => f());
      saveAnchor();
      // A scroll during a column glide: keep scaling around the current reading line.
      if (glideRef.current && sizerRef.current) sizerRef.current.style.transformOrigin = glideRef.current.origin();
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; publishCurrent(); });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    // The reader taking over (wheel incl. pinch/ctrl+wheel, touch, scroll keys, zoom) ends the agent's focus page and follow mode.
    const onUserScroll = () => intent();
    const onKey = (e: KeyboardEvent) => { if (isScrollKey(e)) intent(); };
    const onZoom = () => { if ((window.visualViewport?.scale ?? 1) !== 1) intent(); };

    // ---- Page zoom (F31): ⌘−/⌘+/⌘0 act on the pane under the pointer (or holding focus); pinch over
    // the slides zooms them about the pointer; a page wider than its span pans with a sideways wheel.
    /** Where the pointer last was, and whether it was over the slides (not the board or the chrome). */
    const pointer = { x: 0, y: 0, slides: false, board: false };
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Element | null;
      pointer.x = e.clientX; pointer.y = e.clientY;
      pointer.slides = !!t?.closest?.('.pv-scroll');
      pointer.board = !!t?.closest?.('.desk-stage');
    };
    /** Zooms to `z`, keeping the point under `at` (viewport px; default the reading line, column centre) still. */
    const zoomTo = (z: number, at?: { x: number; y: number }) => {
      const L = layoutRef.current, c = columnRef.current;
      z = clampPageZoom(z);
      if (!L || !c || Math.abs(z - viewRef.current.zoom) < 1e-3) return;
      const px = at?.x ?? L.pageX + L.pageW / 2, py = at?.y ?? el.clientHeight * CURRENT_LINE;
      const y = el.scrollTop + py, page = pageAt(L, y);
      anchorRef.current = { page, frac: (y - L.tops[page - 1]) / L.heights[page - 1] };
      anchorLineRef.current = py;
      const fx = (px - L.pageX) / L.pageW;
      intent(); // the student took the view
      setView({ zoom: z, pan: panFor(c.span, c.base.pageW * z, fx, px) });
    };
    const zoomStep = (dir: -1 | 1) => zoomTo(pageZoomStep(viewRef.current.zoom, dir));
    zoomRef.current = { to: (z) => zoomTo(z), step: zoomStep };
    const mac = isMacPlatform();
    const onZoomKey = (e: KeyboardEvent) => {
      const k = boardZoomKey(e, { boardOpen: true, mac });
      if (!k) return;
      // The board's zoom (App) takes the keys when the pointer or focus is on the board.
      const focusIn = el.contains(document.activeElement);
      const slides = splitRef.current === 'none' || pointer.slides || (focusIn && !pointer.board);
      if (!slides) return;
      e.preventDefault(); // App's board zoom skips a handled key
      const at = pointer.slides ? pointer : undefined;
      zoomTo(k === 'fit' ? 1 : pageZoomStep(viewRef.current.zoom, k === 'in' ? 1 : -1), at);
    };
    /** Pinch and sideways pans, coalesced per frame. */
    let pinch = 1, panBy = 0, wheelRaf = 0;
    const flushWheel = () => {
      wheelRaf = 0;
      if (pinch !== 1) zoomTo(viewRef.current.zoom * pinch, pointer);
      if (panBy && columnRef.current && columnRef.current.maxPan > 0) {
        const p = Math.max(0, Math.min(columnRef.current.maxPan, viewRef.current.pan + panBy));
        if (p !== viewRef.current.pan) setView((v) => ({ ...v, pan: p }));
      }
      pinch = 1; panBy = 0;
    };
    const onWheel = (e: WheelEvent) => {
      onPointer(e as unknown as PointerEvent);
      if (e.ctrlKey) {
        e.preventDefault(); // a pinch (or ctrl+wheel) zooms the slides, not the whole page
        pinch *= Math.exp(-e.deltaY * PINCH_RATE);
      } else {
        const dx = e.deltaX || (e.shiftKey ? e.deltaY : 0);
        if (!dx || !columnRef.current?.maxPan) return;
        panBy += dx;
      }
      if (!wheelRaf) wheelRaf = requestAnimationFrame(flushWheel);
    };
    // Safari's trackpad pinch arrives as gesture events (scale relative to the gesture's start).
    type Gesture = Event & { scale: number; clientX: number; clientY: number };
    let gestureFrom = 1;
    const onGestureStart = (e: Event) => { e.preventDefault(); gestureFrom = viewRef.current.zoom; };
    const onGestureChange = (e: Event) => {
      const g = e as Gesture;
      e.preventDefault();
      zoomTo(gestureFrom * g.scale, Number.isFinite(g.clientX) ? { x: g.clientX, y: g.clientY } : pointer);
    };
    el.addEventListener('gesturestart', onGestureStart);
    el.addEventListener('gesturechange', onGestureChange);
    el.addEventListener('wheel', onUserScroll, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onUserScroll, { passive: true });
    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('keydown', onZoomKey, true);
    window.addEventListener('keydown', onKey);
    window.visualViewport?.addEventListener('resize', onZoom);
    currentRef.current = computeCurrent();
    setCenter(currentRef.current);

    // Re-render at a new DPR when the window moves between displays.
    let mq: MediaQueryList | null = null;
    const onDpr = () => { watchDpr(); renderer.pump(); intent(); }; // browser zoom changes the DPR
    const watchDpr = () => {
      mq?.removeEventListener('change', onDpr);
      mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      mq.addEventListener('change', onDpr);
    };
    watchDpr();

    // Text runs, cached per page.
    const runsCache = new Map<number, Promise<TextRun[]>>();
    const textRuns = (page: number) => {
      let r = runsCache.get(page);
      if (!r) {
        r = pageOf(doc, page).then((p) => getTextRuns(p));
        r.catch(() => runsCache.delete(page));
        runsCache.set(page, r);
      }
      return r;
    };

    const clampPage = (p: number) => Math.max(1, Math.min(doc.numPages, Math.round(p)));
    /** Makes sure `page`'s true size is in the layout (and committed to the DOM) before scroll math. */
    const ensureSize = async (page: number) => {
      const p = await pageOf(doc, page);
      const vp = p.getViewport({ scale: 1 });
      const arr = aspectsRef.current!;
      if (Math.abs(arr[page - 1] - vp.height / vp.width) >= 1e-4) {
        arr[page - 1] = vp.height / vp.width;
        flushSync(() => setAspectsVersion((v) => v + 1));
      }
    };
    const contentY = (page: number, y: number) => {
      const L = layoutRef.current!;
      return L.tops[page - 1] + (Math.max(0, Math.min(1000, y)) / 1000) * L.heights[page - 1];
    };
    /** The glide in flight. A new glide (or cancelScroll) aborts it, so two never fight. */
    let glide: AbortController | null = null;
    /**
     * Glides so `top()` sits at the top of the viewport. `top` is re-read every frame from the live
     * layout, so a page's true size arriving mid-glide still lands on the target.
     */
    const glideTo = async (page: number, top: () => number, maxMs?: number) => {
      glide?.abort();
      const ctrl = (glide = new AbortController());
      renderer.pin(page); // destination starts painting at the start of the glide, not on arrival
      try {
        await animateScrollTo(el, top, { signal: ctrl.signal, maxMs, owner });
      } finally {
        renderer.unpin(page);
        if (glide === ctrl) glide = null;
        publishCurrent();
      }
    };
    /** Whether `page` fits whole between the top bar and the caption. */
    const fits = (page: number) => layoutRef.current!.heights[page - 1] <= el.clientHeight - SAFE_TOP - safeBottom();
    /** Scroll top that shows `page` whole (pageFrameTop: split = its top on the board's top). */
    const framedTop = (page: number) => {
      const L = layoutRef.current!, top = L.tops[page - 1], h = L.heights[page - 1];
      // Reading: centred in the band, but never leaving a sliver of the page above in the top fade (F46).
      if (splitRef.current === 'none') return top - SAFE_TOP - readingOffset(el.clientHeight - SAFE_TOP - safeBottom(), h, PAGE_GAP);
      return pageFrameTop({ top, h }, el.clientWidth, el.clientHeight, splitRef.current, aspectsRef.current![0]);
    };
    /** The tutor steered to `page`: it is the page in frame and the page acted on. */
    const steer = (page: number) => { setFocusPage(page); setActedPage(page); };
    /** The comfortable band for ink: clear of the chrome, and of the outer 15% when `strict`. */
    const inBand = (at: number, strict: boolean) => {
      const top = el.scrollTop, h = el.clientHeight;
      const lo = strict ? Math.max(h * VISIBLE_BAND, SAFE_TOP) : SAFE_TOP;
      const hi = strict ? Math.max(h * VISIBLE_BAND, safeBottom()) : safeBottom();
      return at >= top + lo && at <= top + h - hi;
    };

    const api: ViewerApi = {
      numPages: () => doc.numPages,
      currentPage: () => currentRef.current,
      spaceHeight: (page) => 1000 * (aspectsRef.current?.[clampPage(page) - 1] ?? 1.294),
      scale: () => (layoutRef.current?.pageW ?? 0) / 1000,
      layers: (page) => {
        const h = slots.current.get(page);
        return h ? { highlight: h.highlight, agent: h.agent } : null;
      },
      // Only layers holding marks: a 1000-page book shouldn't hand back 2000 empty groups.
      allLayers: () => {
        const out: PageLayers[] = [];
        for (const h of slots.current.values()) {
          if (h.highlight.firstChild || h.agent.firstChild) out.push({ highlight: h.highlight, agent: h.agent });
        }
        return out;
      },
      textRuns: (page) => textRuns(clampPage(page)),
      scrollToPage: async (page, y) => {
        page = clampPage(page);
        // Re-framing the page already in frame (the board opening beside it) is not acting on it:
        // only a move to another page, or ink, makes a page the acted-on one (F23).
        if (page !== (focusRef.current ?? currentRef.current) || actedRef.current != null) steer(page);
        else setFocusPage(page);
        await ensureSize(page);
        // A page that fits between the top bar and the caption is framed whole and centered there,
        // whatever point on it is targeted (a slide stays fully visible while it is explained, and a
        // narrow column beside a sketch region doesn't leave it pinned high with its neighbour in view).
        if (y != null && !fits(page)) { await glideTo(page, () => contentY(page, y) - el.clientHeight * SCROLL_ANCHOR); return; }
        await glideTo(page, () => framedTop(page));
      },
      ensureVisible: async (page, y = 0) => {
        page = clampPage(page);
        await ensureSize(page);
        steer(page);
        if (inBand(contentY(page, y), true)) return false;
        // Already framed whole: the target is on screen, just near an edge of a centered page.
        if (fits(page) && Math.abs(el.scrollTop - Math.max(0, framedTop(page))) < 2 && inBand(contentY(page, y), false)) return false;
        await glideTo(page, () => (fits(page) ? framedTop(page) : contentY(page, y) - el.clientHeight * SCROLL_ANCHOR), REVEAL_MAX_MS);
        return true;
      },
      isVisible: (page, y = 0) => inBand(contentY(clampPage(page), y), false),
      whenVisible: (page, y = 0, maxMs = 1200) => {
        page = clampPage(page);
        if (inBand(contentY(page, y), false)) return Promise.resolve(true);
        return new Promise<boolean>((resolve) => {
          const check = () => { if (inBand(contentY(page, y), false)) finish(true); };
          const finish = (v: boolean) => { el.removeEventListener('scroll', check); window.clearTimeout(t); resolve(v); };
          const t = window.setTimeout(() => finish(false), maxMs);
          el.addEventListener('scroll', check, { passive: true });
        });
      },
      ensureSize: async (page) => { if (page >= 1 && page <= doc.numPages) await ensureSize(page); },
      cancelScroll: () => glide?.abort(),
      goToPage: async (page, opts) => {
        page = clampPage(page);
        const reason: GoReason = opts?.reason ?? 'student';
        if (reason === 'answer') { await api.scrollToPage(page); return; }
        intent(); // the student takes the view: follow pauses, the tutor's page is no longer the one in frame
        await ensureSize(page);
        // A long way off: cut to half a window short of the page, then glide in (no blur of 200 pages).
        const from = currentRef.current;
        if (Math.abs(page - from) > JUMP_CUT_PAGES && !prefersReducedMotion()) {
          glide?.abort();
          const dir = page > from ? 1 : -1;
          owner.write(el, Math.max(0, framedTop(page) - dir * el.clientHeight * 0.5));
          publishCurrent();
        }
        await glideTo(page, () => framedTop(page));
      },
      actedPage: () => actedRef.current,
      onActedChange: (cb) => { actedSubs.current.add(cb); return () => { actedSubs.current.delete(cb); }; },
      pageZoom: () => viewRef.current.zoom,
      setPageZoom: (z) => zoomTo(z),
      deskHost: () => host,
    };

    // Tutor ink landing on a page in view makes it the page acted on (a highlight on the slide already
    // in frame never scrolls, so scrollToPage alone would miss it). Student ink lives in .pv-overlay.
    const inkObserver = new MutationObserver((records) => {
      for (const r of records) {
        if (!r.addedNodes.length) continue;
        const t = r.target as Element;
        if (!t.closest?.('.pv-agent, .pv-highlight')) continue;
        const p = Number((t.closest('.pv-page') as HTMLElement | null)?.dataset.page);
        if (!p || p === actedRef.current) continue;
        const L = layoutRef.current;
        if (!L) continue;
        const top = el.scrollTop + SAFE_TOP, bottom = el.scrollTop + el.clientHeight - safeBottom();
        if (L.tops[p - 1] < bottom && L.tops[p - 1] + L.heights[p - 1] > top) setActedPage(p);
      }
    });
    if (sizerRef.current) inkObserver.observe(sizerRef.current, { childList: true, subtree: true });

    // ---- The desk host (src/desk/Desk.ts drives it) -------------------------------------------
    const subs = { scroll: new Set<() => void>(), intent: new Set<() => void>() };
    const sub = (set: Set<() => void>) => (cb: () => void) => { set.add(cb); return () => { set.delete(cb); }; };
    const intent = () => { if (focusRef.current != null) setFocusPage(null); setActedPage(null); subs.intent.forEach((f) => f()); };

    /** Glides the page column to a split state: pages slide and scale by transform, then re-lay out once. */
    const setSplit = (next: Split, ms: number) => new Promise<void>((done) => {
      if (prefersReducedMotion()) ms = 0;
      glideRef.current?.finish();
      const sizer = sizerRef.current, L = layoutRef.current;
      // The zoom carries over; a pan doesn't (the page's span changes with the split).
      const W = el.clientWidth, H = el.clientHeight, zoom = viewRef.current.zoom;
      const L2 = computeLayout(columnFor(frameFor(W, H, next, aspectsRef.current![0]), W, H, aspectsRef.current![0], zoom, 0).col, aspectsRef.current!, H);
      const commit = () => {
        // Re-measures too: the ResizeObserver skips measuring mid-glide, so a resize during one is caught up here.
        splitRef.current = next;
        flushSync(() => { setSplitState(next); setViewW(el.clientWidth); setViewH(el.clientHeight); setView((v) => (v.pan ? { ...v, pan: 0 } : v)); });
        renderer.renderW = layoutRef.current?.pageW ?? L2.pageW;
        renderer.pump();
      };
      if (!sizer || !L || ms <= 0 || (Math.abs(L2.pageW - L.pageW) < 0.5 && Math.abs(L2.pageX - L.pageX) < 0.5)) { commit(); done(); return; }
      const k = L2.pageW / L.pageW;
      const finish = () => {
        if (glideRef.current !== g) return;
        window.clearTimeout(g.timer);
        glideRef.current = null;
        // One synchronous swap: the new layout commits (the anchor keeps the reading line) and the
        // transform drops in the same frame, so nothing jumps.
        commit();
        sizer.style.transition = 'none';
        sizer.style.transform = '';
        done();
      };
      // Scale around the point that makes the transformed pages land where the new layout puts them
      // (x: the old column's left edge, which the translate carries to the new one; y: the reading line).
      const origin = () => {
        const a = anchorRef.current;
        let o = el.scrollTop + el.clientHeight * CURRENT_LINE;
        if (a && Math.abs(1 - k) > 1e-3) {
          const pOld = L.tops[a.page - 1] + a.frac * L.heights[a.page - 1];
          const pNew = L2.tops[a.page - 1] + a.frac * L2.heights[a.page - 1];
          const top = Math.max(0, Math.min(pNew - el.clientHeight * CURRENT_LINE, L2.total - el.clientHeight));
          o = (pNew - top + el.scrollTop - pOld * k) / (1 - k);
        }
        return `${L.pageX}px ${o}px`;
      };
      const g = { timer: 0, finish, origin, done };
      glideRef.current = g;
      sizer.style.transformOrigin = origin();
      sizer.style.transition = `transform ${ms}ms cubic-bezier(.2,.8,.2,1)`;
      sizer.style.transform = `translateX(${L2.pageX - L.pageX}px) scale(${k})`;
      g.timer = window.setTimeout(finish, ms + 40);
    });

    const host: DeskHost = {
      viewport: () => ({ W: el.clientWidth, H: el.clientHeight }),
      layout: () => layoutRef.current,
      scrollTop: () => el.scrollTop,
      maxScroll: () => Math.max(0, (layoutRef.current?.total ?? 0) - el.clientHeight),
      aspect: (page) => aspectsRef.current?.[clampPage(page) - 1] ?? 1.294,
      setSplit,
      glideTo: async (top, maxMs) => {
        glide?.abort();
        const ctrl = (glide = new AbortController());
        try { await animateScrollTo(el, top, { signal: ctrl.signal, maxMs, owner }); }
        finally { if (glide === ctrl) glide = null; publishCurrent(); }
      },
      cancelGlide: () => glide?.abort(),
      scrollToPage: (page, y) => api.scrollToPage(page, y),
      onLayout: (cb) => { layoutSubs.current.add(cb); return () => { layoutSubs.current.delete(cb); }; },
      onScroll: sub(subs.scroll),
      onUserIntent: sub(subs.intent),
      contentMask: (page) => renderer.mask(clampPage(page)),
      crop: (page, r, pxW) => renderer.crop(clampPage(page), r, pxW),
    };
    cbRef.current.onReady(api);

    return () => {
      glide?.abort();
      if (glideRef.current) { window.clearTimeout(glideRef.current.timer); glideRef.current.done(); glideRef.current = null; }
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('wheel', onUserScroll);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
      el.removeEventListener('touchstart', onUserScroll);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('keydown', onZoomKey, true);
      window.removeEventListener('keydown', onKey);
      if (wheelRaf) cancelAnimationFrame(wheelRaf);
      inkObserver.disconnect();
      zoomRef.current = null;
      window.visualViewport?.removeEventListener('resize', onZoom);
      if (raf) cancelAnimationFrame(raf);
      mq?.removeEventListener('change', onDpr);
      io.disconnect();
      ioRef.current = null;
      renderer.destroy();
      rendererRef.current = null;
    };
  }, [doc, ready, saveAnchor, setFocusPage, setActedPage]);

  // After a resize settles, re-render visible pages at the new width (CSS scales them meanwhile).
  const pageW = layout?.pageW ?? 0;
  useEffect(() => {
    const r = rendererRef.current;
    if (!r || pageW <= 0 || r.renderW === pageW) return;
    const t = window.setTimeout(() => { r.renderW = pageW; r.pump(); }, RESIZE_RERENDER_MS);
    return () => window.clearTimeout(t);
  }, [pageW]);

  const zoomed = Math.abs(view.zoom - 1) > 1e-3;
  return (
    <>
    <div ref={scrollRef} className={acted != null ? 'pv-scroll has-acted' : 'pv-scroll'} data-acted-page={acted ?? undefined} tabIndex={-1}>
      {layout && (
        <div
          ref={sizerRef}
          className="pv-sizer"
          // A page zoomed wider than its span is clipped to it (beside the board: to the slide column).
          style={{ height: layout.total, clipPath: column && column.maxPan > 0 ? `inset(0 ${Math.max(0, viewW - column.span.b)}px 0 ${column.span.a}px)` : undefined }}
        >
          {Array.from({ length: layout.tops.length }, (_, i) => (
            <PageSlot
              key={i + 1}
              page={i + 1}
              top={layout.tops[i]}
              left={layout.pageX}
              width={layout.pageW}
              height={layout.heights[i]}
              spaceH={1000 * aspectsRef.current![i]}
              register={register}
              renderOverlay={renderOverlay && Math.abs(i + 1 - center) <= OVERLAY_RADIUS ? stableOverlay : undefined}
              current={i + 1 === (focus ?? center)}
              acted={i + 1 === acted}
            />
          ))}
        </div>
      )}
    </div>
    {zoomed && frame && (
      <PageZoomControl
        zoom={view.zoom}
        right={ZOOM_INSET + Math.max(0, viewW - (frame.split === 'none' && column ? Math.min(column.col.pageX + column.col.pageW, column.span.b) : frame.slides.x + frame.slides.w))}
        onStep={(d) => zoomRef.current?.step(d)}
        onFit={() => zoomRef.current?.to(1)}
      />
    )}
    </>
  );
}

/** The page zoom control sits this far inside the slide column's bottom-right corner. */
const ZOOM_INSET = 8;
const MOD = isMacPlatform() ? '⌘' : 'Ctrl+';
const zoomIcon = (d: string) => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d={d} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" /></svg>
);

/** The page zoom, at the slide column's bottom-right above the dock; shown only while zoomed (Fit = 100%). */
function PageZoomControl({ zoom, right, onStep, onFit }: { zoom: number; right: number; onStep(dir: -1 | 1): void; onFit(): void }) {
  return (
    <div className="pv-zoom" role="group" aria-label="Page zoom" style={{ right }}>
      <button type="button" className="pv-zoom-btn" aria-label="Zoom out" title={`Zoom out (${MOD}−)`} disabled={zoom <= PAGE_ZOOM_MIN + 1e-3} onClick={() => onStep(-1)}>{zoomIcon('M3.5 8h9')}</button>
      <span className="pv-zoom-pct" aria-live="polite">{Math.round(zoom * 100)}%</span>
      <button type="button" className="pv-zoom-btn" aria-label="Zoom in" title={`Zoom in (${MOD}+)`} disabled={zoom >= PAGE_ZOOM_MAX - 1e-3} onClick={() => onStep(1)}>{zoomIcon('M3.5 8h9M8 3.5v9')}</button>
      <span className="pv-zoom-sep" aria-hidden="true" />
      <button type="button" className="pv-zoom-btn pv-zoom-fit" aria-label="Fit the page" title={`Fit (${MOD}0)`} onClick={onFit}>Fit</button>
    </div>
  );
}
