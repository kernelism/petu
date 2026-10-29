import { describe, expect, it } from 'vitest';
import { BROWSERS, pickBrowsers } from '../../scripts/gallery/scenes';

describe('pickBrowsers', () => {
  it('defaults to every browser when all are installed', () => {
    expect(pickBrowsers(undefined, () => true)).toEqual({ browsers: [...BROWSERS], skipped: [] });
    expect(BROWSERS).toContain('firefox');
  });
  it('leaves out firefox with a note when it is not installed; chromium and webkit stay', () => {
    const r = pickBrowsers([], (b) => b !== 'firefox');
    expect(r.browsers).toEqual(['chromium', 'webkit']);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]).toMatch(/^firefox \(not installed/);
    // chromium/webkit are never optional: their absence fails at launch, not silently.
    expect(pickBrowsers(undefined, () => false).browsers).toEqual(['chromium', 'webkit']);
  });
  it('keeps asked-for browsers as asked, installed or not', () => {
    expect(pickBrowsers(['chromium', 'firefox'], () => false)).toEqual({ browsers: ['chromium', 'firefox'], skipped: [] });
  });
  it('rejects an unknown browser name', () => {
    expect(() => pickBrowsers(['gecko'], () => true)).toThrow(/unknown browser gecko/);
  });
});
