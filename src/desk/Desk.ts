// src/desk/Desk.ts
import type { SRect } from '../geometry/space';
import type { PageLayers } from '../pdf/viewerApi';
import { REGION_H, REGION_W, type RegionSize, type Target } from '../script/types';
import type { Stroke } from '../ink/agent/strokes';
import { animateScrollTo } from '../pdf/scroll';
import { Follow, ScrollOwner } from './follow';
import { routeGutter, maskBlocker } from './route';
import { boardLayout, bodyPx, cropSpan, frameFor, frameInk, frameTop, inView, safeBottom, SAFE_TOP, type Frame, type SectionBox, type Split } from './layout';
import type { BeforeMove, ConnectorEnd, ConnectorHandle, DeskApi, DeskHost, DeskRect, DeskState, RegionInfo, RegionSpec, SceneClaim, SceneSpace, ViewRect } from './types';
import { BOARD_HEAD, boardPad } from './layout';
import { camFor, overviewCam, type Cam } from './scene/camera';

export type { DeskHost } from './types';

const SVG = 'http://www.w3.org/2000/svg';
/** The split glide: the slide column moving aside (or back) and the board sliding in (or out). */
export const GLIDE_MS = 420;
/** A board scroll that follows the ink glides at most this long. */
const BOARD_GLIDE_MS = 450;
const WIRE_PAD = 8;
/** Air kept around ink the board scrolls to. */
const BOARD_AIR = 16;
const WHOLE_REGION = { x: 0, y: 0, w: REGION_W, h: REGION_H };

/**
 * `full`: the section's height in units (700, or more once kit blocks grow it). `y0`–`y1`: the part
 * of it it shows (all of it until a later section crops it to its ink).
 */
/** One board section (DOM + state); `createSection` builds it (the gate's shadow board builds the same). */
export type DeskSection = Section;
type Section = { id: string; page: number; size: RegionSize; body: number | null; el: HTMLDivElement; layers: PageLayers; full: number; y0: number; y1: number; dx: number | null; scene?: Scene };
/** A scene section's world: its camera (world units, zoom), its claims, the last thing framed. */
type Scene = { cam: Cam; claims: SceneClaim[]; space: SceneSpace; focus: SRect | null; glide: AbortController | null; paper: SVGRectElement | null };
/** A camera glide over the scene: at most this long. */
const CAM_MS = 560;
/** `stroke` is the handle's own array, rewritten in place on every re-route (emph re-traces the current path). */
type Wire = { page: ConnectorEnd; region: ConnectorEnd; section: Section; reversed: boolean; svg: SVGSVGElement; group: SVGGElement; stroke: Stroke; avoid: SRect[] };

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));
const raf = (f: () => void) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(f) : setTimeout(f, 16));

/** A content-box rect is in a scrolled window [top, top + h]; a rect taller than it counts when its top is in the top 15%. */
function inWindow(r: { y: number; h: number }, top: number, h: number): boolean {
  if (r.h <= h) return r.y >= top - 1 && r.y + r.h <= top + h + 1;
  return r.y >= top - 1 && r.y <= top + h * 0.15;
}

/** The column the dock centres under for a frame: the page column while reading, the slide column in a split. */
const columnOf = (f: Frame) => (f.split === 'none' ? { x: f.page.pageX, w: f.page.pageW } : { x: f.slides.x, w: f.slides.w });

/**
 * The desk: slides on the left, the board on the right (spec "Lessons v3" L).
 * - reading: no board, the page column centred.
 * - split: an answer's first sketch opens the board; the slide column glides to the left edge and
 *   the board slides in. Each {{sketch}} appends a section; the board persists across answers until
 *   the student closes it (× or Esc between answers), and the slides glide back.
 * Connectors run from a page anchor to a board element in an overlay above both, re-routed whenever
 * either side scrolls, and fade while an end is out of view.
 */
export class Desk implements DeskApi {
  readonly follow = new Follow();
  /** Every section on the board, top to bottom (earlier answers' included). */
  private sections: Section[] = [];
  /** This answer's sections by id (ids are per answer). */
  private ids = new Map<string, Section>();
  private wires: Wire[] = [];
  private open = false;
  private split: Split = 'none';
  /** The column a split glide in flight is heading to: the state names it from the glide's start, so the dock moves with it. */
  private heading: { x: number; w: number } | null = null;
  /** The split glide is running: connectors hide until both sides have landed. */
  private gliding = false;
  /** The last place the answer was looked at, for "Back to answer". */
  private last: { t: Target; r: SRect } | null = null;
  /** Page ink of this answer, most recent first: framing the next mark keeps these in view when they fit. */
  private inked: { page: number; r: SRect }[] = [];
  /**
   * Bumped by reset(), abort() and dismiss(). Every async move captures it and bails after each await
   * when it changed, so a stopped or replaced answer's move in flight never lands later.
   */
  private epoch = 0;
  private subs = new Set<(s: DeskState) => void>();
  private moved = new Set<() => void>();
  private off: (() => void)[] = [];
  private board: HTMLDivElement;
  private scroller: HTMLDivElement;
  private content: HTMLDivElement;
  private wireLayer: HTMLDivElement;
  private owner = new ScrollOwner();
  private boardGlide: AbortController | null = null;
  private frameReq = 0;

