// scripts/eval/judge.ts — the vision judge. Never calls OpenAI itself: it POSTs a prepared request to
// the dev server's /api/judge, which runs gpt-6.1-sol at effort low through the spend ledger.
// Two rubrics: r3 (Eval v3, the default: does the answer teach? judged on a timeline of frames) and
// r2 (checkpoint 2: short correct answers on a contact sheet), kept behind --rubric r2 for comparison.
import { readFileSync } from 'node:fs';
import type { EvalResult } from '../../src/agent/evalHooks.ts';

export const FATALS = ['wrong_fact', 'mark_on_wrong_thing', 'drawing_contradicts_narration', 'unreadable_overlap', 'ignored_question'] as const;
export type Fatal = (typeof FATALS)[number];

export type RubricVersion = 'r2' | 'r3';
/** A judgement. `scores` holds the rubric's criteria; `defects` only exists under r3. */
export type JudgeResult = { rubric?: RubricVersion; scores: Record<string, number>; fatal: Fatal[]; defects?: string[]; notes: string };
/** Mean over the criteria the judgement has (r2: 4, r3: 5). */
export const meanScore = (j: JudgeResult): number => { const v = Object.values(j.scores); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; };

export const JUDGE_MODEL = 'gpt-6.1-sol';
export const JUDGE_EFFORT = 'low';

// ---------------------------------------------------------------------------------------------
// r2 (checkpoint 2).
export const CRITERIA = ['intuitive', 'sync', 'correct', 'simple'] as const;
export type Criterion = (typeof CRITERIA)[number];

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

// ---------------------------------------------------------------------------------------------
// r3 (Eval v3): does the answer teach? Judged on a timeline of frames + the transcript.
export const CRITERIA_R3 = ['understanding', 'illustration', 'deck', 'craft', 'economy'] as const;
export const DEFECTS_R3 = ['board_copies_page', 'board_repeats_narration', 'written_not_drawn', 'drawing_appears_at_once', 'single_slide', 'wrong_page', 'padded', 'too_shallow', 'out_of_sync', 'cluttered', 'skipped_actions', 'followup_repeats'] as const;

export const RUBRIC_R3 = `You are judging a tutor. A student opened a PDF (lecture slides, a handout or a book), was looking at one page, and asked a question. The tutor answers by talking (the transcript) while it acts on screen: it scrolls to pages, highlights and marks things on the slides, and draws on a board beside them (sketches, plots, labelled diagrams, short equations). The bar is a great teacher at a whiteboard with the slides projected next to it: the student should come away understanding, not just holding an answer.

You get: the question; the page the student was looking at; a digest of the document (page numbers with each page's first lines), so you can tell which other pages bear on the question; a timeline of frames (screenshots taken during playback, each with the narration spoken since the previous frame), then the final state and, when there is one, the whole board; and the full transcript. In the transcript each action tag is shown as [kind … ✓] when it ran, [kind … ✗ reason] when the engine skipped it, and [let …] for tags that only name points. Read the timeline in order: it is how the student saw the answer unfold.

Score each criterion 1-5 (integers). Give a 5 only when you cannot name a concrete improvement for that criterion.
- understanding: would this student, with this confusion, now get it?
  5 meets what the student is actually missing, in plain words, and shows the mechanism (why it is so), so they could explain it back or handle a variant.
  4 right and clear, but one step of the why is asserted rather than shown, or the student's specific confusion is only partly met.
  3 a correct answer that restates or points at the page, defines instead of explaining, or answers an easier question than the one asked.
  2 vague, circular or hard to follow. 1 wrong or misleading.
- illustration: is the idea drawn, and does the drawing teach?
  5 one central drawn illustration (a worked case: points, geometry, a plot, bars, a small example with numbers) that builds step by step with the narration and changes as the idea develops; correct; readable at a glance.
  4 a good drawing, but it appears in one go, or misses the one step that would make it click, or has one small readability issue.
  3 a drawing that is decorative or generic (boxes around the slide's figure, a sketch that only restates the slide), or a board that is mostly written text.
  2 a list of words or equations where a picture was needed, or a drawing that is wrong or unreadable. 1 nothing drawn where the question plainly needed a picture, or a drawing that contradicts the narration.
  When the question needs no picture (logistics, off-topic), drawing little is right: score 4-5.
- deck: does it use the document well?
  5 brings in the right pages (earlier or later pages where the idea lives, not only the visible one) when the question needs them, and every mark on a page lands exactly on the thing named.
  4 the right pages, with one imprecise mark (a whole figure boxed when one part is named, slightly off).
  3 stays on the visible page when the answer lives across pages; or the right pages but vague pointing; or jumps to pages that do not help.
  2 a mark on the wrong thing, or a misread page. 1 ignores or contradicts the document.
  For a narrow question about the visible page, staying on it is right.
- craft: is it well performed?
  5 ink appears as its words are said; the board is laid out cleanly (aligned, spaced, nothing overlapping or cut off); every drawn thing the student must tell apart is labelled; things compared share one scale; every piece of board text is a label on a drawn thing or a new value or step the student must see written; and everything the narration describes actually appears. Give 5 only when you cannot point to a single lapse.
  4 one lapse: one mark early or late, one cramped spot, one unlabelled or mislabelled element, one stray or redundant piece of board text, or one action that never appeared (✗ in the transcript) while the narration talks about it.
  3 several lapses; or the board copies a formula or sentence the page already shows (it should point at it on the page instead); or the board writes out what the narration is saying (the voice carries the words, the board carries the picture).
  2 cluttered, overlapping or out of sync throughout. 1 unwatchable.
- economy: does the depth fit the question?
  5 exactly as long as understanding takes: a narrow question gets a focused answer, a broad one the walk it needs; no padding, no recap of what was just shown, no tangents. Give 5 only when no sentence could be cut and no needed step is missing.
  4 slightly long or slightly thin in one place: one restated point, one tangent or closing caveat the student did not need, or one step asserted where it needed a sentence more.
  3 noticeably padded (repetition, recap, filler, steps the student did not need) or noticeably too shallow (a one-liner for a broad question, skipping the step the student was stuck on).
  2 far too long or far too short for the question. 1 the length defeats the answer.
  Too shallow is as much a defect as too long.
Off-topic questions (nothing to do with the document): one polite sentence that redirects to the document, with no drawing, is the intended answer. Score it 4-5 on every criterion and do not flag ignored_question.

"defects": every one that applies, else an empty list:
board_copies_page (board text repeats a formula or sentence that is on the page), board_repeats_narration (board text writes out what is being said), written_not_drawn (a list or text block where a drawing was needed), drawing_appears_at_once (the main illustration appears finished instead of building), single_slide (stays on one page when the idea needs others), wrong_page (goes to a page that does not help), padded, too_shallow, out_of_sync (ink lands away from its words), cluttered (overlapping, cramped or cut-off elements), skipped_actions (more than two actions skipped, or a skipped one that the narration or later drawing depends on: the student never saw it), followup_repeats (a follow-up only: it keeps the previous answer's picture or level and adds more of the same, or says again what the previous answer said, instead of changing them as the student asked).
"fatal": every one that applies, else an empty list: wrong_fact, mark_on_wrong_thing, drawing_contradicts_narration, unreadable_overlap, ignored_question.
"notes": at most 400 characters: the single change that would most improve this as a lesson.`;

