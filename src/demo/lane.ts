// src/demo/lane.ts — layout C ("the anchored lane") dev scripts: the founder-approved mockup answer
// (docs/superpowers/reference/lane-mockups, C1–C5) played without an API call, so the gallery can shoot
// the lane layout. OpenStax Principles of Economics 3e (corpus copy, served by /api/dev-pdf/), asked on
// p.87 (the definition), journeying to p.88 (Figure 3.21, Table 3.7).
//
// Each answer is written in the svg board's raw beat format (a <plan> with its BOARD line, then
// narration and <g> groups) and streamed through the server's own filter (server/svgBeats.ts), exactly
// as a live answer would reach the client. Unlike src/demo/svg/index.ts, page pointing is kept: these
// scripts belong to this document.
//
// The market is linear and matches Table 3.7 at $500, $600 and $700: supply S0 = 50q − 250 (15k, 17k,
// 19k), new demand D1 = 1450 − 50q (19k, 17k, 15k), q in thousands. Every position and every number on
// the chart follows from those constants and the ceiling `pc` (the engine computes the crossing, the
// quantities at the ceiling, the shortage, the lost rentals and the landlords' loss).
// The narration says "dollars" (the server's filter strips "$" from narration).
import { SvgBeatFilter } from '../../server/svgBeats';
import type { DevStep } from './learner';

/** A raw beat-format answer as the client receives it (wire tags), page tags kept. */
function wire(raw: string): string {
  const f = new SvgBeatFilter(() => 0);
  return (f.push(raw) + f.end()).trim();
}

const SRC = '/api/dev-pdf/openstax-principles-economics-3e.pdf';
const ACCENT = '#7c3aed';

export const LANE_Q = {
  main: 'Why does a price ceiling on rent create a shortage, and who ends up better or worse off?',
  aside: "why don't landlords just build more?",
  follow: 'And if the ceiling were $650?',
};

// Axes shared by the answer and the follow-up: q 11–22 thousand units → x 130–850, rent $400–$720 →
// y 410–70. Tick labels are written (the engine's ticks cannot prefix "$" or suffix "k").
const yTick = (ax: string, p: number) => `<text data-at="pt(${ax}, 11, ${p})" dx="-12" text-anchor="end" dominant-baseline="middle" font-size="18" fill="#6E6E73">$${p}</text>`;
const ticks = (ax: string) => `
  ${[400, 500, 600, 700].map((p) => yTick(ax, p)).join('\n  ')}
  <text data-at="pt(${ax}, 15, 400)" dy="30" text-anchor="middle" font-size="18" fill="#6E6E73">15k</text>
  <text data-at="pt(${ax}, 17, 400)" dy="30" text-anchor="middle" font-size="18" fill="#6E6E73">17k</text>
  <text data-at="pt(${ax}, 19, 400)" dy="30" text-anchor="middle" font-size="18" fill="#6E6E73">19k</text>
  <text data-at="pt(${ax}, 22, 400)" dy="30" text-anchor="end" font-size="18" fill="#6E6E73">units</text>
  <text x="130" y="48" font-size="18" fill="#6E6E73">rent / month</text>`;

/** One house glyph (32 × 40) at x, y. */
const house = (x: number, y: number, look: string) => `<polygon points="${x},${y + 13} ${x + 16},${y} ${x + 32},${y + 13} ${x + 32},${y + 40} ${x},${y + 40}" ${look}/>`;
const HX = (i: number) => 130 + 38 * i;
const HOUSES = Array.from({ length: 19 }, (_, i) => house(HX(i), 508,
  i < 15 ? `fill="${ACCENT}" stroke="${ACCENT}" stroke-width="1.5"` : i < 17 ? 'fill="url(#hatch2)" stroke="#888" stroke-width="1.5"' : `fill="#fff" stroke="${ACCENT}" stroke-width="2"`)).join('\n  ');

