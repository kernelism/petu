/**
 * Hand-written scripts. They follow the spec's "Explanation quality" rules and double as the
 * reference examples for the checkpoint 2 prompt: takeaway first, one new element per sentence
 * (setup → key move → consequence), label right after drawing, the slide's own notation, at most
 * ~6 drawn elements, accent only on the takeaway, and a payoff timed to the last sentence.
 * Each tag sits right before the word it belongs to (an action fires on the first word after it).
 */

/**
 * PDF-only demo on public/fixtures/epipolar.pdf, page 3 (800 × 560 pt; model = pt x / 0.8, y / 0.56).
 * Measured on a render of the page:
 *   point x: dot (290,473), its label "x" (320,445) → one circle around both: at (305,459), r 30
 *   camera C dot (237,812) → ray from its edge up through the x dot to (313,330), under the bullets
 *   image 2 spans x 587–812, y 348–616 → l' from (598,548) to (796,456), clear of the "image 2" text
 *   label "l'" just under the line's end at (786,482), inside image 2
 * Elements (6): circle x, ray, highlight bullet 1, l' line, l' label, highlight bullet 3 (payoff).
 */
export const DEMO_QUESTION = 'Why does stereo matching only search along a line?';
export const DEMO_SCRIPT =
  `{{scroll p=3}} Because the match can only be on one line in the second image. ` +
  `Take this point {{circle p=3 at=305,459 r=30}} x in image 1. ` +
  `On its own, x gives a direction from camera C, not a distance, ` +
  `{{line p=3 from=239,800 to=313,330}} so the real point could be anywhere along this ray. ` +
  `That's what {{highlight p=3 "A point x in image 1 back-projects to a ray in 3D"}} back-projects to a ray means. ` +
  `A straight ray still looks straight from the other camera, so in image 2 it shows up as a line, ` +
  `{{line p=3 from=598,548 to=796,456}} this one: {{label p=3 at=786,482 "l'"}} the epipolar line, l-prime. ` +
  `{{highlight p=3 "So the match x' must lie on l', and the search becomes 1-D"}} So the match x-prime must lie on l-prime, ` +
  `and we search one line instead of the whole image.`;

/**
 * Mixed demo: point at x on the PDF, then sketch the setup from the side on the board.
 * Board space is 1000 × 700; model y = space y / 0.7. Space coords of the sketch (true geometry, f 190):
 *   cameras  C (160,600), C' (840,600), r 9; baseline between their edges; labels below at y 642
 *   image 1  y 410 from x 40 to 290 (C looks straight up); x = where the ray crosses it (271,410)
 *   ray      C → (480,50); three candidate points on it: (304,353) (378,226) (448,105), r 7
 *   sight    lines from each point to C' (stopping at the circles' edges)
 *   l'       image 2 of C' (looking up-left) cut by this slice: the line through e' (415,600), where
 *            the baseline meets it, up to (765,425). The sight lines cross it at (619,498) (678,469)
 *            (719,448), dotted in accent. Labels l' (778,408), e' (402,640)
 *   payoff   (580,170), size l, in the empty top right, clear of the farthest sight line
 * Elements (6): cameras + baseline, image 1 + x, ray, three points, sight lines, l' + its dots.
 */
export const DEMO_BOARD_QUESTION = 'Sketch it from the side';
export const DEMO_BOARD_SCRIPT =
  `{{scroll p=3}} From the side, it's clear why the match for {{circle p=3 at=305,459 r=30}} x sits on one line. ` +
  `{{board}} Here's {{circle on=board at=160,857 r=9}} camera {{write on=board at=150,917 "C"}} C, ` +
  `{{circle on=board at=840,857 r=9}} camera {{write on=board at=827,917 "C′"}} C-prime, ` +
  `{{line on=board from=169,857 to=831,857}} and the baseline. ` +
  `{{line on=board from=40,586 to=290,586}} Image 1 {{write on=board at=40,624 "image 1" size=s}} sits in front of C, ` +
  `{{circle on=board at=271,586 r=6}} with our point {{write on=board at=236,551 "x"}} x on it. ` +
  `C can't tell how far away the real point is, {{line on=board from=166,844 to=480,71}} so it could be anywhere on this ray. ` +
  `Say {{circle on=board at=304,504 r=7}} here, {{circle on=board at=378,323 r=7}} here, or {{circle on=board at=448,150 r=7}} here. ` +
  `C-prime sees each one {{line on=board from=311,509 to=831,851}} along {{line on=board from=384,330 to=832,848}} its own ` +
  `{{line on=board from=453,159 to=834,846}} line of sight. ` +
  `Everything here lies in one flat slice, and image 2 cuts that slice in a single line: ` +
  `{{line on=board from=415,857 to=765,607 em}} this one, {{write on=board at=778,583 "l′"}} l-prime. ` +
  `All three land on it, {{circle on=board at=619,711 r=6 em}} here, {{circle on=board at=678,670 r=6 em}} here, ` +
  `{{circle on=board at=719,640 r=6 em}} and here. ` +
  `It starts at {{write on=board at=402,914 "e′"}} e-prime, where C itself lands. ` +
  `So wherever the real point is, {{write on=board at=580,243 "x′ must be on l′" size=l}} x-prime must be on l-prime.`;

export type Demo = { question: string; script: string };
export const DEMOS: Demo[] = [
  { question: DEMO_QUESTION, script: DEMO_SCRIPT },
  { question: DEMO_BOARD_QUESTION, script: DEMO_BOARD_SCRIPT },
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
