import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { penDown, penTo, penLift, resetPen, IDLE_MS } from '../../src/ink/agent/penCursor';

const SVG = 'http://www.w3.org/2000/svg';

/** An SVG group whose user space maps to the screen by scale `k` and offset (e, f). */
function group(k = 1, e = 0, f = 0): SVGGElement {
  const g = document.createElementNS(SVG, 'g') as SVGGElement;
  (g as unknown as { getScreenCTM: () => DOMMatrix }).getScreenCTM = () => ({ a: k, b: 0, c: 0, d: k, e, f }) as DOMMatrix;
  return g;
}
const cursor = () => document.querySelector<HTMLDivElement>('.pen-cursor');
const reduced = (on: boolean) => {
  window.matchMedia = ((q: string) => ({ matches: on && q.includes('reduce') })) as unknown as typeof window.matchMedia;
};

describe('pen cursor', () => {
  beforeEach(() => { vi.useFakeTimers(); reduced(false); resetPen(); });
  afterEach(() => { resetPen(); vi.useRealTimers(); });

  it('shows at the tip in screen px, nib point at the bottom-left of the glyph', () => {
    const t = {};
    penDown(t);
    penTo(t, group(2, 100, 50), { x: 10, y: 20 });
    const el = cursor()!;
    expect(el).toBeTruthy();
    expect(el.style.opacity).toBe('1');
    expect(el.style.pointerEvents).toBe('none');
    expect(el.style.transform).toBe('translate(120.0px, 74.0px)'); // (120, 90) minus the 16px glyph height
  });

  it('fades after the idle delay once the last stroke lifts', () => {
    const t = {};
    penDown(t);
    penTo(t, group(), { x: 1, y: 1 });
    penLift(t);
    vi.advanceTimersByTime(IDLE_MS - 1);
    expect(cursor()!.style.opacity).toBe('1');
    vi.advanceTimersByTime(1);
    expect(cursor()!.style.opacity).toBe('0');
  });

  it('a new stroke within the idle delay keeps it visible', () => {
    const a = {}, b = {};
    penDown(a); penTo(a, group(), { x: 1, y: 1 }); penLift(a);
    vi.advanceTimersByTime(IDLE_MS / 2);
    penDown(b); penTo(b, group(), { x: 5, y: 5 });
    vi.advanceTimersByTime(IDLE_MS * 2);
    expect(cursor()!.style.opacity).toBe('1');
  });

  it('the most recently started stroke wins; it hands back when that one lifts', () => {
    const a = {}, b = {}, g = group();
    penDown(a); penDown(b);
    penTo(b, g, { x: 50, y: 50 });
    penTo(a, g, { x: 10, y: 10 }); // ignored: b started later
    expect(cursor()!.style.transform).toBe('translate(50.0px, 34.0px)');
    penLift(b);
    penTo(a, g, { x: 10, y: 10 });
    expect(cursor()!.style.transform).toBe('translate(10.0px, -6.0px)');
    vi.advanceTimersByTime(IDLE_MS * 2);
    expect(cursor()!.style.opacity).toBe('1'); // a is still drawing
    penLift(a);
    vi.advanceTimersByTime(IDLE_MS);
    expect(cursor()!.style.opacity).toBe('0');
  });

  it('reduced motion: never shown', () => {
    reduced(true);
    const t = {};
    penDown(t); penTo(t, group(), { x: 1, y: 1 }); penLift(t);
    expect(cursor()).toBeNull();
  });

  it('no getScreenCTM (jsdom): no cursor', () => {
    const t = {};
    penDown(t);
    penTo(t, document.createElementNS(SVG, 'g') as SVGGElement, { x: 1, y: 1 });
    expect(cursor()).toBeNull();
  });
});
