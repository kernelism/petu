import { describe, it, expect } from 'vitest';
import { computeMetrics, aggregate, percentile, segHitsRect, floatingPoints, labelStats } from '../../scripts/eval/metrics';
import { emptyResult, type EvalResult, type RegistryRow, type SerialTiming } from '../../src/agent/evalHooks';

const tm = (kind: string, fired: number, started: number | null, ended: number | null, extra: Partial<SerialTiming> = {}): SerialTiming =>
  ({ action: { kind }, firedAt: fired, queuedAt: fired - 10, startedAt: started, endedAt: ended, ...extra });
const row = (id: string, kind: string, bbox: [number, number, number, number], strokes: [number, number][][] = [], region = 'r'): RegistryRow => ({
  id, kind, target: { region }, bbox: { x: bbox[0], y: bbox[1], w: bbox[2], h: bbox[3] }, boxes: [], strokes: strokes.map((s) => s.map(([x, y]) => ({ x, y }))),
});

function base(): EvalResult {
  const r = emptyResult('Q', 0);
  r.chunks = [{ t: 420, d: 'Take x {{circle p=3 "x"}} here. ' }, { t: 900, d: 'Then {{line on=r}} {{arrow on=r}} {{bad' }];
  r.events = [
    { t: 'text', d: 'a' }, { t: 'note', message: 'dropped extra message' },
    { t: 'done', usd: 0.01, spentUsd: 1, capUsd: 40, ttftMs: 400, plan: 'abc', lint: ['x', 'y'], estimated: true, usage: { input_tokens: 1000, output_tokens: 50, input_tokens_details: { cached_tokens: 600 } } },
  ];
  r.words = [{ text: 'Take', t: 1200 }, { text: 'this', t: 1300 }, { text: 'point.', t: 1400 }, { text: 'Then', t: 2500 }, { text: '**bold**', t: 2600 }];
  r.sentences = [{ text: 'Take this point.', endMs: 1900 }, { text: 'Then bold', endMs: 3000 }];
  r.timings = [
    tm('scroll', 1100, 1100, 1500),
    tm('circle', 1200, 1250, 1700),
    tm('line', 2400, 2450, 3100),
    tm('arrow', 2500, null, null, { skipped: 'unknown point Q' }),
  ];
  r.outOfFrame = 1;
  return r;
}

describe('computeMetrics', () => {
  const m = computeMetrics(base());
  it('timing metrics', () => {
    expect(m.ttftMs).toBe(420);
    expect(m.firstWordMs).toBe(1200);
    expect(m.firstMarkMs).toBe(1250); // scroll is not a mark
    expect(m.totalMs).toBe(3100);
  });
  it('cost metrics', () => {
    expect(m.usd).toBe(0.01); expect(m.cachedShare).toBeCloseTo(0.6); expect(m.estimated).toBe(true);
  });
  it('tags and skips', () => {
    expect(m.tags).toBe(4);
    expect(m.malformed).toBe(0); // 4 tags, 4 timings
    expect(m.linted).toBe(2);
    expect(m.skipped).toEqual({ 'unknown point Q': 1 });
    expect(m.skippedTotal).toBe(1);
    expect(m.skippedDeps).toBe(0);
    expect(m.skipDefect).toBe(false);
  });
  it('a skipped block that later tags name is a skip defect; so are more than two skips', () => {
    const r = base();
    r.timings = [
      tm('grid', 1000, null, null, { action: { kind: 'grid', id: 'img' }, skipped: 'bad fn' }),
      tm('grid', 1100, 1100, 1200, { action: { kind: 'grid', id: 'o', src: { over: 'img', slide: 'k' } }, skipped: 'unknown block img' }),
      tm('sweep', 1200, 1200, 1300, { action: { kind: 'sweep', ref: 'o' }, skipped: 'o is not a window\'s output' }),
    ];
    const d = computeMetrics(r);
    expect(d.skippedDeps).toBe(2); // img is o's source; o is the sweep's target
    expect(d.skipDefect).toBe(true);
  });
  it('elements and max per sentence', () => {
    expect(m.elements).toBe(2);
    expect(m.maxNewPerSentence).toBe(1);
  });
  it('narration stats', () => {
    expect(m.words).toBe(5); expect(m.longestSentence).toBe(3);
    expect(m.wordsBeforeFirstMark).toBe(0); // circle fires on the first word
    expect(m.leaks).toBe(2);
    expect(m.takeawayFirst).toBe(true);
    expect(m.planChars).toBe(3);
    expect(m.droppedMessages).toBe(1);
    expect(m.outOfFrame).toBe(1);
  });
  it('malformed counts tags that never became actions', () => {
    const r = base(); r.timings = r.timings.slice(0, 2);
    expect(computeMetrics(r).malformed).toBe(2);
  });
  it('a {{let}} (no timed action) is not counted as malformed', () => {
    const r = base(); r.chunks.push({ t: 900, d: ' {{let on=s A=0,0 B=1,1}}' });
    expect(computeMetrics(r).malformed).toBe(0);
  });
  it('takeawayFirst fails on a hedge, a long opener, or no mark in sentence 1', () => {
    const a = base(); a.sentences[0].text = 'So this is the point.';
    expect(computeMetrics(a).takeawayFirst).toBe(false);
    const b = base(); b.sentences[0].text = Array(19).fill('w').join(' ');
    expect(computeMetrics(b).takeawayFirst).toBe(false);
    const c = base(); c.timings[1].firedAt = 2000;
    expect(computeMetrics(c).takeawayFirst).toBe(false);
  });
  it('empty answer does not throw', () => {
    const e = computeMetrics(emptyResult('q', 0));
    expect(e.firstWordMs).toBeNull(); expect(e.elements).toBe(0); expect(e.takeawayFirst).toBe(false);
  });
});

