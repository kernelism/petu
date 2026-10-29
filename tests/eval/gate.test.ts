// The live gate in the eval (design 2026-10-29 §8): per-answer and run metrics from recorded gate and
// repair events, compare.ts reject rules, report rows, the runner's flags, and repairs in the preflight.
import { describe, it, expect } from 'vitest';
import { computeMetrics, gateMetrics, aggregate, holdCount } from '../../scripts/eval/metrics';
import { compare, format, gateRules, THRESHOLDS } from '../../scripts/eval/compare';
import { buildSummary, type QuestionSummary } from '../../scripts/eval/summary';
import { gateRows, renderReport } from '../../scripts/eval/report';
import { parseArgs, checkBudget, gateQuery, repairOf, spendsOnRepairs } from '../../scripts/eval/plan';
import { CONFIGS, plannedWorstUsd, plannedRepairUsd, worstRepairUsd, REPAIR_SHARE } from '../../scripts/eval/configs';
import { MAX_REPAIRS } from '../../server/limits';
import { emptyResult, type EvalResult } from '../../src/agent/evalHooks';
import type { GateEvent, RepairEvent } from '../../src/gate/events';

const gate = (k: string, o: Partial<GateEvent> = {}): GateEvent => ({ t: 'gate', k, unit: 'beat', result: 'pass', action: 'release', flags: [], notes: [], ms: 8, bufferedMs: 7000, mode: 'beat', ...o });
const rep = (k: string, phase: RepairEvent['phase'], ms: number, o: Partial<RepairEvent> = {}): RepairEvent => ({ t: 'repair', k, phase, ms, ...o });

function gated(): EvalResult {
  const r = emptyResult('q', 0);
  r.events = [
    { t: 'handoff', ms: 3000, openerEndMs: 2900 },
    gate('o0', { unit: 'opener', mode: 'sentence', ms: 2 }),
    gate('0', { ms: 12 }),
    gate('1', { result: 'fail', action: 'repair', flags: [{ check: 'named', detail: 'point Z' }], ms: 20 }),
    rep('1', 'sent', 100), rep('1', 'ok', 1600, { usd: 0.006, text: 'Fixed.' }),
    gate('1', { repaired: true, ms: 9 }),
    gate('2', { result: 'strip', stripped: ['{{circle p=2 "x"}}'], ms: 6 }),
    gate('3', { result: 'fail', action: 'drop', words: 14, notes: ['cascade: two drops in a row'], ms: 30 }),
    gate('4', { result: 'fail', action: 'drop', text: 'Look {{circle on=s at=Q}} at Q here.', notes: ['shadow drift 3px'], ms: 40 }),
    rep('4', 'sent', 0), rep('4', 'late', 2900),
  ];
  // Words: a seam of 450 ms at the handoff (2850 → 3300) and one hold: 1.5 s after "d" starts (it is said in 0.3 s).
  r.words = [{ text: 'a', t: 1000 }, { text: 'b', t: 2850 - 0 }, { text: 'c', t: 3300 }, { text: 'd', t: 3600 }, { text: 'e', t: 5100 }];
  r.words[1].t = 2850; r.words[0].t = 2500;
  r.timings = [{ action: { kind: 'circle' }, firedAt: 3400, queuedAt: 3400, startedAt: null, endedAt: null, skipped: 'unknown point Q' }];
  return r;
}

