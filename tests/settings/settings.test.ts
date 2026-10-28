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
});
