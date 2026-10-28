// src/desk/Desk.ts
import type { SRect } from '../geometry/space';
import type { PageLayers } from '../pdf/viewerApi';
import { REGION_H, REGION_W, type Target } from '../script/types';
import type { Stroke } from '../ink/agent/strokes';
import { Follow } from './follow';
import { routeConnector, edgeFor, maskBlocker } from './route';
import {
  column, lanesFor, gapsFor, placeAll, regionRects, stageLayout, inView, fitTogether, frameTop, frameInk,
  type Placed, type RegionReq,
} from './layout';
import type { BeforeMove, ConnectorEnd, ConnectorHandle, DeskApi, DeskHost, DeskMode, DeskRect, DeskState, Lanes, RegionInfo, RegionMode, RegionSpec } from './types';

export type { DeskHost } from './types';

const SVG = 'http://www.w3.org/2000/svg';
export const MAX_REGIONS = 2;
export const GLIDE_MS = 420;
export const CARD_SWAP_MS = 300;
const WIRE_PAD = 8;
const WHOLE_REGION = { x: 0, y: 0, w: REGION_W, h: REGION_H };

type Region = { req: RegionReq; mode: RegionMode; el: HTMLDivElement; layers: PageLayers };
/** `stroke` is the handle's own array, rewritten in place on every re-route (emph re-traces the current path). */
type Wire = { page: ConnectorEnd; region: ConnectorEnd; reversed: boolean; svg: SVGSVGElement; group: SVGGElement; stroke: Stroke; avoid: SRect[] };
type Where = { frame: 'desk' | 'stage'; rect: DeskRect };

const toD = (s: Stroke) => s.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));
const sameLanes = (a: Lanes, b: Lanes) => a.left === b.left && a.right === b.right;
const sameGaps = (a: ReadonlyMap<number, number>, b: ReadonlyMap<number, number>) => a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);

/** The desk: sketch regions beside pages (C) or on the takeover stage (B), connectors, follow mode. */
export class Desk implements DeskApi {
  readonly follow = new Follow();
  private regions = new Map<string, Region>();
  private wires: Wire[] = [];
  private mode: DeskMode = 'c';
  /** The region on the B stage, and the page on the card. */
  private active: string | null = null;
  private card: number | null = null;
  private lanes: Lanes = { left: 0, right: 0 };
  /** The column a glide in flight is heading to: the state names it from the glide's start, so the dock and the neighbour dim move with it. */
  private heading: { x: number; w: number } | null = null;
  private gaps: ReadonlyMap<number, number> = new Map();
  /** The last place the answer was looked at, for "Back to answer". */
  private last: { t: Target; r: SRect } | null = null;
  /** Page ink of this answer, most recent first: framing the next mark keeps these in view when they fit. */
  private inked: { page: number; r: SRect }[] = [];
  /**
   * Bumped by reset() and abort(). Every async move captures it and bails after each await when it
   * changed, so a stopped or replaced answer's move in flight never lands (enters B, pans) later.
   */
  private epoch = 0;
  private subs = new Set<(s: DeskState) => void>();
  private off: (() => void)[] = [];
  private back: HTMLButtonElement;

  constructor(private host: DeskHost, private stage: HTMLDivElement) {
    this.off.push(
      host.onLayout(() => void this.relayout(0)),
      host.onUserIntent(() => this.follow.userTookOver()),
      host.onCardClick(() => this.leaveB()),
      this.follow.subscribe(() => this.emit()),
    );
    this.back = document.createElement('button');
    this.back.type = 'button';
    this.back.className = 'desk-card-back';
    this.back.addEventListener('click', () => this.leaveB());
    stage.appendChild(this.back);
  }

  destroy(): void { this.off.forEach((f) => f()); this.stage.replaceChildren(); this.stage.classList.remove('is-b'); }

  /** Esc between answers: leave the stage without touching follow mode. */
  exitStage(): Promise<void> { return this.exitB(); }

  // ---------------------------------------------------------------------------------------------
  // DeskApi

  following(): boolean { return this.follow.following(); }
  cancel(): void { this.host.cancelGlide(); }

  abort(): void {
    this.epoch++;
    this.host.cancelGlide();
    // Lanes kept by reset(keepLanes) for a sketch that never came: the column goes back to center.
    if (!this.regions.size) void this.applyColumn([], GLIDE_MS);
  }
  subscribe(cb: (s: DeskState) => void): () => void { this.subs.add(cb); return () => { this.subs.delete(cb); }; }

