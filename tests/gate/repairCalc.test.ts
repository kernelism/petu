// @vitest-environment jsdom
// A repair runs downstream of the answer's calc runner: a <calc> it writes must still run (the gate's
// `calcs` hook), so the repaired beat's numbers come from the program, not a dash.
import { describe, expect, it } from 'vitest';
import { SvgBeatFilter } from '../../server/svgBeats';
import { GatePreflight, LiveGate } from '../../src/gate/live';
import { runCalcsIn } from '../../src/calc/stream';
import { runCalcNode } from '../../src/calc/node';
import type { GateLogEvent } from '../../src/gate/events';

const wire = (raw: string, o: { opened?: boolean } = {}) => { const f = new SvgBeatFilter(() => 0, o); return f.push(raw) + f.end(); };

async function answer(calcs?: (t: string) => Promise<string>) {
  const events: GateLogEvent[] = [];
  let t = 0, ends = 0;
  const fixed = wire('<calc id="sq">export const a = 7 * 7;</calc> <g id="frame"><text x="60" y="80" font-size="18" data-val="sq.a" data-fmt="0">seven squared is {}</text></g> Seven times seven is {{val sq.a}}.', { opened: true });
  const gate = new LiveGate({
    clock: { now: () => t, endsAt: () => ends }, preflight: new GatePreflight({}), headroomMs: 500, minRepairMs: 0,
    repair: async () => ({ ok: true, text: fixed }), onEvent: (e) => events.push(e), ...(calcs ? { calcs } : {}),
    sleep: (_ms, sig) => new Promise<void>((r) => sig?.addEventListener('abort', () => r(), { once: true })),
  });
  const text = [
    'One two three four five six seven eight nine ten eleven twelve. {{svgboard h=600}} {{beat}} ',
    '{{svg <g id="title"><text x="40" y="40" font-size="18">Squares</text></g>}} A square is a number times itself, every time we ask. ',
    '{{beat}} {{svg <g id="frame"><text x="60" y="80" font-size="16" data-val="nosuch">bad {}</text></g>}} Seven times seven is forty nine. ',
    '{{beat}} {{svg <g id="use"><text x="60" y="420" font-size="16">end</text></g>}} The end is here. ',
  ].join('');
  const src = async function* () { gate.handoff(); for (const c of text.match(/[\s\S]{1,29}/g)!) { t += 30; yield c; } };
  let out = '';
  for await (const s of gate.wrap(src)(new AbortController().signal)) { out += s; ends = t + 3000 * s.split(/\s+/).length; }
  return { out, events, fixed };
}

describe('a repair that writes a calc', () => {
  it('the calc runs and the repaired beat is released with its computed numbers', async () => {
    const { out, events, fixed } = await answer((t) => runCalcsIn(t, runCalcNode));
    expect(fixed).toContain('{{calcsrc');
    expect(events.some((e) => e.t === 'repair' && e.phase === 'ok')).toBe(true);
    expect(out).toContain('{{computed id=sq a=49}}');
    expect(out).not.toContain('{{calcsrc');
    expect(out).toContain('Seven times seven is {{val sq.a}}');
    expect(out).not.toContain('forty nine');
    expect(events.some((e) => e.t === 'gate' && e.repaired && e.action === 'release')).toBe(true);
  });

  it('runCalcsIn leaves text without calcs as it is', async () => {
    expect(await runCalcsIn('plain {{val x}} words.', runCalcNode)).toBe('plain {{val x}} words.');
  });
});

describe('a repair that echoes the note', () => {
  it('the note\'s "calc ran" line is words, not a program: nothing runs and the values stay', async () => {
    const { repairNote } = await import('../../server/prompt/repair');
    const note = repairNote({ beat: '{{computed id=rod I4=0.078125}} {{svg <g id="a"><text x="5" y="20">x</text></g>}} Four slices give {{val rod.I4}}.', problems: [], board: [], consts: {}, finds: [], later: [], tail: 'so', maxWords: 20 });
    const line = /\(calc rod ran: [^)]*\)/.exec(note)![0];
    const echoed = wire(`${line} <g id="a"><text x="5" y="20">x</text></g> Four slices give {{val rod.I4}}.`, { opened: true });
    expect(echoed).not.toContain('{{calcsrc');
    expect(await runCalcsIn(echoed, runCalcNode)).not.toContain('{{computed');
  });
});
