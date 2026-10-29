// src/demo/learner.ts
/**
 * The v1 learner UX storyboard as one simulated session (`?script=learner`; gallery scene `learner`):
 * econ.pdf p12 (a per-unit tax of 2: demand P = 12 − Q/5, supply P = 2 + Q/5, buyers pay 8, sellers
 * keep 6, Q = 20). A simulated student asks, interrupts with an aside, resumes, follows up, circles
 * the deadweight-loss triangle and asks about it, then answers the tutor's check question. Every
 * number on the board is the engine's. No API call: each question plays its canned script.
 */

/**
 * One thing the simulated student does. It first waits (`words` spoken in the answer playing, the
 * aside done, or nothing playing), then acts. Played by App (dev only) after the first question.
 */
export type DevStep = {
  /** Wait until the answer playing has spoken this many words. */
  words?: number;
  /** Wait until the aside has finished, then this many ms. */
  asideDone?: number;
  /** Wait until nothing is playing, then this many ms. */
  idle?: number;
  /** Wait this many ms. */
  ms?: number;
  /** Type this into the bar (mid-answer, typing pauses it) and send it. */
  ask?: string;
  /** Type this into the bar and leave it there. */
  type?: string;
  /** Return: back to the answer. */
  resume?: true;
  /** A loop with the pen around a page region (page units, 0–1000 on both axes). */
  circle?: { page: number; x: number; y: number; rx: number; ry: number };
  /** Board zoom (⌘−… / Fit) and its scroll to the top of the session. */
  zoom?: 'fit';
  /** Opens the shortcuts card (?). */
  shortcuts?: true;
};

export const LEARNER_Q = {
  main: 'Who actually pays this tax?',
  aside: "wait, what's elasticity?",
  follow: "still don't get why the steeper side pays more",
  point: 'why is this part lost?',
  reply: 'about 10',
};

const MAIN =
  `{{scroll p=12}} Both sides do: {{highlight p=12 "Buyers and sellers split the tax"}} the tax drives a wedge between the price buyers pay and the price sellers keep. ` +
  `{{sketch id=w near=p12}} Before the tax {{const t=2}} everyone traded at seven. {{bars on=w id=pay vals=7,8 labels=before,after "buyers pay"}} With a tax of two, buyers pay eight. ` +
  `{{split id=pay[2] vals=t "sellers keep" "tax"}} Out of those eight, {{val id=pay[2,2]}} goes to the tax, so sellers keep {{val id=pay[2,1]}}. ` +
  `{{connect from=p12:"Pb = 8, Ps = 6, Q = 20" to=w:pay}} That is the slide's own pair of prices. ` +
  `{{bars on=w id=share vals=1,1 labels=buyers,sellers below=pay "who carries the 2"}} Against the old seven, buyers carry one and sellers carry one. ` +
  `{{emph id=share}} The split is even because the two curves are equally steep: when one side is steeper, it carries more.`;

const ASIDE =
  `{{sketch id=el near=p12}} Elasticity is how strongly quantity reacts when the price moves. ` +
  `{{bars on=el id=lost vals=2,10 labels=steep,flat "units lost when the price rises by one"}} On a steep demand line, a one-dollar rise loses two units; on a flat line it loses ten. ` +
  `{{emph id=lost[2]}} Flat means elastic: buyers walk away fast.`;

const FOLLOW =
  `{{sketch id=f near=p12}} Picture it {{const b=0.2}} on the chart. ` +
  `{{plot on=f id=dem fn="7+b*(25-x)" domain=0,35 xlabel="quantity" ylabel="price" "demand"}} Here is demand, ` +
  `{{plot on=f id=tx fn="4+x/5" domain=0,35 axes=dem "supply + tax"}} and supply lifted by the tax. ` +
  `{{find id=E of=tx,dem}} They cross where buyers pay {{val id=E.y}}. ` +
  `{{beforeafter of=dem b=0.6}} Now make demand three times as steep: buyers hardly back away, so the crossing climbs and buyers pay {{val id=E.y}}, most of the two.`;

const POINT =
  `{{sketch id=d near=p12}} Each of those trades was worth more to a buyer than it cost a seller. ` +
  `{{table on=d id=gap cols=Q,value,cost,gain vals=20;21;22;23;24}} Take the units from twenty to twenty-five: ` +
  `{{col id=gap.b fn="12-a/5" dur=2}} what a buyer would pay, {{col id=gap.c fn="2+a/5" dur=2}} what it costs to make, ` +
  `{{col id=gap.d fn="b-c" dur=2}} and the gain each trade would have made. ` +
  `With the tax, none of them happen, so all of that gain is lost: the slide's triangle. ` +
  `Now try one yourself: with a tax of four instead of two, what would buyers pay?`;

const REPLY =
  `{{sketch id=ck near=p12}} Let's check it {{const t=4}} on the chart. ` +
  `{{plot on=ck id=dem fn="12-x/5" domain=0,60 xlabel="quantity" ylabel="price" "demand"}} Demand stays put, ` +
  `{{plot on=ck id=tx fn="2+t+x/5" domain=0,50 axes=dem "supply + tax"}} and supply lifts by four. ` +
  `{{plot on=ck id=you fn="10" domain=0,60 axes=dem "your 10"}} Your ten is here. ` +
  `{{find id=E of=tx,dem}} The lines cross lower, {{point on=ck at=E "buyers pay"}} at {{val id=E.y}}: one below your guess. ` +
  `Each side still carries half, because the slopes are still equal.`;

export const LEARNER_SCRIPT = {
  src: '/fixtures/econ.pdf',
  page: 12,
  question: LEARNER_Q.main,
  script: MAIN,
  answers: { [LEARNER_Q.aside]: ASIDE, [LEARNER_Q.follow]: FOLLOW, [LEARNER_Q.point]: POINT, [LEARNER_Q.reply]: REPLY },
  steps: [
    // 2: mid-answer, "wait, what's elasticity?" (typing pauses the answer; Enter opens the aside).
    { words: 34, ask: LEARNER_Q.aside },
    // 3: the aside ends; a moment later the student presses Return and the answer resumes.
    { asideDone: 2500, resume: true },
    // 4: a follow-up once the answer has ended.
    { idle: 2500, ask: LEARNER_Q.follow },
    // 5: the pen: a loop around the shaded triangle; the chip attaches, and they type their question.
    { idle: 2500, circle: { page: 12, x: 284, y: 532, rx: 56, ry: 62 } },
    { ms: 600, type: LEARNER_Q.point },
    { ms: 5000, ask: LEARNER_Q.point },
    // 6: the answer ended on a check question: the bar reads "Your answer…"; they reply.
    { idle: 10000, ask: LEARNER_Q.reply },
    // 7: what did we cover: zoom the board out to fit, and the shortcuts card.
    { idle: 2500, zoom: 'fit' },
    { ms: 800, shortcuts: true },
  ] as DevStep[],
};
