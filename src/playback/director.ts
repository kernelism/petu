import { BOARD_PAGE, type Action } from '../script/types';
import type { ViewerApi } from '../pdf/viewerApi';
import { toSpace, rectToSpace } from '../geometry/space';
import { circleStroke, lineStroke, arrowStrokes, boxStroke, rng, type Stroke } from '../ink/agent/strokes';
import { drawStrokes, prefersReducedMotion } from '../ink/agent/animate';
import { drawLabel, drawHighlight, fadeOut } from '../ink/agent/marks';
import { locateQuote } from '../locate/locateQuote';
import type { Settings } from '../settings/settings';
import { BOARD_INK, type BoardHandle } from '../board/boardText';

const SVG = 'http://www.w3.org/2000/svg';
/** Closed shapes (circle, box) read as rushed below this, however small they are… */
const CLOSED_MIN_MS = 400;
/** …unless the ink is behind the narration: then they may go down to this. */
const CLOSED_FLOOR_MS = 180;
/** Ink actions sharing a word start this far apart, in order. */
export const STAGGER_MS = 120;
/** No single step of an action (resolving its anchor, drawing it, a scroll) may hold its lane longer. */
export const ACTION_TIMEOUT_MS = 3000;
/** Board ink waits at most this long after the board starts opening (its layers are always mounted). */
export const BOARD_INK_WAIT_MS = 150;

/**
 * Timing of one action, for the ?debug panel. All times are performance.now() ms.
 * firedAt: when the action's word is spoken (it may be queued up to its lead earlier, at queuedAt).
 * startedAt: when its visible work began (a glide, or the first ink).
 */
export type ActionTiming = { action: Action; firedAt: number; queuedAt: number; startedAt: number; endedAt?: number; skipped?: string };

/**
 * Backlog compression: ink that starts `lagMs` after its word draws faster, down to 35% of its
 * nominal time at 520ms+ behind; past 1200ms it fades in quickly instead of tracing.
 */
export function backlog(lagMs: number): { speed: number; fadeMs?: number } {
  const speed = Math.min(1, Math.max(0.35, 1 - Math.max(0, lagMs) / 800));
  return lagMs > 1200 ? { speed, fadeMs: 120 } : { speed };
}

/** Layout actions run one after another; everything else is ink, which runs concurrently. */
export const isLayout = (a: Action): a is Extract<Action, { kind: 'scroll' | 'board' | 'clear' }> =>
  a.kind === 'scroll' || a.kind === 'board' || a.kind === 'clear';

type Deps = {
  viewer: () => ViewerApi | null;
  settings: () => Settings;
  onScrolledTo(page: number): void;
  /** Opens the board if needed; resolves when its glide is over (immediately when already open). */
  openBoard?(): Promise<void>;
  board?(): BoardHandle | null;
  /** Lets the app hold the actions queued from now on, while the layout is about to change. */
  gate?(): Promise<void> | null;
  /** Debug hook: called when an action starts executing and again when it ends. */
  onTiming?(t: ActionTiming): void;
};

type LaneKind = 'scroll' | 'board' | 'clear' | 'gate' | 'reveal';
type LaneEntry = { kind: LaneKind; started: Promise<void>; done: Promise<void> };
type Geometry = { draw(signal: AbortSignal, k: { speed: number; fadeMs?: number }): Promise<string | void>; y?: number };

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));
const now = () => performance.now();

/**
 * Executes actions against the viewer in two lanes:
 * - a serial layout lane: scrolls, reveals, board open/close, clear, and the app's board gate;
 * - concurrent ink: each ink action waits only for the most recent layout action queued before it,
 *   then starts on its word (actions arrive up to their lead early), whatever earlier ink is doing.
 */
export class Director {
  private ctrl = new AbortController();
  private lane: Promise<void> = Promise.resolve();
  private last: LaneEntry | null = null;
  private lastGate: Promise<void> | null = null;
  private stagger = { at: NaN, n: 0 };
  private seed = 1;
  private gen = 0;
  private busy = 0;
  private idlers: (() => void)[] = [];
  constructor(private d: Deps) {}

