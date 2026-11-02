import { describe, it, expect } from 'vitest';
import { ScriptParser } from '../../src/script/parser';
import type { ScriptEvent } from '../../src/script/types';
import { clauseAfter, needsWords, quoteRole } from '../../src/script/quoteWords';

// Synthetic scripts (no course text): a quote tag the model uses as a word of its sentence is spoken
// at the tag, so the mark lands as its words are said; a tag that only points speaks nothing.

function run(chunks: string[]): ScriptEvent[] {
  const p = new ScriptParser();
  const out: ScriptEvent[] = [];
  for (const c of chunks) out.push(...p.push(c));
  out.push(...p.end());
  return out;
}
const summary = (ev: ScriptEvent[]) => ev.flatMap((e) => (e.type === 'word' ? [e.text] : e.type === 'action' ? [`<${e.action.kind}>`] : []));
const said = (s: string) => run([s]).flatMap((e) => (e.type === 'word' ? [e.text] : [])).join(' ');

describe('quote words: a mark tag used as a noun is spoken', () => {
  it('after an article, the mark landing on its first word', () => {
    expect(summary(run(['The {{highlight p=2 "price ceiling"}} caps what landlords may charge.'])))
      .toEqual(['The', '<highlight>', 'price', 'ceiling', 'caps', 'what', 'landlords', 'may', 'charge.']);
    expect(said('A {{underline p=3 "competitive inhibitor"}} blocks the pocket.')).toBe('A competitive inhibitor blocks the pocket.');
  });

  it('as an object, and after a preposition', () => {
    expect(said('Friction takes the {{highlight p=5 "energy"}} that motion carries.')).toBe('Friction takes the energy that motion carries.');
    expect(said('Weighting votes by {{highlight p=6 "distance to the voter"}} gives 45 instead.')).toBe('Weighting votes by distance to the voter gives 45 instead.');
    expect(said('The output is {{box p=2 "F(x) + x"}} , so its slope is one.')).toBe('The output is F(x) + x, so its slope is one.');
  });

  it('opening a sentence: capitalised, the subject it stands for', () => {
    expect(said('{{highlight p=1 "photosynthesis"}} turns light into sugar.')).toBe('Photosynthesis turns light into sugar.');
    expect(said('Plants grow. {{highlight p=1 "photosynthesis"}} turns light into sugar.')).toBe('Plants grow. Photosynthesis turns light into sugar.');
  });

  it('keeps punctuation touching the tag on the spoken words', () => {
    expect(said('Rent is held down by the {{highlight p=2 "price ceiling"}}, so supply falls.')).toBe('Rent is held down by the price ceiling, so supply falls.');
    expect(said('Look at the {{highlight p=2 "deadweight loss"}}.')).toBe('Look at the deadweight loss.');
    expect(said('The lost value is called {{underline p=2 "deadweight loss"}}. It grows.')).toBe('The lost value is called deadweight loss. It grows.');
  });

  it('near= and one-letter quotes', () => {
    expect(said('Here the {{underline p=4 "k" near=505,342}} constant sets the stiffness.')).toBe('Here the k constant sets the stiffness.');
    expect(said('The {{circle p=4 "Vmax" near=120,300}} stays put.')).toBe('The Vmax stays put.');
  });
});

