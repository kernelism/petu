// src/session/title.ts — a saved question's title (founder 2026-10-31): a short plain name for the
// conversation, made by one small LLM call on the server (POST /api/title, server/title.ts) from its
// questions and the answers' section titles. Until it arrives, or when it can't be made, the first
// answer's section title stands in. Shared by the browser and the server (the cleaning rule).

/** What the title is made from: the questions in order (first, then follow-ups) and the answers' section titles. */
export type TitleInput = { questions: string[]; sections: string[] };
export type TitleReply = { title: string; usd?: number; cached?: boolean } | { error: string; code?: string };

/** The longest title, in words. */
export const TITLE_WORDS = 6;
const JOINING = new Set(['a', 'an', 'the', 'at', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'with', 'by', 'from', 'as', 'vs', 'is', 'are', 'its', 'their', 'how', 'why', 'what', 'when']);
/** Bounds on what the browser sends (and the server accepts). */
export const TITLE_LIMITS = { items: 12, question: 300, section: 120 };

/**
 * A model's title made plain: one line, no wrapping quotes or markdown, no "Title:" lead, no trailing
 * period, at most TITLE_WORDS words. '' when nothing usable is left.
 */
export function cleanTitle(raw: string): string {
  let t = raw.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  t = t.replace(/^(title|topic)\s*[:\-–—]\s*/i, '').replace(/[*_`#]/g, '');
  t = t.replace(/^["'“”‘’«»\s]+/u, '');
  const all = t.split(/\s+/).filter(Boolean), words = all.slice(0, TITLE_WORDS);
  // Cut short, a title never ends on a joining word ("Why the yeast rises at the").
  if (all.length > TITLE_WORDS) while (words.length > 1 && JOINING.has(words[words.length - 1].toLowerCase().replace(/[^a-z]/g, ''))) words.pop();
  return words.join(' ').replace(/["'“”‘’«».;:,!…\s]+$/u, '');
}

/** The input as the server and both caches see it: trimmed, bounded, empty items dropped. */
export function titleInput(questions: string[], sections: string[]): TitleInput {
  const fit = (xs: string[], n: number) => xs.map((s) => s.replace(/\s+/g, ' ').trim().slice(0, n)).filter(Boolean).slice(0, TITLE_LIMITS.items);
  return { questions: fit(questions, TITLE_LIMITS.question), sections: [...new Set(fit(sections, TITLE_LIMITS.section))] };
}

/** One cache key per content (the same questions and sections are never titled twice). */
export const titleKey = (i: TitleInput) => JSON.stringify([i.questions, i.sections]);

const made = new Map<string, Promise<string | null>>();

/**
 * The title for `input` (null when the call failed or the spending cap refused it). Asked once per
 * content in a page's life: a second conversation with the same content shares the first's answer.
 */
export function fetchTitle(input: TitleInput, phase?: string): Promise<string | null> {
  const k = titleKey(input);
  let p = made.get(k);
  if (!p) {
    p = fetch('/api/title', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...input, ...(phase ? { phase } : {}) }) })
      .then(async (r) => {
        const j = await r.json().catch(() => null) as TitleReply | null;
        const t = j && 'title' in j ? cleanTitle(j.title) : '';
        return r.ok && t ? t : null;
      })
      .catch(() => null);
    made.set(k, p);
    // A failure may be passing (a dropped connection): the next save may ask again.
    void p.then((t) => { if (t == null) made.delete(k); });
  }
  return p;
}
