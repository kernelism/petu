// @vitest-environment jsdom
// A value is said as the board shows it (founder, OpenStax rent ceiling, 2026-11-02: heard "the curves meet
// at a rent of 10 and 100" beside a board showing "$10" and "100 units"; "the ceiling line is 6" beside
// "$6"). The cause was two formatting paths: the board drew the readout's template ("${}", "{} units"),
// {{val}} said its bare number. Now one reader (src/values/quantity.ts readTemplate) splits a template
// around its quantity, the board draws with it and {{val}} says it, never doubling an affix the
// narration writes itself; the number check reads a narration number's unit with the same rule ("$10").
import { describe, expect, it } from 'vitest';
import { drawText, readTemplate, unitSaid } from '../../src/values/quantity';
import { spokenOf } from '../../src/values/say';
import { ScriptParser } from '../../src/script/parser';
import { GateState } from '../../src/gate/engine';
import { boardNumbers } from '../../src/gate/check';
import { tokenize, type Word } from '../../src/gate/segment';
import { newScope, resolveData } from '../../src/svgboard/data';
import { parseGroup } from '../../src/svgboard/sanitize';
import type { RawAction, ValAction } from '../../src/script/types';

// The OpenStax rent-control board's shape (eval D10 / founder session): price in dollars, quantity in units.
const RENT = '<g id="rent" data-const="a=20 b=0.1 c=2 d=0.08 pe=(a-c)/(b+d) qe=a-b*pe ceil=6 qs=c+d*ceil qd=a-b*ceil">'
  + '<text id="pe" x="20" y="40" font-size="16" data-val="(a-c)/(b+d)/10" data-fmt="0">rent ${}</text>'
  + '<text id="qe" x="20" y="60" font-size="16" data-val="100" data-fmt="0">{} units</text>'
  + '<text id="ceil" x="20" y="80" font-size="16" data-val="ceil" data-fmt="0">ceiling ${}</text>'
  + '<text id="dp" x="20" y="100" font-size="16" data-val="1" data-fmt="0">price −${}</text>'
  + '<text id="share" x="20" y="120" font-size="16" data-val="12" data-fmt="0">+{}%</text>'
  + '<text id="el" x="20" y="140" font-size="16" data-val="1.4" data-fmt="1">{} elastic</text></g>';

const play = (text: string, chunk = 0) => {
  const p = new ScriptParser();
  const src = `{{svg ${RENT}}} ${text}`;
  const evs = chunk ? [...Array.from({ length: Math.ceil(src.length / chunk) }, (_, i) => p.push(src.slice(i * chunk, (i + 1) * chunk))).flat(), ...p.end()] : [...p.push(src), ...p.end()];
  const vals = evs.flatMap((e) => (e.type === 'action' && e.action.kind === 'val' ? [e.action as ValAction] : []));
  return { words: evs.flatMap((e) => (e.type === 'word' ? [e.text] : [])).join(' '), said: vals.map((v) => v.said), spoken: vals.map((v) => v.spoken) };
};

describe('readTemplate: what of a readout\'s text is its quantity', () => {
  const cases: [string, string, string, string | undefined][] = [
    // template, pre, post, unit
    ['${}', '$', '', '$'],
    ['price ${}', '$', '', '$'],
    ['price −${}', '$', '', '$'], // a sign is wording about direction, not the value's
    ['{} units', '', ' units', 'units'],
    ['{}%', '', '%', '%'],
    ['+{}%', '', '%', '%'],
    ['5 is {}% of Q', '', '%', '%'],
    ['lands {} m downstream', '', ' m', 'm'],
    ['30°: {} s', '', ' s', 's'],
    ['{} metres a second', '', ' metres a second', 'm/s'],
    ['{} elastic', '', ' elastic', undefined], // the board writes it: said as written
    ['Midpoint elasticity: {} both ways', '', '', undefined],
    ['E={}', '', '', undefined],
    ['[S] = {}', '', '', undefined],
    ['×{}', '×', '', undefined],
    ['({} m)', '', ' m', 'm'],
  ];
  for (const [tpl, pre, post, unit] of cases) {
    it(`"${tpl}"`, () => {
      const t = readTemplate(tpl);
      expect({ pre: t.pre, post: t.post, unit: t.unit }).toEqual({ pre, post, unit });
      // What the board draws is still exactly its template with the number in it.
      expect(drawText('7', t)).toBe(tpl.replace('{}', '7'));
    });
  }
  it('a bare data-val with a data-unit: the unit on its side ("$10", "12%", "5 min")', () => {
    expect(drawText('10', readTemplate(null, '$'))).toBe('$10');
    expect(drawText('12', readTemplate('', '%'))).toBe('12%');
    expect(drawText('5', readTemplate(null, 'min'))).toBe('5 min');
    expect(drawText('5', readTemplate(null, null))).toBe('5');
  });
});