  constructor(private host: DeskHost, private stage: HTMLDivElement, private opts: { onClose?: () => void } = {}) {
    this.board = document.createElement('div');
    this.board.className = 'desk-board';
    this.board.setAttribute('role', 'region');
    this.board.setAttribute('aria-label', 'Sketches');
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'desk-board-close';
    close.setAttribute('aria-label', 'Close the board');
    close.title = 'Close (Esc)';
    close.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/></svg>';
    close.addEventListener('click', () => (this.opts.onClose ? this.opts.onClose() : void this.dismiss()));
    this.scroller = document.createElement('div');
    this.scroller.className = 'desk-board-scroll';
    // The eval harness captures the board by this attribute: the element whose scroll covers every section.
    this.scroller.setAttribute('data-petu-board', '');
    this.content = document.createElement('div');
    this.content.className = 'desk-board-content';
    this.scroller.appendChild(this.content);
    this.board.append(this.scroller, close);
    this.wireLayer = document.createElement('div');
    this.wireLayer.className = 'desk-wires';
    stage.append(this.board, this.wireLayer);

    const user = () => this.follow.userTookOver();
    this.scroller.addEventListener('wheel', user, { passive: true });
    this.scroller.addEventListener('touchstart', user, { passive: true });
    this.scroller.addEventListener('scroll', () => {
      if (this.owner.isForeign(this.scroller.scrollTop, this.scroller.scrollHeight - this.scroller.clientHeight)) user();
      this.onMove();
    }, { passive: true });
    this.off.push(
      host.onLayout(() => this.position()),
      host.onUserIntent(user),
      host.onScroll(() => this.onMove()),
      this.follow.subscribe(() => this.emit()),
    );
  }

  destroy(): void { this.off.forEach((f) => f()); this.boardGlide?.abort(); this.stage.replaceChildren(); }

  // ---------------------------------------------------------------------------------------------
  // DeskApi

  following(): boolean { return this.follow.following(); }
  cancel(): void { this.host.cancelGlide(); this.boardGlide?.abort(); }

  abort(): void {
    this.epoch++;
    this.cancel();
  }
  subscribe(cb: (s: DeskState) => void): () => void { this.subs.add(cb); return () => { this.subs.delete(cb); }; }

  state(): DeskState {
    const f = this.frame();
    const L = this.host.layout();
    const column = this.heading ?? (this.open ? columnOf(f) : { x: L?.pageX ?? f.page.pageX, w: L?.pageW ?? f.page.pageW });
    const s: DeskState = { split: this.open ? f.ratio ?? 'normal' : 'none', stacked: this.open && f.stacked, following: this.follow.following(), sketching: this.open, column };
    if (this.open && f.board) s.board = f.board;
    return s;
  }

  region(id: string): RegionInfo | null {
    const sec = this.ids.get(id);
    if (!sec) return null;
    return {
      id, page: sec.page, size: sec.size, layers: sec.layers,
      scale: () => this.boxOf(sec)?.s ?? 0.5,
      body: () => bodyPx(sec.body, this.frame().page.pageW),
      ...(sec.scene ? { scene: sec.scene.space } : {}),
    };
  }

  async addRegion(spec: RegionSpec, before?: BeforeMove): Promise<RegionInfo | string> {
    const ep = this.epoch;
    // Board v2: a scene continues by its id. A later answer (a follow-up that continues) or a repeated
    // scene tag naming a scene already on the board draws on into it; a scene tag with a new id (a
    // revision) starts a fresh section below, and the old scene stays above, untouched.
    const prev = spec.scene ? this.sceneNamed(spec.id) : undefined;
    if (!prev && this.ids.has(spec.id)) return 'duplicate region id';
    if (prev) {
      this.ids.set(spec.id, prev);
      this.last = { t: { region: spec.id }, r: WHOLE_REGION };
      if (!this.open) await this.openBoard('normal', before);
      if (this.follow.following()) await this.showScene(prev, before);
      return ep === this.epoch ? this.region(spec.id) ?? 'desk reset' : 'desk reset';
    }
    // The sections above are finished: each keeps just its ink, so the board has no dead space between them.
    this.sections.forEach((s) => this.crop(s));
    const sec = this.makeSection(spec);
    this.sections.push(sec);
    this.ids.set(spec.id, sec);
    this.content.appendChild(sec.el);
    this.last = { t: { region: spec.id }, r: WHOLE_REGION };
    const live = () => ep === this.epoch && this.ids.get(spec.id) === sec;
    // A size=l sketch widens the split; it stays wide while such a section is on the board.
    const want: Split = this.sections.some((s) => s.size === 'l') ? 'wide' : 'normal';
    const moved = !this.open || want !== this.split;
    if (moved) await this.openBoard(want, before);
    else this.position();
    if (!live()) { sec.el.classList.add('is-shown'); return 'desk reset'; }
    // The column changed: the slide being explained is framed again, its top on the board's top edge
    // (the viewer's split framing), so the two columns read as one fitted frame.
    if (moved && this.follow.following()) {
      await this.host.scrollToPage(spec.page);
      if (!live()) { sec.el.classList.add('is-shown'); return 'desk reset'; }
    }
    // Rule 1: the new section is framed as it lands, so its first ink needs no pan.
    if (sec.scene) { if (this.follow.following()) await this.showScene(sec, before); }
    else if (this.follow.following() && !this.isVisible({ region: spec.id }, WHOLE_REGION)) {
      await before?.();
      if (live()) await this.glideBoard(() => this.boardTop(sec, WHOLE_REGION));
    }
    sec.el.classList.add('is-shown');
    return live() ? this.region(spec.id) ?? 'desk reset' : 'desk reset';
  }

