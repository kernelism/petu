// Pacing the drawing to the speech (founder 2026-10-30: "drawing races, explanation races"): the
// timing math (src/playback/pace.ts), the scheduler's rest after a drawn beat and the beat's word
// times on both clocks (paced and voiced).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { beatEnd, beatWindow, labelNames, partWords, OPEN_SPAN_MS, OPEN_TAIL_MS, paceParts, splitPart, PART_MIN_MS, PART_MAX_MS, PART_GAP_MS, REST_MS, SPAN_MIN_MS, type BeatWord } from '../../src/playback/pace';
import { PacedClock } from '../../src/playback/clock';
import { Scheduler, namesWord } from '../../src/playback/scheduler';
import { VoiceClock, SAMPLE_RATE, type AudioOut, type Speak } from '../../src/playback/voiceClock';
import type { Action, ScriptEvent } from '../../src/script/types';

/** Words `ms` apart, starting now. */
const beat = (text: string, ms = 300): BeatWord[] => text.split(' ').map((t, i) => ({ text: t, inMs: i * ms, endMs: (i + 1) * ms }));
const part = (words: string[] = [], label?: string[], naturalMs = 300) => ({ words, ...(label ? { label } : {}), naturalMs });

describe('pace: the words a part answers to', () => {
  it('short ids count as whole words; the group\'s own words are left to the group', () => {
    expect(partWords('masses-in', 'masses')).toEqual(['in']);
    expect(partWords('masses-out', 'masses')).toEqual(['out']);
    expect(partWords('arrowUp')).toEqual(['arrow', 'up']);
    expect(partWords('label-cap')).toEqual(['cap']);
    expect(partWords('masses', 'masses')).toEqual(['masses']); // a part named like its group keeps the name
    expect(namesWord('in,', ['in'])).toBe(true);
    expect(namesWord('Up', ['up'])).toBe(true);
    expect(namesWord('ins', ['in'])).toBe(false);
    expect(namesWord('inside', ['in'])).toBe(false);
    expect(namesWord('upper', ['up'])).toBe(false);
  });
  it('a part named "in" draws on the word "in", not on the group\'s name', () => {
    const w = beat('two masses held out wide then pull them in close to the axis and watch');
    const t = paceParts([part(partWords('masses-out', 'masses')), part(partWords('masses-in', 'masses'))], w)!;
    expect(t.map((x) => [x.i, x.at])).toEqual([[0, 3 * 300], [1, 8 * 300]]);
  });
});

describe('pace: the window a group draws in', () => {
  it('is its beat, first word to the last word\'s end', () => {
    expect(beatWindow(beat('a b c d e f g h i j'))).toEqual({ from: 0, to: 3000 });
  });
  it('a short beat is still spread over SPAN_MIN_MS', () => {
    expect(beatWindow(beat('two words'))).toEqual({ from: 0, to: SPAN_MIN_MS });
  });
  it('groups that came together split the beat in turn', () => {
    const w = beat('a b c d e f g h i j k l');
    expect(beatWindow(w, { k: 0, n: 3 })).toEqual({ from: 0, to: 1200 });
    expect(beatWindow(w, { k: 1, n: 3 })).toEqual({ from: 1200, to: 2400 });
    expect(beatWindow(w, { k: 2, n: 3 })).toEqual({ from: 2400, to: 3600 });
  });
  it('a beat still streaming runs a short tail past its known words; once closed, its real end', () => {
    const w = beat('picture a simplified skater');
    expect(beatEnd(w)).toBe(1200);
    w[w.length - 1].open = true;
    expect(beatEnd(w)).toBe(1200 + OPEN_TAIL_MS);
    expect(beatWindow(w)).toEqual({ from: 0, to: 1200 + OPEN_TAIL_MS });
  });
  it('a beat still streaming is not guessed seconds past its words (the gate holding the next beat)', () => {
    // Re-read 4 s into the beat (its first words spoken, clamped to now): it ends with its known words,
    // not at a 6 s guess (2 s from now), and not 6 s from now (the old slide).
    const w: BeatWord[] = [{ text: 'the', inMs: 0, endMs: 0, sinceMs: 4000 }, { text: 'river', inMs: 0, endMs: 300, open: true }];
    expect(beatEnd(w)).toBe(300 + OPEN_TAIL_MS);
    expect(beatEnd([{ ...w[0], sinceMs: undefined }, w[1]])).toBe(300 + OPEN_TAIL_MS);
    expect(beatEnd([{ text: 'Here.', inMs: 0, endMs: 300, open: true }])).toBe(300 + OPEN_TAIL_MS);
  });
  it('a beat still streaming with no word here yet: OPEN_SPAN_MS from when it began', () => {
    expect(beatEnd([{ text: '', inMs: 0, endMs: 0, open: true }])).toBe(OPEN_SPAN_MS);
    expect(beatEnd([{ text: '', inMs: 500, endMs: 500, open: true }])).toBe(500 + OPEN_SPAN_MS);
  });
  it('a word with no end time counts a word\'s length', () => {
    expect(beatWindow([{ text: 'a', inMs: 0 }, { text: 'b', inMs: 2000 }]).to).toBe(2300);
  });
});

