// src/playback/director.ts
import { REGION_H, REGION_W, targetOf, type Action, type InkAction, type LayoutAction, type Target } from '../script/types';
import type { ViewerApi } from '../pdf/viewerApi';
import { rectToSpace, toSpace, type SRect } from '../geometry/space';
import { rng } from '../ink/agent/strokes';
import { fadeOut } from '../ink/agent/marks';
import type { Settings } from '../settings/settings';
import { Registry } from '../desk/registry';
import { regionRuns } from '../desk/runs';
import { buildElement } from '../desk/elements';
import { preloadMath } from '../desk/math';
import type { BuildElement, BuildEnv, DeskApi, ElementPlan, TargetCtx } from '../desk/types';

/** Ink actions sharing a word start this far apart, in order. */
export const STAGGER_MS = 120;
/** No single step of an action (resolving it, drawing it, a pan) may hold its lane longer. */
export const ACTION_TIMEOUT_MS = 3000;
/** Rule 1: before the view moves, ink in flight gets this long to land; then it completes at once. */
export const LAND_MS = 150;

/**
 * Timing of one action, for the ?debug panel and the audit. All times are performance.now() ms.
 * firedAt: when the action's word is spoken (it may be queued up to its lead earlier, at queuedAt).
 * startedAt: when its visible work began (a pan, or the first ink).
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
export const isLayout = (a: Action): a is LayoutAction => a.kind === 'scroll' || a.kind === 'sketch' || a.kind === 'clear';

type Deps = {
  viewer: () => ViewerApi | null;
  desk: () => DeskApi | null;
  settings: () => Settings;
  onScrolledTo(page: number): void;
  /** Resolves ink actions into plans. Default: the drawing toolkit. Tests inject fakes. */
  build?: BuildElement;
  /** Debug hook: called when an action starts executing and again when it ends. */
  onTiming?(t: ActionTiming): void;
};

type LaneKind = 'scroll' | 'sketch' | 'clear' | 'reveal' | 'frame';
type LaneEntry = { kind: LaneKind; started: Promise<void>; done: Promise<void> };

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));
const now = () => performance.now();
const WHOLE_REGION: SRect = { x: 0, y: 0, w: REGION_W, h: REGION_H };
/** Built ahead of the word: page ink whose anchor can resolve early. Everything else is built on its word. */
const buildsEarly = (a: InkAction) => a.kind !== 'connect' && !('ref' in a) && a.region == null;

/**
 * Executes actions against the desk in two lanes:
 * - a serial layout lane: scrolls, sketches (region placement), reveals, connector framing, clear;
 * - concurrent ink: each ink action waits only for the most recent layout action queued before it
 *   (until its target is on screen), then starts on its word, whatever earlier ink is doing.
 */
export class Director {
  private ctrl = new AbortController();
  private lane: Promise<void> = Promise.resolve();
  private last: LaneEntry | null = null;
  private stagger = { at: NaN, n: 0 };
  private seed = 1;
  private gen = 0;
  private busy = 0;
  private idlers: (() => void)[] = [];
  /** Draws in flight, for landing them before the view moves (rule 1). */
  private drawing = new Map<AbortController, Promise<string | void | 'timeout'>>();
  /** Set by begin(): the fade ms of a desk reset deferred to the new answer's first layout or ink action. */
  private pendingReset: number | null = null;
  readonly registry = new Registry();
  constructor(private d: Deps) {}
  private desk(): DeskApi | null { return this.d.desk(); }