const MAIN = `<plan>
Rent ceiling on Figure 3.21's market: S0 50q−250, D1 1450−50q (q in thousands), crossing $600 · 17k; ceiling $500 → 15k supplied, 19k demanded, 4k short; 2k rentals lost between 15k and 17k; tenants with a unit pay $100 less; landlords −$1.5M a month. Takeaway: the cap adds no homes, it rations the 15,000.
BOARD viewBox="0 0 1000 800"
regions: chart (130–850, 70–440); houses (130–846, 470–640); landlords (130–846, 655–700); takeaway (130–846, 720–780)
groups: market; equilibrium; ceiling; shortage; lost; tenants; houses; landlords; takeaway
</plan>
A {{underline p=87 "price ceiling" near=160,337}} price ceiling is a legal maximum {{highlight p=87 "A price ceiling is a legal maximum price that one pays for some good or service."}} on a price, set by law.
<g id="market" data-const="a=1450 b=50 c=-250 e=50 pc=500 qe=(a-c)/(b+e) pe=c+e*qe qs=(pc-c)/e qd=(a-pc)/b">
  <g data-axes="ax" data-x="11,22" data-y="400,720" data-box="130,70,720,340" data-frame="" />${ticks('ax')}
  <path id="supply" data-fn="c+e*x" data-axes="ax" fill="none" stroke="#222" stroke-width="2.5"/>
  <text data-at="at(supply, y=700)" dx="24" dy="8" font-size="20" fill="#222">S₀</text>
  <path id="demand" data-fn="a-b*x" data-axes="ax" fill="none" stroke="#222" stroke-width="2.5"/>
  <text data-at="at(demand, y=430)" dx="12" dy="-14" font-size="20" fill="#222">D₁</text>
</g>
In this rental market landlords offer more as rent rises, renters want fewer, and demand has just grown.
<g id="equilibrium">
  <line data-from="pt(ax, qe+0.3, pe)" data-to="pt(ax, 19.9, pe)" stroke="#888" stroke-width="1.5" stroke-dasharray="3 4"/>
  <circle id="E" data-at="cross(demand,supply)" r="7" fill="#fff" stroke="#222" stroke-width="2"/>
  <text data-at="pt(ax, 20, pe)" dominant-baseline="middle" font-size="18" fill="#6E6E73">market: $<tspan data-val="pe">{}</tspan> · <tspan data-val="qe">{}</tspan>k</text>
</g>
The market would settle at 600 dollars a month, with 17,000 units rented.
<g id="ceiling">
  <line data-from="pt(ax, 11, pc)" data-to="pt(ax, 22, pc)" stroke="${ACCENT}" stroke-width="3"/>
  <text data-at="pt(ax, 22, pc)" dy="-12" text-anchor="end" font-size="20" fill="${ACCENT}" data-val="pc">ceiling \${}</text>
</g>
Now the city says rent can't go above 500 dollars, even though demand pushes the market toward 600.

{{scroll p=88}} The book draws the same ceiling in Figure 3.21.
<g id="shortage">
  <line data-from="pt(ax, qs, pc)" data-to="onx(pt(ax, qs, pc))" stroke="#888" stroke-width="1.5" stroke-dasharray="4 4"/>
  <line data-from="pt(ax, qd, pc)" data-to="onx(pt(ax, qd, pc))" stroke="#888" stroke-width="1.5" stroke-dasharray="4 4"/>
  <circle data-at="pt(ax, qs, pc)" r="7" fill="${ACCENT}"/>
  <circle data-at="pt(ax, qd, pc)" r="7" fill="${ACCENT}"/>
  <polyline data-points="pt(ax, qs, pc-12); pt(ax, qs, pc-24); pt(ax, (qs+qd)/2-0.2, pc-24); pt(ax, (qs+qd)/2, pc-34); pt(ax, (qs+qd)/2+0.2, pc-24); pt(ax, qd, pc-24); pt(ax, qd, pc-12)" fill="none" stroke="${ACCENT}" stroke-width="2"/>
  <text data-at="pt(ax, (qs+qd)/2, pc-44)" dy="10" text-anchor="middle" font-size="20" fill="${ACCENT}" data-val="qd-qs">{},000 short</text>
</g>
At 500 dollars {{highlight p=88 "$500 15,000"}} landlords offer 15,000 units, but renters {{highlight p=88 "19,000" near=667,435}} now want 19,000.
That gap {{note p=88 "4,000 short" at=705,150 em}} of 4,000 is the shortage.

<g id="lost">
  <defs><pattern id="hatch" patternUnits="userSpaceOnUse" width="10" height="10"><path d="M0,10 L10,0" stroke="#888" stroke-width="1.5"/></pattern></defs>
  <path data-between="demand,supply" data-x="qs,qe" data-axes="ax" fill="url(#hatch)" stroke="none"/>
  <text x="150" y="112" font-size="18" fill="#222" data-val="qe-qs">{},000 rentals</text>
  <text x="150" y="136" font-size="16" fill="#6E6E73">both sides wanted</text>
  <line data-from="330, 152" data-to="pt(ax, 15.5, 630)" stroke="#888" stroke-width="1.5"/>
</g>
Between 15,000 and 17,000 sit 2,000 rentals that both sides wanted, and now never happen.
<g id="tenants">
  <polygon data-points="pt(ax, 11, pc); pt(ax, qs, pc); pt(ax, qs, pe); pt(ax, 11, pe)" fill="${ACCENT}" fill-opacity="0.16" stroke="none"/>
  <text data-at="pt(ax, (11+qs)/2, (pc+pe)/2)" dy="-6" text-anchor="middle" font-size="17" fill="${ACCENT}">tenants with a unit</text>
  <text data-at="pt(ax, (11+qs)/2, (pc+pe)/2)" dy="18" text-anchor="middle" font-size="17" fill="${ACCENT}" data-val="pe-pc">pay \${} less</text>
</g>
The winners are the tenants who do get a unit: each pays a hundred dollars less a month.

<g id="houses">
  <defs><pattern id="hatch2" patternUnits="userSpaceOnUse" width="8" height="8"><path d="M0,8 L8,0" stroke="#888" stroke-width="1.5"/></pattern></defs>
  <text x="130" y="488" font-size="18" fill="#222" data-val="qd">At $500, {},000 households want a unit</text>
  <text x="846" y="488" text-anchor="end" font-size="16" fill="#6E6E73">one house = 1,000</text>
  ${HOUSES}
  <polyline points="130,558 130,568 408,568 412,578 416,568 694,568 694,558" fill="none" stroke="${ACCENT}" stroke-width="2"/>
  <text x="130" y="604" font-size="19" fill="${ACCENT}" data-val="qs">{},000 housed</text>
  <text x="130" y="630" font-size="16" fill="#6E6E73">pay less; upkeep may slip</text>
  <rect x="560" y="590" width="16" height="16" fill="url(#hatch2)" stroke="#888" stroke-width="1.5"/>
  <text x="586" y="604" font-size="16" fill="#222" data-val="qe-qs">{},000 would pay $600: blocked</text>
  <rect x="560" y="616" width="16" height="16" fill="none" stroke="${ACCENT}" stroke-width="2"/>
  <text x="586" y="630" font-size="16" fill="#222" data-val="qd-qe">{},000 only want it at $500</text>
</g>
Of the 19,000 households who want a unit at 500 dollars, only 15,000 are housed.
Another 2,000 would gladly pay 600 and are still shut out; the last 2,000 only want a unit because it got cheaper.
<g id="landlords">
  <line x1="130" y1="656" x2="846" y2="656" stroke="#d0d0d4" stroke-width="1"/>
  <text x="130" y="690" font-size="16" fill="#6E6E73"><tspan font-weight="600" fill="#222">Landlords</tspan><tspan dx="16" data-val="qs*(pe-pc)/1000">−\${}M a month (15,000 × $100); 2,000 units never offered</tspan></text>
</g>
Landlords lose on each of their 15,000 units, and 2,000 more are never offered at all.

<g id="takeaway">
  <text x="130" y="740" font-size="22" fill="${ACCENT}">A cap below the market rent adds no homes.</text>
  <text x="130" y="770" font-size="22" fill="${ACCENT}">It decides who gets the 15,000 that exist.</text>
</g>
So a cap below the market rent adds no homes. It only decides who gets the 15,000 that exist.`;

