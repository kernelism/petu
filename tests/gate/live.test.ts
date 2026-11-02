import { describe, expect, it } from 'vitest';
import { GatePreflight, LiveGate, QUOTE_UNSAID, type Preflight, type PreflightResult, type PreflightUnit, type ShadowBoard } from '../../src/gate/live';
import { parseFaults } from '../../src/gate/faults';
import { SvgBeatFilter } from '../../server/svgBeats';
import type { GateEvent, GateLogEvent, RepairFn, RepairEvent } from '../../src/gate/events';
import type { RawAction } from '../../src/script/types';

/** A fake timeline: `now` moves only when advanced; sleeps resolve in time order. */
class FakeTime {
  t = 0;
  private timers: { at: number; r: () => void }[] = [];
  now = () => this.t;
  sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((r) => {
    const e = { at: this.t + Math.max(0, ms), r };
    this.timers.push(e);
    signal?.addEventListener('abort', () => { this.timers = this.timers.filter((x) => x !== e); r(); }, { once: true });
  });
  advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at);
      const n = this.timers[0];
      if (!n || n.at > end) break;
      this.timers.shift();
      this.t = n.at;
      n.r();
    }
    this.t = end;
  }
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

/** Narration plays 300 ms a word, starting when released (the clock's endsAt). */
function harness(o: { preflight: Preflight; repair?: RepairFn; gatefail?: string; headroomMs?: number }) {
  const time = new FakeTime();
  let ends = 0;
  const events: GateLogEvent[] = [];
  const clock = { now: time.now, endsAt: () => ends };
  const gate = new LiveGate({ clock, preflight: o.preflight, repair: o.repair, faults: parseFaults(o.gatefail), headroomMs: o.headroomMs ?? 6000, onEvent: (e) => events.push(e), sleep: time.sleep });
  const out: string[] = [];
  async function play(chunks: (string | { handoff: true } | { wait: number })[]) {
    const src = async function* () {
      for (const c of chunks) {
        if (typeof c === 'string') yield c;
        else if ('handoff' in c) gate.handoff();
        else await time.sleep(c.wait);
      }
    };
    const it = gate.wrap(src)(new AbortController().signal)[Symbol.asyncIterator]();
    let done = false;
    const consume = (async () => {
      for (;;) {
        const r = await it.next();
        if (r.done) break;
        out.push(r.value);
        const w = r.value.split(/\s+/).filter((x) => x && !x.startsWith('{{')).length;
        ends = Math.max(ends, time.t) + 300 * w;
      }
      done = true;
    })();
    for (let i = 0; i < 2000 && !done; i++) { await flush(); time.advance(50); }
    await consume;
  }
  return { gate, time, events, out, play, gates: () => events.filter((e): e is GateEvent => e.t === 'gate'), repairs: () => events.filter((e): e is RepairEvent => e.t === 'repair') };
}

/** A preflight that fails any unit containing BAD (skipping that tag), STRIPME (a page highlight), or FIXME. */
function fakePreflight(): Preflight & { accepted: string[] } {
  const accepted: string[] = [];
  return {
    accepted,
    check(u: PreflightUnit): PreflightResult {
      const tags = [...u.text.matchAll(/\{\{([^}]*)\}\}/g)].map((m) => {
        const body = m[1];
        const action = (body.startsWith('highlight') ? { kind: 'highlight', page: 1, quote: 'x' } : body.startsWith('emph') ? { kind: 'emph', ref: 'a' } : { kind: 'point', region: 's', at: { x: 0, y: 0 } }) as unknown as RawAction;
        const skipped = /BAD|STRIPME/.test(body) || (u.fault && m.index === u.text.indexOf('{{')) ? 'skip' : undefined;
        return { start: m.index!, end: m.index! + m[0].length, body, action, ...(skipped ? { skipped } : {}) };
      });
      const flags = [
        ...tags.filter((t) => t.skipped).map((t) => ({ check: 'tag', detail: `${t.action!.kind} skipped: ${t.skipped}` })),
        ...(/FIXME/.test(u.text) ? [{ check: 'number', detail: 'FIXME' }] : []),
      ];
      return { flags, notes: [], tags };
    },
    accept(u) { accepted.push(u.text); },
    reject() {},
  };
}

const LONG = 'one two three four five six seven eight nine ten eleven twelve thirteen.';