describe('quote words: nothing doubled, pointers stay silent', () => {
  it('the words already said right after or right before the tag', () => {
    expect(said('The {{highlight p=2 "price ceiling"}} price ceiling caps rent.')).toBe('The price ceiling caps rent.');
    expect(said('The {{highlight p=2 "price ceiling"}}price ceiling caps rent.')).toBe('The price ceiling caps rent.');
    expect(said('The price ceiling {{highlight p=2 "price ceiling"}} caps rent.')).toBe('The price ceiling caps rent.');
    expect(said('The {{highlight p=2 "a binding price ceiling"}} ceiling caps rent.')).toBe('The ceiling caps rent.');
    expect(said('Rent stops at the {{highlight p=2 "ceiling"}} legal ceiling.')).toBe('Rent stops at the legal ceiling.');
  });

  it('a tag that opens a sentence a capitalised word starts', () => {
    expect(said('{{highlight p=3 "Photosynthesis"}} This line names the process.')).toBe('This line names the process.');
    expect(said('{{scroll p=3}} {{highlight p=3 "light reactions"}} The light reactions come first.')).toBe('The light reactions come first.');
  });

  it('a tag after a content word, or before a noun phrase of its own', () => {
    expect(said('Then {{highlight p=3 "a ray in 3D"}}look here.')).toBe('Then look here.');
    expect(said('As the page shows {{highlight p=2 "deadweight loss"}}.')).toBe('As the page shows .');
    expect(said('Prices fell, and {{highlight p=2 "supply shifts right"}} the market clears.')).toBe('Prices fell, and the market clears.');
    expect(said('It settles for {{highlight p=2 "approximate solutions"}} a good guess.')).toBe('It settles for a good guess.');
  });

  it('a long quote (a line pointed at) is never spoken', () => {
    expect(said('The {{highlight p=2 "the price they receive after the tax"}} gap is ten.')).toBe('The gap is ten.');
  });

  it('a long quote is spoken only where the sentence certainly lacks it (diag C8, D19)', () => {
    // D19 (eval 2026-10-30, p6.1): heard as "The Elasticity changes…". The quote ends a sentence and a new one follows.
    expect(said('The {{highlight p=9 "slope is constant; P/Q is not."}} Elasticity changes because it measures percentage changes.'))
      .toBe('The slope is constant; P/Q is not. Elasticity changes because it measures percentage changes.');
    // Nothing of the clause follows the tag: the slot is empty.
    expect(said('Look at the {{highlight p=2 "price they receive after the tax"}}.')).toBe('Look at the price they receive after the tax.');
    expect(said('The gap is set by the {{highlight p=2 "price they receive after the tax"}}, so it is ten.')).toBe('The gap is set by the price they receive after the tax, so it is ten.');
    // A capitalised word after a quote that does not end a sentence may be a name continuing it: not spoken.
    expect(said('Use the {{highlight p=2 "integral of the signal over time"}} Fourier transform.')).toBe('Use the Fourier transform.');
  });

  it('a long quote that opens the sentence, or sits before its verb, is its subject (eval 2026-11-02, p6.13)', () => {
    // Heard without its subject while the gate stripped the highlight: the first page mark came 14-19 s in.
    expect(said('{{highlight p=8 "Midpoint method: same answer in either direction"}} uses the average of the starting and ending values as the base.'))
      .toBe('Midpoint method: same answer in either direction uses the average of the starting and ending values as the base.');
    expect(said('{{highlight p=12 "A Per-Unit Tax and Deadweight Loss"}} shows the lost gains from trades that no longer happen.'))
      .toBe('A Per-Unit Tax and Deadweight Loss shows the lost gains from trades that no longer happen.');
    expect(said('{{highlight p=4 "The inhibitor competes for the active site"}} describes why competitive inhibition changes the reaction rate.'))
      .toBe('The inhibitor competes for the active site describes why competitive inhibition changes the reaction rate.');
    expect(said('{{highlight p=6 "Range Depends on the Launch Angle"}} can be the same for different launch angles.'))
      .toBe('Range Depends on the Launch Angle can be the same for different launch angles.');
    expect(said('The {{highlight p=230 "forces between components of System 1"}} are like the forces between a horse and cart.'))
      .toBe('The forces between components of System 1 are like the forces between a horse and cart.');
    expect(said('The {{highlight p=8 "Midpoint method: same answer in either direction"}} uses the average of the starting and ending values as its baseline.'))
      .toBe('The Midpoint method: same answer in either direction uses the average of the starting and ending values as its baseline.');
    expect(said('The {{highlight p=9 "The slope is constant; P/Q is not."}} is what the page says.')).toBe('The slope is constant; P/Q is not is what the page says.');
  });

  it('a long quote before a word that may fill its slot points: its mark plays, nothing is spoken (D19)', () => {
    expect(summary(run(['The {{highlight p=9 "The slope is constant; P/Q is not."}} distinction is that slope measures units.'])))
      .toEqual(['The', '<highlight>', 'distinction', 'is', 'that', 'slope', 'measures', 'units.']);
  });

  it('quoteRole: said, speak, pointer', () => {
    const long = 'the price they receive after the tax';
    expect(quoteRole(['The'], long, ' gap is ten.')).toBe('pointer');
    expect(quoteRole(['The'], long, '.')).toBe('speak');
    expect(quoteRole(['The'], long, ' is lower.')).toBe('speak');
    expect(quoteRole(['The'], 'slope is constant; P/Q is not.', ' Elasticity changes')).toBe('speak');
    expect(quoteRole(['The'], 'slope is constant; P/Q is not', ' Elasticity changes')).toBe('pointer');
    expect(quoteRole([], long, ' changes the gap')).toBe('speak');
    expect(quoteRole([], long, ' The gap')).toBe('pointer');
    expect(quoteRole(['Look', 'here'], long, ' and see.')).toBe('pointer');
    expect(quoteRole(['The'], long, ' the gap')).toBe('pointer');
    expect(quoteRole(['The'], long, ' price they receive after the tax is lower.')).toBe('said');
    expect(quoteRole(['The'], 'price ceiling', ' caps rent')).toBe('speak');
  });

  it('marks without a quote, and quotes on the board, are untouched', () => {
    expect(said('The {{circle p=4 mark=#d3}} point moves.')).toBe('The point moves.');
    expect(said('The {{note p=4 "short words" annotate=#e2}} rule holds.')).toBe('The rule holds.');
  });
});