const scoreSchema = (criteria: readonly string[]) => ({
  type: 'object', additionalProperties: false, required: [...criteria],
  properties: Object.fromEntries(criteria.map((c) => [c, { type: 'integer', minimum: 1, maximum: 5 }])),
});

export const JUDGE_SCHEMA_R3 = {
  name: 'judgement',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['scores', 'defects', 'fatal', 'notes'],
    properties: {
      scores: scoreSchema(CRITERIA_R3),
      defects: { type: 'array', items: { type: 'string', enum: [...DEFECTS_R3] } },
      fatal: { type: 'array', items: { type: 'string', enum: [...FATALS] } },
      notes: { type: 'string', maxLength: 400 },
    },
  },
} as const;

/** Everything a rubric fixes: its criteria, flags, instructions and output schema. */
export type Rubric = { version: RubricVersion; criteria: readonly string[]; defects: readonly string[]; notesMax: number; text: string; schema: Record<string, unknown>; name: string };
export const R2: Rubric = { version: 'r2', criteria: CRITERIA, defects: [], notesMax: 300, text: RUBRIC, schema: JUDGE_SCHEMA.schema, name: JUDGE_SCHEMA.name };
export const R3: Rubric = { version: 'r3', criteria: CRITERIA_R3, defects: DEFECTS_R3, notesMax: 400, text: RUBRIC_R3, schema: JUDGE_SCHEMA_R3.schema, name: JUDGE_SCHEMA_R3.name };
export const RUBRICS: Record<RubricVersion, Rubric> = { r2: R2, r3: R3 };
export const DEFAULT_RUBRIC: RubricVersion = 'r3';
export function rubricOf(v: string): Rubric {
  if (!(v in RUBRICS)) throw new Error(`unknown rubric ${v} (have: ${Object.keys(RUBRICS).join(', ')})`);
  return RUBRICS[v as RubricVersion];
}
/** The criteria a judgement was scored on (its own rubric, else inferred from its scores). */
export const criteriaOf = (j: JudgeResult): readonly string[] => (j.rubric ? RUBRICS[j.rubric].criteria : 'understanding' in j.scores ? CRITERIA_R3 : CRITERIA);