describe('gate metrics', () => {
  it('counts units, fails, strips, drops (words), repairs by outcome, holds, seam, live skips, drift, cascade', () => {
    const g = gateMetrics(gated())!;
    expect(g).toMatchObject({ units: 6, fails: 3, strips: 1, drops: 2, droppedWords: 14 + 4, repairs: 2, repairOk: 1, repairLate: 1, repairFail: 0, repairRefused: 0,
      holds: 1, seamMs: 450, liveSkipAfterPass: 1, shadowDrift: 1, cascades: 1 });
    expect(g.repairUsd).toBeCloseTo(0.006);
    expect(g.repairMs).toEqual([1500]);
    expect(g.shadowMs).toEqual([2, 12, 20, 9, 6, 30, 40]);
  });
  // Evidence: draw run 5b74be89 — four of its eight "holds" were one long word ("inhibitor." 1118 ms,
  // "possibility," 1047 ms, "0.00098," 1196 ms) followed at once by the next: speech, not silence.
  it('a hold is silence beyond the word’s own spoken length, not a long word', () => {
    expect(holdCount([{ text: 'inhibitor.', t: 87400 }, { text: 'So', t: 88518 }])).toBe(0);
    expect(holdCount([{ text: 'possibility,', t: 54890 }, { text: 'and', t: 55936 }])).toBe(0);
    expect(holdCount([{ text: 'is', t: 9572 }, { text: 'bound.', t: 11892 }])).toBe(1); // the seam the gate made
  });
  it('an ungated answer has no gate metrics; answerUsd includes repairs', () => {
    expect(gateMetrics(emptyResult('q', 0))).toBeUndefined();
    expect(computeMetrics(emptyResult('q', 0)).gate).toBeUndefined();
    const r = gated();
    r.events.push({ t: 'done', usd: 0.004, spentUsd: 0, capUsd: 6, ttftMs: 1 });
    const m = computeMetrics(r);
    expect(m.answerUsd).toBeCloseTo(0.01);
    expect(m.gate?.drops).toBe(2);
  });
  it('run level: sums, repair p50/p95, check p95, drop rate; absent when nothing was gated', () => {
    const ms = [computeMetrics(gated()), computeMetrics(gated()), computeMetrics(emptyResult('q', 0))];
    const run = aggregate(ms);
    expect(run.gate).toMatchObject({ answers: 2, sum: { drops: 4, units: 12, repairs: 4, holds: 2, liveSkipAfterPass: 2 }, repairMs: { p50: 1500, p95: 1500 }, shadowMs: { p95: 40 }, seamMs: { p50: 450 } });
    expect(run.gate!.dropRate).toBeCloseTo(4 / 12);
    expect(aggregate([computeMetrics(emptyResult('q', 0))]).gate).toBeUndefined();
  });
});

function qs(id: string, r: EvalResult): QuestionSummary {
  return { id, split: 'dev', type: 'why', metrics: computeMetrics(r), judge: { scores: { understanding: 4, illustration: 4, deck: 4, craft: 4, economy: 4 }, fatal: [], notes: '' } as never };
}
const S = (id: string, rs: EvalResult[]) => buildSummary({ runId: id, config: 'c', qset: 'q', promptVersion: 'p', phase: 'dev', questions: rs.map((r, i) => qs(`D${i + 1}`, r)) });

describe('compare: gate rules', () => {
  const clean = () => { const r = gated(); r.events = r.events.filter((e) => e.t !== 'gate' || e.action !== 'drop'); r.timings = []; r.words = r.words.slice(0, 4); return r; };
  it('rejects drops up by more than the slack, holds up, and any live skip after a pass', () => {
    const A = S('a', [clean(), clean()]);
    const B = S('b', [gated(), gated()]);
    const c = compare(A, B);
    expect(c.verdict).toBe('REJECT');
    const why = c.reasons.join('; ');
    expect(why).toMatch(/gate drops up by 4/);
    expect(why).toMatch(/live skip\(s\) after the gate passed/);
    expect(c.gate).toMatchObject({ drops: { a: 0, b: 4 }, liveSkipAfterPass: { a: 0, b: 2 } });
    expect(format(A, B, c)).toMatch(/gate drops 0 -> 4/);
    // An ungated baseline counts as zero drops; a gated B with no regressions adds no reason.
    expect(gateRules(S('a', [emptyResult('q', 0)]), S('b', [clean()])).reasons).toEqual([]);
    expect(gateRules(S('a', [emptyResult('q', 0)]), S('b', [emptyResult('q', 0)]))).toEqual({ reasons: [] });
    const holds = S('b', [clean()]); holds.run.gate!.sum.holds = THRESHOLDS.holdSlack + 1;
    expect(gateRules(S('a', [clean()]), holds).reasons.join()).toMatch(/holds > 1 s up/);
  });
});

