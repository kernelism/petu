// src/playback/director.ts
import { mountBoard } from '../svgboard/render';
import { REGION_H, REGION_W, targetOf, type Action, type InkAction, type LayoutAction, type RawAction, type Target } from '../script/types';
import { Figures, type Grounding } from '../geometry/resolve';
import type { ViewerApi } from '../pdf/viewerApi';
import { rectToSpace, toSpace, type SRect } from '../geometry/space';
import { rng } from '../ink/agent/strokes';
import { fadeOut, retireOut } from '../ink/agent/marks';
import type { Settings } from '../settings/settings';
import { Registry } from '../desk/registry';
import { kitStore } from '../desk/kit/kit';
import { liveGeo } from '../desk/live';
import { regionRuns } from '../desk/runs';
import { buildElement } from '../desk/elements';
import { preloadMath } from '../desk/math';
import type { BuildElement, BuildEnv, DeskApi, ElementPlan, Pace, TargetCtx } from '../desk/types';
import { bodyFraction } from '../desk/layout';
import { meaningfulUnit, type Unit } from '../locate/unit';
import { journeyBeat } from './parts';

/** Ink actions sharing a word start this far apart, in order. */
export const STAGGER_MS = 120;
/** No single step of an action (resolving it, drawing it, a pan) may hold its lane longer. */
export const ACTION_TIMEOUT_MS = 3000;
/** A connector to a section whose tag comes a moment later waits at most this long for it to be laid out. */
export const REGION_WAIT_MS = 4000;
/** Rule 1: before the view moves, ink in flight gets this long to land; then it completes at once. */
export const LAND_MS = 150;
/**
 * A journey (a move to a page that isn't adjacent): the narration waits this long at the move's word.
 * The scroll fires 450ms ahead of the word (actionLeadMs) and glides ≤ 600ms, so it lands by about
 * word + 150–300ms; with the arrival rest the destination is settled by the time the narration goes on.
 * (Was 800 + 350: founder 2026-10-28 "feels slow".)
 */
export const JOURNEY_HOLD_MS = 500;
/** After a journey's scroll lands, the view rests this long before the destination's first mark draws. */
export const ARRIVAL_MS = 200;
/** While ink waits on a word that may move (pause, speed), it re-reads the word's time this often. */
const LIVE_POLL_MS = 50;
/** Actions this far behind their word (a seek's fast-forward) travel without a journey beat. */
const LATE_MS = 1000;

/** A move to another page that isn't next to the one in view: announced, held and rested on. */
export type Journey = { from: number; to: number; at: number };

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
  /** Page marks (#d3, #s2, #t12) of the context sent with the question. Default: none. */
  grounding?: () => Grounding;
  /** A journey starts (the view is about to travel): the app shows the route. */
  onJourney?(j: Journey): void;
  /** Asks the narration for `ms` of silence before the first word at or after `at` (the arrival beat). */
  hold?(at: number, ms: number): void;
  /** Words of the answer said before `at` (an action's word time): a move before the first word frames the answer, it isn't a journey. Default: some. */
  spoken?(at: number): number;
  /** The narration of the current beat with word times (Scheduler.beatWords): an svg group paces its parts to it. */
  beat?(): { text: string; inMs: number }[];
  /** Highlights and underlines grow to meaningful units (src/locate/unit.ts). Default on. */
  units?: boolean;
  /**
   * The live gate's shadow board: no waiting on words, layout or pans; ink lands in its final state
   * at once (drawn with a pre-aborted signal) and skips are reported as usual.
   */
  instant?: boolean;
};
const NO_GROUNDING: Grounding = { mark: () => undefined };

type LaneKind = 'scroll' | 'sketch' | 'clear' | 'reveal' | 'frame';
/** `journey`: set when a scroll turns out to travel (ink after it waits for the arrival); `arrivedAt` then. */
type LaneEntry = { kind: LaneKind; started: Promise<void>; done: Promise<void>; journey?: boolean; arrivedAt?: number };

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));
const now = () => performance.now();
const WHOLE_REGION: SRect = { x: 0, y: 0, w: REGION_W, h: REGION_H };
/** Built ahead of the word: page ink whose anchor can resolve early. Everything else is built on its word. */
const buildsEarly = (a: InkAction) => a.kind !== 'connect' && !('ref' in a) && a.region == null;