  state(): DeskState {
    const L = this.host.layout();
    const { W, H } = this.host.viewport();
    const sketching = [...this.regions.values()].some((r) => r.mode !== 'b');
    const s: DeskState = { mode: this.mode, following: this.follow.following(), sketching, column: this.heading ?? { x: L?.pageX ?? 0, w: L?.pageW ?? W } };
    if (this.mode === 'b' && this.card != null) { s.canvas = stageLayout(W, H, this.host.aspect(this.card)).canvas; s.card = this.card; }
    return s;
  }

  region(id: string): RegionInfo | null {
    const r = this.regions.get(id);
    if (!r) return null;
    return { id, page: r.req.page, size: r.req.size, mode: r.mode, layers: r.layers, scale: () => (this.where({ region: id }, { x: 0, y: 0, w: 1000, h: 0 })?.rect.w ?? 1000) / 1000 };
  }

  async addRegion(spec: RegionSpec, before?: BeforeMove): Promise<RegionInfo | string> {
    const ep = this.epoch;
    if (this.regions.size >= MAX_REGIONS) return `max ${MAX_REGIONS} regions per answer`;
    if (this.regions.has(spec.id)) return 'duplicate region id';
    const el = document.createElement('div');
    el.className = 'desk-region';
    el.dataset.id = spec.id;
    const layer = (cls: string) => {
      const svg = document.createElementNS(SVG, 'svg');
      svg.setAttribute('class', `desk-region-layer ${cls}`);
      svg.setAttribute('viewBox', '0 0 1000 700');
      svg.setAttribute('aria-hidden', 'true');
      el.appendChild(svg);
      return svg.appendChild(document.createElementNS(SVG, 'g')) as SVGGElement;
    };
    const layers = { highlight: layer('desk-region-hl'), agent: layer('desk-region-ink') };
    const r: Region = { req: { ...spec }, mode: 'b', el, layers };
    this.regions.set(spec.id, r);
    this.last = { t: { region: spec.id }, r: WHOLE_REGION };
    const live = () => ep === this.epoch && this.regions.get(spec.id) === r;
    // Rule 1: a C region is framed as it is placed. When it lands off screen, the scroll glides
    // alongside the column glide (ending before the column commits), so its first ink needs no pan.
    // Framed with its page when both fit: the page being explained stays whole and clear of the caption.
    const offScreen = () => {
      if (!live() || r.mode === 'b' || this.mode !== 'c' || !this.follow.following()) return false;
      const f = this.regionFrame(spec.id);
      return !f || !inView(f, this.view());
    };
    const along = () => (offScreen() ? this.frameRegion(spec.id, GLIDE_MS) : Promise.resolve());
    await this.relayout(GLIDE_MS, before, along);
    if (live() && r.mode === 'b' && this.follow.following()) await this.enterB(spec.id, spec.page, before);
    else if (offScreen()) {
      // No column change to glide alongside (or it left B first, or the frame drifted): pan now.
      await before?.();
      if (offScreen()) await this.frameRegion(spec.id, 450);
    }
    if (this.regions.get(spec.id) === r) el.classList.add('is-shown');
    return live() ? this.region(spec.id) ?? 'desk reset' : 'desk reset';
  }

  noteInk(t: Target, r: SRect): void {
    if (t.page == null) return;
    this.inked.unshift({ page: t.page, r });
    if (this.inked.length > 8) this.inked.length = 8;
  }

  async reveal(t: Target, r: SRect, before?: BeforeMove, anchor?: SRect): Promise<boolean> {
    const ep = this.epoch;
    this.last = { t, r };
    if (!this.follow.following()) return false;
    if (this.isVisible(t, r)) return false;
    if (t.region != null) {
      const reg = this.regions.get(t.region);
      if (!reg) return false;
      if (reg.mode === 'b') { await this.enterB(t.region, this.card ?? reg.req.page, before); return true; }
    } else if (this.mode === 'b') {
      // Pointing at another page while the stage is up: that page goes on the card (rule 2).
      await before?.();
      if (ep !== this.epoch || this.mode !== 'b') return false;
      const page = t.page;
      this.card = page;
      this.back.classList.remove('is-shown');
      this.placeBack(page);
      this.position(); // the region refits for the new card's aspect; wires re-route or hide
      await this.host.setCard({ page, rect: this.stageNow(page).card }, CARD_SWAP_MS);
      this.showBack(page);
      return true;
    }
    if (this.mode === 'b') await this.exitB(before);
    if (ep !== this.epoch) return false;
    const w = this.where(t, r);
    if (!w) return false;
    await before?.();
    if (ep !== this.epoch) return false;
    await this.host.glideTo(() => this.inkFrame(t, r, anchor), 450);
    return true;
  }

