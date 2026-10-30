// src/ui/Specimen.tsx — the landing page's picture of petu at work: a lecture slide, a student's
// question, the tutor's highlight and pen on the slide, and the board beside it drawing the answer
// while the caption speaks. One orchestrated sequence on load (CSS, landing.css); it rests on the
// finished frame, and with reduced motion it is that frame from the start.
//
// The slide is the sample deck's own (econ.pdf p12: a per-unit tax), so what the picture promises is
// what "Try the sample deck" shows. The board follows the board's grammar: drawn in the accent, then
// settled to ink; the region hatched.

const CAPTION = 'The tax drives a 2-dollar wedge between buyers and sellers, so 5 trades that were worth making stop. The lost value is the triangle: half of 2 times 5.'.split(' ');

export function Specimen() {
  return (
    <figure className="spec" aria-label="A student asks why the deadweight loss is 5; petu highlights the slide and draws the lost-trades triangle beside it.">
      <div className="spec-ask"><span>Why is the deadweight loss 5?</span></div>
      <svg className="spec-art" viewBox="0 0 640 400" role="presentation">
        <defs>
          <pattern id="spec-hatch" patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)">
            <rect width="7" height="7" className="spec-hatch-tint" />
            <line x1="0" y1="0" x2="0" y2="7" className="spec-hatch-line" />
          </pattern>
        </defs>

        {/* The slide */}
        <g className="spec-slide">
          <rect x="0.5" y="0.5" width="372" height="399" rx="6" className="spec-paper" />
          <text x="24" y="40" className="spec-slide-title">A Per-Unit Tax</text>
          <g className="spec-axes">
            <line x1="44" y1="78" x2="44" y2="300" />
            <line x1="44" y1="300" x2="300" y2="300" />
            <text x="34" y="84" className="spec-slide-tick" textAnchor="end">P</text>
            <text x="304" y="316" className="spec-slide-tick">Q</text>
          </g>
          <line x1="44" y1="102" x2="296" y2="296" className="spec-d" />
          <line x1="44" y1="250" x2="270" y2="98" className="spec-s" />
          <line x1="44" y1="230" x2="250" y2="91" className="spec-st" />
          <polygon points="132,170 132,190 147,181" className="spec-dwl" />
          <line x1="132" y1="190" x2="132" y2="300" className="spec-guide" />
          <circle cx="132" cy="170" r="3" className="spec-pt" />
          <circle cx="132" cy="190" r="3" className="spec-pt" />
          <text x="112" y="163" textAnchor="end" className="spec-slide-tick">Pb = 8</text>
          <text x="122" y="222" textAnchor="end" className="spec-slide-tick">Ps = 6</text>
          <text x="132" y="316" textAnchor="middle" className="spec-slide-tick">20</text>
          <text x="264" y="298" className="spec-slide-tick spec-dlabel">D</text>
          <text x="258" y="98" className="spec-slide-tick spec-slabel">S</text>
          {/* The bullet the tutor highlights */}
          <rect x="22" y="336" width="268" height="22" rx="3" className="spec-hl" />
          <text x="26" y="351" className="spec-slide-body">Trades between Q = 20 and 25 vanish</text>
          <text x="26" y="378" className="spec-slide-body spec-dim">Buyers and sellers split the tax</text>
        </g>

        {/* The tutor's pen on the slide: a ring round the triangle, a connector to the board */}
        <ellipse cx="141" cy="180" rx="22" ry="18" className="spec-pen spec-ring" pathLength="1" />
        <path d="M 163 176 C 260 150, 330 150, 400 128" className="spec-pen spec-link" pathLength="1" />

        {/* The board */}
        <g className="spec-board">
          <rect x="384" y="0.5" width="255.5" height="399" rx="6" className="spec-boardbg" />
          <text x="404" y="52" className="spec-b-title">The lost trades</text>
          <line x1="404" y1="80" x2="616" y2="80" className="spec-b-ink spec-b-axis" pathLength="1" />
          <text x="410" y="70" className="spec-b-small">20</text>
          <text x="600" y="70" className="spec-b-small">25</text>
          <polygon points="410,112 410,184 606,148" className="spec-b-tri" />
          <polyline points="410,112 410,184 606,148 410,112" className="spec-b-ink spec-b-edge" pathLength="1" />
          <text x="416" y="106" className="spec-b-label">buyers value it at 8</text>
          <text x="416" y="202" className="spec-b-label">sellers could make it for 6</text>
          <text x="396" y="153" textAnchor="end" className="spec-b-label">2</text>
          <line x1="410" y1="226" x2="606" y2="226" className="spec-b-ink spec-b-dim" pathLength="1" />
          <text x="508" y="248" textAnchor="middle" className="spec-b-label">5 lost trades</text>
          <text x="508" y="300" textAnchor="middle" className="spec-b-result">DWL = ½ × 2 × 5 = 5</text>
        </g>
      </svg>
      <figcaption className="spec-caption">
        {CAPTION.map((w, i) => <span key={i} style={{ '--i': i } as React.CSSProperties}>{w} </span>)}
      </figcaption>
    </figure>
  );
}
