// server/title.ts — POST /api/title: a saved question's short title (src/session/title.ts).
//
// One small non-streamed call on the cheapest configured model, through the ledger like every other
// call (`callJson`: the worst case is reserved and the caps refuse before anything is sent; kind
// `title`). Cached by content: the same questions and sections are titled once per server.
import { createHash } from 'node:crypto';
import { callJson, endpointOf, estimateInputTokens, outputText, type Deps } from './openai';
import { cleanTitle, TITLE_LIMITS, TITLE_WORDS, titleInput, titleKey, type TitleInput, type TitleReply } from '../src/session/title';

/** The cheapest model with a price in server/prices.ts that the OpenAI key reaches; no reasoning needed. */
export const TITLE_MODEL = 'gpt-6-luna';
/** A few words; headroom for a model that adds a word or a quote before the cleaning. */
export const TITLE_MAX_OUTPUT = 40;
/** Titles kept for the content cache (oldest forgotten first). */
const CACHE_MAX = 200;

export const TITLE_INSTRUCTIONS =
  `Name a student's study conversation for their list of saved questions. Reply with the title only: two to five words (never more than ${TITLE_WORDS}) ` +
  'naming the topic their questions ask about, in the student\'s own terms (not a sentence, not a question). The document\'s ' +
  'section titles are context only: name what was asked, not the section. No quotes, no trailing period, no "Title:".';

/** The body's questions and sections, or why it is malformed. */
export function validateTitle(b: any): TitleInput | string {
  if (b == null || typeof b !== 'object') return 'body must be an object';
  const list = (v: unknown, n: number) => Array.isArray(v) && v.length <= TITLE_LIMITS.items && v.every((s) => typeof s === 'string' && s.length <= n);
  if (!list(b.questions, TITLE_LIMITS.question)) return `questions must be at most ${TITLE_LIMITS.items} strings of at most ${TITLE_LIMITS.question} characters`;
  if (b.sections != null && !list(b.sections, TITLE_LIMITS.section)) return `sections must be at most ${TITLE_LIMITS.items} strings of at most ${TITLE_LIMITS.section} characters`;
  const i = titleInput(b.questions, b.sections ?? []);
  return i.questions.length ? i : 'questions must hold at least one question';
}

export function titleRequest(i: TitleInput) {
  const text = [`Questions, in order:\n${i.questions.map((q) => `- ${q}`).join('\n')}`, ...(i.sections.length ? [`Sections of the document the answers taught from:\n${i.sections.map((s) => `- ${s}`).join('\n')}`] : [])].join('\n\n');
  return {
    model: TITLE_MODEL, store: false, stream: false, max_output_tokens: TITLE_MAX_OUTPUT, reasoning: { effort: 'none' },
    input: [
      { role: 'developer', content: [{ type: 'input_text', text: TITLE_INSTRUCTIONS }] },
      { role: 'user', content: [{ type: 'input_text', text }] },
    ],
  };
}

export class TitleCache {
  private m = new Map<string, string>();
  private k = (i: TitleInput) => createHash('sha1').update(titleKey(i)).digest('hex');
  get(i: TitleInput): string | undefined { return this.m.get(this.k(i)); }
  set(i: TitleInput, t: string): void {
    const k = this.k(i);
    this.m.delete(k);
    this.m.set(k, t);
    while (this.m.size > CACHE_MAX) this.m.delete(this.m.keys().next().value!);
  }
}

/** The title and its HTTP status: 200, 402 (a cap refused it), 502 (no usable title), 503 (no key). */
export async function makeTitle(i: TitleInput, d: Deps, cache: TitleCache): Promise<{ status: number; body: TitleReply }> {
  const hit = cache.get(i);
  if (hit) return { status: 200, body: { title: hit, usd: 0, cached: true } };
  if (!d.key) return { status: 503, body: { error: 'no OPENAI_API_KEY', code: 'no_key' } };
  const body = titleRequest(i);
  const r = await callJson(body, TITLE_MODEL, estimateInputTokens(body, []), TITLE_MAX_OUTPUT, 'title', d, { ep: endpointOf(TITLE_MODEL, d), timeoutMs: 15_000 });
  if (!r.ok) return { status: r.code === 'cap' ? 402 : 502, body: { error: r.message, code: r.code } };
  const title = cleanTitle(outputText(r.json));
  if (!title) return { status: 502, body: { error: 'no usable title', code: 'upstream' } };
  cache.set(i, title);
  return { status: 200, body: { title, usd: r.usd } };
}
