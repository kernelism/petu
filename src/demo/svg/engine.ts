// src/demo/svg/engine.ts — svg board demos of the exact-data engine (src/svgboard/data.ts): the model
// writes formulas (curves, crossings, readouts) and {{tween}}s its constants; the engine computes every
// number and position and moves what depends on them. Raw beat format, each beat's group first (it
// draws across its sentences), as the model writes it.

export const SVG_ENGINE_DEMOS: Record<string, { question: string; raw: string }> = {
  /**
   * A deliberately dense board (synthetic, founder report 2026-10-30): rows of small cells with a
   * centred label under each pair and a value under that, written for a 1000-unit canvas. In the
   * 544 px lane the grammar's size would double these labels; they must stay clear of each other and
   * of the cells (grammar.ts roomSizes).
   */
  dense: {
    question: 'How does a two-number average slide along a row?',
    raw: `<plan>
A row of numbers averaged two at a time, then a second row with other weights.
BOARD viewBox="0 0 1000 420"
groups: first; firstw; second; secondw
</plan>
<g id="first">
  <text x="40" y="38" font-size="24" fill="#222">Averaging neighbours, two at a time</text>
  <text x="40" y="78" font-size="18" fill="#888">first row: three neighbouring pairs</text>
  <g fill="none" stroke="#222" stroke-width="2">
    <rect x="90" y="100" width="60" height="55"/><rect x="150" y="100" width="60" height="55"/>
    <rect x="310" y="100" width="60" height="55"/><rect x="370" y="100" width="60" height="55"/>
    <rect x="530" y="100" width="60" height="55"/><rect x="590" y="100" width="60" height="55"/>
  </g>
  <g font-size="21" fill="#222" text-anchor="middle">
    <text x="120" y="135">1</text><text x="180" y="135">2</text><text x="340" y="135">2</text>
    <text x="400" y="135">3</text><text x="560" y="135">3</text><text x="620" y="135">4</text>
  </g>
</g>
Each pair of neighbours is averaged
<g id="firstw">
  <g font-size="17" fill="#888" text-anchor="middle">
    <text x="150" y="181">weights 0.5, 0.5</text><text x="370" y="181">weights 0.5, 0.5</text><text x="590" y="181">weights 0.5, 0.5</text>
  </g>
  <g font-size="19" fill="#222" text-anchor="middle"><text x="150" y="208">1.5</text><text x="370" y="208">2.5</text><text x="590" y="208">3.5</text></g>
</g>
with weights of one half: one point five, two point five, three point five.
<g id="second">
  <text x="40" y="245" font-size="18" fill="#888">second row: other weights</text>
  <g fill="none" stroke="#222" stroke-width="2">
    <rect x="90" y="260" width="60" height="55"/><rect x="150" y="260" width="60" height="55"/>
    <rect x="310" y="260" width="60" height="55"/><rect x="370" y="260" width="60" height="55"/>
    <rect x="530" y="260" width="60" height="55"/><rect x="590" y="260" width="60" height="55"/>
  </g>
  <g font-size="21" fill="#222" text-anchor="middle">
    <text x="120" y="295">0</text><text x="180" y="295">2</text><text x="340" y="295">2</text>
    <text x="400" y="295">0</text><text x="560" y="295">0</text><text x="620" y="295">2</text>
  </g>
</g>
A second row with weights of one quarter
<g id="secondw">
  <g font-size="17" fill="#888" text-anchor="middle">
    <text x="150" y="341">weights 0.25, 0.25</text><text x="370" y="341">weights 0.25, 0.25</text><text x="590" y="341">weights 0.25, 0.25</text>
  </g>
  <g font-size="21" fill="#222" text-anchor="middle"><text x="150" y="382">value 0.5</text><text x="370" y="382">value 0.5</text><text x="590" y="382">value 0.5</text></g>
  <text x="800" y="300" font-size="18" fill="#7c3aed" text-anchor="middle">same rule,</text>
  <text x="800" y="324" font-size="18" fill="#7c3aed" text-anchor="middle">every position</text>
</g>
gives one half everywhere: the same rule at every position.`,
  },
  ceiling: {
    question: 'Why does a rent ceiling below the market rent create a shortage, and what happens if it is cut further?',
    raw: `<plan>
Supply and demand for flats; a ceiling under the crossing; then the ceiling is lowered and the gap grows.
BOARD viewBox="0 0 1000 620"
groups: market; equilibrium; ceiling; shortage; card
</plan>
<g id="market" data-const="a=1200 b=5 c=400 e=5 pc=700">
  <g data-axes="ax" data-x="0,150" data-y="300,1300" data-box="110,50,500,440" data-frame="" data-ticks-x="0,50,100,150" data-ticks-y="400,800,1200" data-unit-y="" />
  <text x="110" y="34" font-size="18" fill="#555">rent ($ a month)</text>
  <text x="610" y="545" font-size="18" fill="#555" text-anchor="end">flats</text>
  <path id="demand" data-fn="a-b*x" data-axes="ax" fill="none" stroke="#222" stroke-width="2.5"/>
  <text data-at="at(demand, x=22)" dx="10" dy="-14" font-size="20" fill="#222">demand</text>
  <path id="supply" data-fn="c+e*x" data-axes="ax" fill="none" stroke="#222" stroke-width="2.5"/>
  <text data-at="at(supply, x=140)" dx="-4" dy="-14" font-size="20" fill="#222" text-anchor="end">supply</text>
</g>
Renters want fewer flats as rent rises, landlords offer more, and the two lines meet where the market settles.
<g id="equilibrium">
  <line data-from="cross(demand,supply)" data-to="onx(cross(demand,supply))" stroke="#888" stroke-dasharray="4 4"/>
  <circle id="E" data-at="cross(demand,supply)" r="6" fill="#222"/>
  <text data-at="pt(ax, 18, yof(E))" dy="7" font-size="20" fill="#222" data-val="yof(E)">\${} market rent</text>
</g>
That crossing, the equilibrium, sits at eight hundred dollars, with eighty flats rented.
<g id="ceiling" data-ghost="">
  <line data-from="pt(ax, 0, pc)" data-to="pt(ax, 150, pc)" stroke="#7c3aed" stroke-width="3"/>
  <text data-at="pt(ax, 150, pc)" dx="10" dy="6" font-size="20" fill="#7c3aed" data-val="pc">cap \${}</text>
</g>
Now the city caps rent at seven hundred, below the crossing.
<g id="shortage">
  <line data-from="at(supply, y=pc)" data-to="onx(at(supply, y=pc))" stroke="#888" stroke-dasharray="4 4"/>
  <line data-from="at(demand, y=pc)" data-to="onx(at(demand, y=pc))" stroke="#888" stroke-dasharray="4 4"/>
  <line data-from="at(supply, y=pc)" data-to="at(demand, y=pc)" stroke="#7c3aed" stroke-width="7" stroke-opacity="0.35"/>
  <circle data-at="at(supply, y=pc)" r="6" fill="#7c3aed"/>
  <circle data-at="at(demand, y=pc)" r="6" fill="#7c3aed"/>
</g>
At that cap landlords offer only sixty flats, while renters now want a hundred: the shortage is the gap between them.
<g id="card">
  <rect x="680" y="70" width="290" height="190" rx="10" fill="#f6f3ff" stroke="#c4b5fd"/>
  <text x="700" y="108" font-size="20" fill="#555">at the cap</text>
  <text x="700" y="148" font-size="22" fill="#222" data-val="pc">rent \${}</text>
  <text x="700" y="186" font-size="22" fill="#222" data-val="xof(at(demand, y=pc))-xof(at(supply, y=pc))">shortage {} flats</text>
  <text x="700" y="224" font-size="18" fill="#555" data-val="xof(at(supply, y=pc))">{} flats offered</text>
</g>
The card keeps the count: a shortage of forty flats.
Cut the cap {{tween pc=600 dur=3.5}} to six hundred and watch both ends move apart: fewer flats offered, more wanted.
The shortage doubles to eighty: the lower the cap, the wider the gap.`,
  },

  spin: {
    question: 'Why does a skater spin faster when she pulls her arms in?',
    raw: `<plan>
Top view of the skater: arms out, then pulled in; a live readout of her spin; L stays fixed.
BOARD viewBox="0 0 1000 560"
groups: skater; spin; card; bars
</plan>
<g id="skater" data-const="p=0 m=2 Ib=3 L=10 r=1.4-0.9*p I=Ib+2*m*r^2 w=L/I">
  <circle cx="300" cy="280" r="210" fill="none" stroke="#bbb" stroke-dasharray="3 6"/>
  <g id="arms" data-ghost="">
    <line data-from="300,280" data-to="300+150*r, 280" stroke="#222" stroke-width="4"/>
    <line data-from="300,280" data-to="300-150*r, 280" stroke="#222" stroke-width="4"/>
    <circle data-at="300+150*r, 280" r="11" fill="#222"/>
    <circle data-at="300-150*r, 280" r="11" fill="#222"/>
  </g>
  <circle cx="300" cy="280" r="42" fill="#fff" stroke="#222" stroke-width="3"/>
  <text x="300" y="530" font-size="20" fill="#555" text-anchor="middle">seen from above</text>
</g>
Seen from above, she spins with her arms held out, the hands far from the axis.
<g id="spin">
  <path id="sweep" data-param="300+72*cos(t*0.9), 280-72*sin(t*0.9)" data-t="0,w" fill="none" stroke="#7c3aed" stroke-width="5"/>
  <text data-at="300+104*cos(0.45*w), 280-104*sin(0.45*w)" font-size="22" fill="#7c3aed" text-anchor="middle" dominant-baseline="middle">ω</text>
</g>
The arc is how far she turns in a moment: her spin rate.
<g id="card">
  <rect x="620" y="80" width="340" height="236" rx="10" fill="#f6f3ff" stroke="#c4b5fd"/>
  <text x="640" y="120" font-size="20" fill="#555">live</text>
  <text x="640" y="162" font-size="22" fill="#222" data-val="I" data-fmt="1">I = {} kg·m²</text>
  <text x="640" y="202" font-size="22" fill="#7c3aed" data-val="w" data-fmt="2">ω = {} rad/s</text>
  <text x="640" y="242" font-size="22" fill="#222" data-val="I*w" data-fmt="1">L = Iω = {}</text>
  <text x="640" y="290" font-size="18" fill="#555">nothing outside twists her</text>
</g>
Her angular momentum, I times omega, is ten, and nothing outside her can change it.
<g id="bars">
  <text x="620" y="372" font-size="18" fill="#555">I</text>
  <rect x="650" y="354" height="26" data-set="width: 28*I" fill="#9a9aa0"/>
  <text x="620" y="422" font-size="18" fill="#7c3aed">ω</text>
  <rect x="650" y="404" height="26" data-set="width: 95*w" fill="#7c3aed"/>
  <line x1="650" y1="340" x2="650" y2="446" stroke="#888"/>
</g>
As bars: a wide I, a short omega. Their product is what stays put.
Now she pulls her arms {{tween p=1 dur=4}} in: the mass moves toward the axis, so I falls from about 10.8 to 4.
To keep L at ten, omega climbs from 0.92 to 2.5 rad per second: she spins nearly three times as fast.`,
  },

  slope: {
    question: 'Why is the derivative of sin x equal to cos x?',
    raw: `<plan>
The sine curve; a point slides along it with its tangent; the tangent's slope is plotted and traces cos.
BOARD viewBox="0 0 1000 560"
groups: curve; tangent; slope; cos
</plan>
<g id="curve" data-const="a=0.4">
  <g data-axes="ax" data-x="0,6.6" data-y="-1.35,1.35" data-box="80,60,620,400" />
  <line x1="80" y1="260" x2="700" y2="260" stroke="#888"/>
  <line x1="80" y1="60" x2="80" y2="460" stroke="#888"/>
  <path id="sine" data-fn="sin(x)" data-axes="ax" fill="none" stroke="#222" stroke-width="3"/>
  <text data-at="max(sine)" dy="-16" font-size="22" fill="#222" text-anchor="middle">sin x</text>
  <text x="700" y="290" font-size="18" fill="#555" text-anchor="end">x</text>
</g>
Here is sine. Take a point on it and look at how steep the curve is there.
<g id="tangent">
  <line data-from="pt(ax, a-0.5, sin(a)-0.5*cos(a))" data-to="pt(ax, a+0.5, sin(a)+0.5*cos(a))" stroke="#7c3aed" stroke-width="3"/>
  <circle id="P" data-at="at(sine, x=a)" r="7" fill="#7c3aed"/>
</g>
The tangent touches the curve at the point; its steepness is the slope.
<g id="slope">
  <line data-from="pt(ax, a, 0)" data-to="pt(ax, a, cos(a))" stroke="#7c3aed" stroke-width="2" stroke-dasharray="3 4"/>
  <circle data-at="pt(ax, a, cos(a))" r="6" fill="#fff" stroke="#7c3aed" stroke-width="2.5" data-trace=""/>
  <rect x="740" y="80" width="230" height="110" rx="10" fill="#f6f3ff" stroke="#c4b5fd"/>
  <text x="760" y="120" font-size="20" fill="#555" data-val="a" data-fmt="2">at x = {}</text>
  <text x="760" y="160" font-size="22" fill="#7c3aed" data-val="cos(a)" data-fmt="2">slope = {}</text>
</g>
Mark the slope as a height above the same x: the hollow dot.
Now slide the point {{tween a=6.1 dur=6 ease=linear}} along the curve and let the dot leave a trail.
Steep going up near zero, flat at the top, steepest going down at pi: the trail rises, crosses zero, and dips to minus one.
<g id="cos">
  <path id="cosine" data-fn="cos(x)" data-axes="ax" fill="none" stroke="#7c3aed" stroke-width="1.5" stroke-dasharray="6 5"/>
  <text data-at="at(cosine, x=6.1)" dx="-8" dy="-18" font-size="22" fill="#7c3aed" text-anchor="end">cos x</text>
</g>
The trail is exactly cos x: the slope of sine at every point is cosine.`,
  },
};
