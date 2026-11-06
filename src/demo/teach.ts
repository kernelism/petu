// src/demo/teach.ts — the teaching engine's Phase 1 demos written as the model would write them
// (docs/briefs/proposals/teaching-engine.md §0, §3.9): raw stage-2 output, run through the server's own
// filter (SvgBeatFilter), so the wire is exactly what an answer sends.
import { SvgBeatFilter } from '../../server/svgBeats';

function wire(raw: string): string {
  const f = new SvgBeatFilter(() => 0);
  return (f.push(raw) + f.end()).trim();
}

const INK = '#1d1d1f', MUTED = '#6E6E73', ACCENT = '#7c3aed';

/**
 * The moment of inertia of a thin rod about its centre (OpenStax University Physics 1, §10.5, PDF
 * pages 490–491): a free-canvas derivation (slice, dm, dI, the integral) and its numbers from a calc
 * program, the slice sums closing in on ML²/12. No number on the board or in the voice is typed.
 */
const ROD = `Cut the rod into thin slices, add up each slice's mass times its distance squared, and let the slices shrink: that sum becomes an integral.
<plan>
Thin rod, mass M, length L, axis through the centre. Slice dx at x; dm = λ dx; dI = x² dm; integrate −L/2..L/2 → ML²/12. Then the same sum with 4, 10, 100 slices from a calc, approaching 1/12.
BOARD viewBox="0 0 560 560"
groups: rod; slice; derive; sums
</plan>
<g id="rod">
  <line x1="60" y1="80" x2="500" y2="80" stroke="${INK}" stroke-width="8" stroke-linecap="round"/>
  <line x1="280" y1="36" x2="280" y2="124" stroke="${MUTED}" stroke-width="1.5" stroke-dasharray="5 4"/>
  <text x="288" y="40" font-size="16" fill="${MUTED}">axis</text>
  <text x="60" y="56" font-size="18" fill="${INK}">mass M, length L</text>
  <line x1="280" y1="140" x2="510" y2="140" stroke="${MUTED}" stroke-width="1.5"/>
  <polyline points="500,134 510,140 500,146" fill="none" stroke="${MUTED}" stroke-width="1.5"/>
  <text x="516" y="146" font-size="18" fill="${MUTED}">x</text>
</g>
Here is the rod, with the axis through its middle and x measured from the axis.
<g id="slice">
  <rect x="392" y="72" width="16" height="16" fill="${ACCENT}"/>
  <text x="388" y="64" font-size="18" fill="${ACCENT}">dm</text>
  <line x1="280" y1="108" x2="400" y2="108" stroke="${ACCENT}" stroke-width="1.5"/>
  <text x="332" y="126" font-size="18" fill="${ACCENT}">x</text>
  <text x="394" y="108" font-size="15" fill="${ACCENT}">dx</text>
</g>
Take one thin slice, of width dx, at distance x. Its mass is dm.
<g id="derive">
  <text x="40" y="200" font-size="20" fill="${INK}">λ = M / L</text>
  <text x="40" y="236" font-size="20" fill="${INK}">dm = λ dx</text>
  <text x="40" y="272" font-size="20" fill="${INK}">dI = x² dm = λ x² dx</text>
  <text x="40" y="308" font-size="20" fill="${INK}">I = ∫ λ x² dx, from −L/2 to L/2</text>
  <text x="40" y="344" font-size="20" fill="${ACCENT}">I = λ L³ / 12 = M L² / 12</text>
</g>
The rod is uniform, so its mass per length is M over L, and the slice's mass is that times dx. The slice adds x squared times its mass. Add every slice from one end to the other, and the integral gives M L squared over twelve.
<calc id="rod">
  const M = 1, L = 1;
  // the sum of x² dm over n equal slices, each at its middle
  const slices = n => { let I = 0; for (let i = 0; i < n; i++) { const x = -L / 2 + (i + 0.5) * L / n; I += x * x * M / n; } return I; };
  export const I4 = slices(4), I10 = slices(10), I100 = slices(100);
  export const exact = M * L * L / 12;
</calc>
<g id="sums">
  <rect x="60" y="400" width="110" height="14" fill="#E8E1F8" stroke="${INK}" stroke-width="1"/>
  <rect x="170" y="400" width="110" height="14" fill="#F4F0FB" stroke="${INK}" stroke-width="1"/>
  <rect x="280" y="400" width="110" height="14" fill="#E8E1F8" stroke="${INK}" stroke-width="1"/>
  <rect x="390" y="400" width="110" height="14" fill="#F4F0FB" stroke="${INK}" stroke-width="1"/>
  <text x="40" y="452" font-size="19" fill="${INK}" data-val="rod.I4" data-fmt="0.000000">4 slices:  I ≈ {} M L²</text>
  <text x="40" y="484" font-size="19" fill="${INK}" data-val="rod.I10" data-fmt="0.000000">10 slices:  I ≈ {} M L²</text>
  <text x="40" y="516" font-size="19" fill="${INK}" data-val="rod.I100" data-fmt="0.000000">100 slices:  I ≈ {} M L²</text>
  <text x="40" y="548" font-size="19" fill="${ACCENT}" data-val="rod.exact" data-fmt="0.000000">exact, 1/12:  I = {} M L²</text>
</g>
Check it with real slices. With four, the sum is {{val rod.I4 fmt=4}} times M L squared; with ten, {{val rod.I10 fmt=4}}; with a hundred, {{val rod.I100 fmt=5}}. They close in on one twelfth, {{val rod.exact fmt=5}}: that is what the integral adds up.`;