  /** The newest scene section opened (or continued) under id `id`, in this answer or an earlier one. */
  private sceneNamed(id: string): Section | undefined {
    const now = this.ids.get(id);
    if (now) return now.scene ? now : undefined;
    for (let i = this.sections.length - 1; i >= 0; i--) {
      const s = this.sections[i];
      if (s.scene && s.id === id) return s;
    }
    return undefined;
  }

  /** A section's content needs `h` units (kit blocks stacked past 700): it grows, never shrinks. */
  growRegion(id: string, h: number): void {
    const sec = this.ids.get(id);
    if (!sec || sec.scene || !(h > sec.full) || sec.y0 !== 0 || sec.y1 !== sec.full) return;
    sec.full = sec.y1 = Math.ceil(Math.min(h, 4 * REGION_H));
    sec.el.querySelectorAll('svg').forEach((svg) => svg.setAttribute('viewBox', `0 0 ${REGION_W} ${sec.full}`));
    this.position();
  }

  /**
   * A section's content spans x0–x1 (units): the whole group shifts so it sits centred in the board
   * (its internal layout untouched). The first placement lands there at once; later ones glide.
   */
  centreRegion(id: string, x0: number, x1: number): void {
    const sec = this.ids.get(id);
    if (!sec || sec.scene || !(x1 > x0)) return;
    const dx = Math.max(-x0, Math.min(REGION_W - x1, REGION_W / 2 - (x0 + x1) / 2));
    if (sec.dx != null && Math.abs(dx - sec.dx) < 1) return;
    const first = sec.dx == null;
    sec.dx = dx;
    sec.el.querySelectorAll<SVGSVGElement>('svg').forEach((svg) => {
      svg.style.transition = first ? 'none' : '';
      // A percentage of the layer's own width (the section's 1000 units): right at every window size.
      svg.style.transform = Math.abs(dx) < 0.5 ? '' : `translateX(${((dx / REGION_W) * 100).toFixed(3)}%)`;
    });
    this.rerouteAll();
  }

  pageImage(page: number, r: { x: number; y: number; w: number; h: number }, pxW: number): Promise<string | null> {
    return this.host.crop?.(page, r, pxW) ?? Promise.resolve(null);
  }

  noteInk(t: Target, r: SRect): void {
    if (t.page == null) return;
    this.inked.unshift({ page: t.page, r });
    if (this.inked.length > 8) this.inked.length = 8;
  }

  async reveal(t: Target, r: SRect, before?: BeforeMove, anchor?: SRect): Promise<boolean> {
    const ep = this.epoch;
    this.last = { t, r };
    if (!this.follow.following() || this.isVisible(t, r)) return false;
    if (t.region != null) {
      const sec = this.ids.get(t.region);
      if (!sec || !this.open) return false;
      if (sec.scene) return this.frameScene(sec, r, before);
      await before?.();
      if (ep !== this.epoch) return false;
      await this.glideBoard(() => this.boardTop(sec, r));
      return true;
    }
    if (!this.host.layout()) return false;
    await before?.();
    if (ep !== this.epoch) return false;
    await this.host.glideTo(() => this.inkFrame(t, r, anchor), 450);
    return true;
  }

  isVisible(t: Target, r: SRect): boolean {
    if (t.region != null) {
      const sec = this.ids.get(t.region);
      const box = sec && this.open ? this.boxOf(sec) : null;
      const b = this.frame().board;
      if (!box || !b) return false;
      if (sec!.scene) {
        // The scene's window is on the board, and (unless the whole section is asked for) the rect is inside the camera.
        if (!inWindow({ y: box.y, h: box.h }, this.scroller.scrollTop, b.h + BOARD_HEAD)) return false;
        return isWhole(r) || inside(r, this.camRect(sec!), 0.5);
      }
      return inWindow({ y: box.y + (r.y - sec!.y0) * box.s, h: r.h * box.s }, this.scroller.scrollTop, b.h);
    }
    const w = this.deskRect(t.page, r);
    return !!w && inView(w, this.view());
  }

  whenVisible(t: Target, r: SRect, maxMs = 1200): Promise<boolean> {
    if (this.isVisible(t, r)) return Promise.resolve(true);
    return new Promise((resolve) => {
      const check = () => { if (this.isVisible(t, r)) done(true); };
      this.moved.add(check);
      const offState = this.subscribe(check);
      const timer = setTimeout(() => done(false), maxMs);
      const done = (v: boolean) => { this.moved.delete(check); offState(); clearTimeout(timer); resolve(v); };
    });
  }

