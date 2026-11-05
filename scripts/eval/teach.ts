// scripts/eval/teach.ts — question set `teach` (teaching-engine Phase 1 evaluation,
// docs/briefs/proposals/teaching-engine.md §6): the processes the engine is built to show (filters,
// a sliding window, column addition, a slice-sum derivation), on the decks of the case dossier, plus two
// unseen questions of the same kind (a variance worked out, a Riemann sum) to see whether the calc and
// step machinery generalizes. All dev: the set measures the engine, it is never a held-out test.
import type { Question } from './questions.ts';

const q = (id: string, deck: string, page: number, type: Question['type'], question: string, extra: Partial<Question> = {}): Question =>
  ({ id, split: 'dev', deck, page, pick: 'hand', type, question, ...extra });

export const TEACH: Question[] = [
  q('D1', 'lec06', 16, 'broad', 'Explain the different filtering techniques in this PDF.'),
  q('D2', 'lec06', 33, 'why', 'How does the median filter work?'),
  q('D3', 'lec06', 5, 'compare', "What's the difference between correlation and convolution?"),
  q('D4', 'lec06', 9, 'derive', 'Convolve a 5x5 image with a 3x3 kernel and show me how the sliding window works.'),
  q('D5', 'examples', 1, 'derive', 'How does 478 + 356 work, with carrying?'),
  q('D6', 'ost-physics', 491, 'derive', 'Derive the moment of inertia of a thin rod about its centre.'),
  q('D7', 'ost-stats', 121, 'derive', 'Work out the standard deviation of 2, 4, 4, 4, 5, 5, 7, 9 step by step.', { tags: ['unseen'] }),
  q('D8', 'ost-calc', 456, 'derive', 'Approximate the area under y = x² from 0 to 1 with rectangles, and show how it closes in on 1/3.', { tags: ['unseen'] }),
  q('D9', 'lec06', 15, 'derive', 'Show me how this box filter blurs the eye, pixel by pixel.', { tags: ['raster'] }),
  q('D10', 'lec06', 13, 'why', 'What will this kernel do to the image?', { tags: ['raster', 'unseen'] }),
  q('D11', 'lec06', 22, 'derive', 'Where do the numbers in this Gaussian kernel come from?', { tags: ['grid'] }),
  q('D12', 'lec06', 28, 'why', 'Is the box filter separable? Show me.', { tags: ['grid', 'unseen'] }),
];
