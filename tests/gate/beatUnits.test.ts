// @vitest-environment jsdom
// The svg beat as one unit (src/svgboard/beat.ts, THE RULE), whatever order the model wrote: the
// filter's `{{beat}}` boundaries, beatsOf, the gate's splitter, the scheduler's anchor, MEMORY.
import { describe, expect, it } from 'vitest';
import { SvgBeatFilter } from '../../server/svgBeats';
import { SVG_EXAMPLES } from '../../server/prompt/svgExamples';
import { beatsOf, groupIdOf } from '../../src/svgboard/beat';
import { BeatSplitter } from '../../src/gate/segment';
import { ScriptParser } from '../../src/script/parser';
import { Scheduler } from '../../src/playback/scheduler';
import { boardOf } from '../../src/agent/context/memory';
import type { NarrationClock } from '../../src/playback/clock';
import type { ScriptEvent } from '../../src/script/types';

const PLAN = '<plan>the case\nBOARD viewBox="0 0 560 400"\n</plan>';
const G = (id: string) => `<g id="${id}"><line x1="10" y1="10" x2="90" y2="10" stroke="#222"/></g>`;
/** The same three beats in each order the model may write. */
const ORDERS = {
  // What the prompt teaches: the group, then its sentences.
  lead: `The ferry aims upstream. ${PLAN}\n${G('river')}\nThe river runs wide. The current pushes sideways.\n${G('drift')}\nThe drift adds up.\n${G('aim')}\nSo it aims upstream.`,
  // The old SVG_POINTING exception: a beat whose first sentence marks the page puts its group after it.
  pointing: `The ferry aims upstream. ${PLAN}\n{{highlight p=2 "river"}} The page shows the river.\n${G('river')}\nThe river runs wide. The current pushes sideways.\n${G('drift')}\nThe drift adds up.\n${G('aim')}\nSo it aims upstream.`,
  // p6.0 and the old repair note: sentences, then the group that closes them.
  trailing: `The ferry aims upstream. ${PLAN}\nThe river runs wide. The current pushes sideways.\n${G('river')}\nThe drift adds up.\n${G('drift')}\nSo it aims upstream.\n${G('aim')}`,
};
/** Each beat (after the opener): its groups and its words. */
const EXPECT: Record<keyof typeof ORDERS, string[]> = {
  lead: ['river: The river runs wide. The current pushes sideways.', 'drift: The drift adds up.', 'aim: So it aims upstream.'],
  // The page sentence before the first group is a beat with no drawing (page talk); the drawing's own words follow it.
  pointing: [': The page shows the river.', 'river: The river runs wide. The current pushes sideways.', 'drift: The drift adds up.', 'aim: So it aims upstream.'],
  trailing: ['river: The river runs wide. The current pushes sideways.', 'drift: The drift adds up.', 'aim: So it aims upstream.'],
};

const wire = (raw: string, step: number) => { const f = new SvgBeatFilter(() => 0); let out = ''; for (let i = 0; i < raw.length; i += step) out += f.push(raw.slice(i, i + step)); return { out: out + f.end(), f }; };
const show = (b: { groups: { body: string }[]; words: { text: string }[] }) => `${b.groups.map((g) => groupIdOf(g.body)).join(',')}: ${b.words.map((w) => w.text).join(' ')}`;

