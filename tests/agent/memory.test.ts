import { describe, it, expect } from 'vitest';
import { SessionMemory, recordOf, boardOf, claimsOf, narrationOf, readTag, entryText, FULL_TURNS, REVISIONS, isRelation } from '../../src/agent/context/memory';

const SCRIPT = `The rate drops because the blocker takes seats. {{scroll p=4}} {{highlight p=4 "Km rises"}}

{{scene id=s near=p4}} {{const V=10 K=2}} Take {{node on=s id=e "enzyme"}} one enzyme with {{node on=s id=sub "substrate" right=e}} a substrate waiting.
{{link on=s from=sub to=e "binds"}} It binds the pocket. <plan>private</plan>

{{plot on=s id=v fn="V*x/(K+x)" domain=0,20 "no blocker"}} Here is the rate without it. {{set id=e "enzyme + blocker"}} Now add the blocker.

What happens to the top speed when the substrate is huge?`;

describe('session record', () => {
  it('reads a tag: kind, key=value (quoted values too), quotes and flags', () => {
    expect(readTag('plot on=s id=v fn="V*x/(K+x)" domain=0,20 "no blocker" em')).toEqual({ kind: 'plot', args: { on: 's', id: 'v', fn: 'V*x/(K+x)', domain: '0,20' }, quotes: ['no blocker'], flags: ['em'] });
  });

  it('keeps the board as data: sections, things with id/kind/label/data/what they were drawn on, constants, changes; no page marks', () => {
    const b = boardOf(SCRIPT);
    expect(b.sections).toEqual([{ id: 's', kind: 'scene', near: 'p4' }]);
    expect(b.constants).toEqual(['V=10', 'K=2']);
    expect(b.things.map((x) => `${x.kind} ${x.id}`)).toEqual(['node e', 'node sub', 'link undefined', 'plot v']);
    expect(b.things[0]).toEqual({ kind: 'node', id: 'e', on: 's', label: 'enzyme', means: 'one enzyme with a substrate waiting.' });
    expect(b.things[3].data).toBe('fn=V*x/(K+x) domain=0,20');
    expect(b.changes).toEqual(['set e "enzyme + blocker"']);
  });

  it('keeps the claims (a beat\'s first sentence) and the closing check question; narration has no tags or plan', () => {
    expect(narrationOf(SCRIPT)).not.toMatch(/\{\{|private/);
    const c = claimsOf(SCRIPT);
    expect(c.check).toBe('What happens to the top speed when the substrate is huge?');
    expect(c.claims[0]).toBe('The rate drops because the blocker takes seats.');
    expect(c.claims).not.toContain(c.check);
  });

  it('a record carries question, pages (visible first, once), relation and the plan', () => {
    const r = recordOf({ question: 'improve the drawing', page: 4, pages: [4, 3], plan: 'Draw seats.', script: SCRIPT, relation: 'revise-representation' });
    expect(r.pages).toEqual([4, 3]);
    expect(r.relation).toBe('revise-representation');
    expect(r.plan).toBe('Draw seats.');
  });

  it('relations: the revision kinds, and a guard', () => {
    expect([...REVISIONS].sort()).toEqual(['deeper', 'new-example', 'revise-representation', 'simplify']);
    expect(isRelation('simplify')).toBe(true);
    expect(isRelation('eli5')).toBe(false);
  });
});

describe('MEMORY block', () => {
  it('is empty before the first answer; lists each answer with its plan, board, constants, claims and check', () => {
    const m = new SessionMemory();
    expect(m.text()).toBe('');
    m.add(recordOf({ question: 'How does it change the rate?', page: 4, pages: [4], plan: 'Two curves.', script: SCRIPT }));
    const t = m.text();
    expect(t.split('\n')[0]).toMatch(/^MEMORY \(/);
    expect(t).toContain('A1 (on p4) "How does it change the rate?" → taught p4');
    expect(t).toContain('  plan: Two curves.');
    expect(t).toContain('board (scene s near p4): node e "enzyme" (said: one enzyme with a substrate waiting.)');
    expect(t).toContain('plot v "no blocker" [fn=V*x/(K+x) domain=0,20]');
    expect(t).toContain('  constants: V=10 K=2');
    expect(t).toContain('  asked: What happens to the top speed when the substrate is huge?');
    m.add(recordOf({ question: 'simpler', page: 4, pages: [4], plan: 'A queue.', script: 'Think of chairs.', relation: 'simplify' }));
    expect(m.text()).toContain('A2 (on p4; simplify of A1) "simpler"');
    expect(m.last()?.question).toBe('simpler');
  });

  it('a thread keeps its question: a complaint about a derailed follow-up is still on the first question; the parts line carries what was covered and left', () => {
    const m = new SessionMemory();
    m.add(recordOf({ question: 'explain every filter here', page: 1, pages: [4, 22, 33], plan: 'Five filters.', script: 'Box, then median.',
      answerPlan: 'the case: a row of pixels\nparts: box, Gaussian, median, sharpening, derivative; covered here: box, Gaussian, median; left: sharpening, derivative\nBOARD viewBox="0 0 1000 700"\ngroups: row; box' }));
    m.add(recordOf({ question: 'not good enough', page: 613, pages: [613], plan: 'Strips.', script: 'Paper strips.', relation: 'simplify' }));
    m.add(recordOf({ question: 'that is not complete, right?', page: 13, pages: [13], plan: 'More.', script: 'The ball.', relation: 'continue' }));
    const t = m.text();
    expect(t).toContain('  parts: box, Gaussian, median, sharpening, derivative; covered here: box, Gaussian, median; left: sharpening, derivative');
    expect(t).toContain('A2 (on p613; simplify of A1) "not good enough"');
    expect(t).toContain("A3 (on p13; continue of A2; still on A1's question) \"that is not complete, right?\"");
    expect(t).toMatch(/which question its thread is still on/);
    // A new topic opens a new thread; its follow-up names no older root.
    m.add(recordOf({ question: 'what is a homography?', page: 50, pages: [50], plan: '', script: 'A map.', relation: 'new-topic' }));
    m.add(recordOf({ question: 'simpler', page: 50, pages: [50], plan: '', script: 'A sheet.', relation: 'simplify' }));
    expect(m.text()).toContain('A5 (on p50; simplify of A4) "simpler"');
    expect(m.text()).not.toContain("A5 (on p50; simplify of A4; still on");
    // A question longer than the old clip is kept whole (the scout must read the whole thread question).
    const long = 'can you explain different filtering techniques mentioned. I think some aren\'t here too. can you go in depth on multiple different such filtering / convolution techniques';
    expect(entryText(1, recordOf({ question: long, page: 1, pages: [1], plan: '', script: 'x.' }))).toContain(`"${long}"`);
  });

  it('is append-only, and past FULL_TURNS rolls the oldest half into one line each', () => {
    const m = new SessionMemory();
    m.add(recordOf({ question: 'q1', page: 1, pages: [], plan: '', script: 'One.' }));
    const one = m.text();
    m.add(recordOf({ question: 'q2', page: 2, pages: [], plan: '', script: 'Two.' }));
    expect(m.text().startsWith(one)).toBe(true);
    for (let i = 3; i <= FULL_TURNS + 1; i++) m.add(recordOf({ question: `q${i}`, page: i, pages: [], plan: '', script: `{{sketch id=k${i} near=p${i}}} {{bars on=k${i} id=b vals=1,2}} x.` }));
    const lines = m.text().split('\n');
    expect(lines[1]).toBe('earlier, in short:');
    expect(lines[2]).toBe('  A1 (p1) "q1" → p1');
    expect(lines.some((l) => l.startsWith(`A${FULL_TURNS + 1} (on p${FULL_TURNS + 1})`))).toBe(true);
    expect(lines.filter((l) => /^A\d/.test(l))).toHaveLength(FULL_TURNS / 2 + 1);
    m.reset();
    expect(m.text()).toBe('');
  });
});
