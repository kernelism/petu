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

export const TEACH_SCRIPTS = {
  'rod-proc': { src: '/dev/openstax-university-physics-volume-1.pdf', page: 491, question: 'Derive the moment of inertia of a thin rod about its centre', script: wire(ROD) },
};
