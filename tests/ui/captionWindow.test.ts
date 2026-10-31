import { describe, expect, it } from 'vitest';
import { countLines, windowStart, endsClause, endsSentence, pauseCueIn, PAUSE_CUE_MS } from '../../src/ui/captionWindow';

/** Monospace: one unit per character, a space is one unit. */
const mono = (s: string) => s.length;
const tok = (s: string) => s.split(' ');
/** The window shown after every token has arrived, one at a time (the caption's own path). */
const play = (tokens: string[], width: number) => {
  let start = 0;
  const windows: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    start = windowStart(tokens, start, i, width, mono);
    windows.push(tokens.slice(start, i + 1).join(' '));
  }
  return windows;
};

describe('caption window', () => {
  it('counts wrapped lines greedily by word', () => {
    expect(countLines(tok('aaa bbb ccc'), 7, mono)).toBe(2);
    expect(countLines(tok('aaa bbb ccc'), 11, mono)).toBe(1);
    expect(countLines([], 10, mono)).toBe(0);
  });

  it('knows sentence and clause ends', () => {
    expect(endsSentence('far.')).toBe(true);
    expect(endsSentence('right?”')).toBe(true);
    expect(endsSentence('1.5')).toBe(false);
    expect(endsClause('C,')).toBe(true);
    expect(endsClause('line:')).toBe(true);
    expect(endsClause('—')).toBe(true);
    expect(endsClause('ray')).toBe(false);
  });

  it('keeps short sentences together while they fit two lines', () => {
    const w = play(tok('Here is C. And C prime.'), 20);
    expect(w.at(-1)).toBe('Here is C. And C prime.');
  });

  it('opens on the new sentence when it no longer fits, never on the tail of the last one', () => {
    const t = tok('So the real point could be anywhere along this ray. That is what back-projects to a ray means.');
    const w = play(t, 30);
    for (const s of w) expect(s.startsWith('ray.') || s.startsWith('far.')).toBe(false);
    expect(w.at(-1)!.startsWith('That is what')).toBe(true);
    for (const s of w) expect(countLines(tok(s), 30, mono)).toBeLessThanOrEqual(2);
  });

  it('breaks a long sentence at a clause boundary rather than mid-line', () => {
    const t = tok('On its own, x gives a direction from camera C, not a distance, so the real point could be anywhere.');
    const w = play(t, 30);
    const opens = [...new Set(w.map((s) => s.split(' ')[0]))];
    // Every window after the first opens right after a clause mark.
    for (const s of w.slice(1)) {
      const first = s.split(' ')[0];
      const i = t.indexOf(first);
      if (first !== 'On') expect(endsClause(t[i - 1]) || endsSentence(t[i - 1])).toBe(true);
    }
    expect(opens.length).toBeGreaterThan(1);
    for (const s of w) expect(countLines(tok(s), 30, mono)).toBeLessThanOrEqual(2);
  });

  it('falls back to a word break when a clause alone is longer than two lines', () => {
    const t = tok('aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj');
    const w = play(t, 10);
    for (const s of w) expect(countLines(tok(s), 10, mono)).toBeLessThanOrEqual(2);
  });

  it('a window only moves forward as words arrive', () => {
    const t = tok('One, two, three. Four five six seven, eight nine ten. Eleven twelve.');
    let start = 0, prev = 0;
    for (let i = 0; i < t.length; i++) {
      start = windowStart(t, start, i, 18, mono);
      expect(start).toBeGreaterThanOrEqual(prev);
      prev = start;
    }
  });

  it('a sentence that would open on the last line opens a fresh window instead', () => {
    // "aaaa bbbb cccc." fills line 1 and starts line 2 at width 10; "Next" would open on line 2.
    const t = tok('aaaa bbbb cccc dd. Next one here.');
    const w = play(t, 10);
    expect(w[4]).toBe('Next');
  });
});

describe('the one wait cue', () => {
  it('shows only after a real pause: 1 s past the last queued word, never during a sentence gap', () => {
    expect(PAUSE_CUE_MS).toBe(1000);
    // Words queued until t=4000, now t=1000: the cue may show at 4000 + 1000.
    expect(1000 + pauseCueIn(4000, 1000)).toBe(5000);
    // Everything already spoken: 1 s from now.
    expect(pauseCueIn(900, 1000)).toBe(1000);
  });
});

describe('the wait cue says where the answer is heading', () => {
  it('the plan\'s next page after the one in view, its first page off the plan, nothing when it stays here', async () => {
    const { upcomingPage } = await import('../../src/ui/RouteChip');
    expect(upcomingPage([1, 52, 55], 1)).toBe(52);
    expect(upcomingPage([52, 55], 1)).toBe(52);
    expect(upcomingPage([52], 52)).toBeNull();
    expect(upcomingPage([], 3)).toBeNull();
  });
});