/**
 * Column addition, 478 + 356, with carries: one step constant `s` drives the board (the column frame
 * glides right to left, each sum digit and carry appears on its step), the numbers come from a calc,
 * and going back replays a step (the tween rewinds). The digits being added are the question's own.
 */
const reveal = (n: number) => `min(1, max(0, s - ${n - 1}))`;
const only = (n: number) => `max(0, 1 - abs(s - ${n}))`;
const ADD = `Add column by column from the right, and carry whenever a column reaches ten.
<plan>
478 + 356 in columns; s steps ones, tens, hundreds; carries 1 and 1; sum 834 from a calc.
BOARD viewBox="0 0 560 320"
groups: sum
</plan>
<calc id="add">
  const a = [4, 7, 8], b = [3, 5, 6];
  const cs = [0, 0, 0], d = [0, 0, 0, 0], c = [0, 0, 0];
  let carry = 0;
  for (let i = 2; i >= 0; i--) { const t = a[i] + b[i] + carry; cs[i] = t; d[i + 1] = t % 10; carry = Math.floor(t / 10); c[i] = carry; }
  d[0] = carry;
  export { cs, d, c };
  export const sum = Number(d.join(''));
</calc>
{{const s=0}} Write them in columns: hundreds, tens and ones.
<g id="sum">
  <rect y="96" width="52" height="186" rx="6" fill="none" stroke="${ACCENT}" stroke-width="2" data-set="x: 324 - 60*(s - 1); opacity: ${reveal(1)} * min(1, max(0, 4 - s))"/>
  <text x="230" y="40" font-size="16" fill="${MUTED}" text-anchor="middle">H</text>
  <text x="290" y="40" font-size="16" fill="${MUTED}" text-anchor="middle">T</text>
  <text x="350" y="40" font-size="16" fill="${MUTED}" text-anchor="middle">O</text>
  <text x="290" y="80" font-size="22" fill="${ACCENT}" text-anchor="middle" data-val="add.c[2]" data-set="opacity: add.c[2] * ${reveal(1)}">{}</text>
  <text x="230" y="80" font-size="22" fill="${ACCENT}" text-anchor="middle" data-val="add.c[1]" data-set="opacity: add.c[1] * ${reveal(2)}">{}</text>
  <text x="230" y="134" font-size="40" fill="${INK}" text-anchor="middle">4</text>
  <text x="290" y="134" font-size="40" fill="${INK}" text-anchor="middle">7</text>
  <text x="350" y="134" font-size="40" fill="${INK}" text-anchor="middle">8</text>
  <text x="170" y="194" font-size="40" fill="${INK}" text-anchor="middle">+</text>
  <text x="230" y="194" font-size="40" fill="${INK}" text-anchor="middle">3</text>
  <text x="290" y="194" font-size="40" fill="${INK}" text-anchor="middle">5</text>
  <text x="350" y="194" font-size="40" fill="${INK}" text-anchor="middle">6</text>
  <line x1="150" y1="214" x2="390" y2="214" stroke="${INK}" stroke-width="2.5"/>
  <text x="350" y="266" font-size="40" fill="${ACCENT}" text-anchor="middle" data-val="add.d[3]" data-set="opacity: ${reveal(1)}">{}</text>
  <text x="290" y="266" font-size="40" fill="${ACCENT}" text-anchor="middle" data-val="add.d[2]" data-set="opacity: ${reveal(2)}">{}</text>
  <text x="230" y="266" font-size="40" fill="${ACCENT}" text-anchor="middle" data-val="add.d[1]" data-set="opacity: ${reveal(3)}">{}</text>
  <text x="420" y="160" font-size="22" fill="${INK}" data-val="add.cs[2]" data-set="opacity: ${only(1)}">8 + 6 = {}</text>
  <text x="420" y="160" font-size="22" fill="${INK}" data-val="add.cs[1]" data-set="opacity: ${only(2)}">7 + 5 + 1 = {}</text>
  <text x="420" y="160" font-size="22" fill="${INK}" data-val="add.cs[0]" data-set="opacity: ${only(3)}">4 + 3 + 1 = {}</text>
</g>
Four seventy eight on top, three fifty six below. {{tween s=1 dur=0.8}} Start on the right: eight plus six is {{val add.cs[2]}}. Write the {{val add.d[3]}}, and carry the one into the tens. {{tween s=2 dur=0.8}} Tens: seven plus five, plus the one you carried, is {{val add.cs[1]}}. Write the {{val add.d[2]}} and carry one again. {{tween s=3 dur=0.8}} Hundreds: four plus three plus one is {{val add.cs[0]}}. {{tween s=4 dur=0.6}} So four seventy eight plus three fifty six is {{val add.sum}}.`;

