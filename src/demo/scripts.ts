// src/demo/scripts.ts
import type { Demo } from './demoScript';

/**
 * Dev-only named scripts for real PDFs: `?script=<name>` (optionally `&src=<pdf url>`) opens the
 * PDF and plays the script. Anchored quotes are written against the PDF's actual text runs.
 * public/dev/ is git-ignored: the lecture PDFs are the user's course files and are never committed.
 */
export const SCRIPTS: Record<string, Demo & { src: string }> = {
  /**
   * lec09 p40 "Depth from disparity" (1920 × 1080; page model coords measured on a render):
   *   point x: label "x" (420,458), dot (433,498) → one ellipse around both at (427,478), rx 22 ry 30
   *   point x': label "x’" (597,466), dot (580,498) → at (589,483), rx 24 ry 30
   *   "x − x′" inside the disparity equation: x 507–567, y 769–822 → box at (503,760), 68 × 72
   * Region `side` (1000 × 700), true geometry with B 400, f 120:
   *   cameras O (300,570), O' (700,570); B as a brace under them (310→690 at y 592, tip down)
   *   image planes at y 450, x 190–440 and 560–810; f as a brace left of image 1 (y 560→456 at x 180)
   *   near point (500,330), z 240 → its rays cross the planes at 400 / 600: offsets of 100 each
   *   far point (500,90), z 480 (twice as far) → crossings at 350 / 650: offsets of 50 each
   *   offsets as the slide's small arrows from each image center: near at y 428 (dark), far at
   *   y 402 (accent); x / x' written under the near crossings at y 478
   *   payoff: the slide's own formula, typeset, top right at (620,170), clear of the far rays
   * Elements (6): cameras + B, image planes + f, near point + rays, near offsets, far point + rays,
   * far offsets (accent); payoff: the formula (accent).
   */
  lec09: {
    src: '/dev/lec09_optical_flow.pdf',
    question: 'Why is disparity inversely proportional to depth?',
    script:
      `{{scroll p=40}} Because a farther point shifts less between the two images. ` +
      `The point lands at {{circle p=40 at=427,478 rx=22 ry=30}} x in the left image ` +
      `and {{circle p=40 at=589,483 rx=24 ry=30}} x-prime in the right, and disparity is {{box p=40 at=503,760 size=68,72}} x minus x-prime. ` +
      `{{sketch id=side near=p40 size=m}} Here's {{point on=side at=300,570 "O" dir=sw}} camera O ` +
      `{{point on=side at=700,570 "O′" dir=se}} and camera O-prime, {{brace on=side from=690,592 to=310,592 "B"}} a baseline B apart, ` +
      `{{line on=side from=190,450 to=440,450}} each with {{line on=side from=560,450 to=810,450}} its image ` +
      `a distance {{brace on=side from=180,560 to=180,456 "f"}} f in front. ` +
      `Take a {{line on=side from=306,562 to=500,330}} near {{line on=side from=694,562 to=500,330}} point. ` +
      `{{point on=side at=500,330 "near" dir=e}} Its rays come in steeply, so they land far from each center: ` +
      `{{arrow on=side from=300,428 to=398,428}} this far in the left image, {{write on=side at=392,478 "x"}} that's x, ` +
      `{{arrow on=side from=700,428 to=602,428}} and this far in the right, {{write on=side at=574,478 "x′"}} that's x-prime. ` +
      `x minus x-prime adds these two lengths. ` +
      `Now a point {{line on=side from=304,561 to=500,90}} twice {{line on=side from=696,561 to=500,90}} as far. ` +
      `{{point on=side at=500,90 "far" dir=e}} Its rays are nearly straight up, so they land ` +
      `{{arrow on=side from=300,402 to=349,402 em}} half as far {{arrow on=side from=700,402 to=651,402 em}} from each center. ` +
      `{{math on=side at=620,170 "x - x' = \\frac{B\\,f}{z}" em}} Disparity is B f over z: twice the depth, half the disparity.`,
  },
  /**
   * Toolkit check (not a teaching demo): every v2 element once, in one region beside the sample
   * deck's page 3, for screenshots and the timing audit.
   */
  toolkit: {
    src: '/fixtures/epipolar.pdf',
    question: 'Toolkit check',
    script:
      `{{scroll p=3}} Toolkit check. {{sketch id=kit near=p3 size=m}} A point {{point on=kit at=120,120 "A" id=a}} here, ` +
      `a curve {{curve on=kit pts=200,120 300,60 400,140 500,80 dash}} through four points, ` +
      `a shade {{shade on=kit at=760,120 rx=90 ry=50}} under the ink, ` +
      `an angle {{angle on=kit at=100,400 from=300,400 to=220,260 "θ"}} at a vertex, ` +
      `a brace {{brace on=kit from=420,300 to=160,300 "B"}} under a span, ` +
      `axes {{axes on=kit at=560,640 size=380,300 x="depth z" y="disparity" id=ax}} with ` +
      `{{plot on=kit fn="1/x" domain=0.5,5 em}} one over x, ` +
      `math {{math on=kit at=120,600 "x - x' = \\frac{B\\,f}{z}"}} typeset, ` +
      `then {{emph id=a}} emphasis, {{move id=a to=160,200}} a move, {{fade id=a}} a fade, ` +
      `{{label id=ax "1/z" dir=ne}} and a label.`,
  },
};