  async frameBoth(a: ConnectorEnd, b: ConnectorEnd, before?: BeforeMove): Promise<void> {
    const ep = this.epoch;
    const pageEnd = a.t.page != null ? a : b, regEnd = a.t.page != null ? b : a;
    this.last = regEnd;
    if (!this.follow.following() || pageEnd.t.page == null || regEnd.t.region == null) return;
    const sec = this.ids.get(regEnd.t.region);
    if (!sec) return;
    const needPage = !this.isVisible(pageEnd.t, pageEnd.r) && !!this.host.layout();
    const needBoard = this.open && !this.isVisible(regEnd.t, regEnd.r);
    if (!needPage && !needBoard) return;
    await before?.();
    if (ep !== this.epoch) return;
    // The slides and the board scroll independently: both ends come into view together.
    await Promise.all([
      needPage ? this.host.glideTo(() => this.inkFrame(pageEnd.t, pageEnd.r), 450) : null,
      needBoard ? (sec.scene ? this.frameScene(sec, regEnd.r) : this.glideBoard(() => this.boardTop(sec, regEnd.r))) : null,
    ]);
  }

  async scrollToPage(page: number, y?: number): Promise<void> {
    this.last = { t: { page }, r: { x: 0, y: 0, w: 1000, h: 0 } };
    if (!this.follow.following()) return;
    await this.host.scrollToPage(page, y);
  }

  addConnector(from: ConnectorEnd, to: ConnectorEnd, avoid: SRect[] = []): ConnectorHandle | string {
    const reversed = from.t.region != null;
    const page = reversed ? to : from, region = reversed ? from : to;
    const section = region.t.region != null ? this.ids.get(region.t.region) : undefined;
    if (page.t.page == null || !section) return 'connector needs a page and a region';
    const svg = document.createElementNS(SVG, 'svg') as SVGSVGElement;
    svg.setAttribute('class', 'desk-wire');
    svg.setAttribute('aria-hidden', 'true');
    const group = svg.appendChild(document.createElementNS(SVG, 'g')) as SVGGElement;
    const w: Wire = { page, region, section, reversed, svg, group, stroke: [], avoid };
    const stroke = this.route(w);
    // No way from the anchor to the gutter clear of slide content (or no gutter: stacked): no connector.
    if (!stroke) return 'no clean connector route';
    w.stroke = stroke;
    this.wireLayer.appendChild(svg);
    this.wires.push(w);
    this.showWire(w);
    return { group, stroke, scale: 1 };
  }

  /**
   * A new answer: page marks fade elsewhere; here the connectors fade with them, this answer's ids
   * are freed and following resumes. The board and its sections stay (spec: the board persists).
   */
  async reset(ms: number): Promise<void> {
    this.epoch++;
    this.inked = [];
    this.follow.setAnswering(true);
    this.ids.clear();
    this.last = null;
    this.dropWires(ms);
    this.emit();
  }

  /** "Back to answer": follow again and return to where the answer was. */
  async resume(): Promise<void> {
    this.follow.resume();
    const l = this.last;
    if (l) await this.reveal(l.t, l.r);
  }

  /** The student closes the board (× or Esc between answers): it slides out and the slides glide back to centre. */
  async dismiss(): Promise<void> {
    if (!this.open) return;
    this.epoch++;
    this.cancel();
    this.dropWires(GLIDE_MS / 2);
    this.ids.clear();
    this.last = null;
    const gone = this.sections;
    this.sections = [];
    this.open = false;
    this.split = 'none';
    this.board.classList.remove('is-open');
    this.gliding = true;
    this.heading = columnOf(this.frame());
    this.emit();
    // The sections leave with the board, once it has slid out.
    void wait(GLIDE_MS).then(() => { gone.forEach((s) => s.el.remove()); if (!this.open) this.owner.write(this.scroller, 0); });
    try { await this.host.setSplit('none', GLIDE_MS); }
    finally { this.gliding = false; this.heading = null; this.position(); }
  }

  // ---------------------------------------------------------------------------------------------

  private frame(): Frame {
    const { W, H } = this.host.viewport();
    return frameFor(W, H, this.open ? this.split : 'none', this.host.aspect(1));
  }

  private makeSection(spec: RegionSpec): Section {
    return createSection(spec, (sec, paper) => this.makeScene(sec, paper));
  }

  metrics(): { boardPx: number; bodyPx: (body: number | null) => number } {
    // Before the board opens: the board the normal split would give (what the first section lands in).
    const { W, H } = this.host.viewport();
    const f = this.open ? this.frame() : frameFor(W, H, 'normal', this.host.aspect(1));
    return { boardPx: f.board?.w ?? 0, bodyPx: (b) => bodyPx(b, f.page.pageW) };
  }

  /** Crops a finished section to its ink (once): its svg shows only that band, the section's box shrinks to it. */
  private crop(sec: Section) {
    if (sec.scene || sec.y0 !== 0 || sec.y1 !== sec.full) return;
    let ink: { y: number; h: number } | null = null;
    for (const g of [sec.layers.agent, sec.layers.highlight]) {
      let b: { y: number; height: number } | null = null;
      try { b = typeof g.getBBox === 'function' && g.childNodes.length ? g.getBBox() : null; } catch { b = null; }
      if (!b || !(b.height > 0)) continue;
      const top: number = ink ? Math.min(ink.y, b.y) : b.y;
      const bottom: number = Math.max(ink ? ink.y + ink.h : -Infinity, b.y + b.height);
      ink = { y: top, h: bottom - top };
    }
    const { y0, y1 } = cropSpan(ink, sec.full);
    sec.y0 = y0; sec.y1 = y1;
    sec.el.querySelectorAll('svg').forEach((svg) => svg.setAttribute('viewBox', `0 ${y0} ${REGION_W} ${y1 - y0}`));
  }