/** Validates the judge's JSON against a rubric. Throws on anything outside the schema; trims long notes. */
export function parseJudge(raw: unknown, rubric: Rubric = R2): JudgeResult {
  const o = raw as { scores?: Record<string, unknown>; fatal?: unknown; defects?: unknown; notes?: unknown } | null;
  if (!o || typeof o !== 'object' || !o.scores) throw new Error('judge: missing scores');
  const scores: Record<string, number> = {};
  for (const c of rubric.criteria) {
    const v = o.scores[c];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 5) throw new Error(`judge: bad score ${c}=${String(v)}`);
    scores[c] = v;
  }
  if (!Array.isArray(o.fatal) || o.fatal.some((f) => !(FATALS as readonly string[]).includes(f as string))) throw new Error('judge: bad fatal list');
  const notes = typeof o.notes === 'string' ? o.notes.slice(0, rubric.notesMax) : '';
  const out: JudgeResult = { scores, fatal: [...new Set(o.fatal as Fatal[])], notes };
  if (rubric.version === 'r3') {
    if (!Array.isArray(o.defects) || o.defects.some((d) => !rubric.defects.includes(d as string))) throw new Error('judge: bad defects list');
    out.rubric = 'r3';
    out.defects = [...new Set(o.defects as string[])];
  }
  return out;
}

/** r2: the visible page and one contact sheet. */
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

type Img = { b64: string; w: number; h: number };
/** One timeline frame for the r3 judge: its caption (when it was taken, what was said since the last one) and the image. */
export type JudgeFrame = Img & { caption: string };

/**
 * Appended to the r3 instructions when the judged answer is a follow-up (a revision request such as
 * "simpler", "a better picture", "another example", "I still don't get it"). The judge then also sees
 * the previous answer: its question, frames, final state, board and transcript.
 */
export const FOLLOW_UP_RUBRIC = `This answer is a FOLLOW-UP: the student watched the previous answer (shown first, as PREVIOUS ANSWER) and then asked the follow-up. Judge the follow-up as a lesson in its own right and as a response to that request. When the student asks for a better picture, a simpler or more basic version, another example, more depth, or says they still don't get it, the follow-up must change the representation or the level as asked: a genuinely different picture or worked case (or a clearly simpler or deeper one), not the previous scene with more of the same added, and not the previous narration said again. Reusing the previous picture is right only when the student asked to continue it. Flag followup_repeats when it doesn't change as asked; then illustration and understanding are at most 3.`;

/** The previous answer a follow-up is judged against: what the student asked and saw. */
export type JudgePrevious = { question: string; frames: JudgeFrame[]; final?: Img; board?: Img; result: Pick<EvalResult, 'chunks' | 'timings'> };

/** r3: question, visible page, deck digest, the frame timeline, final state, whole board, transcript (a follow-up: the previous answer's first). */
export function buildJudgeRequestR3(a: { phase: string; question: string; result: Pick<EvalResult, 'chunks' | 'timings'>; page: Img; digest: string; frames: JudgeFrame[]; final?: Img; board?: Img; previous?: JudgePrevious }): JudgeRequest {
  const content: JudgePart[] = [];
  const p = a.previous;
  if (p) {
    // The previous answer is context, not what is scored: its frames at low detail, its board and transcript.
    content.push({ type: 'input_text', text: `PREVIOUS ANSWER. The student first asked: ${p.question}\nIts timeline (${p.frames.length} frames, in order):` });
    p.frames.forEach((f, i) => content.push({ type: 'input_text', text: `Previous frame ${i + 1}. ${f.caption}` }, { type: 'input_image', b64: f.b64, w: f.w, h: f.h, detail: 'low' }));
    if (p.final) content.push({ type: 'input_text', text: 'Previous answer, final state:' }, { type: 'input_image', ...p.final, detail: 'low' });
    if (p.board) content.push({ type: 'input_text', text: 'Previous answer, the whole board:' }, { type: 'input_image', ...p.board, detail: 'high' });
    content.push({ type: 'input_text', text: `Previous transcript:\n${renderTranscript(p.result)}\n\nTHE FOLLOW-UP (the answer you score) starts here.` });
  }
  content.push(
    { type: 'input_text', text: `${p ? 'Follow-up question' : 'Question'}: ${a.question}\n\nThe page the student was looking at:` },
    { type: 'input_image', ...a.page, detail: 'low' },
    { type: 'input_text', text: `Document digest:\n${a.digest}` },
    { type: 'input_text', text: `Timeline (${a.frames.length} frames, in order):` },
  );
  a.frames.forEach((f, i) => {
    content.push({ type: 'input_text', text: `Frame ${i + 1}. ${f.caption}` });
    content.push({ type: 'input_image', b64: f.b64, w: f.w, h: f.h, detail: 'high' });
  });
  if (a.final) content.push({ type: 'input_text', text: 'Final state, after the answer finished:' }, { type: 'input_image', ...a.final, detail: 'high' });
  if (a.board) content.push({ type: 'input_text', text: 'The whole board at the end (scrolled content stitched top to bottom):' }, { type: 'input_image', ...a.board, detail: 'high' });
  content.push({ type: 'input_text', text: `Transcript:\n${renderTranscript(a.result)}` });
  const sk = skippedOf(a.result);
  content.push({ type: 'input_text', text: sk.length ? `Engine: ${sk.length} action(s) were skipped and never appeared: ${sk.join('; ')}.` : 'Engine: no action was skipped.' });
  return { phase: a.phase, instructions: p ? `${RUBRIC_R3}\n\n${FOLLOW_UP_RUBRIC}` : RUBRIC_R3, schema: JUDGE_SCHEMA_R3.schema, name: JUDGE_SCHEMA_R3.name, content };
}

