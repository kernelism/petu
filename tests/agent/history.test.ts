import { describe, expect, it } from 'vitest';
import { History } from '../../src/agent/history';

describe('History', () => {
  it('stores the narration as spoken (caption words, joined), oldest first', () => {
    const h = new History();
    h.push('Why is x′ on this line?', ['The', 'match', 'for', 'x', 'lies', 'on', "l'", '.'], 3);
    expect(h.last()).toEqual([{ q: 'Why is x′ on this line?', a: 'The match for x lies on l′.', page: 3 }]);
  });

  it('keeps the last 3: the 4th push evicts the oldest', () => {
    const h = new History();
    for (const i of [1, 2, 3, 4]) h.push(`q${i}`, [`a${i}`], i);
    expect(h.last().map((x) => x.q)).toEqual(['q2', 'q3', 'q4']);
  });

  it('never stores tags (caption words have none) and skips empty answers', () => {
    const h = new History();
    h.push('q', [], 1);
    h.push('q', ['', ' '], 1);
    expect(h.last()).toEqual([]);
    h.push('q', ['Look', 'here.'], 2);
    expect(h.last()[0].a).not.toMatch(/\{\{|\}\}/);
  });

  it('reset() empties it (a new document)', () => {
    const h = new History();
    h.push('q', ['a'], 1);
    h.reset();
    expect(h.last()).toEqual([]);
  });

  it('last() returns a copy', () => {
    const h = new History();
    h.push('q', ['a'], 1);
    h.last().pop();
    expect(h.last()).toHaveLength(1);
  });
});