  /** Opens the board (or changes its ratio): one movement, the slide column and the board together. */
  private async openBoard(want: Split, before?: BeforeMove): Promise<void> {
    const ep = this.epoch;
    await before?.();
    if (ep !== this.epoch) return;
    const opening = !this.open;
    this.split = want;
    this.open = true;
    this.gliding = true;
    if (opening) this.owner.write(this.scroller, 0);
    this.board.classList.toggle('is-resizing', !opening);
    this.position();
    if (opening) {
      // Placed off its final spot first (the closed transform), then slid in.
      void this.board.offsetWidth;
      this.board.classList.add('is-open');
    }
    this.heading = columnOf(this.frame());
    this.emit();
    try { await this.host.setSplit(want, GLIDE_MS); }
    finally {
      this.gliding = false;
      this.heading = null;
      this.board.classList.remove('is-resizing');
      this.position();
    }
  }

  private view() { return { top: this.host.scrollTop(), H: this.host.viewport().H, max: this.host.maxScroll() }; }

  /** Scroll top for revealing page ink `r`: with its labels and the answer's earlier ink on that page (frameInk). */
  private inkFrame(t: Target, r: SRect, anchor?: SRect): number {
    if (t.page == null) return this.host.scrollTop();
    const rect = this.deskRect(t.page, r) ?? { x: 0, y: NaN, w: 0, h: 0 };
    const ctx = this.inked
      .filter((k) => k.page === t.page && k.r !== r)
      .map((k) => this.deskRect(k.page, k.r))
      .filter((x): x is DeskRect => !!x);
    const a = anchor ? this.deskRect(t.page, anchor) ?? undefined : undefined;
    return frameInk(rect, ctx, this.view(), a);
  }

  /** A page target-space rect → desk px. */
  private deskRect(page: number, r: SRect): DeskRect | null {
    const L = this.host.layout();
    if (!L || page < 1 || page > L.tops.length) return null;
    const k = L.pageW / 1000;
    return { x: L.pageX + r.x * k, y: L.tops[page - 1] + r.y * k, w: r.w * k, h: r.h * k };
  }

  /** Where every section sits in the board's content box now. */
  private boxes(): SectionBox[] {
    const f = this.frame();
    if (!f.board) return [];
    return boardLayout(f.board.w, this.specs(f)).boxes;
  }
  private boxOf(sec: Section): SectionBox | null {
    const i = this.sections.indexOf(sec);
    return i < 0 ? null : this.boxes()[i] ?? null;
  }

  /** Board scroll top that brings section-space rect `r` into view with some air (minimal move; a tall rect top-aligned). */
  private boardTop(sec: Section, r: SRect): number {
    const box = this.boxOf(sec), b = this.frame().board;
    if (!box || !b) return this.scroller.scrollTop;
    if (sec.scene) return box.y - BOARD_HEAD;
    const y = box.y + (r.y - sec.y0) * box.s, h = r.h * box.s, top = this.scroller.scrollTop;
    if (h + 2 * BOARD_AIR >= b.h) return y - BOARD_AIR;
    if (y - BOARD_AIR < top) return y - BOARD_AIR;
    if (y + h + BOARD_AIR > top + b.h) return y + h + BOARD_AIR - b.h;
    return top;
  }

  private async glideBoard(top: () => number): Promise<void> {
    this.boardGlide?.abort();
    const ctrl = (this.boardGlide = new AbortController());
    try { await animateScrollTo(this.scroller, top, { signal: ctrl.signal, maxMs: BOARD_GLIDE_MS, owner: this.owner }); }
    finally { if (this.boardGlide === ctrl) this.boardGlide = null; }
  }

  /** Section-space rect → view px (where it is on screen now). */
  private viewRect(sec: Section, r: SRect): ViewRect | null {
    const box = this.boxOf(sec), b = this.frame().board;
    if (!box || !b) return null;
    if (sec.scene) {
      const { cam } = sec.scene, k = box.s * cam.z;
      return { x: b.x + box.x + (r.x - cam.x) * k, y: b.y + box.y + (r.y - cam.y) * k - this.scroller.scrollTop, w: r.w * k, h: r.h * k };
    }
    return { x: b.x + box.x + (r.x + (sec.dx ?? 0)) * box.s, y: b.y + box.y + (r.y - sec.y0) * box.s - this.scroller.scrollTop, w: r.w * box.s, h: r.h * box.s };
  }