  /** Scroll top for revealing `r`: page ink with its labels and the answer's earlier ink on that page (frameInk); else centered. */
  private inkFrame(t: Target, r: SRect, anchor?: SRect): number {
    const rect = this.where(t, r)?.rect ?? { x: 0, y: NaN, w: 0, h: 0 };
    if (t.page == null) return frameTop(rect, this.view());
    const ctx = this.inked
      .filter((k) => k.page === t.page && k.r !== r)
      .map((k) => this.where({ page: k.page }, k.r)?.rect)
      .filter((x): x is DeskRect => !!x);
    const a = anchor ? this.where(t, anchor)?.rect : undefined;
    return frameInk(rect, ctx, this.view(), a);
  }

  isVisible(t: Target, r: SRect): boolean {
    if (t.region != null) {
      const reg = this.regions.get(t.region);
      if (!reg) return false;
      if (reg.mode === 'b') return this.mode === 'b' && this.active === t.region;
      if (this.mode === 'b') return false;
    } else if (this.mode === 'b') return t.page === this.card;
    const w = this.where(t, r);
    return !!w && inView(w.rect, { top: this.host.scrollTop(), H: this.host.viewport().H, max: this.host.maxScroll() });
  }

  whenVisible(t: Target, r: SRect, maxMs = 1200): Promise<boolean> {
    if (this.isVisible(t, r)) return Promise.resolve(true);
    return new Promise((resolve) => {
      const check = () => { if (this.isVisible(t, r)) done(true); };
      const offScroll = this.host.onScroll(check);
      const offState = this.subscribe(check);
      const timer = setTimeout(() => done(false), maxMs);
      const done = (v: boolean) => { offScroll(); offState(); clearTimeout(timer); resolve(v); };
    });
  }

  async frameBoth(a: ConnectorEnd, b: ConnectorEnd, before?: BeforeMove): Promise<void> {
    const ep = this.epoch;
    const pageEnd = a.t.page != null ? a : b, regEnd = a.t.page != null ? b : a;
    const reg = regEnd.t.region != null ? this.regions.get(regEnd.t.region) : undefined;
    this.last = regEnd;
    if (!this.follow.following() || !reg || pageEnd.t.page == null) return;
    if (reg.mode === 'b') { await this.enterB(reg.req.id, pageEnd.t.page, before); return; }
    if (this.mode === 'b') await this.exitB(before);
    if (ep !== this.epoch || this.regions.get(reg.req.id) !== reg) return;
    const pa = this.where(pageEnd.t, pageEnd.r), ra = this.where(regEnd.t, regEnd.r);
    if (!pa || !ra) return;
    const { H } = this.host.viewport();
    if (fitTogether([pa.rect, ra.rect], H)) {
      const u = () => {
        const p = this.where(pageEnd.t, pageEnd.r)?.rect, q = this.where(regEnd.t, regEnd.r)?.rect;
        if (!p || !q) return { x: 0, y: NaN, w: 0, h: 0 }; // gone: frameTop stays put
        const y = Math.min(p.y, q.y);
        return { x: 0, y, w: 1, h: Math.max(p.y + p.h, q.y + q.h) - y };
      };
      if (inView(u(), this.view())) return;
      await before?.();
      if (ep !== this.epoch) return;
      await this.host.glideTo(() => frameTop(u(), this.view()), 450);
      return;
    }
    // They can't be on screen together: the region goes to the stage, the page onto the card (rule 3).
    reg.req.forceB = true;
    await this.relayout(GLIDE_MS, before);
    // A reset (new answer) or stop while the lanes glided: the region may be gone; never stage it then.
    if (ep !== this.epoch || this.regions.get(reg.req.id) !== reg || !this.follow.following()) return;
    await this.enterB(reg.req.id, pageEnd.t.page, before);
  }

