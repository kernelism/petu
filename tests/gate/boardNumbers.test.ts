// @vitest-environment jsdom
// Spoken numbers held to the svg board's readouts (check.ts boardNumbers; C4, 2026-10-31). A number close
// to a readout is that readout: said right it passes, said a little off it is said as the board's (one
// clear candidate), and off by more, or ambiguous, the beat fails (drift) instead of passing with a note.
import { describe, expect, it } from 'vitest';
import { GateState } from '../../src/gate/engine';
import { boardNumbers, checkNumbers, derivedValues, numberFixes } from '../../src/gate/check';
import { checkBeat, withSeverity } from '../../src/gate/verdict';
import { tokenize, type Word } from '../../src/gate/segment';
import { textNumbers } from '../../src/gate/numbers';
import { GatePreflight, LiveGate } from '../../src/gate/live';
import type { GateEvent, GateLogEvent } from '../../src/gate/events';
import type { RawAction } from '../../src/script/types';

const RIVER = '<g id="river" data-const="W=300 c=1.5 v=2.5 u=sqrt(v^2-c^2)"><text id="downstream" x="20" y="40" font-size="16" data-val="c*W/v" data-fmt="0">lands {} m downstream</text><text id="across" x="20" y="80" font-size="16" data-val="u" data-fmt="1">{} m/s</text><text id="crossing" x="20" y="120" font-size="16" data-val="W/u" data-fmt="0">crossing: {} s</text></g>';
const PAGE = 'River 300 m wide, current 1.5 m/s, ferry speed in still water 2.5 m/s.';
const words = (t: string): Word[] => tokenize(t).filter((x): x is Word => x.kind === 'word');
function board(extra = '') {
  const s = new GateState();
  s.addValues(textNumbers(PAGE + extra), 'page', 'p6', -1);
  s.apply({ kind: 'svg', svg: RIVER } as RawAction, 0);
  return s;
}
const run = (t: string, s = board()) => ({ ...boardNumbers(words(t), s.values, 0), fixes: numberFixes(words(t), s.values, 0) });

