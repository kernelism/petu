import { describe, it, expect, vi } from 'vitest';
import { renderTranscript, parseJudge, judgeAnswer, buildJudgeRequest, agreement, meanScore, JUDGE_SCHEMA, RUBRIC, type JudgeRequest } from '../../scripts/eval/judge';
import { pickStills, cells, fitIn, composeScript, SHEET_W, SHEET_H } from '../../scripts/eval/sheet';

const good = { scores: { intuitive: 4, sync: 3, correct: 5, simple: 4 }, fatal: ['wrong_fact'], notes: 'ok' };
const tm = (kind: string, fired: number, skipped?: string) => ({ action: { kind }, firedAt: fired, queuedAt: fired, startedAt: fired, endedAt: fired + 1, ...(skipped ? { skipped } : {}) });

describe('judge', () => {
  it('renders each tag with a check or the skip reason, in script order', () => {
    const t = renderTranscript({
      chunks: [{ t: 0, d: 'Look {{circle p=3 mark=#d3}} here. ' }, { t: 1, d: 'Then {{line on=s from=P to=Q}} ok {{box p=3 mark=#t9}}' }],
      timings: [tm('circle', 100), tm('line', 200, 'unknown point Q')],
    });
    expect(t).toBe('Look [circle p=3 mark=#d3 ✓] here. Then [line on=s from=P to=Q ✗ unknown point Q] ok [box p=3 mark=#t9 ✗ not parsed]');
  });
  it('an untimed {{let}} and braces inside quotes do not shift the marks', () => {
    const t = renderTranscript({
      chunks: [{ t: 0, d: '{{sketch id=s near=p1 fit}}{{let on=s A=0,0 B=1,1}} One {{math on=s at=A "\\frac{a}{b}"}} two {{line on=s from=A to=B}}' }],
      timings: [tm('sketch', 10), tm('math', 20), tm('line', 30, 'unknown point B')],
    });
    expect(t).toBe('[sketch id=s near=p1 fit ✓][let on=s A=0,0 B=1,1] One [math on=s at=A "\\frac{a}{b}" ✓] two [line on=s from=A to=B ✗ unknown point B]');
  });
  it('parses a valid result and rejects bad ones', () => {
    expect(parseJudge(good).scores.correct).toBe(5);
    expect(parseJudge({ ...good, notes: 'x'.repeat(400) }).notes).toHaveLength(300);
    expect(() => parseJudge({ ...good, scores: { ...good.scores, sync: 6 } })).toThrow(/sync/);
    expect(() => parseJudge({ ...good, scores: { ...good.scores, sync: 2.5 } })).toThrow();
    expect(() => parseJudge({ ...good, fatal: ['nope'] })).toThrow(/fatal/);
    expect(() => parseJudge(null)).toThrow();
  });
  it('mean score', () => { expect(meanScore(parseJudge(good))).toBe(4); });
  it('schema and rubric name every criterion and fatal flag', () => {
    expect(JSON.stringify(JUDGE_SCHEMA)).toContain('ignored_question');
    for (const w of ['intuitive', 'sync', 'correct', 'simple', 'unreadable_overlap']) expect(RUBRIC).toContain(w);
  });
  const req = (): JudgeRequest => buildJudgeRequest({ phase: 'bakeoff', question: 'Q', result: { chunks: [{ t: 0, d: 'hi' }], timings: [] }, page: { b64: 'p', w: 1, h: 1 }, sheet: { b64: 's', w: 1536, h: 864 } });
  const resp = (b: unknown, ok = true) => ({ ok, status: ok ? 200 : 403, json: async () => b }) as Response;
  it('builds the Lane S body: instructions, ordered content parts, bare schema', () => {
    const r = req();
    expect(r.phase).toBe('bakeoff'); expect(r.name).toBe('judgement');
    expect(r.schema).toBe(JUDGE_SCHEMA.schema);
    expect(r.content.map((c) => c.type)).toEqual(['input_text', 'input_image', 'input_text', 'input_image', 'input_text']);
    expect(JSON.stringify(r.content)).toContain('Transcript:');
  });
  it('posts to /api/judge with the eval token (mocked, no OpenAI) and returns the parsed judgement', async () => {
    const f = vi.fn().mockResolvedValue(resp({ ok: true, output: good, usd: 0.02 }));
    const out = await judgeAnswer(req(), { base: 'http://x', token: 'tok', fetch: f as never });
    expect(f.mock.calls[0][0]).toBe('http://x/api/judge');
    expect(f.mock.calls[0][1].headers['x-petu-eval']).toBe('tok');
    expect(JSON.parse(f.mock.calls[0][1].body).phase).toBe('bakeoff');
    expect(out.usd).toBe(0.02);
  });
  it('retries once on a malformed result and sums the spend; not on a cap error or a 403', async () => {
    const f = vi.fn().mockResolvedValueOnce(resp({ ok: true, output: { nope: 1 }, usd: 0.02 })).mockResolvedValueOnce(resp({ ok: true, output: good, usd: 0.02 }));
    const out = await judgeAnswer(req(), { base: '', token: 't', fetch: f as never });
    expect(f).toHaveBeenCalledTimes(2); expect(out.usd).toBeCloseTo(0.04);
    const g = vi.fn().mockResolvedValue(resp({ ok: false, code: 'cap', message: 'over', usd: 0 }));
    await expect(judgeAnswer(req(), { base: '', token: 't', fetch: g as never })).rejects.toThrow(/cap/);
    expect(g).toHaveBeenCalledTimes(1);
    const h = vi.fn().mockResolvedValue(resp({ error: 'eval token required' }, false));
    await expect(judgeAnswer(req(), { base: '', token: 'bad', fetch: h as never })).rejects.toThrow(/403/);
  });
  it('retries once on an upstream network failure (the server booked its worst case)', async () => {
    const f = vi.fn().mockResolvedValueOnce(resp({ ok: false, code: 'network', message: 'fetch failed', usd: 0.03 })).mockResolvedValueOnce(resp({ ok: true, output: good, usd: 0.02 }));
    const out = await judgeAnswer(req(), { base: '', token: 't', fetch: f as never });
    expect(f).toHaveBeenCalledTimes(2); expect(out.usd).toBeCloseTo(0.05);
  });
  it('agreement within ±1', () => {
    const j = parseJudge(good);
    expect(agreement([j], [{ intuitive: 4, sync: 4, correct: 4, simple: 4 }])).toBe(1);
    expect(agreement([j], [{ intuitive: 1, sync: 1, correct: 1, simple: 4 }])).toBe(0.25);
  });
});

