// src/desk/Desk.ts
import type { SRect } from '../geometry/space';
import type { PageLayers } from '../pdf/viewerApi';
import { REGION_H, REGION_W, type RegionSize, type Target } from '../script/types';
import type { Stroke } from '../ink/agent/strokes';
import { animateScrollTo } from '../pdf/scroll';
import { Follow, ScrollOwner, wheelPx, wheelScrolls } from './follow';
import { routeGutter, maskBlocker } from './route';
import { boardLayout, bodyPx, fitZoom, laneFrame, pageAt, zoomStepFrom, ZOOM_MAX, ZOOM_MIN, cropSpan, frameFor, frameInk, frameTop, inView, safeBottom, SAFE_TOP, type Frame, type SectionBox, type Split } from './layout';
import type { BeforeMove, ConnectorEnd, ConnectorHandle, DeskApi, DeskHost, DeskRect, DeskState, RegionInfo, RegionSpec, SceneClaim, SceneSpace, ViewRect } from './types';
import { BOARD_HEAD, boardPad, MIN_TEXT_PX, SECTION_W, TEXT_UNITS } from './layout';
import { dockTop, FOLDED_H, LANE_PAD, LEADER_MAX, leaderPath, packLane, stickyInsets, wantFor } from './lane';
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
/** A pinch: zoom ×e^(−px·rate) per wheel event, each event's px capped (a ctrl+wheel notch is ~100 px). */
const PINCH_RATE = 0.01;
const PINCH_MAX_PX = 25;
/** Safari's GestureEvent (not in the DOM typings). */
type GestureLike = Event & { scale?: number; clientX?: number; clientY?: number };

/**
 * `full`: the section's height in units (700, or more once kit blocks grow it). `y0`–`y1`: the part
 * of it it shows (all of it until a later section crops it to its ink).
 */
/** One board section (DOM + state); `createSection` builds it (the gate's shadow board builds the same). */
export type DeskSection = Section;
type Section = { id: string; page: number; size: RegionSize; body: number | null; el: HTMLDivElement; layers: PageLayers; full: number; y0: number; y1: number; dx: number | null; scene?: Scene; /** An svg board: grows as tall as its canvas (no kit cap). */ svg?: boolean; group?: Group };
/**
 * Layout C (the anchored lane, src/desk/lane.ts): one answer's head and sections, stacked in the lane
 * level with the passage they explain. `el` spans the lane's whole height (the sticky item's
 * containing block); `spacer` puts the item at its top; `item` holds the head and sections in flow.
 * `anchor`: the page point it explains (page model units); `lift`: px from the item's top down to it.
 */
