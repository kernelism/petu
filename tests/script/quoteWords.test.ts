import { describe, it, expect } from 'vitest';
import { ScriptParser } from '../../src/script/parser';
import type { ScriptEvent } from '../../src/script/types';
import { clauseAfter, deixisAt, needsWords, quoteRole } from '../../src/script/quoteWords';

// Synthetic scripts (no course text). A tag is silent: its quote is never spoken. When the sentence uses
// a page mark's tag as its noun, the engine says a deictic for what lights up ("this"), never the page's
// words; a tag that only points says nothing.

function run(chunks: string[]): ScriptEvent[] {
  const p = new ScriptParser();
  const out: ScriptEvent[] = [];
  for (const c of chunks) out.push(...p.push(c));
  out.push(...p.end());
  return out;
}
const summary = (ev: ScriptEvent[]) => ev.flatMap((e) => (e.type === 'word' ? [e.text] : e.type === 'action' ? [`<${e.action.kind}>`] : []));
const said = (s: string) => run([s]).flatMap((e) => (e.type === 'word' ? [e.text] : [])).join(' ');

describe('a mark tag used as a noun says a deictic, never its quote', () => {
  it('after an article the deictic takes its place, and the mark lands on it', () => {
    expect(summary(run(['The {{highlight p=2 "price ceiling"}} caps what landlords may charge.'])))
      .toEqual(['<highlight>', 'This', 'caps', 'what', 'landlords', 'may', 'charge.']);
    expect(said('A {{underline p=3 "competitive inhibitor"}} blocks the pocket.')).toBe('This blocks the pocket.');
    // "this" is a determiner too: a noun after the tag reads on.
    expect(said('Here the {{underline p=4 "k" near=505,342}} constant sets the stiffness.')).toBe('Here this constant sets the stiffness.');
    expect(said('The {{highlight p=9 "The slope is constant; P/Q is not."}} distinction is that slope measures units.')).toBe('This distinction is that slope measures units.');
  });

  it('a line read out verbatim, notation and all, is now a deictic (founder, bayes.pdf, 2026-11-02)', () => {
    expect(said('Start with {{highlight p=2 "Conditioning shrinks the sample space to B"}}: conditioning means we focus on a smaller group.'))
      .toBe('Start with this: conditioning means we focus on a smaller group.');
    expect(said("The page's {{highlight p=4 \"Sensitivity: P(+ | D) = 0.95\"}} means the test catches 95 percent."))
      .toBe("The page's highlighted line means the test catches 95 percent.");
    expect(said('{{highlight p=8 "Midpoint method: same answer in either direction"}} uses the average of the starting and ending values.'))
      .toBe('This uses the average of the starting and ending values.');
    expect(said('The {{highlight p=8 "Midpoint method: same answer in either direction"}} uses the average of the starting and ending values.'))
      .toBe('This uses the average of the starting and ending values.');
  });

  it('as an object, after a preposition or a verb', () => {
    expect(said('Weighting votes by {{highlight p=6 "distance to the voter"}} gives 45 instead.')).toBe('Weighting votes by this gives 45 instead.');
    expect(said('The output is {{box p=2 "F(x) + x"}} , so its slope is one.')).toBe('The output is this, so its slope is one.');
    expect(said('The lost value is called {{underline p=2 "deadweight loss"}}. It grows.')).toBe('The lost value is called this. It grows.');
  });

  it('keeps punctuation touching the tag on the deictic', () => {
    expect(said('Rent is held down by the {{highlight p=2 "price ceiling"}}, so supply falls.')).toBe('Rent is held down by this, so supply falls.');
    expect(said('Look at the {{highlight p=2 "deadweight loss"}}.')).toBe('Look at this.');
  });

  it('after a possessive, the mark as a noun; before a plural verb, "these"', () => {
    expect(said('Its {{circle p=3 "Vmax"}} stays put.')).toBe('Its circled part stays put.');
    expect(said('The {{highlight p=230 "forces between components of System 1"}} are like the forces between a horse and cart.'))
      .toBe('These are like the forces between a horse and cart.');
    expect(said('{{highlight p=6 "Range Depends on the Launch Angle"}} can be the same for different launch angles.'))
      .toBe('This can be the same for different launch angles.');
  });

  it('a quote that ends its sentence before a new one closes it (D19)', () => {
    expect(said('The {{highlight p=9 "slope is constant; P/Q is not."}} Elasticity changes because it measures percentage changes.'))
      .toBe('This line. Elasticity changes because it measures percentage changes.');
  });

  it('deixisAt depends on the word before the tag, never on the quote', () => {
    const at = (b: string[], q: string, c: string) => deixisAt(b, { kind: 'highlight', quote: q }, c);
    expect(at(['The'], 'a', ' uses it')).toEqual({ words: 'This', replacesPrev: true });
    expect(at(['The'], 'a long line: with = notation (and more)', ' uses it')).toEqual({ words: 'This', replacesPrev: true });
    expect(at(['by'], 'x', ' gives')).toEqual({ words: 'this', replacesPrev: false });
    expect(at([], 'x', ' gives')).toEqual({ words: 'This', replacesPrev: false });
    expect(at(["page's"], 'x', ' gives')).toEqual({ words: 'highlighted line', replacesPrev: false });
    expect(at(['Look', 'here'], 'x', ' and see.')).toBeNull();
  });
});

