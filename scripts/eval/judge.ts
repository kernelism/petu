// scripts/eval/judge.ts — the vision judge. Never calls OpenAI itself: it POSTs a prepared request to
// the dev server's /api/judge, which runs gpt-6.1-sol at effort low through the spend ledger.
import { readFileSync } from 'node:fs';
import type { EvalResult } from '../../src/agent/evalHooks.ts';

export const CRITERIA = ['intuitive', 'sync', 'correct', 'simple'] as const;
export type Criterion = (typeof CRITERIA)[number];
export const FATALS = ['wrong_fact', 'mark_on_wrong_thing', 'drawing_contradicts_narration', 'unreadable_overlap', 'ignored_question'] as const;
export type Fatal = (typeof FATALS)[number];

export type JudgeResult = { scores: Record<Criterion, number>; fatal: Fatal[]; notes: string };
export const meanScore = (j: JudgeResult): number => CRITERIA.reduce((a, c) => a + j.scores[c], 0) / CRITERIA.length;

export const JUDGE_MODEL = 'gpt-6.1-sol';
export const JUDGE_EFFORT = 'low';

export const RUBRIC = `You are judging a tutor that answers a student's question by drawing on their PDF page while narrating.
You get: the question, the page the student was looking at, a contact sheet (up to 8 stills, numbered, taken as each sentence ended, left to right then top to bottom), and the transcript. In the transcript every drawing tag is shown as [kind target ✓] when it drew, or [kind target ✗ reason] when the engine skipped it.

Score each criterion 1-5 (integers):
- intuitive: would a student get it on first watch?
- sync: does each drawing appear as its words are said, and does the picture build up rather than appear all at once?
- correct: are the facts right, are the marks on the right things, and does the drawing agree with the narration?
- simple: few elements, one idea, nothing decorative.
Anchors: 1 = harmful or confusing. 3 = acceptable with flaws. 5 = what a great teaching assistant would draw.

List in "fatal" every one that applies, else an empty list:
wrong_fact, mark_on_wrong_thing, drawing_contradicts_narration, unreadable_overlap, ignored_question.
"notes": at most 300 characters, the single most important thing to fix.`;

export const JUDGE_SCHEMA = {
  name: 'judgement',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['scores', 'fatal', 'notes'],
    properties: {
      scores: {
        type: 'object', additionalProperties: false, required: [...CRITERIA],
        properties: Object.fromEntries(CRITERIA.map((c) => [c, { type: 'integer', minimum: 1, maximum: 5 }])),
      },
      fatal: { type: 'array', items: { type: 'string', enum: [...FATALS] } },
      notes: { type: 'string', maxLength: 300 },
    },
  },
} as const;

/** One content part, as server/openai.ts takes it. */
export type JudgePart = { type: 'input_text'; text: string } | { type: 'input_image'; b64: string; w: number; h: number; detail?: 'low' | 'high' | 'auto' };
/** The body of POST /api/judge (Lane S): the server fixes model and effort and books the spend. `phase` must equal its PETU_PHASE. */
export type JudgeRequest = { phase: string; instructions: string; content: JudgePart[]; schema: Record<string, unknown>; name: string };
export type JudgeResponse = { ok: true; output: unknown; usd: number } | { ok: false; code: string; message: string; usd: number };

const TAG = /\{\{([^{}]*)\}\}/g;

/** Narration with each tag shown as [circle #d3 ✓] or [line on=s … ✗ reason], in script order. */
export function renderTranscript(r: Pick<EvalResult, 'chunks' | 'timings'>): string {
  const raw = r.chunks.map((c) => c.d).join('');
  const order = r.timings.map((t, i) => ({ t, i })).sort((a, b) => (a.t.firedAt ?? 0) - (b.t.firedAt ?? 0) || a.i - b.i).map((x) => x.t);
  let n = 0;
  const out = raw.replace(TAG, (_m, inner: string) => {
    const t = order[n++];
    const body = inner.trim().replace(/\s+/g, ' ');
    const short = body.length > 48 ? `${body.slice(0, 47)}…` : body;
    if (!t) return `[${short} ✗ never ran]`;
    return t.skipped ? `[${short} ✗ ${t.skipped}]` : `[${short} ✓]`;
  });
  return out.replace(/[ \t]+/g, ' ').trim();
}

