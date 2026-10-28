// src/demo/scripts.ts
import type { Demo } from './demoScript';

/**
 * Dev-only named scripts for real PDFs: `?script=<name>` (optionally `&src=<pdf url>`) opens the
 * PDF and plays the script. Anchored quotes are written against the PDF's actual text runs.
 * public/dev/ is git-ignored: the lecture PDFs are the user's course files and are never committed.
 */
export const SCRIPTS: Record<string, Demo & { src: string }> = {
  /**
   * lec09 p40 "Depth from disparity" (1920 × 1080; page model coords from pdf.js text runs).
   * The slide already draws the cameras, baseline B, f and image planes, so the sketch draws none of
   * them: it only compares a near point with one twice as far.
   *   "x − x′" inside the disparity equation: x 507–567, y 769–822 → box at (503,760), 68 × 72
   *   the fraction B·f / z: x 598–652, B·f cap top 737, z baseline 856 → circle at (627,800), rx 37 ry 50 (clear of the "=") (page radii
   *     are in the page's x units on both axes)
   *   "Disparity is inversely proportional to depth." is one text run: the highlighted payoff
   * Region `side` (1000 × 700): the two images laid on top of each other, centres lined up (x 500).
   *   depth z  : image row y 200 (150–850) + centre tick; x′ (300,200), x (700,200): offsets of 200
   *              each (B f / 2z); brace 700→300 at y 240 (tip down) "x − x′"
   *   depth 2z : image row y 470 + tick; x′ (400,470), x (600,470): offsets of 100 each; brace
   *              600→400 at y 510, accent, "half": directly under the first, so the lengths compare
   *   row labels z / 2z typeset as math left of each row (one voice: "2z" as a write would set in sans)
   * Elements (6): row z (+ label), its x and x′, its brace; row 2z (+ label), its x and x′, its brace
   * (accent). Page marks: the x − x′ box, then the payoff circles the slide's own B f / z and
   * highlights its last line.
   */
  lec09: {
    src: '/dev/lec09_optical_flow.pdf',
    question: 'Why is disparity inversely proportional to depth?',
    script:
      `{{scroll p=40}} Disparity, {{box p=40 at=503,760 size=68,72}} x minus x-prime, is how far a point shifts between the two images, ` +
      `and a farther point shifts less. ` +
      `{{sketch id=side near=p40 size=m}} Lay the two images on top of each other, ` +
      `{{line on=side from=150,200 to=850,200}} centres {{line on=side from=500,178 to=500,222 weight=secondary}} lined up. ` +
      `A point at depth {{math on=side at=50,200 "z" size=s}} z lands {{point on=side at=700,200 "x" dir=n}} here in the left image ` +
      `{{point on=side at=300,200 "x′" dir=n}} and here in the right, ` +
      `{{brace on=side from=700,240 to=300,240 "x − x′"}} and this gap is its disparity. ` +
      `Now a point {{math on=side at=50,470 "2z" size=s}} twice as far. ` +
      `{{line on=side from=150,470 to=850,470}} Same images, {{line on=side from=500,448 to=500,492 weight=secondary}} same centres. ` +
      `Its rays come in closer to parallel, so it lands {{point on=side at=600,470 "x" dir=n}} nearer ` +
      `{{point on=side at=400,470 "x′" dir=n}} the centre in both: ` +
      `{{brace on=side from=600,510 to=400,510 "half" em}} half the gap. ` +
      `That's the slide's {{circle p=40 at=627,800 rx=37 ry=50}} B f over z: twice the depth, half the disparity. ` +
      `{{highlight p=40 "Disparity is inversely proportional to depth."}} Disparity is inversely proportional to depth.`,
  },
  /**
   * Toolkit check (not a teaching demo): every v2 element once, in one region beside the sample
   * deck's page 3, for screenshots and the timing audit. Also every look flag: the three weights
   * (primary default, secondary, faint), dash (faint by default), shade plain / outline / em.
   */
  toolkit: {
    src: '/fixtures/epipolar.pdf',
    question: 'Toolkit check',
    script:
      `{{scroll p=3}} Toolkit check. {{sketch id=kit near=p3 size=m}} A point {{point on=kit at=120,120 "A" id=a}} here, ` +
      `a curve {{curve on=kit pts=200,120 300,60 400,140 500,80 dash}} through four points, ` +
      `a plain shade {{shade on=kit at=640,110 rx=70 ry=45}} under the ink, ` +
      `an outlined {{shade on=kit pts=760,60 940,80 940,190 760,170 outline}} sheet, ` +
      `two {{line on=kit from=80,440 to=380,440}} rays {{line on=kit from=80,440 to=290,250 weight=secondary}} and ` +
      `an accent {{shade on=kit pts=80,440 380,440 290,250 em}} wedge, ` +
      `an angle {{angle on=kit at=80,440 from=380,440 to=290,250 r=90 "θ"}} between them, ` +
      `a faint {{line on=kit from=290,250 to=290,440 weight=faint}} drop, ` +
      `a brace {{brace on=kit from=380,520 to=80,520 "B"}} under a span, ` +
      `axes {{axes on=kit at=560,640 size=380,300 x="depth z" y="disparity" id=ax}} with ` +
      `{{plot on=kit fn="1/x" domain=0.5,5 range=0,2.6 em id=pl}} one over x, ` +
      `math {{math on=kit at=80,665 "x - x' = \\frac{B\\,f}{z}"}} typeset, ` +
      `then {{emph id=a}} emphasis, {{move id=a to=160,200}} a move, {{fade id=a}} a fade, ` +
      `{{label id=pl "1/z" dir=n}} and a label.`,
  },
};
