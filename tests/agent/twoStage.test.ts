import { describe, expect, it, vi } from 'vitest';
import { twoStage, type TwoStage } from '../../src/agent/twoStage';
import { AskError, Queue, type ScoutLive } from '../../src/agent/client';
import type { AskContext, AskEvent } from '../../src/agent/protocol';
import type { ScoutResult } from '../../src/agent/scout';
import type { PageGround } from '../../src/agent/context/types';

const ground = (page: number): PageGround => ({ page, aspect: 0.5625, lines: [], marks: [], noText: false });
const ctx = (page: number): AskContext => ({ docName: 'd', docHash: 'h', numPages: 9, page, docText: 'D', pageText: 'P', image: { b64: 'x', w: 1, h: 1 } });
const tick = () => new Promise((r) => setTimeout(r, 0));

/** A scout whose opener, verdict and cost the test drives by hand. */
function fakeScout() {
  const q = new Queue<string>();
  let decide!: (v: ScoutResult | null) => void;
  const verdict = new Promise<ScoutResult | null>((ok) => { decide = ok; });
  let early: number[] | null = null;
  const live: ScoutLive = { opener: q, verdict, cost: Promise.resolve({ usd: 0.001 }), pages: () => early };
  return { live, say: (s: string) => q.push(s), decide: (v: ScoutResult | null) => { q.close(); decide(v); }, pagesFirst: (p: number[]) => { early = p; } };
}

function setup(over: Partial<TwoStage> = {}) {
  const log: string[] = [];
  const events: AskEvent[] = [];
  const s = fakeScout();
  const asked: AskContext[] = [];
  let release!: () => void;
  const gate = new Promise<void>((ok) => { release = ok; });
  const o: TwoStage = {
    live: s.live,
    visible: ground(3),
    build: vi.fn(async (sc: ScoutResult, home: number) => { log.push(`build ${sc.pages.join(',')}${home !== 3 ? ` on ${home}` : ''}`); return { context: ctx(home), grounds: [ground(home), ...sc.pages.filter((p) => p !== home).map(ground)] }; }),
    ask: (context) => { asked.push(context); log.push('ask'); return (async function* () { await gate; yield 'Then '; yield 'more.'; })(); },
    onGrounding: (pages) => log.push(`ground ${pages.map((p) => p.page).join(',')}`),
    handlers: { onEvent: (e) => events.push(e), onHandoff: (e) => { e.openerEndMs = 1234; } },
    since: () => 42,
    ...over,
  };
  return { o, s, log, events, asked, release };
}

async function drain(g: AsyncGenerator<string>, out: string[]) { for await (const c of g) out.push(c); }

