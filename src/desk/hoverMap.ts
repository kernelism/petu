// src/desk/hoverMap.ts — board ↔ PDF mapping in the lane (spec queue item 3): pure parts.
/**
 * A beat of an svg board answer is one drawn group (`<g id>`) and the sentences spoken across it; the
 * page marks those sentences make (highlights, underlines, circles, notes) are the page side of the same
 * beat. The desk already sees both in the order they fire (Desk.noteInk: each group just before it
 * draws, each page mark on its word), so a page mark belongs to the latest group noted before it in
 * the same answer (an aside's marks to the aside's latest group). Marks an answer makes before its
 * first group (the opening sentence pointing at the page) belong to the answer as a whole: they map to
 * its leader, not to a part of its drawing.
 *
 * Hovering (or tapping) a drawn group shows its page marks; hovering a page mark shows its group. The
 * emphasis is the board's own "now" focus (the accent a part takes while it draws), held while the
 * pointer stays; nothing new is drawn on the board.
 */
import type { SRect } from '../geometry/space';

/**
 * A page mark: its page and its box in page target space (0–1000 wide). `past`: its answer has ended
 * (the mark retired, hidden). `own`: the tutor's own writing on the page (a note, a label, an arrow),
 * not a pointer at the page's content: once retired there is nothing of it left to show.
 */
export type BeatMark = { page: number; r: SRect; past?: boolean; own?: boolean };
/** Marks that point at the page's own text or figure. */
const POINTING = new Set(['highlight', 'underline', 'circle', 'box']);
/** One beat: the drawn group's element and the page marks spoken with it. */
/** One beat: the drawn group's element, its box in its section's units (as the director framed it), and the page marks spoken with it. */
export type Beat = { el: Element; box?: SRect; marks: BeatMark[] };

/** Attributes page marks to the beat they were spoken in (see the module note). */
export class BeatLinks {
  private now: Beat | null = null;
  private asideNow: Beat | null = null;
  private aside = false;
  private all: Beat[] = [];
  /** The current answer's marks made before its first group (answer-level). */
  private loose: BeatMark[] = [];

  /** An svg group is about to draw: it opens a beat. */
  beat(el: Element, box?: SRect): Beat {
    const b: Beat = { el, marks: [], ...(box ? { box: { ...box } } : {}) };
    if (this.aside) this.asideNow = b; else this.now = b;
    this.all.push(b);
    return b;
  }

  /** A page mark fired: it joins the current beat, or (before the answer's first group) the answer. Returns that beat (null: answer-level). */
  mark(page: number, r: SRect, kind?: string): Beat | null {
    const m: BeatMark = { page, r: { ...r }, ...(kind && !POINTING.has(kind) ? { own: true } : {}) };
    const b = this.aside ? this.asideNow : this.now;
    if (b) b.marks.push(m); else if (!this.aside) this.loose.push(m);
    return b;
  }

  /** The answer-level marks of the answer playing now (before its first group). */
  answerMarks(): BeatMark[] { return this.loose; }

  setAside(on: boolean): void {
    if (on === this.aside) return;
    this.aside = on;
    if (on) this.asideNow = null;
  }

  /** A new answer: no beat is current; every mark so far has retired. Returns the ended answer's loose marks. */
  newAnswer(): BeatMark[] {
    for (const b of this.all) for (const m of b.marks) m.past = true;
    const ended = this.loose;
    for (const m of ended) m.past = true;
    this.loose = [];
    this.now = this.asideNow = null;
    this.aside = false;
    return ended;
  }

  /** Forgets everything (the board is cleared). */
  clear(): void { this.all = []; this.loose = []; this.now = this.asideNow = null; this.aside = false; }
}

type Box = { x: number; y: number; w: number; h: number };
const inside = (b: Box, x: number, y: number, pad: number) => x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad;

/**
 * The group under a point on the board (board units) when the pointer is on the paper between its
 * strokes: the smallest box that holds the point (a label's group before the chart around it); null
 * when none does. Boxes in drawing order; a tie goes to the later group (drawn on top).
 */
export function boxAt(boxes: (Box | null)[], x: number, y: number, pad = 0): number {
  let best = -1, area = Infinity;
  boxes.forEach((b, i) => {
    if (!b || !inside(b, x, y, pad)) return;
    const a = Math.max(1, b.w) * Math.max(1, b.h);
    if (a <= area) { area = a; best = i; }
  });
  return best;
}

/** The mark under a point (both in sheet px): the latest one whose box (padded) holds it; -1 when none. */
export function markAt(rects: (Box | null)[], x: number, y: number, pad = 4): number {
  for (let i = rects.length - 1; i >= 0; i--) { const r = rects[i]; if (r && inside(r, x, y, pad)) return i; }
  return -1;
}