describe('pace: each part draws across its share of the words', () => {
  it('a beat with no words yet but still streaming is paced over OPEN_SPAN_MS (then re-planned)', () => {
    const t = paceParts([part(), part()], [{ text: '', inMs: 0, endMs: 0, open: true }])!;
    expect(t.map((x) => x.at)).toEqual([0, OPEN_SPAN_MS / 2]);
  });

  it('a beat already over (closed, every word spoken) lands its parts at once, not over the next beat\'s words', () => {
    // A group fired after its beat (a forward seek, a look): drawn over SPAN_MIN_MS from now, that was the next beat's narration.
    const w = ['the', 'curve', 'falls.'].map((text) => ({ text, inMs: 0, endMs: 0 }));
    const p = paceParts([{ words: ['curve'], naturalMs: 300 }, { words: [], naturalMs: 300 }], w)!;
    expect(Math.max(...p.map((x) => x.at + x.dur))).toBeLessThanOrEqual(0 + 1);
    expect(p.map((x) => x.i)).toEqual([0, 1]);
  });

  it('needs at least two words (else pen speed: null)', () => {
    expect(paceParts([part()], beat('one'))).toBeNull();
    expect(paceParts([part()], [])).toBeNull();
    expect(paceParts([], beat('a b c'))).toBeNull();
  });
  it('a re-plan paces a beat that turned out to be one word (the group is already paced)', () => {
    // Started 400 ms ago; its one word is said 1000..1300 from now: the parts left spread up to its end.
    const t = paceParts([part(), part()], [{ text: 'Here.', inMs: 1000, endMs: 1300 }], undefined, -400)!;
    expect(t.map((x) => x.at)).toEqual([0, 650]);
  });

  it('an unnamed part ahead of the first named one leads from the window\'s start, whatever numbers come later (a frame, D20)', () => {
    const t = paceParts([part(), part(['demand'])], beat('this line is the demand curve; at a price of 30 buyers want ten'))!;
    expect(t.map((x) => [x.i, x.at])).toEqual([[0, 0], [1, 4 * 300]]);
  });

  it('spreads the parts over the beat, each drawing until the next starts (less a pen lift)', () => {
    // 4 parts over a 6 s beat (20 words at 300 ms): one every 1.5 s, each drawing 1.42 s.
    const t = paceParts([part(), part(), part(), part()], beat(Array(20).fill('w').join(' ')))!;
    expect(t.map((x) => x.at)).toEqual([0, 1500, 3000, 4500]);
    expect(t.map((x) => x.dur)).toEqual(Array(4).fill(1500 - PART_GAP_MS));
  });

  it('the draw time follows the narration, not the pen: the same part is slower over a slower beat', () => {
    const fast = paceParts([part(), part()], beat('a b c d e f g h', 200))!;
    const slow = paceParts([part(), part()], beat('a b c d e f g h', 400))!;
    expect(slow[0].dur).toBeGreaterThan(fast[0].dur * 1.8);
  });

  it('caps a long share (a part does not crawl across a long beat)', () => {
    const t = paceParts([part()], beat(Array(60).fill('w').join(' ')))!;
    expect(t[0]).toEqual({ i: 0, at: 0, dur: PART_MAX_MS });
  });

  it('two parts named on neighbouring words: the first is quick, the second keeps its word', () => {
    const t = paceParts([part(['curve']), part(['peak'])], beat('the curve peak rises here and falls slowly again'))!;
    expect(t[0]).toMatchObject({ i: 0, at: 300, dur: 300 - PART_GAP_MS });
    expect(t[1]).toMatchObject({ i: 1, at: 600 });
  });

  it('a crowded gap never runs into the named part after it', () => {
    // Five unnamed strokes before a label said on word 2: they fit in 600 ms, the label keeps its word.
    const t = paceParts([part(), part(), part(), part(), part([], ['37'])], beat('it is 37 degrees then a b c d e f g'))!;
    const end = Math.max(...t.filter((x) => x.i < 4).map((x) => x.at + x.dur));
    expect(t.find((x) => x.i === 4)!.at).toBe(600);
    expect(end).toBeLessThanOrEqual(600);
  });

  it('the parts before every named one start at the beat\'s start, not just before the first named in the group', () => {
    // The ferry's triangle: its strokes come first in the group, its "37°" label is said last.
    const w = beat(`draw the triangle ${Array(20).fill('w').join(' ')} 2.5 here ${Array(10).fill('w').join(' ')} about 37 degrees`);
    const t = paceParts([part(), part(), part(), part([], labelNames('37°')), part([], labelNames('2.5 m/s'))], w)!;
    expect(t.map((x) => x.i)).toEqual([0, 1, 2, 4, 3]);
    expect(t[0].at).toBe(0);
    expect(t[2].at + t[2].dur).toBeLessThanOrEqual(23 * 300); // the strokes are done by "2.5"
  });

  it('many parts in a short beat share it: the minimum gives way, the drawing ends with the beat', () => {
    const n = 20;
    const t = paceParts(Array.from({ length: n }, () => part()), beat('a b c d e f'))!; // a 1.8 s beat
    const end = t[t.length - 1].at + t[t.length - 1].dur;
    expect(t.every((x) => x.dur < PART_MIN_MS)).toBe(true);
    expect(end).toBeLessThanOrEqual(1800 + 120);
  });

  it('a named part starts on the word that names it; the unnamed ones draw up to it in the group\'s order, not pen order', () => {
    const parts = [part(['label']), part(), part(['cap'])]; // a label never said, a frame, a line named "cap"
    const t = paceParts(parts, beat('here the frame and then this line is the cap at five hundred dollars'))!;
    const byI = Object.fromEntries(t.map((x) => [x.i, x]));
    expect(byI[2].at).toBe(9 * 300); // "cap" is word 9
    expect(byI[0].at).toBe(0); // the label first: the group's order (a pen-category sort put it last)
    expect(byI[1].at).toBe(1350); // the frame right after, up to "cap"
    expect(t.map((x) => x.i)).toEqual([0, 1, 2]);
  });

  it('a named part is not cut at PART_MAX_MS: it draws until the next part starts', () => {
    const w = beat(`the curve ${Array(30).fill('w').join(' ')} and the peak`);
    const t = paceParts([part(['curve']), part(['peak'])], w)!;
    expect(t[0]).toEqual({ i: 0, at: 300, dur: 34 * 300 - 300 - PART_GAP_MS });
    expect(t[0].dur).toBeGreaterThan(PART_MAX_MS);
  });

  it('an unnamed part goes with its nearest named neighbour: after the one before it, before the one after it', () => {
    // 0 axis (named), 1 tick, 2 tick, 3 label, 4 curve (named): 1 follows the axis, 3 leads into the curve, 2 (a tie) follows the axis.
    const w = beat(`the axis ${Array(16).fill('w').join(' ')} then the curve ${Array(10).fill('w').join(' ')}`);
    const t = paceParts([part(['axis']), part(), part(), part(), part(['curve'])], w)!;
    const byI = Object.fromEntries(t.map((x) => [x.i, x]));
    expect(byI[0].at).toBe(300);
    expect(byI[4].at).toBe(20 * 300);
    expect(byI[1].at).toBeGreaterThan(300);
    expect(byI[1].at).toBeLessThan(2600); // right after the axis, not spread to the middle
    expect(byI[2].at).toBeGreaterThan(byI[1].at);
    expect(byI[3].at + byI[3].dur).toBeLessThanOrEqual(6000); // ends as the curve starts
    expect(byI[3].at).toBeGreaterThan(3000);
    expect(t.map((x) => x.i)).toEqual([0, 1, 2, 3, 4]);
  });

  it('a label is named by its number, however it is said', () => {
    const lab = (l: string) => part([], labelNames(l));
    const w = beat('the ferry points 37° upstream at two point five metres a second against thirty-seven');
    const t = paceParts([lab('2.5 m/s'), lab('aims 37 upstream')], w)!;
    const byI = Object.fromEntries(t.map((x) => [x.i, x.at]));
    expect(byI[1]).toBe(3 * 300); // "37°" (before its word "upstream")
    expect(byI[0]).toBe(6 * 300); // "two point five"
    expect(paceParts([lab('thirty seven'), lab('37')], beat('a b thirty-seven c d e'))!.find((x) => x.i === 1)!.at).toBe(600);
    // To the label's precision: "2.0" is not 2.5, "about 40" is not 37, a page number is not a value.
    expect(paceParts([lab('2.5'), part(['x'])], beat('it is 2.0 here x then more words go on'))!.find((x) => x.i === 0)!.at).toBe(0);
    expect(paceParts([lab('37'), part(['x'])], beat('it is about 40 x then more words go on'))!.find((x) => x.i === 0)!.at).toBe(0);
    expect(paceParts([lab('4'), part(['x'])], beat('see page 4 now x then more words go on'))!.find((x) => x.i === 0)!.at).toBe(0);
  });

  it('a label\'s numbers and words name it only when its id\'s words are not said; a data-say is the only name', () => {
    expect(labelNames('current 1.5 m/s')).toEqual(['1.5', 'current']);
    expect(labelNames('lands 120 m downstream', true)).toEqual(['120', 'lands', 'downstream']);
    const w = beat('the drift is 120 metres and the boat lands downstream');
    expect(paceParts([part(['drift'], labelNames('120 m')), part(['x'])], w)![0].at).toBe(300); // its id first
    expect(paceParts([part(['gone'], labelNames('120 m')), part(['x'])], w)![0].at).toBe(900); // else its label
  });

  it('a naming word already spoken when the group starts draws the part now', () => {
    // Held by the look: the beat began 1 s ago and "cap" was its second word (clamped to now).
    const w: BeatWord[] = [{ text: 'the', inMs: 0, endMs: 0 }, { text: 'cap', inMs: 0, endMs: 0 }, ...beat('is high and then it falls away slowly here').map((x) => ({ ...x, inMs: x.inMs + 300, endMs: x.endMs! + 300 }))];
    const t = paceParts([part(), part(['cap'])], w, undefined, -1000)!;
    expect(t.find((x) => x.i === 1)!.at).toBe(0);
  });

  it('a name said outside the group\'s slot is not taken (another group draws then)', () => {
    const w = beat('the cap here then a b c d e f g h i j k');
    const t = paceParts([part(['cap'])], w, { k: 1, n: 2 })!;
    expect(t[0].at).toBe(beatWindow(w, { k: 1, n: 2 }).from);
  });

  it('re-planned mid-beat (more words streamed in): the parts left spread over what is left, from now', () => {
    // The beat began 3 s ago and now runs 6 s more: two parts left share [0, 6000).
    const w = beat(Array(20).fill('w').join(' '));
    const t = paceParts([part(), part()], w, undefined, -3000)!;
    expect(t.map((x) => x.at)).toEqual([0, 3000]);
    // A slot is its share of the whole beat (began 3 s ago, 9 s long): the first half has 1.5 s left.
    const k0 = paceParts([part()], w, { k: 0, n: 2 }, -3000)!;
    expect(k0[0]).toMatchObject({ at: 0, dur: 1500 - PART_GAP_MS });
    const k1 = paceParts([part()], w, { k: 1, n: 2 }, -3000)!;
    expect(k1[0].at).toBe(1500);
  });

  it('splits a part\'s time over its strokes in proportion to their pen time', () => {
    expect(splitPart(1200, [100, 200, 300])).toEqual([200, 400, 600]);
    expect(splitPart(900, [0, 0, 0])).toEqual([300, 300, 300]);
  });
});