describe('twoStage: opener, then stage 2, as one stream', () => {
  it('plays the opener at once; stage 2 is built and asked as soon as the verdict is in (while the opener plays); its text follows the opener with no overlap', async () => {
    const { o, s, log, events, asked, release } = setup();
    const ctl = new AbortController();
    const out: string[] = [];
    const g = twoStage(o, ctl.signal);
    const done = drain(g, out);
    await tick();
    expect(log).toEqual(['ground 3']); // the opener's tags resolve against the visible page
    s.say('It votes. ');
    await tick();
    expect(out).toEqual(['It votes. ']);
    s.say('{{circle p=3 mark=#d1}}Outliers lose.');
    s.decide({ pages: [5, 3, 7], plan: 'walk', ms: 900, usd: 0, opener: 'It votes. {{circle p=3 mark=#d1}}Outliers lose.', openerMs: 600 });
    await tick(); await tick();
    // Stage 2 was asked before any of its text could play, with the opener verbatim.
    // Then every page sent with a listing can be marked.
    expect(log).toEqual(['ground 3', 'build 5,3,7', 'ask', 'ground 3,5,7']);
    expect(asked[0].opener).toBe('It votes. {{circle p=3 mark=#d1}}Outliers lose.');
    expect(out).toEqual(['It votes. ', '{{circle p=3 mark=#d1}}Outliers lose.']);
    release();
    await done;
    // One space keeps stage 2's first word apart from the opener's last.
    expect(out).toEqual(['It votes. ', '{{circle p=3 mark=#d1}}Outliers lose.', ' ', 'Then ', 'more.']);
    expect(events.map((e) => e.t)).toEqual(['scout', 'handoff']);
    expect(events[0]).toMatchObject({ t: 'scout', pages: [5, 3, 7], usd: 0.001, atMs: 42, openerMs: 600, opener: expect.stringMatching(/^It votes/) });
    expect(events[1]).toEqual({ t: 'handoff', ms: 42, openerEndMs: 1234 });
  });

  it('a scout without an opener (fallback): stage 2 alone on the visible page, no separator', async () => {
    const { o, s, asked, release } = setup();
    const out: string[] = [];
    const done = drain(twoStage(o, new AbortController().signal), out);
    s.decide({ pages: [3], plan: '', ms: 8000, usd: 0, fallback: 'scout timed out' });
    release();
    await done;
    expect(out).toEqual(['Then ', 'more.']);
    expect(asked[0].opener).toBeUndefined();
  });

  it('Esc during the opener: nothing more plays, stage 2 is never asked', async () => {
    const { o, s, log } = setup();
    const ctl = new AbortController();
    const out: string[] = [];
    const done = drain(twoStage(o, ctl.signal), out);
    s.say('It votes. ');
    await tick();
    ctl.abort();
    s.decide(null); // scoutLive resolves the verdict with null on abort
    await done;
    expect(out).toEqual(['It votes. ']);
    expect(log).not.toContain('ask');
    expect(o.build).not.toHaveBeenCalled();
  });

  it('Esc after the verdict, while stage 2 is being built: stage 2 is never asked', async () => {
    const ctl = new AbortController();
    const { o, s, log } = setup({ build: vi.fn(async () => { ctl.abort(); return { context: ctx(3), grounds: [ground(3)] }; }) });
    const out: string[] = [];
    const done = drain(twoStage(o, ctl.signal), out);
    s.say('A. ');
    s.decide({ pages: [3], plan: '', ms: 1, usd: 0, opener: 'A. ' });
    await done;
    expect(out).toEqual(['A. ']);
    expect(log).not.toContain('ask');
  });

  it('stage 2 failing after the opener played is a cut-off (what played stays), not an error', async () => {
    const onCutOff = vi.fn();
    const { o, s } = setup({ ask: () => (async function* () { throw new AskError('cap', 'cap', false); })(), handlers: { onCutOff } });
    const out: string[] = [];
    const done = drain(twoStage(o, new AbortController().signal), out);
    s.say('A. ');
    s.decide({ pages: [3], plan: '', ms: 1, usd: 0, opener: 'A. ' });
    await done;
    expect(out).toEqual(['A. ']);
    expect(onCutOff).toHaveBeenCalledOnce();
    // A refusal that won't go away on retry (a spending cap) says why, not "cut off", in the student's words.
    expect(onCutOff).toHaveBeenCalledWith('The answer budget is used up.');
  });

  it('stage 2 failing with no opener is still an error', async () => {
    const { o, s } = setup({ ask: () => (async function* () { throw new AskError('upstream', 'x', true); })() });
    const g = twoStage(o, new AbortController().signal);
    s.decide({ pages: [3], plan: '', ms: 1, usd: 0, fallback: 'down' });
    await expect(drain(g, [])).rejects.toBeInstanceOf(AskError);
  });
});

describe('twoStage with a slow stage 2: opener → wait → stage 2', () => {
  /** Stage 2's stream: the server is slow to its first text (`designed`), then its text comes. */
  function slowAsk() {
    let designed!: () => void;
    const gate = new Promise<void>((ok) => { designed = ok; });
    const seen: string[] = [];
    const ask = (_c: AskContext, signal?: AbortSignal) => (async function* () {
      seen.push('asked');
      await gate;
      if (signal?.aborted) return;
      seen.push('text');
      yield 'Beat one.';
    })();
    return { ask, designed, seen };
  }

  it('the whole opener plays while stage 2 is silent; stage 2 text follows it', async () => {
    const st = slowAsk();
    const { o, s, events } = setup({ ask: (c) => st.ask(c) });
    const out: string[] = [];
    const done = drain(twoStage(o, new AbortController().signal), out);
    s.say('Prices rise. ');
    s.decide({ pages: [3], plan: 'p', ms: 900, usd: 0, opener: 'Prices rise. ', openerMs: 500 });
    await tick(); await tick();
    expect(st.seen).toEqual(['asked']); // stage 2 asked at the verdict, not yet speaking
    expect(out).toEqual(['Prices rise. ']);
    st.designed();
    await done;
    expect(st.seen).toEqual(['asked', 'text']);
    expect(out).toEqual(['Prices rise. ', ' ', 'Beat one.']);
    expect(events.map((e) => e.t)).toEqual(['scout', 'handoff']);
  });

  it('Esc while stage 2 is silent: nothing more plays, no handoff', async () => {
    const st = slowAsk();
    const ctl = new AbortController();
    const { o, s, events } = setup({ ask: (c) => st.ask(c, ctl.signal) });
    const out: string[] = [];
    const done = drain(twoStage(o, ctl.signal), out);
    s.say('Prices rise. ');
    s.decide({ pages: [3], plan: 'p', ms: 900, usd: 0, opener: 'Prices rise. ' });
    await tick(); await tick();
    ctl.abort();
    st.designed();
    await done;
    expect(out).toEqual(['Prices rise. ']);
    expect(events.map((e) => e.t)).not.toContain('handoff');
  });
});