describe('contact sheet layout', () => {
  it('picks all when ≤ 8, else 8 spread keeping first and last', () => {
    expect(pickStills(3)).toEqual([0, 1, 2]);
    const p = pickStills(20);
    expect(p).toHaveLength(8); expect(p[0]).toBe(0); expect(p[7]).toBe(19);
    expect([...p].sort((a, b) => a - b)).toEqual(p);
  });
  it('lays out 4x2 cells inside 1536x864 without overlap', () => {
    const cs = cells(8);
    expect(cs).toHaveLength(8);
    for (const c of cs) { expect(c.x + c.w).toBeLessThanOrEqual(SHEET_W); expect(c.y + c.h).toBeLessThanOrEqual(SHEET_H); }
    expect(cs[4].y).toBeGreaterThan(cs[0].y + cs[0].h - 1);
    expect(cs[1].x).toBeGreaterThan(cs[0].x + cs[0].w - 1);
    const f = fitIn(cs[0], 1440 / 900);
    expect(f.w).toBeLessThanOrEqual(cs[0].w); expect(f.h).toBeLessThanOrEqual(cs[0].h);
  });
  it('the compose script is canvas-only (no foreignObject)', () => {
    const s = composeScript(['data:image/png;base64,AAAA']);
    expect(s).toContain('toDataURL');
    expect(s).not.toMatch(/foreignObject/i);
  });
});