describe('the beat rule: three orders, one Beat {group, sentences}', () => {
  for (const [name, raw] of Object.entries(ORDERS) as [keyof typeof ORDERS, string][]) {
    it(`${name}: the filter's boundaries give each group its own sentences, at any chunking`, () => {
      for (const step of [1, 3, 11, 1e6]) {
        const { out, f } = wire(raw, step);
        expect(f.order, String(step)).toBe(name === 'trailing' ? 'trail' : 'lead');
        const bs = beatsOf(out);
        expect(bs[0].groups).toEqual([]); // the opener: no drawing
        expect(bs.slice(1).map(show), `${name} @${step}`).toEqual(EXPECT[name]);
      }
    });
    for (const mode of ['sentence', 'beat'] as const) {
      it(`${name}, ${mode} mode: every gate unit after the board is exactly one beat (its group and its own sentences)`, () => {
        const { out } = wire(raw, 1e6);
        for (const step of [1, 7, 40, 1e6]) {
          const s = new BeatSplitter(mode);
          const us: { text: string; beat?: true }[] = [];
          for (let i = 0; i < out.length; i += step) us.push(...s.push(out.slice(i, i + step)));
          us.push(...s.end());
          expect(us.map((u) => u.text).join('')).toBe(out);
          const beats = us.filter((u) => u.beat).map((u) => beatsOf(u.text)).map((b) => b.map(show).join(' | '));
          expect(beats, `${name} ${mode} @${step}`).toEqual(EXPECT[name]);
        }
      });
    }
  }

  it('groups in a row share one beat; a beat the stream ends on with no words joins the one before', () => {
    const { out } = wire(`Opener. ${PLAN}\n${G('a')}\n${G('b')}\nBoth draw here.\n${G('c')}`, 5);
    expect(beatsOf(out).slice(1).map(show)).toEqual(['a,b,c: Both draw here.']);
  });

  it('the prompt\'s own examples: one group per beat, its id a word of its own sentences', () => {
    for (const ex of SVG_EXAMPLES) {
      const { out } = wire(ex.script, 13);
      const bs = beatsOf(out).filter((b) => b.groups.length);
      expect(bs.length).toBe(bs.flatMap((b) => b.groups).length);
      for (const b of bs) {
        const id = groupIdOf(b.groups[0].body)!;
        expect(b.words.map((w) => w.text.toLowerCase()).some((w) => w.startsWith(id.slice(0, 4))), `${id}: ${b.words.map((w) => w.text).join(' ')}`).toBe(true);
      }
    }
  });

  it('legacy text (no {{beat}}): each run of groups closes the sentences before it', () => {
    const legacy = 'Opener. {{svgboard h=400}} The river runs. {{svg <g id="river"></g>}} The drift adds up. {{svg <g id="drift"></g>}} ';
    expect(beatsOf(legacy).slice(1).map(show)).toEqual(['river: The river runs.', 'drift: The drift adds up.']);
  });
});

/** Plays parser events through the real Scheduler (no clock run): the word each svg group fires on. */
function anchors(script: string): Record<string, { word: number; text: string }> {
  const p = new ScriptParser();
  const evs: ScriptEvent[] = [...p.push(script), ...p.end()];
  const clock = { now: () => 0, endsAt: () => 0, wordStart: () => null, durationMs: () => 300, push() {}, end() {} } as unknown as NarrationClock;
  const s = new Scheduler(clock, { onWord() {}, onAction() {}, onDone() {} });
  (s as unknown as { tick: () => void }).tick = () => {};
  s.push(evs);
  const words = evs.flatMap((e) => (e.type === 'word' ? [e.text] : []));
  const acts = (s as unknown as { acts: { action: { kind: string; id?: string }; word: number }[] }).acts;
  return Object.fromEntries(acts.filter((a) => a.action.kind === 'svg').map((a) => [a.action.id!, { word: a.word, text: words[a.word] }]));
}

describe('the scheduler: a group anchors only in its own beat', () => {
  it('a word of the beat before never anchors a group (the ferry\'s "aim" drew five words before its beat)', () => {
    const { out } = wire(SVG_EXAMPLES[0].script, 1e6);
    const a = anchors(out);
    expect(a.aim.text).toBe('So');
    for (const b of beatsOf(out).filter((x) => x.groups.length)) {
      const id = groupIdOf(b.groups[0].body)!;
      expect(a[id].text, id).toBe(b.words[0].text);
    }
  });
  it('trailing order: the group fires on the word of its own sentences that names it', () => {
    const { out } = wire(`Opener. ${PLAN}\nThe river runs wide. The current pushes.\n${G('current')}\nThe drift adds up.\n${G('drift')}`, 1e6);
    const a = anchors(out);
    expect(a.current.text).toBe('current');
    expect(a.drift.text).toBe('drift');
  });
});

describe('MEMORY: a group means its own beat\'s sentences', () => {
  it('in each order', () => {
    for (const [name, raw] of Object.entries(ORDERS)) {
      const { out } = wire(raw, 1e6);
      const means = Object.fromEntries(boardOf(out).things.filter((t) => t.kind === 'svg group').map((t) => [t.id, t.means]));
      expect(means, name).toEqual({ river: 'The river runs wide.', drift: 'The drift adds up.', aim: 'So it aims upstream.' });
    }
  });
});