/**
 * Executes actions against the desk in two lanes:
 * - a serial layout lane: scrolls, sketches (board sections), reveals, connector framing, clear;
 * - concurrent ink: each ink action waits only for the most recent layout action queued before it
 *   (until its target is on screen), then starts on its word, whatever earlier ink is doing.
 */
/** Svg board sections opened in this page (their ids stay unique on the board: answers, asides, the shadow). */
let svgBoardN = 0;

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
  /** Named points and fitted regions of the current answer (relational geometry). */
  readonly figures: Figures;
  constructor(private d: Deps) {
    const g = () => this.d.grounding?.() ?? NO_GROUNDING;
    this.figures = new Figures({ mark: (p, id) => g().mark(p, id), aspect: (p) => g().aspect?.(p), obstacles: (p) => g().obstacles?.(p) ?? [] }, () => kitStore(this.registry).consts);
  }
  private desk(): DeskApi | null { return this.d.desk(); }

  /**
   * Runs `a`, whose word starts at `at` (performance.now() ms; default now). Raw actions (names,
   * page marks, rays, fitted regions) resolve to plain ones here: layout at once, ink when built.
   * `live`: the word's start as it stands now (null while the narration is paused); ink waits for it
   * rather than for `at`, so a pause or a speed change after the action fired keeps ink on its word.
   */
  run(raw: RawAction, at: number = now(), live?: () => number | null): void {
    // The svg board: a board section gets its id here (in order, before layout runs), and each group
    // draws into the latest board.
    if (raw.kind === 'sketch' && raw.svgboard) raw = { ...raw, id: raw.svgboard.extend && this.svgBoard ? this.svgBoard : (this.svgBoard = `svgb${++svgBoardN}`) };
    if (raw.kind === 'svg') {
      if (!this.svgBoard) { this.report({ action: raw as Action, firedAt: at, queuedAt: now(), startedAt: now(), endedAt: now() }, { skipped: 'no svg board' }); return; }
      raw = { ...raw, region: this.svgBoard };
    }
    if (raw.kind === 'let') return; // definitions were taken when it was parsed (prefetch)
    if (raw.kind === 'const') { if (!this.seen.has(raw)) kitStore(this.registry).defineConsts(raw.defs); return; }
    if (raw.kind === 'find') { if (!this.seen.has(raw)) { this.figures.note(raw); kitStore(this.registry).finds.set(raw.id, raw); } return; }
    // A bound number is a word, not ink: the parser said it. Unresolved, the caption shows a dash: recorded as a skip.
    if (raw.kind === 'val') {
      if (raw.said == null) this.report({ action: raw as unknown as Action, firedAt: at, queuedAt: now(), startedAt: now(), endedAt: now() }, { skipped: `unbound value ${raw.ref}` });
      return;
    }
    if (!this.seen.has(raw)) this.figures.note(raw); // callers that skip prefetch (tests, demos)
    if (raw.kind === 'sketch') this.declared.add(raw.id);
    const isInk = !isLayout(raw as Action);
    const a = (isInk ? raw : this.figures.resolve(raw)) as Action;
    this.runResolved(a, raw, at, live);
  }

  /** The svg board this answer draws into (a section id; numbered across directors, so an aside's never collides). */
  private svgBoard: string | null = null;

  private seen = new WeakSet<object>();
  /** Section ids some parsed tag of this answer declares (a connector may name one a moment before its tag). */
  private declared = new Set<string>();

  /** Waits (bounded) until every section a connector names that a later tag declares is on the desk. */
  private async sectionsFor(a: InkAction, desk: DeskApi, signal: AbortSignal): Promise<void> {
    if (a.kind !== 'connect' || this.d.instant) return;
    const ids = [a.from, a.to].flatMap((e) => ('region' in e && this.declared.has(e.region) ? [e.region] : []));
    const t0 = now();
    while (ids.some((id) => !desk.region(id)) && now() - t0 < REGION_WAIT_MS && !signal.aborted) await wait(50);
  }
  /**
   * Holds asked for by journeys: words from `from` on were pushed back `ms` at `time`. Ink fired
   * before a hold, for a word at or after it, carries the old word time: it moves with its word.
   */
  private holds: { from: number; ms: number; time: number }[] = [];
  private heldMs(t: ActionTiming, at: number): number {
    return this.holds.reduce((n, h) => (t.queuedAt <= h.time && at >= h.from - 1 ? n + h.ms : n), 0);
  }

  private runResolved(a: Action, raw: RawAction, at: number, live?: () => number | null): void {
    const signal = this.ctrl.signal;
    const t: ActionTiming = { action: a, firedAt: at, queuedAt: now(), startedAt: NaN };
    if (this.pendingReset != null) this.resetFor(a, signal);
    if (isLayout(a)) {
      const e: LaneEntry = this.enqueueLayout(a.kind, async (sig) => {
        this.report(t, { startedAt: now() });
        const skipped = await this.execLayout(a, sig, e, at);
        this.report(t, { endedAt: now(), skipped: skipped || undefined });
      }, signal);
      this.track(e.done);
      return;
    }
    if (Math.abs(at - this.stagger.at) < 1) this.stagger.n++;
    else this.stagger = { at, n: 0 };
    const startAt = at + this.stagger.n * STAGGER_MS;
    this.track(this.ink(a, raw, t, startAt, this.last, signal, live).catch((e) => console.warn('[director]', e)));
  }

  /** Resolves when every queued action has finished (immediately when nothing is queued). */
  idle(): Promise<void> {
    return this.busy === 0 ? Promise.resolve() : new Promise((r) => this.idlers.push(r));
  }

  /** The answer's last ink has landed: a scene it drew in eases out to its overview (then 'done'). */
  async finale(): Promise<void> {
    await this.idle();
    const signal = this.ctrl.signal;
    if (!signal.aborted) await this.desk()?.overview?.();
  }

  /** As soon as an action is parsed: takes its point definitions (lookahead), warms caches (text runs, KaTeX). */
  prefetch(raw: RawAction): void {
    if (raw.kind === 'svg') return;
    this.seen.add(raw);
    if (raw.kind === 'sketch') this.declared.add(raw.id);
    if (raw.kind === 'const') { kitStore(this.registry).defineConsts(raw.defs); return; }
    if (raw.kind === 'find') kitStore(this.registry).finds.set(raw.id, raw);
    this.figures.note(raw);
    if (raw.kind === 'val' || raw.kind === 'find') return;
    if (raw.kind === 'let' || 'mark' in raw || 'through' in raw) return;
    const a = raw as Action;
    if (a.kind === 'math') { void preloadMath().catch(() => {}); return; }
    const v = this.d.viewer();
    if (!v) return;
    const pages: number[] = [];
    if (a.kind === 'connect') for (const e of [a.from, a.to]) if ('quote' in e) pages.push(e.page);
    if ('quote' in a && a.page != null) pages.push(a.page);
    if (a.kind === 'sketch') pages.push(a.page ?? v.currentPage()); // its body text sizes the section
    for (const p of pages) if (p >= 1 && p <= v.numPages()) void v.textRuns(p).catch(() => {});
  }

  stop(): void {
    this.ctrl.abort();
    this.ctrl = new AbortController();
    this.lane = Promise.resolve();
    this.last = null;
    this.stagger = { at: NaN, n: 0 };
    this.drawing.clear();
    this.registry.settle(); // kit animations (a sweep) land in their end state
    this.pendingReset = null; // an answer stopped before it acted leaves the desk as it is
    this.holds = [];
    this.declared.clear();
    this.desk()?.abort(); // pans stop, and no desk move in flight (a column glide, entering B) lands later
    this.gen++;
    this.busy = 0;
    this.flushIdle();
  }

  /**
   * Starts a new answer: stops the old one, clears the registry and fades the old page marks out. The
   * fade sits at the head of the layout lane, so the caller can start streaming right away.
   * The desk (connectors, this answer's ids) is reset later, by the new answer's first layout or ink
   * action (rule 8; see resetFor), so an answer that ends without acting leaves it as it is. The board
   * itself persists across answers.
   */
  begin(ms = 300): Promise<void> {
    this.stop();
    this.registry.clear();
    this.figures.clear();
    this.pendingReset = ms;
    const e = this.enqueueLayout('clear', () => this.fadePage(ms), this.ctrl.signal);
    this.track(e.done);
    return e.done;
  }

  /** {{clear}}: fades the page marks and resets the desk. */
  async clear(ms = 300): Promise<void> {
    this.registry.clear();
    const desk = this.desk();
    await Promise.all([this.fadePage(ms, false), desk ? desk.reset(ms) : null]);
  }

  /** A new answer's fade keeps the last one's marks as past marks (hidden; M shows them); {{clear}} removes them. */
  private async fadePage(ms: number, keep = true): Promise<void> {
    const v = this.d.viewer();
    const groups = v ? v.allLayers().flatMap((l) => [l.highlight, l.agent]) : [];
    if (groups.length) await (keep ? retireOut : fadeOut)(groups, ms);
  }

  /**
   * The new answer's first action resets the desk begin() left up, through the layout lane, so the
   * action (and ink queued after it) waits for it; {{clear}} resets the desk itself.
   */
  private resetFor(a: Action, signal: AbortSignal) {
    const ms = this.pendingReset!;
    this.pendingReset = null;
    if (a.kind === 'clear') return;
    const e = this.enqueueLayout('clear', async () => { await this.desk()?.reset(ms); }, signal);
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

  private async execLayout(a: LayoutAction, signal: AbortSignal, entry?: LaneEntry, at = now()): Promise<string | void> {
    if (a.kind === 'clear') return this.clear();
    const desk = this.desk();
    if (!desk) return 'no desk';
    const v = this.d.viewer();
    if (!v) return 'no viewer';
    if (a.kind === 'sketch') {
      // The slide the section explains: `near=` when given and in range, else the one in view.
      const page = a.page != null && a.page >= 1 && a.page <= v.numPages() ? a.page : v.currentPage();
      const body = await this.bodyOf(v, page);
      if (signal.aborted) return;
      // Lands ink in flight only if opening the board moves the view (the split glide, a board scroll).
      const r = await desk.addRegion({ id: a.id, page, size: a.size, body, ...(a.scene ? { scene: true } : {}), ...(a.svgboard ? { svg: true, h: (a.svgboard.h * REGION_W) / (a.svgboard.w || REGION_W), ...(a.svgboard.extend ? { extend: true } : {}) } : {}) }, this.land);
      if (typeof r === 'string') { console.warn('[director] sketch skipped:', r, a.id); return r; }
      if (a.svgboard) {
        const { height } = mountBoard(r.layers.agent, a.svgboard, a.id, this.d.settings().inkColor);
        if (height > REGION_H) desk.growRegion?.(a.id, height);
      }
      return;
    }
    if (a.page < 1 || a.page > v.numPages()) return 'page out of range';
    if (!desk.following()) return 'student is driving'; // rule 6
    // A journey: the route is shown, the narration holds at the move's word, and ink waits for the arrival.
    const from = v.currentPage();
    const journey = !this.d.instant && journeyBeat(from, a.page, this.d.spoken?.(at) ?? Infinity) && now() - at < LATE_MS;
    if (journey && entry) entry.journey = true;
    if (journey) {
      this.d.onJourney?.({ from, to: a.page, at });
      if (this.d.hold) { this.d.hold(at, JOURNEY_HOLD_MS); this.holds.push({ from: at, ms: JOURNEY_HOLD_MS, time: now() }); }
    }
    await this.land(); // a scroll always moves the view
    if (signal.aborted) return;
    this.d.onScrolledTo(a.page); // the page indicator names the destination as the glide starts
    await desk.scrollToPage(a.page, a.y);
    if (journey && !signal.aborted) {
      await wait(ARRIVAL_MS); // the arrival beat: the page rests before anything draws on it
      if (entry) entry.arrivedAt = now();
    }
  }

  /** The slide's body text size (a fraction of the page width) from its text layer; null when it has none. Never waits long. */
  private async bodyOf(v: ViewerApi, page: number): Promise<number | null> {
    try {
      const runs = await Promise.race([v.textRuns(page), wait(400).then(() => null)]);
      return runs ? bodyFraction(runs, v.spaceHeight(page) / 1000) : null;
    } catch { return null; }
  }

  /** The toolkit's view of a target: a page (through the viewer) or a region (through the desk). */
  private ctx = async (t: Target): Promise<TargetCtx | string> => {
    if (t.region != null) {
      const r = this.desk()?.region(t.region);
      if (!r) { console.warn('[director] unknown region', t.region); return 'unknown region'; }
      return {
        target: t, layers: r.layers, h: REGION_H, scale: r.scale, body: r.body, ...(r.scene ? { scene: r.scene } : {}),
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
  private async buildPlain(a: InkAction, env: BuildEnv, signal: AbortSignal): Promise<ElementPlan | string> {
    const r = await this.guarded(() => this.buildUnit(a, env), signal);
    return r === 'timeout' ? 'timeout' : r;
  }

  /**
   * Page highlights and underlines mark meaningful units: a fragment grows to its sentence, bullet
   * or equation (one mark per line, swept in reading order), then the quoted words are highlighted
   * again inside it (the multiply layer deepens them). The quoted words keep the action's id.
   */
  private async buildUnit(a: InkAction, env: BuildEnv): Promise<ElementPlan | string> {
    const build = this.d.build ?? buildElement;
    if ((a.kind !== 'highlight' && a.kind !== 'underline') || a.page == null || a.region != null || this.d.units === false) return build(a, env);
    const unit = await this.unitOf(a.page, a.quote, a.near);
    if (!unit) return build(a, env);
    const pieces = (await Promise.all(unit.pieces.map((p) => build({ ...a, id: undefined, quote: p.quote, near: p.near } as InkAction, env))))
      .filter((p): p is ElementPlan => typeof p === 'object');
    if (!pieces.length) return build(a, env);
    const inner = unit.inner ? await build({ ...a, kind: 'highlight', quote: unit.inner.quote, near: unit.inner.near } as InkAction, env) : null;
    const plans = [...pieces, ...(inner && typeof inner === 'object' ? [inner] : [])];
    const xs = plans.map((p) => p.bbox);
    const x = Math.min(...xs.map((b) => b.x)), y = Math.min(...xs.map((b) => b.y));
    const bbox = { x, y, w: Math.max(...xs.map((b) => b.x + b.w)) - x, h: Math.max(...xs.map((b) => b.y + b.h)) - y };
    return {
      target: pieces[0].target, bbox,
      draw: async (signal, k) => {
        for (const p of plans) {
          if (signal.aborted) { await p.draw(signal, k); continue; } // aborted: each completes at once
          const r = await p.draw(signal, k);
          if (typeof r === 'string' && p === pieces[0]) return r;
        }
      },
    };
  }

  private async unitOf(page: number, quote: string, near?: { x: number; y: number }): Promise<Unit | null> {
    const v = this.d.viewer();
    if (!v || page < 1 || page > v.numPages()) return null;
    try {
      await v.ensureSize(page);
      return meaningfulUnit(await v.textRuns(page), quote, near, { aspect: v.spaceHeight(page) / 1000 });
    } catch { return null; }
  }

  /** Waits until ink may start relative to the layout queued before it: the step is over, or its target is already on screen. */
  private async afterLayout(dep: LaneEntry, desk: DeskApi, t: Target | null, r: SRect | null, signal: AbortSignal) {
    if (this.d.instant) { await dep.done; return; } // the shadow's layout lane has no pans to wait out, only order
    if (!desk.following() && (dep.kind === 'scroll' || dep.kind === 'reveal' || dep.kind === 'frame')) return; // rule 6: no view to wait for
    if (t && r && desk.following() && (dep.kind === 'scroll' || dep.kind === 'reveal')) {
      // A journey's ink waits for the arrival beat, not just for its target to come into view.
      await Promise.race([dep.done, dep.started.then(() => (signal.aborted ? false : dep.journey ? dep.done.then(() => true) : desk.whenVisible(t, r)))]);
    } else await dep.done;
  }

  /** Rule 1/2: pans through the layout lane when the box is off screen; resolves once it shows. Not while the student drives (rule 6). */
  private async reveal(desk: DeskApi, t: Target, r: SRect, signal: AbortSignal, anchor?: SRect) {
    if (this.d.instant) return;
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
    if (!p || !v || !('x' in p)) return undefined; // a name or a mark: no anchor until resolved
    const s = toSpace(p, v.spaceHeight(t.page));
    return { x: s.x - 20, y: s.y - 20, w: 40, h: 40 };
  }

  /** Resolves raw geometry on build (the fit freezes on a region's first build). A string is a skip reason. */
  private async build(raw: RawAction, env: BuildEnv, signal: AbortSignal): Promise<ElementPlan | string> {
    const a = this.figures.resolve(raw);
    if (a == null) return 'nothing to draw';
    if (typeof a === 'string') return a;
    if (!this.figures.isLive(raw)) return this.buildPlain(a as InkAction, env, signal);
    // Live geometry: drawn as usual, then it follows the constants (src/desk/live.ts). It needs an id to be found each frame.
    const live = liveGeo(this.registry);
    const id = (a as { id?: string }).id ?? live.anonId();
    const plan = await this.buildPlain({ ...a, id } as InkAction, env, signal);
    if (typeof plan === 'string') return plan;
    const resolve = () => { const r = this.figures.resolve(raw); return r && typeof r === 'object' ? ({ ...r, id } as Action) : r; };
    return { ...plan, draw: async (sig, k) => { const r = await plan.draw(sig, k); if (!r) await live.add(id, raw, resolve, env); return r; } };
  }

  /**
   * Waits until the ink's word (plus its stagger) starts. With `live`, the word's time is re-read
   * while waiting: it may move (a pause holds it at null, a speed change or a seek back moves it).
   * Returns the word's start as it stood when the wait ended.
   */
  private async untilWord(fixed: number, offset: number, live: (() => number | null) | undefined, signal: AbortSignal): Promise<number> {
    if (this.d.instant) return fixed;
    if (!live) { await wait(fixed + offset - now()); return fixed; }
    for (;;) {
      const w = live();
      const d = w == null ? LIVE_POLL_MS : w + offset - now();
      if (w != null && d <= 0) return w;
      await wait(Math.min(d, LIVE_POLL_MS));
      if (signal.aborted) return w ?? fixed;
    }
  }

  private async ink(a: InkAction, raw: RawAction, t: ActionTiming, startAt: number, dep: LaneEntry | null, signal: AbortSignal, live?: () => number | null) {
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
      plan = await this.build(raw, env, signal);
      if (signal.aborted) return;
      if (typeof plan === 'string') return finish(plan);
    }
    // Region ink reveals its whole region (rule 2), so text written just before is measurable on the word.
    const early = typeof plan === 'object' ? plan : null;
    const box: SRect | null = early ? early.bbox : target?.region != null && a.kind !== 'svg' ? WHOLE_REGION : null;

    if (dep) await this.afterLayout(dep, desk, target, box, signal);
    if (signal.aborted) return;
    if (target && box) await this.reveal(desk, target, box, signal, this.anchorOf(a));
    if (signal.aborted) return;

    // A journey's hold moved this ink's word later: it starts on the word as it will now be spoken
    // (a live word time already carries the hold).
    const held = live ? 0 : this.heldMs(t, t.firedAt);
    const word = await this.untilWord(t.firedAt + held, startAt - t.firedAt, live, signal);
    if (signal.aborted) return;
    if (!plan) {
      await this.sectionsFor(a, desk, signal);
      if (signal.aborted) return;
      plan = await this.build(raw, env, signal);
      if (signal.aborted) return;
      if (typeof plan === 'string') return finish(plan);
      // A connector frames both ends together (rule 3); a late element off screen pans now.
      if (plan.also) {
        const p = plan;
        const e = this.enqueueLayout('frame', async () => { await desk.frameBoth({ t: p.target, r: p.bbox }, { t: p.also!.target, r: p.also!.bbox }, this.land); }, signal);
        if (desk.following() && !this.d.instant) await e.done;
      } else await this.reveal(desk, plan.target, plan.bbox, signal, this.anchorOf(a));
      if (signal.aborted) return;
    }
    if (typeof plan !== 'object') return finish('no plan');
    const p = plan;
    desk.noteInk?.(p.target, p.bbox);
    // Ink after a journey's arrival is not behind: the narration held for it.
    const k: Pace = { ...backlog(now() - Math.max(word, dep?.arrivedAt ?? -Infinity)), ...(a.kind === 'svg' && this.d.beat ? { beat: this.d.beat, stop: signal } : {}) };
    this.report(t, { startedAt: now() });
    const own = new AbortController();
    if (this.d.instant) own.abort(); // final state at once (an aborted draw completes immediately)
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
