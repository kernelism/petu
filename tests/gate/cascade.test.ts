// @vitest-environment jsdom
// Constants never cascade (src/svgboard/defs.ts): a withheld beat's definitions (data-const, frames,
// named curves and points) still reach the board and the gate's state, so a later group never fails
// "unknown constant" / "no curve" because an earlier one was withheld.
import { describe, expect, it } from 'vitest';
import { GatePreflight, LiveGate, remnantOf } from '../../src/gate/live';
import type { GateEvent, GateLogEvent } from '../../src/gate/events';
import { defsOf } from '../../src/svgboard/defs';
import { checkGroups, newBoardState } from '../../src/svgboard/check';
import { mountBoard, prepareGroup } from '../../src/svgboard/render';
import { parseTag } from '../../src/script/parseTag';

async function run(text: string) {
  const events: GateLogEvent[] = [];
  let t = 0, ends = 0;
  const gate = new LiveGate({ clock: { now: () => t, endsAt: () => ends }, preflight: new GatePreflight({ question: 'why upstream' }), onEvent: (e) => events.push(e), sleep: async () => {} });
  const src = async function* () { gate.handoff(); for (const c of text.match(/[\s\S]{1,29}/g)!) { t += 30; yield c; } };
  let out = '';
  for await (const s of gate.wrap(src)(new AbortController().signal)) { out += s; ends = t + 300 * s.split(/\s+/).length; }
  return { out, events: events.filter((e): e is GateEvent => e.t === 'gate'), stats: gate.stats };
}

// Beat 1 defines the case (constants, a frame, a named curve) and fails (one readout names nothing);
// beats 2 and 3 build on what it defined.
const RIVER = '<g id="river" data-const="W=300 c=1.5 v=2.5 u=sqrt(v^2-c^2)"><g data-axes="ax" data-x="0,10" data-y="0,10" data-box="50,50,400,300" data-frame=""/><path id="d" data-fn="10-x" data-axes="ax" stroke="#222" fill="none"/><text x="60" y="40" font-size="16" data-val="nosuch*2">bad {}</text></g>';
const SCRIPT = [
  'The ferry aims upstream. {{svgboard h=600}} {{beat}} ',
  `{{svg ${RIVER}}} The river is three hundred metres wide. `,
  '{{beat}} {{svg <g id="time"><text x="60" y="420" font-size="16" data-val="W/u" data-fmt="0">crossing {} s</text></g>}} So the crossing takes 150 seconds. ',
  '{{beat}} {{svg <g id="spot"><circle data-at="at(d, x=4)" r="4" fill="#222"/><text x="470" y="200" font-size="16">landing</text></g>}} It lands right here. ',
].join('');

describe('a withheld beat never cascades', () => {
  it('the first beat is withheld whole; the beats after it still resolve its constants, frame and curve', async () => {
    const r = await run(SCRIPT);
    const river = r.events.find((e) => e.text?.includes('three hundred'))!;
    expect(river.action).toBe('drop');
    expect(river.flags.map((f) => f.detail).join()).toMatch(/unknown constant nosuch/);
    expect(r.out).not.toContain('three hundred');
    expect(r.out).not.toContain('<g id="river"');
    // Its definitions go out in its place, before the beats that use them.
    expect(r.out.indexOf('data-defs')).toBeGreaterThan(-1);
    expect(r.out.indexOf('data-defs')).toBeLessThan(r.out.indexOf('<g id="time"'));
    for (const [id, words] of [['time', 'the crossing takes 150 seconds'], ['spot', 'It lands right here']]) {
      const e = r.events.find((x) => x.text?.includes(words))!;
      expect(e.action, id).toBe('release');
      expect(e.flags, id).toEqual([]);
      expect(r.out).toContain(`<g id="${id}">`);
      expect(r.out).toContain(words);
    }
    expect(r.stats.drops).toBe(1);
  });

  it('the remnant holds definitions only: no words, no ink, no id', () => {
    const d = defsOf(RIVER)!;
    expect(d).toMatch(/^<g data-defs="" display="none">/);
    expect(d).toContain('data-const="W=300 c=1.5 v=2.5 u=sqrt(v^2-c^2)"');
    expect(d).toContain('data-axes="ax" data-x="0,10" data-y="0,10" data-box="50,50,400,300"');
    expect(d).toContain('<path data-name="d" data-fn="10-x" data-axes="ax" fill="none"/>');
    expect(d).not.toMatch(/<text|id="river"|data-frame|bad/);
    expect(remnantOf(`{{svgboard h=600}} {{beat}} {{svg ${RIVER}}} Words here. {{const k=2}}`)).toMatch(/^ \{\{svgboard h=600\}\} \{\{svg <g data-defs="" display="none">.*\}\} \{\{const k=2\}\} $/);
    expect(remnantOf('Just words. {{svg <g id="plain"><line x1="0" y1="0" x2="9" y2="9"/></g>}}')).toBe('');
    // The gate measures nothing of it (no text, no strokes, no id taken).
    const b = newBoardState(560, 600);
    const c = checkGroups([d], b);
    expect(c.flags).toEqual([]);
    expect(c.geos[0]).toMatchObject({ texts: [], segs: [], box: null });
    expect(c.scope.consts.u).toBeCloseTo(2);
    expect((parseTag(`svg ${d}`) as { defs?: true }).defs).toBe(true);
  });

  it('the board takes a remnant\'s definitions: a later group resolves against them', () => {
    const layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    document.body.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'svg')).appendChild(layer);
    const b = mountBoard(layer, { w: 560, h: 600 }, 'b1', '#7c3aed').board;
    const s = prepareGroup(b, defsOf(RIVER)!, 16, 1);
    expect(typeof s).not.toBe('string');
    const later = prepareGroup(b, '<g id="spot"><circle data-at="at(d, x=4)" r="4" fill="#222"/><text x="60" y="420" font-size="16" data-val="W/u" data-fmt="0">crossing {} s</text></g>', 16, 1);
    if (typeof later === 'string') throw new Error(later);
    expect(later.el.querySelector('[data-bad]')).toBeNull();
    expect(later.el.querySelector('text')!.textContent).toBe('crossing 150 s');
  });
});
