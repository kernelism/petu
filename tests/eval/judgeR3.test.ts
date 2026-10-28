import { describe, it, expect, vi } from 'vitest';
import { parseJudge, buildJudgeRequestR3, judgeAnswer, R2, R3, RUBRIC_R3, JUDGE_SCHEMA_R3, CRITERIA_R3, DEFECTS_R3, rubricOf, criteriaOf, meanScore, estimateJudgeTokens, fakeJudgement, fakeJudgeFetch, agreement, DEFAULT_RUBRIC } from '../../scripts/eval/judge';

const good = { scores: { understanding: 4, illustration: 2, deck: 3, craft: 3, economy: 5 }, defects: ['board_copies_page', 'single_slide'], fatal: [], notes: 'Draw a window over a corner.' };
const img = { b64: 'AAAA', w: 1152, h: 720 };

describe('rubric r3', () => {
  it('is the default; r2 stays available', () => {
    expect(DEFAULT_RUBRIC).toBe('r3');
    expect(rubricOf('r2')).toBe(R2);
    expect(rubricOf('r3')).toBe(R3);
    expect(() => rubricOf('r9')).toThrow();
  });
  it('the text names every criterion and defect, and the founder\'s failure modes', () => {
    for (const w of [...CRITERIA_R3, ...DEFECTS_R3, 'ignored_question']) expect(RUBRIC_R3).toContain(w);
    for (const w of ['drawn', 'builds', 'copies a formula or sentence the page already shows', 'writes out what the narration is saying', 'Too shallow', 'not only the visible one']) expect(RUBRIC_R3).toContain(w);
    expect(JSON.stringify(JUDGE_SCHEMA_R3)).toContain('board_repeats_narration');
    expect(JUDGE_SCHEMA_R3.schema.required).toEqual(['scores', 'defects', 'fatal', 'notes']);
  });
  it('parses a valid judgement and rejects bad ones', () => {
    const j = parseJudge(good, R3);
    expect(j).toEqual({ rubric: 'r3', scores: good.scores, defects: good.defects, fatal: [], notes: good.notes });
    expect(meanScore(j)).toBeCloseTo(3.4);
    expect(criteriaOf(j)).toEqual(CRITERIA_R3);
    expect(parseJudge({ ...good, notes: 'x'.repeat(500) }, R3).notes).toHaveLength(400);
    expect(parseJudge({ ...good, defects: ['padded', 'padded'] }, R3).defects).toEqual(['padded']);
    expect(() => parseJudge({ ...good, scores: { ...good.scores, craft: 0 } }, R3)).toThrow(/craft/);
    expect(() => parseJudge({ ...good, scores: { intuitive: 3, sync: 3, correct: 3, simple: 3 } }, R3)).toThrow(/understanding/);
    expect(() => parseJudge({ ...good, defects: ['ugly'] }, R3)).toThrow(/defects/);
    expect(() => parseJudge({ ...good, defects: undefined }, R3)).toThrow(/defects/);
    expect(() => parseJudge({ ...good, fatal: ['nope'] }, R3)).toThrow(/fatal/);
  });
  it('r2 judgements keep their four criteria and no defects', () => {
    const j = parseJudge({ scores: { intuitive: 4, sync: 4, correct: 4, simple: 4 }, fatal: [], notes: '' });
    expect(j.defects).toBeUndefined(); expect(criteriaOf(j)).toEqual(['intuitive', 'sync', 'correct', 'simple']);
  });
  it('builds the request as a timeline: page, digest, captioned frames in order, final, board, transcript', () => {
    const r = buildJudgeRequestR3({ phase: 'lessoniter', question: 'Q?', result: { chunks: [{ t: 0, d: 'Hi {{circle p=2 mark=#d1}}' }], timings: [] }, page: img, digest: '3 pages.\np1: x',
      frames: [{ ...img, caption: 'After sentence 1 of 2' }, { ...img, caption: 'After sentence 2 of 2' }], final: img, board: img });
    expect(r.instructions).toBe(RUBRIC_R3);
    expect(r.schema).toBe(JUDGE_SCHEMA_R3.schema);
    expect(r.content.map((c) => c.type)).toEqual(['input_text', 'input_image', 'input_text', 'input_text', 'input_text', 'input_image', 'input_text', 'input_image', 'input_text', 'input_image', 'input_text', 'input_image', 'input_text']);
    const texts = r.content.flatMap((c) => (c.type === 'input_text' ? [c.text] : []));
    expect(texts[1]).toContain('p1: x');
    expect(texts[3]).toBe('Frame 1. After sentence 1 of 2');
    expect(texts[4]).toBe('Frame 2. After sentence 2 of 2');
    expect(texts.at(-1)).toContain('[circle p=2 mark=#d1 ✗ not parsed]');
    const noBoard = buildJudgeRequestR3({ phase: 'x', question: 'Q', result: { chunks: [], timings: [] }, page: img, digest: '', frames: [{ ...img, caption: 'c' }] });
    expect(JSON.stringify(noBoard.content)).not.toContain('whole board');
  });
  it('estimates tokens like the server (images by 32-px patches)', () => {
    const r = buildJudgeRequestR3({ phase: 'x', question: 'Q', result: { chunks: [], timings: [] }, page: img, digest: '', frames: [{ ...img, caption: 'c' }] });
    const t = estimateJudgeTokens(r);
    expect(t).toBeGreaterThan(2 * 36 * 23 * 1.2);
    expect(t).toBeLessThan(2 * 36 * 23 * 1.2 + 3000);
  });
  it('judgeAnswer parses with r3 when the request is r3; a fake judge never leaves the process', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, output: good, usd: 0.03 }) } as Response);
    const req = buildJudgeRequestR3({ phase: 'x', question: 'Q', result: { chunks: [], timings: [] }, page: img, digest: '', frames: [] });
    const out = await judgeAnswer(req, { base: 'http://x', token: 't', fetch: f as never });
    expect(out.judge.rubric).toBe('r3');
    const fake = await judgeAnswer(req, { base: 'http://unreachable.invalid', token: 't', fetch: fakeJudgeFetch(R3), rubric: R3 });
    expect(fake.usd).toBe(0);
    expect(fake.judge.notes).toMatch(/FAKE/);
    expect(parseJudge(fakeJudgement(R2)).scores.sync).toBe(3);
  });
  it('agreement uses the judgement\'s own criteria', () => {
    const j = parseJudge(good, R3);
    expect(agreement([j], [{ understanding: 4, illustration: 4, deck: 3, craft: 3, economy: 5 }])).toBeCloseTo(0.8);
  });
});
