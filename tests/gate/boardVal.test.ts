// @vitest-environment jsdom
// A board number said by name (C4, 2026-10-31): `{{val id=t}}` in svg mode says the data-val readout whose
// id is t, exactly as the board writes it, so the word heard and the number drawn are one number. It
// resolves in the gate's engine and in the session's parser alike, follows a tween, and survives its
// beat being withheld (the remnant's definitions carry it: defs.ts).
import { describe, expect, it } from 'vitest';
import { GateState } from '../../src/gate/engine';
import { ScriptParser } from '../../src/script/parser';
import { checkUnbound } from '../../src/gate/check';
import { defsOf, definedNames } from '../../src/svgboard/defs';
import type { RawAction } from '../../src/script/types';
import { saidText, spokenOf } from '../../src/values/say';

const RIVER = '<g id="river" data-const="W=300 c=1.5 v=2.5 u=sqrt(v^2-c^2)"><text id="crossing" x="20" y="40" font-size="16" data-val="W/u" data-fmt="0">crossing {} s</text><text id="across" x="20" y="80" font-size="16" data-val="u" data-fmt="1">{} m/s</text><text x="20" y="120" font-size="16" data-val="c*W/v">{} m</text></g>';
const svg = (s: string) => ({ kind: 'svg', svg: s }) as RawAction;
const said = (text: string) => {
  const p = new ScriptParser();
  const evs = [...p.push(text), ...p.end()];
  return { words: evs.flatMap((e) => (e.type === 'word' ? [e.text] : [])).join(' '), actions: evs.flatMap((e) => (e.type === 'action' ? [e.action] : [])) };
};

describe('{{val}} reads the svg board', () => {
  it('a data-val readout by its id: its value and the board\'s own text (its data-fmt)', () => {
    const s = new GateState();
    expect(s.apply(svg(RIVER), 0)).toBeUndefined();
    expect(s.value('crossing')).toEqual({ v: 150, text: '150', affix: { pre: '', post: ' s' }, fmt: '0' });
    expect(s.value('ACROSS')).toMatchObject({ text: '2.0' });
    // Said with the unit its text writes around it ("{} m/s"), in words for TTS.
    expect(s.say({ kind: 'val', ref: 'across' })).toEqual({ num: '2.0', pre: '', post: ' m/s' });
    expect(spokenOf(s.say({ kind: 'val', ref: 'across' })!)).toBe('two point zero metres per second');
    // A format asked for in the tag still wins (the affixes stay); a constant still reads as before.
    expect(saidText(s.say({ kind: 'val', ref: 'across', fmt: 2 })!)).toBe('2.00 m/s');
    expect(s.value('w')).toEqual({ v: 300 });
    expect(typeof s.value('nosuch')).toBe('string');
  });

  it('the session\'s parser says it as a word, glued to its punctuation, in the order the beat plays', () => {
    const r = said(`{{svg ${RIVER}}} So the crossing takes {{val id=crossing}} seconds, at {{val id=across}}.`);
    // "crossing {} s" said with "seconds" after it: the narration's unit, once; "{} m/s" alone: the board's.
    expect(r.words).toBe('So the crossing takes 150 seconds, at 2.0 m/s.');
    expect(r.actions.filter((a) => a.kind === 'val').map((a) => (a as { said?: string }).said)).toEqual(['150', '2.0 m/s']);
  });

  it('a hyphenated readout id is said (eval D20: id="height-low", {{val id=height-low}} parsed as height_low)', () => {
    const r = said(`{{svg <g id="paths" data-const="h=12.5"><text id="height-low" x="20" y="40" font-size="16" data-val="h" data-fmt="1">H = {} m</text></g>}} It peaks at {{val id=height-low}} metres.`);
    expect(r.words).toBe('It peaks at 12.5 metres.');
  });

  it('a readout follows a tween: the next sentence says the new value', () => {
    const r = said(`{{svg ${RIVER}}} Now {{val id=crossing}}. {{tween c=2 dur=2}} Then {{val id=crossing}}.`);
    expect(r.words).toBe(`Now 150 s. Then ${Math.round(300 / Math.sqrt(2.5 ** 2 - 4))} s.`);
  });

  it('a withheld beat\'s readouts are in its remnant: a later {{val}} still resolves (no cascade)', () => {
    const d = defsOf(RIVER)!;
    // Its template too: the remnant's readout is said with the same affixes ("150 s").
    expect(d).toContain('<text data-name="crossing" data-val="W/u" data-fmt="0" data-tpl="crossing {} s"/>');
    expect(d).not.toContain('c*W/v'); // an unnamed readout cannot be said by name: not a definition
    expect([...definedNames(RIVER)]).toEqual(expect.arrayContaining(['val:crossing', 'val:across']));
    const s = new GateState();
    s.apply(svg(d), 0);
    expect(saidText(s.say({ kind: 'val', ref: 'crossing' })!)).toBe('150 s');
  });

  it('a readout typed instead of said is reported with its own id (not "svg")', () => {
    const s = new GateState();
    s.apply(svg(RIVER), 0);
    expect(checkUnbound(['crossing', 'takes', '150', 'seconds'], s.values)[0].detail).toContain('{{val id=crossing}}');
    expect(s.values.find((v) => v.v === 180)).toMatchObject({ of: 'svg', shown: '180' });
  });
});