  /** Runs `a`, whose word starts at `at` (performance.now() ms; default now). */
  run(a: Action, at: number = now()): void {
    const signal = this.ctrl.signal;
    const t: ActionTiming = { action: a, firedAt: at, queuedAt: now(), startedAt: NaN };
    if (this.pendingReset != null) this.resetFor(a, signal);
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

  /** Warms caches as soon as an action is parsed: a page's text runs, KaTeX. */
  prefetch(a: Action): void {
    if (a.kind === 'math') { void preloadMath().catch(() => {}); return; }
    const v = this.d.viewer();
    if (!v) return;
    const pages: number[] = [];
    if (a.kind === 'connect') for (const e of [a.from, a.to]) if ('quote' in e) pages.push(e.page);
    if ('quote' in a && a.page != null) pages.push(a.page);
    for (const p of pages) if (p >= 1 && p <= v.numPages()) void v.textRuns(p).catch(() => {});
  }

  stop(): void {
    this.ctrl.abort();
    this.ctrl = new AbortController();
    this.lane = Promise.resolve();
    this.last = null;
    this.stagger = { at: NaN, n: 0 };
    this.drawing.clear();
    this.pendingReset = null; // an answer stopped before it acted leaves the desk as it is
    this.desk()?.abort(); // pans stop, and no desk move in flight (a column glide, entering B) lands later
    this.gen++;
    this.busy = 0;
    this.flushIdle();
  }

  /**
   * Starts a new answer: stops the old one, clears the registry and fades the old page marks out. The
   * fade sits at the head of the layout lane, so the caller can start streaming right away.
   * The desk (regions, wires, lanes, B) is reset later, by the new answer's first layout or ink action
   * (rule 8; see resetFor), so the old regions stay up until the new answer touches the page or desk,
   * and an answer that ends without acting leaves them as they are.
   */
  begin(ms = 300): Promise<void> {
    this.stop();
    this.registry.clear();
    this.pendingReset = ms;
    const e = this.enqueueLayout('clear', () => this.fadePage(ms), this.ctrl.signal);
    this.track(e.done);
    return e.done;
  }

  /** {{clear}}: fades the page marks and resets the desk. */
  async clear(ms = 300): Promise<void> {
    this.registry.clear();
    const desk = this.desk();
    await Promise.all([this.fadePage(ms), desk ? desk.reset(ms) : null]);
  }

  private async fadePage(ms: number): Promise<void> {
    const v = this.d.viewer();
    const groups = v ? v.allLayers().flatMap((l) => [l.highlight, l.agent]) : [];
    if (groups.length) await fadeOut(groups, ms);
  }

  /**
   * The new answer's first action resets the desk begin() left up, through the layout lane, so the
   * action (and ink queued after it) waits for it. A sketch keeps the lanes, so the column doesn't
   * glide back to center and out again; {{clear}} resets the desk itself.
   */
  private resetFor(a: Action, signal: AbortSignal) {
    const ms = this.pendingReset!;
    this.pendingReset = null;
    if (a.kind === 'clear') return;
    const opts = a.kind === 'sketch' ? { keepLanes: true } : undefined;
    const e = this.enqueueLayout('clear', async () => { const desk = this.desk(); if (desk) await (opts ? desk.reset(ms, opts) : desk.reset(ms)); }, signal);
    this.track(e.done);
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

  private enqueueLayout(kind: LaneKind, fn: (signal: AbortSignal) => Promise<unknown>, signal: AbortSignal): LaneEntry {
    let markStarted = () => {};
    const started = new Promise<void>((r) => { markStarted = r; });
    const done = this.lane
      .then(async () => {
        markStarted();
        if (signal.aborted) return;
        if ((await this.guarded(fn, signal)) === 'timeout') console.warn('[director] layout step timed out', kind);
      })
      .catch((e) => console.warn('[director]', e))
      .finally(markStarted);
    const e: LaneEntry = { kind, started, done };
    this.lane = done;
    this.last = e;
    return e;
  }

  /**
   * Rule 1: strokes are never split across a pan. Ink in flight gets LAND_MS, then completes at once.
   * Passed to the desk as its before-move hook, so it runs only when the view actually moves.
   */
  private land = async (): Promise<void> => {
    if (!this.drawing.size) return;
    await Promise.race([Promise.all(this.drawing.values()), wait(LAND_MS)]);
    for (const c of this.drawing.keys()) c.abort();
  };

  private async execLayout(a: LayoutAction, signal: AbortSignal): Promise<string | void> {
    if (a.kind === 'clear') return this.clear();
    const desk = this.desk();
    if (!desk) return 'no desk';
    const v = this.d.viewer();
    if (!v || a.page < 1 || a.page > v.numPages()) { if (a.kind === 'sketch') console.warn('[director] sketch skipped: page out of range', a.id); return 'page out of range'; }
    if (a.kind === 'sketch') {
      // Lands ink in flight only if placing the region moves the view (a column glide, entering B).
      const r = await desk.addRegion({ id: a.id, page: a.page, size: a.size, place: a.place }, this.land);
      if (typeof r === 'string') { console.warn('[director] sketch skipped:', r, a.id); return r; }
      return;
    }
    if (!desk.following()) return 'student is driving'; // rule 6
    await this.land(); // a scroll always moves the view
    if (signal.aborted) return;
    this.d.onScrolledTo(a.page); // the page indicator names the destination as the glide starts
    await desk.scrollToPage(a.page, a.y);
  }

  /** The toolkit's view of a target: a page (through the viewer) or a region (through the desk). */
  private ctx = async (t: Target): Promise<TargetCtx | string> => {
    if (t.region != null) {
      const r = this.desk()?.region(t.region);
      if (!r) { console.warn('[director] unknown region', t.region); return 'unknown region'; }
      return {
        target: t, layers: r.layers, h: REGION_H, scale: r.scale,
        toSpace: (p) => p, rectToSpace: (x) => x, runs: async () => regionRuns(r.layers.agent),
      };
    }
    const v = this.d.viewer();
    if (!v) return 'no viewer';
    const page = t.page;
    if (page < 1 || page > v.numPages()) return 'page out of range';
    await v.ensureSize(page); // the page's true size, before any page-space math
    const L = v.layers(page);
    if (!L) return 'no layers';
    const H = v.spaceHeight(page);
    return {
      target: t, layers: L, h: H, scale: () => v.scale(page),
      toSpace: (p) => toSpace(p, H), rectToSpace: (r) => rectToSpace(r, H), runs: () => v.textRuns(page),
    };
  };

  private env(): BuildEnv | null {
    const desk = this.desk();
    if (!desk) return null;
    const s = this.d.settings();
    return { ctx: this.ctx, registry: this.registry, settings: s, desk, rng: () => (s.inkStyle === 'hand' ? rng(this.seed++) : null) };
  }

  /** Builds with the per-step timeout. Strings are skip reasons. */
  private async build(a: InkAction, env: BuildEnv, signal: AbortSignal): Promise<ElementPlan | string> {
    const r = await this.guarded(() => (this.d.build ?? buildElement)(a, env), signal);
    return r === 'timeout' ? 'timeout' : r;
  }

  /** Waits until ink may start relative to the layout queued before it: the step is over, or its target is already on screen. */
  private async afterLayout(dep: LaneEntry, desk: DeskApi, t: Target | null, r: SRect | null, signal: AbortSignal) {
    if (!desk.following() && (dep.kind === 'scroll' || dep.kind === 'reveal' || dep.kind === 'frame')) return; // rule 6: no view to wait for
    if (t && r && desk.following() && (dep.kind === 'scroll' || dep.kind === 'reveal')) {
      await Promise.race([dep.done, dep.started.then(() => (signal.aborted ? false : desk.whenVisible(t, r)))]);
    } else await dep.done;
  }

  /** Rule 1/2: pans through the layout lane when the box is off screen; resolves once it shows. Not while the student drives (rule 6). */
  private async reveal(desk: DeskApi, t: Target, r: SRect, signal: AbortSignal, anchor?: SRect) {
    if (!desk.following() || desk.isVisible(t, r)) return;
    // Visibility is re-checked by the desk when the step runs, and ink lands only if the view then moves.
    const e = this.enqueueLayout('reveal', async () => { await desk.reveal(t, r, this.land, anchor); }, signal);
    await Promise.race([e.done, e.started.then(() => (signal.aborted ? false : desk.whenVisible(t, r)))]);
  }

  /** Page ink that starts from a point (a line's start, an angle's vertex): what a box too tall for the view keeps in it. */
  private anchorOf(a: InkAction): SRect | undefined {
    const t = targetOf(a);
    if (!t || t.page == null) return undefined;
    const p = a.kind === 'line' || a.kind === 'arrow' || a.kind === 'brace' ? a.from : a.kind === 'angle' ? a.at : null;
    const v = this.d.viewer();
    if (!p || !v) return undefined;
    const s = toSpace(p, v.spaceHeight(t.page));
    return { x: s.x - 20, y: s.y - 20, w: 40, h: 40 };
  }

  private async ink(a: InkAction, t: ActionTiming, startAt: number, dep: LaneEntry | null, signal: AbortSignal) {
    const finish = (skipped?: string | void) => {
      if (Number.isNaN(t.startedAt)) t.startedAt = now();
      this.report(t, { endedAt: now(), skipped: skipped || undefined });
    };
    const env = this.env(), desk = this.desk();
    if (!env || !desk) return finish('no desk');
    const target = targetOf(a);

    // Page ink resolves its anchor while layout runs (text runs are prefetched).
    let plan: ElementPlan | string | undefined;
    if (buildsEarly(a)) {
      plan = await this.build(a, env, signal);
      if (signal.aborted) return;
      if (typeof plan === 'string') return finish(plan);
    }
    // Region ink reveals its whole region (rule 2), so text written just before is measurable on the word.
    const early = typeof plan === 'object' ? plan : null;
    const box: SRect | null = early ? early.bbox : target?.region != null ? WHOLE_REGION : null;

    if (dep) await this.afterLayout(dep, desk, target, box, signal);
    if (signal.aborted) return;
    if (target && box) await this.reveal(desk, target, box, signal, this.anchorOf(a));
    if (signal.aborted) return;

    await wait(startAt - now());
    if (signal.aborted) return;
    if (!plan) {
      plan = await this.build(a, env, signal);
      if (signal.aborted) return;
      if (typeof plan === 'string') return finish(plan);
      // A connector frames both ends together (rule 3); a late element off screen pans now.
      if (plan.also) {
        const p = plan;
        const e = this.enqueueLayout('frame', async () => { await desk.frameBoth({ t: p.target, r: p.bbox }, { t: p.also!.target, r: p.also!.bbox }, this.land); }, signal);
        if (desk.following()) await e.done;
      } else await this.reveal(desk, plan.target, plan.bbox, signal, this.anchorOf(a));
      if (signal.aborted) return;
    }
    if (typeof plan !== 'object') return finish('no plan');
    const p = plan;
    desk.noteInk?.(p.target, p.bbox);
    const k = backlog(now() - t.firedAt);
    this.report(t, { startedAt: now() });
    const own = new AbortController();
    const onAbort = () => own.abort();
    signal.addEventListener('abort', onAbort);
    const drawing: Promise<string | void | 'timeout'> = this.guarded((sig) => { sig.addEventListener('abort', () => own.abort()); return p.draw(own.signal, k); }, signal);
    this.drawing.set(own, drawing);
    const r = await drawing;
    this.drawing.delete(own);
    signal.removeEventListener('abort', onAbort);
    if (signal.aborted) return;
    finish(r === 'timeout' ? 'timeout' : r);
  }
}
