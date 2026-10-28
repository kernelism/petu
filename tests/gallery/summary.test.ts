import { describe, expect, it } from 'vitest';
import { galleryStep, parseSkipRate, stressStep, summarize } from '../../scripts/gallery/summary';
import type { ShotRow } from '../../scripts/gallery/diff';

const rows: ShotRow[] = [
  { name: 'side@6s.chromium.1440x900', status: 'changed', pixels: 900, ratio: 0.0007 },
  { name: 'kit@end.webkit.1440x900', status: 'same', pixels: 0, ratio: 0 },
  { name: 'demo1@end.webkit.1440x900', status: 'new' },
];
const o = { ms: 1000, baseline: 'b1', sheet: '/x/index.html' };

describe('galleryStep', () => {
  it('fails on an undeclared change and names it', () => {
    const s = galleryStep(rows, [], o);
    expect(s.ok).toBe(false);
    expect(s.detail).toContain('changed side@6s.chromium.1440x900 (900 px, 0.070%)');
    expect(s.detail).toContain('1/3 shots unchanged vs b1');
    expect(s.detail).toContain('1 new shot(s)');
  });
  it('passes when --expect covers it, and reports unused patterns', () => {
    const s = galleryStep(rows, ['side', 'plane'], o);
    expect(s.ok).toBe(true);
    expect(s.detail).toContain('1 intended change(s)');
    expect(s.detail).toContain('--expect matched no change: plane');
  });
  it('fails without a baseline', () => {
    expect(galleryStep(rows, [], { ...o, baseline: null }).ok).toBe(false);
  });
  it('render errors (not console noise) are listed', () => {
    const s = galleryStep([], [], { ...o, errors: ['kit.webkit.1440x900: timed out', 'x: console: HTTP 404 /a'] });
    expect(s.detail).toContain('error: kit.webkit.1440x900: timed out');
    expect(s.detail).not.toContain('HTTP 404');
  });
});

describe('replay-stress', () => {
  it('parses percent, fraction and JSON forms', () => {
    expect(parseSkipRate('done\nskip rate: 3.5%\n')).toBeCloseTo(0.035);
    expect(parseSkipRate('{"skipRate": 0.02, "n": 40}')).toBeCloseTo(0.02);
    expect(parseSkipRate('skipRate=0')).toBe(0);
    expect(parseSkipRate('skip rate 1.0% then skip rate 2.0%')).toBeCloseTo(0.02);
    expect(parseSkipRate('nothing here')).toBeNull();
  });
  it('fails only when the rate rises', () => {
    expect(stressStep(0.03, null, 1).ok).toBe(true);
    expect(stressStep(0.03, 0.03, 1).ok).toBe(true);
    expect(stressStep(0.02, 0.03, 1).ok).toBe(true);
    expect(stressStep(0.031, 0.03, 1).ok).toBe(false);
    expect(stressStep(null, 0.03, 1).ok).toBe(false);
  });
});

describe('summarize', () => {
  it('PASS/FAIL/SKIP lines and a verdict', () => {
    const { ok, text } = summarize([
      { name: 'typecheck', ok: true, ms: 2000 },
      { name: 'tests', ok: false, ms: 3000, detail: '1 failed' },
      { name: 'replay-stress', ok: true, skipped: true, ms: 0, detail: 'no script' },
    ]);
    expect(ok).toBe(false);
    expect(text).toMatch(/PASS {2}typecheck/);
    expect(text).toMatch(/FAIL {2}tests/);
    expect(text).toContain('1 failed');
    expect(text).toMatch(/SKIP {2}replay-stress/);
    expect(text).toContain('GATE FAILED');
    expect(summarize([{ name: 'a', ok: true, ms: 1 }]).text).toContain('GATE PASSED');
  });
});
