// server/prompt/svgExamples.ts — the svg answer format's few-shot examples (PROMPT_VERSION p6.12).
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
    title: 'a quantity over time: the cause drawn (cells splitting), the curve it makes, the gains read off it, the equal steps braced',
    question: 'Why does most of the rise come at the end, if the yeast works at the same pace the whole time?',
    page: 3,
    pages: [3],
    plan: 'The student thinks a steady pace means steady growth. Picture: cells splitting, and the volume over time. Beats: 1 each cell splits every 45 min, 1 → 8; 2 the volume curve, 400 to 3200 ml; 3 the gains, each double the last; 4 equal times, equal doublings. Scope: narrow.',
    listing: String.raw`PAGE 3 (visible; portrait page; image attached)
t1 80 100–640: Proofing the dough
t2 140 100–900: The dough doubles every 45 minutes at room temperature: 400 ml becomes 3200 ml
t3 175 100–700: in just over two hours. Most of the rise comes at the end.
#g1 figure 100,300 800×420 "bowls"`,
    script: String.raw`<plan>
Case: v0 = 400 ml doubling every T = 45 min (the page's): v = v0·2^(t/T) at T, 2T, 3T; the gains are the steps between. One cell → 2, 4, 8.
BOARD viewBox="0 0 560 396"
regions: cells (22–220, 50–240) a row per 45 min; chart (220–560, 50–336) 0–135 min → x 260–500, 0–3200 ml → y 314–67; brackets (260–500, 336–390)
groups: yeast; splits; curve; steps; same
</plan>
<g id="yeast" data-const="v0=400 T=45">
<text x="28" y="61.5" font-size="18" fill="#222">yeast cells</text>
<text x="28" y="98.5" font-size="16" fill="#888">0 min</text>
<circle data-schematic="" cx="100" cy="93" r="7" fill="none" stroke="#222" stroke-width="2"/>
</g>
{{highlight p=3 "Most of the rise comes at the end."}} The pace is steady per cell, not per bowl, so the yeast's growth piles up at the end.
<g id="splits">
<text x="28" y="143.5" font-size="16" fill="#888" data-val="T" data-fmt="0">{} min</text>
<text x="28" y="188" font-size="16" fill="#888" data-val="2*T" data-fmt="0">{} min</text>
<text x="28" y="233" font-size="16" fill="#888" data-val="3*T" data-fmt="0">{} min</text>
<g data-schematic="" fill="none" stroke="#222" stroke-width="2">
<circle cx="100" cy="138" r="7"/><circle cx="116" cy="138" r="7"/>
<circle cx="100" cy="183" r="7"/><circle cx="116" cy="183" r="7"/><circle cx="132" cy="183" r="7"/><circle cx="148" cy="183" r="7"/>
<circle cx="100" cy="228" r="7"/><circle cx="116" cy="228" r="7"/><circle cx="132" cy="228" r="7"/><circle cx="148" cy="228" r="7"/><circle cx="164" cy="228" r="7"/><circle cx="180" cy="228" r="7"/><circle cx="196" cy="228" r="7"/><circle cx="212" cy="228" r="7"/>
</g>
</g>
Every yeast cell splits in two each 45 minutes, so 1 becomes 2, then 4, then 8.
<g id="curve">
<g data-axes="ax" data-x="0,3*T" data-y="0,8*v0" data-box="260,67,240,247" data-frame="" data-ticks-x="0,T,2*T,3*T" data-ticks-y="v0,2*v0,4*v0,8*v0" data-unit-x=" min"/>
<text x="267" y="56" font-size="18" fill="#222">dough volume (ml)</text>
<path id="volume" data-fn="v0*2^(x/T)" data-axes="ax" fill="none" stroke="#222" stroke-width="3"/>
</g>
The dough's volume follows the cells: on this curve 400 millilitres doubles, and doubles again, up to 3200, bending upward.
<g id="steps">
<g stroke="#888" stroke-width="1.5" stroke-dasharray="6 5"><line data-from="at(volume, x=0)" data-to="pt(ax, T, v0)"/><line data-from="at(volume, x=T)" data-to="pt(ax, 2*T, 2*v0)"/><line data-from="at(volume, x=2*T)" data-to="pt(ax, 3*T, 4*v0)"/></g>
<g stroke="#222" stroke-width="3"><line data-from="pt(ax, T, v0)" data-to="at(volume, x=T)"/><line data-from="pt(ax, 2*T, 2*v0)" data-to="at(volume, x=2*T)"/><line data-from="pt(ax, 3*T, 4*v0)" data-to="at(volume, x=3*T)"/></g>
<text id="gain1" data-at="at(volume, x=T)" dx="5.5" dy="19" font-size="18" fill="#222" data-val="v0" data-fmt="0">+{}</text>
<text id="gain2" data-at="at(volume, x=2*T)" dx="5.5" dy="34.5" font-size="18" fill="#222" data-val="2*v0" data-fmt="0">+{}</text>
<text id="gain3" data-at="at(volume, x=3*T)" dx="5.5" dy="65" font-size="18" fill="#222" data-val="4*v0" data-fmt="0">+{}</text>
</g>
Now read the steps: the first 45 minutes add {{val id=gain1}} millilitres, the next add {{val id=gain2}}, and the last add {{val id=gain3}}, more than both before them together.
<g id="same">
<g data-axes="row" data-x="0,3*T" data-y="0,1" data-box="260,338,240,6"/>
<g fill="none" stroke="#7c3aed" stroke-width="2.5"><polyline data-points="pt(row,0,1); pt(row,0,0); pt(row,3*T,0); pt(row,3*T,1)"/><line data-from="pt(row,T,0)" data-to="pt(row,T,1)"/><line data-from="pt(row,2*T,0)" data-to="pt(row,2*T,1)"/></g>
<g font-size="16" fill="#7c3aed" text-anchor="middle"><text data-at="pt(row,T/2,0)" dy="18">doubles</text><text data-at="pt(row,3*T/2,0)" dy="18">doubles</text><text data-at="pt(row,5*T/2,0)" dy="18">doubles</text><text data-at="pt(row,3*T/2,0)" dy="40" data-val="T" data-fmt="0">{} min each</text></g>
</g>
Each step takes the same 45 minutes and makes the same doubling; what grows is the amount being doubled, so the last doubling adds the most.`,
  },
];
