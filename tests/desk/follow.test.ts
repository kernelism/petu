// tests/desk/follow.test.ts
import { describe, it, expect, vi } from 'vitest';
import { Follow, ScrollOwner, isScrollKey } from '../../src/desk/follow';

describe('Follow (rule 6)', () => {
  it('stops following when the student takes over during an answer, and resumes on request', () => {
    const f = new Follow();
    const cb = vi.fn();
    f.subscribe(cb);
    f.setAnswering(true);
    f.userTookOver();
    expect(f.following()).toBe(false);
    expect(f.paused()).toBe(true);
    f.resume();
    expect(f.following()).toBe(true);
    expect(cb).toHaveBeenCalledTimes(3);
  });
  it('ignores the student between answers, and a new answer follows again', () => {
    const f = new Follow();
    f.userTookOver();
    expect(f.following()).toBe(true);
    f.setAnswering(true); f.userTookOver(); f.setAnswering(false);
    expect(f.paused()).toBe(false);
    f.setAnswering(true);
    expect(f.following()).toBe(true);
  });
});

describe('ScrollOwner', () => {
  it('engine writes and glides are not foreign; anything else is', () => {
    const o = new ScrollOwner();
    const el = { scrollTop: 0 };
    o.write(el, 500);
    expect(o.isForeign(500)).toBe(false);
    o.glideStart();
    expect(o.isForeign(620)).toBe(false);
    o.glideEnd();
    expect(o.isForeign(621)).toBe(false); // within tolerance of the last seen value
    expect(o.isForeign(900)).toBe(true);  // the scrollbar, find-in-page, …
  });
});

describe('isScrollKey', () => {
  it('scroll keys count, typing does not', () => {
    expect(isScrollKey({ key: 'PageDown', target: document.body })).toBe(true);
    const input = document.createElement('input');
    expect(isScrollKey({ key: 'ArrowDown', target: input })).toBe(false);
    expect(isScrollKey({ key: 'a', target: document.body })).toBe(false);
  });
});
