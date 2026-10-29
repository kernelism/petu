// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gateCounts, keyFrames, parseBenchArgs, preflight, remainingFromLedger, renderBench, summarize, type BenchCell, type BenchRow } from '../../scripts/eval/benchReport';
import { CONFIGS, expectedAnswerUsd, worstAnswerUsd, configEnv, TYPICAL_OUTPUT } from '../../scripts/eval/configs';
import { QSETS } from '../../scripts/eval/questions';
import { computeMetrics } from '../../scripts/eval/metrics';
import { latestRun } from '../../scripts/eval/bench';
import { PRICES } from '../../server/prices';
import { emptyResult } from '../../src/agent/evalHooks';

describe('bench flags', () => {
  it('parses the configs and options; refuses unknown configs and --runs outside --configs', () => {
    const a = parseBenchArgs(['--qset', 'draw', '--configs', 'terra-none, claude-opus-low', '--judge', '--dry', '--runs', 'terra-none=R1']);
    expect(a).toMatchObject({ qset: 'draw', configs: ['terra-none', 'claude-opus-low'], judge: true, dry: true, replay: false, runs: { 'terra-none': 'R1' } });
    expect(parseBenchArgs(['--configs', 'terra-none']).judge).toBe(false);
    expect(() => parseBenchArgs([])).toThrow(/--configs/);
    expect(() => parseBenchArgs(['--configs', 'nope'])).toThrow(/unknown config/);
    expect(() => parseBenchArgs(['--configs', 'terra-none', '--runs', 'sol-low=R'])).toThrow(/not in --configs/);
  });
});

describe('configs', () => {
  it('every config is priced; the new ones exist with their output budgets; claude configs set PETU_MAX_OUTPUT only when they think', () => {
    for (const c of Object.values(CONFIGS)) expect(PRICES[c.model], c.name).toBeDefined();
    for (const n of ['terra-medium', 'sol-low', 'sol-medium', 'astra-low', 'claude-opus-low', 'claude-sonnet-none', 'claude-sonnet-low', 'claude-haiku-none']) expect(CONFIGS[n], n).toBeDefined();
    expect(configEnv(CONFIGS['claude-opus-low'], 'bench')).toMatchObject({ PETU_MODEL: 'claude-opus-5-5', PETU_EFFORT: 'low', PETU_PHASE: 'bench', PETU_MAX_OUTPUT: '6000' });
    expect(configEnv(CONFIGS['claude-sonnet-none'], 'bench')).not.toHaveProperty('PETU_MAX_OUTPUT');
    expect(CONFIGS['claude-opus-low'].effort).not.toBe('none'); // Opus 5.5 cannot turn thinking off
  });
  it('expected cost < worst case; more effort or a dearer model costs more', () => {
    for (const c of Object.values(CONFIGS)) expect(expectedAnswerUsd(c), c.name).toBeLessThan(worstAnswerUsd(c));
    expect(expectedAnswerUsd(CONFIGS['terra-low'])).toBeGreaterThan(expectedAnswerUsd(CONFIGS['terra-none']));
    expect(expectedAnswerUsd(CONFIGS['claude-opus-low'])).toBeGreaterThan(expectedAnswerUsd(CONFIGS['claude-sonnet-low']));
    expect(TYPICAL_OUTPUT.medium).toBeGreaterThan(TYPICAL_OUTPUT.low);
  });
});