type Group = {
  el: HTMLDivElement; spacer: HTMLDivElement; item: HTMLDivElement; leader: SVGGElement;
  secs: Section[]; head: HTMLElement | null;
  anchor: { page: number; y: number }; lift: number;
  top: number; h: number; live: boolean; folded: boolean; thumb: HTMLElement | null;
  /** Its anchor is the view (the answer had not marked the page yet): its first page mark re-anchors it. */
  provisional?: boolean;
  /** Its heads and sections in order (the lane stacks them in this order). */
  parts?: HTMLElement[];
  /** Taller than the band while it plays: the part being drawn (px from the item's top) and the sticky top that shows it. */
  pen?: { top: number; h: number } | null; stick?: number | null;
};
/** The docking glide at an answer's end (spec §5.2 rule 5). */
const DOCK_MS = 300;
/** The comfort band's top: the lane's live item sticks this far below the window top (under the chrome row). */
const LANE_STICK = SAFE_TOP + 16;
/** The pinned card's top below its item's top (desk.css .lane-item::before), its label above it. */
const PIN_CARD = 30;
/** The fade where the lane is masked at the comfort band's top. */
const LANE_FADE = 16;
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
  /**
   * Session trail and asides (spec "v1 learner UX"): a head above a section, `h` px tall (an answer's
   * question header, or an aside's title row whose element also frames the inset). A collapsed aside
   * shows only its head (the marker); its section takes no height until it is reopened.
   */
  private heads = new Map<Section, { el: HTMLElement; h: number; aside: boolean; collapsed: boolean }>();
  private nextHead: { el: HTMLElement; h: number; aside: boolean } | null = null;
  /**
   * Heads inside a section: a follow-up that draws on into an svg board (`BOARD extend`) gets its
   * question header at the start of its new groups. `from`: the old content's bottom (units), the head
   * never rises above it; `y`: the top of its first new group (units), null until that group is known.
   */
  private midHeads: { sec: Section; el: HTMLElement; h: number; from: number; y: number | null }[] = [];
  /** An aside is playing: its sections are tinted, the rest of the board steps back, nothing is cropped. */
  private asideOpen = false;
  /** Sections of the paused answer cropped to their ink while an aside plays (restored when it ends). */
  private held = new Set<Section>();
  /** The paused answer's last target when its aside opened (the aside's moves overwrite `last`). */
  private asideFrom: Desk['last'] = null;
  /** The student's board zoom: a multiplier on every section's scale (1 = the board as laid out). */
  private zoomK = 1;
  /** Layout C: the lane's groups, oldest first, and the one this answer draws into. */
  private groups: Group[] = [];
  private liveGroup: Group | null = null;
  private leaders: SVGSVGElement;
  /** Layout C: the pen's column (the dock follows it): the page, or the lane once the answer draws there. */
  private penLane = false;
  private zoomCtl: { out: HTMLButtonElement; pct: HTMLSpanElement; in: HTMLButtonElement; fit: HTMLButtonElement };

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
    this.zoomCtl = this.makeZoomControl();
    this.board.append(this.scroller, close, this.zoomCtl.out.parentElement!);
    this.leaders = document.createElementNS(SVG, 'svg') as SVGSVGElement;
    this.leaders.setAttribute('class', 'lane-leaders');
    this.leaders.setAttribute('aria-hidden', 'true');
    this.content.appendChild(this.leaders);
    this.wireLayer = document.createElement('div');
    this.wireLayer.className = 'desk-wires';
    stage.append(this.board, this.wireLayer);

    const user = () => this.follow.userTookOver();
    // Not passive: a pinch over the board zooms the board (never the browser's page zoom, which moves everything).
    this.scroller.addEventListener('wheel', (e) => this.onWheel(e, false), { passive: false });
    // Safari sends a trackpad pinch as gesture events (no ctrl+wheel); unhandled, the whole page zooms.
    // A drag across a drawing never selects it (a stray highlight, an accidental "about:" chip): a press
    // on a drawing that is not on a word starts no selection (WebKit ignores user-select there). A press
    // on a word still selects (select-to-ask), and a press elsewhere clears an old selection.
    this.content.addEventListener('mousedown', (e) => {
      const t = e.target as Element | null;
      if (e.button !== 0 || !t?.closest?.('.desk-region') || t.closest('text')) return;
      e.preventDefault();
      const sel = typeof getSelection === 'function' ? getSelection() : null;
      if (sel && !sel.isCollapsed) sel.removeAllRanges();
    });
    // Over the board or the pen laid over it (src/ui/BoardPen.tsx).
    const onGesture = (e: Event) => { if ((e.target as Element | null)?.closest?.('.desk-board.is-open, .board-pen')) this.onGesture(e as GestureLike); };
    for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, onGesture, { passive: false });
    this.off.push(() => { for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.removeEventListener(t, onGesture); });
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
    // Layout C: the lane is the sheet's margin, there before any drawing.
    this.position();
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
    if (f.lane) {
      // The lane: one sheet, nothing opens; the dock sits under the column the pen is in (spec §5.3).
      const col = this.penLane ? { x: f.lane.x, w: f.lane.w } : { x: f.page.pageX, w: f.page.pageW };
      const s: DeskState = { split: this.open ? 'normal' : 'none', stacked: false, following: this.follow.following(), sketching: this.open, column: col, lane: true, page: { x: f.page.pageX, w: f.page.pageW }, ...(this.edge ? { edge: this.edge } : {}) };
      if (this.open && f.board) s.board = f.board;
      return s;
    }
    const L = this.host.layout();
    const column = this.heading ?? (this.open ? columnOf(f) : { x: L?.pageX ?? f.page.pageX, w: L?.pageW ?? f.page.pageW });
    const s: DeskState = { split: this.open ? f.ratio ?? 'normal' : 'none', stacked: this.open && f.stacked, following: this.follow.following(), sketching: this.open, column };
    if (this.open && f.board) s.board = f.board;
    if (this.open) s.zoom = this.zoomK;
    return s;
  }

  region(id: string): RegionInfo | null {
    const sec = this.ids.get(id);
    if (!sec) return null;
    return {
      id, page: sec.page, size: sec.size, layers: sec.layers,
      // The section's own scale: board ink is sized for it, unaffected by the student's zoom.
      scale: () => (this.lane() ? this.laneScale(sec) : (this.boxOf(sec)?.s ?? 0.5 * this.zoomK) / this.zoomK),
      body: () => bodyPx(sec.body, this.frame().page.pageW),
      ...(sec.scene ? { scene: sec.scene.space } : {}),
    };
  }

  async addRegion(spec: RegionSpec, before?: BeforeMove): Promise<RegionInfo | string> {
    const ep = this.epoch;
    // Board v2: a scene continues by its id. A later answer (a follow-up that continues) or a repeated
    // scene tag naming a scene already on the board draws on into it; a scene tag with a new id (a
    // revision) starts a fresh section below, and the old scene stays above, untouched.
    // The svg board: a follow-up that extends it draws on into the same section (uncropped again).
    if (spec.svg && spec.extend) {
      const old = this.ids.get(spec.id) ?? [...this.sections].reverse().find((s) => s.id === spec.id && !s.scene);
      if (old) {
        this.ids.set(spec.id, old);
        // This answer's header goes where its new groups start (below what the board already holds).
        if (this.nextHead && !this.nextHead.aside) {
          const h = this.nextHead;
          this.nextHead = null;
          this.midHeads.push({ sec: old, el: h.el, h: h.h, from: inkBottom(old) ?? old.y1, y: null });
          h.el.classList.add('is-mid');
          // The lane: it rides in the answer's group (over the section, at its new groups' top).
          if (old.group) (old.group.parts ??= []).push(h.el);
          (this.lane() && old.group ? old.group.item : this.content).appendChild(h.el);
        }
        if (old.y0 !== 0 || old.y1 !== old.full) { old.y0 = 0; old.y1 = old.full; old.el.querySelectorAll('svg:not([data-svgboard])').forEach((svg) => svg.setAttribute('viewBox', `0 0 ${REGION_W} ${old.full}`)); this.position(); }
        this.pen({ t: { region: spec.id }, r: WHOLE_REGION });
        if (this.lane() && old.group) { this.relive(old.group); this.open = true; this.position(); }
        else if (!this.open) await this.openBoard('normal', before);
        return ep === this.epoch ? this.region(spec.id) ?? 'desk reset' : 'desk reset';
      }
    }
    const prev = spec.scene ? this.sceneNamed(spec.id) : undefined;
    if (!prev && this.ids.has(spec.id)) return 'duplicate region id';
    if (prev) {
      this.ids.set(spec.id, prev);
      this.pen({ t: { region: spec.id }, r: WHOLE_REGION });
      if (this.lane() && prev.group) { this.relive(prev.group); this.open = true; this.position(); }
      else if (!this.open) await this.openBoard('normal', before);
      if (this.follow.following()) await this.showScene(prev, before);
      return ep === this.epoch ? this.region(spec.id) ?? 'desk reset' : 'desk reset';
    }
    // The sections above are finished: each keeps just its ink, so the board has no dead space between them.
    // An aside leaves the paused answer's sections as they are (it draws on in them when it resumes).
    if (!this.asideOpen) this.sections.filter((s) => !this.lane() || s.group !== this.liveGroup).forEach((s) => this.crop(s));
    const sec = this.makeSection(spec);
    // An svg board's section is as tall as its canvas from the start, so it lands (head at the top) where it will stay.
    if (spec.svg) { sec.svg = true; if (spec.h && spec.h > sec.full) { sec.full = sec.y1 = Math.ceil(spec.h); sec.el.querySelectorAll('svg:not([data-svgboard])').forEach((svg) => svg.setAttribute('viewBox', `0 0 ${REGION_W} ${sec.full}`)); } }
    if (this.asideOpen) sec.el.classList.add('is-aside');
    let head: HTMLElement | null = null;
    if (this.nextHead) {
      const h = this.nextHead;
      this.nextHead = null;
      this.heads.set(sec, { ...h, collapsed: false });
      h.el.classList.toggle('is-aside', this.asideOpen);
      this.content.appendChild(h.el);
      head = h.el;
    }
    this.sections.push(sec);
    this.ids.set(spec.id, sec);
    this.content.appendChild(sec.el);
    this.joinGroup(sec, head, spec.page);
    this.pen({ t: { region: spec.id }, r: WHOLE_REGION });
    const live = () => ep === this.epoch && this.ids.get(spec.id) === sec;
    if (this.lane()) {
      // The lane: nothing opens or glides; the section lands in its group, in view (the group is sticky).
      this.open = true;
      this.split = 'normal';
      this.position();
      sec.el.classList.add('is-shown');
      return live() ? this.region(spec.id) ?? 'desk reset' : 'desk reset';
    }
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
    // A headed section (an answer's first, an aside's inset) lands with its head at the top of the view.
    if (sec.scene) { if (this.follow.following()) await this.showScene(sec, before); }
    else if (this.follow.following() && (this.heads.has(sec) ? !this.landed(sec) : !this.isVisible({ region: spec.id }, WHOLE_REGION))) {
      await before?.();
      if (live()) await this.glideBoard(() => (this.heads.has(sec) ? this.landTop(sec) : this.boardTop(sec, WHOLE_REGION)));
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
    // Kit content stops at four sections' height; an svg board grows as tall as its canvas (else its lower
    // groups would sit past the board's scroll range, never brought into view).
    sec.full = sec.y1 = Math.ceil(sec.svg ? h : Math.min(h, 4 * REGION_H));
    sec.el.querySelectorAll('svg:not([data-svgboard])').forEach((svg) => svg.setAttribute('viewBox', `0 0 ${REGION_W} ${sec.full}`));
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
    if (t.region != null) {
      const sec = this.ids.get(t.region);
      const m = sec && this.midHeads.find((x) => x.sec === sec && x.y == null);
      if (m && sec) {
        // The follow-up's first new group: its header lands right above it, in view with it.
        m.y = Math.max(m.from, r.y);
        this.position();
        const box = this.boxOf(sec);
        if (box && this.follow.following() && this.lane()) {
          const top = m.y - m.h / box.s;
          void this.reveal(t, { x: r.x, y: top, w: r.w, h: r.y + r.h - top });
        } else if (box && this.follow.following()) {
          const top = m.y - m.h / box.s;
          void this.glideBoard(() => this.boardTop(sec, { x: r.x, y: top, w: r.w, h: r.y + r.h - top }));
        }
      }
    }
    if (t.page == null) return;
    this.inked.unshift({ page: t.page, r });
    if (this.inked.length > 8) this.inked.length = 8;
    const g = this.liveGroup;
    if (!g || !this.lane()) return;
    if (g.provisional) {
      // The answer's first page mark: the drawing moves level with the passage it explains (one glide).
      g.provisional = false;
      g.anchor = { page: t.page, y: r.y + Math.min(r.h, 40) / 2 };
      const from = g.item.getBoundingClientRect().top;
      this.position();
      this.glideFrom(g, from);
    }
    this.liveLane();
  }

  /** A FLIP glide of a group's item from its old screen top to where it is now (DOCK_MS; none under reduced motion). */
  private glideFrom(g: Group, from: number) {
    const dy = from - g.item.getBoundingClientRect().top;
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || Math.abs(dy) < 1 || typeof g.item.animate !== 'function') return;
    g.item.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: DOCK_MS, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }

  async reveal(t: Target, r: SRect, before?: BeforeMove, anchor?: SRect): Promise<boolean> {
    const ep = this.epoch;
    this.pen({ t, r });
    if (!this.follow.following() || this.isVisible(t, r)) return false;
    if (t.region != null) {
      const sec = this.ids.get(t.region);
      if (!sec || !this.open) return false;
      if (this.lane()) {
        // The playing group is sticky: scrolling the page cannot move it, so it never does. A group taller
        // than the band follows the pen instead: its sticky top shifts so the part being drawn is in view.
        // A docked group drawn into again: the page scrolls to it.
        if (sec.group?.live) {
          const g = sec.group, v = this.viewRect(sec, r);
          if (!v) return false;
          // With air above for the pinned card's top and the band's fade.
          const air = PIN_CARD + LANE_FADE;
          g.pen = { top: v.y - g.item.getBoundingClientRect().top - air, h: v.h + air };
          const from = g.item.getBoundingClientRect().top;
          this.position();
          this.glideFrom(g, from);
          return Math.abs(g.item.getBoundingClientRect().top - from) >= 1;
        }
        const v = this.viewRect(sec, r);
        if (!v) return false;
        await before?.();
        if (ep !== this.epoch) return false;
        const { H } = this.host.viewport(), band = H - SAFE_TOP - safeBottom();
        const dy = v.h > band ? v.y - LANE_STICK : v.y < LANE_STICK ? v.y - LANE_STICK : v.y + v.h - (H - safeBottom() - 16);
        const top0 = this.host.scrollTop();
        await this.host.glideTo(() => Math.max(0, Math.min(this.host.maxScroll(), top0 + dy)), 450);
        return true;
      }
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
    if (t.region != null && this.lane()) {
      const sec = this.ids.get(t.region);
      const v = sec ? this.viewRect(sec, isWhole(r) ? { x: 0, y: sec.y0, w: REGION_W, h: Math.min(REGION_H, sec.y1 - sec.y0) } : r) : null;
      if (!v) return false;
      const { H } = this.host.viewport();
      return inWindow({ y: v.y, h: v.h }, SAFE_TOP, H - SAFE_TOP - safeBottom());
    }
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
    this.pen(regEnd);
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
      needBoard && this.lane() ? this.reveal(regEnd.t, regEnd.r) : needBoard ? (sec.scene ? this.frameScene(sec, regEnd.r) : this.glideBoard(() => this.boardTop(sec, regEnd.r))) : null,
    ]);
  }

  async scrollToPage(page: number, y?: number): Promise<void> {
    this.pen({ t: { page }, r: { x: 0, y: 0, w: 1000, h: 0 } });
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
    // The lane: the last answer's group docks (if it still plays) and every earlier answer folds to its card (spec §5.5).
    if (this.liveGroup) this.dock(this.liveGroup, false);
    this.liveGroup = null;
    if (this.lane()) { for (const g of this.groups) this.fold(g, true); this.penLane = false; this.position(); }
    this.inked = [];
    this.follow.setAnswering(true);
    this.ids.clear();
    this.last = null;
    this.dropWires(ms);
    this.emit();
  }

  /** The next section added gets `el` as its head, `h` px tall (null: none). Consumed by that section. */
  headNext(el: HTMLElement | null, h = 0): void {
    this.nextHead = el ? { el, h, aside: this.asideOpen } : null;
  }

  /**
   * An aside opens (true) or ends (false). Open: sections added are its inset; the board around it
   * steps back. Ended: every open aside collapses to its marker (its head), and the board re-lays.
   */
  setAside(on: boolean): void {
    if (on === this.asideOpen) return;
    this.asideOpen = on;
    this.board.classList.toggle('has-aside', on);
    // Asking is the student handing the view back: the aside is followed (its inset lands in view, its
    // ink is kept in view), even if they had scrolled away before asking. Scrolling during the aside
    // stops following as ever. When it ends, the board returns to where the paused answer was.
    if (on) { this.asideFrom = this.last; this.follow.resume(); }
    else { this.last = this.asideFrom; this.asideFrom = null; }
    // The paused answer's open sections show just their ink while the aside plays (the inset sits right
    // under it), and get their whole height back when the answer resumes and draws on.
    if (on) {
      for (const s of this.sections) {
        if (s.scene || s.y0 !== 0 || s.y1 !== s.full) continue;
        this.crop(s);
        if (s.y0 !== 0 || s.y1 !== s.full) this.held.add(s);
      }
    } else {
      for (const s of this.held) {
        s.y0 = 0; s.y1 = s.full;
        s.el.querySelectorAll('svg:not([data-svgboard])').forEach((svg) => svg.setAttribute('viewBox', `0 0 ${REGION_W} ${s.full}`));
      }
      this.held.clear();
    }
    if (!on) for (const [sec, hd] of this.heads) if (hd.aside && !hd.collapsed) this.collapse(sec, hd, true);
    if (!on && this.nextHead?.aside) this.nextHead = null;
    this.position();
    if (!on && this.last) void this.reveal(this.last.t, this.last.r);
  }

  /** A collapsed aside's marker was clicked: it opens again in place (and closes when clicked again). */
  toggleAside(el: HTMLElement): void {
    for (const [sec, hd] of this.heads) if (hd.el === el && hd.aside) { this.collapse(sec, hd, !hd.collapsed); this.position(); return; }
  }

  private collapse(sec: Section, hd: { el: HTMLElement; collapsed: boolean }, on: boolean) {
    hd.collapsed = on;
    hd.el.classList.toggle('is-collapsed', on);
    sec.el.classList.toggle('is-collapsed', on);
  }

  /** Where this answer's region-space rect is on screen now (point-to-ask on the board); null when unknown. */
  onScreen(region: string, r: SRect): { x: number; y: number; w: number; h: number } | null {
    const sec = this.ids.get(region);
    return sec && this.open ? this.viewRect(sec, r) : null;
  }

  /** Scrolls the board so the head `el` sits at its top (the trail: a question clicked or replayed). */
  async showHead(el: HTMLElement): Promise<void> {
    const g = this.lane() ? this.groups.find((x) => x.head === el || x.parts?.includes(el)) : undefined;
    if (g) {
      // The lane: the card opens in place and the sheet scrolls to it (the session list, a replay).
      this.fold(g, false);
      this.position();
      this.follow.userTookOver();
      const { H } = this.host.viewport();
      const y = g.top, h = Math.min(g.h, H - SAFE_TOP - safeBottom());
      await this.host.glideTo(() => Math.max(0, Math.min(this.host.maxScroll(), y - SAFE_TOP - Math.max(16, (H - SAFE_TOP - safeBottom() - h) / 3))), 600);
      return;
    }
    if (!this.open) return;
    const top = parseFloat(el.style.top) || 0;
    await this.glideBoard(() => Math.max(0, top - 8));
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
    const goneHeads = [...this.heads.values(), ...this.midHeads].map((h) => h.el);
    this.midHeads = [];
    this.sections = [];
    this.heads.clear();
    this.nextHead = null;
    const goneGroups = this.groups.map((g) => g.el);
    this.groups = [];
    this.liveGroup = null;
    this.penLane = false;
    this.leaders.replaceChildren();
    if (this.lane()) {
      // The lane stays (it is the sheet's margin): only its drawings leave.
      gone.forEach((s) => s.el.remove());
      goneHeads.forEach((e) => e.remove());
      goneGroups.forEach((e) => e.remove());
      this.open = false;
      this.split = 'none';
      this.emit();
      return;
    }
    void wait(GLIDE_MS).then(() => { goneHeads.forEach((e) => e.remove()); goneGroups.forEach((e) => e.remove()); });
    this.open = false;
    this.split = 'none';
    this.board.classList.remove('is-open');
    this.gliding = true;
    this.heading = columnOf(this.frame());
    this.emit();
    // The sections leave with the board, once it has slid out.
    void wait(GLIDE_MS).then(() => { gone.forEach((s) => s.el.remove()); if (!this.open) { this.owner.write(this.scroller, 0); this.scroller.scrollLeft = 0; this.zoomK = 1; this.syncZoomControl(); } });
    try { await this.host.setSplit('none', GLIDE_MS); }
    finally { this.gliding = false; this.heading = null; this.position(); }
  }

  // ---------------------------------------------------------------------------------------------
  // Board zoom (the student's): every section scales by one multiplier, around the top of the view.

  zoom(): number { return this.zoomK; }

  /**
   * Zooms the board to `z` (clamped), or to the zoom at which all of its content fits its height (≤ 100%).
   * The student's act: following stops (rule 6). `at` (client px, a pinch's cursor): that point of the
   * drawing stays under it; else the top of the view (and its horizontal centre) stays put.
   */
  setZoom(z: number | 'fit', at?: { x: number; y: number }): void {
    const f = this.frame();
    const b = f.board;
    let next = z === 'fit' ? (b ? fitZoom(b.h, boardLayout(b.w, this.specs(f), 1)) : 1) : z;
    next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Number.isFinite(next) ? next : 1));
    this.follow.userTookOver();
    if (Math.abs(next - this.zoomK) < 1e-4) {
      // Fit when already fitted still brings the whole board into view.
      if (z === 'fit') this.owner.write(this.scroller, 0);
      return;
    }
    if (!this.open || !b) { this.zoomK = next; this.syncZoomControl(); return; }
    // The anchor, in view px: the pinch's cursor, else the top of the view at its horizontal centre.
    const r = at ? this.scroller.getBoundingClientRect() : null;
    const vy = r && at ? Math.max(0, Math.min(b.h, at.y - r.top)) : 0;
    const vx = r && at ? Math.max(0, Math.min(b.w, at.x - r.left)) : b.w / 2;
    // …in content px, and as a point of the section under it (units), which keeps its place on screen.
    const before = this.boxes(), top = this.scroller.scrollTop, ay = top + vy, ax = this.scroller.scrollLeft + vx;
    const i = before.findIndex((x) => ay < x.y + x.h);
    const sec0 = i >= 0 ? before[i] : null;
    const uy = sec0 ? Math.max(0, ay - sec0.y) / sec0.s : 0, ux = sec0 ? (ax - sec0.x) / sec0.s : 0;
    this.boardGlide?.abort();
    this.zoomK = next;
    this.position();
    const after = this.boxes(), sec1 = sec0 ? after[i] : null;
    const ny = sec0 && sec1 ? (ay < sec0.y ? ay - sec0.y + sec1.y : sec1.y + uy * sec1.s) : ay;
    this.owner.write(this.scroller, z === 'fit' ? 0 : Math.max(0, ny - vy));
    const nx = sec0 && sec1 ? sec1.x + ux * sec1.s : ax;
    this.scroller.scrollLeft = Math.max(0, nx - vx);
    this.syncZoomControl();
    this.onMove();
    this.emit();
  }

  /**
   * A wheel over the board. A pinch (ctrl / ⌘ + wheel; a trackpad pinch arrives as ctrl+wheel) zooms
   * the board around the cursor, continuously, and never the browser's page. Any other wheel scrolls
   * the board (natively; `manual`: by hand, for an overlay above it such as the pen) and stops
   * following only if it moves it. A scene section's own pinch (its camera) has already handled it.
   */
  wheel(e: WheelEvent, manual = true): void { this.onWheel(e, manual); }

  private onWheel(e: WheelEvent, manual: boolean) {
    // The lane is part of the sheet: a pinch zooms the whole surface (the viewer's overview), a wheel scrolls it.
    if (e.defaultPrevented || this.lane()) return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      // A Safari pinch is already zooming through its gesture events.
      if (this.gesture || !e.deltaY) return;
      const dy = Math.max(-PINCH_MAX_PX, Math.min(PINCH_MAX_PX, wheelPx(e.deltaY, e.deltaMode)));
      this.setZoom(this.zoomK * Math.exp(-dy * PINCH_RATE), { x: e.clientX, y: e.clientY });
      return;
    }
    if (wheelScrolls(this.scroller, e)) this.follow.userTookOver();
    if (manual) {
      e.preventDefault();
      const page = this.scroller.clientHeight || 800;
      this.scroller.scrollBy({ top: wheelPx(e.deltaY, e.deltaMode, page), left: wheelPx(e.deltaX, e.deltaMode, page) });
    }
  }

  /** The zoom a Safari pinch started from (its gesture events carry the scale since the start). */
  private gesture: { z: number } | null = null;
  private onGesture(e: GestureLike) {
    if (this.lane()) return;
    e.preventDefault();
    if (e.type === 'gesturestart') { this.gesture = { z: this.zoomK }; return; }
    if (e.type === 'gestureend') { this.gesture = null; return; }
    if (!this.gesture || !(e.scale && e.scale > 0)) return;
    this.setZoom(this.gesture.z * e.scale, e.clientX != null && e.clientY != null ? { x: e.clientX, y: e.clientY } : undefined);
  }

  /** One zoom step in or out (see ZOOM_STEPS). */
  zoomStep(dir: -1 | 1): void { this.setZoom(zoomStepFrom(this.zoomK, dir)); }

  private makeZoomControl() {
    const bar = document.createElement('div');
    bar.className = 'desk-zoom';
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'Board zoom');
    const btn = (cls: string, label: string, title: string, html: string, run: () => void) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `desk-zoom-btn ${cls}`;
      el.setAttribute('aria-label', label);
      el.title = title;
      el.innerHTML = html;
      el.addEventListener('click', run);
      return el;
    };
    const mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
    const icon = (d: string) => `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="${d}" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/></svg>`;
    const out = btn('desk-zoom-out', 'Zoom out', `Zoom out (${mod}−)`, icon('M3.5 8h9'), () => this.zoomStep(-1));
    const pct = document.createElement('span');
    pct.className = 'desk-zoom-pct';
    pct.setAttribute('aria-live', 'polite');
    const inn = btn('desk-zoom-in', 'Zoom in', `Zoom in (${mod}+)`, icon('M3.5 8h9M8 3.5v9'), () => this.zoomStep(1));
    const sep = document.createElement('span');
    sep.className = 'desk-zoom-sep';
    sep.setAttribute('aria-hidden', 'true');
    const fit = btn('desk-zoom-fit', 'Fit the board', `Fit (${mod}0)`, 'Fit', () => this.setZoom('fit'));
    bar.append(out, pct, inn, sep, fit);
    const ctl = { out, pct, in: inn, fit };
    this.zoomCtl = ctl;
    this.syncZoomControl();
    return ctl;
  }

  private syncZoomControl() {
    const c = this.zoomCtl;
    if (!c) return;
    c.pct.textContent = `${Math.round(this.zoomK * 100)}%`;
    c.out.disabled = this.zoomK <= ZOOM_MIN + 1e-4;
    c.in.disabled = this.zoomK >= ZOOM_MAX - 1e-4;
  }

  // ---------------------------------------------------------------------------------------------

  private frame(): Frame {
    const { W, H } = this.host.viewport();
    return frameFor(W, H, this.open ? this.split : 'none', this.host.aspect(1), !!this.host.laneEl?.());
  }

  private makeSection(spec: RegionSpec): Section {
    return createSection(spec, (sec, paper) => this.makeScene(sec, paper));
  }

  metrics(split?: Split): { boardPx: number; bodyPx: (body: number | null) => number } {
    // Before the board opens: the board the normal split would give (what the first section lands in);
    // `split`: the board that split would give (the svg board opens wide).
    const { W, H } = this.host.viewport();
    const f = this.open && !split ? this.frame() : frameFor(W, H, split ?? 'normal', this.host.aspect(1), !!this.host.laneEl?.());
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
    sec.el.querySelectorAll('svg:not([data-svgboard])').forEach((svg) => svg.setAttribute('viewBox', `0 ${y0} ${REGION_W} ${y1 - y0}`));
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
    return boardLayout(f.board.w, this.specs(f), this.zoomK).boxes;
  }
  private boxOf(sec: Section): SectionBox | null {
    if (this.lane()) {
      const g = sec.group, s = this.laneScale(sec);
      if (!g) return null;
      const w = sec.el.offsetWidth || REGION_W * s, h = sec.el.offsetHeight || (sec.y1 - sec.y0) * s;
      return { x: sec.el.offsetLeft, y: g.top + sec.el.offsetTop, w, h, s };
    }
    const i = this.sections.indexOf(sec);
    return i < 0 ? null : this.boxes()[i] ?? null;
  }

  /** Board scroll top that brings section-space rect `r` into view with some air (minimal move; a tall rect top-aligned). */
  private boardTop(sec: Section, r: SRect): number {
    const box = this.boxOf(sec), b = this.frame().board;
    if (!box || !b) return this.scroller.scrollTop;
    if (sec.scene) return this.landTop(sec);
    const y = box.y + (r.y - sec.y0) * box.s, h = r.h * box.s, top = this.scroller.scrollTop;
    if (h + 2 * BOARD_AIR >= b.h) return y - BOARD_AIR;
    if (y - BOARD_AIR < top) return y - BOARD_AIR;
    if (y + h + BOARD_AIR > top + b.h) return y + h + BOARD_AIR - b.h;
    return top;
  }

  /**
   * Board scroll top that lands a section: its head (if it has one) sits where the first head sits on
   * a fresh board, under the board's head row (clear of ×), with the section right below; a scene's
   * window then fills the rest of the view. Never the section's own top: that clips its head.
   */
  private landTop(sec: Section): number {
    const box = this.boxOf(sec);
    if (!box) return this.scroller.scrollTop;
    return box.y - (this.heads.get(sec)?.h ?? 0) - BOARD_HEAD;
  }
  /** The board already sits where landTop puts it (within the scroll range). */
  private landed(sec: Section): boolean {
    const max = this.scroller.scrollHeight - this.scroller.clientHeight;
    return Math.abs(Math.max(0, Math.min(this.landTop(sec), max)) - this.scroller.scrollTop) < 2;
  }

  private async glideBoard(top: () => number): Promise<void> {
    this.boardGlide?.abort();
    const ctrl = (this.boardGlide = new AbortController());
    try { await animateScrollTo(this.scroller, top, { signal: ctrl.signal, maxMs: BOARD_GLIDE_MS, owner: this.owner }); }
    finally { if (this.boardGlide === ctrl) this.boardGlide = null; }
  }

  /** Section-space rect → view px (where it is on screen now). */
  private viewRect(sec: Section, r: SRect): ViewRect | null {
    if (this.lane()) {
      // The lane is in the page's scroll and its live group is sticky: where the section is now is the DOM's to say.
      if (!sec.el.isConnected || !sec.group || sec.group.folded) return null;
      const e = sec.el.getBoundingClientRect(), s = this.laneScale(sec);
      if (sec.scene) { const { cam } = sec.scene, k = s * cam.z; return { x: e.left + (r.x - cam.x) * k, y: e.top + (r.y - cam.y) * k, w: r.w * k, h: r.h * k }; }
      return { x: e.left + (r.x + (sec.dx ?? 0)) * s, y: e.top + (r.y - sec.y0) * s, w: r.w * s, h: r.h * s };
    }
    const box = this.boxOf(sec), b = this.frame().board;
    if (!box || !b) return null;
    if (sec.scene) {
      const { cam } = sec.scene, k = box.s * cam.z;
      return { x: b.x + box.x - this.scroller.scrollLeft + (r.x - cam.x) * k, y: b.y + box.y + (r.y - cam.y) * k - this.scroller.scrollTop, w: r.w * k, h: r.h * k };
    }
    return { x: b.x + box.x - this.scroller.scrollLeft + (r.x + (sec.dx ?? 0)) * box.s, y: b.y + box.y + (r.y - sec.y0) * box.s - this.scroller.scrollTop, w: r.w * box.s, h: r.h * box.s };
  }

  /** Puts the board, its sections and every wire where the current window says. */
  private position() {
    const f = this.frame();
    this.mountLane(f);
    if (f.lane) this.positionLane(f);
    else if (this.open && f.board) {
      const b = f.board;
      Object.assign(this.board.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });
      this.board.classList.toggle('is-stacked', f.stacked);
      const lay = boardLayout(b.w, this.specs(f), this.zoomK);
      lay.boxes.forEach((x, i) => {
        const sec = this.sections[i];
        Object.assign(sec.el.style, { left: `${x.x}px`, top: `${x.y}px`, width: `${x.w}px`, height: `${x.h}px` });
        const hd = this.heads.get(sec);
        if (!hd) return;
        // The head spans the board's content width above its section; an open aside's frame wraps its section too.
        const frame = hd.aside && !hd.collapsed ? x.h + lay.pad / 2 : 0;
        Object.assign(hd.el.style, { left: `${lay.pad / 2}px`, top: `${x.y - hd.h}px`, width: `${lay.width - lay.pad}px`, height: `${hd.h + frame}px` });
      });
      for (const m of this.midHeads) {
        const i = this.sections.indexOf(m.sec), x = lay.boxes[i];
        if (!x) continue;
        // Its bottom on the first new group's top, never above the old content's bottom (units → px).
        const floor = x.y + (m.from - m.sec.y0) * x.s;
        const top = m.y == null ? floor : Math.max(floor, x.y + (m.y - m.sec.y0) * x.s - m.h);
        Object.assign(m.el.style, { left: `${lay.pad / 2}px`, top: `${top}px`, width: `${lay.width - lay.pad}px`, height: `${m.h}px` });
      }
      this.sections.forEach((s) => { if (s.scene) this.applyCam(s); });
      this.content.style.height = `${lay.height}px`;
      // Zoomed past the board's width: the content widens and the board scrolls sideways too.
      this.content.style.width = lay.width > b.w + 0.5 ? `${lay.width}px` : '';
      this.scroller.classList.toggle('is-wide', lay.width > b.w + 0.5);
    }
    this.rerouteAll();
    this.emit();
  }

  /** The slides or the board scrolled: wires follow (once per frame), visibility waiters re-check. */
  private onMove() {
    if (this.liveGroup && this.lane()) this.liveLane();
    if (this.lane()) for (const g of this.groups) if (g !== this.liveGroup) this.clipLane(g);
    if (this.lane() && (this.liveGroup || this.edge)) this.edgeCheck();
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
  // Layout C: the anchored lane (src/desk/lane.ts). The board element becomes the lane, mounted in the
  // viewer's scroll content beside the page column: one sheet, one scroll.

  /** The lane layout is on (a window ≥ LANE_MIN_W, and the viewer has its lane layer). */
  private lane(): boolean { return !!this.frame().lane; }
  private wasLane = false;
  /** The edge marker shown now (null: none). */
  private edge: DeskState['edge'] | null = null;

  /** Recomputes the edge marker: the playing answer's latest page mark, out of the band above or below. */
  private edgeCheck() {
    let next: DeskState['edge'] | null = null;
    const k = this.inked[0];
    if (k && this.liveGroup && this.lane()) {
      const r = this.deskRect(k.page, k.r);
      const { H } = this.host.viewport(), top = this.host.scrollTop();
      if (r && r.y + r.h < top + SAFE_TOP) next = { dir: 'up', page: k.page };
      else if (r && r.y > top + H - safeBottom()) next = { dir: 'down', page: k.page };
    }
    if (next?.dir === this.edge?.dir && next?.page === this.edge?.page) return;
    this.edge = next;
    this.emit();
  }

  /** The edge marker was clicked: the sheet scrolls back to the answer's latest page mark. */
  async showEdge(): Promise<void> {
    const k = this.inked[0];
    if (!k || !this.host.layout()) return;
    await this.host.glideTo(() => this.inkFrame({ page: k.page }, k.r), 450);
  }

  /**
   * A section's scale in the lane: the lane's width (mockups C1–C4: the drawing spans the margin; its
   * text keeps its own floor, svgMinFont), at least the type cap the split board would give it.
   */
  private laneScale(sec: Section): number {
    const f = this.frame();
    // An aside's inset is indented 24 px under the paused drawing (spec §5.6).
    const cw = Math.max(1, (f.lane?.w ?? f.board?.w ?? 0) - 2 * LANE_PAD - (sec.el.classList.contains('is-aside') ? 24 : 0));
    return Math.max(cw / SECTION_W, Math.min(cw / SECTION_W, Math.max(bodyPx(sec.body, f.page.pageW), MIN_TEXT_PX) / TEXT_UNITS));
  }

  /** The pen moved: `last` is where the answer is; in the lane the dock follows the pen's column. */
  private pen(l: { t: Target; r: SRect }) {
    this.last = l;
    const inLane = l.t.region != null;
    if (inLane !== this.penLane) { this.penLane = inLane; if (this.lane()) this.emit(); }
  }

  /** The page point the answer is explaining now: its latest page ink, else the reading line in view. */
  private anchorNow(page: number): Group['anchor'] {
    const k = this.inked[0];
    if (k) return { page: k.page, y: k.r.y + Math.min(k.r.h, 40) / 2 };
    const L = this.host.layout();
    if (!L) return { page, y: 0 };
    const { H } = this.host.viewport();
    const y = this.host.scrollTop() + SAFE_TOP + 0.12 * (H - SAFE_TOP - safeBottom());
    const p = Math.max(1, Math.min(L.tops.length, pageAt(L, y)));
    return { page: p, y: Math.max(0, (y - L.tops[p - 1]) / (L.pageW / 1000)) };
  }

  /** An anchor's content y now. */
  private anchorY(a: Group['anchor']): number {
    return this.deskRect(a.page, { x: 0, y: a.y, w: 0, h: 0 })?.y ?? 0;
  }

  /** A section joins this answer's group (the first one opens it, at the answer's anchor); `head` goes above it. */
  private joinGroup(sec: Section, head: HTMLElement | null, page: number) {
    let g = this.liveGroup;
    if (!g) {
      const div = (cls: string) => { const e = document.createElement('div'); e.className = cls; return e; };
      const el = div('lane-group'), spacer = div('lane-spacer'), item = div('lane-item');
      el.append(spacer, item);
      const leader = this.leaders.appendChild(document.createElementNS(SVG, 'g')) as SVGGElement;
      const ng: Group = { el, spacer, item, leader, secs: [], head: null, provisional: !this.inked.length, anchor: this.anchorNow(page), lift: (head ? this.heads.get(sec)?.h ?? 0 : 0) + 8, top: 0, h: 0, live: true, folded: false, thumb: null };
      // A folded card opens in place on a click (before its head's own Replay).
      item.addEventListener('click', (e) => { if (ng.folded) { e.stopPropagation(); e.preventDefault(); this.fold(ng, false); this.position(); } }, true);
      this.content.insertBefore(el, this.leaders);
      this.groups.push(ng);
      this.liveGroup = g = ng;
    }
    if (head) { (g.parts ??= []).push(head); g.head ??= head; }
    (g.parts ??= []).push(sec.el);
    sec.group = g;
    g.secs.push(sec);
  }

  /** A docked group is drawn into again (a follow-up continues its board): it opens and plays again. */
  private relive(g: Group) {
    if (this.liveGroup && this.liveGroup !== g) this.dock(this.liveGroup, false);
    this.fold(g, false);
    g.live = true;
    this.liveGroup = g;
  }

  /** Folds a finished answer's group to its card (its head, a thumbnail of its drawing), or opens it again. */
  private fold(g: Group, on: boolean) {
    if (g.live || !g.head || g.folded === on) return;
    g.folded = on;
    g.el.classList.toggle('is-folded', on);
    if (on && !g.thumb) {
      const ink = g.secs[0]?.el.querySelector('.desk-region-ink');
      if (ink) {
        const t = document.createElement('span');
        t.className = 'lane-thumb';
        t.setAttribute('aria-hidden', 'true');
        const c = ink.cloneNode(true) as SVGSVGElement;
        c.removeAttribute('style');
        c.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        t.appendChild(c);
        g.thumb = t;
        g.head.querySelector('.trail-row')?.prepend(t);
      }
    }
  }

  /**
   * The answer has ended (or the next begins): its group stops being sticky and docks beside its main
   * anchor (the answer's latest page ink in view, else where it began), moving as little as it can.
   */
  private dock(g: Group, animate: boolean) {
    if (!g.live) return;
    const from = g.item.getBoundingClientRect().top;
    const now = from - this.content.getBoundingClientRect().top;
    g.live = false;
    g.item.classList.remove('is-pinned');
    for (const s of g.secs) this.crop(s);
    const { H } = this.host.viewport(), top = this.host.scrollTop();
    const seen = this.inked.find((k) => {
      const r = this.deskRect(k.page, k.r);
      return !!r && r.y + r.h / 2 >= top + SAFE_TOP && r.y + r.h / 2 <= top + H - safeBottom();
    });
    if (seen) g.anchor = { page: seen.page, y: seen.r.y + Math.min(seen.r.h, 40) / 2 };
    else {
      // None of the answer's marks is in view: the drawing stays where the student is looking (it never
      // leaves the screen at the answer's end); its anchor becomes the page point level with it.
      const L = this.host.layout(), y = now + (g.head ? g.head.offsetHeight : 0) + 8;
      if (L) { const p = Math.max(1, Math.min(L.tops.length, pageAt(L, y))); g.anchor = { page: p, y: Math.max(0, (y - L.tops[p - 1]) / (L.pageW / 1000)) }; }
    }
    this.position();
    const ay = this.anchorY(g.anchor), headH = g.head ? g.head.offsetHeight : 0;
    g.lift = ay - dockTop(now, g.h, ay, headH);
    this.position();
    if (animate) this.glideFrom(g, from);
  }

  /** Puts the board where the layout says: the lane in the scroll content, or the split board on the stage. */
  private mountLane(f: Frame) {
    const laneEl = f.lane ? this.host.laneEl?.() ?? null : null;
    const lane = !!laneEl;
    if (laneEl && this.board.parentElement !== laneEl) laneEl.appendChild(this.board);
    if (!laneEl && this.board.parentElement !== this.stage) this.stage.insertBefore(this.board, this.wireLayer);
    this.board.classList.toggle('is-lane', lane);
    if (lane) this.board.classList.add('is-open');
    else if (!this.open) this.board.classList.remove('is-open');
    for (const g of this.groups) for (const p of g.parts ?? []) {
      const want = lane ? g.item : this.content;
      if (p.parentElement !== want) want.appendChild(p);
    }
    if (typeof document !== 'undefined') document.documentElement.classList.toggle('petu-lane', lane);
    if (lane !== this.wasLane) {
      this.wasLane = lane;
      // Leaving the lane with drawings up: the split board opens (the viewer re-lays its column).
      if (!lane && this.open) { if (this.split === 'none') this.split = 'normal'; void this.host.setSplit(this.split, 0); }
      for (const s of this.sections) for (const k of ['marginLeft', 'left', 'top', 'width', 'height'] as const) s.el.style[k] = '';
      for (const h of this.heads.values()) for (const k of ['marginLeft', 'left', 'top', 'width', 'height'] as const) h.el.style[k] = '';
    }
  }

  /** Lays the lane out: sections sized, groups packed at their anchors, the live one sticky, leaders drawn. */
  private positionLane(f: Frame) {
    const lane = f.lane!, L = this.host.layout();
    const total = L ? `${L.total}px` : '100%';
    Object.assign(this.board.style, { left: `${lane.x}px`, top: '0px', width: `${lane.w}px`, height: total });
    Object.assign(this.content.style, { height: total, width: '' });
    const cw = Math.max(1, lane.w - 2 * LANE_PAD);
    for (const s of this.sections) {
      const k = this.laneScale(s);
      // An aside's inset is indented under the paused drawing (spec §5.6), the width of its head.
      const ind = s.el.classList.contains('is-aside') ? 24 : 0;
      const w = s.scene ? cw - ind : REGION_W * k, h = s.scene ? Math.round((cw - ind) * 0.62) : (s.y1 - s.y0) * k;
      Object.assign(s.el.style, { left: '', top: '', width: `${w}px`, height: `${h}px`, marginLeft: `${LANE_PAD + ind + Math.max(0, (cw - ind - w) / 2)}px` });
      const hd = this.heads.get(s);
      if (hd) Object.assign(hd.el.style, { left: '', top: '', width: `${cw - (hd.aside ? 24 : 0)}px`, height: `${hd.h}px`, marginLeft: `${LANE_PAD + (hd.aside ? 24 : 0)}px` });
    }
    for (const s of this.sections) if (s.scene) this.applyCam(s);
    for (const g of this.groups) g.h = g.folded ? FOLDED_H : g.item.offsetHeight;
    const tops = packLane(this.groups.map((g) => ({ want: g.live && g.lift === (g.head ? g.head.offsetHeight : 0) + 8 ? wantFor(this.anchorY(g.anchor), g.lift - 8) : this.anchorY(g.anchor) - g.lift, h: g.h })));
    const { H } = this.host.viewport();
    this.groups.forEach((g, i) => {
      g.top = tops[i];
      g.spacer.style.height = `${g.top}px`;
      g.el.classList.toggle('is-live', g.live);
      if (g.live) {
        const ins = stickyInsets(g.h, H, LANE_STICK, safeBottom() + 12, g.pen, g.stick);
        g.stick = g.pen ? ins.top : null;
        Object.assign(g.item.style, { top: `${ins.top}px`, bottom: `${ins.bottom}px` });
      } else { g.pen = g.stick = null; Object.assign(g.item.style, { top: '', bottom: '' }); }
      // A follow-up's header inside an extended svg section: over its first new group (units → px).
      for (const m of this.midHeads) {
        if (m.sec.group !== g) continue;
        const s = this.laneScale(m.sec), y0 = m.sec.el.offsetTop;
        const floor = y0 + (m.from - m.sec.y0) * s;
        const top = m.y == null ? floor : Math.max(floor, y0 + (m.y - m.sec.y0) * s - m.h);
        Object.assign(m.el.style, { left: `${LANE_PAD}px`, top: `${top}px`, width: `${cw}px`, height: `${m.h}px`, marginLeft: '' });
      }
    });
    this.leaders.style.height = total;
    for (const g of this.groups) { this.drawLeader(g); if (g !== this.liveGroup) this.clipLane(g); }
    if (this.liveGroup) this.liveLane();
  }

  /** The live group on scroll: pinned (stuck away from its place: the card look) or in place; its leader follows. */
  private liveLane() {
    const g = this.liveGroup!;
    const top = g.item.getBoundingClientRect().top - this.content.getBoundingClientRect().top;
    // Pinned: held in view away from the passage it belongs to (the answer walked on), out of a leader's
    // reach; a nudge to fit the band, with its anchor still beside it, is not.
    g.item.classList.toggle('is-pinned', Math.abs(top - g.top) > LEADER_MAX && !leaderPath(this.anchorY(g.anchor), { top, h: g.h }, LANE_PAD, g.head?.offsetHeight ?? 0));
    this.clipLane(g);
    this.drawLeader(g, top);
  }

  /**
   * Nothing in the lane sits under the chrome row. A group whose top has gone above the comfort band
   * (a docked one scrolled up with the page, or a live one taller than the band) is masked there with a
   * short fade. The live group's card and its "pinned" label stay in the band (--lane-clip moves them
   * down): its content is masked down to the card's top, not to the window's.
   */
  private clipLane(g: Group) {
    const r = g.item.getBoundingClientRect();
    const live = g.live && !g.folded, pinned = live && g.item.classList.contains('is-pinned');
    const band = live ? LANE_STICK : SAFE_TOP;
    const clip = r.bottom > 0 && r.top < band ? band - r.top : 0;
    g.item.style.setProperty('--lane-clip', `${Math.round(clip)}px`);
    g.item.classList.toggle('is-clipped', clip > 0);
    const mask = (el: HTMLElement | SVGElement, cut: number) => {
      const v = cut > 0 ? `linear-gradient(to bottom, transparent ${cut.toFixed(1)}px, #000 ${(cut + LANE_FADE).toFixed(1)}px)` : '';
      el.style.setProperty('mask-image', v);
      el.style.setProperty('-webkit-mask-image', v);
    };
    if (!live) {
      mask(g.item, clip);
      for (const el of [...g.item.children] as HTMLElement[]) if (el.style.maskImage || el.style.getPropertyValue('-webkit-mask-image')) mask(el, 0);
      return;
    }
    // The live item itself is never masked (its card and label are its own pseudo-elements): its parts are.
    mask(g.item, 0);
    const line = band + (pinned ? PIN_CARD : 0);
    for (const el of [...g.item.children] as HTMLElement[]) mask(el, clip > 0 ? line - el.getBoundingClientRect().top : 0);
  }

  /**
   * A group's leader: from the page edge level with its anchor (the answer's latest page ink while it
   * plays) to the drawing, ≤ 120 px; none when the drawing sits too far from it.
   */
  private drawLeader(g: Group, itemTop = g.top) {
    const head = g.head && !g.folded ? g.head.offsetHeight : 0;
    let path: { d: string; y1: number } | null = null, y0 = 0;
    if (!g.folded && g.secs.length) {
      const k = g.live ? this.inked[0] : undefined;
      const ys = [k ? this.anchorY({ page: k.page, y: k.r.y + Math.min(k.r.h, 40) / 2 }) : null, this.anchorY(g.anchor)];
      for (const y of ys) {
        if (y == null) continue;
        path = leaderPath(y, { top: itemTop, h: g.h }, LANE_PAD - 6, head);
        if (path) { y0 = y; break; }
      }
    }
    if (!path) { g.leader.replaceChildren(); return; }
    let line = g.leader.firstChild as SVGPathElement | null, dot = g.leader.lastChild as SVGCircleElement | null;
    if (!line || line === dot) {
      g.leader.replaceChildren();
      line = g.leader.appendChild(document.createElementNS(SVG, 'path')) as SVGPathElement;
      dot = g.leader.appendChild(document.createElementNS(SVG, 'circle')) as SVGCircleElement;
      dot.setAttribute('r', '3');
      dot.setAttribute('cx', '0');
    }
    line.setAttribute('d', path.d);
    dot!.setAttribute('cy', y0.toFixed(1));
  }

  // ---------------------------------------------------------------------------------------------
  // Board v2 scenes: one world per scene section, seen through a camera.

  /** Layout specs for every section: a scene fills the board's visible height under the head row and its own head. */
  private specs(f: Frame) {
    const fill = f.board ? f.board.h - BOARD_HEAD - boardPad(f.board.w) : 0;
    return this.sections.map((s) => {
      const hd = this.heads.get(s);
      return { body: bodyPx(s.body, f.page.pageW), span: s.y1 - s.y0, ...(s.scene ? { fill: fill - (hd?.h ?? 0) } : {}), ...(hd ? { head: hd.h, hidden: hd.collapsed } : {}) };
    });
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
    // A pinch (ctrl / ⌘ + wheel) zooms the scene around the cursor, and following stops. A plain wheel
    // is the board's: it scrolls past the scene and never pans it (a trackpad or touch-surface mouse
    // sends small wheel deltas while the cursor merely moves; the drawing must not move under it).
    sec.el.addEventListener('wheel', (e) => this.onSceneWheel(sec, e), { passive: false });
  }

  private onSceneWheel(sec: Section, e: WheelEvent) {
    const sc = sec.scene!, box = this.boxOf(sec);
    if (!box || !(e.ctrlKey || e.metaKey) || !e.deltaY) return;
    e.preventDefault();
    const k = box.s * sc.cam.z;
    const rect = sec.el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / k + sc.cam.x, py = (e.clientY - rect.top) / k + sc.cam.y;
    const z = Math.max(0.35, Math.min(1.6, sc.cam.z * Math.exp(-e.deltaY * 0.01)));
    const k2 = box.s * z;
    sc.cam = { x: px - (e.clientX - rect.left) / k2, y: py - (e.clientY - rect.top) / k2, z };
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
    sec.el.querySelectorAll('svg:not([data-svgboard])').forEach((svg) => { if (!svg.classList.contains('desk-wire')) svg.setAttribute('viewBox', vb); });
  }

  /** Brings a scene's window onto the board (it fills the board's visible height). */
  private async showScene(sec: Section, before?: BeforeMove) {
    const box = this.boxOf(sec), b = this.frame().board;
    if (!box || !b || this.landed(sec)) return;
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
    // The lane: the answer's group docks beside its main anchor (spec §5.2 rule 5).
    if (this.lane() && this.liveGroup && !this.asideOpen) { this.dock(this.liveGroup, true); this.liveGroup = null; this.edgeCheck(); }
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
/** The bottom of an svg board's drawn groups, in section units (null without layout). */
function inkBottom(sec: Section): number | null {
  const root = sec.layers.agent.querySelector(':scope > svg[data-svgboard]') as SVGSVGElement | null;
  const m = root?.getScreenCTM?.(), vb = root?.viewBox?.baseVal;
  if (!root || !m || !(m.d > 0) || !vb || !(vb.width > 0)) return null;
  let bottom: number | null = null;
  root.querySelectorAll(':scope > g:not([data-ghost])').forEach((g) => {
    const r = g.getBoundingClientRect();
    // Client px → the root's user units (its matrix) → section units (1000 / the canvas width).
    if (r.height > 0) bottom = Math.max(bottom ?? 0, (((r.bottom - m.f) / m.d) * REGION_W) / vb.width);
  });
  return bottom;
}
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