describe('LiveGate', () => {
  it('releases passing units in order, opener chunks as units, stage 2 as sentences then beats', async () => {
    const h = harness({ preflight: fakePreflight() });
    await h.play(['Opener clause one, ', 'clause two. ', { handoff: true }, 'First stage two sentence. ', `Second ${LONG} `, 'Third. ']);
    expect(h.out.join('')).toBe('Opener clause one, clause two. First stage two sentence. Second ' + LONG + ' Third. ');
    const g = h.gates();
    expect(g.slice(0, 2).map((e) => [e.k, e.unit])).toEqual([['o0', 'opener'], ['o1', 'opener']]);
    expect(g.every((e) => e.result === 'pass' && e.action === 'release')).toBe(true);
  });

  it('drops a failing unit whole: none of its words or tags reach the session (I2/I3)', async () => {
    const h = harness({ preflight: fakePreflight() });
    await h.play([{ handoff: true }, 'Good one. ', 'Look {{point BAD}} at this point. ', 'Good two. ']);
    expect(h.out.join('')).toBe('Good one. Good two. ');
    expect(h.gates().find((e) => e.action === 'drop')).toMatchObject({ k: '1', result: 'fail', words: 4 });
    expect(h.gate.stats).toMatchObject({ drops: 1, droppedWords: 4 });
  });

  it('a beat withheld for its words withholds its drawing too: never a drawing without its words (I3)', async () => {
    const h = harness({ preflight: fakePreflight() });
    await h.play([{ handoff: true }, 'Good one. ', 'Mid FIXME words. {{svg <g id="gate"><line x1="0" y1="0" x2="9" y2="9"/></g>}} ', 'Good two. ']);
    const text = h.out.join('');
    expect(text).not.toContain('FIXME');
    expect(text).not.toContain('<g id="gate">');
    expect(text).toContain('Good two.');
    expect(h.gates().find((e) => e.action === 'drop')).toMatchObject({ k: '1', result: 'fail' });
  });

  it('a beat withheld for another tag withholds its group with it; the next beat plays with its own group only', async () => {
    const h = harness({ preflight: fakePreflight() });
    await h.play([{ handoff: true }, 'Good one. {{svgboard h=600}} {{beat}} ', '{{svg <g id="g1"><line x1="0" y1="0" x2="9" y2="9"/></g>}} Look {{point BAD}} here. ', '{{beat}} {{svg <g id="g2"><line x1="0" y1="0" x2="9" y2="9"/></g>}} Good two. ']);
    const text = h.out.join('');
    expect(text).not.toContain('BAD');
    expect(text).not.toContain('<g id="g1">');
    expect(text).toContain('{{svg <g id="g2">');
    // The survivor draws with its own words, never re-homed onto another beat's.
    expect(text.indexOf('<g id="g2">')).toBeLessThan(text.indexOf('Good two.'));
    expect(text).toContain('{{svgboard h=600}}');
  });

  it('a group that itself failed is dropped with its unit', async () => {
    const h = harness({ preflight: fakePreflight() });
    await h.play([{ handoff: true }, 'Good one. ', 'Look here. {{svg <g id="BAD"></g>}} ', 'Good two. ']);
    expect(h.out.join('')).not.toContain('svg');
  });

  it('rent, 155 wpm (synthetic): a beat withheld for its words takes its own group with it; the beats around it draw with their own words', async () => {
    // The recorded rent answer's structure: a group, then a beat the gate withholds (a number and a page
    // highlight that fail), then the next beat. Before the beat wire (2026-10-31) the withheld beat's words went and the next
    // beat's group, riding at its end, drew under the wrong words.
    const h = harness({ preflight: fakePreflight(), headroomMs: 1000 });
    await h.play([{ handoff: true },
      `{{svgboard h=670}} {{beat}} {{svg <g id="rent"><line x1="0" y1="0" x2="9" y2="9"/></g>}} Here ${LONG} `, { wait: 300 },
      `A ceiling binds ${LONG} `, { wait: 300 },
      '{{beat}} {{svg <g id="shortage"><line x1="0" y1="9" x2="9" y2="9"/></g>}} ',
      'Look at {{highlight STRIPME}} the quantities: that leaves FIXME units of unmet demand. ',
      '{{beat}} {{svg <g id="outcomes"><circle cx="5" cy="5" r="3"/></g>}} ',
      'A tenant who secures an apartment pays less. ', 'Landlords receive less per apartment. ']);
    const text = h.out.join('');
    expect(text).not.toContain('FIXME');
    expect(text).not.toContain('<g id="shortage">');
    for (const id of ['rent', 'outcomes']) expect(text, id).toContain(`<g id="${id}">`);
    expect(text.indexOf('<g id="outcomes">')).toBeLessThan(text.indexOf('A tenant'));
    expect(text.indexOf('<g id="outcomes">')).toBeGreaterThan(text.indexOf(`A ceiling binds ${LONG}`));
  });

  it('a repair that fails its re-check withholds the beat whole (its group too)', async () => {
    const h = harness({ preflight: fakePreflight(), headroomMs: 1000, repair: async () => ({ ok: true, text: 'Still FIXME here. {{svg <g id="kept"><line x1="0" y1="0" x2="9" y2="9"/></g>}}' }) });
    await h.play([{ handoff: true }, `Intro ${LONG} `, { wait: 300 }, `So ${LONG} `, { wait: 300 }, 'Mid FIXME words. {{svg <g id="kept"><line x1="0" y1="0" x2="9" y2="9"/></g>}} ', 'Last. ']);
    expect(h.repairs().map((e) => e.phase)).toEqual(['sent', 'ok', 'fail']);
    const text = h.out.join('');
    expect(text).not.toContain('FIXME');
    expect(text).not.toContain('<g id="kept">');
    expect(text).toContain('Last.');
  });

  it('a repair that comes back as words alone is not released: the beat drew, so its replacement draws (a5, a32)', async () => {
    const h = harness({ preflight: fakePreflight(), headroomMs: 1000, repair: async () => ({ ok: true, text: 'Where supply meets demand, the price is seven.' }) });
    await h.play([{ handoff: true }, `Intro ${LONG} `, { wait: 300 }, `So ${LONG} `, { wait: 300 }, 'Mid FIXME words. {{svg <g id="eq"><circle cx="5" cy="5" r="3"/></g>}} ', 'Last. ']);
    expect(h.repairs().map((e) => e.phase)).toEqual(['sent', 'ok', 'fail']);
    const text = h.out.join('');
    expect(text).not.toContain('supply meets demand');
    expect(text).not.toContain('<g id="eq">');
    expect(h.gates().some((e) => e.action === 'drop' && e.notes.some((n) => /left out the beat's drawing/.test(n)))).toBe(true);
  });

  it('a repair of the unit that opened the board keeps its {{svgboard}} tag when the repair wrote none (lec06 turn 3: every group was skipped, unknown region)', async () => {
    const h = harness({ preflight: fakePreflight(), headroomMs: 1000, repair: async () => ({ ok: true, text: 'Fixed words here. {{svg <g id="orientation"><line x1="0" y1="0" x2="9" y2="9"/></g>}} ' }) });
    await h.play([{ handoff: true }, `Intro ${LONG} `, { wait: 300 }, `So ${LONG} `, { wait: 300 }, '{{svgboard h=1580}} {{svg <g id="orientation"><line x1="0" y1="0" x2="9" y2="9"/></g>}} First FIXME beat. ', 'Last. ']);
    expect(h.repairs().map((e) => e.phase)).toEqual(['sent', 'ok']);
    const text = h.out.join('');
    expect(text).not.toContain('FIXME');
    expect(text).toContain('{{svgboard h=1580}}');
    expect(text.indexOf('{{svgboard')).toBeLessThan(text.indexOf('<g id="orientation">'));
    expect(text.match(/\{\{svgboard/g)!.length).toBe(1);
  });

  it('a late repair withholds the beat whole', async () => {
    const h = harness({
      preflight: fakePreflight(), headroomMs: 1000,
      repair: (_req, signal) => new Promise((r) => { signal.addEventListener('abort', () => r({ ok: false, reason: 'error' })); }),
    });
    await h.play([{ handoff: true }, `Intro ${LONG} `, { wait: 300 }, `So ${LONG} `, { wait: 300 }, 'Mid FIXME words. {{svg <g id="kept"><line x1="0" y1="0" x2="9" y2="9"/></g>}} ', 'Last. ']);
    expect(h.out.join('')).not.toContain('<g id="kept">');
    expect(h.out.join('')).toContain('Last.');
  });

  it('strips a failed page highlight when nothing later names it, and releases the rest', async () => {
    const h = harness({ preflight: fakePreflight() });
    await h.play([{ handoff: true }, 'The rate {{highlight STRIPME}} doubles. ', 'Then it settles. ']);
    expect(h.out.join('')).toBe('The rate doubles. Then it settles. ');
    expect(h.gates()[0]).toMatchObject({ result: 'strip', action: 'release', stripped: ['{{highlight STRIPME}}'] });
  });

  it('never strips board construction', async () => {
    const h = harness({ preflight: fakePreflight() });
    await h.play([{ handoff: true }, 'Draw {{point BAD}} it. ', 'Next. ']);
    expect(h.out.join('')).toBe(' Next. ');
  });

  it('repairs a failed beat in beat mode: the report goes out, the replacement plays in its place', async () => {
    const asked: Parameters<RepairFn>[0][] = [];
    const h = harness({
      preflight: fakePreflight(), headroomMs: 1000,
      repair: async (req) => { asked.push(req); return { ok: true, text: 'A plain replacement sentence.' }; },
    });
    await h.play([{ handoff: true }, `Intro ${LONG} `, { wait: 300 }, `So ${LONG} `, { wait: 300 }, 'Mid FIXME words. ', `More ${LONG} `, 'Last. ']);
    expect(asked).toHaveLength(1);
    expect(asked[0].beat).toContain('FIXME');
    expect(asked[0].report.problems[0]).toMatchObject({ check: 'number' });
    expect(asked[0].committed).toContain('Intro');
    const text = h.out.join('');
    expect(text).not.toContain('FIXME');
    expect(text).toContain('A plain replacement sentence.');
    expect(h.repairs().map((e) => e.phase)).toEqual(['sent', 'ok']);
  });

  it('a repaired svg beat draws into the open board: a BOARD tag in the repair is dropped (one frame per board)', async () => {
    // The founder's yo-yo answer: the repair stream opened `{{svgboard h=700}}` before `<g id="arm">`,
    // so the arm opened a second section and landed below the second figure.
    const h = harness({
      preflight: fakePreflight(), headroomMs: 1000,
      repair: async () => ({ ok: true, text: '{{svgboard h=700}} {{svg <g id="arm"><line x1="300" y1="450" x2="300" y2="350"/></g>}} The lever arm is this gap.' }),
    });
    await h.play([{ handoff: true }, `{{svgboard h=900}} Intro ${LONG} `, { wait: 300 }, `So ${LONG} `, { wait: 300 }, 'Mid FIXME words. ', `More ${LONG} `, 'Last. ']);
    const text = h.out.join('');
    expect(text.match(/\{\{svgboard/g)).toHaveLength(1);
    expect(text).toContain('{{svgboard h=900}}');
    expect(text).toContain('<g id="arm">');
  });

  it('a late repair is aborted at the deadline and the beat dropped', async () => {
    let aborted = false;
    const h = harness({
      preflight: fakePreflight(), headroomMs: 1000,
      repair: (_req, signal) => new Promise((r) => { signal.addEventListener('abort', () => { aborted = true; r({ ok: false, reason: 'error' }); }); }),
    });
    await h.play([{ handoff: true }, `Intro ${LONG} `, { wait: 300 }, `So ${LONG} `, { wait: 300 }, 'Mid FIXME words. ', 'Last. ']);
    expect(aborted).toBe(true);
    expect(h.repairs().map((e) => e.phase)).toEqual(['sent', 'late']);
    expect(h.out.join('')).not.toContain('FIXME');
    expect(h.gates().some((e) => e.action === 'drop')).toBe(true);
  });

  it('a repair that fails its re-check is dropped, never repaired twice', async () => {
    let n = 0;
    const h = harness({ preflight: fakePreflight(), headroomMs: 1000, repair: async () => { n++; return { ok: true, text: 'Still FIXME here.' }; } });
    await h.play([{ handoff: true }, `Intro ${LONG} `, { wait: 300 }, `So ${LONG} `, { wait: 300 }, 'Mid FIXME words. ', 'Last. ']);
    expect(n).toBe(1);
    expect(h.repairs().map((e) => e.phase)).toEqual(['sent', 'ok', 'fail']);
    expect(h.out.join('')).not.toContain('FIXME');
  });

  it('no repair in sentence mode, at most MAX_REPAIRS per answer', async () => {
    let n = 0;
    const repair: RepairFn = async () => { n++; return { ok: true, text: 'Fixed.' }; };
    const s = harness({ preflight: fakePreflight(), headroomMs: 1e9, repair });
    await s.play([{ handoff: true }, 'A. ', 'FIXME. ', 'B. ']);
    expect(n).toBe(0);
    expect(s.out.join('')).toBe('A. B. ');
    const m = harness({ preflight: fakePreflight(), headroomMs: 1000, repair });
    await m.play([{ handoff: true }, `Intro ${LONG} `, { wait: 300 }, `\n\nSo ${LONG} FIXME a. `, { wait: 300 }, `\n\nx ${LONG} FIXME b. `, { wait: 300 }, `\n\ny ${LONG} FIXME c. `, { wait: 300 }, '\n\nEnd. ']);
    expect(n).toBe(2);
  });

  it('&gatefail injects a skip; :ok repairs with a fake fix, :bad returns the original (dropped)', async () => {
    const ok = harness({ preflight: fakePreflight(), headroomMs: 1000, gatefail: '1:ok' });
    await ok.play([{ handoff: true }, `Intro ${LONG} `, { wait: 300 }, `So ${LONG} `, { wait: 300 }, 'Notice {{point A}} the point here. ', `End ${LONG} `]);
    expect(ok.repairs().map((e) => e.phase)).toEqual(['sent', 'ok']);
    expect(ok.out.join('')).toContain('the point here.');
    expect(ok.out.join('')).not.toContain('{{point A}}');
    const bad = harness({ preflight: fakePreflight(), headroomMs: 1000, gatefail: '1:bad' });
    await bad.play([{ handoff: true }, `Intro ${LONG} `, { wait: 300 }, `So ${LONG} `, { wait: 300 }, 'Notice {{point A}} the point here. ', `End ${LONG} `]);
    expect(bad.out.join('')).not.toContain('point here');
  });

  // Evidence: draw run 5b74be89 D1/D3/D5 — the opener's last word ("…once it is bound.") was released
  // without the space after it, so the session's parser held the word until stage 2's first sentence
  // was released 2.3 s later: a hold at the seam the gate made. A closed unit carries its boundary.
  it('a released unit ends on a word boundary: its last word never waits for the next unit', async () => {
    const h = harness({ preflight: fakePreflight() });
    await h.play(['The pocket is shared, ', 'more substrate wins once it is bound.', { wait: 3000 }, { handoff: true }, ' ', { wait: 800 }, 'This time, count them. ', { wait: 2000 }, 'Then more. ']);
    expect(h.out.join('')).toBe('The pocket is shared, more substrate wins once it is bound. This time, count them. Then more. ');
    // every piece released before the stream's end closes its last word
    for (const piece of h.out.slice(0, -1)) expect(piece, JSON.stringify(piece)).toMatch(/\s$/);
  });

  it('a stage-2 sentence closes its last word on release even when the next one is slow', async () => {
    const h = harness({ preflight: fakePreflight() });
    await h.play([{ handoff: true }, 'First sentence here. Sec', { wait: 3000 }, 'ond sentence. ']);
    expect(h.out[0]).toBe('First sentence here. ');
    expect(h.out.join('')).toBe('First sentence here. Second sentence. ');
  });

  it('the trailing partial text at the end is one unit', async () => {
    const h = harness({ preflight: fakePreflight() });
    await h.play([{ handoff: true }, 'Done. And then the stream was cut']);
    expect(h.out.join('')).toBe('Done. And then the stream was cut');
  });
});

describe('GatePreflight', () => {
  it('a malformed tag fails its unit; the session parser reads what will play', async () => {
    const p = new GatePreflight();
    const bad = await p.check({ key: '0', kind: 'sentence', text: 'Look {{nonsense x=}} here. ' });
    expect(bad.flags.some((f) => f.check === 'tag')).toBe(true);
    const good = await p.check({ key: '0', kind: 'sentence', text: 'We set {{const v=20}} the speed to twenty. ' });
    expect(good.flags).toEqual([]);
    p.accept({ key: '0', kind: 'sentence', text: 'We set {{const v=20}} the speed to twenty. ' });
    expect(p.text()).toContain('const v=20');
  });

  it('the shadow board’s skip fails the unit; a rejected unit rebuilds the board from the accepted actions', async () => {
    const rebuilt: number[] = [];
    const board: ShadowBoard = {
      apply: (as) => ({ skipped: new Map(as.filter((a) => a.kind === 'circle').map((a) => [a, 'unknown region'])) }),
      rebuild: (acc) => { rebuilt.push(acc.length); },
    };
    const p = new GatePreflight({ board });
    const u = { key: '0', kind: 'sentence' as const, text: 'See {{circle on=zz at=1,1 r=3}} this circle. ' };
    const r = await p.check(u);
    expect(r.flags.map((f) => f.detail)).toContain('circle skipped: unknown region');
    p.reject(u);
    expect(rebuilt).toEqual([0]);
  });
});

describe('live gate: page pointing matches the words (diag C8)', () => {
  const D19 = 'The {{highlight p=9 "slope is constant; P/Q is not."}} Elasticity changes because it measures percentage changes. ';
  const A7 = 'Page 3 starts with the {{highlight p=3 "A point x in image 1 back-projects to a ray in 3D"}} viewing ray: the first pixel fixes a direction. ';

  it('flags a long quote mark whose words the sentence may not say; not one it speaks or one that points', async () => {
    const p = new GatePreflight();
    const r = await p.check({ key: 'o0', kind: 'opener', text: A7 });
    expect(r.tags[0].skipped).toBe(QUOTE_UNSAID);
    expect(r.flags.map((f) => f.check)).toEqual(['tag']);
    for (const text of [D19, 'Here, the {{highlight p=8 "Midpoint method"}} uses the average. ', 'Start with {{highlight p=2 "The demand curve slopes downward"}} demand: buyers want fewer. '])
      expect((await p.check({ key: 'o0', kind: 'opener', text })).flags, text).toEqual([]);
    // The sentence so far counts, across released units: the quote said before the tag is no stand-in.
    p.accept({ key: 'o0', kind: 'opener', text: 'A point x in image 1 back-projects to a ray in 3D, ' });
    expect((await p.check({ key: 'o1', kind: 'opener', text: 'so the {{highlight p=3 "a point x in image 1 back-projects to a ray in 3D"}} viewing ray matters. ' })).flags).toEqual([]);
  });

  it('strips such a mark: the words play as the parser speaks them, without the unsaid highlight', async () => {
    const h = harness({ preflight: new GatePreflight() });
    await h.play([A7, { handoff: true }, 'Done. ']);
    expect(h.out.join('')).toBe('Page 3 starts with the viewing ray: the first pixel fixes a direction. Done. ');
    expect(h.gates()[0]).toMatchObject({ result: 'strip', stripped: [expect.stringContaining('highlight p=3')] });
  });

  it('a stripped mark the sentence used as a word leaves its words in the narration', async () => {
    // The page does not have the quote (the shadow board says so): stripping only the tag would say "Here, the uses…".
    const board: ShadowBoard = { apply: (as) => ({ skipped: new Map(as.filter((a) => a.kind === 'highlight').map((a) => [a, 'quote not found'])) }), rebuild: () => {} };
    const h = harness({ preflight: new GatePreflight({ board }) });
    await h.play(['Ordinary percent change uses the start. Here, the {{highlight p=8 "Midpoint method"}} uses the average instead. ', { handoff: true }, D19, 'Then {{highlight p=9 "a pointer"}} look. ']);
    expect(h.out.join('')).toBe('Ordinary percent change uses the start. Here, the Midpoint method uses the average instead. The slope is constant; P/Q is not. Elasticity changes because it measures percentage changes. Then look. ');
  });
});

describe('live gate: the length budget', () => {
  // Old format (words, then the beat's group) and the new one (a group before the words that name it).
  const beat = (i: number, words = 30) => `\n\n${Array.from({ length: words }, (_, j) => `w${i}x${j}`).join(' ')}. {{svg <g id="g${i}"></g>}} `;
  const check = '\n\nWhat would change if it doubled? ';
  const svgPreflight = (): Preflight => ({ check: () => ({ flags: [], notes: [], tags: [] }), accept() {}, reject() {} });

  it('past the budget, closes at the next beat boundary and plays only the check question', async () => {
    const h = harness({ preflight: svgPreflight() });
    h.gate.setBudget({ capWords: 80 }); // closes once 62 words are out: beat 3 crosses it mid-beat and finishes
    await h.play(['Opener sentence. ', { handoff: true }, beat(1), beat(2), beat(3), beat(4), check]);
    const text = h.out.join('');
    expect(text).toContain('w1x0');
    expect(text).toContain('w3x29.'); // the beat that crossed the budget finished, with its group
    expect(text).toContain('<g id="g3">');
    expect(text).not.toContain('w4x0');
    expect(text).not.toContain('g4');
    expect(text.trim().endsWith('What would change if it doubled?')).toBe(true);
    const cuts = h.gates().filter((g) => g.action === 'cut');
    expect(cuts.length).toBeGreaterThan(0);
    expect(h.gates().some((g) => g.action === 'drop')).toBe(false);
    expect(h.gate.closed()).toBe(true);
  });

  it('never splits a beat from its group (the filter\'s {{beat}} boundaries: group first, then its words)', async () => {
    const h = harness({ preflight: svgPreflight() });
    h.gate.setBudget({ capWords: 40 });
    const nb = (i: number) => `<g id="curve${i}"></g>\ncurve${i} ${Array.from({ length: 24 }, (_, j) => `v${i}x${j}`).join(' ')}.\n`;
    const f = new SvgBeatFilter(() => 0);
    // The question is a beat of its own (a beat is whole: a question inside the last beat keeps all of it).
    const wire = f.push(`First words here. <plan>BOARD viewBox="0 0 560 400"</plan>\n${nb(1)}${nb(2)}${nb(3)}<g id="ask"></g>`) + f.push(check) + f.end();
    await h.play(['Opener. ', { handoff: true }, ...wire.match(/[\s\S]{1,40}/g)!]);
    const text = h.out.join('');
    for (const i of [1, 2, 3]) expect(text.includes(`curve${i}"`), `group ${i}`).toBe(text.includes(`v${i}x0`));
    expect(text).not.toContain('v3x0');
    expect(text.trim().endsWith('doubled?')).toBe(true);
  });

  it('within the budget (or without one) everything plays', async () => {
    for (const cap of [1000, 0]) {
      const h = harness({ preflight: svgPreflight() });
      if (cap) h.gate.setBudget({ capWords: cap });
      await h.play(['Opener. ', { handoff: true }, beat(1), beat(2), check]);
      expect(h.out.join('')).toContain('w2x29');
      expect(h.out.join('')).toContain('doubled?');
      expect(h.gates().some((g) => g.action === 'cut')).toBe(false);
    }
  });

  it('no check question in what is held: the answer simply ends at the boundary', async () => {
    const h = harness({ preflight: svgPreflight() });
    h.gate.setBudget({ capWords: 40 });
    await h.play(['Opener. ', { handoff: true }, beat(1), beat(2), beat(3)]);
    expect(h.out.join('')).not.toContain('w2x0');
    expect(h.out.join('')).toContain('<g id="g1">');
  });
});

describe('live gate: the length budget, p6.1 (spoken first, then the plan; each beat its group first)', () => {
  const pre = (): Preflight => ({ check: () => ({ flags: [], notes: [], tags: [] }), accept() {}, reject() {} });
  it("cuts before a beat's group, never between a group and its sentences, even when the id is named late", async () => {
    const h = harness({ preflight: pre() });
    h.gate.setBudget({ capWords: 60 });
    const beat = (id: string, n: number) => `<g id="${id}"></g>\n${Array.from({ length: n }, (_, j) => `${id}w${j}`).join(' ')} the ${id}.\n`;
    const f = new SvgBeatFilter(() => 0);
    const wire = f.push(`It holds because the push never stops. <plan>BOARD viewBox="0 0 560 600"</plan>\n${beat('river', 20)}${beat('drift', 20)}${beat('triangle', 20)}<g id="time"></g>\nWhat if the current were faster?`) + f.end();
    await h.play(['Opener. ', { handoff: true }, ...wire.match(/[\s\S]{1,40}/g)!]);
    const text = h.out.join('');
    for (const id of ['river', 'drift', 'triangle']) expect(text.includes(`id="${id}"`), id).toBe(text.includes(`${id}w0`));
    expect(text).toContain('driftw19');
    expect(text).not.toContain('trianglew0');
    expect(text.trim().endsWith('faster?')).toBe(true);
  });
});