// ------------------------------------------------------------------------------------------------
// The lane's hover controller (DOM).

const SVGNS = 'http://www.w3.org/2000/svg';
/** Air (sheet px) around a page mark's focus outline. */
const MARK_PAD = 3;

/** What the controller needs of a lane group (Desk's Group). */
/** `loose`: each answer's marks made before its first group (an extended board holds more than one answer). */
export type HoverGroup = { item: HTMLElement; leader: SVGGElement; folded: boolean; beats: Beat[]; loose: BeatMark[][] };
export type HoverHost = {
  /** The lane is the layout now (the mapping is the lane's). */
  lane(): boolean;
  /** The lane's content box (the board's content): the page-mark outlines are drawn in it. */
  content: HTMLElement;
  /** The sheet the pages and the lane share (null before the first layout). */
  sheet(): HTMLElement | null;
  groups(): HoverGroup[];
  /** A page target-space rect → sheet px. */
  sheetRect(page: number, r: SRect): Box | null;
  /** The lane content's left edge in sheet px. */
  originX(): number;
  /** The overview zoom (sheet px × z = window px). */
  zoom(): number;
};
type Focus = { g: HoverGroup; beat: Beat | null; marks: BeatMark[] };

/**
 * What is under the pointer: the hit test, not the event's target (WebKit targets a pointer event over
 * a nested svg drawing at the outer svg, and can target the lane's full-height overlay svgs despite
 * their pointer-events: none).
 */
const under = (e: MouseEvent): EventTarget | null => (typeof document.elementFromPoint === 'function' ? document.elementFromPoint(e.clientX, e.clientY) : null) ?? e.target;

/**
 * Hover (mouse) or tap (touch) on a drawn group or a page mark → the pair takes the focus: the group
 * its "now" accent (`data-focus`, styled like the part being drawn), its page marks a violet outline,
 * the group's leader brightens. The pointer over any part of an open answer brightens its leader.
 */
export class LaneHover {
  private focus: Focus | null = null;
  private hot: HoverGroup | null = null;
  private layer: SVGSVGElement;
  /** Touch: a tapped focus stays until the next tap. */
  private pinned = false;
  private lastType = 'mouse';
  private off: (() => void)[] = [];

  constructor(private h: HoverHost) {
    this.layer = document.createElementNS(SVGNS, 'svg') as SVGSVGElement;
    this.layer.setAttribute('class', 'lane-focus');
    this.layer.setAttribute('aria-hidden', 'true');
    h.content.appendChild(this.layer);
    const move = (e: PointerEvent) => {
      this.lastType = e.pointerType;
      if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
      // At once, not on the next frame: WebKit can hold frames back while the pointer moves (the
      // focus then lagged a group behind). The work is a few rect tests.
      if (!this.pinned) this.track(e.clientX, e.clientY, under(e));
    };
    const down = (e: PointerEvent) => { this.lastType = e.pointerType; };
    const tap = (e: MouseEvent) => {
      if (this.lastType !== 'touch' || !this.h.lane()) return;
      const f = this.find(e.clientX, e.clientY, under(e));
      this.pinned = !!f;
      this.set(f, f?.g ?? null);
    };
    const leave = () => { if (!this.pinned) this.set(null, null); };
    document.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerdown', down, { passive: true, capture: true });
    document.addEventListener('click', tap, true);
    document.documentElement.addEventListener('pointerleave', leave);
    this.off.push(() => document.removeEventListener('pointermove', move), () => document.removeEventListener('pointerdown', down, true), () => document.removeEventListener('click', tap, true), () => document.documentElement.removeEventListener('pointerleave', leave));
  }

  /** Keeps the outline layer last in the content (above groups added after it). */
  raise(): void { if (this.layer.nextSibling) this.h.content.appendChild(this.layer); }

  /** Drops any focus (a fold, a new layout, a cleared board). */
  clear(): void { this.pinned = false; this.set(null, null); }

  /** Re-draws the page outlines where the marks are now (the lane re-laid out). */
  relayout(): void { if (this.focus) this.outline(this.focus.marks); }

  destroy(): void { this.clear(); this.off.forEach((f) => f()); this.layer.remove(); }

  private track(x: number, y: number, t: EventTarget | null) {
    if (!this.h.lane()) { if (this.focus || this.hot) this.set(null, null); return; }
    const f = this.find(x, y, t);
    const item = (t as Element | null)?.closest?.('.lane-item');
    const hot = f?.g ?? this.h.groups().find((g) => g.item === item && !g.folded) ?? null;
    this.set(f, hot);
  }

