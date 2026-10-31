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
//   - anything else is a pointer, and long quotes (a whole line pointed at) are never spoken.
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
/** Words too common to tell whether the quote is already being said. */
const STOP = new Set(['a', 'an', 'the', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'and', 'or', 'is', 'are', 'this', 'that', 'its']);
/** A quote longer than this is a line pointed at, never a word of the sentence. */
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
 * Whether the quote's words must be spoken at the tag. `before`: the sentence's words before the tag
 * (narration only); `clause`: the text after the tag to its clause end (clauseAfter).
 */
export function needsWords(before: readonly string[], quote: string, clause: string): boolean {
  const q = wordsOf(quote);
  if (!q.length || q.length > MAX_SPOKEN) return false;
  const qs = q.join(' ');
  const content = new Set(q.filter((w) => !STOP.has(w)));
  const prevRaw = before.length ? before[before.length - 1] : '';
  const prev = norm(prevRaw);
  // Already said: the whole quote earlier in the sentence, or in the clause after the tag.
  if (squash(before.join(' ')).includes(qs)) return false;
  if (` ${squash(clause)} `.includes(` ${qs} `)) return false;
  // Said around the tag: the word just before it or just after it is one of the quote's own.
  const firstRaw = clause.trim().split(/\s+/)[0] ?? '';
  const first = norm(firstRaw);
  if (first && (content.has(first) || (!content.size && q.includes(first)))) return false;
  if (prev && content.has(prev)) return false;
  if (before.length === 0) {
    // Opening the sentence: its subject is missing unless a capitalised word starts it after the tag.
    return !/^["'“‘(]?\p{Lu}/u.test(firstRaw);
  }
  // A clause ending in a word that needs a noun ("the", "by", "the image's"), with no noun phrase of its own after the tag.
  if (/[,;:.!?]$/.test(prevRaw)) return false;
  if (OPENS_NOUN.has(first)) return false;
  return NEEDS_NOUN.has(prev) || /['’]s$/i.test(prevRaw);
}

/** The quote as spoken words: trailing punctuation dropped, capitalised when it opens the sentence. */
export function quoteSpoken(quote: string, opens: boolean): string {
  let s = quote.replace(/\s+/g, ' ').trim().replace(/[.,;:!?]+$/, '');
  if (opens) s = s.replace(/^\p{Ll}/u, (c) => c.toUpperCase());
  return s;
}
