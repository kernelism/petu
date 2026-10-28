// src/demo/demoScript.ts
/**
 * Hand-written scripts. They follow the spec's "Explanation quality" rules and double as the
 * reference examples for the checkpoint 2 prompt: takeaway first, one new element per sentence
 * (setup → key move → consequence), label right after drawing, the slide's own notation, at most
 * ~6 drawn elements, accent only on the takeaway, and a payoff timed to the last sentence.
 * Each tag sits right before the word it belongs to (an action fires on the first word after it).
 * Line hierarchy (spec "Visual language"): main geometry primary (the default), rays secondary,
 * sight lines and construction faint (dash defaults to faint).
 *
 * Coordinates: on a page, model coords (0–1000 × 0–1000). In a sketch region, region-local
 * coords (0–1000 × 0–700), which are already region space.
 */

/**
 * PDF-only demo on public/fixtures/epipolar.pdf, page 3 (800 × 560 pt; model = pt x / 0.8, y / 0.56).
 * Measured on a render of the page:
 *   point x: dot (290,473), its label "x" (320,445) → one circle around both: at (305,459), r 30
 *   camera C dot (237,812) → ray from its edge up through the x dot, clipped where it meets image 1's
 *   top edge (137,382)–(363,349) at (308,358): it ends at (307,362), inside the image
 *   camera C' dot (713,812) → one faint sight line from its edge to the ray's top end: C' looking at
 *   the ray. (The slide is a schematic: no line from C' through image 2 reaches the ray, so the
 *   sight line shows C' seeing the ray from the side, and l' is named right after it.)
 *   image 2 spans x 587–812, y 348–616 → l' from (598,548) to (796,456), clear of the "image 2" text
 *   the l' label attaches below the line's end (dir=s), inside image 2
 * Elements (6): circle x, ray, highlight bullet 1, sight line, l' + label, highlight bullet 3
 * (payoff), then emph re-traces l' on the payoff's last words.
 */
export const DEMO_QUESTION = 'Why does stereo matching only search along a line?';
export const DEMO_SCRIPT =
  `{{scroll p=3}} Because the match can only be on one line in the second image. ` +
  `Take this point {{circle p=3 at=305,459 r=30}} x in image 1. ` +
  `On its own, x gives a direction from camera C, not a distance, ` +
  `{{line p=3 from=239,800 to=307,362 weight=secondary}} so the real point could be anywhere along this ray. ` +
  `That's what {{highlight p=3 "A point x in image 1 back-projects to a ray in 3D"}} back-projects to a ray means. ` +
  `Camera C-prime sees that ray from the side, {{line p=3 from=704,800 to=312,366 dash}} along lines like this one, ` +
  `so in image 2 the whole ray shows up as a line, ` +
  `{{line p=3 from=598,548 to=796,456 id=lp}} this one: {{label id=lp "l′" dir=s}} the epipolar line, l-prime. ` +
  `{{highlight p=3 "So the match x' must lie on l', and the search becomes 1-D"}} So the match x-prime must lie on l-prime, ` +
  `and we search {{emph id=lp}} one line instead of the whole image.`;

/**
 * C demo: point at x on the slide, then sketch the same scene from the side on the desk beside it,
 * with a connector from the slide's x to the sketch's x. Region `side` (1000 × 700), true geometry
 * of a verged pair (each camera turned 25° toward the middle, f 200, images 280 wide):
 *   baseline y 668, level with the slide's C–C′ line (the region is centred on the page, so the
 *            slide's y 811 lands at local ≈ 664 at 1280 px wide and ≈ 672 at 1440: within 3 px of both)
 *   cameras  C (140,668), C′ (840,668); labels outside the ends (dir=w, e): below would clip at the region edge
 *   image 1  (98,428)–(351,546), drawn right to left so its label hangs under the outer end;
 *            x = (315,529)
 *   image 2  its mirror, (629,546)–(882,428), labelled below-right of its outer end (clear of the
 *            last sight line)
 *   ray      C → (934,38), secondary
 *   points   on the ray at (455,418) (657,258) (909,58); faint sight lines from each to C′
 *   l′       image 2 re-traced in accent, inner end last so its label sits below-left of it, under
 *            the first sight line: this slice of image 2 is l′. The sight lines cross it at
 *            (642,540) (758,485) (866,435): ~125 units (55–65 px) apart and ≥ 200 units from C′
 *   payoff   (40,118), size l, accent, in the empty top left (the ray leans right)
 * Elements (6): cameras + baseline, image 1 + x, image 2, ray, three points + sight lines,
 * l′ + its hits; payoff written last.
 */
