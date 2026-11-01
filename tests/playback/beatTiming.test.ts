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

  it('legacy (no {{beat}}): a group after its words still flushes once the narration runs dry', () => {
    // Old recordings, eval --replay, svgReplay: always words first. Its words are released (spoken), so
    // nothing is gained by holding it for the next word; held, it drew one beat late, over that beat.
    const { log } = run([...words('Aim it straight at the landing and the water pushes it sideways.'), svg('drift', ['drift'])], 1100 + FLUSH_MS + 5000);
    expect(log).toContain('<svg>');
  });

  it('lead order: a group whose beat\'s first word is not released yet still waits for it (no flush)', () => {
    const { log } = run([BEAT, svg('one'), ...words('The axis goes in.'), BEAT, svg('two')], 5000);
    expect(log.filter((x) => x === '<svg>')).toHaveLength(1);
  });
  it('the look after a page mark never pushes a short beat\'s group past its beat', () => {
    const p = new ScriptParser();
    const script = `Opener. {{svgboard h=400}} {{beat}} {{highlight p=1 "the long quoted phrase on the page here"}} See this on the page now. {{beat}} {{svg <g id="aa"><line x1="1" y1="1" x2="9" y2="9" stroke="#222"/></g>}} It runs. {{beat}} {{svg <g id="bb"><line x1="1" y1="1" x2="9" y2="9" stroke="#222"/></g>}} Then the next beat has many words to say about it all here now. `;
    const evs: ScriptEvent[] = [...p.push(script), ...p.end(), END];
    const fired: { id?: string; word?: number }[] = [];
    const s = new Scheduler(fixedClock(), { onWord() {}, onAction: (a, _at, word) => fired.push({ id: (a as { id?: string }).id ?? a.kind, word }), onDone() {} }, { leadMs: () => 0 });
    s.push(evs);
    vi.advanceTimersByTime(20000);
    const ws = evs.flatMap((e) => (e.type === 'word' ? [e.text] : []));
    const bStart = ws.indexOf('Then');
    const a = fired.find((f) => f.id === 'aa')!;
    expect(a.word, `aa fired on "${ws[a.word!]}" (#${a.word}); beat bb starts at #${bStart}; ${JSON.stringify(fired)}`).toBeLessThan(bStart);
    // The look outlasts "It runs.": aa draws on its beat's last word, and before bb.
    expect(a.word).toBe(bStart - 1);
    expect(fired.map((f) => f.id).filter((x) => x === 'aa' || x === 'bb')).toEqual(['aa', 'bb']);
  });

  it('a look that outlasts a short beat does not pull the next beat\'s group into a shared slot', () => {
    const { fired } = run([mark('a long quoted phrase on the slide here'), ...words('See this.'), BEAT, svg('one'), ...words('Short.'), BEAT, svg('two'), ...words('the curve falls fast and then it flattens out slowly over time.'), END]);
    const two = fired.find((f) => f.id === 'two')!;
    // 'two' is alone in its beat: it paces over the whole of it, not its second half.
    expect(two.slot).toBeUndefined();
    expect(fired.map((f) => f.id)).toEqual(['one', 'two']);
    expect(fired[0].beat).toEqual(['Short.']);
    expect(two.beat[0]).toBe('the');
  });
  it('a group a forward seek skips past still names its own beat (beatFrom), not the target beat', () => {
    const { fired } = run([BEAT, svg('one'), ...words('first the axis goes in.'), BEAT, svg('two'), ...words('then the curve rises.'), BEAT, svg('three'), ...words('and here it levels off at last.'), END], 20000, { t: 1, to: 12 });
    const one = fired.find((f) => f.id === 'one')!;
    const two = fired.find((f) => f.id === 'two')!;
    expect(two.beatFrom).toBe(5);
    expect(two.beat[0]).toBe('then');
    expect(one.beatFrom).toBe(0);
  });

  it('after a forward seek the skipped beat\'s words are spoken: its group lands, not paced over the target beat', () => {
    let from: number | undefined;
    const s: Scheduler = new Scheduler(fixedClock(), {
      onWord() {}, onAction: (a) => { const x = a as { id?: string; beatFrom?: number }; if (x.id === 'two') from = x.beatFrom; }, onDone() {},
    }, { leadMs: () => 0 });
    s.push([BEAT, svg('one'), ...words('first the axis goes in.'), BEAT, svg('two'), ...words('then the curve rises.'), BEAT, svg('three'), ...words('and here it levels off at last.'), END]);
    vi.advanceTimersByTime(1);
    s.seek(12);
    // The director reads it once the group's step runs (after the seek).
    const beat = s.beatWords(from);
    expect(beat.length).toBe(4);
    // They kept their old, later times on the clock; they were skipped, so they are over.
    expect(beat.map((w) => [w.inMs, w.endMs])).toEqual([[0, 0], [0, 0], [0, 0], [0, 0]]);
  });
});
