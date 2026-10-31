// The transcript while an answer plays (founder 2026-10-30, item 4): which sentences show, which is lit.
import { describe, it, expect } from 'vitest';
import { heardSentences, sentenceAt } from '../../src/ui/transcriptLive';

const W = ['The', 'river', 'pushes.', 'So', 'aim', 'upstream.', 'It', 'costs', 'time.'];

describe('live transcript', () => {
  it('shows the sentences heard so far, the one being spoken whole', () => {
    expect(heardSentences(W, 0)).toEqual([]);
    expect(heardSentences(W, 1).map((s) => s.words.join(' '))).toEqual(['The river pushes.']);
    expect(heardSentences(W, 4).map((s) => s.start)).toEqual([0, 3]);
    expect(heardSentences(W, 9).length).toBe(3);
    // A sentence still streaming in shows what has arrived.
    expect(heardSentences(['One.', 'Two', 'and'], 3).map((s) => s.words.join(' '))).toEqual(['One.', 'Two and']);
  });
  it('lights the sentence holding the last spoken word (a seek back moves it back)', () => {
    const ss = heardSentences(W, 9);
    expect(sentenceAt(ss, 0)).toBe(-1);
    expect(sentenceAt(ss, 1)).toBe(0);
    expect(sentenceAt(ss, 3)).toBe(0);
    expect(sentenceAt(ss, 4)).toBe(1);
    expect(sentenceAt(ss, 9)).toBe(2);
    expect(sentenceAt(ss, 4)).toBe(1);
  });
});
