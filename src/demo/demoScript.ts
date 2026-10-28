/** Hand-written script for public/fixtures/epipolar.pdf (page 3). Exercises every action type. */
export const DEMO_QUESTION = 'Why does stereo matching only search along a line?';

// Model coords = fixture (top-left, 800x560 pt) coords with x / 0.8 and y / 0.56.
//   circle near  (320,445) -> label "x" at (256,249)
//   ray line     (238,813) -> (313,332): camera C (190,455) up through point x (232,265) to (250,186)
//   epipolar line(600,550) -> (803,454): svg (480,308) -> (642,254), inside image 2, clear of "image 2" text
//   label        (650,640) -> svg (520,358), just under image 2
//   label        (578,946) -> svg (462,530), right of the equation baseline
//   arrow        (900,518) -> (802,455): from the right of image 2 to the end of the epipolar line
export const DEMO_SCRIPT =
  `{{scroll p=3}} Here's the idea. Take this {{circle p=3 "x" near=320,445}} point x in the left image. ` +
  `From the camera's view, {{highlight p=3 "A point x in image 1 back-projects to a ray in 3D"}} x could have come from anywhere ` +
  `{{line p=3 from=238,813 to=313,332}} along this ray. Now project that whole ray into the right image, ` +
  `{{highlight p=3 "That ray projects to a line l' in image 2: the epipolar line"}} and it lands ` +
  `{{line p=3 from=600,550 to=803,454}} on a single line: {{label p=3 at=650,640 "epipolar line l'"}} the epipolar line. ` +
  `That's exactly what this equation says. {{box p=3 "x'T F x = 0"}} x-prime must sit on the line ` +
  `{{label p=3 at=578,946 "x' lies on l' = Fx"}} F x. So instead of searching the entire image ` +
  `{{underline p=3 "the search becomes 1-D"}} for the match, we only search along ` +
  `{{arrow p=3 from=900,518 to=802,455}} this one line.`;

/**
 * Mixed demo: circle on the PDF, then redraw the setup from the side on the board.
 * Board space is 1000 × 700; model y = space y / 0.7. Space coords of the sketch:
 *   cameras  C (240,500), C' (740,500), r 9; labels centered below at y 548
 *   ray      from C toward (500,80); points on it R1 (357,311), R2 (461,143), dots r 6
 *   image plane 2 (= l', the epipolar line): (564,477) → (686,331), 150 from C' facing the ray;
 *            the projections C'→R1 and C'→R2 cross it at (602,432) and (646,379)
 *   label l' (716,300), clear of the l' line's end; title (225,52) and summary line (225,630) share
 *   the diagram's left edge
 * Lines start at the camera circles' edge, not their centers, so the dots stay clean.
 */
export const DEMO_BOARD_QUESTION = 'Sketch it from the side';
export const DEMO_BOARD_SCRIPT =
  `{{scroll p=3}} Here's our point {{circle p=3 "x" near=320,445}} x. Now look at it from the side. ` +
  `{{board}} {{write on=board at=225,74 "Side view" size=s}} Camera C {{circle on=board at=240,714 r=9}} {{write on=board at=229,783 "C"}} ` +
  `and camera C-prime, {{circle on=board at=740,714 r=9}} {{write on=board at=727,783 "C'"}} ` +
  `joined by the baseline. {{line on=board from=249,714 to=731,714}} ` +
  `The point x could lie anywhere on this ray. {{line on=board from=245,703 to=500,114}} ` +
  `Take one point on it {{circle on=board at=357,444 r=6}} and project it into C-prime, {{line on=board from=732,709 to=362,448}} ` +
  `then a farther one. {{circle on=board at=461,204 r=6}} {{line on=board from=734,704 to=465,211}} ` +
  `Both land on one line in the second image: {{line on=board from=564,681 to=686,473 em}} ` +
  `the epipolar line, {{write on=board at=716,429 "l'"}} l-prime. ` +
  `So every point on the ray {{write on=board at=225,900 "every point on the ray → a point on l'"}} maps onto l', ` +
  `{{circle on=board "l'" near=726,429 em}} and that's the only place to search.`;

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
