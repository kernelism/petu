import { describe, expect, it } from 'vitest';
import { beats, tokenize, units } from '../../src/gate/segment';
import { genClock, pct } from '../../scripts/gate-beats/timing';

describe('gate segment', () => {
  it('tokenizes words and tags with offsets; a tag fires with the next word', () => {
    const s = 'Take {{point on=s at=O "O"}} this point. Done.';
    const toks = tokenize(s);
    expect(toks.map((t) => (t.kind === 'word' ? t.text : `{${t.action?.kind}}`))).toEqual(['Take', '{point}', 'this', 'point.', 'Done.']);
    const tag = toks[1];
    expect(tag.kind === 'tag' && tag.at).toBe(1);
    expect(s.slice(tag.start, tag.end)).toBe('{{point on=s at=O "O"}}');
  });

  it('keeps a malformed tag as a tag with no action, and a newline-broken tag as narration', () => {
    const toks = tokenize('A {{nonsense x}} b {{line on=s\nfrom=A}} c.');
    expect(toks.filter((t) => t.kind === 'tag').map((t) => t.kind === 'tag' && t.action)).toEqual([null]);
    expect(toks.filter((t) => t.kind === 'word').map((t) => t.kind === 'word' && t.text)).toContain('{{line');
  });

  it('splits sentences; tags between sentences belong to the next one; abbreviations and decimals do not split', () => {
    const us = units('One, e.g. 0.5 here. {{sketch id=s}} {{bars on=s id=v vals=1,2}} Two words!\n\nThree.');
    expect(us.map((u) => u.text)).toEqual(['One, e.g. 0.5 here.', 'Two words!', 'Three.']);
    expect(us[1].tags.map((t) => t.action?.kind)).toEqual(['sketch', 'bars']);
    expect(us.map((u) => u.paraBefore)).toEqual([true, false, true]);
  });

  it('hybrid beats open at a paragraph or at new board ink once the beat has enough words', () => {
    const s = [
      'First sentence has quite a few words in it to pass the minimum. Second one.',
      '{{sketch id=s}} {{bars on=s id=v vals=1,2}} Here are the bars. {{bars on=s id=w vals=3 right=v}} And more bars right now, with a few more words.',
      'Closing words here to end the answer properly today.',
    ].join('\n\n');
    const bs = beats(s, { rule: 'hybrid', minWords: 12, maxWords: 45 });
    expect(bs.length).toBe(3);
    expect(bs[1].tags.map((t) => t.action?.kind)).toEqual(['sketch', 'bars', 'bars']);
    expect(beats(s, { rule: 'sentence' }).length).toBe(5);
    expect(beats(s, { rule: 'para' }).length).toBe(3);
  });

  it('maps script offsets to chunk arrival times; percentiles interpolate', () => {
    const g = genClock({ chunks: [{ t: 10, d: 'abc' }, { t: 20, d: 'de' }] });
    expect([g(1), g(3), g(4), g(5)]).toEqual([10, 10, 20, 20]);
    expect(pct([1, 2, 3, 4], 0.5)).toBe(2.5);
  });
});