/** The engine's skip reasons for one turn ("grid id=o: unknown block img"), in order. */
export function skippedOf(r: Pick<EvalResult, 'timings'>): string[] {
  return r.timings.filter((t) => t.skipped).map((t) => `${String(t.action.kind ?? '?')}${t.action.id ? ` id=${String(t.action.id)}` : ''}: ${t.skipped}`);
}

/**
 * Input tokens the server will reserve for a judge request (mirrors server/openai.ts
 * estimateInputTokens: text at ~3.2 chars/token, images by 32-px patches; the instructions count).
 */
export function estimateJudgeTokens(req: JudgeRequest): number {
  const text = req.instructions + req.content.map((p) => (p.type === 'input_text' ? p.text : '')).join('');
  const wide = text.match(/[^\x00-\x7f]/g)?.length ?? 0;
  const patches = req.content.reduce((n, p) => n + (p.type === 'input_image' ? Math.ceil(p.w / 32) * Math.ceil(p.h / 32) : 0), 0);
  return Math.ceil((text.length - wide) / 3.2 + wide + patches * 1.2) + 50;
}

/** A fixed, valid judgement for offline runs (--fake-judge): every score 3, no flags. Never a real result. */
export function fakeJudgement(r: Rubric): Record<string, unknown> {
  return { scores: Object.fromEntries(r.criteria.map((c) => [c, 3])), fatal: [], ...(r.version === 'r3' ? { defects: [] } : {}), notes: 'FAKE judgement (--fake-judge): no model was called.' };
}
/** A fetch for judgeAnswer that answers every request with fakeJudgement, at $0. */
export const fakeJudgeFetch = (r: Rubric): typeof fetch => (async () => new Response(JSON.stringify({ ok: true, output: fakeJudgement(r), usd: 0 }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;

/** The server's per-start secret, from .petu/eval-token (read after the server is up). */
export function readEvalToken(file = '.petu/eval-token'): string {
  return readFileSync(file, 'utf8').trim();
}

export type JudgeOutcome = { judge: JudgeResult; usd: number };
/** Posts to the server (injectable fetch for tests). One retry on a malformed result or an upstream/network/rate-limit failure; none on cap errors. */
export async function judgeAnswer(req: JudgeRequest, o: { base: string; token: string; fetch?: typeof fetch; rubric?: Rubric }): Promise<JudgeOutcome> {
  const f = o.fetch ?? fetch;
  let lastErr: unknown;
  let usd = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await f(`${o.base}/api/judge`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-petu-eval': o.token }, body: JSON.stringify(req) });
    const body = (await res.json()) as JudgeResponse & { error?: string };
    if (!res.ok && body.error) throw new Error(`judge http ${res.status}: ${typeof body.error === 'string' ? body.error : JSON.stringify(body.error)}`);
    if (body.ok === false) { if ((body.code === 'upstream' || body.code === 'network' || body.code === 'rate_limited') && attempt === 0) { usd += body.usd; lastErr = new Error(`judge ${body.code}: ${body.message}`); continue; } throw new Error(`judge ${body.code}: ${body.message}`); }
    usd += body.usd;
    try { return { judge: parseJudge(body.output, o.rubric ?? (req.instructions.startsWith(RUBRIC_R3) ? R3 : R2)), usd }; } catch (e) { lastErr = e; }
  }
  throw lastErr instanceof Error ? lastErr : new Error('judge failed');
}

/** Share of (judge, hand) score pairs within ±1. The judge is trusted when ≥ 0.8. */
export function agreement(judge: JudgeResult[], hand: Record<string, number>[], criteria: readonly string[] = judge[0] ? criteriaOf(judge[0]) : CRITERIA): number {
  let ok = 0, n = 0;
  judge.forEach((j, i) => { for (const c of criteria) { if (hand[i]?.[c] == null) continue; n++; if (Math.abs(j.scores[c] - hand[i][c]) <= 1) ok++; } });
  return n ? ok / n : 0;
}
