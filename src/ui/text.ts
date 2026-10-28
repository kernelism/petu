/** Display text helpers for narration (caption, transcript, screen-reader feed). */

/** A single-letter symbol followed by apostrophes is a prime: x' → x′, l'' → l″. Contractions stay ("don't", "I'm"). */
export function primes(s: string): string {
  return s.replace(/(^|[^\p{L}])(\p{L})(['’]+)(?!\p{L})/gu, (_m, pre: string, sym: string, q: string) =>
    `${pre}${sym}${q.length >= 2 ? '″' : '′'}`);
}

const SENTENCE_END = /[.?!…][”"')\]]*$/;

/**
 * Whole sentences completed in `words` since index `from`. Returns them joined for display and the
 * index where the next sentence starts. Feeds the polite live region one sentence at a time.
 */
export function takeSentences(words: string[], from: number, join: (w: string[]) => string): { sentences: string[]; from: number } {
  const sentences: string[] = [];
  let start = from;
  for (let i = from; i < words.length; i++) {
    if (SENTENCE_END.test(words[i])) {
      const s = join(words.slice(start, i + 1));
      if (s) sentences.push(s);
      start = i + 1;
    }
  }
  return { sentences, from: start };
}
