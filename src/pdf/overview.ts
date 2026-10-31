// src/pdf/overview.ts
/**
 * Overview zoom of the lane layout (spec layout-ux-research §3 rule 6, §5.7, §5.8): the whole surface
 * (page column + lane, one scroll) scales uniformly, 50–200%, around the pointer. Pure maths here; the
 * viewer (PdfViewer.tsx) applies it as a CSS transform on `.pv-sizer` and publishes it on `overviewHub`.
 *
 * Geometry: the sizer scales by z around (W/2, 0) and is shifted by panX (only when z > 1). A content
 * point (cx, cy) in layout px shows at view x = W/2 + panX + (cx − W/2)·z, view y = cy·z − scrollTop.
 */

export const OVERVIEW_MIN = 0.5;
export const OVERVIEW_MAX = 2;
/** What "fit" means until the desk can name the current answer's extent: the half-size overview. */
export const OVERVIEW_FIT = 0.5;
/** Keyboard / button steps (⌘− ⌘+). */
export const OVERVIEW_STEPS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;
/** The gesture is over this long after its last event: re-raster then (§5.8). */
export const SETTLE_MS = 150;

export const clampOverview = (z: number): number =>
  Number.isFinite(z) ? Math.max(OVERVIEW_MIN, Math.min(OVERVIEW_MAX, z)) : 1;

/** Snaps a zoom within 1% of 100% to exactly 1 (a pinch rarely lands there by itself). */
export const snapOverview = (z: number): number => (Math.abs(z - 1) < 0.01 ? 1 : clampOverview(z));

/** The next step strictly above (dir 1) or below (dir −1) `z`, clamped at the ends. */
export function overviewStep(z: number, dir: 1 | -1): number {
  if (dir > 0) return OVERVIEW_STEPS.find((s) => s > z + 1e-3) ?? OVERVIEW_MAX;
  for (let i = OVERVIEW_STEPS.length - 1; i >= 0; i--) if (OVERVIEW_STEPS[i] < z - 1e-3) return OVERVIEW_STEPS[i];
  return OVERVIEW_MIN;
}

/**
 * The zoom a step or toggle starts from: the glide's target while one runs (⌘+ pressed twice quickly
 * goes two steps; Z mid-glide toward 125% returns to 100%, not to the half-way zoom), else the zoom now.
 */
export const zoomBase = (z: number, gliding: number | null): number => (gliding != null && Number.isFinite(gliding) ? gliding : z);

/** Z / the pill / smart zoom: back to 100% from any zoom, else to the overview. */
export const overviewToggle = (z: number): number => (z !== 1 ? 1 : OVERVIEW_FIT);

/** How far the scaled sheet may slide sideways: never below 100%, else its overhang on each side. */
export const panLimit = (z: number, W: number): number => (z > 1 ? ((z - 1) * W) / 2 : 0);

export type OverviewView = {
  /** Window (scroller) width and height, px. */
  W: number;
  H: number;
  /** Layout height of the content at 100%. */
  total: number;
  z: number;
  scrollTop: number;
  panX: number;
};

/** The scroll range at zoom z (the sizer's height is set to total·z, so the range shrinks with it). */
export const maxScrollAt = (total: number, z: number, H: number): number => Math.max(0, total * z - H);

/**
 * scrollTop and panX at zoom `z2` that keep the content point under (px, py) (view px, relative to the
 * scroller) where it is. Clamped to the scroll range and the pan limit, so at the ends the point drifts.
 */
export function zoomAbout(v: OverviewView, z2: number, px: number, py: number): { scrollTop: number; panX: number } {
  const cx = (px - v.W / 2 - v.panX) / v.z + v.W / 2;
  const cy = (v.scrollTop + py) / v.z;
  const lim = panLimit(z2, v.W);
  const panX = Math.max(-lim, Math.min(lim, px - v.W / 2 - (cx - v.W / 2) * z2));
  const scrollTop = Math.max(0, Math.min(maxScrollAt(v.total, z2, v.H), cy * z2 - py));
  return { scrollTop, panX: panX === 0 ? 0 : panX };
}

