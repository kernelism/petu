// Pacing the drawing to the speech (founder 2026-10-30: "drawing races, explanation races"): the
// timing math (src/playback/pace.ts), the scheduler's rest after a drawn beat and the beat's word
// times on both clocks (paced and voiced).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { beatWindow, partWords, paceParts, splitPart, PART_MIN_MS, PART_MAX_MS, PART_GAP_MS, REST_MS, SPAN_MIN_MS, type BeatWord } from '../../src/playback/pace';
import { PacedClock } from '../../src/playback/clock';
import { Scheduler, namesWord } from '../../src/playback/scheduler';
import { VoiceClock, SAMPLE_RATE, type AudioOut, type Speak } from '../../src/playback/voiceClock';
import type { Action, ScriptEvent } from '../../src/script/types';

/** Words `ms` apart, starting now. */
const beat = (text: string, ms = 300): BeatWord[] => text.split(' ').map((t, i) => ({ text: t, inMs: i * ms, endMs: (i + 1) * ms }));
const part = (cat = 1, words: string[] = [], naturalMs = 300) => ({ cat, words, naturalMs });

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
    const t = paceParts([part(1, partWords('masses-out', 'masses')), part(1, partWords('masses-in', 'masses'))], w)!;
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
  it('a word with no end time counts a word\'s length', () => {
    expect(beatWindow([{ text: 'a', inMs: 0 }, { text: 'b', inMs: 2000 }]).to).toBe(2300);
  });
});

describe('pace: each part draws across its share of the words', () => {
  it('needs at least two words (else pen speed: null)', () => {
    expect(paceParts([part()], beat('one'))).toBeNull();
    expect(paceParts([part()], [])).toBeNull();
    expect(paceParts([], beat('a b c'))).toBeNull();
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

  it('a short share gets the minimum', () => {
    // Two parts named on neighbouring words: the first still draws PART_MIN_MS.
    const t = paceParts([part(1, ['curve']), part(1, ['peak'])], beat('the curve peak rises here and falls slowly again'))!;
    expect(t[0]).toMatchObject({ i: 0, at: 300, dur: PART_MIN_MS });
    expect(t[1]).toMatchObject({ i: 1, at: 600 });
  });

  it('many parts in a short beat share it: the minimum gives way, the drawing ends with the beat', () => {
    const n = 20;
    const t = paceParts(Array.from({ length: n }, () => part()), beat('a b c d e f'))!; // a 1.8 s beat
    const end = t[t.length - 1].at + t[t.length - 1].dur;
    expect(t.every((x) => x.dur < PART_MIN_MS)).toBe(true);
    expect(end).toBeLessThanOrEqual(1800 + 120);
  });

  it('a named part starts on the word that names it; the others keep pen order around it', () => {
    const parts = [part(3, ['label']), part(0), part(1, ['cap'])]; // a label, a frame, a line named "cap"
    const t = paceParts(parts, beat('here the frame and then this line is the cap at five hundred dollars'))!;
    const byI = Object.fromEntries(t.map((x) => [x.i, x]));
    expect(byI[1].at).toBe(0); // the frame first
    expect(byI[2].at).toBe(9 * 300); // "cap" is word 9
    expect(byI[0].at).toBe(2800); // the unnamed label keeps its pen-order place (2 of 3 over 4.2 s)
    expect(t.map((x) => x.i)).toEqual([1, 2, 0]); // drawn in time order
    expect(t.every((x, j) => j === 0 || x.at >= t[j - 1].at)).toBe(true);
  });

  it('a name said outside the group\'s slot is not taken (another group draws then)', () => {
    const w = beat('the cap here then a b c d e f g h i j k');
    const t = paceParts([part(1, ['cap'])], w, { k: 1, n: 2 })!;
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
