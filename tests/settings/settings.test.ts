// tests/settings/settings.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

const KEY = 'pdf-tutor.settings';
const fresh = async () => { vi.resetModules(); return import('../../src/settings/settings'); };

describe('settings', () => {
  beforeEach(() => localStorage.clear());
  it('the default ink is the violet preset', async () => {
    const s = await fresh();
    expect(s.getSettings().inkColor).toBe('#8E4EC6');
    expect(s.INK_COLORS[0]).toBe('#8E4EC6');
  });
  it('a pre-v2 save of the old orange default moves to the new default; other choices stay', async () => {
    localStorage.setItem(KEY, JSON.stringify({ inkColor: '#F2600C', wpm: 200 }));
    let s = await fresh();
    expect(s.getSettings()).toMatchObject({ inkColor: '#8E4EC6', wpm: 200 });
    localStorage.setItem(KEY, JSON.stringify({ inkColor: '#0A84FF' }));
    s = await fresh();
    expect(s.getSettings().inkColor).toBe('#0A84FF');
  });
  it('orange chosen after v2 is kept', async () => {
    let s = await fresh();
    s.setSettings({ inkColor: '#F2600C' });
    s = await fresh();
    expect(s.getSettings().inkColor).toBe('#F2600C');
    expect(s.getSettings()).not.toHaveProperty('v');
  });
  it('playback speed: 1× by default, remembered, an unknown stored value falls back to 1×', async () => {
    let s = await fresh();
    expect(s.getSettings().speed).toBe(1);
    s.setSettings({ speed: 1.5 });
    s = await fresh();
    expect(s.getSettings().speed).toBe(1.5);
    localStorage.setItem(KEY, JSON.stringify({ speed: 7 }));
    s = await fresh();
    expect(s.getSettings().speed).toBe(1);
  });
  it('stepSpeed walks 0.75 · 1 · 1.25 · 1.5 and stops at the ends', async () => {
    const s = await fresh();
    expect(s.stepSpeed(1, 1)).toBe(1.25);
    expect(s.stepSpeed(1.5, 1)).toBe(1.5);
    expect(s.stepSpeed(0.75, -1)).toBe(0.75);
    expect(s.stepSpeed(3, -1)).toBe(0.75);
  });
  it('a storage that throws (private mode) still plays: defaults, and setting a speed does not throw', async () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    const s = await fresh();
    expect(s.getSettings().speed).toBe(1);
    expect(() => s.setSettings({ speed: 1.25 })).not.toThrow();
    expect(s.getSettings().speed).toBe(1.25);
    get.mockRestore(); set.mockRestore();
  });
});