/**
 * A 5x5 image convolved with a 3x3 kernel, on the engine's sliding window (src/svgboard/slide.ts): the
 * model writes the data and the steps; the engine lays out the grids, moves the frame, fills the outputs
 * and writes each one's working. The outputs are said from what the engine computed ({{val conv.out[…]}}).
 */
const CONV = `Slide the kernel over the image one position at a time; at each stop, multiply the overlapping numbers and add them up.
<plan>
5x5 image 1..25, 3x3 vertical-edge kernel turned around (convolution); valid output 3x3; walk 2 steps, then sweep.
BOARD viewBox="0 0 560 330"
groups: conv
</plan>
<calc id="img">
export const f = [1, 2, 3, 4, 5].map(r => [1, 2, 3, 4, 5].map(c => 5 * (r - 1) + c));
export const k = [[1, 0, -1], [1, 0, -1], [1, 0, -1]];
</calc>
<g id="conv" data-const="k=0" data-slide="img.f" data-kernel="img.k" data-flip="" data-step="k" data-origin="20,50" data-cell="36"/>
Here is the image, the kernel, and an empty output: convolution turns the kernel around before it slides. {{tween k=1 dur=0.8}} Put it on the top-left corner: the right column counts plus, the left column minus, and the sum is {{val conv.out[0][0]}}. {{tween k=2 dur=0.8}} Slide one step right, and every pair grows by the same amount, so the sum stays {{val conv.out[0][1]}}. {{tween k=9 dur=4}} Sweep the rest: the image rises at the same rate everywhere, so every output is {{val conv.out[2][2]}}.`;

/**
 * A box blur on the student's own slide (lec06 p16): the window reads the eye picture's pixels from the PDF
 * (data-slide="#i1", src/pixels), so the numbers under the frame are the slide's real gray levels.
 */