describe('twoStage: the answer is spoken on its home page (moment.ts homePage)', () => {
  it('pages that leave out the page asked on: the stream opens with a move to the first of them, before the first word; stage 2 is built there', async () => {
    const { o, s, log, events, release } = setup();
    const out: string[] = [];
    const done = drain(twoStage(o, new AbortController().signal), out);
    s.pagesFirst([87, 88]); // the scout's pages come before its opener
    s.say('A price ceiling holds the price below equilibrium. ');
    s.decide({ pages: [87, 88], plan: 'p', ms: 900, usd: 0, opener: 'A price ceiling holds the price below equilibrium. ' });
    await tick(); await tick();
    release();
    await done;
    expect(out).toEqual(['{{scroll p=87}} ', 'A price ceiling holds the price below equilibrium. ', ' ', 'Then ', 'more.']);
    expect(log).toContain('build 87,88 on 87');
    expect(events[0]).toMatchObject({ t: 'scout', home: 87 });
  });

  it('the page asked on among the pages: no move, it is the home (not the first page)', async () => {
    const { o, s, log, events, release } = setup();
    const out: string[] = [];
    const done = drain(twoStage(o, new AbortController().signal), out);
    s.pagesFirst([2, 3]);
    s.say('It votes. ');
    s.decide({ pages: [2, 3], plan: 'p', ms: 900, usd: 0, opener: 'It votes. ' });
    release();
    await done;
    expect(out[0]).toBe('It votes. ');
    expect(out.join('')).not.toContain('scroll');
    expect(log).toContain('build 2,3');
    expect(events[0]).not.toHaveProperty('home');
  });

  it('pinned to the page asked on (pointed, drew, a check reply, an aside): no move whatever the pages', async () => {
    const { o, s, log, release } = setup({ pinned: true });
    const out: string[] = [];
    const done = drain(twoStage(o, new AbortController().signal), out);
    s.pagesFirst([40]);
    s.say('That mark is the ceiling. ');
    s.decide({ pages: [40], plan: 'p', ms: 900, usd: 0 });
    release();
    await done;
    expect(out.join('')).not.toContain('scroll');
    expect(log).toContain('build 40');
  });

  it('no opener: the move goes before stage 2\'s first text (its first word)', async () => {
    const { o, s, events, release } = setup();
    const out: string[] = [];
    const done = drain(twoStage(o, new AbortController().signal), out);
    s.decide({ pages: [7, 8], plan: 'p', ms: 900, usd: 0 });
    release();
    await done;
    expect(out).toEqual(['{{scroll p=7}} ', 'Then ', 'more.']);
    expect(events.map((e) => e.t)).toEqual(['scout', 'handoff']);
  });

  it('an opener that came before any pages (a scout that wrote it first) stays on the page asked on, and so does stage 2', async () => {
    const { o, s, log, release } = setup();
    const out: string[] = [];
    s.say('It votes. ');
    // The verdict in before the stream has played the opener: still no move (the server's gate kept the opener's tags on this page).
    s.decide({ pages: [7], plan: 'p', ms: 900, usd: 0, opener: 'It votes. ' });
    const done = drain(twoStage(o, new AbortController().signal), out);
    release();
    await done;
    expect(out.join('')).not.toContain('scroll');
    expect(log).toContain('build 7');
  });
});
