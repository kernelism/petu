import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import type { RenderTask } from 'pdfjs-dist';
import type { PdfDoc } from './loadPdf';
import type { PageLayers, ViewerApi } from './viewerApi';
import type { TextRun } from '../locate/locateQuote';
import { getTextRuns } from './textRuns';
import { animateScrollTo } from './scroll';
import { prefersReducedMotion } from '../ink/agent/animate';
import { PageSlot, type SlotHandle } from './PageSlot';
import './viewer.css';

type Props = {
  doc: PdfDoc;
  onReady(api: ViewerApi): void;
  onPageChange(page: number): void;
  renderOverlay?(page: number, spaceH: number): ReactNode;
};

const TOP_PAD = 72;
const BOTTOM_PAD = 200;
const GAP = 24;
const MAX_W = 860;
const SIDE = 64;
const MIN_W = 200;
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
/** Window chrome that covers the scroller: top bar above, caption + ask bar below (CSS px). */
const SAFE_TOP = 64;
const SAFE_BOTTOM = 156;
const RESIZE_RERENDER_MS = 160;
/** A reveal (making an ink target visible) glides at most this long. */
const REVEAL_MAX_MS = 450;

const dpr = () => Math.min(2, window.devicePixelRatio || 1);
/** Page width for a scroller of `w` CSS px. */
const fitWidth = (w: number) => Math.max(MIN_W, Math.min(w - SIDE, MAX_W));

// ---------------------------------------------------------------------------------------------
// Layout: absolute tops computed in JS, so scroll math never has to read the DOM.

type Layout = { pageW: number; tops: Float64Array; heights: Float64Array; total: number };

function computeLayout(pageW: number, aspects: Float64Array): Layout {
  const n = aspects.length;
  const tops = new Float64Array(n);
  const heights = new Float64Array(n);
  let y = TOP_PAD;
  for (let i = 0; i < n; i++) {
    tops[i] = y;
    heights[i] = pageW * aspects[i];
    y += heights[i] + (i < n - 1 ? GAP : 0);
  }
  return { pageW, tops, heights, total: y + BOTTOM_PAD };
}

/** 1-based page whose slot (including the gap below it) contains content-y `y`. */
function pageAt(L: Layout, y: number): number {
  let lo = 0, hi = L.tops.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (L.tops[mid] <= y) lo = mid; else hi = mid - 1;
  }
  return lo + 1;
}

// ---------------------------------------------------------------------------------------------
// Renderer: owns every canvas. Renders pages near the viewport, closest-to-current first, at most
// MAX_INFLIGHT at a time; cancels renders for pages that scroll away; frees far canvases.

/** key = what the shown canvas was rendered at; taskKey = what an in-flight render targets ('' if none). */
type PageState = { canvas: HTMLCanvasElement | null; key: string; task: RenderTask | null; taskKey: string };

