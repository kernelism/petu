import type { Demo } from './demoScript';

/**
 * Dev-only named scripts for real PDFs: `?script=<name>` (optionally `&src=<pdf url>`) opens the
 * PDF and plays the script. Anchored quotes are written against the PDF's actual text runs.
 * public/dev/ is git-ignored: the lecture PDFs are the user's course files and are never committed.
 */
export const SCRIPTS: Record<string, Demo & { src: string }> = {
  /**
   * lec09 p40 "Depth from disparity" (model coords from the page's text runs):
   *   "X" (500,177) world point · "x" (420,458) left image · "x’" (597,466) right image
   *   equation block x 373–648, y 737–868 → one coordinate box · takeaway sentence y 896
   * Board (space 1000 × 700; model y = space y / 0.7): cameras O (300,520), O' (700,520), r 9;
   *   near point N (500,300), far point F (500,60); far rays pass x 396 / 604 at N's height,
   *   so the "near" label sits right of them at x 625. Labels at y 565, summary line at y 620.
   */
  lec09: {
    src: '/dev/lec09_optical_flow.pdf',
    question: 'Why is disparity inversely proportional to depth?',
    script:
      `{{scroll p=40}} A point {{circle p=40 "X" near=500,177}} X in the world projects to {{circle p=40 "x" near=420,458}} x in the left image ` +
      `and {{circle p=40 "x’" near=597,466}} x-prime in the right. Similar triangles give ` +
      `{{box p=40 at=360,725 size=300,155}} disparity, x minus x-prime, equals B f over z. ` +
      `B and f are fixed, so {{highlight p=40 "Disparity is inversely proportional to depth."}} disparity is inversely proportional to depth. ` +
      `Here's why. {{board}} Camera O {{circle on=board at=300,743 r=9}} {{write on=board at=291,807 "O"}} ` +
      `and camera O-prime, {{circle on=board at=700,743 r=9}} {{write on=board at=689,807 "O'"}} a baseline apart. {{line on=board from=309,743 to=691,743}} ` +
      `For a near point {{line on=board from=306,733 to=500,429}} {{line on=board from=694,733 to=500,429}} the rays meet at a wide angle, ` +
      `{{write on=board at=625,429 "near"}} so its two images land far apart. ` +
      `For a far point {{line on=board from=304,731 to=500,86 em}} {{line on=board from=696,731 to=500,86 em}} the rays are nearly parallel, ` +
      `{{write on=board at=520,86 "far"}} so the images almost coincide. ` +
      `{{write on=board at=300,886 "farther → smaller disparity"}} Double the depth, and you halve the disparity.`,
  },
};
