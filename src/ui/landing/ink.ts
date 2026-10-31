// src/ui/landing/ink.ts — the landing's ink: a broad-nib outline revealed by a masked centreline that
// dries lighter, plain strokes drawn along their length, and the Runtime that owns every timer and
// animation the landing starts, so unmounting it (opening a PDF) leaves nothing running.

export const NS = 'http://www.w3.org/2000/svg';
export type Pt = [number, number];

let maskSeq = 0;

/** Every timer and Web Animation the landing starts goes through one Runtime; dispose() stops them all. */
export class Runtime {
  readonly rm: boolean;
  disposed = false;
  private timers = new Set<number>();
  private anims = new Set<Animation>();
  private cleanups: (() => void)[] = [];
  constructor() {
    this.rm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  later(fn: () => void, ms: number): number {
    if (this.disposed) return -1;
    const id = window.setTimeout(() => { this.timers.delete(id); if (!this.disposed) fn(); }, ms);
    this.timers.add(id);
    return id;
  }
  clear(id: number) { window.clearTimeout(id); this.timers.delete(id); }
  animate(e: Element, kf: Keyframe[], opts: KeyframeAnimationOptions): Animation | null {
    if (this.disposed || typeof e.animate !== 'function') return null;
    const a = e.animate(kf, opts);
    this.anims.add(a);
    a.addEventListener('finish', () => this.anims.delete(a));
    return a;
  }
  listen<K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) {
    window.addEventListener(type, fn, opts);
    this.cleanups.push(() => window.removeEventListener(type, fn, opts));
  }
  onDispose(fn: () => void) { this.cleanups.push(fn); }
  /** Live timers (tests). */
  get pending() { return this.timers.size; }
  dispose() {
    this.disposed = true;
    this.timers.forEach((id) => window.clearTimeout(id));
    this.timers.clear();
    this.anims.forEach((a) => a.cancel());
    this.anims.clear();
    this.cleanups.splice(0).forEach((f) => f());
  }
}

export function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, parent?: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  if (parent) parent.appendChild(e);
  return e;
}

export type NibOpts = { w?: number; min?: number; ang?: number; tin?: number; tout?: number; graphite?: boolean };

export function nibOutline(pts: Pt[], { w = 3.4, min = .9, ang = -0.75, tin = .08, tout = .22 }: NibOpts = {}): string {
  const N = pts.length - 1, L: Pt[] = [], R: Pt[] = [];
  for (let i = 0; i <= N; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(N, i + 1)], p = pts[i];
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len, th = Math.atan2(dy, dx);
    let wd = min + (w - min) * Math.abs(Math.sin(th - ang));
    const u = i / N, tp = Math.min(1, u / tin, (1 - u) / tout);
    wd *= Math.pow(Math.max(tp, .06), .5);
    L.push([p[0] + nx * wd / 2, p[1] + ny * wd / 2]); R.push([p[0] - nx * wd / 2, p[1] - ny * wd / 2]);
  }
  const f = (q: Pt) => q[0].toFixed(2) + ' ' + q[1].toFixed(2);
  return 'M' + L.map(f).join('L') + 'L' + R.reverse().map(f).join('L') + 'Z';
}
export const poly = (pts: Pt[]) => 'M' + pts.map((p) => p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join('L');
export const sample = (fn: (t: number) => Pt, n = 90): Pt[] => Array.from({ length: n + 1 }, (_, i) => fn(i / n));
export function ringPts(cx: number, cy: number, rx: number, ry: number, a0 = -2.5, turn = 1.13, drift = .09): Pt[] {
  return sample((t) => {
    const a = a0 + t * turn * Math.PI * 2, r = 1 + drift * t - .03 * Math.sin(t * 7);
    return [cx + rx * r * Math.cos(a) + t * 2.4, cy + ry * r * Math.sin(a) - t * 1.5];
  }, 120);
}
const length = (p: SVGGeometryElement) => (typeof p.getTotalLength === 'function' ? p.getTotalLength() : 0);

export function nibDraw(rt: Runtime, svg: SVGSVGElement, parent: Element, pts: Pt[], opt: NibOpts = {}, instant = false, dur = 700): SVGGElement {
  const defs = svg.querySelector('defs') || el('defs', {}, svg);
  const id = 'pl-nm' + (++maskSeq), w = opt.w || 3.4;
  const g = el('g', {}, parent);
  const path = el('path', { d: nibOutline(pts, opt), class: 'pl-nib' + (opt.graphite ? ' pl-graphite' : '') }, g);
  const end = pts[pts.length - 1];
  const pool = opt.graphite ? null : el('circle', { cx: end[0], cy: end[1], r: (w * .42).toFixed(2), class: 'pl-pool' }, g);
  const dry = () => { path.classList.add('pl-dry'); pool?.classList.add('pl-dry'); };
  if (instant || rt.rm) { dry(); return g; }
  const mask = el('mask', { id, maskUnits: 'userSpaceOnUse', x: -2000, y: -2000, width: 6000, height: 6000 }, defs);
  const mp = el('path', { d: poly(pts), fill: 'none', stroke: '#fff', 'stroke-width': w * 2.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, mask);
  const Ln = length(mp) + 4;
  mp.style.strokeDasharray = String(Ln); mp.style.strokeDashoffset = String(Ln);
  g.setAttribute('mask', `url(#${id})`);
  const a = rt.animate(mp, [{ strokeDashoffset: Ln }, { strokeDashoffset: 0 }], { duration: dur, easing: 'cubic-bezier(.45,.05,.3,1)', fill: 'forwards' });
  if (a) a.onfinish = () => rt.later(dry, 120);
  else { mp.style.strokeDashoffset = '0'; dry(); }
  return g;
}

export function strokeDraw(rt: Runtime, p: SVGGeometryElement, instant: boolean, dur = 600, delay = 0) {
  p.style.opacity = '1';
  if (instant || rt.rm) return;
  const L = length(p);
  rt.animate(p, [{ strokeDasharray: `${L} ${L}`, strokeDashoffset: L }, { strokeDasharray: `${L} ${L}`, strokeDashoffset: 0 }], { duration: dur, delay, easing: 'cubic-bezier(.5,0,.25,1)', fill: 'backwards' });
}
