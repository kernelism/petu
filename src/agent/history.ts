// src/agent/history.ts — the last few answers, sent with a follow-up question.
import { joinWords } from '../ui/Caption';

export type Turn = { q: string; a: string; page: number };
const KEEP = 3;

/** Narration only (the caption words as spoken, joined): tags never reach it. */
export class History {
  private turns: Turn[] = [];

  push(q: string, words: string[], page: number): void {
    const a = joinWords(words.map((w) => w.trim())).trim();
    if (!a) return;
    this.turns = [...this.turns, { q, a, page }].slice(-KEEP);
  }

  /** Oldest first, at most 3. */
  last(): Turn[] { return this.turns.map((t) => ({ ...t })); }

  reset(): void { this.turns = []; }
}
