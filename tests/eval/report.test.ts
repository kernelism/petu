import { describe, it, expect } from 'vitest';
import { renderReport, esc } from '../../scripts/eval/report';
import { buildSummary } from '../../scripts/eval/summary';
import { computeMetrics } from '../../scripts/eval/metrics';
import { emptyResult } from '../../src/agent/evalHooks';
import { Q1 as QUESTIONS } from '../../scripts/eval/questions';

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

describe('report.html under r3', () => {
  const q = QUESTIONS[0];
  const metrics = computeMetrics(emptyResult(q.question, 0));
  const qs = { id: q.id, split: q.split, type: 'broad', metrics, judge: { rubric: 'r3' as const, scores: { understanding: 4, illustration: 2, deck: 3, craft: 3, economy: 5 }, defects: ['board_copies_page'], fatal: [], notes: 'Draw it' } };
  const sum = buildSummary({ runId: 'r', config: 'terra-none', qset: 'q2-x', promptVersion: 'p4', phase: 'lessondev', rubric: 'r3', questions: [qs], now: () => new Date(0) });
  const item = { q, summary: qs, asked: q.question, transcript: 'x', stills: ['D1/s0.png'], page: 'D1/page.png',
    timeline: { frames: [{ src: 'D1/s2.png', caption: 'After sentence 3 of 7 (4.2s). Said since the previous frame: "One <b>two</b>."', sentence: 2 }], final: 'D1/final.png', board: 'D1/board.jpg' } };
  const html = renderReport(sum, [item]);
  it('shows the frame timeline with captions, final state and board', () => {
    expect(html).toContain('Timeline the judge saw');
    expect(html).toContain('src="D1/s2.png"'); expect(html).toContain('1 · s3/7 · 4.2s');
    expect(html).toContain('One &lt;b&gt;two&lt;/b&gt;.');
    expect(html).toContain('src="D1/final.png"'); expect(html).toContain('src="D1/board.jpg"');
    expect(html).not.toMatch(/<script/i);
  });
  it('shows every r3 criterion, the run means per criterion, defects and the rubric', () => {
    for (const c of ['understanding', 'illustration', 'deck', 'craft', 'economy']) expect(html).toContain(`<th>${c}</th>`);
    expect(html).toContain('defects: board_copies_page');
    expect(html).toContain('board_copies_page ×1');
    expect(html).toContain('rubric r3');
  });
  it('has a calibration section: how-to before hand scores, the table after; a fake-judge banner', () => {
    expect(html).toContain('Calibration (hand vs judge)'); expect(html).toContain('calibrate.ts dump r');
    const cal = { comparison: { n: 8, within1: 0.85, exact: 0.5, trusted: true, defects: [{ defect: 'padded', judge: 2, hand: 1, both: 1 }], fatal: { judge: 0, hand: 0, both: 0 },
      criteria: [{ criterion: 'understanding', n: 8, judgeMean: 3.5, handMean: 3.1, bias: 0.4, exact: 0.5, within1: 0.9 }] } };
    const h = renderReport({ ...sum, fakeJudge: true }, [item], cal);
    expect(h).toContain('±1 agreement <b>85%</b>'); expect(h).toContain('+0.40'); expect(h).toContain('padded');
    expect(h).toContain('Fake judge');
  });
});