describe('budget preflight', () => {
  const qs = QSETS.draw; // 11 questions, 2 follow-ups = 13 answers
  it('counts answers (follow-ups twice) and judgements; refuses when the worst case is over what is left', () => {
    const cfgs = [CONFIGS['terra-none'], CONFIGS['claude-opus-low']];
    const p = preflight(cfgs, qs, true, 100, () => true);
    expect(p.rows.map((r) => [r.config, r.answers, r.judged])).toEqual([['terra-none', 13, 11], ['claude-opus-low', 13, 11]]);
    expect(p.ok).toBe(true);
    expect(p.worstUsd).toBeGreaterThan(p.expectedUsd);
    expect(p.table).toMatch(/claude-opus-low/);
    expect(preflight(cfgs, qs, true, p.worstUsd - 0.01, () => true).ok).toBe(false);
  });
  it('a reused run costs nothing', () => {
    const p = preflight([CONFIGS['terra-none']], qs, true, 0, () => false);
    expect(p.rows[0]).toMatchObject({ answers: 0, judged: 0, expectedUsd: 0, worstUsd: 0 });
    expect(p.ok).toBe(true);
  });
  it('reads what is left from the ledger file: phase spend + open reservations, under the hard stop', () => {
    const f = { priorUsd: 1, entries: [{ phase: 'bench', usd: 2 }, { phase: 'dev', usd: 50 }], open: { a: { phase: 'bench', worstUsd: 0.5 } } };
    expect(remainingFromLedger(f, 'bench', { totalUsd: 60, phaseUsd: 15 })).toEqual({ remainingUsd: 60 - 53.5, phaseSpentUsd: 2.5, totalSpentUsd: 53.5 });
    expect(remainingFromLedger({}, 'bench', { totalUsd: 60, phaseUsd: 15 }).remainingUsd).toBe(15);
  });
});

describe('cells and summary', () => {
  it('gate counts group the checks and skip the opener', () => {
    const beat = (opener: boolean, checks: string[]) => ({ opener, verdict: { flags: checks.map((check) => ({ check })) } });
    expect(gateCounts([beat(true, ['number']), beat(false, ['number', 'threshold', 'layout']), beat(false, []), beat(false, ['unbound', 'deixis', 'tag', 'geometry'])]))
      .toEqual({ beats: 3, failing: 2, numbers: 2, unbound: 1, collisions: 1, deixis: 1, skips: 1, other: 1 });
  });
  it('key frames: first, middle, last', () => {
    expect(keyFrames([1, 2, 3, 4, 5, 6])).toEqual([1, 4, 6]);
    expect(keyFrames([7, 8])).toEqual([7, 8]);
  });
  const result = (first: number, spokenTo: number, usd: number) => {
    const r = emptyResult('q', 0);
    r.chunks = [{ t: first - 100, d: 'Hello there.' }];
    r.words = [{ text: 'Hello', t: first }, { text: 'there.', t: first + 300 }];
    r.sentences = [{ text: 'Hello there.', endMs: spokenTo }];
    r.events = [{ t: 'scout', pages: [1], plan: '', ms: 10, usd: 0.001 }, { t: 'done', usd, spentUsd: 0, capUsd: 60, ttftMs: 100 }];
    return r;
  };
  const cell = (config: string, first: number, spokenTo: number, usd: number, extra: Partial<BenchCell> = {}): BenchCell => ({
    config, runId: 'R', asked: 'q', frames: [], transcript: 'Hello <there>', metrics: computeMetrics(result(first, spokenTo, usd)),
    gate: { beats: 2, failing: 1, numbers: 1, unbound: 0, collisions: 0, deixis: 0, skips: 0, other: 0 }, ...extra,
  });
  it('summary per config: latency separate from spoken length, cost per answer, judge means, gate totals', () => {
    const s = summarize('claude-sonnet-none', [
      cell('claude-sonnet-none', 1000, 31000, 0.01, { judge: { rubric: 'r3', scores: { understanding: 4, illustration: 3, deck: 4, craft: 3, economy: 4 }, fatal: [], defects: [], notes: '' }, judgeUsd: 0.05 }),
      cell('claude-sonnet-none', 3000, 63000, 0.03),
      { config: 'claude-sonnet-none', runId: 'R', asked: 'q', frames: [], transcript: '', metrics: null, missing: 'no answer' },
    ]);
    expect(s).toMatchObject({ model: 'claude-sonnet-5-5', answers: 2, missing: 1, judged: 1, judgeMean: 3.6, fatal: 0, firstWordP50: 1000, firstWordP90: 3000, judgeUsd: 0.05 });
    expect(s.spokenMeanS).toBeCloseTo(45, 6);
    expect(s.genUsd).toBeCloseTo(0.042, 10);
    expect(s.usdPerAnswer).toBeCloseTo(0.021, 10);
    expect(s.gate).toEqual({ beats: 4, failing: 2, numbers: 2, unbound: 0, collisions: 0, deixis: 0, skips: 0, other: 0 });
  });
  it('renders one column per config and one row per question turn; escapes text; marks fakes and missing cells', () => {
    const rows: BenchRow[] = [
      { id: 'D1', turn: 0, deck: 'bio', page: 4, question: 'Why <Km>?', cells: { 'terra-none': cell('terra-none', 900, 9000, 0.004, { board: '../../runs/R/D1/board.jpg' }), 'claude-opus-low': cell('claude-opus-low', 2000, 20000, 0.05, { fake: true }) } },
      { id: 'D1', turn: 1, deck: 'bio', page: 4, question: 'improve the drawing', cells: { 'terra-none': cell('terra-none', 900, 9000, 0.004) } },
    ];
    const sums = ['terra-none', 'claude-opus-low'].map((c) => summarize(c, rows.flatMap((r) => (r.cells[c] ? [r.cells[c]] : []))));
    const html = renderBench({ id: 'B', qset: 'draw', createdAt: 'now', dry: true, judge: false, phase: 'bench', promptVersion: 'p5.4' }, ['terra-none', 'claude-opus-low'], rows, sums);
    expect(html).toContain('grid-template-columns:repeat(2, minmax(300px, 1fr))');
    expect(html).toContain('Why &lt;Km&gt;?');
    expect(html).toContain('Hello &lt;there&gt;');
    expect(html).not.toContain('<there>');
    expect(html).toContain('src="../../runs/R/D1/board.jpg"');
    expect(html).toContain('D1 · follow-up');
    expect(html).toContain('Dry run ($0)');
    expect(html).toContain('fake answer (dry run)');
    expect(html).toContain('no answer');
    expect(html).toMatch(/first word <b>0\.9 s<\/b>/);
    expect(html).toMatch(/spoken <b>8\.1 s<\/b>/);
    expect(html).not.toMatch(/<script/i);
  });
});

