// @vitest-environment jsdom
// A group draws inside its own beat (review of fix/say-what-you-draw, 2026-10-31): never on the next
// beat's words, whatever order the model wrote it in, whatever the look after a page mark holds, and a
// forward seek still names each group's own beat.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { SvgBeatFilter } from '../../server/svgBeats';
import { beatsOf, groupIdOf } from '../../src/svgboard/beat';
import { ScriptParser } from '../../src/script/parser';
import { Scheduler, FLUSH_MS } from '../../src/playback/scheduler';
import { PacedClock, type NarrationClock } from '../../src/playback/clock';
import type { Action, ScriptEvent } from '../../src/script/types';

const PLAN = '<plan>the case\nBOARD viewBox="0 0 560 400"\n</plan>';
const G = (id: string) => `<g id="${id}"><line x1="10" y1="10" x2="90" y2="10" stroke="#222"/></g>`;
const wire = (raw: string) => { const f = new SvgBeatFilter(() => 0); return f.push(raw) + f.end(); };
const show = (b: { groups: { body: string }[]; words: { text: string }[] }) => `${b.groups.map((g) => groupIdOf(g.body)).join(',')}: ${b.words.map((w) => w.text).join(' ')}`;
/** Every word lasts 100ms; time is Date.now() (faked). */
const fixedClock = () => new PacedClock(() => 170, () => Date.now(), () => 100);
const words = (s: string) => s.split(' ').map((t): ScriptEvent => ({ type: 'word', text: t }));
const svg = (id: string, anchor?: string[]): ScriptEvent => ({ type: 'action', action: { kind: 'svg', id, svg: `<g id="${id}"><path id="${id}-curve"/></g>`, ...(anchor ? { anchor } : {}) } as Action });
const END: ScriptEvent = { type: 'end' };
const BEAT: ScriptEvent = { type: 'action', action: { kind: 'beat' } as unknown as Action };
const mark = (quote: string): ScriptEvent => ({ type: 'action', action: { kind: 'highlight', page: 1, quote } as unknown as Action });

/** The word each svg group is anchored to as the script is pushed (nothing fires). */
function anchors(script: string) {
  const p = new ScriptParser();
  const evs: ScriptEvent[] = [...p.push(script), ...p.end()];
  const clock = { now: () => 0, endsAt: () => 0, wordStart: () => null, durationMs: () => 300, push() {}, end() {} } as unknown as NarrationClock;
  const s = new Scheduler(clock, { onWord() {}, onAction() {}, onDone() {} });
  (s as unknown as { tick: () => void }).tick = () => {};
  s.push(evs);
  const ws = evs.flatMap((e) => (e.type === 'word' ? [e.text] : []));
  const acts = (s as unknown as { acts: { action: { kind: string; id?: string }; word: number }[] }).acts;
  return { words: ws, at: Object.fromEntries(acts.filter((a) => a.action.kind === 'svg').map((a) => [a.action.id!, a.word])) };
}

describe('beat timing: a group draws in its own beat', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => vi.useRealTimers());

  function run(events: ScriptEvent[], ms = 20000, seekAt?: { t: number; to: number }) {
    const fired: { id?: string; at: number; word?: number; slot?: unknown; beatFrom?: number; beat: string[] }[] = [];
    const log: string[] = [];
    const s: Scheduler = new Scheduler(fixedClock(), {
      onWord: (t) => log.push(t),
      onAction: (a, at, word) => { log.push(`<${a.kind}>`); if (a.kind === 'svg') { const x = a as { id?: string; slot?: unknown; beatFrom?: number }; fired.push({ id: x.id, at, word, slot: x.slot, beatFrom: x.beatFrom, beat: s.beatWords(x.beatFrom).map((w) => w.text) }); } },
      onDone: () => {},
    }, { leadMs: () => 0 });
    s.push(events);
    if (seekAt) { vi.advanceTimersByTime(seekAt.t); s.seek(seekAt.to); }
    vi.advanceTimersByTime(ms);
    return { fired, log };
  }

  it('trailing order: a group its own sentences do not name fires inside its beat, not on the next beat\'s first word', () => {
    const out = wire(`Opener. ${PLAN}\nThe river runs wide. The current pushes.\n${G('frame')}\nThe drift adds up.\n${G('drift')}`);
    expect(beatsOf(out).slice(1).map(show)).toEqual(['frame: The river runs wide. The current pushes.', 'drift: The drift adds up.']);
    const { words: ws, at } = anchors(out);
    // Its own beat's words are 1..7; 8 is "The" of the drift beat.
    expect(ws[at.frame]).not.toBe(undefined);
    expect(at.frame, `fires on "${ws[at.frame]}" (word ${at.frame}): the drift beat starts at 8`).toBeLessThan(8);
    expect(at.drift).toBeGreaterThanOrEqual(8);
  });

  it('trailing order: the group draws while its own sentences are said (the gate still holds the next beat)', () => {
    // The next beat is one gate unit, released only once the {{beat}} after it is here: until then no
    // word after the group is playable. On its next word it drew in that silence, then over "So it lands".
    const { log } = run([BEAT, ...words('Aim it straight at the landing and the water pushes it sideways.'), svg('drift', ['drift'])], 1100 + FLUSH_MS + 5000);
    expect(log).toContain('<svg>');
    expect(log.indexOf('<svg>')).toBeLessThan(log.indexOf('sideways.'));
  });
});
