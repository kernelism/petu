import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import type { RenderTask } from 'pdfjs-dist';
import type { PdfDoc } from './loadPdf';
import type { PageLayers, ViewerApi } from './viewerApi';
import type { TextRun } from '../locate/locateQuote';
import { getTextRuns } from './textRuns';
import { canvasMask } from './contentMask';
import type { ContentMask } from '../desk/route';
import { animateScrollTo } from './scroll';
import { prefersReducedMotion } from '../ink/agent/animate';
import { ink } from '../ink/student/store';
import { PageSlot, type SlotHandle } from './PageSlot';
import { column, computeLayout, pageAt, SAFE_TOP, safeBottom, TOP_PAD, type Lanes, type PageLayout } from '../desk/layout';
import { ScrollOwner, isScrollKey } from '../desk/follow';
import type { DeskHost, StageRect } from '../desk/types';
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
  /** The scroller's width; the page column follows from it and the lanes the desk reserves. */
  const [viewW, setViewW] = useState(0);
  const [lanes, setLanes] = useState<Lanes>({ left: 0, right: 0 });
  const [gaps, setGaps] = useState<ReadonlyMap<number, number>>(() => new Map());
  const deskLayerRef = useRef<HTMLDivElement>(null);
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
    const measure = () => setViewW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(() => { if (!glideRef.current) measure(); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(
    () => (viewW > 0 && aspectsRef.current ? computeLayout(column(viewW, lanes), aspectsRef.current, gaps) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viewW, lanes, gaps, aspectsVersion],
  );

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
    if (a) {
      const want = layout.tops[a.page - 1] + a.frac * layout.heights[a.page - 1] - el.clientHeight * CURRENT_LINE;
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
      if (owner.isForeign(el.scrollTop, el.scrollHeight - el.clientHeight) && cardPage == null) intent(); // scrollbar drag, find-in-page, focus…
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
    el.addEventListener('wheel', onUserScroll, { passive: true });
    el.addEventListener('touchstart', onUserScroll, { passive: true });
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
    /** Scroll top that shows `page` whole, centered in the room between the chrome (or its top aligned when it doesn't fit). */
    const framedTop = (page: number) => {
      const L = layoutRef.current!;
      const room = el.clientHeight - SAFE_TOP - safeBottom();
      return L.tops[page - 1] - SAFE_TOP - Math.max(0, (room - L.heights[page - 1]) / 2);
    };
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
        setFocusPage(page);
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
        setFocusPage(page);
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
      deskHost: () => host,
    };

    // ---- The desk host (src/desk/Desk.ts drives it) -------------------------------------------
    const subs = { scroll: new Set<() => void>(), intent: new Set<() => void>(), card: new Set<() => void>() };
    const sub = (set: Set<() => void>) => (cb: () => void) => { set.add(cb); return () => { set.delete(cb); }; };
    const intent = () => { if (focusRef.current != null) setFocusPage(null); subs.intent.forEach((f) => f()); };

    /** Glides the page column to new lanes / below-gaps: pages slide and scale by transform, then re-lay out once. */
    const setColumn = (next: Lanes, nextGaps: ReadonlyMap<number, number>, ms: number) => new Promise<void>((done) => {
      if (prefersReducedMotion()) ms = 0;
      glideRef.current?.finish();
      const sizer = sizerRef.current, L = layoutRef.current;
      const L2 = computeLayout(column(el.clientWidth, next), aspectsRef.current!, nextGaps);
      const commit = () => {
        // Re-measures too: the ResizeObserver skips measuring mid-glide, so a resize during one is caught up here.
        flushSync(() => { setLanes(next); setGaps(nextGaps); setViewW(el.clientWidth); });
        renderer.renderW = column(el.clientWidth, next).pageW;
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

    /**
     * B: the scroller itself becomes the reference card. Its box grows to hold the whole card page
     * (the scroller clips to its box before the transform), scrollTop puts that page TOP_PAD below
     * the box top, and a compensating translate keeps it where it was; then it transitions onto the card.
     */
    let cardPage: number | null = null;
    /** The card's current transform, so asking for the same card again costs nothing. */
    let cardTo = '';
    /** The page pinned for the card (still pinned while an exit glides). */
    let pinned: number | null = null;
    /** Bumped by every setCard call: a call bails after each await once a newer one started (an exit mid-entry, a re-entry mid-exit). */
    let cardSeq = 0;
    const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    const setCard = async (card: { page: number; rect: StageRect } | null, ms: number) => {
      const seq = ++cardSeq;
      const stale = () => seq !== cardSeq;
      if (prefersReducedMotion()) ms = 0;
      // A card swap superseded mid-fade must not leave the scroller invisible.
      if (el.style.opacity === '0') { el.style.transition = 'none'; el.style.opacity = '1'; }
      const L = layoutRef.current;
      if (!L) return;
      const ease = 'cubic-bezier(.2,.8,.2,1)';
      if (card) {
        const k = card.rect.w / L.pageW;
        // Where the card page sits in the scroller's box after its scrollTop write: TOP_PAD, unless
        // the write was clamped (a last page in a tall window can't scroll that far), so the
        // transform lands the page itself on the card rect either way.
        const at = (i: number) => L.tops[i] - el.scrollTop;
        const toFor = (i: number) => `translate(${card.rect.x - L.pageX * k}px, ${card.rect.y - at(i) * k}px) scale(${k})`;
        if (cardPage === card.page) {
          // Already the card (B re-entry, another B region, a resize): only move to the new rect, if
          // it moved. Never re-run the entry from the page's scroller position (a jump, and ~430ms).
          const i = card.page - 1;
          el.style.height = `${Math.max(el.clientHeight, L.heights[i] + 2 * TOP_PAD)}px`;
          if (Math.abs(el.scrollTop - (L.tops[i] - TOP_PAD)) > 0.5) owner.write(el, L.tops[i] - TOP_PAD);
          const to = toFor(i);
          if (cardTo === to) return;
          cardTo = to;
          el.style.transition = ms > 0 ? `transform ${ms}ms ${ease}` : 'none';
          el.style.transform = to;
          if (ms > 0) await wait(ms);
          return;
        }
        const swap = cardPage != null && cardPage !== card.page;
        if (swap) { el.style.transition = 'opacity 120ms ease-out'; el.style.opacity = '0'; await wait(120); if (stale()) return; }
        const i = card.page - 1;
        const onScreen = L.tops[i] - el.scrollTop; // where the page is now (stage px)
        // Re-entering the same page mid-exit: start from where the exit glide has got to, not from the box.
        const midExit = !swap && pinned === card.page && el.classList.contains('is-b') ? getComputedStyle(el).transform : '';
        el.classList.add('is-b');
        el.style.transition = 'none';
        el.style.height = `${Math.max(el.clientHeight, L.heights[i] + 2 * TOP_PAD)}px`;
        owner.write(el, L.tops[i] - TOP_PAD);
        el.style.transformOrigin = '0 0';
        el.style.transform = swap ? '' : midExit && midExit !== 'none' ? midExit : `translate(0px, ${onScreen - at(i)}px)`;
        if (pinned != null && pinned !== card.page) renderer.unpin(pinned);
        if (pinned !== card.page) renderer.pin(card.page);
        pinned = card.page;
        const to = toFor(i);
        for (const h of slots.current.values()) h.el.toggleAttribute('data-card', Number(h.el.dataset.page) === card.page);
        cardPage = card.page;
        cardTo = to;
        await frame();
        if (stale()) return; // an exit (or another card) started meanwhile: its transform wins
        el.style.transition = swap ? `opacity 180ms ease-out` : `transform ${ms}ms ${ease}`;
        el.style.transform = to;
        el.style.opacity = '1';
        await wait(swap ? 180 : ms);
        return;
      }
      if (cardPage == null) return;
      // Back: glide the card to where the page will sit framed in the scroller, then drop B in one frame.
      // Marked leaving at once, so a re-entry during the glide runs the full entry instead of the same-card fast path.
      const p = cardPage, i = p - 1;
      cardPage = null;
      cardTo = '';
      const target = Math.max(0, Math.min(fits(p) ? framedTop(p) : L.tops[i] - SAFE_TOP, L.total - el.clientHeight));
      el.style.transition = `transform ${ms}ms ${ease}`;
      el.style.transform = `translate(0px, ${el.scrollTop - target}px)`; // the page, from where it sits in the box to where it will
      await wait(ms);
      if (stale()) return; // re-entered B meanwhile: the entry owns the scroller now
      el.style.transition = 'none';
      el.style.transform = '';
      el.style.height = '';
      el.classList.remove('is-b');
      for (const h of slots.current.values()) h.el.removeAttribute('data-card');
      owner.write(el, target);
      if (pinned != null) renderer.unpin(pinned);
      pinned = null;
    };
    const onCardClick = (e: MouseEvent) => {
      if (cardPage == null || ink.get().canvasOn) return;
      if ((e.target as HTMLElement).closest?.('.pv-page[data-card]')) subs.card.forEach((f) => f());
    };
    el.addEventListener('click', onCardClick);

    const host: DeskHost = {
      // In B (until an exit glide has dropped it) the scroller's box is grown to hold the card page.
      viewport: () => ({ W: el.clientWidth, H: el.classList.contains('is-b') ? window.innerHeight : el.clientHeight }),
      layout: () => layoutRef.current,
      scrollTop: () => el.scrollTop,
      maxScroll: () => Math.max(0, (layoutRef.current?.total ?? 0) - el.clientHeight),
      aspect: (page) => aspectsRef.current?.[clampPage(page) - 1] ?? 1.294,
      layer: () => deskLayerRef.current!,
      setColumn,
      glideTo: async (top, maxMs) => {
        glide?.abort();
        const ctrl = (glide = new AbortController());
        try { await animateScrollTo(el, top, { signal: ctrl.signal, maxMs, owner }); }
        finally { if (glide === ctrl) glide = null; publishCurrent(); }
      },
      cancelGlide: () => glide?.abort(),
      scrollToPage: (page, y) => api.scrollToPage(page, y),
      setCard,
      onLayout: (cb) => { layoutSubs.current.add(cb); return () => { layoutSubs.current.delete(cb); }; },
      onScroll: sub(subs.scroll),
      onUserIntent: sub(subs.intent),
      onCardClick: sub(subs.card),
      contentMask: (page) => renderer.mask(clampPage(page)),
    };
    cbRef.current.onReady(api);

    return () => {
      glide?.abort();
      if (glideRef.current) { window.clearTimeout(glideRef.current.timer); glideRef.current.done(); glideRef.current = null; }
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('wheel', onUserScroll);
      el.removeEventListener('touchstart', onUserScroll);
      window.removeEventListener('keydown', onKey);
      window.visualViewport?.removeEventListener('resize', onZoom);
      el.removeEventListener('click', onCardClick);
      if (raf) cancelAnimationFrame(raf);
      mq?.removeEventListener('change', onDpr);
      io.disconnect();
      ioRef.current = null;
      renderer.destroy();
      rendererRef.current = null;
    };
  }, [doc, ready, saveAnchor, setFocusPage]);

  // After a resize settles, re-render visible pages at the new width (CSS scales them meanwhile).
  const pageW = layout?.pageW ?? 0;
  useEffect(() => {
    const r = rendererRef.current;
    if (!r || pageW <= 0 || r.renderW === pageW) return;
    const t = window.setTimeout(() => { r.renderW = pageW; r.pump(); }, RESIZE_RERENDER_MS);
    return () => window.clearTimeout(t);
  }, [pageW]);

  return (
    <div ref={scrollRef} className="pv-scroll" tabIndex={-1}>
      {layout && (
        <div ref={sizerRef} className="pv-sizer" style={{ height: layout.total }}>
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
            />
          ))}
          {/* Sketch regions and connectors (C) live here, in the pages' coordinate frame: they scroll natively. */}
          <div ref={deskLayerRef} className="desk-layer" />
        </div>
      )}
    </div>
  );
}
