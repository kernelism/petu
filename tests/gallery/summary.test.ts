import { describe, expect, it } from 'vitest';
import { galleryStep, parseSkipRate, stressCorpusStep, stressStep, summarize } from '../../scripts/gallery/summary';
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
  it('lists what the run left out without failing on it', () => {
    const s = galleryStep([], [], { ...o, skipped: ['firefox (not installed)'] });
    expect(s.ok).toBe(true);
    expect(s.detail).toContain('skipped: firefox (not installed)');
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

describe('replay-stress gate on a stable corpus', () => {
  const base = { skipRate: 0.021, scripts: { a: { label: 'r1/D1', checked: 50, skipped: 1 }, b: { label: 'r1/D2', checked: 50, skipped: 1 }, gone: { checked: 10, skipped: 0 } } };
  it('new recordings never fail it, even when they raise the overall rate', () => {
    const cur = { skipRate: 0.05, scripts: { a: { label: 'r1/D1', checked: 50, skipped: 1 }, b: { label: 'r1/D2', checked: 50, skipped: 1 }, n: { label: 'r9/T1', checked: 20, skipped: 4 } } };
    const s = stressCorpusStep(cur, base, 1);
    expect(s.ok).toBe(true);
    expect(s.detail).toMatch(/skip rate on the 2 baseline scripts 2\.00% \(2\/100\) vs 2\.00% \(2\/100\)/);
    expect(s.detail).toMatch(/new scripts since the baseline: 1 \(20\.00%, 4\/20: not gated\); gone: 1; all 3: 5\.00%/);
  });
  it('fails when the same scripts skip more, naming the scripts that got worse', () => {
    const cur = { skipRate: 0.03, scripts: { a: { label: 'r1/D1', checked: 50, skipped: 2 }, b: { label: 'r1/D2', checked: 50, skipped: 1 } } };
    const s = stressCorpusStep(cur, base, 1);
    expect(s.ok).toBe(false);
    expect(s.detail).toMatch(/rose; 1 script\(s\) worse, 0 better/);
    expect(s.detail).toMatch(/r1\/D1: 1 -> 2 skipped/);
    expect(stressCorpusStep({ skipRate: 0.01, scripts: { a: { checked: 50, skipped: 0 }, b: { checked: 50, skipped: 1 } } }, base, 1).ok).toBe(true);
  });
  it('a first run or an old rate-only baseline passes and says why', () => {
    const cur = { skipRate: 0.03, scripts: { a: { checked: 50, skipped: 3 } } };
    expect(stressCorpusStep(cur, null, 1)).toMatchObject({ ok: true, detail: expect.stringMatching(/first recorded baseline/) });
    expect(stressCorpusStep(cur, { skipRate: 0.021 }, 1)).toMatchObject({ ok: true, detail: expect.stringMatching(/no per-script record/) });
  });
});
