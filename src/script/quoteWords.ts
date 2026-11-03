// src/script/quoteWords.ts — what a page mark's tag says when the sentence uses it as a word.
//
// The rule (design 2026-11-02, "a tag is a pure pointer"): a tag is silent. Its quote is the mark's
// target on the page, never narration: the student hears only the words outside the tags, so the prompts
// (server/prompt/scout.ts OPENER, server/prompt/system.ts POINTING) ask for sentences that read whole
// with every tag taken out. The model still writes `The {{highlight p=4 "…"}} uses the average…`, using
// the tag as the sentence's noun. The engine then voices a short deictic for what lights up, never the
// page's text: "This uses the average…" (the mark lands on "This"). Before, the quote itself was spoken
// there (PR #38), and a pointed-at line was read out verbatim, notation and capitals included ("The page's
// Sensitivity: P (+ | D) = 0.95 means…"); before that, nothing was, and the sentence lost its subject.
// A wrong guess about the slot now costs a stray "this", not a formula read aloud, so the quote's length
// and shape no longer matter.
//
// What the tag is to its sentence (quoteRole), read only from the narration around it:
//   - `said`: the quote's words are already said next to it (before it in the sentence, in the clause
//     after it, or a content word of the quote right before or after it): nothing to add;
//   - `slot`: the sentence lacks a noun at the tag: it opens the sentence before a lowercase word
//     ("{{…}} uses…"), or follows a word that needs a noun (the, of, is, called, its, the page's) with no
//     noun phrase of its own after it ("by {{…}} the weights" is filled); a demonstrative before it
//     ("this {{…}} means") already stands as the noun;
//   - `pointer`: anything else.
// The deictic for a slot (deixisAt) depends only on the word before it, never on the quote:
//   - after an article (a, an, the) it replaces the article: "The {{…}} uses" → "This uses", "the {{…}}
//     viewing ray" → "this viewing ray" ("this" stands as a pronoun and as a determiner alike);
//   - after a possessive or quantifier (its, the page's, each) it is the mark as a noun: "the page's
//     highlighted line means…";
//   - anywhere else (opening the sentence, after of / is / called): "this" ("Start with this: …").
// "these" before a plural verb (are, were, have); a quote that ends a sentence before a new one ("The
// {{…is not.}} Elasticity changes") closes it: "This line. Elasticity changes…".
// Callers: the parser (src/script/parser.ts) emits the deictic at the tag, so the mark lands as it is
// said; the gate (src/gate/live.ts) builds the same words when it strips a failed mark; the scout's
// opener filter (server/scoutStream.ts) does not speak a sentence that needs a tag it dropped (the
// deictic would point at nothing).
import type { RawAction } from './types';

/** Page marks whose tag may stand in the sentence. */
const MARK_KINDS = new Set(['highlight', 'underline', 'circle', 'box']);

const ARTICLES = new Set(['a', 'an', 'the']);
/** Determiners after which the slot takes a noun ("its highlighted line"). */
const POSSESSIVES = new Set(['its', 'their', 'our', 'your', 'his', 'her', 'my', 'each', 'every', 'any', 'some', 'no']);
/** Other words that need a noun after them: a tag right after one of these stands for that noun. */
const NEEDS_NOUN = new Set([
  ...ARTICLES, ...POSSESSIVES,
  'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'into', 'onto', 'as', 'than', 'about', 'via', 'per',
  'is', 'are', 'was', 'were', 'be', 'been', 'called', 'named', 'termed', 'known',
]);
/** A word after the tag that opens a noun phrase of its own: the slot is filled. */
const OPENS_NOUN = new Set(['a', 'an', 'the', 'this', 'these', 'those', 'its', 'their', 'our', 'your', 'his', 'her', 'my']);
/** Verbs that agree with a plural subject: the deictic before them is "these". */
const PLURAL_VERB = new Set(['are', 'were', 'have', 'do', 'arent', 'werent', 'dont']);
/** Words too common to tell whether the quote is already being said. */
const STOP = new Set(['a', 'an', 'the', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'and', 'or', 'is', 'are', 'this', 'that', 'its']);
/** The mark as a noun, after a possessive. */
const NOUN: Record<string, string> = { highlight: 'highlighted line', underline: 'underlined line', circle: 'circled part', box: 'boxed part' };

