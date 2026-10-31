import { describe, expect, it } from 'vitest';
import { budgetNote, budgetOf, planBeats, scopeOf, BEAT_WORDS, CHECK_WORDS, SCOPE_BEATS, WORDS_PER_SEC, SCOPE_SECONDS } from '../../src/agent/pacing';

// Verbatim plans from live Opus p6.0 answers (runs 2026-10-29-claude-opus-low-ask-p6.0-q2-ae05d5d6{-2,-3}).
const GRAVITY = 'Distinguish the real Earth’s layered density from a uniform-density model; outer spherical shells exert no net force inside. Grow a cutaway Earth with a point moving inward: cancel the surrounding shells, shrink the enclosed sphere, then show that in a uniform model g(r)=g(surface)r/R, reaching zero at the center. Note real gravity can initially increase slightly below the surface. 1. Draw surface and inward point; 2. Cancel outer shells, mark enclosed mass; 3. Plot uniform-model strength against radius; 4. Check gravity at the center. Scope: narrow';
const SKATER = 'Distinguish conservation of angular momentum from conservation of rotational kinetic energy: internal muscle work supplies the increase. Use the skater discussion on 544–545; draw a simplified rotating platform with two 1-kg masses at 1 m, then pull them to 0.5 m, neglecting platform inertia and external torque. Compute I: 2 to 0.5 kg m²; ω: 1 to 4 rad/s; K: 1 to 4 J. Explain inward muscle force does 3 J of work against the masses’ outward tendency. 1. Arms in, inertia drops; 2. Constant momentum, spin rises; 3. Energy bars and muscle work; 4. Check energy source. Scope: standard';

describe('pacing: the plan read as a length budget', () => {
  it('reads the scope and the numbered beats, not numbers inside a beat', () => {
    expect(scopeOf(GRAVITY)).toBe('narrow');
    expect(planBeats(GRAVITY)).toEqual(['Draw surface and inward point', 'Cancel outer shells, mark enclosed mass', 'Plot uniform-model strength against radius', 'Check gravity at the center']);
    expect(planBeats(SKATER)).toEqual(['Arms in, inertia drops', 'Constant momentum, spin rises', 'Energy bars and muscle work', 'Check energy source']);
    expect(planBeats('Beats: 1 river and current; 2 drifts 180 m; 3 the triangle (3-4-5); check: a faster current. Scope: standard.')).toEqual(['river and current', 'drifts 180 m', 'the triangle (3-4-5)', 'check: a faster current']);
  });

  it('a narrow question fits 30–60 s with its opener; broad gets longer; a long opener leaves less', () => {
    const n = budgetOf(GRAVITY, 'Inside Earth, gravity generally weakens as you approach the center because less of Earth’s mass pulls you inward.')!;
    expect(n.scope).toBe('narrow');
    expect(n.beats).toBe(4);
    const total = (n.words + 18) / WORDS_PER_SEC;
    expect(total).toBeGreaterThanOrEqual(30);
    expect(total).toBeLessThanOrEqual(60);
    expect((n.capWords + 18) / WORDS_PER_SEC).toBeLessThanOrEqual(SCOPE_SECONDS.narrow.cap + 1);
    const b = budgetOf(GRAVITY.replace('narrow', 'broad'))!;
    expect(b.words).toBeGreaterThan(n.words);
    expect(budgetOf(GRAVITY, 'word '.repeat(40))!.words).toBeLessThan(budgetOf(GRAVITY)!.words);
  });

  it('keeps the plan whole: many beats shrink the words per beat to a floor, never drop beats', () => {
    const many = 'Beats: 1. a; 2. b; 3. c; 4. d; 5. e; 6. f; 7. g; 8. check. Scope: narrow';
    const b = budgetOf(many)!;
    expect(b.beats).toBe(8);
    expect(b.wordsPerBeat).toBeGreaterThanOrEqual(20);
    expect(b.words).toBeGreaterThanOrEqual(CHECK_WORDS + 7 * 20);
  });

  it('a plan with more beats than its scope holds gets BEAT_WORDS more per beat beyond, and a cap in proportion (a redo covers every part)', () => {
    const four = budgetOf('Redo. 1. a; 2. b; 3. c; 4. check. Scope: standard')!;
    const seven = budgetOf('Redo every part. 1. a; 2. b; 3. c; 4. d; 5. e; 6. f; 7. check. Scope: standard')!;
    const st = SCOPE_SECONDS.standard;
    expect(four.words).toBe(Math.round(st.target * WORDS_PER_SEC));
    expect(seven.words).toBe(Math.round(st.target * WORDS_PER_SEC) + (7 - SCOPE_BEATS.standard) * BEAT_WORDS);
    expect(seven.capWords).toBe(Math.round(st.cap * WORDS_PER_SEC) + Math.round((7 - SCOPE_BEATS.standard) * BEAT_WORDS * (st.cap / st.target)));
    // The founder's broad nine-beat redo (lec06 2026-10-31): 376 spoken words no longer cut at the last part.
    const nine = budgetOf('Beats: 1) a; 2) b; 3) c; 4) d; 5) e; 6) f; 7) g; 8) h; 9) check. Scope: broad', 'word '.repeat(35))!;
    expect(nine.capWords).toBeGreaterThanOrEqual(376 - 35);
    // A narrow plan within its scope is unchanged: the founder's 30–60 s.
    expect(budgetOf(GRAVITY)!.words).toBe(Math.round(SCOPE_SECONDS.narrow.target * WORDS_PER_SEC));
  });

  it('no plan, no budget; no scope: standard, marked as assumed', () => {
    expect(budgetOf('')).toBeNull();
    expect(budgetOf(undefined)).toBeNull();
    expect(budgetOf('walk 7, then 2, then 9; draw one figure')).toBeNull();
    const s = budgetOf('Draw the case. 1. one; 2. two; 3. check')!;
    expect(s.scope).toBe('standard');
    expect(s.stated).toBe(false);
  });

  it("stage 2's note names the beat count and words per beat", () => {
    // The tag prompt ends on its spoken check question.
    const note = budgetNote(budgetOf(GRAVITY), 'spoken');
    expect(note).toMatch(/^BUDGET \(narrow question\): after the opening, 3 teaching beats of about \d+ spoken words each, then the check question/);
    // The svg prompt (p6.2, the default): the narration ends on the takeaway; a check is hidden, never spoken.
    const svg = budgetNote(budgetOf(GRAVITY));
    expect(svg).toMatch(/^BUDGET \(narrow question\): after the opening, 3 teaching beats of about \d+ spoken words each, ending on the takeaway/);
    expect(svg).not.toMatch(/check question|\?/);
    expect(budgetNote(null)).toBe('');
  });
});
