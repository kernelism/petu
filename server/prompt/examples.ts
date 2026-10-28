// server/prompt/examples.ts
/**
 * Few-shot examples for the system prompt. RULE: invented documents on topics that appear in no eval
 * PDF and none of the founder's course material (music notation, shadows, levers), so the model
 * learns the moves, not the content. They differ in reach on purpose (one page and two sentences;
 * one page and a drawn what-if; three pages walked with one figure that grows), and none is a shape
 * to copy: the prompt says so, and they are kept short.
 *
 * Every script is executable: tests/server/examples.test.ts strips the plan, parses, resolves against
 * the example's own listings (every page sent with a listing), lints, and checks the geometry and
 * that the board never copies page text.
 */
export type Example = {
  /** What the example shows (for tests and maintainers; not sent to the model). */
  title: string;
  question: string;
  /** The visible page. */
  page: number;
  /** The scout's pages, in teaching order. */
  pages: number[];
  /** The scout's plan, as the model receives it. */
  plan: string;
  /** Exactly what the grounding (src/agent/context/format.ts) shows: the visible page, then the others. */
  listing: string;
  script: string;
};

export const EXAMPLES: Example[] = [
  {
    title: 'one page, a narrow question: point, say what it does, stop',
    question: 'What does this symbol mean?',
    page: 2,
    pages: [2],
    plan: 'The student is asking about the sign at the start of the staff. It is all on this page: what the sign does, and that it holds for the whole line.',
    listing: String.raw`PAGE 2 (visible; portrait page; image attached)
t1 80 100–620: Reading a key signature
t2 140 100–880: Sharps written at the start of a staff apply to every note on that line or space,
t3 175 100–520: for the whole piece.
t4 420 128–140: ♯
#s1 line 100,400→900,400`,
    script: String.raw`{{circle p=2 "♯" near=134,432}} That's a sharp: it raises a note by a half step. {{highlight p=2 "apply to every note on that line or space"}} Written at the start of the staff, it holds for every note on its line through the whole piece, not just the next one.`,
  },
  {
    title: 'one page, a what-if: the page states it, the board makes it happen',
    question: 'What happens to my shadow if I stand twice as far from the lamp?',
    page: 12,
    pages: [12],
    plan: 'The slide states that position matters but never shows why. Central illustration: a side view with the lamp, the person and the ray over their head to the ground; then the same person at twice the distance, so the longer shadow appears from the same construction.',
    listing: String.raw`PAGE 12 (visible; 16:9 slide; image attached)
t1 60 40–330: Shadows
t2 170 40–760: Your shadow's length depends on where you stand.
t3 205 120–185: lamp
t4 520 165–215: post
t5 610 435–480: you
t6 890 500–590: shadow
#d1 dot 150,250 "lamp"
#a1 arrow 450,870→612,870 "shadow"
#s1 line #d1→150,850 "post"
#s2 line 450,850→450,640 "you"
#s3 line 60,850→940,850`,
    script: String.raw`{{circle p=12 mark=#a1}} Twice as far from the lamp, your shadow is twice as long. <plan>Side view, ground y=0, up is negative. Given: lamp foot O=0,0, lamp L=0,-400; you at P=200,0 with head H=200,-150. Ground is line O,P. Tip S=meet(L,H,O,P) = 320,0: shadow 120. Twice as far: P2=400,0, H2=400,-150, tip S2=meet(L,H2,O,P) = 640,0: shadow 240. Draw: lamp, you, ray L to S, shadow brace; you again, ray L to S2, brace (em). Braces run right to left so they hang below the ground.</plan>{{sketch id=s near=p12 fit}}{{let on=s O=0,0 L=0,-400 P=200,0 H=200,-150 P2=400,0 H2=400,-150 S=meet(L,H,O,P) S2=meet(L,H2,O,P)}} {{point on=s at=L "lamp" dir=w}} Here's the lamp, seen from the side. {{line on=s from=P to=H}} You stand a few steps away. {{line on=s from=L to=S weight=secondary}} The ray that just clears your head lands here, {{brace on=s from=S to=P "shadow"}} and everything between your feet and that spot is shadow. {{line on=s from=P2 to=H2}} Now step back to twice the distance. {{line on=s from=L to=S2 weight=secondary}} The ray over your head comes in flatter, {{brace on=s from=S2 to=P2 "2×" em}} and lands twice as far out.`,
  },
  {
    title: 'several pages walked, one figure that grows: point at the rule, draw the case',
    question: 'How can a small push lift something heavy with a lever?',
    page: 6,
    pages: [6, 7, 8],
    plan: 'The student sees a bar on a pivot but not why distance trades for force. Walk: the pivot and bar on 6, the balance rule on 7, the payoff on 8. Central illustration: one bar on its pivot, a heavy load close on one side, a light push far on the other; mark both distances, then let the bar turn so the push end visibly travels farther.',
    listing: String.raw`PAGE 6 (visible; 16:9 slide; image attached)
t1 60 40–300: Levers
t2 170 40–760: A lever is a rigid bar that turns about a fixed point, the pivot.
t3 760 470–530: pivot
#d1 dot 500,700 "pivot"
#s1 line 150,640→850,640
PAGE 7 (16:9 slide; image attached)
t1 60 40–420: The law of the lever
t2 180 40–700 math: F₁ × d₁ = F₂ × d₂
t3 260 40–820: Force times distance from the pivot is the same on both sides.
PAGE 8 (16:9 slide; listing only, no image)
t1 60 40–480: Mechanical advantage
t2 180 40–900: Push three times as far from the pivot, and a third of the force balances the load.`,
    script: String.raw`{{circle p=6 mark=#d1}} A lever trades distance for force: push three times farther from the pivot, and a third of the force lifts the load. <plan>Side view, up negative. Pivot P=0,0. Bar from the load end A=-100,0 to the push end B=along(A,P,4) = 300,0, three times as far from P. Forces as down arrows, 50 per unit: load 3 at A to LA=-100,150; push 1 at B to PB=300,50. Turned bar: A2=-97,-25, B2=along(A2,P,4) = 291,75, so B moves three times as far as A. Draw: pivot, bar, load, push, the two distances (braces left to right, above the bar), the turned bar, both ends' paths (em on the push end's).</plan>{{sketch id=v near=p6 fit}}{{let on=v P=0,0 A=-100,0 B=along(A,P,4) LA=-100,150 PB=300,50 A2=-97,-25 B2=along(A2,P,4)}} {{point on=v at=P "pivot" dir=s}} Here's the pivot, {{line on=v from=A to=B}} with the bar across it. {{arrow on=v from=A to=LA}} A heavy load sits one step out on this side. {{arrow on=v from=B to=PB}} You push three steps out on the other, with a third of the force. {{scroll p=7}} {{highlight p=7 mark=#t2}} This rule is why that balances: force times distance must match on both sides. {{brace on=v from=A to=P "1"}} The load gives three units of force times one step, {{brace on=v from=P to=B "3"}} and you give one unit times three steps. {{line on=v from=A2 to=B2 dash}} Now let the bar turn a little. {{line on=v from=A to=A2 weight=secondary}} The load rises a short way, {{line on=v from=B to=B2 em}} while your hand travels three times as far. {{scroll p=8}} {{highlight p=8 "a third of the force balances the load"}} That's the bargain: a gentler push, over a longer path.`,
  },
  {
    title: 'worked numbers: the engine computes, the window steps, then sweeps',
    question: 'Why does the average flatten the hot day?',
    page: 5,
    pages: [5],
    plan: 'The student sees the rule but not its effect on one odd day. Central illustration: a week of temperatures with one hot day, and the 3-day means under it; step through the first windows, then sweep, so the spike visibly spreads out.',
    listing: String.raw`PAGE 5 (visible; 16:9 slide; image attached)
t1 60 40–520: Smoothing a noisy week
t2 170 40–930: A 3-day moving average replaces each day by the mean of it and its neighbours.
t3 240 40–700: Single hot or cold days count for less.`,
    script: String.raw`{{highlight p=5 "replaces each day by the mean of it and its neighbours"}} Because each smoothed value is the mean of three days, one hot day gets shared with its neighbours. <plan>Seven days, one hot Thursday: 12 13 12 24 13 12 13. A 1×3 mean window under it. Step the first two windows, sweep the rest, then point at the three outputs that contain the hot day.</plan>{{sketch id=s near=p5}} Here's a week {{grid on=s id=t vals=12,13,12,24,13,12,13 cols=M,T,W,T,F,S,S "°C"}} with one hot Thursday. {{grid on=s id=a over=t win=1x3 reduce=mean below=t "3-day mean"}} Each smoothed value comes from one window of three days. {{step id=a[1]}} The first window takes Monday to Wednesday, {{step id=a[2]}} the next one catches the hot day, {{sweep id=a dur=3}} and the window carries on to Sunday. {{emph id=a[2:4]}} The spike is gone: it is spread thinly over three days instead of standing out on one.`,
  },
];