const w = (text: string): ScriptEvent => ({ type: 'word', text });
const words = (s: string) => s.split(' ').map(w);
const svg = (id: string): ScriptEvent => ({ type: 'action', action: { kind: 'svg', id, svg: `<g id="${id}"/>` } as Action });
const END: ScriptEvent = { type: 'end' };
const BEAT: ScriptEvent = { type: 'action', action: { kind: 'beat' } };

describe('pace: the scheduler', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => vi.useRealTimers());

  function run(events: ScriptEvent[], clock = new PacedClock(() => 170, () => Date.now(), () => 100)) {
    const heard: Record<string, number> = {};
    const t0 = Date.now();
    const fired: { id?: string; slot?: { k: number; n: number }; beat: BeatWord[] }[] = [];
    const s: Scheduler = new Scheduler(clock, {
      onWord: (t, i) => { heard[`${i}:${t}`] = Date.now() - t0; },
      onAction: (a) => { if (a.kind === 'svg') fired.push({ id: a.id, slot: a.slot, beat: s.beatWords() }); },
      onDone: () => {},
    }, { leadMs: () => 0 });
    s.push(events);
    vi.advanceTimersByTime(20000);
    return { heard, fired };
  }

  it('rests REST_MS after a drawn beat, before the next beat\'s first sentence (not before the first beat)', () => {
    const { heard } = run([...words('Look here.'), svg('one'), ...words('The curve falls.'), svg('two'), ...words('Then it flattens.'), END]);
    // 100 ms a word: the first beat follows the opener directly; the second waits REST_MS more.
    expect(heard['2:The']).toBe(200);
    expect(heard['4:falls.']).toBe(400);
    expect(heard['5:Then']).toBe(500 + REST_MS);
    expect(heard['7:flattens.']).toBe(700 + REST_MS);
  });

  it('no rest inside a sentence, nor for a group the narration already named', () => {
    const { heard } = run([...words('Look here.'), svg('one'), ...words('The curve falls'), svg('two'), ...words('and then flattens.'), END]);
    expect(heard['5:and']).toBe(500);
    const named = run([...words('Look here.'), svg('one'), ...words('The curve falls. The slope'), svg('slope'), ...words('is flat.'), END]);
    expect(named.heard['5:The']).toBe(500); // "slope" named the group in this beat: no beat boundary
  });

  it('groups that come together get their slot of the beat; a group alone gets none', () => {
    const { fired } = run([...words('Look here.'), svg('axes'), svg('curve'), ...words('The curve falls.'), svg('dot'), ...words('Here it is.'), END]);
    expect(fired.map((f) => [f.id, f.slot ?? null])).toEqual([['axes', { k: 0, n: 2 }], ['curve', { k: 1, n: 2 }], ['dot', null]]);
    // Both see the whole beat, up to the next group.
    expect(fired[0].beat.map((x) => x.text)).toEqual(['The', 'curve', 'falls.']);
    expect(fired[1].beat.map((x) => x.text)).toEqual(['The', 'curve', 'falls.']);
  });

  it('beatWords marks a beat still streaming open, and closes it once the next group (or the end) comes', () => {
    vi.setSystemTime(0);
    const seen: BeatWord[][] = [];
    const s: Scheduler = new Scheduler(new PacedClock(() => 170, () => Date.now(), () => 100), {
      onWord: () => {}, onAction: (a) => { if (a.kind === 'svg') seen.push(s.beatWords()); }, onDone: () => {},
    }, { leadMs: () => 0 });
    s.push([...words('Look here.'), svg('one'), ...words('The curve falls.')]);
    vi.advanceTimersByTime(250);
    expect(seen[0].at(-1)!.open).toBe(true);
    s.push([svg('two')]);
    expect(s.beatWords().at(-1)!.open).toBeUndefined();
    s.stop();
  });

  it('a group waits for its beat\'s first word: never flushed into the silence while the gate holds its words', () => {
    vi.setSystemTime(0);
    const fired: [string, number][] = [];
    const s: Scheduler = new Scheduler(new PacedClock(() => 170, () => Date.now(), () => 100), {
      onWord: () => {}, onAction: (a) => { if (a.kind === 'svg') fired.push([a.id!, Date.now()]); }, onDone: () => {},
    }, { leadMs: () => 0 });
    s.push([...words('Look here.'), BEAT, svg('river')]); // the gate still checking the river beat's words
    vi.advanceTimersByTime(5000);
    expect(fired).toEqual([]); // it used to fire at the narration's end + FLUSH_MS, over a guessed 6 s
    s.push([...words('The river runs east.'), END]);
    vi.advanceTimersByTime(5000);
    expect(fired).toEqual([['river', 5000]]);
    s.stop();
  });

  it('a group reads its own beat\'s words, to the next {{beat}}, even once the next beat\'s group has fired', () => {
    vi.setSystemTime(0);
    const seen: Record<string, number> = {};
    const s: Scheduler = new Scheduler(new PacedClock(() => 170, () => Date.now(), () => 100), {
      onWord: () => {}, onAction: (a) => { if (a.kind === 'svg') seen[a.id!] = a.beatFrom!; }, onDone: () => {},
    }, { leadMs: () => 0 });
    s.push([...words('Look here.'), BEAT, svg('river'), ...words('The river runs east.'), BEAT, svg('drift'), ...words('The boat drifts.'), END]);
    vi.advanceTimersByTime(1000); // both fired, the drift beat under way
    expect(seen).toEqual({ river: 2, drift: 6 });
    expect(s.beatWords(seen.river).map((x) => x.text)).toEqual(['The', 'river', 'runs', 'east.']);
    expect(s.beatWords(seen.river).at(-1)!.open).toBeUndefined();
    expect(s.beatWords().map((x) => x.text)).toEqual(['boat', 'drifts.']); // the old read: the next beat's words
    s.stop();
  });

  it('beatWords tells how long ago its beat\'s first word started, once it has', () => {
    vi.setSystemTime(0);
    let from = -1;
    const s: Scheduler = new Scheduler(new PacedClock(() => 170, () => Date.now(), () => 100), {
      onWord: () => {}, onAction: (a) => { if (a.kind === 'svg') from = a.beatFrom!; }, onDone: () => {},
    }, { leadMs: () => 0 });
    s.push([...words('Look here.'), BEAT, svg('river'), ...words('The river runs east,')]);
    vi.advanceTimersByTime(200);
    expect(s.beatWords(from)[0].sinceMs).toBeUndefined(); // its first word starts now
    vi.advanceTimersByTime(250);
    expect(s.beatWords(from)[0]).toMatchObject({ text: 'The', inMs: 0, sinceMs: 250 });
    s.stop();
  });

  it('a beat still streaming stays open until its next {{beat}} comes', () => {
    vi.setSystemTime(0);
    let from = -1;
    const s: Scheduler = new Scheduler(new PacedClock(() => 170, () => Date.now(), () => 100), {
      onWord: () => {}, onAction: (a) => { if (a.kind === 'svg') from = a.beatFrom!; }, onDone: () => {},
    }, { leadMs: () => 0 });
    s.push([...words('Look here.'), BEAT, svg('river'), ...words('The river runs,')]);
    vi.advanceTimersByTime(250);
    expect(from).toBe(2);
    expect(s.beatWords(from).at(-1)!.open).toBe(true);
    s.push([...words('east.'), BEAT]);
    expect(s.beatWords(from).map((x) => x.text)).toEqual(['The', 'river', 'runs,', 'east.']);
    expect(s.beatWords(from).at(-1)!.open).toBeUndefined();
    s.stop();
  });

  it('beatWords gives each word\'s end on the paced clock', () => {
    const { fired } = run([...words('Look here.'), svg('one'), ...words('The curve falls.'), END]);
    expect(fired[0].beat).toEqual([
      { text: 'The', inMs: 0, endMs: 100 }, { text: 'curve', inMs: 100, endMs: 200 }, { text: 'falls.', inMs: 200, endMs: 300 },
    ]);
  });
});