describe('boardNumbers', () => {
  it('a number said right passes, at the coarser precision ("2" for the board\'s 2.0)', () => {
    for (const t of ['the crossing takes 150 seconds.', 'across at 2.0 metres a second.', 'about 2 metres a second.', 'it lands 180 metres on.']) expect(run(t), t).toMatchObject({ fixes: [], flags: [] });
  });

  it('within 5% of exactly one readout the words refer to: said as the board writes it (its unit is enough, no label needed)', () => {
    expect(run('about 157 seconds to cross.').fixes).toMatchObject([{ from: '157', to: '150', of: 'crossing' }]);
    expect(run('it drifts 175 metres downstream.').fixes).toMatchObject([{ from: '175', to: '180', of: 'downstream' }]);
    expect(run('across at 2.1 metres a second.').fixes).toMatchObject([{ from: '2.1', to: '2.0' }]);
    expect(run('about 157 seconds to cross.').flags).toEqual([]);
  });

  it('within 15% but not 5% (or hedged past the board\'s precision): the beat fails as drift, naming the readout to say', () => {
    for (const t of ['the crossing takes 160 seconds.', 'the crossing takes about 160 seconds.', 'it drifts 170 metres.']) {
      const r = run(t);
      expect(r.fixes, t).toEqual([]);
      expect(r.flags, t).toHaveLength(1);
      expect(r.flags[0].check).toBe('drift');
    }
    expect(run('the crossing takes 160 seconds.').flags[0].detail).toContain('{{val id=crossing}}');
  });

  it('the readout named right before the number is the one meant, up to 15% (lec09: "SSD is 155")', () => {
    expect(run('so the crossing is 160 seconds.').fixes).toMatchObject([{ from: '160', to: '150' }]);
  });

  it('two readouts within 5% the words refer to (both in metres): ambiguous, never guessed; it fails', () => {
    const s = new GateState();
    s.apply({ kind: 'svg', svg: '<g id="g"><text id="a" data-val="100" x="0" y="20">{} m</text><text id="b" data-val="104" x="0" y="40">{} m</text></g>' } as RawAction, 0);
    const r = boardNumbers(words('it reaches 102 metres here.'), s.values, 0);
    expect(r.fixes).toEqual([]);
    expect(r.flags[0].detail).toMatch(/close to the board's 100.*and to 104/);
  });

  it('the page\'s or question\'s own number never fails, near a readout or not; far numbers stay checkNumbers\' notes', () => {
    expect(run('the page says 160 seconds.', board(' A slower boat takes 160 s.'))).toMatchObject({ fixes: [], flags: [] });
    expect(run('a 600 metre river.')).toMatchObject({ fixes: [], flags: [] });
  });

  it('no readouts (the tag-DSL board): nothing changes', () => {
    const s = new GateState();
    s.addValues([150], 'computed', 'c1', 0);
    expect(boardNumbers(words('the crossing takes 160 seconds.'), s.values, 0)).toEqual({ fixes: [], flags: [], notes: [] });
  });

  it('checkNumbers no longer waves a number near a readout through as "one step from known values"', () => {
    const s = board();
    const core = s.values.filter((v) => v.source !== 'page').map((v) => v.v);
    const ctx = { known: s.values, derived: derivedValues(core, textNumbers(PAGE)), intersections: [] };
    // 148 is 150 − 2 and 151.5 is 150 + 1.5: both "derived" before; now the board rule owns them.
    for (const n of ['148', '151']) expect(checkNumbers([n, 'seconds'], ctx)).toEqual({ flags: [], notes: [] });
    expect(run('the crossing takes 148 seconds.').fixes).toMatchObject([{ to: '150' }]);
  });

  it('checkBeat fails a drifted number under the default severity (it is not a note)', () => {
    const s = new GateState();
    s.addValues(textNumbers(PAGE), 'page', 'p6', -1);
    const text = `{{svg ${RIVER}}} The crossing takes 160 seconds.`;
    const toks = tokenize(text);
    const tags = toks.filter((t) => t.kind === 'tag') as never[];
    const ws = toks.filter((t): t is Word => t.kind === 'word');
    for (const t of tags as { body: string; action?: RawAction }[]) t.action = { kind: 'svg', svg: RIVER } as RawAction;
    const v = withSeverity(checkBeat({ beat: { k: 0, units: [], words: ws, tags, start: 0, end: text.length, text }, k: 0, state: s, skipped: new Map(), added: [], drawn: [], pageVals: [], consts: [] }));
    expect(v.ok).toBe(false);
    expect(v.flags.map((f) => f.check)).toEqual(['drift']);
  });
});

describe('the live gate says a near number as the board\'s, and withholds a drifted one', () => {
  async function gate(text: string) {
    const events: GateLogEvent[] = [];
    let t = 0, ends = 0;
    const g = new LiveGate({ clock: { now: () => t, endsAt: () => ends }, preflight: new GatePreflight({ question: 'why upstream', pages: () => new Map([[6, PAGE]]) }), onEvent: (e) => events.push(e), sleep: async () => {} });
    const src = async function* () { g.handoff(); for (const c of text.match(/[\s\S]{1,29}/g)!) { t += 30; yield c; } };
    let out = '';
    for await (const s of g.wrap(src)(new AbortController().signal)) { out += s; ends = t + 300 * s.split(/\s+/).length; }
    return { out, events: events.filter((e): e is GateEvent => e.t === 'gate') };
  }
  const head = 'The ferry aims upstream. {{svgboard h=600}} {{beat}} ';

  it('"157 seconds" beside the board\'s 150 goes out as "150 seconds"', async () => {
    const r = await gate(`${head}{{svg ${RIVER}}} So the crossing takes 157 seconds. `);
    expect(r.out).toContain('the crossing takes 150 seconds');
    expect(r.out).not.toContain('157');
  });

  it('"160 seconds" is not released (no repair here: the beat is withheld)', async () => {
    const r = await gate(`${head}{{svg ${RIVER}}} So the crossing takes 160 seconds. `);
    expect(r.out).not.toContain('160 seconds');
    expect(r.events.find((e) => e.text?.includes('160'))!.flags.map((f) => f.check)).toContain('drift');
  });
});

// Review (numbers-agree, 2026-10-31): a number is the readout's only when the words say so — this beat, the
// readout's words or unit beside the number, no would/if/instead/another-case — and a unit never crosses
// (seconds are not metres). Close but unreferred: a note, never a rewrite or a fail.
describe('a spoken number is held to a readout only when the sentence refers to it', () => {
  it('a counterfactual is never rewritten (Had the river been 310 metres wide … 155 seconds)', () => {
    expect(numberFixes(words('Had the river been 310 metres wide, the crossing would take 155 seconds.'), board().values, 0)).toEqual([]);
    expect(run('On a 310 metre river it would take 155 seconds.')).toMatchObject({ fixes: [], flags: [] });
  });

  it('seconds are never the metres readout: "175 seconds with a slower boat" stays, "170 seconds instead" does not fail', () => {
    const r = run('Aimed straight across it would cross in 120 seconds, 175 seconds with a slower boat.');
    expect(r.fixes).toEqual([]);
    expect(r.flags).toEqual([]);
    expect(boardNumbers(words('A slower boat would need about 170 seconds instead.'), board().values, 0).flags).toEqual([]);
    // Not even unhedged: 175 seconds is not 'lands {} m downstream'.
    expect(run('The boat takes 175 seconds.').fixes).toEqual([]);
  });

  it('near a readout only in another unit: a note, as a number far from every value gets', () => {
    const r = boardNumbers(words('The boat takes 190 seconds.'), board().values, 0);
    expect(r.flags).toEqual([]);
    expect(r.fixes).toEqual([]);
    expect(r.notes.join()).toMatch(/"190" matches no value on the board in its unit/);
  });

  it('close but not referred to: a note, never a fix or a fail', () => {
    const r = boardNumbers(words('A slower boat would need about 160 seconds.'), board().values, 0);
    expect(r.flags).toEqual([]);
    expect(r.fixes).toEqual([]);
    expect(r.notes.join()).toMatch(/"160" is close to the board's 150 \(crossing\) but not said of it/);
  });

  it('a readout drawn in an earlier beat is not this beat\'s: noted, not rewritten', () => {
    expect(numberFixes(words('it drifts 175 metres downstream.'), board().values, 3)).toEqual([]);
    expect(boardNumbers(words('the crossing takes 160 seconds.'), board().values, 3).flags).toEqual([]);
  });

  it('referred to and close: still fixed or failed (the C4 cases)', () => {
    expect(run('the crossing takes 160 seconds.').flags.map((f) => f.check)).toEqual(['drift']);
    expect(run('it drifts 175 metres downstream.').fixes).toMatchObject([{ from: '175', to: '180', of: 'downstream' }]);
  });
});

describe('small integers, spoken negatives and percents against readouts', () => {
  const one = (svg: string) => { const s = new GateState(); s.apply({ kind: 'svg', svg } as RawAction, 0); return s.values; };
  it('a small-integer readout the sentence refers to is checked ("a price of 8" beside price 7)', () => {
    const vs = one('<g id="g" data-const="a=3"><text id="price" x="0" y="20" data-val="a+4" data-fmt="0">price {}</text></g>');
    expect(boardNumbers(words('The curves meet at a price of 8.'), vs, 0).flags.map((f) => f.check)).toEqual(['drift']);
    expect(boardNumbers(words('The curves meet at a price of 7.'), vs, 0).flags).toEqual([]);
    // A count the sentence does not tie to it stays a count.
    expect(boardNumbers(words('Look at the 8 dots.'), vs, 0)).toMatchObject({ fixes: [], flags: [] });
  });
  it('read by magnitude against a negative readout: "minus 1.3" and "1.3" beside an elasticity of −1.5 drift, "minus 1.5" is it', () => {
    const vs = one('<g id="g" data-const="e=-1.5"><text id="elasticity" x="0" y="20" data-val="e" data-fmt="1">elasticity {}</text></g>');
    expect(boardNumbers(words('The elasticity is minus 1.3 here.'), vs, 0).flags.map((f) => f.check)).toEqual(['drift']);
    expect(boardNumbers(words('The elasticity is minus 1.5 here.'), vs, 0)).toMatchObject({ fixes: [], flags: [] });
    expect(boardNumbers(words('an elasticity of 1.3 here.'), vs, 0).flags.map((f) => f.check)).toEqual(['drift']);
  });
  it('a sign said is read: "minus 1.5" of a gain of +1.5 is said wrong (a fail, never a digit fix); "3 minus 1.5" is arithmetic', () => {
    const vs = one('<g id="g" data-const="k=1.5"><text id="gain" x="0" y="20" data-val="k" data-fmt="1">gain {}</text></g>');
    expect(boardNumbers(words('The gain is minus 1.5 here.'), vs, 0)).toMatchObject({ fixes: [], flags: [{ check: 'drift' }] });
    expect(boardNumbers(words('The gain is 3 minus 1.5 here.'), vs, 0)).toMatchObject({ fixes: [], flags: [] });
  });
  it('a percent said is held to a percent readout, and only to one', () => {
    const vs = one('<g id="g" data-const="q=0.123"><text id="fall" x="0" y="20" data-val="q*100" data-fmt="0">demand falls {}%</text></g>');
    expect(boardNumbers(words('Demand falls by about 14 percent.'), vs, 0).flags.map((f) => f.check)).toEqual(['drift']);
    expect(boardNumbers(words('Demand falls by 12 percent.'), vs, 0)).toMatchObject({ fixes: [], flags: [] });
    const secs = one('<g id="g" data-const="t=12.3"><text id="t" x="0" y="20" data-val="t" data-fmt="0">demand falls in {} s</text></g>');
    expect(boardNumbers(words('Demand falls by about 13 percent.'), secs, 0)).toMatchObject({ fixes: [], flags: [] });
  });
});
