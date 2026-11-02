// src/script/quoteWords.ts — the words a page mark's quote stands for, when the sentence uses the tag as
// a word. The model often writes `The {{highlight p=4 "filter kernel"}} supplies weights…`: the quote is
// both the page target and part of the sentence. Without its words the student hears "The supplies
// weights…". The parser (src/script/parser.ts) speaks them at the tag, so the mark lands as they are
// said; the scout's opener filter (server/scoutStream.ts) speaks them in place of a tag it drops.
// The rule reads only the narration around the tag, never the model's intent (calibrated on 321 recorded
// quote tags in .petu/answers.jsonl, 2026-10-31):
//   - the quoted words already said next to the tag (just before it, or in the clause after it): nothing;
//   - the tag opens a sentence and a lowercase word follows ("{{highlight …}} changes an image"): the
//     subject is missing; a capitalised word ("{{highlight …}} The kernel…") means the tag only points;
//   - inside a sentence, right after a word that needs a noun (the, a, of, by, is, called, the image's):
//     the noun is missing, unless a new noun phrase starts right after the tag ("by {{…}} the weights");
//   - anything else is a pointer.
// A long quote (a whole line pointed at, more than MAX_SPOKEN words) after a word that needs a noun is
// spoken only where the sentence certainly lacks it (diag C8, D19: "The {{highlight "slope is constant;
// P/Q is not."}} Elasticity changes…" was heard as "The Elasticity changes…"): with no words of the
// clause after it, a verb right after it ("The {{…}} are like…", draw D8), or a new sentence after it when
// the quote ends one. Opening a sentence before a lowercase word it is the subject whatever its length
// ("{{highlight "Midpoint method: same answer in either direction"}} uses the average…", q2 D18; eval
// 2026-11-02 heard five such openers without their subject). A long quote in a slot whose next word may
// continue the sentence ("the {{…line…}} viewing ray", "The {{…}} distinction is") points.
import type { RawAction } from './types';

/** Page marks whose quote may stand in the sentence. */
const MARK_KINDS = new Set(['highlight', 'underline', 'circle', 'box']);

/** Words that need a noun after them: a tag right after one of these stands for that noun. */
const NEEDS_NOUN = new Set([
  'a', 'an', 'the', 'this', 'these', 'those', 'its', 'their', 'our', 'your', 'his', 'her', 'my', 'each', 'every', 'any', 'some', 'no',
  'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'into', 'onto', 'as', 'than', 'about', 'via', 'per',
  'is', 'are', 'was', 'were', 'be', 'been', 'called', 'named', 'termed', 'known',
]);
/** A word after the tag that opens a noun phrase of its own: the slot is filled. */
const OPENS_NOUN = new Set(['a', 'an', 'the', 'this', 'these', 'those', 'its', 'their', 'our', 'your', 'his', 'her', 'my']);
/** Words that start a predicate, never a noun phrase: after "the {{…}}" the slot is certainly empty. */
const STARTS_VERB = new Set([
  'is', 'are', 'was', 'were', 'has', 'have', 'had', 'can', 'could', 'will', 'would', 'may', 'might', 'must', 'should', 'does', 'do', 'did',
  'shows', 'describes', 'explains', 'means', 'says', 'states', 'gives', 'tells', 'uses', 'connects', 'compares', 'measures', 'depends', 'defines', 'makes', 'lets',
]);
/** Words too common to tell whether the quote is already being said. */
const STOP = new Set(['a', 'an', 'the', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'and', 'or', 'is', 'are', 'this', 'that', 'its']);
/** A quote longer than this may be a line pointed at: spoken only where the sentence certainly lacks it. */
export const MAX_SPOKEN = 4;

const norm = (w: string) => w.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '');
const wordsOf = (s: string) => s.split(/\s+/).map(norm).filter(Boolean);
const squash = (s: string) => wordsOf(s).join(' ');

/** The quote of a page mark that could stand in the sentence (highlight / underline / circle / box on a page), else null. */
export function markQuote(a: RawAction | null | undefined): string | null {
  if (!a || !MARK_KINDS.has(a.kind)) return null;
  const x = a as { page?: number; region?: string; quote?: string };
  if (x.page == null || x.region != null || !x.quote) return null;
  return wordsOf(x.quote).length ? x.quote : null;
}

