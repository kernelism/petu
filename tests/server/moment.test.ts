// @vitest-environment node
// v1 learner UX: the moment a question is asked in (aside, about, check) as per-turn notes.
import { describe, it, expect } from 'vitest';
import { momentNotes } from '../../server/openai';
import { validateContext, validateScout } from '../../server/plugin';

describe('moment notes', () => {
  it('the server turns the moment into short notes, and validates their size', () => {
    expect(momentNotes({})).toEqual([]);
    const n = momentNotes({ aside: 'A', about: 'B', check: 'What would buyers pay?' });
    expect(n).toHaveLength(3);
    expect(n[0]).toMatch(/^ASIDE: /);
    expect(n[2]).toContain('"What would buyers pay?"');
    const c = { docName: 'd', docHash: 'h', numPages: 2, page: 1, docText: 'x', pageText: 'y', image: { b64: 'a', w: 1, h: 1 } };
    expect(validateContext({ ...c, aside: 'paused' })).toBeNull();
    expect(validateContext({ ...c, check: 'x'.repeat(5000) })).toMatch(/context.check/);
  });
  it('a question that replaces the playing answer tells stage 2 what the student heard of it, and not to resume it', () => {
    const [n] = momentNotes({ replaced: 'The paused answer was to: "Why?"\nSaid so far: "First"' });
    expect(n).toMatch(/^REPLACED: the student stopped your previous answer part-way/);
    expect(n).toMatch(/do not finish, resume or repeat/);
    expect(n.endsWith('Said so far: "First"')).toBe(true);
    const c = { docName: 'd', docHash: 'h', numPages: 2, page: 1, docText: 'x', pageText: 'y', image: { b64: 'a', w: 1, h: 1 } };
    expect(validateContext({ ...c, replaced: 'r' })).toBeNull();
    expect(validateContext({ ...c, replaced: 'x'.repeat(13_000) })).toMatch(/context.replaced/);
  });
});

describe('validateScout: the moment (C5: the scout hears a check reply and what was pointed at)', () => {
  const base = { question: 'q', docName: 'd', docHash: 'h', numPages: 20, page: 3, digest: 'D' };
  it('accepts a check with its page and an about string; refuses a malformed one', () => {
    expect(validateScout({ ...base, check: { q: 'Why?', page: 12 }, about: 'x' })).toBeNull();
    expect(validateScout({ ...base, check: { q: 'What happens if the rate doubles?', page: 12 } })).toBeNull();
    expect(validateScout({ ...base, check: 'Why?' })).toMatch(/check must be/);
    expect(validateScout({ ...base, check: { q: 'Why?', page: 21 } })).toMatch(/check must be/);
    expect(validateScout({ ...base, about: 'x'.repeat(5000) })).toMatch(/about must be/);
    expect(validateScout({ ...base, paused: 'The paused answer was to: "q"' })).toBeNull();
    expect(validateScout({ ...base, paused: 'x'.repeat(13_000) })).toMatch(/paused must be/);
  });
});