  async scrollToPage(page: number, y?: number): Promise<void> {
    this.last = { t: { page }, r: { x: 0, y: 0, w: 1000, h: 0 } };
    if (!this.follow.following()) return;
    const ep = this.epoch;
    if (this.mode === 'b') await this.exitB();
    if (ep !== this.epoch) return;
    await this.host.scrollToPage(page, y);
  }

  addConnector(from: ConnectorEnd, to: ConnectorEnd, avoid: SRect[] = []): ConnectorHandle | string {
    const reversed = from.t.region != null;
    const page = reversed ? to : from, region = reversed ? from : to;
    if (page.t.page == null || region.t.region == null || !this.regions.has(region.t.region)) return 'connector needs a page and a region';
    const svg = document.createElementNS(SVG, 'svg') as SVGSVGElement;
    svg.setAttribute('class', 'desk-wire');
    svg.setAttribute('aria-hidden', 'true');
    const group = svg.appendChild(document.createElementNS(SVG, 'g')) as SVGGElement;
    const w: Wire = { page, region, reversed, svg, group, stroke: [], avoid };
    const stroke = this.route(w);
    if (!stroke) return 'connector end off screen';
    w.stroke = stroke;
    this.wires.push(w);
    return { group, stroke, scale: 1 };
  }

  /**
   * Fades out and removes every region and wire, leaves B and follows again. By default the lanes
   * collapse too (the column glides back to center). With `keepLanes` the column stays where it is,
   * so a sketch that immediately follows (the new answer's first action) glides from here directly
   * instead of back to center and out again; a later reset() without it collapses them.
   */
  async reset(ms: number, opts: { keepLanes?: boolean } = {}): Promise<void> {
    this.epoch++;
    this.inked = [];
    this.follow.setAnswering(true);
    const els: Element[] = [...[...this.regions.values()].map((r) => r.el), ...this.wires.map((w) => w.svg)];
    this.regions.clear();
    this.wires = [];
    this.last = null;
    // The old nodes fade and go on their own: the new answer's first action doesn't wait for the fade.
    if (els.length) {
      for (const el of els) { (el as HTMLElement).style.transition = `opacity ${ms}ms ease-out`; (el as HTMLElement).style.opacity = '0'; }
      void wait(ms).then(() => els.forEach((e) => e.remove()));
    }
    const leaving = this.mode === 'b' ? this.exitB() : Promise.resolve();
    await Promise.all([leaving, opts.keepLanes ? Promise.resolve() : this.applyColumn([], GLIDE_MS)]);
    this.emit();
  }

  /** "Back to answer": follow again and return to where the answer was. */
  async resume(): Promise<void> {
    this.follow.resume();
    const l = this.last;
    if (!l) return;
    if (l.t.region != null && this.regions.get(l.t.region)?.mode === 'b') { await this.enterB(l.t.region, this.card ?? this.regions.get(l.t.region)!.req.page); return; }
    await this.reveal(l.t, l.r);
  }

  // ---------------------------------------------------------------------------------------------

  /** What placing C region `id` frames: the region and its page together when they fit the band, else the region. */
  private regionFrame(id: string): DeskRect | null {
    const reg = this.regions.get(id);
    const w = reg ? this.where({ region: id }, WHOLE_REGION) : null;
    if (!reg || !w || w.frame !== 'desk') return w?.rect ?? null;
    const L = this.host.layout();
    if (!L) return w.rect;
    const i = reg.req.page - 1, page = { x: L.pageX, y: L.tops[i], w: L.pageW, h: L.heights[i] };
    if (!fitTogether([page, w.rect], this.host.viewport().H)) return w.rect;
    const y = Math.min(page.y, w.rect.y);
    return { x: Math.min(page.x, w.rect.x), y, w: 1, h: Math.max(page.y + page.h, w.rect.y + w.rect.h) - y };
  }

  private view() { return { top: this.host.scrollTop(), H: this.host.viewport().H, max: this.host.maxScroll() }; }
  private stageNow(page: number) { const { W, H } = this.host.viewport(); return stageLayout(W, H, this.host.aspect(page)); }
  private placed(): Placed[] { return [...this.regions.values()].map((r) => ({ ...r.req, mode: r.mode })); }

