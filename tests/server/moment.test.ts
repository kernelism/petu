// @vitest-environment node
// v1 learner UX: the moment a question is asked in (aside, about, check) as per-turn notes.
import { describe, it, expect } from 'vitest';
import { momentNotes } from '../../server/openai';
import { validateContext } from '../../server/plugin';

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
});
