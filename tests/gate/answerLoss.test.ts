// The founder's lec06 "filtering techniques" answer (2026-10-31): the live gate dropped every sentence
// that said a number the board computed (correctly), and the first of them carried {{svgboard}}: the
// board never opened, so all five drawings were skipped ("no svg board"). Synthetic script, same
// structure: a board, groups with data-const/data-val readouts, sentences that say the computed values
// as literals, scrolls and a page highlight between them.
import { describe, expect, it } from 'vitest';
import { GatePreflight, LiveGate } from '../../src/gate/live';
import type { GateEvent, GateLogEvent } from '../../src/gate/events';

const PAGES = new Map<number, string>([
  [4, 'Blending mixes the paint of neighbouring tiles with a recipe'],
  [9, 'Blends add: r * (s + t) = (r * s) + (r * t)'],
  [17, 'A wide recipe spreads colour further'],
]);

const SCRIPT = [
  '{{svgboard h=850}} \n{{svg <g id="row" data-const="a=10 b=100 c=10 w=0.25"> <text x="35" y="45" font-size="25">A row of tiles</text> <text x="300" y="110">10</text><text x="380" y="110">100</text><text x="460" y="110">10</text> <text x="380" y="205" data-val="w*a+2*w*b+w*c" data-fmt="0">middle: &#123;&#125;</text> </g>}} ',
  '{{scroll p=4}} On page 4, {{highlight p=4 "Blending mixes the paint of neighbouring tiles with a recipe"}} blending weighs these tiles and adds them: the middle comes out at 55. ',
  'Moving the recipe along gives the next tile. ',
  '{{svg <g id="even" data-const="a=10 b=100 c=10"> <text x="35" y="300">even recipe</text><text x="35" y="338" data-val="(a+b+c)/3" data-fmt="0">middle: &#123;&#125;</text> </g>}} ',
  'An even recipe gives 40; the peaked one gives 55. {{scroll p=17}} Page 17 shows a wider recipe. ',
  '{{svg <g id="mid"> <text x="525" y="300">middle pick</text><text x="595" y="340">10</text> </g>}} ',
  '{{scroll p=9}} Picking the middle value instead sorts the three and keeps 10. It is not a blend, so the rules on {{scroll p=9}} {{highlight p=9 "Blends add: r * (s + t) = (r * s) + (r * t)"}} page 9 do not apply. ',
  '{{svg <g id="mixed" data-const="a=10 b=100 c=10 r=0.1"> <text x="525" y="475">similarity blend</text><text x="525" y="594" data-val="(0.25*r*a+0.5*b+0.25*r*c)/(0.25*r+0.5+0.25*r)" data-fmt="1">blended middle: &#123;&#125;</text> </g>}} ',
  'A similarity blend leaves about 92.9 after normalising, and a sharpened middle of 160 stays as said. ',
].join('');

/** Streams `text` through a real GatePreflight + LiveGate on a fake clock; returns what was released. */
async function run(text: string) {
  const events: GateLogEvent[] = [];
  let t = 0, ends = 0;
  const gate = new LiveGate({
    clock: { now: () => t, endsAt: () => ends },
    preflight: new GatePreflight({ pages: () => PAGES, question: 'explain the blends' }),
    onEvent: (e) => events.push(e), sleep: async () => {},
  });
  const src = async function* () { gate.handoff(); for (const c of text.match(/[\s\S]{1,23}/g)!) { t += 30; yield c; } };
  let out = '';
  for await (const s of gate.wrap(src)(new AbortController().signal)) { out += s; ends = t + 300 * s.split(/\s+/).length; }
  return { out, events: events.filter((e): e is GateEvent => e.t === 'gate'), stats: gate.stats };
}

describe('answer loss (founder lec06, synthetic)', () => {
  it('a sentence that says the board\'s computed value correctly is not dropped', async () => {
    const r = await run(SCRIPT);
    expect(r.out).toContain('the middle comes out at 55.');
    expect(r.out).toContain('An even recipe gives 40; the peaked one gives 55.');
    expect(r.stats.drops).toBe(0);
  });

  it('a number said that the board computes differently is said as the board\'s (heard = drawn)', async () => {
    const r = await run(SCRIPT);
    expect(r.out).toContain('leaves about 91.8 after normalising');
    expect(r.out).not.toContain('92.9');
    expect(r.out).toContain('middle of 160 stays');
    expect(r.out).toContain('gives 40; the peaked one gives 55.');
    expect(r.events.some((e) => e.notes.some((n) => /92\.9 → 91\.8/.test(n)))).toBe(true);
  });

  it('every drawing reaches the session, and the board that holds them opens first', async () => {
    const r = await run(SCRIPT);
    for (const id of ['row', 'even', 'mid', 'mixed']) expect(r.out).toContain(`<g id="${id}"`);
    expect(r.out.indexOf('{{svgboard')).toBeGreaterThanOrEqual(0);
    expect(r.out.indexOf('{{svgboard')).toBeLessThan(r.out.indexOf('<g id="row"'));
  });

  it('a unit dropped for something else keeps its board tag with its groups', async () => {
    // A misleading number: 70 is no value of the page, the question or the board, and a highlight whose quote is on no page.
    const bad = SCRIPT.replace('On page 4, {{highlight p=4 "Blending mixes the paint of neighbouring tiles with a recipe"}}', 'On page 4, {{circle on=nowhere at=1,1 r=3}}');
    const r = await run(bad);
    expect(r.events.some((e) => e.action === 'drop')).toBe(true);
    expect(r.out).toContain('{{svgboard h=850}}');
    expect(r.out.indexOf('{{svgboard')).toBeLessThan(r.out.indexOf('<g id="row"'));
    for (const id of ['row', 'even', 'mid', 'mixed']) expect(r.out).toContain(`<g id="${id}"`);
  });
});