const EYE = `A box blur replaces every pixel with the average of the nine around it, so sharp edges spread out.
<plan>
The eye on this slide (#i1) as 24 columns of gray, the 3x3 box (each weight 1/9); two stops, then a sweep.
BOARD viewBox="0 0 560 470"
groups: eye
</plan>
<calc id="blur">
export const box = [[1, 1, 1], [1, 1, 1], [1, 1, 1]].map(r => r.map(v => v / 9));
</calc>
<g id="eye" data-const="s=0" data-slide="#i1" data-kernel="blur.box" data-step="s" data-origin="20,40"/>
Here is the eye from your slide, read as a grid of gray levels: dark pixels are small numbers, bright ones large. {{tween s=1 dur=0.8}} Put the box on the top-left corner: the nine pixels under it average to {{val eye.out[0][0]}}, and that is the first output pixel. {{tween s=2 dur=0.8}} Slide one pixel right: the window drops a column and takes in a new one, and the average is {{val eye.out[0][1]}}. {{tween s=484 dur=6}} Sweep the rest: each pixel becomes the mean of its neighbours, so the dark pupil and the eyelid bleed into the skin around them. That is the blur on the right of the slide.`;

/**
 * The Gaussian table on lec06 p22, filled from its formula (Phase 3, grid-fill): each cell is the formula at
 * that x and y, computed by a calc, written by the engine cell by cell. Nothing in the table is typed.
 */
const GAUSS = `Every number in that table is the Gaussian formula evaluated at one x and y: the farther from the centre, the smaller the weight.
<plan>
5x5, sigma 1 (p22): G(x,y) = e^(-(x²+y²)/2σ²)/(2πσ²) over x, y in -2..2. Two cells, the centre, then fill the rest.
BOARD viewBox="0 0 560 450"
groups: gform; gk
</plan>
<calc id="g">
const s = 1;
export const xs = [-2, -1, 0, 1, 2];
export const G = xs.map(y => xs.map(x => Math.exp(-(x * x + y * y) / (2 * s * s)) / (2 * Math.PI * s * s)));
</calc>
<g id="gform">
  <text x="20" y="34" font-size="20" fill="${INK}">G(x, y) = e^(−(x² + y²) / 2σ²) / 2πσ²,  σ = 1</text>
</g>
The formula takes a position and gives a weight.
<g id="gk" data-const="k=0" data-grid="g.G" data-rows="g.xs" data-cols="g.xs" data-rows-name="y" data-cols-name="x" data-fmt="3" data-step="k" data-origin="20,80"/>
Here are the x and y positions of a five by five kernel. {{tween k=1 dur=0.8}} The corner is two steps out in both directions, so its weight is tiny: {{val id=gk.out[0][0] fmt=3}}. {{tween k=2 dur=0.8}} One step closer in x and it grows to {{val id=gk.out[0][1] fmt=3}}. {{tween k=13 dur=2.5}} At the centre, x and y are both zero, so the exponential is one and the weight is one over two pi, {{val id=gk.out[2][2] fmt=3}}. {{tween k=25 dur=2.5}} The rest mirror these, because the formula only cares about the distance from the centre.`;

/**
 * Is the box filter separable? (lec06 p28) The outer product of a 1D box with itself, filled cell by cell.
 */
const SEP = `Yes: the three by three box is a column of thirds times a row of thirds, so you can blur the rows, then the columns.
<plan>
p28's question. Outer product [1/3 1/3 1/3]ᵀ [1/3 1/3 1/3] = the 3x3 box, every cell 1/9. Two cells, then the rest.
BOARD viewBox="0 0 560 330"
groups: sep
</plan>
<g id="sep" data-const="k=0" data-grid="mul" data-rows="1/3,1/3,1/3" data-cols="1/3,1/3,1/3" data-step="k" data-origin="40,50"/>
Put a one dimensional box down the side and another along the top. {{tween k=1 dur=0.8}} Each cell is its row's weight times its column's: a third times a third is {{val sep.out[0][0]}}. {{tween k=2 dur=0.8}} The next one is the same, {{val sep.out[0][1]}}. {{tween k=9 dur=2.5}} Every cell is a ninth, which is exactly the box filter. So one pass along the rows and one down the columns does the same blur, with three multiplications a pixel each way instead of nine.`;

