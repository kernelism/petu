// server/prompt/svgExamples.ts — the svg answer format's few-shot examples (PROMPT_VERSION p6.14).
/**
 * Two invented documents (a river ferry, proofing dough): one a geometric figure built up beat by
 * beat, one a quantity over time read off its own chart. Each script is exactly what the model
 * writes in the svg format (p6.11): the hidden <plan> first, ending with the BOARD layout (viewBox, regions,
 * groups in teaching order), then beats: the beat's <g id> first (it draws across its sentences; parts
 * with ids draw on the word that names them), then its sentences. The first beat points at the page and
 * says the answer (p6.1–p6.10 spoke that sentence before the plan: C7, it claimed before the case was decided). Numbers that follow from a formula are
 * formulas (data-const, data-axes/data-fn, data-at, data-val: src/svgboard/data.ts). The board holds
 * the picture, labels and key numbers, never the narration's derivation. Every number is computed (the ferry's velocity triangle; the dough's doublings),
 * every group id is a word its beat says, and nothing overlaps (rendered and checked by eye;
 * tests/server/prompt.test.ts checks the form). They set the bar for richness: draw the mechanism,
 * labelled, composed so the finished board reads on its own. p6.2: both end on the takeaway; the ferry,
 * whose case has a twist the student can now work out, adds the hidden <check>; the dough does not.
 * p6.4: both are laid out on the BOARD_W (560) canvas, units about screen pixels, text at 16–20.
 * p6.10: grounded (diagnosis C1/C4): no computed number or position is typed by hand. Each figure is placed
 * through a frame (the river 0.75 units/m, the velocity triangle 56 units per m/s, the brackets' row) with
 * pt(), mid() and data-rotate for arrowheads; every number a label shows is a data-val; the narration says
 * the board's numbers with {{val id=…}} (a readout's id, or a constant) and types only the page's own; the
 * plans carry the givens, not results. They resolve to the p6.4 layout within a unit (the stray "1 m/s =
 * 56 units" scale note went); tests/server/prompt.test.ts runs the grounded check and the {{val}} words.
 * p6.12: the first group is title-sized (the ferry's frame and title, the dough's title and first cell),
 * because nothing is spoken until it is written and the plan comes first (p6.11): the ferry's 1.6k-char
 * river group put its first word 7.8 s after the plan began at the median stream rate. The banks and the
 * cell rows draw in beat 2. The plans are trimmed to the givens and formulas, and the ferry no longer types
 * "3, 4, 5" (not the page's numbers: NUMBERS YOU SAY).
 */
import type { Example } from './examples.ts';