  /**
   * Glides the scroll to frame region `id` whole. The target is re-read every frame from the committed
   * layout; if the region goes (a reset), the last target holds, so the glide doesn't drift back.
   */
  private frameRegion(id: string, maxMs: number): Promise<void> {
    let last = NaN;
    return this.host.glideTo(() => {
      const f = this.regionFrame(id);
      if (f) last = frameTop(f, this.view());
      return Number.isNaN(last) ? this.host.scrollTop() : last;
    }, maxMs);
  }

  /**
   * Rule 7: re-places every region for the current window from its request; moves frames between the desk and the stage.
   * `along` runs alongside the column glide, when there is one.
   */
  private async relayout(ms: number, before?: BeforeMove, along?: () => Promise<void>): Promise<void> {
    const { W, H } = this.host.viewport();
    const placed = placeAll([...this.regions.values()].map((r) => r.req), W, H);
    for (const p of placed) { const r = this.regions.get(p.id); if (r) r.mode = p.mode; }
    await this.applyColumn(placed, ms, before, along);
    // The stage shows a region that is no longer B (the window grew, or it was reset): back to C.
    if (this.mode === 'b' && this.active && this.regions.get(this.active)?.mode !== 'b') await this.exitB(before);
    this.position();
    // Still in B (a resize): the card follows the new stage at once. Same card, so the viewer only moves it.
    if (this.mode === 'b' && this.card != null) {
      this.placeBack(this.card);
      await this.host.setCard({ page: this.card, rect: this.stageNow(this.card).card }, 0);
    }
  }

  private async applyColumn(placed: Placed[], ms: number, before?: BeforeMove, along?: () => Promise<void>) {
    const { W } = this.host.viewport();
    const lanes = lanesFor(placed, W);
    const gaps = gapsFor(placed, W, column(W, lanes));
    if (sameLanes(lanes, this.lanes) && sameGaps(gaps, this.gaps)) return;
    if (before) {
      await before();
      if (sameLanes(lanes, this.lanes) && sameGaps(gaps, this.gaps)) return;
    }
    this.lanes = lanes;
    this.gaps = gaps;
    const col = column(W, lanes);
    const heading = (this.heading = { x: col.pageX, w: col.pageW });
    if (ms > 0) this.emit();
    try {
      await Promise.all([this.host.setColumn(lanes, gaps, ms), along?.()]);
    } finally {
      if (this.heading === heading) this.heading = null;
    }
  }

