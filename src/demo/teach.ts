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

export const TEACH_SCRIPTS = {
  'add-proc': { src: '/fixtures/examples.pdf', page: 1, question: 'How does 478 + 356 work, with carrying?', script: wire(ADD) },
  'rod-proc': { src: '/dev/openstax-university-physics-volume-1.pdf', page: 491, question: 'Derive the moment of inertia of a thin rod about its centre', script: wire(ROD) },
};
