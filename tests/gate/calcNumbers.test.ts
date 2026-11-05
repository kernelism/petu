// @vitest-environment jsdom
// The live gate over an answer with a calc program (src/calc/stream.ts): it reads the stream after the
// calc ran (App: withCalcs before gate.wrap), so a {{val}} of a calc export is bound and a board readout
// of one is grounded; nothing a program computed is withheld as untraced.
import { describe, expect, it } from 'vitest';
import { GatePreflight, LiveGate } from '../../src/gate/live';
import type { GateEvent, GateLogEvent } from '../../src/gate/events';

async function gate(text: string) {
  const events: GateLogEvent[] = [];
  let t = 0, ends = 0;
  const g = new LiveGate({ clock: { now: () => t, endsAt: () => ends }, preflight: new GatePreflight({ question: 'derive the rod', pages: () => new Map([[491, 'A uniform thin rod of mass M and length L.']]) }), onEvent: (e) => events.push(e), sleep: async () => {} });
  const src = async function* () { g.handoff(); for (const c of text.match(/[\s\S]{1,29}/g)!) { t += 30; yield c; } };
  let out = '';
  for await (const s of g.wrap(src)(new AbortController().signal)) { out += s; ends = t + 300 * s.split(/\s+/).length; }
  return { out, events: events.filter((e): e is GateEvent => e.t === 'gate') };
}

const head = 'Cut the rod into slices. {{svgboard h=400}} {{beat}} {{computed id=rod I4=0.078125 I10=0.0825 exact=0.08333333333333333}} ';
const SUMS = '<g id="sums"><text x="40" y="60" font-size="19" data-val="rod.I4" data-fmt="0.000000">4 slices: I ≈ {} M L²</text><text x="40" y="100" font-size="19" data-val="rod.exact" data-fmt="0.000000">exact: I = {} M L²</text></g>';

describe('the gate over calc numbers', () => {
  it('a {{val}} of a calc export and its board readout pass; the beat is released whole', async () => {
    const r = await gate(`${head}{{svg ${SUMS}}} With four slices the sum is {{val rod.I4 fmt=4}} times M L squared, close to one twelfth. `);
    expect(r.out).toContain('{{svg');
    expect(r.out).toContain('{{val rod.I4 fmt=4}}');
    expect(r.events.length).toBeGreaterThan(0);
    expect(r.events.filter((e) => e.result !== 'pass').map((e) => e.flags.map((f) => `${f.check}: ${f.detail}`))).toEqual([]);
  });

  it('a typed number that is a calc export is not withheld', async () => {
    const r = await gate(`${head}{{svg ${SUMS}}} With ten slices the sum is 0.0825 times M L squared. `);
    expect(r.out).toContain('0.0825');
    expect(r.events.filter((e) => e.result === 'fail')).toEqual([]);
  });

  it('a calc that failed: its val is unbound, and the beat does not play with a dash', async () => {
    const r = await gate('Cut it. {{svgboard h=400}} {{beat}} {{computed id=rod failed="calc rod: boom"}} The sum is {{val rod.I4}}. ');
    expect(r.out).not.toContain('{{val rod.I4}}');
    expect(r.events.some((e) => e.result === 'fail')).toBe(true);
  });

  it('a step constant and its tween in one beat: the group data-const re-read is not a redefinition (live p6.20 answer)', async () => {
    const win = '<g id="window" data-const="k=0"><rect x="20" y="20" width="132" height="46" fill="none" stroke="#222" data-set="x: 20+44*k"/><text id="first" x="20" y="120" font-size="18" data-val="rod.I4" data-set="opacity: max(0,1-abs(k))">first {}</text><text id="next" x="20" y="150" font-size="18" data-val="rod.I10" data-set="opacity: min(1,max(0,k))">next {}</text></g>';
    const r = await gate(`${head}{{svg ${win}}} This frame is the window on the first slices, giving {{val id=first}}. {{tween k=1 dur=0.8}} Slide it one step and it gives {{val id=next}}. `);
    expect(r.events.filter((e) => e.result === 'fail').map((e) => e.flags.map((f) => f.detail))).toEqual([]);
    expect(r.out).toContain('{{tween k=1 dur=0.8}}');
  });
});
