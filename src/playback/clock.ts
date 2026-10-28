/** The seam where TTS word timings will plug in later. */
export interface NarrationClock {
  /** How long this word occupies before the next word starts, in ms. */
  durationMs(word: string): number;
}

const SENTENCE_END = /[.!?:]["')\]]?$/;
const CLAUSE_END = /[,;]["')\]]?$/;
const NO_LETTERS = /^[^\p{L}\p{N}]+$/u;

export class PacedClock implements NarrationClock {
  constructor(private wpm: () => number) {}
  durationMs(word: string): number {
    const base = NO_LETTERS.test(word) ? 0 : 60000 / this.wpm();
    const pause = SENTENCE_END.test(word) ? 380 : CLAUSE_END.test(word) ? 160 : 0;
    return base + pause;
  }
}

export const endsSentence = (w: string) => /[.!?]["')\]]?$/.test(w);