  /** The pair under a window point: a drawn group in an open answer, else a page mark (shown ones only). */
  private find(x: number, y: number, t: EventTarget | null): Focus | null {
    const el = t as Element | null;
    const groups = this.h.groups().filter((g) => !g.folded);
    if (el?.closest?.('.lane-item')) {
      const g = groups.find((x) => x.item.contains(el));
      if (!g || !el.closest('.desk-region')) return null;
      const beat = g.beats.find((b) => b.el.isConnected && b.el.contains(el)) ?? this.beatUnder(g, el.closest('.desk-region')!, x, y);
      return beat ? { g, beat, marks: beat.marks } : null;
    }
    const sheet = this.h.sheet();
    if (!sheet || !el?.closest || !sheet.contains(el) || el.closest('.desk-board')) return null;
    const r = sheet.getBoundingClientRect(), z = this.h.zoom() || 1;
    const sx = (x - r.left) / z, sy = (y - r.top) / z;
    const pastOn = document.documentElement.classList.contains('petu-past-on');
    const cands: { g: HoverGroup; beat: Beat | null; m: BeatMark }[] = [];
    for (const g of groups) {
      for (const l of g.loose) for (const m of l) cands.push({ g, beat: null, m });
      for (const b of g.beats) for (const m of b.marks) cands.push({ g, beat: b, m });
    }
    const shown = cands.filter((c) => !c.m.past || pastOn);
    const i = markAt(shown.map((c) => this.h.sheetRect(c.m.page, c.m.r)), sx, sy);
    if (i < 0) return null;
    const c = shown[i];
    return { g: c.g, beat: c.beat, marks: c.beat ? c.beat.marks : [c.m] };
  }

  /**
   * The beat whose box holds the point (smallest first), by plain geometry: the section's own box on
   * screen and its cropped viewBox (section units). DOM hit tests can't be used for this: WebKit
   * reports the outer svg for any point over a nested svg drawing, and its rects for the groups inside
   * one are unreliable.
   */
  private beatUnder(g: HoverGroup, sec: Element, x: number, y: number): Beat | null {
    const beats = g.beats.filter((b) => b.box && b.el.isConnected && sec.contains(b.el));
    if (!beats.length) return null;
    const ink = sec.querySelector(':scope > svg.desk-region-ink');
    const vb = (ink?.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
    const r = sec.getBoundingClientRect();
    if (vb.length !== 4 || !(vb[2] > 0 && vb[3] > 0) || !(r.width > 0 && r.height > 0)) return null;
    // The layer keeps its aspect (meet, centred): the scale is the smaller fit.
    const k = Math.min(r.width / vb[2], r.height / vb[3]);
    const ox = r.left + (r.width - vb[2] * k) / 2, oy = r.top + (r.height - vb[3] * k) / 2;
    const ux = vb[0] + (x - ox) / k, uy = vb[1] + (y - oy) / k;
    const i = boxAt(beats.map((b) => b.box!), ux, uy, 4);
    return i < 0 ? null : beats[i];
  }

  private set(f: Focus | null, hot: HoverGroup | null) {
    const same = f && this.focus && f.g === this.focus.g && f.beat === this.focus.beat && (f.beat || f.marks[0] === this.focus.marks[0]);
    if (!same) {
      this.focus?.beat?.el.removeAttribute('data-focus');
      this.focus = f;
      f?.beat?.el.setAttribute('data-focus', '');
      this.outline(f?.marks ?? []);
    }
    if (hot !== this.hot) {
      this.hot?.leader.classList.remove('is-hot');
      this.hot = hot;
      hot?.leader.classList.add('is-hot');
    }
  }

  /** Violet outlines around the focused page marks (sheet px → the content's own px). */
  private outline(marks: BeatMark[]) {
    this.layer.replaceChildren();
    const ox = this.h.originX();
    for (const m of marks) {
      if (m.past && m.own) continue;
      const r = this.h.sheetRect(m.page, m.r);
      if (!r) continue;
      const e = this.layer.appendChild(document.createElementNS(SVGNS, 'rect'));
      const p = MARK_PAD;
      for (const [k, v] of Object.entries({ x: r.x - ox - p, y: r.y - p, width: Math.max(1, r.w) + 2 * p, height: Math.max(1, r.h) + 2 * p, rx: 4 })) e.setAttribute(k, String(+(+v).toFixed(1)));
    }
    this.layer.classList.toggle('is-on', this.layer.childElementCount > 0);
  }
}
