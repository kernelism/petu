// server/prompt/svgExamples.ts — the svg answer format's few-shot examples (PROMPT_VERSION p6.4).
/**
 * Two invented documents (a river ferry, proofing dough): one a geometric figure built up beat by
 * beat, one a quantity over time read off its own chart. Each script is exactly what the model
 * writes in the svg format (p6.1): a first sentence pointing at the page (no drawing, it plays while
 * the plan is written), the hidden <plan> ending with the BOARD layout (viewBox, regions, groups in
 * teaching order), then beats: the beat's <g id> first (it draws across its sentences; parts with ids
 * draw on the word that names them), then its sentences. Numbers that follow from a formula are
 * formulas (data-const, data-axes/data-fn, data-at, data-val: src/svgboard/data.ts). The board holds
 * the picture, labels and key numbers, never the narration's derivation. Every number is computed (the ferry's 3-4-5 triangle; the dough's doublings),
 * every group id is a word its beat says, and nothing overlaps (rendered and checked by eye;
 * tests/server/prompt.test.ts checks the form). They set the bar for richness: draw the mechanism,
 * labelled, composed so the finished board reads on its own. p6.2: both end on the takeaway; the ferry,
 * whose case has a twist the student can now work out, adds the hidden <check>; the dough does not.
 * p6.4: both are laid out on the BOARD_W (560) canvas, units about screen pixels, text at 16–20.
 */
import type { Example } from './examples.ts';

