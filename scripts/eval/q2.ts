// scripts/eval/q2.ts — question set q2 (Eval v3): 40 questions a confused student would ask while
// looking at one page. Written by an agent that saw only the PDFs (never the prompt, spec, rubric or
// the q1 questions): 34 over the founder's course PDFs (same excluded pages as q1), 6 over the two
// synthetic decks in other domains (public/fixtures: econ, mechanics). `scope` is the writer's own
// narrow/broad label. Rows are as written (no edits); the dev/test split is computed (stratified by
// deck, then scope, seed 670) and pinned through the set hash in tests/eval/questions.test.ts.
// This file holds page numbers and the questions only, never PDF content.
import type { Question } from './questions.ts';
import { stratifiedSplit } from './split.ts';

type Row = { deck: string; page: number; scope: 'narrow' | 'broad'; question: string };
const r = (deck: string, page: number, scope: Row['scope'], question: string): Row => ({ deck, page, scope, question });

export const Q2_ROWS: Row[] = [
  r("lec02", 22, 'narrow', "how are they getting the camera height from this?? what are the 3.7, 2.5 and 5.4 actually measuring"),
  r("lec02", 37, 'narrow', "I get the two similar triangle ratios from the last couple slides but how do you go from y'/y = D'/D and y'/y = (D'-f)/f to 1/D' + 1/D = 1/f? the algebra isn't shown"),
  r("lec02", 48, 'broad', "so is the weird stretched look in the close-up car shot caused by the small focal length or by the camera being close? like if I just cropped the wide angle photo would it look the same as the telephoto one"),
  r("lec03", 9, 'narrow', "is B here the same thing as the pixel value in the image? and why does S have a magnitude, I thought the light was just a direction"),
  r("lec03", 17, 'narrow', "why is the albedo just the length of g? and how many images do I actually need minimum for this least squares to work, would 2 be enough"),
  r("lec03", 44, 'broad', "if each cone only gives one number and info is lost, how are we able to tell apart so many colors? and is that why metamers have to exist"),
  r("lec04", 40, 'narrow', "in the adaptive gradient one, if |gt-gb| is bigger why do we average gl and gr? feels backwards to me"),
  r("lec04", 56, 'broad', "how do gray world and brightest pixel actually differ in practice, when would each one mess up the white balance? and what's gamut mapping doing here"),
  r("lec05", 10, 'narrow', "how did they get 2/3 and 1/3 coming out of 'dog'? I'm counting the words and not seeing it"),
  r("lec05", 33, 'broad', "how is non-local means even related to texture synthesis? one makes new texture and one removes noise, why are they on the same slide"),
  r("lec06", 26, 'narrow', "why is blurring twice with σ the same as once with σ√2 and not 2σ?"),
  r("lec06", 38, 'broad', "why does the 1/8 one look so jaggy and blocky? is that aliasing, and what does it have to do with the sine wave sampling stuff after this"),
  r("lec06", 58, 'narrow', "where does the 4/3 come from? he asks how he came up with it but doesn't show it"),
  r("lec06", 68, 'broad', "what exactly do we need to store to rebuild the original from the Laplacian pyramid? just the residuals or the smallest blurred image too?"),
  r("lec07", 16, 'narrow', "why is the axis length λ^(-1/2)? so the bigger eigenvalue gives the shorter axis? that seems backwards"),
  r("lec07", 33, 'broad', "so Harris isn't scale invariant at all? why does zooming in turn the corner into edges, and is that the whole reason we need blob detection next"),
  r("lec07", 47, 'narrow', "how do they get σ = r/√2 from lining up the zeros of the Laplacian with the circle?"),
  r("lec08", 19, 'narrow', "why compare to the second nearest neighbor instead of just thresholding the distance? and where does 0.8 come from"),
  r("lec08", 48, 'broad', "how do I actually work out this probability? what's s for a line, and how do I pick k so it works like 99% of the time"),
  r("lec08", 60, 'broad', "why doesn't inverse warping leave holes like the forward one did? don't you still have to interpolate somewhere"),
  r("lec09", 12, 'narrow', "what is (u',v') here and why can I just add it to (u,v)? I don't get why that means we can't know the flow along the edge"),
  r("lec09", 20, 'broad', "wait why is this the same M as in Harris? and why do the eigenvalues tell me whether I can solve for (u,v)"),
  r("lec09", 27, 'broad', "how does coarse-to-fine actually fix large motion? if the motion is 10 pixels doesn't Taylor still break"),
  r("lec10", 34, 'narrow', "why does a 3x4 camera matrix only have 11 parameters and not 12? and where does 2mn come from"),
  r("lec10", 49, 'broad', "how does the vocab tree make search faster than just matching SIFT to every database image? and what counts as a 'word' for an image"),
  r("hw1", 2, 'narrow', "why can we just subtract the ambient image from all of them? what does 'linearity of light' mean here, and why clip negatives to 0"),
  r("hw1", 3, 'broad', "why would averaging the row-column and column-row results give a better surface? if the normals were perfect wouldn't every path give the same height"),
  r("hw2", 4, 'narrow', "why does dilate(mask) - mask give the pixels I need for pixelList? I'm confused what dilation does to the mask"),
  r("hw2", 5, 'narrow', "if I set Bf = 1 then depth is 1/disparity, but what do I do when the disparity comes out as 0?"),
  r("midterm-review", 6, 'narrow', "I don't get the explanation for why we multiply by σ^2. the first derivative response goes like 1/σ, so why does the Laplacian need σ^2 and not σ?"),
  r("midterm-review", 9, 'broad', "is p the fraction of outliers or the number? and how would they expect us to use 1-(1-(1-p)^s)^k on the exam"),
  r("szeliski", 95, 'narrow', "why is it cos+ = max(0, cos θ) here? in class Lambert's law was just ρ N·S, does the max thing matter?"),
  r("szeliski", 451, 'broad', "so the book says to find maxima of the smaller eigenvalue, but in lecture we used det - α trace^2. are these the same idea or different detectors?"),
  r("szeliski", 781, 'broad', "what does rectifying actually do to the images? in class we just assumed parallel cameras so the epipolar lines are rows, is this how you get that when the cameras aren't parallel?"),
  r("econ", 8, 'narrow', "why are they dividing by 15 and 9 here instead of by the starting values 10 and 10? I thought percent change was always divided by the original"),
  r("econ", 9, 'broad', "how can the elasticity change along the line if the slope is the same everywhere? isn't elasticity basically just the slope"),
  r("econ", 12, 'narrow', "where does the 25 in the DWL come from, and why is the triangle only between 20 and 25? also how do you know buyers pay 2 of it and sellers pay... wait who pays what here"),
  r("mechanics", 6, 'narrow', "why do 30 and 60 degrees land at the exact same spot? the 60 one goes way higher so shouldn't it land somewhere different"),
  r("mechanics", 9, 'narrow', "why does the friction line suddenly drop down once it starts sliding? and before that, how is friction 'matching the push', like how does it know how hard I'm pushing"),
  r("mechanics", 11, 'broad', "if the speed is constant how is it accelerating at all? and is F_c an extra force I add to the free body diagram or is it one of the other forces"),
];

export const Q2_SEED = 670;

/** Rows → questions: split, then ids D1… / T1… in row order. */
export function buildQ2(rows: Row[] = Q2_ROWS, seed = Q2_SEED): Question[] {
  const { dev, test } = stratifiedSplit(rows, seed);
  const mk = (x: Row, id: string, split: 'dev' | 'test'): Question => ({ id, split, deck: x.deck, page: x.page, pick: 'agent', type: x.scope, question: x.question });
  const devQs = dev.map((x, i) => mk(x, `D${i + 1}`, 'dev'));
  const testQs = test.map((x, i) => mk(x, `T${i + 1}`, 'test'));
  return [...devQs, ...testQs];
}

export const Q2: Question[] = buildQ2();
