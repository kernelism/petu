// tests/settings/settings.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

const KEY = 'pdf-tutor.settings';
const fresh = async () => { vi.resetModules(); return import('../../src/settings/settings'); };

describe('settings', () => {
  beforeEach(() => localStorage.clear());
  it('the ink is the violet preset and the drawing style is hand; neither is stored', async () => {
    let s = await fresh();
    expect(s.getSettings()).toMatchObject({ inkColor: '#8E4EC6', inkStyle: 'hand' });
    s.setSettings({ inkStyle: 'live' }); // the dev ?style= aid: this page load only
    expect(s.getSettings().inkStyle).toBe('live');
    const stored = JSON.parse(localStorage.getItem(KEY)!);
    expect(stored).toEqual({ highlight: 'violet', speed: 1, voice: 'off', quality: 'standard', predict: false, v: 3 });
    s = await fresh();
    expect(s.getSettings().inkStyle).toBe('hand');
  });
  it('v2 saves migrate: drawing style, ink colour, shortcuts dropped; wpm × speed lands on the nearest step', async () => {
    localStorage.setItem(KEY, JSON.stringify({ inkStyle: 'hand', inkColor: '#0A84FF', wpm: 200, shortcuts: false, speed: 1, voice: 'marin', highlight: 'yellow', v: 2 }));
    let s = await fresh();
    expect(s.getSettings()).toEqual({ ...s.DEFAULTS, speed: 1.25, voice: 'marin', highlight: 'yellow' });
    for (const [wpm, speed, want] of [[170, 1, 1], [130, 1, 0.75], [220, 1, 1.25], [170, 1.25, 1.25], [190, 1.25, 1.5], [150, 0.75, 0.75], [185, 1, 1]] as const) {
      localStorage.setItem(KEY, JSON.stringify({ wpm, speed, v: 2 }));
      s = await fresh();
      expect(s.getSettings().speed, `${wpm} wpm × ${speed}`).toBe(want);
    }
    // A v1 save (no v) of the old orange ink: nothing of it survives but the default.
    localStorage.setItem(KEY, JSON.stringify({ inkColor: '#F2600C', wpm: 'fast' }));
    s = await fresh();
    expect(s.getSettings()).toEqual(s.DEFAULTS);
  });
  it('answer quality: standard by default, best remembered, an unknown or model-name value falls back', async () => {
    let s = await fresh();
    expect(s.getSettings().quality).toBe('standard');
    s.setSettings({ quality: 'best' });
    s = await fresh();
    expect(s.getSettings().quality).toBe('best');
    localStorage.setItem(KEY, JSON.stringify({ quality: 'claude-opus-5-5', v: 3 }));
    s = await fresh();
    expect(s.getSettings().quality).toBe('standard');
  });
  it('the narration base rate is a calmer 155 wpm (was 170); nearestSpeed snaps to a step', async () => {
    const s = await fresh();
    expect(s.BASE_WPM).toBe(155);
    expect([0.5, 0.88, 1.1, 1.13, 1.4, 3].map(s.nearestSpeed)).toEqual([0.75, 1, 1, 1.25, 1.5, 1.5]);
  });
  it('the page highlight defaults to the violet wash (the accent, light) and yellow keeps the marker look', async () => {
    const s = await fresh();
    expect(s.getSettings().highlight).toBe('violet');
    expect(s.HIGHLIGHTS.violet.color).toBe('#8E4EC6');
    // multiply over white: 255 − a·(255 − c) ≈ rgb(236,226,246), the mockup's wash
    const on = (c: number) => Math.round(255 - s.HIGHLIGHTS.violet.opacity * (255 - c));
    [[0x8e, 236], [0x4e, 226], [0xc6, 246]].forEach(([c, want]) => expect(Math.abs(on(c) - want)).toBeLessThanOrEqual(2));
    expect(s.HIGHLIGHTS.yellow).toMatchObject({ color: '#FFD60A', opacity: 0.5 });
  });
  it('a stored legacy highlightColor (the old yellow default or a retired swatch) becomes the violet wash; a choice is kept', async () => {
    localStorage.setItem(KEY, JSON.stringify({ highlightColor: '#FFD60A', wpm: 170, v: 2 }));
    let s = await fresh();
    expect(s.getSettings()).toMatchObject({ highlight: 'violet', speed: 1 });
    expect(s.getSettings()).not.toHaveProperty('highlightColor');
    localStorage.setItem(KEY, JSON.stringify({ highlightColor: '#7EE787' }));
    s = await fresh();
    expect(s.getSettings().highlight).toBe('violet');
    s.setSettings({ highlight: 'yellow' });
    s = await fresh();
    expect(s.getSettings().highlight).toBe('yellow');
    localStorage.setItem(KEY, JSON.stringify({ highlight: 'neon' }));
    s = await fresh();
    expect(s.getSettings().highlight).toBe('violet');
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