/** Validates the judge's JSON. Throws on anything outside the schema; trims long notes. */
export function parseJudge(raw: unknown): JudgeResult {
  const o = raw as { scores?: Record<string, unknown>; fatal?: unknown; notes?: unknown } | null;
  if (!o || typeof o !== 'object' || !o.scores) throw new Error('judge: missing scores');
  const scores = {} as Record<Criterion, number>;
  for (const c of CRITERIA) {
    const v = o.scores[c];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 5) throw new Error(`judge: bad score ${c}=${String(v)}`);
    scores[c] = v;
  }
  if (!Array.isArray(o.fatal) || o.fatal.some((f) => !(FATALS as readonly string[]).includes(f as string))) throw new Error('judge: bad fatal list');
  const notes = typeof o.notes === 'string' ? o.notes.slice(0, 300) : '';
  return { scores, fatal: [...new Set(o.fatal as Fatal[])], notes };
}

export function buildJudgeRequest(a: { phase: string; question: string; result: Pick<EvalResult, 'chunks' | 'timings'>; page: { b64: string; w: number; h: number }; sheet: { b64: string; w: number; h: number } }): JudgeRequest {
  return {
    phase: a.phase, instructions: RUBRIC, schema: JUDGE_SCHEMA.schema, name: JUDGE_SCHEMA.name,
    content: [
      { type: 'input_text', text: `Question: ${a.question}\n\nThe page the student was looking at:` },
      { type: 'input_image', b64: a.page.b64, w: a.page.w, h: a.page.h, detail: 'low' },
      { type: 'input_text', text: 'Contact sheet (stills at the end of each sentence, in order):' },
      { type: 'input_image', b64: a.sheet.b64, w: a.sheet.w, h: a.sheet.h, detail: 'high' },
      { type: 'input_text', text: `Transcript:\n${renderTranscript(a.result)}` },
    ],
  };
}

/** The server's per-start secret, from .petu/eval-token (read after the server is up). */
export function readEvalToken(file = '.petu/eval-token'): string {
  return readFileSync(file, 'utf8').trim();
}

export type JudgeOutcome = { judge: JudgeResult; usd: number };
/** Posts to the server (injectable fetch for tests). One retry on a malformed result; none on cap/network errors. */
export async function judgeAnswer(req: JudgeRequest, o: { base: string; token: string; fetch?: typeof fetch }): Promise<JudgeOutcome> {
  const f = o.fetch ?? fetch;
  let lastErr: unknown;
  let usd = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await f(`${o.base}/api/judge`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-petu-eval': o.token }, body: JSON.stringify(req) });
    const body = (await res.json()) as JudgeResponse & { error?: string };
    if (!res.ok && body.error) throw new Error(`judge http ${res.status}: ${typeof body.error === 'string' ? body.error : JSON.stringify(body.error)}`);
    if (body.ok === false) { if (body.code === 'upstream' && attempt === 0) { usd += body.usd; lastErr = new Error(`judge ${body.code}: ${body.message}`); continue; } throw new Error(`judge ${body.code}: ${body.message}`); }
    usd += body.usd;
    try { return { judge: parseJudge(body.output), usd }; } catch (e) { lastErr = e; }
  }
  throw lastErr instanceof Error ? lastErr : new Error('judge failed');
}

/** Share of (judge, hand) score pairs within ±1. The judge is trusted when ≥ 0.8. */
export function agreement(judge: JudgeResult[], hand: Record<Criterion, number>[]): number {
  let ok = 0, n = 0;
  judge.forEach((j, i) => { for (const c of CRITERIA) { n++; if (Math.abs(j.scores[c] - hand[i][c]) <= 1) ok++; } });
  return n ? ok / n : 0;
}