describe('geometry metrics', () => {
  it('segHitsRect', () => {
    const r = { x: 10, y: 10, w: 10, h: 10 };
    expect(segHitsRect({ x: 0, y: 15 }, { x: 30, y: 15 }, r)).toBe(true);
    expect(segHitsRect({ x: 0, y: 0 }, { x: 5, y: 5 }, r)).toBe(false);
    expect(segHitsRect({ x: 12, y: 12 }, { x: 14, y: 14 }, r)).toBe(true);
    expect(segHitsRect({ x: 0, y: 25 }, { x: 30, y: 25 }, r)).toBe(false);
  });
  it('floating points: >= 8 units from every other stroke', () => {
    const line = row('l', 'line', [0, 100, 500, 0], [[[0, 100], [500, 100]]]);
    const near = row('a', 'point', [248, 98, 4, 4]);       // centre (250,100): on the line
    const far = row('b', 'point', [248, 198, 4, 4]);        // 98 away
    const edge = row('c', 'point', [248, 106, 4, 4]);       // centre y 108: exactly 8 away -> floating
    expect(floatingPoints([line, near])).toBe(0);
    expect(floatingPoints([line, near, far])).toBe(1);
    expect(floatingPoints([line, edge])).toBe(1);
    // other points are not anchors
    expect(floatingPoints([row('a', 'point', [0, 0, 4, 4]), row('b', 'point', [1, 1, 4, 4])])).toBe(2);
  });
  it('label hits and clipping', () => {
    const line = row('l', 'line', [0, 100, 500, 0], [[[0, 100], [500, 100]]]);
    const hit = row('t1', 'label', [100, 90, 40, 20]);
    const clear = row('t2', 'label', [100, 150, 40, 20]);
    const clipped = row('t3', 'label', [980, 300, 40, 20]);
    expect(labelStats([line, hit, clear, clipped])).toEqual({ hits: 1, clipped: 1 });
  });
});

describe('run level', () => {
  it('percentile is nearest-rank and skips nulls', () => {
    expect(percentile([4, 1, 3, 2], 0.5)).toBe(2);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9);
    expect(percentile([null, 5], 0.5)).toBe(5);
    expect(percentile([], 0.5)).toBeNull();
  });
  it('aggregate sums and means', () => {
    const a = computeMetrics(base()), b = computeMetrics(base());
    const g = aggregate([a, b]);
    expect(g.n).toBe(2); expect(g.usd).toBeCloseTo(0.02); expect(g.sum.skippedTotal).toBe(2);
    expect(g.firstWordMs.p50).toBe(1200); expect(g.takeawayFirstRate).toBe(1);
    expect(g.skipped).toEqual({ 'unknown point Q': 2 });
  });
});
