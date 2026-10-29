// scripts/eval/draw.ts — question set `draw` (the author benchmark, `npm run bench`): questions where
// the board must carry the explanation (a mechanism, a computed comparison, a simulation, a diagram).
// Chosen by the founder after demo scripts by a strong model looked great and live answers did not.
// All dev (the set exists to compare authors, not to tune the prompt). Two pages are shared on
// purpose (bio p4, econ p12: a second, harder question on the same figure); every question opens its
// own fresh session. D10–D11 are golden-lesson questions (scripts/eval/golden). Follow-ups use the
// `fu` mechanism (a second turn on the same page; the r3 judge sees the previous answer).
import type { Question } from './questions.ts';

const q = (id: string, deck: string, page: number, type: Question['type'], question: string, extra: Partial<Question> = {}): Question =>
  ({ id, split: 'dev', deck, page, pick: 'hand', type, question, ...extra });

export const DRAW: Question[] = [
  q('D1', 'bio', 4, 'follow-up', 'Why does a competitive inhibitor change Km but not Vmax?', { followUp: 'improve the drawing' }),
  q('D2', 'econ', 12, 'follow-up', 'Who actually pays this tax?', { followUp: "explain like I'm 5" }),
  q('D3', 'econ', 12, 'what-if', 'What happens to the deadweight loss if the tax doubles? Show me why it quadruples instead of doubling.'),
  q('D4', 'bio', 4, 'compare', 'How is an uncompetitive inhibitor different, and why do both Km and Vmax drop? Draw both kinds side by side on one Lineweaver–Burk plot.'),
  q('D5', 'ost-stats', 418, 'why', "What does '95% confident' actually mean?"),
  q('D6', 'ost-stats', 418, 'why', 'Why does the interval shrink with 1/√n and not 1/n? Simulate samples of 10, 40 and 160.'),
  q('D7', 'ost-calc', 159, 'why', "Why does the small-angle approximation make a pendulum's period independent of amplitude, and where does it break down? Plot the true period against amplitude."),
  q('D8', 'ost-physics', 230, 'why', 'Why can a horse pull a cart if the cart pulls back equally? Draw the free-body diagrams.'),
  q('D9', 'ax-resnet', 2, 'why', 'Why do gradients vanish in a deep plain network, and how does the skip connection change the backpropagated gradient?'),
  q('D10', 'ost-econ', 139, 'why', "I don't get the hotel example. Won't hotels just add the tax onto the bill, so guests end up paying all of it?", { tags: ['golden'] }),
  q('D11', 'ax-conformal', 4, 'broad', "I'm lost on this page. What is going on?", { tags: ['golden'] }),
];