  /** Runs `a`, whose word starts at `at` (performance.now() ms; default now). */
  run(a: Action, at: number = now()): void {
    const signal = this.ctrl.signal;
    const gate = this.d.gate?.();
    if (gate && gate !== this.lastGate) {
      this.lastGate = gate;
      this.track(this.enqueueLayout('gate', () => gate, signal, false).done);
    }
    const t: ActionTiming = { action: a, firedAt: at, queuedAt: now(), startedAt: NaN };
    if (isLayout(a)) {
      const e = this.enqueueLayout(a.kind, async (sig) => {
        this.report(t, { startedAt: now() });
        const skipped = await this.execLayout(a, sig);
        this.report(t, { endedAt: now(), skipped: skipped || undefined });
      }, signal);
      this.track(e.done);
      return;
    }
    if (Math.abs(at - this.stagger.at) < 1) this.stagger.n++;
    else this.stagger = { at, n: 0 };
    const startAt = at + this.stagger.n * STAGGER_MS;
    this.track(this.ink(a, t, startAt, this.last, signal).catch((e) => console.warn('[director]', e)));
  }

  /** Resolves when every queued action has finished (immediately when nothing is queued). */
  idle(): Promise<void> {
    return this.busy === 0 ? Promise.resolve() : new Promise((r) => this.idlers.push(r));
  }

  /** Warms the text-run cache for an action's page as soon as it is parsed, so anchors resolve instantly when it fires. */
  prefetch(a: Action): void {
    if (a.kind === 'clear' || !('quote' in a) || a.page === BOARD_PAGE) return; // board runs are measured live
    const v = this.d.viewer();
    if (v && a.page >= 1 && a.page <= v.numPages()) void v.textRuns(a.page).catch(() => {});
  }

  stop(): void {
    this.ctrl.abort();
    this.ctrl = new AbortController();
    this.lane = Promise.resolve();
    this.last = null;
    this.lastGate = null;
    this.stagger = { at: NaN, n: 0 };
    this.d.viewer()?.cancelScroll?.();
    this.gen++;
    this.busy = 0;
    this.flushIdle();
  }

  /**
   * Starts a new answer: stops the old one and fades its ink out. The fade sits at the head of the
   * layout lane, so the caller can start streaming right away and the first action still waits for it.
   */
  begin(ms = 300): Promise<void> {
    this.stop();
    const e = this.enqueueLayout('clear', () => this.clear(ms), this.ctrl.signal);
    this.track(e.done);
    return e.done;
  }

  async clear(ms = 300): Promise<void> {
    const v = this.d.viewer();
    if (!v) return;
    const groups = v.allLayers().flatMap((l) => [l.highlight, l.agent]);
    if (groups.length) await fadeOut(groups, ms);
  }

  // -----------------------------------------------------------------------------------------------

  private report(t: ActionTiming, patch: Partial<ActionTiming>) {
    Object.assign(t, patch);
    this.d.onTiming?.({ ...t });
  }

  private track(p: Promise<unknown>) {
    const gen = this.gen;
    this.busy++;
    void p.catch(() => {}).then(() => {
      if (gen !== this.gen) return;
      if (--this.busy === 0) this.flushIdle();
    });
  }

  private flushIdle() {
    const w = this.idlers;
    this.idlers = [];
    w.forEach((r) => r());
  }