describe('pace: the paced clock keeps its rests', () => {
  it('a rest is silence before the word, at the playback rate, and survives a re-time after it', () => {
    let rate = 1;
    const c = new PacedClock(() => 170, () => 0, () => 100, () => rate);
    c.enqueue('a'); c.enqueue('b.'); c.enqueue('c', REST_MS); c.enqueue('d');
    expect([0, 1, 2, 3].map((i) => c.wordStart(i))).toEqual([0, 100, 200 + REST_MS, 300 + REST_MS]);
    rate = 2;
    c.retime(1, 1000); // a respeed from word 1: the rest before word 2 stays, halved
    expect([1, 2, 3].map((i) => c.wordStart(i))).toEqual([1000, 1050 + REST_MS / 2, 1100 + REST_MS / 2]);
    c.retime(2, 5000); // a resume on the rested word itself: it starts at the given time
    expect(c.wordStart(2)).toBe(5000);
  });
});

/** PCM lasting `ms`. */
const pcmOf = (ms: number) => new Int16Array(Math.round((ms / 1000) * SAMPLE_RATE));
function fakeVoice() {
  const asked: { text: string; resolve(ms: number | null): void }[] = [];
  const speak: Speak = (text) => new Promise((res) => asked.push({ text, resolve: (ms) => res(ms == null ? null : pcmOf(ms)) }));
  const played: { at: number }[] = [];
  const out: AudioOut = { play(_pcm, at) { played.push({ at }); return { stop: () => {} }; } };
  return { asked, speak, out, played };
}