/**
 * Newton's method for the square root of two (Phase 3, the plot view): the iterates come from a calc, the
 * engine plots them as the step moves, and the tangent is drawn from the trace (nw.x[k]), never by hand.
 */
const NEWTON = `Newton's method follows the tangent line down to where it crosses zero, and uses that crossing as the next guess.
<plan>
f(x) = x² − 2 from x0 = 1: 1, 1.5, 1.41667, 1.41422. Curve, the tangent at x_k to the axis, the trail of guesses.
BOARD viewBox="0 0 560 430"
groups: frame; nwt
</plan>
<calc id="nw">
const f = x => x * x - 2, df = x => 2 * x;
const xs = [1];
for (let i = 0; i < 4; i++) xs.push(xs[i] - f(xs[i]) / df(xs[i]));
export const x = xs;
export const y = xs.map(f);
</calc>
<g id="frame">
  <g data-axes="ax" data-x="0.9,1.6" data-y="-1.2,0.6" data-box="60,30,460,330" data-frame="" data-ticks-x="1,1.25,1.5" data-ticks-y="-1,-0.5,0,0.5"/>
  <path data-fn="x^2-2" data-axes="ax" fill="none" stroke="${INK}" stroke-width="2.5"/>
  <line data-from="pt(ax, 0.9, 0)" data-to="pt(ax, 1.6, 0)" stroke="${MUTED}" stroke-width="1"/>
</g>
Here is x squared minus two: its zero is the square root of two.
<g id="nwt" data-const="k=0">
  <line data-from="pt(ax, nw.x[k], nw.y[k])" data-to="pt(ax, nw.x[k+1], 0)" stroke="${ACCENT}" stroke-width="2" stroke-dasharray="6 4"/>
  <line data-from="pt(ax, nw.x[k], 0)" data-to="pt(ax, nw.x[k], nw.y[k])" stroke="${MUTED}" stroke-width="1" stroke-dasharray="3 3"/>
  <g data-series="nw.x, nw.y" data-axes="ax" data-upto="k"/>
  <text x="60" y="412" font-size="18" fill="${ACCENT}" data-val="nw.x[k]" data-fmt="5">guess: x = {}</text>
</g>
Start at one, where the curve is below zero. {{tween k=1 dur=1}} Follow the tangent down to the axis: the next guess is {{val id=nw.x[1] fmt=2}}. {{tween k=2 dur=1}} From there the tangent lands at {{val id=nw.x[2] fmt=4}}. {{tween k=3 dur=1}} One more and it is {{val id=nw.x[3] fmt=5}}: each step about doubles the correct digits.`;

export const TEACH_SCRIPTS = {
  'conv-proc': { src: '/dev/lec06_conv.pdf', page: 5, question: 'Convolve a 5x5 image with a 3x3 kernel and show the sliding window', script: wire(CONV) },
  'add-proc': { src: '/fixtures/examples.pdf', page: 1, question: 'How does 478 + 356 work, with carrying?', script: wire(ADD) },
  'eye-proc': { src: '/dev/lec06_conv.pdf', page: 16, question: 'Show the box blur running over the eye on this slide', script: wire(EYE) },
  'gauss-grid': { src: '/dev/lec06_conv.pdf', page: 22, question: 'Where do the numbers in this Gaussian kernel come from?', script: wire(GAUSS) },
  'sep-grid': { src: '/dev/lec06_conv.pdf', page: 28, question: 'Is the box filter separable?', script: wire(SEP) },
  'newton-plot': { src: '/fixtures/examples.pdf', page: 1, question: "Show Newton's method finding the square root of 2", script: wire(NEWTON) },
  'rod-proc': { src: '/dev/openstax-university-physics-volume-1.pdf', page: 491, question: 'Derive the moment of inertia of a thin rod about its centre', script: wire(ROD) },
};