  /** Puts the board, its sections and every wire where the current window says. */
  private position() {
    const f = this.frame();
    if (this.open && f.board) {
      const b = f.board;
      Object.assign(this.board.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });
      this.board.classList.toggle('is-stacked', f.stacked);
      const lay = boardLayout(b.w, this.specs(f));
      lay.boxes.forEach((x, i) => Object.assign(this.sections[i].el.style, { left: `${x.x}px`, top: `${x.y}px`, width: `${x.w}px`, height: `${x.h}px` }));
      this.sections.forEach((s) => { if (s.scene) this.applyCam(s); });
      this.content.style.height = `${lay.height}px`;
    }
    this.rerouteAll();
    this.emit();
  }

  /** The slides or the board scrolled: wires follow (once per frame), visibility waiters re-check. */
  private onMove() {
    this.moved.forEach((f) => f());
    if (this.frameReq || !this.wires.length) return;
    this.frameReq = raf(() => { this.frameReq = 0; this.rerouteAll(); }) as unknown as number;
  }

  private rerouteAll() {
    for (const w of this.wires) {
      const s = this.route(w);
      if (s) { w.group.querySelector('path')?.setAttribute('d', toD(s)); w.stroke.splice(0, w.stroke.length, ...s); }
      this.showWire(w, !!s);
    }
  }

  /** A wire shows while both its ends are in view (the page anchor in the slides' band, the element on the board) and nothing glides. */
  private showWire(w: Wire, routed = true) {
    let vis = routed && this.open && !this.gliding;
    if (vis) {
      const L = this.host.layout()!, { H } = this.host.viewport();
      const p = this.deskRect(w.page.t.page!, w.page.r)!, q = this.viewRect(w.section, w.region.r)!, b = this.frame().board!;
      const py = p.y - this.host.scrollTop() + p.h / 2, qy = q.y + q.h / 2, qx = q.x + q.w / 2;
      vis = !!L && py >= SAFE_TOP && py <= H - safeBottom() && qy >= b.y && qy <= b.y + b.h && qx >= b.x && qx <= b.x + b.w;
    }
    w.svg.classList.toggle('is-hidden', !vis);
  }

  /**
   * Routes a wire for the current layout (view px) and fits its svg around it: out of the anchor,
   * level to the page edge clear of content, through the gutter, into the board (routeGutter).
   * Null when an end can't be placed or no clean route exists (stacked: there is no gutter).
   */
  private route(w: Wire): Stroke | null {
    const L = this.host.layout();
    const pageNo = w.page.t.page!;
    const p0 = this.deskRect(pageNo, w.page.r), q = this.viewRect(w.section, w.region.r);
    const f = this.frame();
    if (!L || !p0 || !q || !this.open || f.stacked || !f.board) return null;
    const top = this.host.scrollTop(), i = pageNo - 1;
    const p = { ...p0, y: p0.y - top };
    const page = { x: L.pageX, y: L.tops[i] - top, w: L.pageW, h: L.heights[i] };
    const mask = this.host.contentMask?.(pageNo) ?? null;
    const { H } = this.host.viewport();
    // Board ink between the gutter and the target (a snapshot from when the wire was made), minus the target's own.
    const t = w.region.r, e = 0.5;
    const within = (a: SRect, b: SRect) => a.x >= b.x - e && a.y >= b.y - e && a.x + a.w <= b.x + b.w + e && a.y + a.h <= b.y + b.h + e;
    // A part of a block (a bar, a cell): the rest of its block to the left of it still counts, so the
    // wire does not cut across the part's neighbours on its way in.
    const obstacles = w.avoid
      .filter((a) => !within(a, t))
      .map((a) => (!within(t, a) ? a : t.x - a.x > 1 ? { x: a.x, y: a.y, w: t.x - a.x, h: a.h } : null))
      .filter((a): a is SRect => !!a)
      .map((a) => this.viewRect(w.section, a))
      .filter((a): a is ViewRect => !!a);
    let s = routeGutter(p, q, {
      page, gutterX: (page.x + page.w + f.board.x) / 2,
      blocked: mask ? maskBlocker(mask, page) : undefined,
      band: { y0: SAFE_TOP, y1: H - safeBottom() },
      boardBlocked: obstacles.length
        ? (r) => obstacles.some((a) => r.x < a.x + a.w && a.x < r.x + r.w && r.y < a.y + a.h && a.y < r.y + r.h)
        : undefined,
      board: f.board,
    });
    if (!s) return null;
    if (w.reversed) s = s.slice().reverse();
    const xs = s.map((v) => v.x), ys = s.map((v) => v.y);
    const box = { x: Math.min(...xs) - WIRE_PAD, y: Math.min(...ys) - WIRE_PAD, w: Math.max(...xs) - Math.min(...xs) + 2 * WIRE_PAD, h: Math.max(...ys) - Math.min(...ys) + 2 * WIRE_PAD };
    w.svg.setAttribute('viewBox', `${box.x} ${box.y} ${box.w} ${box.h}`);
    Object.assign(w.svg.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` });
    return s;
  }

  /** Fades every wire out and removes it. */
  private dropWires(ms: number) {
    const els = this.wires.map((w) => w.svg);
    this.wires = [];
    if (!els.length) return;
    for (const el of els) { el.style.transition = `opacity ${ms}ms ease-out`; el.style.opacity = '0'; }
    void wait(ms).then(() => els.forEach((e) => e.remove()));
  }

  private emit() { const s = this.state(); this.subs.forEach((f) => f(s)); }

  // ---------------------------------------------------------------------------------------------
  // Board v2 scenes: one world per scene section, seen through a camera.

  /** Layout specs for every section: a scene fills the board's visible height under its head row. */
  private specs(f: Frame) {
    const fill = f.board ? f.board.h - BOARD_HEAD - boardPad(f.board.w) : 0;
    return this.sections.map((s) => ({ body: bodyPx(s.body, f.page.pageW), span: s.y1 - s.y0, ...(s.scene ? { fill } : {}) }));
  }

  private makeScene(sec: Section, paper: SVGGElement) {
    sec.el.classList.add('is-scene');
    const claims: SceneClaim[] = [];
    const sc: Scene = { cam: { x: 0, y: 0, z: 1 }, claims, focus: null, glide: null, paper: null, space: null as unknown as SceneSpace };
    sc.space = sceneSpaceOf(claims, () => this.camRect(sec));
    sec.scene = sc;
    // The paper's dot grid lives in the world, so it pans with the camera (the scene moves, not the ink).
    const svgEl = paper.ownerSVGElement!;
    const defs = svgEl.insertBefore(document.createElementNS(SVG, 'defs'), svgEl.firstChild);
    const pat = defs.appendChild(document.createElementNS(SVG, 'pattern'));
    const pid = `scene-dots-${++sceneIds}`;
    Object.entries({ id: pid, patternUnits: 'userSpaceOnUse', width: 24, height: 24 }).forEach(([k, v]) => pat.setAttribute(k, String(v)));
    const dot = pat.appendChild(document.createElementNS(SVG, 'circle'));
    Object.entries({ cx: 12, cy: 12, r: 1.05, fill: 'var(--board-dot, rgba(0,0,0,.085))' }).forEach(([k, v]) => dot.setAttribute(k, String(v)));
    const rect = paper.appendChild(document.createElementNS(SVG, 'rect')) as SVGRectElement;
    Object.entries({ x: -50000, y: -50000, width: 100000, height: 100000, fill: `url(#${pid})` }).forEach(([k, v]) => rect.setAttribute(k, String(v)));
    sc.paper = rect;
    // The student can look around: the wheel pans the scene (ctrl / pinch zooms), and following stops.
    sec.el.addEventListener('wheel', (e) => this.onSceneWheel(sec, e), { passive: false });
  }

  private onSceneWheel(sec: Section, e: WheelEvent) {
    const sc = sec.scene!, box = this.boxOf(sec);
    if (!box) return;
    const k = box.s * sc.cam.z;
    const ext = sc.space.extent();
    const view = this.camRect(sec);
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const rect = sec.el.getBoundingClientRect();
      const px = (e.clientX - rect.left) / k + sc.cam.x, py = (e.clientY - rect.top) / k + sc.cam.y;
      const z = Math.max(0.35, Math.min(1.6, sc.cam.z * Math.exp(-e.deltaY * 0.01)));
      const k2 = box.s * z;
      sc.cam = { x: px - (e.clientX - rect.left) / k2, y: py - (e.clientY - rect.top) / k2, z };
    } else {
      // At the scene's edge the board scrolls on (earlier sections sit above a scene).
      const room = 0.25 * view.h;
      if (ext && ((e.deltaY < 0 && view.y <= ext.y - room) || (e.deltaY > 0 && view.y + view.h >= ext.y + ext.h + room)) && Math.abs(e.deltaY) > Math.abs(e.deltaX)) return;
      e.preventDefault();
      sc.cam = { ...sc.cam, x: sc.cam.x + e.deltaX / k, y: sc.cam.y + e.deltaY / k };
    }
    sc.glide?.abort();
    this.follow.userTookOver();
    this.applyCam(sec);
    this.onMove();
  }

  /** The camera's world rect for a scene section now. */
  private camRect(sec: Section): SRect {
    const box = this.boxOf(sec), cam = sec.scene!.cam;
    if (!box) return { x: cam.x, y: cam.y, w: REGION_W, h: REGION_H };
    const k = box.s * cam.z;
    return { x: cam.x, y: cam.y, w: box.w / k, h: box.h / k };
  }

  private applyCam(sec: Section) {
    const v = this.camRect(sec);
    const vb = `${v.x.toFixed(2)} ${v.y.toFixed(2)} ${v.w.toFixed(2)} ${v.h.toFixed(2)}`;
    sec.el.querySelectorAll('svg').forEach((svg) => { if (!svg.classList.contains('desk-wire')) svg.setAttribute('viewBox', vb); });
  }

  /** Brings a scene's window onto the board (it fills the board's visible height). */
  private async showScene(sec: Section, before?: BeforeMove) {
    const box = this.boxOf(sec), b = this.frame().board;
    if (!box || !b || Math.abs(this.scroller.scrollTop - (box.y - BOARD_HEAD)) < 2) return;
    await before?.();
    await this.glideBoard(() => this.boardTop(sec, WHOLE_REGION));
  }

  /** Frames world rect `r` in a scene: the window on the board, then the camera glides (and zooms out if it must) to show it with its context. */
  private async frameScene(sec: Section, r: SRect, before?: BeforeMove): Promise<boolean> {
    const ep = this.epoch, sc = sec.scene!;
    const box = this.boxOf(sec);
    if (!box) return false;
    let moved = false;
    if (!inWindow({ y: box.y, h: box.h }, this.scroller.scrollTop, (this.frame().board?.h ?? 0) + BOARD_HEAD)) { await this.showScene(sec, before); moved = true; }
    if (isWhole(r) || ep !== this.epoch) return moved;
    const to = camFor(sc.cam, r, sc.focus, { w: box.w, h: box.h, s: box.s });
    sc.focus = r;
    if (!to) return moved;
    if (!moved) await before?.();
    if (ep !== this.epoch) return true;
    await this.glideCam(sec, to);
    return true;
  }

  /**
   * The answer has ended: if it drew in a scene and the student is following, the camera eases out to
   * show the whole scene, centred (the explanation's map at a glance, every connection visible).
   */
  async overview(): Promise<void> {
    const sec = [...this.ids.values()].reverse().find((s) => s.scene);
    if (!sec || !this.open || !this.follow.following()) return;
    const ext = sec.scene!.space.extent(), box = this.boxOf(sec);
    if (!ext || !box) return;
    const to = overviewCam(ext, { w: box.w, h: box.h, s: box.s });
    const c = sec.scene!.cam;
    if (Math.abs(to.x - c.x) < 0.5 && Math.abs(to.y - c.y) < 0.5 && Math.abs(to.z - c.z) < 1e-3) return;
    sec.scene!.focus = null;
    await this.glideCam(sec, to);
  }

  private async glideCam(sec: Section, to: Cam): Promise<void> {
    const sc = sec.scene!;
    sc.glide?.abort();
    const ctrl = (sc.glide = new AbortController());
    const from = { ...sc.cam };
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ms = reduced ? 0 : Math.min(CAM_MS, 260 + Math.hypot(to.x - from.x, to.y - from.y) * box0(this.boxOf(sec)) * 0.5);
    const t0 = performance.now();
    await new Promise<void>((done) => {
      const step = () => {
        if (ctrl.signal.aborted) return done();
        const t = ms ? Math.min(1, (performance.now() - t0) / ms) : 1;
        const e = 0.5 - 0.5 * Math.cos(Math.PI * t);
        // Zoom eases in log space so a zoom-out and a pan read as one movement.
        sc.cam = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, z: from.z * Math.pow(to.z / from.z, e) };
        this.applyCam(sec);
        this.onMove();
        if (t >= 1) return done();
        raf(step);
      };
      step();
    });
    if (sc.glide === ctrl) sc.glide = null;
  }
}

