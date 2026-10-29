// server/prompt/examples.ts
/**
 * Few-shot examples for the system prompt. RULE: invented documents on topics that appear in no eval
 * PDF and none of the founder's course material (music notation, river deltas, levers), so the model
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
    title: 'one connected scene: things placed by relation, linked to each other and to the page, then transformed',
    question: 'Why does most of the water end up in the east channel?',
    page: 3,
    pages: [3],
    plan: 'The slide gives the rule (flow follows the easier channel) and the widths, but not why the split is so uneven. Central scene: the river, its three channels, links weighted by how much each takes, and the shares of the whole; then widen one channel and let the split change.',
    listing: String.raw`PAGE 3 (visible; 16:9 slide; image attached)
t1 60 40–520: Where a delta's water goes
t2 170 40–900: Water divides between channels in proportion to how easily each one carries it.
t3 240 40–620: Widths: west 2 m, middle 1 m, east 5 m
#g1 figure 520,320 420×380 "delta"`,
    script: String.raw`{{highlight p=3 "in proportion to how easily each one carries it"}} The east channel is the widest, so it carries the most: water splits by how easily each channel takes it. <plan>Scene: the river as a node; the three channels as a flow below it; the widths as bars (the page's values) beside the channels; shares from the widths; links from the river to every channel weighted by the shares. Then widen the middle channel (set) and the split follows.</plan>{{scene id=s near=p3}} Start with {{node on=s id=river "river"}} the river. {{flow on=s id=ch "west" "middle" "east" below=river}} It splits into three channels. {{connect from=p3:"Widths: west 2 m, middle 1 m, east 5 m" to=s:ch}} The slide gives their widths, {{bars on=s id=w vals=2,1,5 labels=west,middle,east right=ch}} two, one and five metres. {{shares on=s id=p op=normalize of=w labels=west,middle,east below=ch}} Each channel's share is its width over the total, {{link on=s from=river to=ch strength=p}} so the river feeds each one in that proportion, {{note on=s "over half" annotate=p[3]}} and the east takes well over half. {{set id=w vals=2,4,5}} Dredge the middle channel to four metres {{emph id=p[2]}} and its share grows, while the others shrink with nothing else changed.`,
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
    script: String.raw`{{highlight p=5 "replaces each day by the mean of it and its neighbours"}} Because each smoothed value is the mean of three days, one hot day gets shared with its neighbours. <plan>Seven days, one hot Thursday: 12 13 12 24 13 12 13. A 1×3 mean window under it. Step the first two windows, sweep the rest, then point at the three outputs that contain the hot day.</plan>{{sketch id=s near=p5}} Here's a week {{grid on=s id=t vals=12,13,12,24,13,12,13 cols=M,T,W,T,F,S,S "°C"}} with one hot Thursday. {{grid on=s id=a over=t win=1x3 reduce=mean below=t "3-day mean"}} Each smoothed value comes from one window of three days. {{step id=a[1]}} The first window takes Monday to Wednesday, {{step id=a[2]}} the next one catches the hot day, {{sweep id=a dur=3}} and the window carries on to Sunday. {{emph id=a[2:4]}} The spike is gone: the window around Thursday reads only {{val id=a[3]}}, the heat spread thinly over three days instead of standing out on one.`,
  },
  {
    title: 'on the slide\'s own chart first, then a formula on the board: named readings said by the engine, a teaching move on its constant',
    question: 'Why does the last bit of charging take so long?',
    page: 2,
    pages: [2],
    plan: 'On the slide\'s chart: 80 percent comes early, the tail is flat. Then the curve from the page formula; read where it reaches 80 and 99; sweep the time constant down.',
    listing: String.raw`PAGE 2 (visible; 16:9 slide; image attached)
t1 60 40–520: Charging a battery
t2 170 40–900: The charge approaches full as 100 × (1 − e^(−t/τ)), in percent, with τ = 30 minutes.
#c1 chart 540,330 400×560 x "minutes" 0–180, y "charge %" 0–100`,
    script: String.raw`{{highlight p=2 "approaches full"}} Each minute adds a fixed share of what is still missing, so the fuller it is, the less it adds. <plan>Slide chart: a line at 80, a note on the tail. Board: plot the formula from tau; find and mark 80 and 99; limit tau to 10.</plan>{{line p=2 on=#c1 from=0,80 to=180,80 weight=faint}} On the slide's own graph, eighty percent comes early, {{note p=2 on=#c1 at=170,99 "the slow tail"}} and the last stretch is almost flat. {{sketch id=s near=p2}} {{const tau=30}} Here is the page's curve. {{plot on=s id=q fn="100*(1-exp(-x/tau))" domain=0,180 xlabel="minutes" ylabel="charge %" "charge"}} {{find id=a of=q level=80}} It passes eighty {{point on=s at=a "80%"}} after {{val id=a.x fmt=0}} minutes, {{find id=b of=q level=99}} {{point on=s at=b "99%"}} but ninety-nine takes {{val id=b.x fmt=0}}: notice how flat it has become. {{limit of=q tau=10 show=b}} A faster charger squeezes the curve left, yet the tail is still the slowest part.`,
  },
];
