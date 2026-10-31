// src/ui/transcriptLive.ts — the transcript while an answer plays (founder 2026-10-30, item 4). Pure.
import { endsSentence } from '../playback/clock';

/** One sentence of the narration: its first word (a seek target) and its words. */
export type TranscriptSentence = { start: number; words: string[] };

/** The transcript as it stands mid-answer: what has been heard, and the sentence being spoken. */
export type LiveTranscript = {
  question: string;
  sentences: TranscriptSentence[];
  /** Index into `sentences` of the one being spoken (or last spoken); -1 before the first word. */
  current: number;
  /** Click a sentence: the narration plays on from its first word. */
  onSeek(word: number): void;
};

/**
 * The sentences heard so far: every sentence that starts before `heard` (the furthest word reached this
 * answer, so a seek back keeps what was already heard), the one being spoken whole (its words may still
 * be ahead of the voice).
 */
export function heardSentences(words: string[], heard: number): TranscriptSentence[] {
  const out: TranscriptSentence[] = [];
  let start = 0;
  for (let i = 0; i < words.length && start < heard; i++) {
    if (endsSentence(words[i]) || i === words.length - 1) {
      out.push({ start, words: words.slice(start, i + 1) });
      start = i + 1;
    }
  }
  return out;
}

/** The sentence holding the word last spoken (`pos` = words spoken so far). */
export function sentenceAt(sentences: TranscriptSentence[], pos: number): number {
  if (pos <= 0 || !sentences.length) return -1;
  const w = pos - 1;
  let k = 0;
  while (k + 1 < sentences.length && sentences[k + 1].start <= w) k++;
  return k;
}
