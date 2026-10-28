// src/demo/demoScript.ts
/**
 * Hand-written scripts. They follow the spec's "Explanation quality" rules and double as the
 * reference examples for the checkpoint 2 prompt: takeaway first, one new element per sentence
 * (setup → key move → consequence), label right after drawing, the slide's own notation, at most
 * ~6 drawn elements, accent only on the takeaway, and a payoff timed to the last sentence.
 * Each tag sits right before the word it belongs to (an action fires on the first word after it).
 *
 * Coordinates: on a page, model coords (0–1000 × 0–1000). In a sketch region, region-local
 * coords (0–1000 × 0–700), which are already region space.
 */

/**
 * PDF-only demo on public/fixtures/epipolar.pdf, page 3 (800 × 560 pt; model = pt x / 0.8, y / 0.56).
 * Measured on a render of the page:
 *   point x: dot (290,473), its label "x" (320,445) → one circle around both: at (305,459), r 30
 *   camera C dot (237,812) → ray from its edge up through the x dot to (313,330), under the bullets
 *   image 2 spans x 587–812, y 348–616 → l' from (598,548) to (796,456), clear of the "image 2" text
 *   the l' label attaches below the line's end (dir=s), inside image 2
 * Elements (6): circle x, ray, highlight bullet 1, l' line, l' label, highlight bullet 3 (payoff),
 * then emph re-traces l' on the payoff's last words.
 */
export const DEMO_QUESTION = 'Why does stereo matching only search along a line?';
export const DEMO_SCRIPT =
  `{{scroll p=3}} Because the match can only be on one line in the second image. ` +
  `Take this point {{circle p=3 at=305,459 r=30}} x in image 1. ` +
  `On its own, x gives a direction from camera C, not a distance, ` +
  `{{line p=3 from=239,800 to=313,330}} so the real point could be anywhere along this ray. ` +
  `That's what {{highlight p=3 "A point x in image 1 back-projects to a ray in 3D"}} back-projects to a ray means. ` +
  `A straight ray still looks straight from the other camera, so in image 2 it shows up as a line, ` +
  `{{line p=3 from=598,548 to=796,456 id=lp}} this one: {{label id=lp "l'" dir=s}} the epipolar line, l-prime. ` +
  `{{highlight p=3 "So the match x' must lie on l', and the search becomes 1-D"}} So the match x-prime must lie on l-prime, ` +
  `and we search {{emph id=lp}} one line instead of the whole image.`;

/**
 * C demo: point at x on the slide, then sketch the setup from the side on the desk beside it, with
 * a connector from the slide's x to the sketch's x. Region `side` (1000 × 700), true geometry, f 190:
 *   cameras  C (160,600), C' (840,600); baseline between their dots; labels below (dir=s)
 *   image 1  y 410 from x 40 to 290 (C looks straight up); x = where the ray crosses it (271,410)
 *   ray      C → (480,50); three candidate points on it: (304,353) (378,226) (448,105)
 *   sight    dashed lines from each point to C'
 *   l'       image 2 of C' (looking up-left) cut by this slice: the line through e' (415,600), where
 *            the baseline meets it, up to (765,425). The sight lines cross it at (619,498) (678,469)
 *            (719,448), dotted in accent.
 *   payoff   (580,170), size l, in the empty top right, clear of the farthest sight line
 * Elements (6): cameras + baseline, image 1 + x, ray, three points, sight lines, l' + its dots.
 */
export const DEMO_SIDE_QUESTION = 'Sketch it from the side';
export const DEMO_SIDE_SCRIPT =
  `{{scroll p=3}} From the side, it's clear why the match for {{circle p=3 at=305,459 r=30}} x sits on one line. ` +
  `{{sketch id=side near=p3 size=m}} Here's {{point on=side at=160,600 "C" dir=s}} camera C, ` +
  `{{point on=side at=840,600 "C′" dir=s}} camera C-prime, {{line on=side from=169,600 to=831,600}} and the baseline. ` +
  `{{line on=side from=40,410 to=290,410}} Image 1 {{write on=side at=40,437 "image 1" size=s}} sits in front of C, ` +
  `{{point on=side at=271,410 "x" dir=nw id=x}} with our point x on it, ` +
  `{{connect from=p3:305,459 to=side:x}} the same x as on the slide. ` +
  `C can't tell how far away the real point is, {{line on=side from=166,591 to=480,50}} so it could be anywhere on this ray. ` +
  `Say {{point on=side at=304,353}} here, {{point on=side at=378,226}} here, or {{point on=side at=448,105}} here. ` +
  `C-prime sees each one {{line on=side from=311,356 to=831,596 dash}} along {{line on=side from=384,231 to=832,594 dash}} its own ` +
  `{{line on=side from=453,111 to=834,592 dash}} line of sight. ` +
  `Everything here lies in one flat slice, and image 2 cuts that slice in a single line: ` +
  `{{line on=side from=415,600 to=765,425 em id=lp}} this one, {{label id=lp "l′" dir=ne em}} l-prime. ` +
  `All three land on it, {{point on=side at=619,498 em}} here, {{point on=side at=678,469 em}} here, ` +
  `{{point on=side at=719,448 em}} and here. ` +
  `It starts at {{point on=side at=415,600 "e′" dir=sw}} e-prime, where C itself lands. ` +
  `So wherever the real point is, {{write on=side at=580,170 "x′ must be on l′" size=l}} x-prime must be on l-prime.`;