const norm = (w: string) => w.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '');
const wordsOf = (s: string) => s.split(/\s+/).map(norm).filter(Boolean);
const squash = (s: string) => wordsOf(s).join(' ');
const possessive = (raw: string) => /\p{L}['’]s$/iu.test(raw) || POSSESSIVES.has(norm(raw));

/** A page mark whose tag could stand in the sentence: its kind and quote. */
export type Mark = { kind: string; quote: string };

/** The page mark (highlight / underline / circle / box on a page, with a quote) a tag is, else null. */
export function markOf(a: RawAction | null | undefined): Mark | null {
  if (!a || !MARK_KINDS.has(a.kind)) return null;
  const x = a as { page?: number; region?: string; quote?: string };
  if (x.page == null || x.region != null || !x.quote) return null;
  return wordsOf(x.quote).length ? { kind: a.kind, quote: x.quote } : null;
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

/** How many words after a tag decide it: the quote's length and one more (a copy of it may follow). */
export const lookahead = (quote: string) => wordsOf(quote).length + 1;

/**
 * What a mark's tag is to its sentence (see the header): `said`, `slot` (the sentence lacks a noun at
 * the tag) or `pointer`. `before`: the sentence's words before the tag (narration only); `clause`: the
 * text after the tag to its clause end (clauseAfter).
 */
export type QuoteRole = 'said' | 'slot' | 'pointer';
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
  // Opening the sentence: its subject is missing unless a capitalised word starts it after the tag.
  if (before.length === 0) return /^["'“‘(]?\p{Lu}/u.test(firstRaw) ? 'pointer' : 'slot';
  // Inside it: right after a word that needs a noun, with no noun phrase of its own after the tag.
  if (/[,;:.!?]$/.test(prevRaw)) return 'pointer';
  if (OPENS_NOUN.has(first)) return 'pointer';
  return NEEDS_NOUN.has(prev) || possessive(prevRaw) ? 'slot' : 'pointer';
}

/**
 * The words that fill a slot (deixisAt): `words` are said at the tag; `replacesPrev`: they take the
 * place of the sentence's last word (an article: "The {{…}} uses" → "This uses").
 */
export type Deixis = { words: string; replacesPrev: boolean };

/** The deictic the engine says at a mark that fills a noun slot (see the header), else null. */
export function deixisAt(before: readonly string[], mark: Mark, clause: string): Deixis | null {
  if (quoteRole(before, mark.quote, clause) !== 'slot') return null;
  const prevRaw = before.length ? before[before.length - 1] : '';
  const prev = norm(prevRaw);
  const next = clause.trim();
  const plural = PLURAL_VERB.has(norm(next.split(/\s+/)[0] ?? ''));
  // A quote that ends its sentence before a new one: the deictic closes the sentence as a noun.
  const ends = /[.!?]["'”’)\]]*$/.test(mark.quote.trim()) && /^["'“‘(]?\p{Lu}/u.test(next);
  const noun = NOUN[mark.kind] ?? 'marked part';
  const cap = (s: string, up: boolean) => (up ? s.replace(/^\p{Ll}/u, (c) => c.toUpperCase()) : s);
  const stop = ends ? '.' : '';
  if (possessive(prevRaw)) return { words: noun + stop, replacesPrev: false };
  const pro = ends ? `this ${noun.split(' ').pop()}` : plural ? 'these' : 'this';
  if (ARTICLES.has(prev)) return { words: cap(pro, /^[^\p{L}]*\p{Lu}/u.test(prevRaw)) + stop, replacesPrev: true };
  return { words: cap(pro, before.length === 0) + stop, replacesPrev: false };
}

/** Whether the sentence needs words at the tag (quoteRole `slot`). */
export const needsWords = (before: readonly string[], quote: string, clause: string): boolean => quoteRole(before, quote, clause) === 'slot';

/** The article a deictic replaces, with its case kept and any punctuation around it ("(The" → "(This"). */
export const replaceWord = (word: string, by: string): string => word.replace(/\p{L}+/u, by);

/** Whether a word is an article a deictic may replace. */
export const isArticle = (word: string): boolean => ARTICLES.has(norm(word));
