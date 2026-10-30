// Overview zoom of the lane layout: the maths (src/pdf/overview.ts), the keys (zoomKeys) and the hub.
import { describe, it, expect, vi } from 'vitest';
import {
  clampOverview, maxScrollAt, OVERVIEW_FIT, OVERVIEW_MAX, OVERVIEW_MIN, OverviewHub, overviewPct, overviewStep, overviewToggle,
  panLimit, snapOverview, wheelFactor, wheelKind, zoomAbout, type OverviewView,
} from '../../src/pdf/overview';
import { overviewKey } from '../../src/ui/zoomKeys';
import { ScrollOwner } from '../../src/desk/follow';

const view = (o: Partial<OverviewView> = {}): OverviewView => ({ W: 1440, H: 900, total: 20000, z: 1, scrollTop: 3000, panX: 0, ...o });
/** Where content point (cx, cy) shows on screen for a view. */
const screen = (v: OverviewView, cx: number, cy: number) => ({ x: v.W / 2 + v.panX + (cx - v.W / 2) * v.z, y: cy * v.z - v.scrollTop });

describe('clamp, snap, steps, toggle', () => {
  it('clamps to 50–200%', () => {
    expect(clampOverview(0.1)).toBe(OVERVIEW_MIN);
    expect(clampOverview(9)).toBe(OVERVIEW_MAX);
    expect(clampOverview(0.8)).toBe(0.8);
    expect(clampOverview(NaN)).toBe(1);
  });
  it('snaps near 100% to exactly 1', () => {
    expect(snapOverview(1.006)).toBe(1);
    expect(snapOverview(0.97)).toBe(0.97);
  });
  it('steps to the next stop either way, clamped', () => {
    expect(overviewStep(1, -1)).toBe(0.9);
    expect(overviewStep(1, 1)).toBe(1.1);
    expect(overviewStep(0.8, 1)).toBe(0.9);
    expect(overviewStep(0.8, -1)).toBe(0.75);
    expect(overviewStep(OVERVIEW_MIN, -1)).toBe(OVERVIEW_MIN);
    expect(overviewStep(OVERVIEW_MAX, 1)).toBe(OVERVIEW_MAX);
  });
  it('Z goes to the overview from 100%, back to 100% from anything else', () => {
    expect(overviewToggle(1)).toBe(OVERVIEW_FIT);
    expect(overviewToggle(0.5)).toBe(1);
    expect(overviewToggle(1.5)).toBe(1);
  });
  it('formats the pill', () => expect(overviewPct(0.5)).toBe('50%'));
});

describe('zoomAbout: the point under the pointer stays put', () => {
  it('zooming out keeps the content point under the pointer', () => {
    const v = view();
    const px = 700, py = 400;
    const cx = (px - v.W / 2 - v.panX) / v.z + v.W / 2, cy = (v.scrollTop + py) / v.z;
    const r = zoomAbout(v, 0.5, px, py);
    expect(r.panX).toBe(0); // never a sideways pan at or below 100%
    const s = screen({ ...v, z: 0.5, ...r }, cx, cy);
    expect(s.y).toBeCloseTo(py);
    expect(r.scrollTop).toBeCloseTo(3400 * 0.5 - 400);
  });
  it('zooming in past 100% pans so the pointer\'s x stays too', () => {
    const v = view();
    const px = 300, py = 200;
    const cx = px, cy = v.scrollTop + py;
    const r = zoomAbout(v, 1.5, px, py);
    const s = screen({ ...v, z: 1.5, ...r }, cx, cy);
    expect(s.x).toBeCloseTo(px);
    expect(s.y).toBeCloseTo(py);
    expect(Math.abs(r.panX)).toBeLessThanOrEqual(panLimit(1.5, v.W));
  });
  it('round trip returns to the same scroll position', () => {
    const v = view();
    const a = zoomAbout(v, 0.5, 600, 500);
    const b = zoomAbout({ ...v, z: 0.5, ...a }, 1, 600, 500);
    expect(b.scrollTop).toBeCloseTo(v.scrollTop);
    expect(b.panX).toBe(0);
  });
  it('clamps to the scaled scroll range', () => {
    expect(zoomAbout(view({ scrollTop: 0 }), 0.5, 700, 10).scrollTop).toBe(0);
    const end = view({ scrollTop: 20000 - 900 });
    expect(zoomAbout(end, 0.5, 700, 800).scrollTop).toBeLessThanOrEqual(maxScrollAt(20000, 0.5, 900));
  });
  it('pan limit is the scaled sheet\'s overhang, zero at or below 100%', () => {
    expect(panLimit(1, 1440)).toBe(0);
    expect(panLimit(0.5, 1440)).toBe(0);
    expect(panLimit(2, 1440)).toBe(720);
  });
});