/**
 * B demo: a bigger diagram takes the stage (size l), with the slide pinned as the reference card.
 * Region `big` (1000 × 700), a pseudo-3D view of the classic epipolar figure:
 *   cameras  C (180,520), C' (820,520); baseline y 520
 *   images   two translucent planes: (150,330) (400,290) (400,560) (150,600) and its mirror
 *   point    X (500,90); rays C → X and C' → X stop short of the dots
 *   x, x'    where the rays pierce the planes: 0.3 of the way up, (276,391) and (724,391)
 *   plane    the triangle C, C', X, shaded
 *   l, l'    the plane meets each image along the line from the epipole (e (360,520), e' (640,520))
 *            through x (x'), to the plane's top edge: (360,520)→(226,315), (640,520)→(774,314)
 *   payoff   bottom-left, under the planes
 * Elements (6): cameras + baseline, image planes, X + rays, x and x', the epipolar plane, l and l'
 * (after circling x on the slide, which the card keeps showing).
 */
export const DEMO_PLANE_QUESTION = 'Show me the whole epipolar plane';
export const DEMO_PLANE_SCRIPT =
  `{{scroll p=3}} The epipolar plane is one flat sheet through both cameras and the point, and it cuts each image along a line. ` +
  `Start from {{circle p=3 at=305,459 r=30}} x on the slide. ` +
  `{{sketch id=big near=p3 size=l}} Here are {{point on=big at=180,520 "C" dir=sw}} camera C ` +
  `{{point on=big at=820,520 "C′" dir=se}} and camera C-prime, {{line on=big from=189,520 to=811,520}} joined by the baseline. ` +
  `Each looks through {{shade on=big pts=150,330 400,290 400,560 150,600}} its own image ` +
  `{{shade on=big pts=600,290 850,330 850,600 600,560}} plane. ` +
  `Now a point {{point on=big at=500,90 "X" dir=n}} X out in the world, ` +
  `{{line on=big from=186,512 to=494,98}} seen from {{line on=big from=814,512 to=506,98}} both cameras. ` +
  `It lands at {{point on=big at=276,391 "x" dir=w id=x}} x in image 1, ` +
  `{{connect from=p3:305,459 to=big:x}} our x from the slide, {{point on=big at=724,391 "x′" dir=e}} and at x-prime in image 2. ` +
  `C, C-prime and X make {{shade on=big pts=180,520 820,520 500,90}} one flat sheet: the epipolar plane. ` +
  `It cuts image 1 {{line on=big from=360,520 to=226,315}} along this line, ` +
  `and image 2 {{line on=big from=640,520 to=774,314 em id=lp}} along {{label id=lp "l′" dir=ne em}} l-prime. ` +
  `{{write on=big at=90,655 "the plane meets image 2 in l′"}} So a match for x has to sit on l-prime.`;

export type Demo = { question: string; script: string };
export const DEMOS: Demo[] = [
  { question: DEMO_QUESTION, script: DEMO_SCRIPT },
  { question: DEMO_SIDE_QUESTION, script: DEMO_SIDE_SCRIPT },
  { question: DEMO_PLANE_QUESTION, script: DEMO_PLANE_SCRIPT },
];

const words = (s: string) => new Set(s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);

/** The demo whose question shares the most words with `q` (case-insensitive). Ties and misses play the PDF demo. */
export function pickDemo(q: string): Demo {
  const w = words(q);
  let best = DEMOS[0], bestN = 0;
  for (const d of DEMOS) {
    let n = 0;
    for (const x of words(d.question)) if (w.has(x)) n++;
    if (n > bestN) { best = d; bestN = n; }
  }
  return best;
}

/** Simulates a model stream: random 3-14 char chunks every ~35ms (jittered). */
export async function* streamDemo(signal: AbortSignal, script = DEMO_SCRIPT): AsyncGenerator<string> {
  let i = 0;
  await new Promise((r) => setTimeout(r, 350)); // simulated time-to-first-token
  while (i < script.length && !signal.aborted) {
    const n = 3 + Math.floor(Math.random() * 12);
    yield script.slice(i, i + n);
    i += n;
    await new Promise((r) => setTimeout(r, 20 + Math.random() * 30));
  }
}