describe('pace: the voiced clock', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => vi.useRealTimers());

  it('a rest goes between pieces: the next piece plays REST_MS after the last one ends', async () => {
    const v = fakeVoice();
    const c = new VoiceClock(v.speak, v.out, () => 170, () => 1, () => Date.now());
    'The curve falls.'.split(' ').forEach((x) => c.enqueue(x));
    c.enqueue('Then', REST_MS);
    'it flattens.'.split(' ').forEach((x) => c.enqueue(x));
    expect(v.asked.map((a) => a.text)).toEqual(['The curve falls.', 'Then it flattens.']);
    v.asked[0].resolve(1000); v.asked[1].resolve(800);
    await vi.advanceTimersByTimeAsync(0);
    expect(v.played.map((p) => p.at)).toEqual([0, 1000 + REST_MS]);
    expect(c.wordStart(3)).toBe(1000 + REST_MS);
  });

  it('a rest closes a piece still open (the words before it go out alone)', () => {
    const v = fakeVoice();
    const c = new VoiceClock(v.speak, v.out, () => 170, () => 1, () => Date.now());
    'and so the curve'.split(' ').forEach((x) => c.enqueue(x));
    c.enqueue('falls.', REST_MS);
    expect(v.asked.map((a) => a.text)).toEqual(['and so the curve', 'falls.']);
  });

  it('the beat\'s words are timed by the audio: the parts draw across the real speech', async () => {
    const v = fakeVoice();
    const c = new VoiceClock(v.speak, v.out, () => 170, () => 1, () => Date.now());
    const fired: BeatWord[][] = [];
    const s: Scheduler = new Scheduler(c, { onWord: () => {}, onAction: (a) => { if (a.kind === 'svg') fired.push(s.beatWords()); }, onDone: () => {} }, { leadMs: () => 0 });
    s.push([...words('Look here.'), svg('one'), ...words('The curve falls slowly, then it flattens out.'), END]);
    await vi.advanceTimersByTimeAsync(0);
    // A slow voice: the opener 1 s, the beat 4 s.
    v.asked[0].resolve(1000);
    for (const a of v.asked.slice(1)) a.resolve(4000);
    await vi.advanceTimersByTimeAsync(1100);
    expect(fired).toHaveLength(1);
    const b = fired[0];
    expect(b[0].text).toBe('The');
    expect(b[b.length - 1].endMs!).toBeGreaterThan(3500); // the audio's 4 s, not the reading pace's ~2.5 s
    const t = paceParts([part(), part()], b)!;
    expect(t[1].at).toBeGreaterThan(1700);
    expect(t[0].dur).toBeGreaterThan(1700);
  });
});
