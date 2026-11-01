// @vitest-environment jsdom
// The gate's other two paths keep the beat contract: a beat cut by the length budget still leaves its
// definitions (the kept check question resolves them), and a repair keeps its beat's {{beat}} boundary
// even when written words-first (trailing order writes no leading {{beat}}).
import { describe, expect, it } from 'vitest';
import { SvgBeatFilter } from '../../server/svgBeats';
import { beatsOf, groupIdOf } from '../../src/svgboard/beat';
import { GatePreflight, LiveGate } from '../../src/gate/live';
import type { GateEvent, GateLogEvent } from '../../src/gate/events';

const wire = (raw: string, o: { opened?: boolean } = {}) => { const f = new SvgBeatFilter(() => 0, o); return f.push(raw) + f.end(); };
const show = (b: { groups: { body: string }[]; words: { text: string }[] }) => `${b.groups.map((g) => groupIdOf(g.body)).join(',')}: ${b.words.map((w) => w.text).join(' ')}`;

describe('a repair written in trailing order keeps its beat boundary', () => {
  it('the repaired beat stays its own beat', async () => {
    const events: GateLogEvent[] = [];
    let t = 0, ends = 0;
    const fixed = wire('The frame holds the curve. <g id="frame"><g data-axes="ax" data-x="0,10" data-y="0,10" data-box="50,80,400,280" data-frame=""/></g>', { opened: true });
    const gate = new LiveGate({
      clock: { now: () => t, endsAt: () => ends }, preflight: new GatePreflight({}), headroomMs: 500, minRepairMs: 0,
      repair: async () => ({ ok: true, text: fixed }), onEvent: (e) => events.push(e),
      sleep: (_ms, sig) => new Promise<void>((r) => sig?.addEventListener('abort', () => r(), { once: true })),
    });
    const text = [
      'One two three four five six seven eight nine ten eleven twelve. {{svgboard h=600}} {{beat}} ',
      '{{svg <g id="title"><text x="40" y="40" font-size="18">Ferry</text></g>}} The ferry crosses the river from bank to bank today. ',
      '{{beat}} {{svg <g id="frame"><g data-axes="ax" data-x="0,10" data-y="0,10" data-box="50,50,400,300" data-frame=""/><text x="60" y="40" font-size="16" data-val="nosuch">bad {}</text></g>}} The frame holds the curve. ',
      '{{beat}} {{svg <g id="use"><text x="60" y="420" font-size="16">end</text></g>}} The end is here. ',
    ].join('');
    const src = async function* () { gate.handoff(); for (const c of text.match(/[\s\S]{1,29}/g)!) { t += 30; yield c; } };
    let out = '';
    for await (const s of gate.wrap(src)(new AbortController().signal)) { out += s; ends = t + 3000 * s.split(/\s+/).length; }
    expect(events.some((e) => e.t === 'repair' && e.phase === 'ok')).toBe(true);
    expect(fixed).not.toContain('{{beat}}');
    expect(beatsOf(out).slice(1).map(show)).toEqual(['title: The ferry crosses the river from bank to bank today.', 'frame: The frame holds the curve.', 'use: The end is here.']);
  });
});

describe('budget: a beat cut past the budget leaves its definitions', () => {
  it('the kept check question still resolves the cut beat\'s constant, and the cut beat says and draws nothing', async () => {
    const events: GateLogEvent[] = [];
    let t = 0, ends = 0;
    const gate = new LiveGate({ clock: { now: () => t, endsAt: () => ends }, preflight: new GatePreflight({}), onEvent: (e) => events.push(e), sleep: async () => {} });
    gate.setBudget({ capWords: 30 });
    const text = [
      'Opener words here. {{svgboard h=600}} {{beat}} ',
      '{{svg <g id="title"><text x="40" y="40" font-size="18">Ferry</text></g>}} One two three four five six seven eight nine ten eleven twelve thirteen fourteen. ',
      '{{beat}} {{svg <g id="def" data-const="k=3"><text x="40" y="100" font-size="18">k</text></g>}} The constant is three here. ',
      '{{beat}} {{svg <g id="ask"><text x="40" y="200" font-size="16" data-val="k*2" data-fmt="0">twice {}</text></g>}} What is twice the constant? ',
    ].join('');
    const src = async function* () { gate.handoff(); for (const c of text.match(/[\s\S]{1,29}/g)!) { t += 30; yield c; } };
    let out = '';
    for await (const s of gate.wrap(src)(new AbortController().signal)) { out += s; ends = t + 300 * s.split(/\s+/).length; }
    const ge = events.filter((e): e is GateEvent => e.t === 'gate').map((e) => `${e.action}:${(e.flags ?? []).map((f) => f.detail).join(';')}:${e.text?.slice(0, 40)}`);
    expect(out, ge.join('\n')).toContain('What is twice the constant?');
    expect(out).not.toContain('The constant is three');
    expect(out).not.toMatch(/<text[^>]*>k<\/text>/);
    expect(out.match(/\{\{svgboard\b/g)).toHaveLength(1);
    expect(gate.closed()).toBe(true);
  });
});