/** The aside (C3): why the supply line doesn't move — building pays only at the rent it can charge. */
const ASIDE = `<plan>
S0 alone: at $500 only 15,000 units pay their way; at $600, 17,000 are worth offering.
BOARD viewBox="0 0 1000 300"
groups: build
</plan>
Building is a bet on the rent.
<g id="build" data-const="sa=-250 sb=50 lo=500 hi=600">
  <g data-axes="bx" data-x="12,20" data-y="420,700" data-box="150,30,560,230" />
  <path id="s0" data-fn="sa+sb*x" data-axes="bx" fill="none" stroke="#222" stroke-width="2.5"/>
  <text data-at="at(s0, y=690)" dx="18" dy="6" font-size="20" fill="#222">S₀</text>
  <circle data-at="at(s0, y=hi)" r="7" fill="#fff" stroke="#222" stroke-width="2"/>
  <text data-at="at(s0, y=hi)" dx="30" dy="8" font-size="18" fill="#222" data-val="(hi-sa)/sb">$600: {},000 worth offering</text>
  <circle data-at="at(s0, y=lo)" r="7" fill="#222"/>
  <text data-at="at(s0, y=lo)" dx="30" dy="30" font-size="18" fill="#222" data-val="(lo-sa)/sb">$500: only {},000</text>
  <text data-at="at(s0, y=lo)" dx="30" dy="54" font-size="16" fill="#6E6E73">the rest don't pay their way</text>
</g>
At 500 dollars only 15,000 units pay their way; the extra 2,000 needed 600.`;

