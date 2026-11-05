// src/demo/svg/dough.ts — the yeast-dough answer, stage 2's second example until p6.18 (replaced in the
// prompt by a process in steps). Kept for the demos that play it (svg-dough, new-question).
export const DOUGH = {
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
  };