  /** Runs `fn` with a child signal that aborts on stop or after ACTION_TIMEOUT_MS. */
  private async guarded<T>(fn: (signal: AbortSignal) => Promise<T>, parent: AbortSignal): Promise<T | 'timeout'> {
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    parent.addEventListener('abort', onAbort);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        fn(ac.signal),
        new Promise<'timeout'>((r) => { timer = setTimeout(() => { ac.abort(); r('timeout'); }, ACTION_TIMEOUT_MS); }),
      ]);
    } finally {
      clearTimeout(timer);
      parent.removeEventListener('abort', onAbort);
    }
  }

  private enqueueLayout(kind: LaneKind, fn: (signal: AbortSignal) => Promise<unknown>, signal: AbortSignal, timeout = true): LaneEntry {
    let markStarted = () => {};
    const started = new Promise<void>((r) => { markStarted = r; });
    const done = this.lane
      .then(async () => {
        markStarted();
        if (signal.aborted) return;
        if (timeout) {
          if ((await this.guarded(fn, signal)) === 'timeout') console.warn('[director] layout step timed out', kind);
        } else await fn(signal);
      })
      .catch((e) => console.warn('[director]', e))
      .finally(markStarted);
    const e: LaneEntry = { kind, started, done };
    this.lane = done;
    this.last = e;
    return e;
  }

  private async execLayout(a: Extract<Action, { kind: 'scroll' | 'board' | 'clear' }>, signal: AbortSignal): Promise<string | void> {
    if (a.kind === 'clear') return this.clear();
    if (a.kind === 'board') return this.d.openBoard ? this.d.openBoard() : 'no board';
    const v = this.d.viewer();
    if (!v) return 'no viewer';
    if (a.page < 1 || a.page > v.numPages()) return 'page out of range';
    this.d.onScrolledTo(a.page); // the page indicator names the destination as the glide starts
    await v.scrollToPage(a.page, a.y);
    if (signal.aborted) return;
  }

  /** Waits until ink may start relative to its layout dependency `dep`. */
  private async afterLayout(dep: LaneEntry, onBoard: boolean, v: ViewerApi, page: number, y: number | undefined, signal: AbortSignal) {
    if (onBoard && dep.kind === 'board') {
      await Promise.race([dep.done, dep.started.then(() => wait(BOARD_INK_WAIT_MS))]);
    } else if (!onBoard && (dep.kind === 'scroll' || dep.kind === 'reveal') && y != null) {
      // Ink may start once its target is on screen, even while the page is still moving.
      await Promise.race([dep.done, dep.started.then(() => (signal.aborted ? false : v.whenVisible(page, y)))]);
    } else await dep.done;
  }

  private async ink(a: Exclude<Action, { kind: 'scroll' | 'board' | 'clear' }>, t: ActionTiming, startAt: number, dep: LaneEntry | null, signal: AbortSignal) {
    const finish = (skipped?: string | void) => {
      if (Number.isNaN(t.startedAt)) t.startedAt = now();
      this.report(t, { endedAt: now(), skipped: skipped || undefined });
    };
    const v = this.d.viewer();
    if (!v) return finish('no viewer');
    const onBoard = a.page === BOARD_PAGE;
    if (onBoard && !this.d.openBoard) return finish('no board');
    if (!onBoard && (a.page < 1 || a.page > v.numPages())) { console.warn('[director] page out of range', a); return finish('page out of range'); }

    // PDF anchors resolve while waiting for layout (they are prefetched). Board anchors resolve on
    // the word, so text written just before is already there to find.
    let geo: Geometry | undefined;
    if (!onBoard) {
      const r = await this.guarded((sig) => this.geometry(a, v, sig), signal);
      if (signal.aborted) return;
      if (r === 'timeout') return finish('timeout');
      if (typeof r === 'string') return finish(r);
      geo = r;
    }

    if (dep) await this.afterLayout(dep, onBoard, v, a.page, geo?.y, signal);
    if (signal.aborted) return;
    if (onBoard) {
      // Board ink with no {{board}} before it opens the board itself (idempotent once it is open).
      const opening = this.d.openBoard!();
      if (dep?.kind !== 'board') await Promise.race([opening, wait(BOARD_INK_WAIT_MS)]);
      if (signal.aborted) return;
    } else if (geo && geo.y != null && !v.isVisible(a.page, geo.y)) {
      // Reveal through the layout lane, so it never fights a scroll; draw as soon as the target shows.
      const page = a.page, y = geo.y;
      const r = this.enqueueLayout('reveal', async () => { if (await v.ensureVisible(page, y)) this.d.onScrolledTo(page); }, signal);
      await Promise.race([r.done, r.started.then(() => (signal.aborted ? false : v.whenVisible(page, y)))]);
      if (signal.aborted) return;
    }

    await wait(startAt - now());
    if (signal.aborted) return;
    if (onBoard) {
      const r = await this.guarded((sig) => this.geometry(a, v, sig), signal);
      if (signal.aborted) return;
      if (r === 'timeout') return finish('timeout');
      if (typeof r === 'string') return finish(r);
      geo = r;
    }
    const k = backlog(now() - t.firedAt);
    this.report(t, { startedAt: now() });
    const g = geo!;
    const r = await this.guarded((sig) => g.draw(sig, k), signal);
    if (signal.aborted) return;
    finish(r === 'timeout' ? 'timeout' : r);
  }

  /** Resolves an ink action to a draw function plus the model-y that must be on screen. Strings are skip reasons. */
  private async geometry(a: Exclude<Action, { kind: 'scroll' | 'board' | 'clear' }>, v: ViewerApi, signal: AbortSignal): Promise<Geometry | string> {
    const onBoard = a.page === BOARD_PAGE;
    if (!onBoard) await v.ensureSize(a.page); // the page's true size, before any page-space math
    if (signal.aborted) return 'aborted';
    const L = v.layers(a.page);
    if (!L) return 'no layers';
    const H = v.spaceHeight(a.page);
    const s = this.d.settings();
    const r = s.inkStyle === 'hand' ? rng(this.seed++) : null;
    // Board ink is dark unless emphasized; on PDF pages the accent ink stands out from the print.
    const color = onBoard && !('em' in a && a.em) ? BOARD_INK : s.inkColor;
    const fade = s.inkStyle === 'clean' || prefersReducedMotion();
    // Each action draws into its own group. clear() detaches these, so a mark still animating
    // from a stopped answer keeps writing into a detached node instead of reappearing.
    const own = (parent: SVGGElement) => parent.appendChild(document.createElementNS(SVG, 'g'));
    const ink = (strokes: Stroke[], closed = false) => (sig: AbortSignal, k: { speed: number; fadeMs?: number }) =>
      drawStrokes(own(L.agent), strokes, {
        color, width: s.inkStyle === 'hand' ? 3.4 : 3, scale: v.scale(a.page), signal: sig,
        mode: fade || k.fadeMs != null ? 'fade' : 'trace', fadeMs: k.fadeMs,
        minMs: closed ? CLOSED_MIN_MS : undefined,
        speed: closed ? Math.max(k.speed, CLOSED_FLOOR_MS / CLOSED_MIN_MS) : k.speed,
      });
    const anchorRects = async (quote: string, near?: { x: number; y: number }) => locateQuote(await v.textRuns(a.page), quote, near);

    switch (a.kind) {
      case 'highlight':
      case 'underline': {
        const rects = await anchorRects(a.quote, a.near);
        if (!rects.length) { console.warn('[director] quote not found', a.quote); return 'quote not found'; }
        const sr = rects.map((x) => rectToSpace(x, H));
        const y = rects[0].y + rects[0].h / 2;
        if (a.kind === 'highlight') return { y, draw: (_sig, k) => drawHighlight(own(L.highlight), sr, s.highlightColor, 0.5, k.speed) };
        return { y, draw: ink(sr.map((x) => lineStroke({ x: x.x, y: x.y + x.h + 2 }, { x: x.x + x.w, y: x.y + x.h + 2 }, r))) };
      }
      case 'circle':
      case 'box': {
        // Anchored form: resolve text → bounding box in page space (exact). Otherwise use coordinates.
        let box: { x: number; y: number; w: number; h: number };
        let y: number;
        if ('quote' in a) {
          const rects = await anchorRects(a.quote, a.near);
          if (!rects.length) { console.warn('[director] anchor not found', a.quote); return 'anchor not found'; }
          const sr = rects.map((x) => rectToSpace(x, H));
          const x1 = Math.min(...sr.map((q) => q.x)), y1 = Math.min(...sr.map((q) => q.y));
          const x2 = Math.max(...sr.map((q) => q.x + q.w)), y2 = Math.max(...sr.map((q) => q.y + q.h));
          box = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
          y = rects[0].y + rects[0].h / 2;
        } else if (a.kind === 'circle') {
          const c = toSpace(a.at, H);
          box = { x: c.x - a.rx, y: c.y - a.ry, w: a.rx * 2, h: a.ry * 2 };
          y = a.at.y;
        } else {
          const p = toSpace(a.at, H);
          box = { x: p.x, y: p.y, w: a.w, h: (a.h * H) / 1000 };
          y = a.at.y + a.h / 2;
        }
        const anchored = 'quote' in a;
        if (a.kind === 'circle') {
          // Pad anchored text so the loop sits around it, not on it; keep tiny targets readable.
          const rx = anchored ? Math.max(12, box.w / 2 + 10) : box.w / 2;
          const ry = anchored ? Math.max(12, box.h / 2 + 8) : box.h / 2;
          return { y, draw: ink([circleStroke({ x: box.x + box.w / 2, y: box.y + box.h / 2 }, rx, ry, r)], true) };
        }
        const pad = anchored ? 10 : 0;
        return { y, draw: ink([boxStroke(box.x - pad, box.y - pad, box.w + pad * 2, box.h + pad * 2, r)], true) };
      }
      case 'line':
        return { y: (a.from.y + a.to.y) / 2, draw: ink([lineStroke(toSpace(a.from, H), toSpace(a.to, H), r)]) };
      case 'arrow':
        return { y: (a.from.y + a.to.y) / 2, draw: ink(arrowStrokes(toSpace(a.from, H), toSpace(a.to, H), r)) };
      case 'label':
        return { y: a.at.y, draw: () => drawLabel(own(L.agent), toSpace(a.at, H), a.text, s.inkStyle, color) };
      case 'write': {
        const b = this.d.board?.();
        if (!b) return 'no board';
        return { draw: (sig, k) => b.write(toSpace(a.at, H), a.text, a.size, { style: s.inkStyle, signal: sig, speed: k.speed, fadeMs: k.fadeMs }) };
      }
    }
  }
}