let sceneIds = 0;
const isWhole = (r: SRect) => r.x === 0 && r.y === 0 && r.w === REGION_W && r.h === REGION_H;
/** Whether `r` lies inside `v`, allowing a slack of `slack` units. */
const inside = (r: SRect, v: SRect, slack: number) => r.x >= v.x - slack && r.y >= v.y - slack && r.x + r.w <= v.x + v.w + slack && r.y + r.h <= v.y + v.h + slack;
const unionR = (rs: SRect[]): SRect => {
  const x = Math.min(...rs.map((r) => r.x)), y = Math.min(...rs.map((r) => r.y));
  return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y };
};
const box0 = (b: SectionBox | null) => b?.s ?? 1;


const toD = (s: Stroke) => s.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');

/** A section's DOM: its two layers (and a scene's paper, handed to `scene`). */
export function createSection(spec: RegionSpec, scene?: (sec: DeskSection, paper: SVGGElement) => void): DeskSection {
  const el = document.createElement('div');
  el.className = 'desk-region';
  el.dataset.id = spec.id;
  const layer = (cls: string) => {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('class', `desk-region-layer ${cls}`);
    svg.setAttribute('viewBox', `0 0 ${REGION_W} ${REGION_H}`);
    svg.setAttribute('aria-hidden', 'true');
    el.appendChild(svg);
    return svg.appendChild(document.createElementNS(SVG, 'g')) as SVGGElement;
  };
  const paper = spec.scene ? layer('desk-region-paper') : null;
  const layers = { highlight: layer('desk-region-hl'), agent: layer('desk-region-ink') };
  const sec: Section = { id: spec.id, page: spec.page, size: spec.size, body: spec.body ?? null, el, layers, full: REGION_H, y0: 0, y1: REGION_H, dx: null };
  if (spec.scene && paper && scene) scene(sec, paper);
  return sec;
}

/** A scene's world over `claims`, seen through `view` (the camera's world rect). */
export function sceneSpaceOf(claims: SceneClaim[], view: () => SRect): SceneSpace {
  return {
    claim: (r, minor) => {
      const c: SceneClaim = { r: { ...r }, move: (n) => { c.r = { ...n }; }, drop: () => { const i = claims.indexOf(c); if (i >= 0) claims.splice(i, 1); }, ...(minor ? { minor } : {}) };
      claims.push(c);
      return c;
    },
    rects: (o) => (o?.lines === false ? claims.filter((c) => c.minor !== 'line') : claims).map((c) => c.r),
    view,
    last: () => [...claims].reverse().find((c) => !c.minor)?.r ?? null,
    extent: () => (claims.length ? unionR(claims.map((c) => c.r)) : null),
  };
}