describe('wheelKind: pinch, ⌘/⌃+wheel, smart zoom, plain scroll', () => {
  const w = (o: Partial<Parameters<typeof wheelKind>[0]>) => ({ ctrlKey: false, metaKey: false, deltaX: 0, deltaY: 0, deltaMode: 0, ...o });
  it('a trackpad pinch: ctrl with small or fractional deltas', () => {
    expect(wheelKind(w({ ctrlKey: true, deltaY: 3.2 }))).toBe('pinch');
    expect(wheelKind(w({ ctrlKey: true, deltaY: -7 }))).toBe('pinch');
  });
  it('a real ⌃+wheel notch or ⌘+wheel', () => {
    expect(wheelKind(w({ ctrlKey: true, deltaY: 100 }))).toBe('wheel');
    expect(wheelKind(w({ ctrlKey: true, deltaY: 3, deltaMode: 1 }))).toBe('wheel');
    expect(wheelKind(w({ metaKey: true, deltaY: -4 }))).toBe('wheel');
  });
  it('smart zoom: ctrl with zero deltas', () => expect(wheelKind(w({ ctrlKey: true }))).toBe('smart'));
  it('ordinary scrolls are not zooms', () => {
    expect(wheelKind(w({ deltaY: 40 }))).toBeNull();
    expect(wheelKind(w({ metaKey: true }))).toBeNull();
  });
  it('factors: spreading fingers / wheel up zoom in, bounded per event', () => {
    expect(wheelFactor('pinch', w({ ctrlKey: true, deltaY: -10 }), 900)).toBeGreaterThan(1);
    expect(wheelFactor('pinch', w({ ctrlKey: true, deltaY: 10 }), 900)).toBeLessThan(1);
    const notch = wheelFactor('wheel', w({ metaKey: true, deltaY: 100 }), 900);
    expect(notch).toBeGreaterThan(0.8);
    expect(notch).toBeLessThan(0.9);
    expect(wheelFactor('wheel', w({ ctrlKey: true, deltaY: 3, deltaMode: 1 }), 900)).toBeCloseTo(Math.exp(-48 * 0.0015));
    expect(wheelFactor('pinch', w({ ctrlKey: true, deltaY: 1e6 }), 900)).toBeCloseTo(Math.exp(-2));
  });
});

describe('overviewKey', () => {
  const ev = (key: string, o: Partial<KeyboardEvent> = {}, target: EventTarget | null = document.body) =>
    ({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, defaultPrevented: false, target, ...o }) as KeyboardEvent;
  const lane = { lane: true, mac: true, popover: false };
  it('Z toggles, bare only', () => {
    expect(overviewKey(ev('z'), lane)).toBe('toggle');
    expect(overviewKey(ev('Z'), lane)).toBe('toggle');
    expect(overviewKey(ev('z', { metaKey: true }), lane)).toBeNull(); // ⌘Z is undo
    expect(overviewKey(ev('Z', { shiftKey: true }), lane)).toBeNull();
    expect(overviewKey(ev('z', {}, document.createElement('textarea')), lane)).toBeNull();
    expect(overviewKey(ev('z'), { ...lane, popover: true })).toBeNull();
  });
  it('⌘± step and ⌘0 returns, in lane mode only', () => {
    expect(overviewKey(ev('-', { metaKey: true }), lane)).toBe('out');
    expect(overviewKey(ev('=', { metaKey: true }), lane)).toBe('in');
    expect(overviewKey(ev('0', { metaKey: true }), lane)).toBe('reset');
    expect(overviewKey(ev('-', { ctrlKey: true }), { ...lane, mac: false })).toBe('out');
    expect(overviewKey(ev('-', { metaKey: true }), { ...lane, lane: false })).toBeNull();
    expect(overviewKey(ev('z'), { ...lane, lane: false })).toBeNull();
    expect(overviewKey(ev('-', { metaKey: true, defaultPrevented: true }), lane)).toBeNull();
  });
});

describe('OverviewHub', () => {
  it('publishes changes, routes the pill to the live viewer, resets on detach', () => {
    const hub = new OverviewHub();
    const f = vi.fn();
    hub.subscribe(f);
    const a = { set: vi.fn() }, b = { set: vi.fn() };
    hub.attach(a);
    hub.publish(0.5);
    expect(hub.get()).toBe(0.5);
    expect(f).toHaveBeenCalledTimes(1);
    hub.publish(0.5);
    expect(f).toHaveBeenCalledTimes(1);
    hub.attach(b);
    hub.detach(a); // a stale viewer's cleanup leaves the new one alone
    hub.set(1);
    expect(b.set).toHaveBeenCalledWith(1);
    expect(a.set).not.toHaveBeenCalled();
    expect(hub.get()).toBe(0.5);
    hub.detach(b);
    expect(hub.get()).toBe(1);
  });
});

describe('ScrollOwner.justSettled (Magic Mouse tail momentum)', () => {
  it('true only within 150 ms after a glide landed by itself', () => {
    const o = new ScrollOwner();
    expect(o.justSettled(0)).toBe(false);
    o.glideStart();
    o.glideEnd(true);
    const t = performance.now();
    expect(o.justSettled(t + 100)).toBe(true);
    expect(o.justSettled(t + 200)).toBe(false);
    const p = new ScrollOwner();
    p.glideStart();
    p.glideEnd(); // stopped by the student or aborted
    expect(p.justSettled(performance.now())).toBe(false);
  });
});