export const SVG_EXAMPLES: Example[] = [
  {
    title: 'a figure built beat by beat: the river, the naive aim drifting, the velocity triangle, the aim that works, its cost',
    question: 'Why does the ferry point upstream instead of at the landing, and does that make the crossing slower?',
    page: 6,
    pages: [6],
    plan: 'The student expects aiming at the landing to work. Picture: the river from above and the velocity triangle. Beats: 1 river and current; 2 aimed straight across, it drifts 180 m; 3 the triangle (3-4-5): 2.0 m/s across, 37°; 4 the aim and the straight path; 5 the price: 150 s; check: a current faster than the ferry. Scope: standard.',
    listing: String.raw`PAGE 6 (visible; 16:9 slide; image attached)
t1 60 40–520: Crossing with a current
t2 170 40–900: A ferry that aims upstream can land straight across from where it started.
t3 205 40–860: River 300 m wide, current 1.5 m/s, ferry speed in still water 2.5 m/s.
#g1 figure 520,320 420×380 "ferry"`,
    script: String.raw`{{highlight p=6 "aims upstream"}} The ferry aims upstream because the water carries it sideways for the whole crossing, so its aim has to cancel that push.
<plan>
Case: river 300 m, current 1.5, ferry 2.5; across u = sqrt(2.5² − 1.5²) = 2.0 m/s, aim 37°. Aimed at B: 120 s, drifts 180 m. Aimed upstream: 150 s.
BOARD viewBox="0 0 560 410"
regions: river (22–314, 39–350) from above, 224 units = 300 m; triangle (330–560, 185–345) 1 m/s = 56 units; time (270–560, 372–400)
groups: river; drift; triangle; aim; time
</plan>
<g id="river" data-const="W=300 c=1.5 v=2.5 u=sqrt(v^2-c^2)">
<line x1="22.5" y1="78.5" x2="313.5" y2="78.5" stroke="#222" stroke-width="3"/>
<line x1="22.5" y1="302.5" x2="313.5" y2="302.5" stroke="#222" stroke-width="3"/>
<text x="42" y="100" font-size="16" fill="#888">far bank</text>
<text x="150" y="321" font-size="16" fill="#888">near bank</text>
<line x1="33.5" y1="78.5" x2="33.5" y2="302.5" stroke="#888" stroke-width="1.5"/>
<line x1="29" y1="78.5" x2="38" y2="78.5" stroke="#888" stroke-width="1.5"/>
<line x1="29" y1="302.5" x2="38" y2="302.5" stroke="#888" stroke-width="1.5"/>
<text x="40.5" y="194" font-size="18" fill="#222">300 m</text>
<circle cx="112" cy="302.5" r="3.5" fill="#222"/>
<text x="112" y="320.5" font-size="18" text-anchor="middle" fill="#222">A</text>
<circle cx="112" cy="78.5" r="3.5" fill="#222"/>
<text x="112" y="68.5" font-size="18" text-anchor="middle" fill="#222">B</text>
<g id="current">
<g stroke="#888" stroke-width="2" fill="none">
<line x1="263" y1="140" x2="302.5" y2="140"/><polyline points="295.5,135.5 302.5,140 295.5,144.5"/>
<line x1="263" y1="190.5" x2="302.5" y2="190.5"/><polyline points="295.5,186 302.5,190.5 295.5,195"/>
<line x1="263" y1="241" x2="302.5" y2="241"/><polyline points="295.5,236.5 302.5,241 295.5,245.5"/>
</g>
<text x="245" y="288" font-size="18" text-anchor="middle" fill="#222">current 1.5 m/s</text>
</g>
</g>
Here is the river from above: 300 metres between the banks, and the current carrying everything downstream at 1.5 metres per second.
<g id="drift">
<line x1="112" y1="302.5" x2="246.5" y2="78.5" stroke="#888" stroke-width="2" stroke-dasharray="8 6"/>
<circle cx="246.5" cy="78.5" r="4" fill="#888"/>
<text x="246.5" y="62.5" font-size="18" text-anchor="middle" fill="#222" data-val="c*W/v" data-fmt="0">lands {} m downstream</text>
</g>
Point it straight at B and the crossing takes 120 seconds, but the water pushes the whole time: the drift carries it 180 metres downstream.
<g id="triangle">
<line x1="448" y1="313.5" x2="364" y2="201.5" stroke="#222" stroke-width="3"/>
<polyline points="372,205.5 364,201.5 365.5,210" fill="none" stroke="#222" stroke-width="3"/>
<line x1="364" y1="201.5" x2="448" y2="201.5" stroke="#888" stroke-width="3"/>
<polyline points="441.5,197 448,201.5 441.5,206" fill="none" stroke="#888" stroke-width="3"/>
<line x1="448" y1="313.5" x2="448" y2="201.5" stroke="#222" stroke-width="3"/>
<polyline points="443.5,208.5 448,201.5 452.5,208.5" fill="none" stroke="#222" stroke-width="3"/>
<path d="M448,285.5A28,28,0,0,0,431,291" fill="none" stroke="#222" stroke-width="2"/>
<text x="426.5" y="307" font-size="18" text-anchor="end" fill="#222">37°</text>
<text x="406" y="192.5" font-size="18" text-anchor="middle" fill="#888">current 1.5</text>
<text x="388" y="256" font-size="18" text-anchor="end" fill="#222">heading</text>
<text x="388" y="278" font-size="18" text-anchor="end" fill="#222">2.5 m/s</text>
<text x="458" y="250" font-size="18" fill="#222">across</text>
<text x="458" y="272" font-size="18" fill="#222" data-val="u" data-fmt="1">{} m/s</text>
<text x="448" y="340" font-size="16" text-anchor="middle" fill="#888">1 m/s = 56 units</text>
</g>
Velocities add tip to tail, so draw the triangle: the ferry's 2.5 through the water plus the current's 1.5 must sum to a velocity pointing straight across. It is a 3, 4, 5 triangle, so 2.0 metres per second is left for crossing, with the aim about 37 degrees upstream.
<g id="aim">
<line x1="112" y1="302.5" x2="82" y2="262" stroke="#222" stroke-width="3"/>
<polyline points="89.5,266 82,262 83.5,270.5" fill="none" stroke="#222" stroke-width="3"/>
<line x1="112" y1="302.5" x2="112" y2="82" stroke="#7c3aed" stroke-width="3"/>
<polyline points="107.5,86 112,79.5 116.5,86" fill="none" stroke="#7c3aed" stroke-width="3"/>
<text x="112" y="346" font-size="18" text-anchor="middle" fill="#222">aims 37° upstream</text>
<text x="120" y="168" font-size="18" fill="#7c3aed">150 s</text>
</g>
So the ferry takes that aim, and the current bends its path into a straight line from A to B.
<g id="time">
<text x="550" y="392" font-size="20" text-anchor="end" fill="#7c3aed" data-val="W/u" data-fmt="0">crossing: {} s, not 120 s</text>
</g>
It pays in time: only 2.0 of its 2.5 metres per second carry it across, so the crossing takes 150 seconds instead of 120.
<check>If the current ran at 3 metres per second, faster than the ferry, could any aim still take it straight to B?</check>`,
  },
  {
    title: 'a quantity over time: the cause drawn (cells splitting), the curve it makes, the gains read off it, the equal steps braced',
    question: 'Why does most of the rise come at the end, if the yeast works at the same pace the whole time?',
    page: 3,
    pages: [3],
    plan: 'The student thinks a steady pace means steady growth. Picture: cells splitting, and the volume over time. Beats: 1 each cell splits every 45 min, 1 → 8; 2 the volume curve, 400 to 3200 ml; 3 the gains: +400, +800, +1600; 4 equal times, equal doublings. Scope: narrow.',
    listing: String.raw`PAGE 3 (visible; portrait page; image attached)
t1 80 100–640: Proofing the dough
t2 140 100–900: The dough doubles every 45 minutes at room temperature: 400 ml becomes 3200 ml
t3 175 100–700: in just over two hours. Most of the rise comes at the end.
#g1 figure 100,300 800×420 "bowls"`,
    script: String.raw`{{highlight p=3 "Most of the rise comes at the end."}} The pace is steady per cell, not per bowl, so the growth piles up at the end.
<plan>
Case: 400 ml doubling every 45 min: v = 400·2^(t/45), 800 at 45, 1600 at 90, 3200 at 135. Gains 400, 800, 1600. One cell → 2, 4, 8.
BOARD viewBox="0 0 560 396"
regions: cells (22–220, 50–240) one row per 45 min; chart (220–560, 50–336) 0–135 min → x 260–500, 0–3200 ml → y 314–67; brackets (260–500, 336–390)
groups: yeast; curve; steps; same
</plan>
<g id="yeast">
<text x="28" y="61.5" font-size="18" fill="#222">yeast cells</text>
<text x="28" y="98.5" font-size="16" fill="#888">0 min</text>
<circle cx="100" cy="93" r="7" fill="none" stroke="#222" stroke-width="2"/>
<text x="28" y="143.5" font-size="16" fill="#888">45 min</text>
<g fill="none" stroke="#222" stroke-width="2"><circle cx="100" cy="138" r="7"/><circle cx="116" cy="138" r="7"/></g>
<text x="28" y="188" font-size="16" fill="#888">90 min</text>
<g fill="none" stroke="#222" stroke-width="2"><circle cx="100" cy="183" r="7"/><circle cx="116" cy="183" r="7"/><circle cx="132" cy="183" r="7"/><circle cx="148" cy="183" r="7"/></g>
<text x="28" y="233" font-size="16" fill="#888">135 min</text>
<g fill="none" stroke="#222" stroke-width="2"><circle cx="100" cy="228" r="7"/><circle cx="116" cy="228" r="7"/><circle cx="132" cy="228" r="7"/><circle cx="148" cy="228" r="7"/><circle cx="164" cy="228" r="7"/><circle cx="180" cy="228" r="7"/><circle cx="196" cy="228" r="7"/><circle cx="212" cy="228" r="7"/></g>
</g>
Every yeast cell splits in two each 45 minutes, so 1 becomes 2, then 4, then 8.
<g id="curve" data-const="v0=400 T=45">
<g data-axes="ax" data-x="0,135" data-y="0,3200" data-box="260,67,240,247" data-frame="" data-ticks-x="0,45,90,135" data-ticks-y="400,800,1600,3200" data-unit-x=" min"/>
<text x="267" y="56" font-size="18" fill="#222">dough volume (ml)</text>
<path id="volume" data-fn="v0*2^(x/T)" data-axes="ax" fill="none" stroke="#222" stroke-width="3"/>
</g>
The dough's volume follows the cells: on this curve 400 millilitres doubles to 800, then 1600, then 3200, bending upward.
<g id="steps">
<g stroke="#888" stroke-width="1.5" stroke-dasharray="6 5"><line data-from="at(volume, x=0)" data-to="pt(ax, T, v0)"/><line data-from="at(volume, x=T)" data-to="pt(ax, 2*T, 2*v0)"/><line data-from="at(volume, x=2*T)" data-to="pt(ax, 3*T, 4*v0)"/></g>
<g stroke="#222" stroke-width="3"><line data-from="pt(ax, T, v0)" data-to="at(volume, x=T)"/><line data-from="pt(ax, 2*T, 2*v0)" data-to="at(volume, x=2*T)"/><line data-from="pt(ax, 3*T, 4*v0)" data-to="at(volume, x=3*T)"/></g>
<text data-at="at(volume, x=T)" dx="5.5" dy="19" font-size="18" fill="#222" data-val="v0" data-fmt="0">+{}</text>
<text data-at="at(volume, x=2*T)" dx="5.5" dy="34.5" font-size="18" fill="#222" data-val="2*v0" data-fmt="0">+{}</text>
<text data-at="at(volume, x=3*T)" dx="5.5" dy="65" font-size="18" fill="#222" data-val="4*v0" data-fmt="0">+{}</text>
</g>
Now read the steps: the first 45 minutes add 400 millilitres, the next add 800, and the last add 1600, more than both before them together.
<g id="same">
<path d="M260,338V344H340V338M340,344H420V338M420,344H500V338" fill="none" stroke="#7c3aed" stroke-width="2.5"/>
<g font-size="16" fill="#7c3aed" text-anchor="middle"><text x="300" y="362">×2</text><text x="380" y="362">×2</text><text x="460" y="362">×2</text><text x="380" y="384">45 min each</text></g>
</g>
Each step takes the same 45 minutes and makes the same doubling; what grows is the amount being doubled, so the last doubling adds the most.`,
  },
];