  /** Puts every frame and wire where the current layout says. */
  private position() {
    const L = this.host.layout();
    if (!L) return;
    const { W, H } = this.host.viewport();
    const rects = regionRects(this.placed(), L, W);
    for (const r of this.regions.values()) {
      const rect = r.mode === 'b' ? stageLayout(W, H, this.host.aspect(this.card ?? r.req.page)).region : rects.get(r.req.id)!;
      const parent = r.mode === 'b' ? this.stage : this.host.layer();
      if (r.el.parentNode !== parent) parent.appendChild(r.el); // same nodes: ink in flight keeps drawing (rule 7)
      Object.assign(r.el.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` });
      r.el.classList.toggle('is-staged', r.mode === 'b');
      r.el.classList.toggle('is-active', r.mode !== 'b' || this.active === r.req.id);
    }
    for (const w of this.wires) {
      const s = this.route(w);
      // An end that can't be placed now (its page is off the card, its region not on the stage): hide the wire.
      w.svg.style.display = s ? '' : 'none';
      if (s) { w.group.querySelector('path')?.setAttribute('d', toD(s)); w.stroke.splice(0, w.stroke.length, ...s); }
    }
    this.emit();
  }

  /** Target-space rect → desk px (C) or stage px (B). Null for an unknown region. */
  private where(t: Target, r: SRect): Where | null {
    const L = this.host.layout();
    if (!L) return null;
    const { W, H } = this.host.viewport();
    if (t.region != null) {
      const reg = this.regions.get(t.region);
      if (!reg) return null;
      const box = reg.mode === 'b' ? stageLayout(W, H, this.host.aspect(this.card ?? reg.req.page)).region : regionRects(this.placed(), L, W).get(t.region)!;
      const k = box.w / 1000;
      return { frame: reg.mode === 'b' ? 'stage' : 'desk', rect: { x: box.x + r.x * k, y: box.y + r.y * k, w: r.w * k, h: r.h * k } };
    }
    if (this.mode === 'b' && t.page === this.card) {
      const c = this.stageNow(t.page).card, k = c.w / 1000;
      return { frame: 'stage', rect: { x: c.x + r.x * k, y: c.y + r.y * k, w: r.w * k, h: r.h * k } };
    }
    const k = L.pageW / 1000;
    return { frame: 'desk', rect: { x: L.pageX + r.x * k, y: L.tops[t.page - 1] + r.y * k, w: r.w * k, h: r.h * k } };
  }

  /** Routes a wire for the current layout and fits its svg around it. Null when an end can't be placed. */
  private route(w: Wire): Stroke | null {
    const reg = this.regions.get(w.region.t.region!);
    const p = this.where(w.page.t, w.page.r), q = this.where(w.region.t, w.region.r);
    if (!reg || !p || !q || p.frame !== q.frame) return null; // in B the page end must be on the card
    if (reg.mode === 'b' && (this.mode !== 'b' || this.active !== reg.req.id)) return null; // its region isn't the one on the stage
    const L = this.host.layout()!;
    const page = p.frame === 'stage'
      ? this.stageNow(w.page.t.page!).card
      : { x: L.pageX, y: L.tops[w.page.t.page! - 1], w: L.pageW, h: L.heights[w.page.t.page! - 1] };
    // Around the page's printed content (its rendered canvas), when known: never across a figure if a clear band exists.
    const mask = this.host.contentMask?.(w.page.t.page!) ?? null;
    const avoid = w.avoid.map((b) => this.where(w.region.t, b)?.rect).filter((r): r is DeskRect => !!r);
    let s = routeConnector(p.rect, q.rect, edgeFor(reg.mode, page), { page, blocked: mask ? maskBlocker(mask, page) : undefined, avoid });
    if (w.reversed) s = s.slice().reverse();
    const xs = s.map((v) => v.x), ys = s.map((v) => v.y);
    const box = { x: Math.min(...xs) - WIRE_PAD, y: Math.min(...ys) - WIRE_PAD, w: Math.max(...xs) - Math.min(...xs) + 2 * WIRE_PAD, h: Math.max(...ys) - Math.min(...ys) + 2 * WIRE_PAD };
    const parent = p.frame === 'stage' ? this.stage : this.host.layer();
    if (w.svg.parentNode !== parent) parent.appendChild(w.svg);
    w.svg.setAttribute('viewBox', `${box.x} ${box.y} ${box.w} ${box.h}`);
    Object.assign(w.svg.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` });
    return s;
  }

  /** Shows region `id` on the takeover stage with `page` on the card. */
  private async enterB(id: string, page: number, before?: BeforeMove): Promise<void> {
    if (this.mode === 'b' && this.active === id && this.card === page) return; // already up: nothing moves
    if (before) {
      const ep = this.epoch;
      await before();
      if (ep !== this.epoch || !this.regions.has(id) || (this.mode === 'b' && this.active === id && this.card === page)) return;
    }
    const swap = this.mode === 'b' && this.card !== page;
    this.mode = 'b';
    this.active = id;
    this.card = page;
    this.stage.classList.add('is-b');
    this.back.classList.remove('is-shown');
    this.placeBack(page);
    this.position();
    await this.host.setCard({ page, rect: this.stageNow(page).card }, swap ? CARD_SWAP_MS : GLIDE_MS);
    this.showBack(page);
  }

  /** The card's label fades in once the card has landed (never ahead of it, at its final spot). */
  private showBack(page: number) {
    if (this.mode === 'b' && this.card === page) this.back.classList.add('is-shown');
  }

  /** "Page N · Back to page", under the card. */
  private placeBack(page: number) {
    this.back.textContent = `Page ${page} · Back to page`;
    const c = this.stageNow(page).card;
    Object.assign(this.back.style, { left: `${c.x}px`, top: `${c.y + c.h + 8}px` });
  }

  private async exitB(before?: BeforeMove): Promise<void> {
    if (this.mode !== 'b') return;
    if (before) { await before(); if (this.mode !== 'b') return; }
    this.mode = 'c';
    this.active = null;
    this.card = null;
    this.back.classList.remove('is-shown');
    this.stage.classList.remove('is-b');
    this.position();
    await this.host.setCard(null, GLIDE_MS);
  }

  /** The student clicked the card (or its button): back to the page, and stop following. */
  private leaveB() {
    this.follow.userTookOver();
    void this.exitB();
  }

  private emit() { const s = this.state(); this.subs.forEach((f) => f(s)); }
}