describe('report', () => {
  it('per-answer gate rows and run-level stats; nothing for ungated runs', () => {
    const html = gateRows(gateMetrics(gated())!);
    expect(html).toContain('gate drops');
    expect(html).toContain('2 (18 words) · cascade ×1');
    expect(html).toContain('ok 1, late 1');
    expect(html).toContain('live skips after pass');
    const sum = S('r', [gated()]);
    const q = { id: 'D1', split: 'dev', deck: 'econ', page: 1, pick: 'hand', type: 'why', question: 'Q?' } as never;
    const page = renderReport(sum, [{ q, summary: sum.questions[0], asked: 'Q?', transcript: 't', stills: [] }]);
    expect(page).toContain('gate drops / units');
    expect(page).toContain('repairs ok / sent');
    const plain = S('r', [emptyResult('q', 0)]);
    expect(renderReport(plain, [{ q, summary: plain.questions[0], asked: 'Q?', transcript: 't', stills: [] }])).not.toContain('gate drops');
  });
});

describe('runner flags and preflight', () => {
  it('parses --gate, --gatefail, --repair; repair defaults to recorded on a replay, live otherwise', () => {
    const a = parseArgs(['--gate', 'live', '--gatefail', '2:skip,o1:late', '--repair', 'fake']);
    expect(a).toMatchObject({ gate: 'live', gatefail: '2:skip,o1:late', repair: 'fake' });
    expect(gateQuery(a)).toBe('&gate=live&gatefail=2%3Askip%2Co1%3Alate&repair=fake');
    expect(repairOf(parseArgs(['--replay', 'r1', '--no-judge']))).toBe('recorded');
    expect(gateQuery(parseArgs(['--replay', 'r1']))).toBe('&repair=recorded');
    expect(repairOf(parseArgs([]))).toBe('live');
    expect(gateQuery(parseArgs([]))).toBe('');
    expect(() => parseArgs(['--gate', 'on'])).toThrow(/--gate/);
    expect(() => parseArgs(['--gatefail', 'two'])).toThrow(/--gatefail/);
    expect(() => parseArgs(['--repair', 'recorded'])).toThrow(/--replay/);
  });
  it('a generating, gated run with live repairs sets aside 0.3 × MAX_REPAIRS worst-case repairs per answer; replays and fakes set aside nothing', () => {
    const c = CONFIGS['terra-none'];
    expect(plannedRepairUsd(c)).toBeCloseTo(REPAIR_SHARE * MAX_REPAIRS * worstRepairUsd(c));
    expect(plannedWorstUsd(c, 10, 0, 'r3', true) - plannedWorstUsd(c, 10, 0, 'r3')).toBeCloseTo(10 * plannedRepairUsd(c));
    expect(plannedRepairUsd(CONFIGS['claude-opus-low'])).toBeGreaterThan(plannedRepairUsd(c));
    expect(spendsOnRepairs(parseArgs([]))).toBe(true);
    expect(spendsOnRepairs(parseArgs(['--gate', 'off']))).toBe(false);
    expect(spendsOnRepairs(parseArgs(['--repair', 'fake']))).toBe(false);
    expect(spendsOnRepairs(parseArgs(['--replay', 'r1', '--repair', 'live']))).toBe(false);
    const spend = { totalUsd: 0, capUsd: 6, todayUsd: 0 };
    const qset = [{ id: 'D1', split: 'dev', deck: 'econ', page: 1, pick: 'hand', type: 'why', question: 'q' }] as never;
    expect(checkBudget(spend, c, qset, 1, false, 'r3', true).planned).toBeGreaterThan(checkBudget(spend, c, qset, 1, false, 'r3').planned);
  });
});
