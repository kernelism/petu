import { describe, expect, it } from 'vitest';
import { GatePreflight, LiveGate, type Preflight, type PreflightResult, type PreflightUnit, type ShadowBoard } from '../../src/gate/live';
import { parseFaults } from '../../src/gate/faults';
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
function harness(o: { preflight: Preflight; repair?: RepairFn; gatefail?: string; headroomMs?: number; setting?: 'live' | 'shadow' }) {
  const time = new FakeTime();
  let ends = 0;
  const events: GateLogEvent[] = [];
  const clock = { now: time.now, endsAt: () => ends };
  const gate = new LiveGate({ clock, preflight: o.preflight, repair: o.repair, faults: parseFaults(o.gatefail), headroomMs: o.headroomMs ?? 6000, onEvent: (e) => events.push(e), sleep: time.sleep, setting: o.setting });
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

  it('shadow setting releases everything and logs the verdicts', async () => {
    const h = harness({ preflight: fakePreflight(), setting: 'shadow' });
    await h.play([{ handoff: true }, 'Bad {{point BAD}} one. ', 'Two. ']);
    expect(h.out.join('')).toBe('Bad {{point BAD}} one. Two. ');
    expect(h.gates()[0]).toMatchObject({ result: 'fail', action: 'release' });
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

  it('never splits a beat from its group (group before its words)', async () => {
    const h = harness({ preflight: svgPreflight() });
    h.gate.setBudget({ capWords: 40 });
    // The splitter keeps each group with the sentence before it: the group whose name opens the next beat belongs to that beat.
    const nb = (i: number) => `{{svg <g id="curve${i}"></g>}} curve${i} ${Array.from({ length: 24 }, (_, j) => `v${i}x${j}`).join(' ')}. `;
    await h.play(['Opener. ', { handoff: true }, 'First words here. ', nb(1), nb(2), nb(3), check]);
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
    const beat = (id: string, n: number) => `{{svg <g id="${id}"></g>}} ${Array.from({ length: n }, (_, j) => `${id}w${j}`).join(' ')} the ${id}. `;
    await h.play(['Opener. ', { handoff: true }, 'It holds because the push never stops. {{svgboard h=600}} ', beat('river', 20), beat('drift', 20), beat('triangle', 20), '{{svg <g id="time"></g>}} What if the current were faster? ']);
    const text = h.out.join('');
    for (const id of ['river', 'drift', 'triangle']) expect(text.includes(`id="${id}"`), id).toBe(text.includes(`${id}w0`));
    expect(text).toContain('driftw19');
    expect(text).not.toContain('trianglew0');
    expect(text.trim().endsWith('faster?')).toBe(true);
  });
});
