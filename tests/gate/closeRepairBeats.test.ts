// @vitest-environment jsdom
// The gate's other two paths keep the beat contract: a beat cut by the length budget still leaves its
// definitions (the kept check question resolves them), and a repair keeps its beat's {{beat}} boundary
// even when written words-first (trailing order writes no leading {{beat}}).
import { describe, expect, it } from 'vitest';
import { GatePreflight, LiveGate } from '../../src/gate/live';
import type { GateEvent, GateLogEvent } from '../../src/gate/events';


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
