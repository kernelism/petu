import { describe, it, expect } from 'vitest';
import { renderReport, esc } from '../../scripts/eval/report';
import { buildSummary } from '../../scripts/eval/summary';
import { computeMetrics } from '../../scripts/eval/metrics';
import { emptyResult } from '../../src/agent/evalHooks';
import { QUESTIONS } from '../../scripts/eval/questions';

describe('report.html', () => {
  const q = QUESTIONS[0];
  const metrics = computeMetrics(emptyResult(q.question, 0));
  const qs = { id: q.id, split: q.split, type: q.type, metrics, judge: { scores: { intuitive: 4, sync: 4, correct: 5, simple: 3 }, fatal: ['wrong_fact' as const], notes: 'Fix <b>this</b>' } };
  const sum = buildSummary({ runId: 'r', config: 'terra-none', qset: 'q1-x', promptVersion: 'p1', phase: 'dev', questions: [qs], now: () => new Date(0) });
  const html = renderReport(sum, [{ q, summary: qs, asked: q.question, transcript: 'Look [circle p=3 ✓] and [line ✗ unknown point Q] <x>', stills: ['D1/s0.png', 'D1/s1.png'], webkit: ['D1/wk.png'], sheet: 'D1/sheet.jpg' }]);
  it('is a plain page: relative images, no scripts, no foreignObject', () => {
    expect(html).toContain('src="D1/sheet.jpg"');
    expect(html).not.toMatch(/foreignObject/i);
    expect(html).not.toMatch(/<script/i);
    expect(html.startsWith('<!doctype html>')).toBe(true);
  });
  it('escapes transcript and judge notes', () => {
    expect(html).toContain('&lt;x&gt;');
    expect(html).toContain('Fix &lt;b&gt;this&lt;/b&gt;');
    expect(html).not.toContain('<b>this</b>');
    expect(esc('a&"b')).toBe('a&amp;&quot;b');
  });
  it('shows failed tags, fatal flags, metrics and the header numbers', () => {
    expect(html).toContain('<span class="bad">[line ✗ unknown point Q]</span>');
    expect(html).toContain('fatal: wrong_fact');
    expect(html).toContain('judge mean');
    expect(html).toContain('D1/wk.png');
  });
  it('without a sheet it falls back to the stills', () => {
    const h = renderReport(sum, [{ q, summary: { ...qs, judge: undefined }, asked: 'q', transcript: '', stills: ['D1/s0.png'] }]);
    expect(h).toContain('D1/s0.png'); expect(h).toContain('not judged');
  });
});