export const SVG_EXAMPLES: Example[] = [
  {
    title: 'a figure built beat by beat: the river, the naive aim drifting, the velocity triangle, the aim that works, its cost',
    question: 'Why does the ferry point upstream instead of at the landing, and does that make the crossing slower?',
    page: 6,
    pages: [6],
    plan: 'The student expects aiming at the landing to work. Picture: the river from above and the velocity triangle. Beats: 1 river and current; 2 aimed straight across, it drifts; 3 the triangle (3-4-5): the speed left across and the aim; 4 the aim and the straight path; 5 the price: a longer crossing; check: a current faster than the ferry. Scope: standard.',
    listing: String.raw`PAGE 6 (visible; 16:9 slide; image attached)
t1 60 40–520: Crossing with a current
t2 170 40–900: A ferry that aims upstream can land straight across from where it started.
t3 205 40–860: River 300 m wide, current 1.5 m/s, ferry speed in still water 2.5 m/s.
#g1 figure 520,320 420×380 "ferry"`,
    script: String.raw`<plan>
Case: W = 300 m, c = 1.5, v = 2.5 (the page's). The board computes u = sqrt(v² − c²), the aim atan(c/u), t0 = W/v and drift c·t0 aimed at B, t1 = W/u aimed upstream.
BOARD viewBox="0 0 560 410"
regions: river (22–314, 20–350) 224 units = 300 m; triangle (330–560, 185–345) 1 m/s = 56 units; time (270–560, 372–400)
groups: river; banks; drift; triangle; aim; time
</plan>
<g id="river" data-const="W=300 c=1.5 v=2.5 u=sqrt(v^2-c^2) t0=W/v t1=W/u">
<g data-axes="rv" data-x="-120,270" data-y="0,W" data-box="22.5,78.5,291.2,224"/>
<text x="22" y="36" font-size="18" fill="#222">the river from above</text>
</g>
{{highlight p=6 "aims upstream"}} The ferry aims upstream because the river carries it sideways for the whole crossing, so its aim has to cancel that push.
<g id="banks">
<line data-from="pt(rv,-120,W)" data-to="pt(rv,270,W)" stroke="#222" stroke-width="3"/>
<line data-from="pt(rv,-120,0)" data-to="pt(rv,270,0)" stroke="#222" stroke-width="3"/>
<text x="42" y="100" font-size="16" fill="#888">far bank</text>
<text x="150" y="321" font-size="16" fill="#888">near bank</text>
<g stroke="#888" stroke-width="1.5">
<line data-from="pt(rv,-105,0)" data-to="pt(rv,-105,W)"/>
<line x1="-4.5" y1="0" x2="4.5" y2="0" data-at="pt(rv,-105,W)"/>
<line x1="-4.5" y1="0" x2="4.5" y2="0" data-at="pt(rv,-105,0)"/>
</g>
<text x="40.5" y="194" font-size="18" fill="#222" data-val="W" data-fmt="0">{} m</text>
<circle data-name="A" data-at="pt(rv,0,0)" r="3.5" fill="#222"/>
<text data-at="A" dy="18" font-size="18" text-anchor="middle" fill="#222">A</text>
<circle data-name="B" data-at="pt(rv,0,W)" r="3.5" fill="#222"/>
<text data-at="B" dy="-10" font-size="18" text-anchor="middle" fill="#222">B</text>
<g id="current">
<g stroke="#888" stroke-width="2" fill="none">
<line x1="263" y1="140" x2="302.5" y2="140"/><polyline points="295.5,135.5 302.5,140 295.5,144.5"/>
<line x1="263" y1="190.5" x2="302.5" y2="190.5"/><polyline points="295.5,186 302.5,190.5 295.5,195"/>
<line x1="263" y1="241" x2="302.5" y2="241"/><polyline points="295.5,236.5 302.5,241 295.5,245.5"/>
</g>
<text x="245" y="288" font-size="18" text-anchor="middle" fill="#222" data-val="c" data-fmt="1">current {} m/s</text>
</g>
</g>
Here are the banks, 300 metres apart, and the current carrying everything downstream at 1.5 metres per second.
<g id="drift">
<line data-from="A" data-to="pt(rv, c*t0, W)" stroke="#888" stroke-width="2" stroke-dasharray="8 6"/>
<circle data-name="D" data-at="pt(rv, c*t0, W)" r="4" fill="#888"/>
<text id="downstream" data-at="D" dy="-16" font-size="18" text-anchor="middle" fill="#222" data-val="c*t0" data-fmt="0">lands {} m downstream</text>
</g>
Point it straight at B and the crossing takes {{val id=t0}} seconds, but the water pushes the whole time: the drift carries it {{val id=downstream}} metres downstream.
<g id="triangle">
<g data-axes="vt" data-x="-2,1" data-y="0,2.5" data-box="336,173.5,168,140"/>
<g stroke-width="3" fill="none">
<line data-from="pt(vt,0,0)" data-to="pt(vt,-c,u)" stroke="#222"/>
<polyline points="-8,-4.5 0,0 -8,4.5" data-at="pt(vt,-c,u)" data-rotate="180+deg(atan(u/c))" stroke="#222"/>
<line data-from="pt(vt,-c,u)" data-to="pt(vt,0,u)" stroke="#888"/>
<polyline points="-6.5,-4.5 0,0 -6.5,4.5" data-at="pt(vt,0,u)" stroke="#888"/>
<line data-from="pt(vt,0,0)" data-to="pt(vt,0,u)" stroke="#222"/>
<polyline points="-4.5,7 0,0 4.5,7" data-at="pt(vt,0,u)" stroke="#222"/>
</g>
<path data-param="-0.5*sin(t), 0.5*cos(t)" data-t="0,atan(c/u)" data-axes="vt" fill="none" stroke="#222" stroke-width="2"/>
<text id="angle" data-at="pt(vt,-0.4,0.15)" font-size="18" text-anchor="end" fill="#222" data-val="deg(atan(c/u))" data-fmt="0">{}°</text>
<text data-at="mid(pt(vt,-c,u), pt(vt,0,u))" dy="-9" font-size="18" text-anchor="middle" fill="#888" data-val="c" data-fmt="1">current {}</text>
<text data-at="mid(pt(vt,0,0), pt(vt,-c,u))" dx="-18" dy="-1.5" font-size="18" text-anchor="end" fill="#222">heading</text>
<text data-at="mid(pt(vt,0,0), pt(vt,-c,u))" dx="-18" dy="20.5" font-size="18" text-anchor="end" fill="#222" data-val="v" data-fmt="1">{} m/s</text>
<text data-at="mid(pt(vt,0,0), pt(vt,0,u))" dx="10" dy="-7.5" font-size="18" fill="#222">across</text>
<text id="across" data-at="mid(pt(vt,0,0), pt(vt,0,u))" dx="10" dy="14.5" font-size="18" fill="#222" data-val="u" data-fmt="1">{} m/s</text>
</g>
Velocities add tip to tail, so draw the triangle: the ferry's 2.5 through the water plus the current's 1.5 must sum to a velocity pointing straight across. What is left for crossing is the third side, {{val id=across}} metres per second, with the aim about {{val id=angle}} degrees upstream.
<g id="aim">
<g stroke-width="3" fill="none">
<line data-from="A" data-to="pt(rv, -27*c, 27*u)" stroke="#222"/>
<polyline points="-8,-4.5 0,0 -8,4.5" data-at="pt(rv, -27*c, 27*u)" data-rotate="180+deg(atan(u/c))" stroke="#222"/>
<line data-from="A" data-to="B" stroke="#7c3aed"/>
<polyline points="-4.5,6.5 0,0 4.5,6.5" data-at="B" stroke="#7c3aed"/>
</g>
<text data-at="A" dy="43.5" font-size="18" text-anchor="middle" fill="#222" data-val="deg(atan(c/u))" data-fmt="0">aims {}° upstream</text>
<text data-at="mid(A, B)" dx="8" dy="-22.5" font-size="18" fill="#7c3aed" data-val="t1" data-fmt="0">{} s</text>
</g>
So the ferry takes that aim, and the current bends its path into a straight line from A to B.
<g id="time">
<text x="550" y="392" font-size="20" text-anchor="end" fill="#7c3aed"><tspan data-val="t1" data-fmt="0">crossing: {} s</tspan><tspan data-val="t0" data-fmt="0">, not {} s</tspan></text>
</g>
It pays in time: only {{val id=across}} of its 2.5 metres per second carry it across, so the crossing takes {{val id=t1}} seconds instead of {{val id=t0}}.
<check>If the current ran at 3 metres per second, faster than the ferry, could any aim still take it straight to B?</check>`,
  },
  {
    title: 'a process in steps: a window sliding along a series, each output computed by a program and said from it',
    question: 'How does the moving average get rid of the storm day?',
    page: 2,
    pages: [2],
    plan: 'The student sees the storm vanish and does not know where it went. Picture: the week as cells, a three-day window stepping along, the averages appearing under it. Beats: 1 the idea; 2 the week; 3 the window, step by step; 4 the storm spread over three days. Scope: narrow.',
    listing: String.raw`PAGE 2 (visible; 16:9 slide; image attached)
t1 60 40–520: Smoothing a noisy series
t2 170 40–900: A 3-day moving average replaces each day by the mean of it and its two neighbours.
t3 205 40–760: Rain per day (mm): 4, 4, 22, 4, 4, 10, 10
#g1 figure 520,320 420×380 "rain"`,
    script: String.raw`<plan>
Case: the page's week r = 4, 4, 22, 4, 4, 10, 10. A program computes the five 3-day means; a step constant k walks the window over them.
BOARD viewBox="0 0 560 300"
regions: week (40–460, 56–96); means (100–400, 120–156); working (40–460, 176–206); takeaway (40–520, 240–280)
groups: average; days; window; spread
</plan>
<g id="average" data-const="k=0">
<text x="40" y="36" font-size="18" fill="#222">rain per day (mm)</text>
</g>
{{highlight p=2 "replaces each day by the mean of it and its two neighbours"}} The average gets rid of the storm by sharing it: each day becomes the mean of itself and its two neighbours.
<calc id="avg">
export const r = [4, 4, 22, 4, 4, 10, 10];
export const out = [1, 2, 3, 4, 5].map(i => (r[i - 1] + r[i] + r[i + 1]) / 3);
export const peak = Math.max(...out);
</calc>
<g id="days">
<g fill="none" stroke="#888" stroke-width="1.5"><rect x="40" y="56" width="56" height="40"/><rect x="100" y="56" width="56" height="40"/><rect x="160" y="56" width="56" height="40"/><rect x="220" y="56" width="56" height="40"/><rect x="280" y="56" width="56" height="40"/><rect x="340" y="56" width="56" height="40"/><rect x="400" y="56" width="56" height="40"/></g>
<g font-size="18" fill="#222" text-anchor="middle"><text x="68" y="83" data-val="avg.r[0]">{}</text><text x="128" y="83" data-val="avg.r[1]">{}</text><text x="188" y="83" data-val="avg.r[2]">{}</text><text x="248" y="83" data-val="avg.r[3]">{}</text><text x="308" y="83" data-val="avg.r[4]">{}</text><text x="368" y="83" data-val="avg.r[5]">{}</text><text x="428" y="83" data-val="avg.r[6]">{}</text></g>
<text x="470" y="83" font-size="16" fill="#888">days</text>
</g>
Here is the week from the slide: dry days of four millimetres, one storm day of twenty two, then a wetter spell of ten.
<g id="window">
<rect id="frame" y="52" width="176" height="48" rx="6" fill="none" stroke="#7c3aed" stroke-width="2.5" data-set="x: 38 + 60*max(0, k - 1); opacity: min(1, max(0, k))"/>
<g font-size="18" fill="#7c3aed" text-anchor="middle"><text x="128" y="147" data-val="avg.out[0]" data-fmt="0" data-set="opacity: min(1, max(0, k - 0))">{}</text><text x="188" y="147" data-val="avg.out[1]" data-fmt="0" data-set="opacity: min(1, max(0, k - 1))">{}</text><text x="248" y="147" data-val="avg.out[2]" data-fmt="0" data-set="opacity: min(1, max(0, k - 2))">{}</text><text x="308" y="147" data-val="avg.out[3]" data-fmt="0" data-set="opacity: min(1, max(0, k - 3))">{}</text><text x="368" y="147" data-val="avg.out[4]" data-fmt="0" data-set="opacity: min(1, max(0, k - 4))">{}</text></g>
<text x="470" y="147" font-size="16" fill="#888">means</text>
<text x="40" y="196" font-size="18" fill="#222" data-val="avg.out[0]" data-fmt="0" data-set="opacity: max(0, 1 - abs(k - 1))">(4 + 4 + 22) / 3 = {}</text><text x="40" y="196" font-size="18" fill="#222" data-val="avg.out[1]" data-fmt="0" data-set="opacity: max(0, 1 - abs(k - 2))">(4 + 22 + 4) / 3 = {}</text><text x="40" y="196" font-size="18" fill="#222" data-val="avg.out[2]" data-fmt="0" data-set="opacity: max(0, 1 - abs(k - 3))">(22 + 4 + 4) / 3 = {}</text><text x="40" y="196" font-size="18" fill="#222" data-val="avg.out[3]" data-fmt="0" data-set="opacity: max(0, 1 - abs(k - 4))">(4 + 4 + 10) / 3 = {}</text><text x="40" y="196" font-size="18" fill="#222" data-val="avg.out[4]" data-fmt="0" data-set="opacity: max(0, 1 - abs(k - 5))">(4 + 10 + 10) / 3 = {}</text>
</g>
{{tween k=1 dur=0.8}} The frame is the window: on the first three days, four, four and twenty two average to {{val avg.out[0]}}. {{tween k=2 dur=0.8}} Slide it one day, and the storm is still inside, so the mean stays {{val avg.out[1]}}. {{tween k=5 dur=2.4}} Run it to the end: once the storm leaves the window, the mean falls to {{val avg.out[3]}}.
<g id="spread">
<text x="40" y="262" font-size="18" fill="#7c3aed" data-val="avg.peak" data-fmt="0">storm: 22 becomes three days of {}</text>
</g>
The storm's twenty two never shows up in the means: it is spread over three days of {{val avg.peak}} each, which is all a moving average does.`,
  },
];