class PageRenderer {
  near = new Set<number>();
  /** Pages wanted regardless of the viewport (destinations of programmatic scrolls), refcounted. */
  pinned = new Map<number, number>();
  private states = new Map<number, PageState>();
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
      const page = await this.doc.getPage(p);
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
      if ((err as { name?: string })?.name !== 'RenderingCancelledException') console.warn(`page ${p} render failed`, err);
    } finally {
      if (canvas) zap(canvas);
      if (s.taskKey === key) { s.task = null; s.taskKey = ''; }
      this.inflight--;
      this.pump();
    }
  }

  release(p: number) {
    const s = this.states.get(p);
    if (!s) return;
    s.task?.cancel();
    if (s.canvas) { s.canvas.remove(); zap(s.canvas); }
    this.states.delete(p);
    // Drop the page's operator list and decoded images; getPage re-fetches cheaply later.
    void this.doc.getPage(p).then((pg) => pg.cleanup()).catch(() => {});
  }

  destroy() {
    this.dead = true;
    for (const p of [...this.states.keys()]) this.release(p);
  }
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
  const [pageW, setPageW] = useState(0);
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
    void doc.getPage(1).then((p) => {
      if (!live) return;
      const vp = p.getViewport({ scale: 1 });
      aspectsRef.current = new Float64Array(doc.numPages).fill(vp.height / vp.width);
      setAspectsVersion((v) => v + 1);
    }).catch((e) => console.warn('[viewer] could not read page 1', e));
    return () => { live = false; };
  }, [doc]);

  // Fit-to-width, tracked with a ResizeObserver.
  useLayoutEffect(() => {
    const el = scrollRef.current!;
    const measure = () => setPageW(fitWidth(el.clientWidth));
    measure();
    const ro = new ResizeObserver(() => { if (!glideRef.current) measure(); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(
    () => (pageW > 0 && aspectsRef.current ? computeLayout(pageW, aspectsRef.current) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pageW, aspectsVersion],
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
      if (Math.abs(el.scrollTop - want) > 0.5) el.scrollTop = want;
    }
    saveAnchor();
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
      saveAnchor();
      // A scroll during a column glide: keep scaling around the current reading line.
      if (glideRef.current && sizerRef.current) sizerRef.current.style.transformOrigin = glideRef.current.origin();
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; publishCurrent(); });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    // The reader taking over (wheel, touch, keys) ends the agent's focus page.
    const onUserScroll = () => { if (focusRef.current != null) setFocusPage(null); };
    el.addEventListener('wheel', onUserScroll, { passive: true });
    el.addEventListener('touchstart', onUserScroll, { passive: true });
    el.addEventListener('keydown', onUserScroll);
    currentRef.current = computeCurrent();
    setCenter(currentRef.current);

    // Re-render at a new DPR when the window moves between displays.
    let mq: MediaQueryList | null = null;
    const onDpr = () => { watchDpr(); renderer.pump(); };
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
        r = doc.getPage(page).then((p) => getTextRuns(p));
        r.catch(() => runsCache.delete(page));
        runsCache.set(page, r);
      }
      return r;
    };

    const clampPage = (p: number) => Math.max(1, Math.min(doc.numPages, Math.round(p)));
    /** Makes sure `page`'s true size is in the layout (and committed to the DOM) before scroll math. */
    const ensureSize = async (page: number) => {
      const p = await doc.getPage(page);
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
        await animateScrollTo(el, top, { signal: ctrl.signal, maxMs });
      } finally {
        renderer.unpin(page);
        if (glide === ctrl) glide = null;
        publishCurrent();
      }
    };
    /** Whether `page` fits whole between the top bar and the caption. */
    const fits = (page: number) => layoutRef.current!.heights[page - 1] <= el.clientHeight - SAFE_TOP - SAFE_BOTTOM;
    /** Scroll top that shows `page` whole, centered in the room between the chrome (or its top aligned when it doesn't fit). */
    const framedTop = (page: number) => {
      const L = layoutRef.current!;
      const room = el.clientHeight - SAFE_TOP - SAFE_BOTTOM;
      return L.tops[page - 1] - SAFE_TOP - Math.max(0, (room - L.heights[page - 1]) / 2);
    };
    /** The comfortable band for ink: clear of the chrome, and of the outer 15% when `strict`. */
    const inBand = (at: number, strict: boolean) => {
      const top = el.scrollTop, h = el.clientHeight;
      const lo = strict ? Math.max(h * VISIBLE_BAND, SAFE_TOP) : SAFE_TOP;
      const hi = strict ? Math.max(h * VISIBLE_BAND, SAFE_BOTTOM) : SAFE_BOTTOM;
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
        // narrow column next to the board doesn't leave it pinned high with its neighbour in view).
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
      frameCurrent: async () => {
        const page = focusRef.current ?? currentRef.current;
        if (!layoutRef.current || !fits(page)) return;
        if (Math.abs(el.scrollTop - Math.max(0, framedTop(page))) < 2) return;
        await glideTo(page, () => framedTop(page), REVEAL_MAX_MS);
      },
      glideColumn: (width, ms) => new Promise<void>((done) => {
        if (prefersReducedMotion()) ms = 0;
        glideRef.current?.finish();
        const sizer = sizerRef.current, L = layoutRef.current;
        if (!sizer || !L) { done(); return; }
        const target = fitWidth(width);
        const finish = () => {
          if (glideRef.current !== g) return;
          done();
          window.clearTimeout(g.timer);
          glideRef.current = null;
          // One synchronous swap: the new layout commits (the anchor keeps the reading line) and the
          // transform drops in the same frame, so nothing jumps. Canvases re-render once, at the new width.
          flushSync(() => setPageW(fitWidth(el.clientWidth)));
          sizer.style.transition = 'none';
          sizer.style.transform = '';
          renderer.renderW = layoutRef.current?.pageW ?? target;
          renderer.pump();
        };
        // Scale around the point that makes the transformed pages land exactly where the new layout
        // will put them. Usually that's the reading line; near the end of the document the new layout
        // can't scroll that far (shorter content), and the origin absorbs that clamp so nothing snaps.
        const origin = () => {
          const a = anchorRef.current, k = target / L.pageW;
          let o = el.scrollTop + el.clientHeight * CURRENT_LINE;
          if (a && Math.abs(1 - k) > 1e-3) {
            const L2 = computeLayout(target, aspectsRef.current!);
            const pOld = L.tops[a.page - 1] + a.frac * L.heights[a.page - 1];
            const pNew = L2.tops[a.page - 1] + a.frac * L2.heights[a.page - 1];
            const top = Math.max(0, Math.min(pNew - el.clientHeight * CURRENT_LINE, L2.total - el.clientHeight));
            o = (pNew - top + el.scrollTop - pOld * k) / (1 - k);
          }
          return `50% ${o}px`;
        };
        const g = { timer: 0, finish, origin, done };
        glideRef.current = g;
        sizer.style.transformOrigin = origin();
        sizer.style.transition = `transform ${ms}ms cubic-bezier(.2,.8,.2,1)`;
        sizer.style.transform = `scale(${target / L.pageW})`;
        // A little past the CSS transition, so the column has reached its final width when we measure.
        g.timer = window.setTimeout(finish, ms + 40);
      }),
    };
    cbRef.current.onReady(api);

    return () => {
      glide?.abort();
      if (glideRef.current) { window.clearTimeout(glideRef.current.timer); glideRef.current.done(); glideRef.current = null; }
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('wheel', onUserScroll);
      el.removeEventListener('touchstart', onUserScroll);
      el.removeEventListener('keydown', onUserScroll);
      if (raf) cancelAnimationFrame(raf);
      mq?.removeEventListener('change', onDpr);
      io.disconnect();
      ioRef.current = null;
      renderer.destroy();
      rendererRef.current = null;
    };
  }, [doc, ready, saveAnchor, setFocusPage]);

  // After a resize settles, re-render visible pages at the new width (CSS scales them meanwhile).
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
              width={layout.pageW}
              height={layout.heights[i]}
              spaceH={1000 * aspectsRef.current![i]}
              register={register}
              renderOverlay={renderOverlay && Math.abs(i + 1 - center) <= OVERLAY_RADIUS ? stableOverlay : undefined}
              current={i + 1 === (focus ?? center)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