export type WheelLike = { ctrlKey: boolean; metaKey: boolean; deltaX: number; deltaY: number; deltaMode: number };

/**
 * What a wheel event means for the overview:
 * - 'pinch': a trackpad pinch (Chromium/Firefox send it as ctrl-wheel with small, often fractional deltas);
 * - 'wheel': ⌘+wheel (Magic Mouse, mouse) or a real ⌃+wheel notch (whole lines or ≥ 50 px per event);
 * - 'smart': trackpad smart zoom (two-finger double tap: ctrl-wheel with zero deltas);
 * - null: an ordinary scroll.
 */
export function wheelKind(e: WheelLike): 'pinch' | 'wheel' | 'smart' | null {
  if (e.ctrlKey) {
    if (!e.deltaY && !e.deltaX) return 'smart';
    if (e.deltaMode !== 0) return 'wheel';
    const dy = Math.abs(e.deltaY);
    return dy < 50 || !Number.isInteger(e.deltaY) ? 'pinch' : 'wheel';
  }
  if (e.metaKey && (e.deltaY || e.deltaX)) return 'wheel';
  return null;
}

/** Line / page deltas in px (Firefox reports a mouse wheel in lines). */
export const deltaPx = (d: number, mode: number, H: number): number => (mode === 1 ? d * 16 : mode === 2 ? d * H : d);

/** The zoom factor one wheel event applies (> 1 zooms in: deltaY < 0, the fingers spreading / wheel up). */
export function wheelFactor(kind: 'pinch' | 'wheel', e: WheelLike, H: number): number {
  const dy = deltaPx(e.deltaY || e.deltaX, e.deltaMode, H);
  // A pinch reports ~1–10 px per event: 1% per px. A notch is ~100 px: ~14% per notch, capped per event.
  const k = kind === 'pinch' ? 0.01 : 0.0015;
  return Math.exp(-Math.max(-200, Math.min(200, dy)) * k);
}

/** A sheet x (layout px) where it shows in the window under the overview zoom (scaled about W/2, slid by panX). */
export const sheetToWindowX = (x: number, W: number, v: OverviewViewState): number => W / 2 + v.panX + (x - W / 2) * v.z;

/** The percentage the pill shows. */
export const overviewPct = (z: number): string => `${Math.round(z * 100)}%`;

// ---------------------------------------------------------------------------------------------
// The hub: the one live viewer publishes its zoom here, so chrome (the pill) can show and reset it
// without being handed the viewer.

export type OverviewControl = { set(z: number | 'fit'): void };

export type OverviewViewState = { z: number; panX: number };

export class OverviewHub {
  private z = 1;
  private v: OverviewViewState = { z: 1, panX: 0 };
  private ctl: OverviewControl | null = null;
  private subs = new Set<() => void>();
  get = (): number => this.z;
  /** Zoom and sideways pan together (one object per change: chrome maps sheet x to the window with it). */
  getView = (): OverviewViewState => this.v;
  subscribe = (f: () => void): (() => void) => { this.subs.add(f); return () => { this.subs.delete(f); }; };
  /** The live viewer's control. */
  attach(ctl: OverviewControl): void { this.ctl = ctl; }
  /** The viewer unmounts (only if it is still the attached one). */
  detach(ctl: OverviewControl): void { if (this.ctl !== ctl) return; this.ctl = null; this.publish(1); this.publishPan(0); }
  publish(z: number): void { if (z === this.z) return; this.z = z; this.v = { z, panX: this.v.panX }; this.subs.forEach((f) => f()); }
  /** The sheet's sideways pan changed (the viewer applies zoom and pan together; z is published separately). */
  publishPan(panX: number): void { if (panX === this.v.panX) return; this.v = { z: this.z, panX }; this.subs.forEach((f) => f()); }
  /** User-initiated (the pill): asks the live viewer for a zoom. */
  set(z: number | 'fit'): void { this.ctl?.set(z); }
}

export const overviewHub = new OverviewHub();