describe('quote words: nothing doubled, pointers stay silent', () => {
  it('a mark after an article fires on the article: "The price ceiling" lights as it starts', () => {
    expect(summary(run(['The {{highlight p=2 "price ceiling"}} price ceiling caps rent.']))).toEqual(['<highlight>', 'The', 'price', 'ceiling', 'caps', 'rent.']);
  });

  it('the words already said right after or right before the tag', () => {
    expect(said('The {{highlight p=2 "price ceiling"}} price ceiling caps rent.')).toBe('The price ceiling caps rent.');
    expect(said('The {{highlight p=2 "price ceiling"}}price ceiling caps rent.')).toBe('The price ceiling caps rent.');
    expect(said('The price ceiling {{highlight p=2 "price ceiling"}} caps rent.')).toBe('The price ceiling caps rent.');
    expect(said('The {{highlight p=2 "a binding price ceiling"}} ceiling caps rent.')).toBe('The ceiling caps rent.');
    expect(said('Rent stops at the {{highlight p=2 "ceiling"}} legal ceiling.')).toBe('Rent stops at the legal ceiling.');
    expect(said('The {{highlight p=12 "A Per-Unit Tax and Deadweight Loss"}} tax makes some trades stop.')).toBe('The tax makes some trades stop.');
  });

  it('a tag that opens a sentence a capitalised word starts', () => {
    expect(said('{{highlight p=3 "Photosynthesis"}} This line names the process.')).toBe('This line names the process.');
    expect(said('{{scroll p=3}} {{highlight p=3 "light reactions"}} The light reactions come first.')).toBe('The light reactions come first.');
  });

  it('a tag after a content word, a demonstrative, or before a noun phrase of its own', () => {
    expect(said('Then {{highlight p=3 "a ray in 3D"}}look here.')).toBe('Then look here.');
    expect(said('As the page shows {{highlight p=2 "deadweight loss"}}.')).toBe('As the page shows .');
    expect(said('Prices fell, and {{highlight p=2 "supply shifts right"}} the market clears.')).toBe('Prices fell, and the market clears.');
    expect(said('It settles for {{highlight p=2 "approximate solutions"}} a good guess.')).toBe('It settles for a good guess.');
    expect(said('Page 5 calls this {{highlight p=5 "marginal coverage"}}: it averages.')).toBe('Page 5 calls this : it averages.');
  });

  it('quoteRole: said, slot, pointer — the same for a word and a whole line', () => {
    for (const q of ['tax', 'the price they receive after the tax']) {
      expect(quoteRole(['The'], q, ' gap is ten.')).toBe('slot');
      expect(quoteRole(['The'], q, '.')).toBe('slot');
      expect(quoteRole([], q, ' changes the gap')).toBe('slot');
      expect(quoteRole([], q, ' The gap')).toBe('pointer');
      expect(quoteRole(['Look', 'here'], q, ' and see.')).toBe('pointer');
      expect(quoteRole(['The'], q, ' the gap')).toBe('pointer');
      expect(quoteRole(['this'], q, ' means')).toBe('pointer');
    }
    expect(quoteRole(['The'], 'price they receive after the tax', ' price they receive after the tax is lower.')).toBe('said');
  });

  it('marks without a quote, and quotes on the board, are untouched', () => {
    expect(said('The {{circle p=4 mark=#d3}} point moves.')).toBe('The point moves.');
    expect(said('The {{note p=4 "short words" annotate=#e2}} rule holds.')).toBe('The rule holds.');
  });

  it('an article before an ordinary word is said as written, whatever the chunks', () => {
    const S = 'The cat sat on the mat. A dog barked.';
    const want = summary(run([S]));
    expect(want).toEqual(['The', 'cat', 'sat', 'on', 'the', 'mat.', 'A', 'dog', 'barked.']);
    for (let i = 1; i < S.length; i++) expect(summary(run([S.slice(0, i), S.slice(i)]))).toEqual(want);
  });
});