describe('latestRun', () => {
  it('the most complete run of exactly this config and set (not a replay, ask, or a longer config name), newest among equals', () => {
    const root = mkdtempSync(join(tmpdir(), 'bench-runs-'));
    const mk = (run: string, qs: string[], t: number) => { for (const q of qs) { mkdirSync(join(root, run, q), { recursive: true }); writeFileSync(join(root, run, q, 'result.json'), '{}'); } utimesSync(join(root, run), t, t); };
    mk('2026-10-29-terra-none-p5.4-draw-5b74be89', ['D1', 'D2'], 1000);
    mk('2026-10-30-terra-none-p5.4-draw-5b74be89-2', ['D1'], 3000);
    mk('2026-10-30-terra-none-p5.5-draw-5b74be89-3', ['D1', 'D2'], 2000);
    mk('2026-10-30-terra-none-fast-p5.4-draw-5b74be89', ['D1', 'D2', 'D3'], 4000);
    mk('2026-10-30-terra-none-replay-p5.4-draw-5b74be89', ['D1', 'D2', 'D3'], 4000);
    mk('2026-10-30-terra-none-p5.4-fu-69a34e51', ['D1', 'D2', 'D3'], 4000);
    expect(latestRun('terra-none', 'draw-5b74be89', root)).toBe('2026-10-30-terra-none-p5.5-draw-5b74be89-3');
    expect(latestRun('sol-low', 'draw-5b74be89', root)).toBeNull();
  });
});
