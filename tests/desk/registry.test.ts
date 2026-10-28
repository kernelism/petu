// tests/desk/registry.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Registry, strokeBoxes, boxOf, union } from '../../src/desk/registry';

const g = () => document.createElementNS('http://www.w3.org/2000/svg', 'g') as SVGGElement;
const el = (id: string | undefined, region = 'side', box = { x: 0, y: 0, w: 10, h: 10 }) =>
  ({ id, kind: 'point', target: { region }, bbox: box, boxes: [box], anchor: { x: box.x, y: box.y }, group: g() });

describe('Registry', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('defines and finds elements by id', () => {
    const r = new Registry();
    expect(r.define(el('c'))).toBe('c');
    expect(r.get('c')?.kind).toBe('point');
  });
  it('refuses a duplicate id (rule 4): warns, and the element is kept unnamed', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = new Registry();
    r.define(el('c'));
    const id = r.define(el('c', 'side', { x: 50, y: 50, w: 5, h: 5 }));
    expect(id).toMatch(/^_\d+$/);
    expect(r.get('c')?.bbox.x).toBe(0);
    expect(warn).toHaveBeenCalledOnce();
  });
  it('wait resolves when the element is defined, or undefined after the timeout', async () => {
    const r = new Registry();
    const p = r.wait('x', 500);
    r.define(el('x'));
    expect((await p)?.id).toBe('x');
    const q = r.wait('nope', 500);
    vi.advanceTimersByTime(500);
    expect(await q).toBeUndefined();
  });
  it('obstacles are per target and skip faded elements', () => {
    const r = new Registry();
    r.define(el('a', 'side'));
    r.define(el('b', 'other'));
    r.define(el('c', 'side'));
    r.update('c', { faded: true });
    expect(r.obstacles({ region: 'side' })).toHaveLength(1);
    expect(r.obstacles({ region: 'side' }, 'a')).toHaveLength(0);
    expect(r.obstacles({ page: 3 })).toHaveLength(0);
  });
  it('latest finds the most recent element of a kind in a target', () => {
    const r = new Registry();
    r.define({ ...el('ax1'), kind: 'axes' });
    r.define({ ...el('ax2'), kind: 'axes' });
    expect(r.latest({ region: 'side' }, 'axes')?.id).toBe('ax2');
  });
});

describe('boxes', () => {
  it('chunks a diagonal line into several small boxes', () => {
    const line = Array.from({ length: 25 }, (_, i) => ({ x: i * 40, y: i * 25 }));
    const bs = strokeBoxes([line], 8, 0);
    expect(bs.length).toBe(8);
    const area = bs.reduce((s, b) => s + b.w * b.h, 0);
    expect(area).toBeLessThan(960 * 600 * 0.2);
  });
  it('boxOf and union', () => {
    expect(boxOf([{ x: 1, y: 2 }, { x: 5, y: 9 }], 1)).toEqual({ x: 0, y: 1, w: 6, h: 9 });
    expect(union([{ x: 0, y: 0, w: 1, h: 1 }, { x: 5, y: 5, w: 2, h: 2 }])).toEqual({ x: 0, y: 0, w: 7, h: 7 });
  });
});