describe('spoken naturally', () => {
  it('a currency after the number, a unit in words, singular at one', () => {
    expect(spokenOf({ num: '6', pre: '$', post: '' })).toBe('six dollars');
    expect(spokenOf({ num: '1', pre: '$', post: '' })).toBe('one dollar');
    expect(spokenOf({ num: '100', pre: '', post: ' units' })).toBe('one hundred units');
    expect(spokenOf({ num: '12', pre: '', post: '%' })).toBe('twelve percent');
    expect(spokenOf({ num: '2.0', pre: '', post: ' m/s' })).toBe('two point zero metres per second');
    expect(spokenOf({ num: '1.4', pre: '', post: ' elastic' })).toBe('one point four elastic');
    expect(spokenOf({ num: '3', pre: '×', post: '' })).toBe('times three');
  });
});

describe('{{val}} says the board\'s quantity (economics transcript shapes)', () => {
  it('the founder\'s sentences: "$10 and 100 units", "the ceiling line is $6"', () => {
    const r = play('The curves meet at a rent of {{val id=pe}} and {{val id=qe}}. The ceiling line is {{val id=ceil}}.');
    expect(r.words).toBe('The curves meet at a rent of $10 and 100 units. The ceiling line is $6.');
    expect(r.spoken).toEqual(['ten dollars', 'one hundred units', 'six dollars']);
  });

  it('never doubles an affix the narration writes itself, on either side', () => {
    expect(play('A rent of ${{val id=pe}}.').words).toBe('A rent of $10.');
    expect(play('A rent of {{val id=pe}} dollars a month.').words).toBe('A rent of 10 dollars a month.');
    expect(play('Some {{val id=qe}} units of housing.').words).toBe('Some 100 units of housing.');
    expect(play('A share of {{val id=share}} percent.').words).toBe('A share of 12 percent.');
    expect(play('A share of {{val id=share}}%.').words).toBe('A share of 12%.');
    expect(play('A share of {{val id=share}}, then more.').words).toBe('A share of 12%, then more.');
  });

  it('a sign in the template is not said: "falls by $1", never "falls by minus one dollar"', () => {
    const r = play('The price falls by {{val id=dp}} and the quantity rises.');
    expect(r.words).toBe('The price falls by $1 and the quantity rises.');
    expect(r.spoken).toEqual(['one dollar']);
  });

  it('a word the board writes after the number is said with it', () => {
    expect(play('That gives {{val id=el}} here.').words).toBe('That gives 1.4 elastic here.');
  });

  it('chunk-independent: the same words however the stream is cut', () => {
    const t = 'The curves meet at a rent of {{val id=pe}} and {{val id=qe}} units, and ${{val id=ceil}} below.';
    const whole = play(t).words;
    expect(whole).toBe('The curves meet at a rent of $10 and 100 units, and $6 below.');
    for (const n of [1, 2, 3, 7, 13]) expect(play(t, n).words, `chunk ${n}`).toBe(whole);
  });

});

describe('the board draws the same quantity it says', () => {
  it('resolveData writes the template\'s text and hands {{val}} its affixes', () => {
    const sc = newScope();
    const g = parseGroup(RENT);
    if (typeof g === 'string') throw new Error(g);
    resolveData(g, sc);
    expect(g.querySelector('#pe')!.textContent).toBe('rent $10');
    expect(g.querySelector('#qe')!.textContent).toBe('100 units');
    expect(sc.values.find((v) => v.id === 'pe')).toMatchObject({ text: '10', affix: { pre: '$', post: '' }, unit: '$' });
  });
});

describe('the number check reads a unit written before the number', () => {
  it('unitSaid: "$10" is in dollars, like "10 dollars"; "12%" in percent', () => {
    expect(unitSaid(['a', 'rent', 'of', '$10.'], 3, 3)).toBe('$');
    expect(unitSaid(['(€5)'], 0, 0)).toBe('€');
    expect(unitSaid(['10', 'dollars'], 0, 0)).toBe('$');
    expect(unitSaid(['5m'], 0, 0)).toBe('m');
    expect(unitSaid(['−$3'], 0, 0)).toBe('$');
    expect(unitSaid(['10', 'apples'], 0, 0)).toBeUndefined();
  });

  it('a dollar amount is never rewritten into a quantity readout close to it', () => {
    const s = new GateState();
    s.apply({ kind: 'svg', svg: '<g data-const="q=100"><text id="quantity" x="20" y="40" font-size="16" data-val="q" data-fmt="0">quantity {} units</text></g>' } as RawAction, 0);
    const ws = tokenize('The quantity costs $104 in all.').filter((x): x is Word => x.kind === 'word');
    const r = boardNumbers(ws, s.values, 0);
    expect(r.fixes).toEqual([]);
    expect(r.flags).toEqual([]);
    // Said in its unit, the same number is that readout said off: a fix to the board's.
    expect(boardNumbers(tokenize('The quantity is 104 units.').filter((x): x is Word => x.kind === 'word'), s.values, 0).fixes).toMatchObject([{ from: '104', to: '100' }]);
  });
});
