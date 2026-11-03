import { describe, expect, it } from 'vitest';
import { askTarget, routeOf } from '../../src/agent/route';

describe('mid-answer routing (src/agent/route.ts)', () => {
  it('with nothing playing, Enter asks a new answer', () => {
    expect(askTarget({ playing: false, agent: true })).toBe('answer');
    expect(askTarget({ playing: false, agent: false })).toBe('answer');
  });
  it('mid-answer, an agent answer asks the scout; a dev script (no scout) opens the aside at once', () => {
    expect(askTarget({ playing: true, agent: true })).toBe('route');
    expect(askTarget({ playing: true, agent: false })).toBe('aside');
  });
  it('the scout decides; with no route it is an aside, never a guess from the words', () => {
    expect(routeOf('new')).toBe('new');
    expect(routeOf('aside')).toBe('aside');
    expect(routeOf(null)).toBe('aside');
    expect(routeOf(undefined)).toBe('aside');
  });
});
