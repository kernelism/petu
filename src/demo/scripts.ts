import type { Demo } from './demoScript';

/**
 * Dev-only named scripts for real PDFs: `?script=<name>` (optionally `&src=<pdf url>`) opens the
 * PDF and plays the script. Anchored quotes are written against the PDF's actual text runs.
 * public/dev/ is git-ignored: the lecture PDFs are the user's course files and are never committed.
 */
export const SCRIPTS: Record<string, Demo & { src: string }> = {
  /**
   * lec09 p40 "Depth from disparity" (1920 × 1080; model coords measured on a render of the page):
   *   point x: label "x" (420,458), dot (433,498) → one ellipse around both at (427,478), rx 22 ry 30
   *   point x': label "x’" (597,466), dot (580,498) → at (589,483), rx 24 ry 30
   *   "x − x′" inside the disparity equation: x 507–567, y 769–822 → box at (503,760), 68 × 72
   * Board (space 1000 × 700; model y = space y / 0.7), true geometry with B 400, f 120:
   *   cameras O (300,570), O' (700,570), r 9, labels below at y 607; image planes at y 450,
   *   x 190–440 and 560–810; "f" at (262,510)
   *   near point (500,330), z 240 → its rays cross the planes at 400 / 600: offsets of 100 each.
   *   far point (500,90), z 480 (twice as far) → crossings at 350 / 650: offsets of 50 each.
   *   offsets drawn as the slide's small arrows from each image center: near ones at y 428 (dark),
   *   far ones at y 402 (accent); x / x' labels under the near crossings at y 478 (x' nudged left of its ray); near/far labels
   *   right of each apex; payoff under the cameras at y 655.
   * Elements (6): cameras, image planes, near rays, near offsets, far rays, far offsets (accent).
   */
  lec09: {
    src: '/dev/lec09_optical_flow.pdf',
    question: 'Why is disparity inversely proportional to depth?',
    script:
      `{{scroll p=40}} Because a farther point shifts less between the two images. ` +
      `The point lands at {{circle p=40 at=427,478 rx=22 ry=30}} x in the left image ` +
      `and {{circle p=40 at=589,483 rx=24 ry=30}} x-prime in the right, and disparity is {{box p=40 at=503,760 size=68,72}} x minus x-prime. ` +
      `{{board}} Here's {{circle on=board at=300,814 r=9}} camera {{write on=board at=290,867 "O"}} O, ` +
      `{{circle on=board at=700,814 r=9}} and camera {{write on=board at=688,867 "O′"}} O-prime, ` +
      `{{line on=board from=190,643 to=440,643}} each with {{line on=board from=560,643 to=810,643}} its image ` +
      `a distance {{write on=board at=262,729 "f"}} f in front. ` +
      `Take a {{line on=board from=306,803 to=500,471}} near {{line on=board from=694,803 to=500,471}} point. ` +
      `{{write on=board at=522,471 "near"}} Its rays come in steeply, so they land far from each center: ` +
      `{{arrow on=board from=300,611 to=398,611}} this far in the left image, {{write on=board at=392,683 "x"}} that's x, ` +
      `{{arrow on=board from=700,611 to=602,611}} and this far in the right, {{write on=board at=574,683 "x′"}} that's x-prime. ` +
      `x minus x-prime adds these two lengths. ` +
      `Now a point {{line on=board from=304,801 to=500,129}} twice {{line on=board from=696,801 to=500,129}} as far. ` +
      `{{write on=board at=522,129 "far"}} Its rays are nearly straight up, so they land ` +
      `{{arrow on=board from=300,574 to=349,574 em}} half as far {{arrow on=board from=700,574 to=651,574 em}} from each center. ` +
      `{{write on=board at=300,936 "farther → smaller x − x′"}} Twice the depth, half the disparity.`,
  },
};