export const DEMO_SIDE_QUESTION = 'Sketch it from the side';
export const DEMO_SIDE_SCRIPT =
  `{{scroll p=3}} From the side, it's clear why the match for {{circle p=3 at=305,459 r=30}} x sits on one line. ` +
  `{{sketch id=side near=p3 size=m}} Here's {{point on=side at=140,668 "C" dir=w}} camera C, ` +
  `{{point on=side at=840,668 "C′" dir=e}} camera C-prime, {{line on=side from=149,668 to=831,668}} and the baseline. ` +
  `{{line on=side from=351,546 to=98,428 id=im1}} Image 1 {{label id=im1 "image 1" dir=s}} sits in front of C, ` +
  `{{point on=side at=315,529 "x" dir=n id=x}} with our point x on it, ` +
  `{{connect from=p3:305,459 to=side:x}} the same x as on the slide. ` +
  `{{line on=side from=629,546 to=882,428 id=im2}} Image 2 {{label id=im2 "image 2" dir=se}} sits in front of C-prime. ` +
  `C can't tell how far away the real point is, ` +
  `{{line on=side from=147,662 to=934,38 weight=secondary}} so it could be anywhere on this ray. ` +
  `Say {{point on=side at=455,418}} here, {{point on=side at=657,258}} here, or {{point on=side at=909,58}} here. ` +
  `C-prime sees each one {{line on=side from=460,421 to=832,663 dash}} along {{line on=side from=659,263 to=836,660 dash}} its own ` +
  `{{line on=side from=908,64 to=841,659 dash}} line of sight. ` +
  `All of this lies in one flat slice, and {{line on=side from=882,428 to=629,546 em id=lp}} this slice of image 2 ` +
  `{{label id=lp "l′" dir=sw em}} is l-prime. ` +
  `All three land on it, {{point on=side at=642,540 em}} here, {{point on=side at=758,485 em}} here, ` +
  `{{point on=side at=866,435 em}} and here. ` +
  `So wherever the real point is, {{write on=side at=40,118 "x′ must be on l′" size=l em}} x-prime must be on l-prime.`;

/**
 * B demo: a bigger diagram takes the stage (size l), with the slide pinned as the reference card.
 * The first sentence is short and circles x early; the takeover starts on the second.
 * Region `big` (1000 × 700), a pseudo-3D view of the classic epipolar figure:
 *   cameras  C (80,560), C′ (920,560), outside their image planes; baseline y 560
 *   images   two outlined sheets: (150,250) (410,210) (410,600) (150,640) and its mirror; the
 *            baseline crosses both. Labels written inside, under the baseline: (165,590), (748,590) (left edge, vertical centre)
 *   point    X (500,80); rays C → X and C′ → X (secondary) stop short of the dots
 *   x, x′    on the rays, 0.45 of the way up: (269,340) and (731,340); labels above (dir=n), in the
 *            gap between the ray and l, clear of the connector that arrives from the left
 *   plane    the triangle C, C′, X, in the accent tint (the takeaway)
 *   l, l′    the plane meets each image along the line from the epipole (e (390,560), e′ (610,560))
 *            through x (x′), up to the image's top edge: (390,560)→(217,245), (610,560)→(783,245)
 *   payoff   accent, centred over l′'s top end and just above its label, right of the ray C′ → X: (664,172)
 * Elements (6): cameras + baseline, image planes, X + rays, x and x′, the epipolar plane, l and l′
 * (after circling x on the slide, which the card keeps showing).
 */
export const DEMO_PLANE_QUESTION = 'Show me the whole epipolar plane';
export const DEMO_PLANE_SCRIPT =
  `{{scroll p=3}} The plane through {{circle p=3 at=305,459 r=30}} x and both cameras cuts each image along one line. ` +
  `{{sketch id=big near=p3 size=l}} Here are {{point on=big at=80,560 "C" dir=sw}} camera C ` +
  `{{point on=big at=920,560 "C′" dir=se}} and camera C-prime, {{line on=big from=89,560 to=911,560}} joined by the baseline. ` +
  `Each looks through its own image plane: {{shade on=big pts=150,250 410,210 410,600 150,640 outline}} this ` +
  `{{write on=big at=165,590 "image 1" size=s}} is image 1, ` +
  `{{shade on=big pts=590,210 850,250 850,640 590,600 outline}} and this {{write on=big at=748,590 "image 2" size=s}} is image 2. ` +
  `Now a point {{point on=big at=500,80 "X" dir=n}} X out in the world, ` +
  `{{line on=big from=86,553 to=494,87 weight=secondary}} seen from {{line on=big from=914,553 to=506,87 weight=secondary}} both cameras. ` +
  `It lands at {{point on=big at=269,340 "x" dir=n id=x}} x in image 1, ` +
  `{{connect from=p3:305,459 to=big:x}} our x from the slide, {{point on=big at=731,340 "x′" dir=n}} and at x-prime in image 2. ` +
  `C, C-prime and X make {{shade on=big pts=80,560 920,560 500,80 em}} one flat sheet: the epipolar plane. ` +
  `It cuts image 1 {{line on=big from=390,560 to=217,245 id=l}} along this line, {{label id=l "l" dir=nw}} l, ` +
  `and image 2 {{line on=big from=610,560 to=783,245 em id=lp}} along {{label id=lp "l′" dir=ne em}} l-prime. ` +
  `{{write on=big at=664,172 "so a match for x sits on l′" em}} So a match for x has to sit on l-prime.`;

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
