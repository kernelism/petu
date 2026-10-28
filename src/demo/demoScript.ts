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
  `That's exactly what {{underline p=3 "x'T F x = 0"}} this equation says. {{box p=3 "x'T F x = 0"}} x-prime must sit on the line ` +
  `{{label p=3 at=578,946 "x' lies on l' = Fx"}} F x. So instead of searching the entire image ` +
  `{{highlight p=3 "So the match x' must lie on l', and the search becomes 1-D"}} for the match, we only search along ` +
  `{{arrow p=3 from=900,518 to=802,455}} this one line.`;

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