/** The follow-up (C5's third card): a ceiling above the market rent never binds. */
const FOLLOW = `<plan>
Same market, ceiling $650 above the $600 crossing: it never binds, nothing changes.
BOARD viewBox="0 0 1000 450"
groups: again; cap
</plan>
On the same {{scroll p=88}} figure, a ceiling of 650 dollars sits above the market rent, so it never binds.
<g id="again" data-const="fa=1450 fb=50 fc=-250 fe=50 cap=650 fq=(fa-fc)/(fb+fe) fp=fc+fe*fq">
  <g data-axes="fx" data-x="11,22" data-y="400,720" data-box="130,70,720,340" data-frame="" />${ticks('fx')}
  <path id="s1" data-fn="fc+fe*x" data-axes="fx" fill="none" stroke="#222" stroke-width="2.5"/>
  <text data-at="at(s1, y=700)" dx="24" dy="8" font-size="20" fill="#222">S₀</text>
  <path id="d1" data-fn="fa-fb*x" data-axes="fx" fill="none" stroke="#222" stroke-width="2.5"/>
  <text data-at="at(d1, y=430)" dx="12" dy="-14" font-size="20" fill="#222">D₁</text>
  <line data-from="pt(fx, fq+0.3, fp)" data-to="pt(fx, 19.9, fp)" stroke="#888" stroke-width="1.5" stroke-dasharray="3 4"/>
  <circle data-at="cross(d1,s1)" r="7" fill="#fff" stroke="#222" stroke-width="2"/>
  <text data-at="pt(fx, 20, fp)" dominant-baseline="middle" font-size="18" fill="#6E6E73">market: $<tspan data-val="fp">{}</tspan> · <tspan data-val="fq">{}</tspan>k</text>
</g>
Supply and demand still meet at 600 dollars, with 17,000 units rented, under the cap.
<g id="cap">
  <line data-from="pt(fx, 11, cap)" data-to="pt(fx, 22, cap)" stroke="${ACCENT}" stroke-width="3" stroke-dasharray="10 7"/>
  <text data-at="pt(fx, 22, cap)" dy="-12" text-anchor="end" font-size="20" fill="${ACCENT}" data-val="cap">ceiling \${}</text>
</g>
Nothing changes: no shortage, and nobody is shut out.`;

/** Narration words before `marker` (tags and groups dropped): where a simulated student steps in. */
function wordsBefore(script: string, marker: string): number {
  const at = script.indexOf(marker);
  if (at < 0) throw new Error(`lane: no "${marker}" in the script`);
  return script.slice(0, at).replace(/\{\{[\s\S]*?\}\}/g, ' ').split(/\s+/).filter(Boolean).length;
}

const MAIN_WIRE = wire(MAIN);

type LaneScript = { src: string; page: number; question: string; script: string; answers?: Record<string, string>; steps?: DevStep[] };

export const LANE_SCRIPTS: Record<string, LaneScript> = {
  /** The single answer (C1, C2, C4's board), asked on p.87, journeying to p.88. */
  'lane-econ': { src: SRC, page: 87, question: LANE_Q.main, script: MAIN_WIRE },
  /**
   * The session (C3, C4, C5): beat 3 has just begun when the student circles 15,000 in Table 3.7 and
   * asks an aside; it ends, they resume; after the answer they follow up with a ceiling above the market.
   */
  'lane-session': {
    src: SRC, page: 87, question: LANE_Q.main, script: MAIN_WIRE,
    answers: { [LANE_Q.aside]: wire(ASIDE), [LANE_Q.follow]: wire(FOLLOW) },
    steps: [
      { words: wordsBefore(MAIN_WIRE, 'Between 15,000') - 1, circle: { page: 88, x: 236, y: 435, rx: 34, ry: 14 } },
      { ms: 600, ask: LANE_Q.aside },
      { asideDone: 2500, resume: true },
      { idle: 2500, ask: LANE_Q.follow },
    ],
  },
};
