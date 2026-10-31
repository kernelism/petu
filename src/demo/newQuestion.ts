// src/demo/newQuestion.ts — `?script=new-question`: canned answers for the + / saved-questions flow
// (founder 2026-10-31), no API call. Q1 draws a tall svg board and marks p3; its follow-up extends that
// board and marks p4; Q2 (asked after +) draws its own board and marks p7; a later follow-up on Q1
// starts a fresh board under it; Q3 plays long enough to press + or pick a row mid-answer. The boards
// are the svg demos' (src/demo/svg); the page marks quote public/fixtures/examples.pdf.
import { SVG_EXAMPLES } from '../../server/prompt/svgExamples';
import { wireOf } from './svg';
import { SESSION_Q, SESSION_RAW } from './svg/session';

const example = (word: string) => {
  const ex = SVG_EXAMPLES.find((e) => e.script.includes(`<g id="${word}"`));
  if (!ex) throw new Error(`no svg example with a group ${word}`);
  return ex;
};
const dough = example('yeast'), ferry = example('river');

export const NEWQ_Q = { q1: SESSION_Q.main, follow: SESSION_Q.follow, aside: SESSION_Q.aside, q2: dough.question, again: SESSION_Q.fresh, q3: ferry.question };

export const NEWQ_SCRIPT = {
  src: '/fixtures/examples.pdf',
  page: 3,
  question: NEWQ_Q.q1,
  script: `{{highlight p=3 "Travellers spend 50 coins at the baker."}} Start from the page. ${wireOf(SESSION_RAW.main)}`,
  answers: {
    [NEWQ_Q.aside]: wireOf(SESSION_RAW.aside),
    [NEWQ_Q.follow]: `{{underline p=4 "only payments that cross it change the total"}} Keep going on the same board. ${wireOf(SESSION_RAW.follow)}`,
    [NEWQ_Q.q2]: `{{scroll p=7}} {{highlight p=7 "one full turn every 20 seconds"}} A different question. ${wireOf(dough.script)}`,
    [NEWQ_Q.again]: wireOf(SESSION_RAW.fresh),
    [NEWQ_Q.q3]: `{{highlight p=5 "its income is what crosses that line"}} Another one. ${wireOf(ferry.script)}`,
  },
};
