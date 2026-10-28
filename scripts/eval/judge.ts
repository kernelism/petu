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

/**
 * v2 (P1 calibration): v1 agreed with the hand scores within ±1 on 92.5% of 160 scores but ran
 * ~0.5 points lenient (exact agreement 43%) and flagged the correct one-sentence off-topic redirect
 * as ignored_question. v2 adds per-criterion anchors, "5 only when nothing concrete can be improved",
 * and the off-topic rule.
 */
export const RUBRIC_VERSION = 'r2';
export const RUBRIC = `You are judging a tutor that answers a student's question by drawing on their PDF page while narrating.
You get: the question, the page the student was looking at, a contact sheet (up to 8 stills, numbered, taken as each sentence ended, left to right then top to bottom), and the transcript. In the transcript every drawing tag is shown as [kind target ✓] when it drew, [kind target ✗ reason] when the engine skipped it, and {{let}} tags (which only name points) as [let …].

Score each criterion 1-5 (integers). The bar is a great teaching assistant at a whiteboard. Give a 5 only when you cannot name a concrete improvement for that criterion.
- intuitive: would a student get it on first watch?
  5 shows the mechanism behind the answer (the "why"), concretely, on the page or in a sketch.
  4 clear and grounded in the page, but misses a concrete example or a visual of the key step.
  3 correct, but mostly restates or highlights the page's own text without showing why; or a "why" answered with a definition.
  2 vague, circular, or hard to follow. 1 misleading or confusing.
- sync: does each drawing appear as its words are said, and does the picture build up rather than appear all at once?
  5 every mark lands on the words that name it and the figure builds step by step. 4 one mark that does not match its sentence.
  3 several marks that do not match their words, or a figure that appears mostly at once. 2 or less: drawings unrelated to the narration's timing.
- correct: are the facts right, are the marks on the right things, and does the drawing agree with the narration?
  5 facts right and every mark on exactly the thing named.
  4 facts right, but a mark is imprecise: a whole figure boxed when one part is named, overlapping duplicate boxes, clipped or cut-off text.
  3 one mark on the wrong thing, or one misleading statement. 2 the drawing contradicts the narration (e.g. a sketch whose geometry is not what is said). 1 wrong facts.
- simple: few elements, one idea, nothing decorative.
  5 one idea, about 6 elements or fewer, no redundant marks, no unneeded page jumps.
  4 one redundant mark or one unneeded jump. 3 most of the page highlighted, repeated or overlapping marks, back-and-forth scrolling, or a long list. 2 or less: cluttered.
Off-topic questions (nothing to do with the document): one polite sentence that redirects to the document, with no drawing, is the intended answer. Score it 4-5 and do not flag ignored_question.

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

/** Each `{{…}}` tag in `raw` with its span. Quoted text may hold braces (`"\\frac{a}{b}"`). */
export function scanTags(raw: string): { start: number; end: number; inner: string }[] {
  const out: { start: number; end: number; inner: string }[] = [];
  let i = 0;
  while ((i = raw.indexOf('{{', i)) >= 0) {
    let j = i + 2, q = false, close = -1;
    for (; j < raw.length; j++) {
      const c = raw[j];
      if (c === '"') q = !q;
      else if (!q && c === '}' && raw[j + 1] === '}') { close = j; break; }
      else if (!q && c === '{' && raw[j + 1] === '{') break; // an unclosed tag: the next one starts here
    }
    if (close < 0) { i += 2; continue; }
    out.push({ start: i, end: close + 2, inner: raw.slice(i + 2, close) });
    i = close + 2;
  }
  return out;
}

/** Tags that never become a timed action ({{let}} only names points). */
const UNTIMED = new Set(['let']);

/**
 * Narration with each tag shown as [circle #d3 ✓] or [line on=s … ✗ reason], in script order. Each tag
 * is matched to the next unused timing of the same kind, so an untimed {{let}} or an unparsed tag
 * does not shift the marks of the tags after it.
 */
export function renderTranscript(r: Pick<EvalResult, 'chunks' | 'timings'>): string {
  const raw = r.chunks.map((c) => c.d).join('');
  const order = r.timings.map((t, i) => ({ t, i })).sort((a, b) => (a.t.firedAt ?? 0) - (b.t.firedAt ?? 0) || a.i - b.i).map((x) => x.t);
  const used = new Set<number>();
  let out = '', at = 0;
  for (const tag of scanTags(raw)) {
    const body = tag.inner.trim().replace(/\s+/g, ' ');
    const kind = body.split(' ')[0];
    const short = body.length > 48 ? `${body.slice(0, 47)}…` : body;
    let shown: string;
    if (UNTIMED.has(kind)) shown = `[${short}]`;
    else {
      const k = order.findIndex((t, n) => !used.has(n) && String(t.action.kind ?? '') === kind);
      if (k < 0) shown = `[${short} ✗ not parsed]`;
      else { used.add(k); const t = order[k]; shown = t.skipped ? `[${short} ✗ ${t.skipped}]` : `[${short} ✓]`; }
    }
    out += raw.slice(at, tag.start) + shown;
    at = tag.end;
  }
  out += raw.slice(at);
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
/** Posts to the server (injectable fetch for tests). One retry on a malformed result or an upstream/network/rate-limit failure; none on cap errors. */
export async function judgeAnswer(req: JudgeRequest, o: { base: string; token: string; fetch?: typeof fetch }): Promise<JudgeOutcome> {
  const f = o.fetch ?? fetch;
  let lastErr: unknown;
  let usd = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await f(`${o.base}/api/judge`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-petu-eval': o.token }, body: JSON.stringify(req) });
    const body = (await res.json()) as JudgeResponse & { error?: string };
    if (!res.ok && body.error) throw new Error(`judge http ${res.status}: ${typeof body.error === 'string' ? body.error : JSON.stringify(body.error)}`);
    if (body.ok === false) { if ((body.code === 'upstream' || body.code === 'network' || body.code === 'rate_limited') && attempt === 0) { usd += body.usd; lastErr = new Error(`judge ${body.code}: ${body.message}`); continue; } throw new Error(`judge ${body.code}: ${body.message}`); }
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