/** Ends a sentence: a word whose last letter is followed by . ! or ? (closing quotes and brackets allowed). */
export const endsSentence = (w: string) => /[.!?]["'”’)\]]*$/.test(w);

/** The words of the sentence so far: after the last word that ends one. */
export function sentenceTail(words: readonly string[]): string[] {
  let i = words.length;
  while (i > 0 && !endsSentence(words[i - 1])) i--;
  return words.slice(i);
}

/** A clause's end after a tag: punctuation and a space (or the stream's end, when final), a newline or a tag. */
const clauseEnd = (final: boolean) => (final ? /[.!?;:,]+["'”’)\]]*(?=\s|$)|\n|\{\{/ : /[.!?;:,]+["'”’)\]]*(?=\s)|\n|\{\{/);

/**
 * The text after a tag, cut where its clause ends or after `maxWords` whole words (a copy of the quote
 * follows the tag, if anywhere), or null while neither has arrived and the stream goes on. Depends only
 * on the text, never on where chunks were split.
 */
export function clauseAfter(after: string, final: boolean, maxWords: number): string | null {
  const m = clauseEnd(final).exec(after);
  const end = m ? m.index + (m[0].startsWith('{{') || m[0] === '\n' ? 0 : m[0].length) : -1;
  // Whole words (followed by a space) before the clause's end.
  const re = /\S+(?=\s)/g;
  let n = 0;
  for (let w = re.exec(after); w; w = re.exec(after)) {
    if (end >= 0 && w.index >= end) break;
    if (++n >= maxWords) return after.slice(0, w.index + w[0].length);
  }
  if (end >= 0) return after.slice(0, end);
  return final ? after : null;
}

/** How many words after a tag decide it: the quote's length and one more. */
export const lookahead = (quote: string) => wordsOf(quote).length + 1;

/**
 * What a mark's quote is to its sentence: `said` (its words are said next to it), `speak` (the sentence
 * lacks them: speak them at the tag), or `pointer` (it only points; also a long quote in a slot the next
 * word may fill). `before`: the sentence's words before the tag (narration only); `clause`: the text
 * after the tag to its clause end (clauseAfter).
 */
export type QuoteRole = 'said' | 'speak' | 'pointer';
export function quoteRole(before: readonly string[], quote: string, clause: string): QuoteRole {
  const q = wordsOf(quote);
  if (!q.length) return 'pointer';
  const qs = q.join(' ');
  const content = new Set(q.filter((w) => !STOP.has(w)));
  const prevRaw = before.length ? before[before.length - 1] : '';
  const prev = norm(prevRaw);
  // Already said: the whole quote earlier in the sentence, or in the clause after the tag.
  if (squash(before.join(' ')).includes(qs)) return 'said';
  if (` ${squash(clause)} `.includes(` ${qs} `)) return 'said';
  // Said around the tag: the word just before it or just after it is one of the quote's own.
  const firstRaw = clause.trim().split(/\s+/)[0] ?? '';
  const first = norm(firstRaw);
  if (first && (content.has(first) || (!content.size && q.includes(first)))) return 'said';
  if (prev && content.has(prev)) return 'said';
  const long = q.length > MAX_SPOKEN;
  const capital = /^["'“‘(]?\p{Lu}/u.test(firstRaw);
  if (before.length === 0) {
    // Opening the sentence: its subject is missing unless a capitalised word starts it after the tag.
    return capital ? 'pointer' : 'speak';
  }
  // A clause ending in a word that needs a noun ("the", "by", "the image's"), with no noun phrase of its own after the tag.
  if (/[,;:.!?]$/.test(prevRaw)) return 'pointer';
  if (OPENS_NOUN.has(first)) return 'pointer';
  if (!NEEDS_NOUN.has(prev) && !/['’]s$/i.test(prevRaw)) return 'pointer';
  if (!long) return 'speak';
  // A long quote: the slot is certainly empty when nothing follows in the clause, when a verb follows
  // ("The {{…}} are like"), or when a new sentence follows a quote that ends one ("The {{…is not.}}
  // Elasticity changes"); else it may be a pointer.
  return !first || STARTS_VERB.has(first) || (capital && /[.!?]["'”’)\]]*$/.test(quote.trim())) ? 'speak' : 'pointer';
}

/** Whether the quote's words must be spoken at the tag (quoteRole). */
export const needsWords = (before: readonly string[], quote: string, clause: string): boolean => quoteRole(before, quote, clause) === 'speak';

/**
 * The quote as spoken words: trailing punctuation dropped (the sentence's own follows the tag), except a
 * full stop when a new sentence starts after the tag (`ends`); capitalised when it opens the sentence.
 */
export function quoteSpoken(quote: string, opens: boolean, ends = false): string {
  let s = quote.replace(/\s+/g, ' ').trim();
  if (!(ends && /[.!?]$/.test(s))) s = s.replace(/[.,;:!?]+$/, '');
  if (opens) s = s.replace(/^\p{Ll}/u, (c) => c.toUpperCase());
  return s;
}

/**
 * The words to speak at the tag when the sentence lacks them (quoteRole `speak`), else null; an article
 * the sentence already said is not said twice ("The {{highlight "The slope…"}} is…").
 */
export function spokenAt(before: readonly string[], quote: string, clause: string): string | null {
  if (quoteRole(before, quote, clause) !== 'speak') return null;
  const prev = before.length ? norm(before[before.length - 1]) : '';
  const q = OPENS_NOUN.has(prev) && norm(quote.trim().split(/\s+/)[0]) === prev ? quote.trim().replace(/^\S+\s+/, '') : quote;
  return quoteSpoken(q, before.length === 0, /^["'“‘(]?\p{Lu}/u.test(clause.trim()));
}