describe('quote words: streaming', () => {
  const S = '{{highlight p=1 "photosynthesis"}} turns light into sugar. The {{highlight p=2 "price ceiling"}}, a cap, binds. The {{underline p=2 "tax"}} tax splits. Friction takes the {{highlight p=5 "energy"}}';
  const want = ['<highlight>', 'Photosynthesis', 'turns', 'light', 'into', 'sugar.', 'The', '<highlight>', 'price', 'ceiling,', 'a', 'cap,', 'binds.', 'The', '<underline>', 'tax', 'splits.', 'Friction', 'takes', 'the', '<highlight>', 'energy'];

  it('a spoken long quote is independent of chunk boundaries too', () => {
    const D = 'The {{highlight p=9 "slope is constant; P/Q is not."}} Elasticity changes along the line.';
    const w = summary(run([D]));
    expect(w).toEqual(['The', '<highlight>', 'slope', 'is', 'constant;', 'P/Q', 'is', 'not.', 'Elasticity', 'changes', 'along', 'the', 'line.']);
    for (let i = 1; i < D.length; i++) expect(summary(run([D.slice(0, i), D.slice(i)]))).toEqual(w);
  });

  it('is independent of chunk boundaries (every split point, and 1-char streaming)', () => {
    expect(summary(run([S]))).toEqual(want);
    for (let i = 1; i < S.length; i++) expect(summary(run([S.slice(0, i), S.slice(i)]))).toEqual(want);
    expect(summary(run(S.split('')))).toEqual(want);
  });

  it('waits only for the words that decide, not the whole sentence', () => {
    const p = new ScriptParser();
    // The quote's length (2 words) and one more decide it: two words after the tag are not enough yet, three are.
    expect(summary(p.push('The {{highlight p=2 "price ceiling"}} caps what '))).toEqual(['The', '<highlight>']);
    expect(summary(p.push('landlords '))).toEqual(['price', 'ceiling', 'caps', 'what', 'landlords']);
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