describe('quote words: streaming', () => {
  const S = '{{highlight p=1 "photosynthesis"}} turns light into sugar. The {{highlight p=2 "price ceiling"}}, a cap, binds. The {{underline p=2 "tax"}} tax splits. Friction takes the {{highlight p=5 "energy"}}';
  const want = ['<highlight>', 'This', 'turns', 'light', 'into', 'sugar.', '<highlight>', 'This,', 'a', 'cap,', 'binds.', '<underline>', 'The', 'tax', 'splits.', 'Friction', 'takes', '<highlight>', 'this'];

  it('a deictic for a line is independent of chunk boundaries too', () => {
    const D = 'The {{highlight p=9 "slope is constant; P/Q is not."}} Elasticity changes along the line.';
    const w = summary(run([D]));
    expect(w).toEqual(['<highlight>', 'This', 'line.', 'Elasticity', 'changes', 'along', 'the', 'line.']);
    for (let i = 1; i < D.length; i++) expect(summary(run([D.slice(0, i), D.slice(i)]))).toEqual(w);
  });

  it('is independent of chunk boundaries (every split point, and 1-char streaming)', () => {
    expect(summary(run([S]))).toEqual(want);
    for (let i = 1; i < S.length; i++) expect(summary(run([S.slice(0, i), S.slice(i)]))).toEqual(want);
    expect(summary(run(S.split('')))).toEqual(want);
  });

  it('waits only for the words that decide, not the whole sentence', () => {
    const p = new ScriptParser();
    // The quote's length (2 words) and one more decide it: two words after the tag are not enough yet,
    // three are. The mark goes out with its tag; the article after it waits: the deictic may take its place.
    expect(summary(p.push('The {{highlight p=2 "price ceiling"}} caps what '))).toEqual(['<highlight>']);
    expect(summary(p.push('landlords '))).toEqual(['This', 'caps', 'what', 'landlords']);
    // An article waits only for the next word.
    expect(summary(p.push('charge the '))).toEqual(['charge']);
    expect(summary(p.push('tenant. '))).toEqual(['the', 'tenant.']);
  });

  it('clauseAfter: a clause end, enough whole words, or the end of the stream', () => {
    expect(clauseAfter(' caps rent, and', false, 3)).toBe(' caps rent,');
    expect(clauseAfter(' caps', false, 3)).toBeNull();
    expect(clauseAfter(' caps', true, 3)).toBe(' caps');
    expect(clauseAfter(' a b c d', false, 3)).toBe(' a b c');
    expect(clauseAfter('.', false, 3)).toBeNull();
    expect(clauseAfter('. Next', false, 3)).toBe('.');
  });

  it('needsWords reads only the sentence around the tag', () => {
    expect(needsWords(['The'], 'filter', ' supplies weights')).toBe(true);
    expect(needsWords([], 'filter', ' supplies weights')).toBe(true);
    expect(needsWords([], 'filter', ' The filter supplies')).toBe(false);
    expect(needsWords(['Use', 'the', 'filter'], 'filter', ' now')).toBe(false);
  });
});
