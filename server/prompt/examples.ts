// server/prompt/examples.ts
/**
 * Few-shot examples for the system prompt. RULE: invented documents on topics that appear in no eval
 * PDF and none of the founder's course material (music notation, a village's coins, a lighthouse beam,
 * a service counter), so the model learns the moves, not the content. They differ in reach on purpose
 * (one page and two sentences; three pages walked with one picture that changes; many cases at once;
 * a guess tested on the slide's own chart), and none is a shape to copy: the prompt says so. Each
 * one that draws shows the mechanism by changing what is already drawn (marks moving between
 * clusters, a sheet filling and counted, a curve shifting on the slide's chart), never by labelled
 * boxes and arrows.
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
    plan: 'The student asks what the sign at the start of the staff means; the page says it all. Beats: 1 ring the sign, say what it does and that it holds for the whole line. Scope: narrow.',
    listing: String.raw`PAGE 2 (visible; portrait page; image attached)
t1 80 100–620: Reading a key signature
t2 140 100–880: Sharps written at the start of a staff apply to every note on that line or space,
t3 175 100–520: for the whole piece.
t4 420 128–140: ♯
#s1 line 100,400→900,400`,
    script: String.raw`{{circle p=2 "♯" near=134,432}} That's a sharp: it raises a note by a half step. {{highlight p=2 "apply to every note on that line or space"}} Written at the start of the staff, it holds for every note on its line through the whole piece, not just the next one.`,
  },
  {
    title: 'a misconception run on the things themselves across three pages: coins as marks that move between owners, the same marks counted when the line moves',
    question: "If every sale is one person's income and another person's spending, why doesn't it all cancel? How does the village get any richer?",
    page: 3,
    pages: [3, 4, 5],
    plan: "Sales cancel, true, but coins crossing in don't. Picture: the coins moving between outside, baker and smith. Beats: 1 travellers' coins cross in (3); 2 the shops pay each other, none leaves; 3 the line rule on 4, predict, salt coins leave, count; 4 the line around the baker (5); 5 check: the smith alone. Scope: standard.",
    listing: String.raw`PAGE 3 (visible; 16:9 slide; image attached)
t1 60 40–520: A village's income
t2 170 40–900: The baker pays the smith 30 coins for tools; the smith pays the baker 20 coins for bread.
t3 240 40–820: Travellers spend 50 coins at the baker. The smith buys 10 coins of salt from outside.
#g1 figure 520,320 420×380 "village"
PAGE 4 (16:9 slide; image attached)
t1 60 40–480: Drawing the line
t2 170 40–900: Payments between people inside the line cancel; only payments that cross it change the total.
PAGE 5 (16:9 slide; listing only, no image)
t1 60 40–520: Every line agrees
t2 170 40–880: Draw the line around any group, and its income is what crosses that line.`,
    script: String.raw`{{highlight p=3 "Travellers spend 50 coins at the baker."}} Inside the village the sales do cancel; it gets richer only by coins that come in from outside, like these. <plan>A mark per coin, starting outside; each payment glides marks between clusters: tools 30 to the smith, bread 20 back, salt 10 out. Count at the end.</plan>{{sketch id=v near=p3}} {{tokens on=v id=c n=50 states=outside,baker,smith "coins"}} Here are the travellers' fifty coins, still outside the village. {{set id=c state=baker n=50}} They spend them at the baker, and every one crosses in. {{set id=c[21:50] state=smith}} The baker pays the smith for tools, {{set id=c[31:50] state=baker}} and some come back for bread. Not one left: that's the cancelling you meant. {{scroll p=4}} {{highlight p=4 "only payments that cross it change the total"}} The page's rule says what does count: a payment across the village's edge. Before the smith buys his salt, guess what the village holds at the end. {{set id=c[21:30] state=outside}} Ten coins cross out, and the village keeps {{val id=c.baker}}, all with the baker now: fifty in, ten out. {{scroll p=5}} {{highlight p=5 "its income is what crosses that line"}} Around the baker alone, the same coins tell his story: travellers' coins and bread money in, tools money out. Check yourself: put the line around the smith alone. What crosses it, and does his total plus the baker's give the village's?`,
  },
  {
    title: 'something happening, made to happen: a beam turning, its spot running along the shore, a live readout climbing; equal turns then braced to show why',
    question: 'The lamp turns at a steady rate, so why does its spot on the shore keep speeding up?',
    page: 7,
    pages: [7],
    plan: 'The student expects a steady turn to give a steady spot. Beats: 1 tower, shore, beam, spot; predict; 2 turn it, the spot speed read live; 3 why: equal turns sweep longer stretches; 4 check: a tower farther out. Scope: narrow.',
    listing: String.raw`PAGE 7 (visible; 16:9 slide; image attached)
t1 60 40–480: The keeper's lamp
t2 170 40–900: The lamp turns at a steady rate, one full turn every 20 seconds.
t3 205 40–760: Its beam lights a spot on a straight shore 200 m away.
#g1 figure 520,320 420×380 "coast"`,
    script: String.raw`{{highlight p=7 "one full turn every 20 seconds"}} The turn is steady, but the farther along the shore the spot is, the more shore each bit of turning sweeps. {{const d=200 th=0 w=2*pi/20 v=d*w/cos(th)^2}}<plan>Tower T=0,0, shore 200 up, drawn wide enough for the whole run. Spot S=d*tan(th),-d moves when th tweens; v follows th. Then beams at equal turns A, B, their stretches braced.</plan>{{sketch id=c near=p7 fit}}{{let on=c T=0,0 N=0,-d S=d*tan(th),-d A=d*tan(0.5),-d B=d*tan(1),-d}} {{point on=c at=T "tower" dir=s}} Here is the tower, {{line on=c from=-140,-d to=460,-d}} and the shore 200 metres out. {{line on=c from=T to=S em}} The beam starts pointing straight at it, {{point on=c at=S "spot" dir=n trace}} lighting the nearest point, {{angle on=c at=T from=N to=S "turn"}} with no turn yet. {{write on=c at=-140,70 "spot speed:" value=v fmt=0 unit=m/s}} Here the spot is at its slowest. Before the lamp turns, guess: does it keep this pace? {{tween th=1.1 dur=8 ease=linear}} Let it turn. The angle grows steadily, yet the spot runs faster and faster, reaching {{val id=v fmt=0}} metres a second. {{line on=c from=T to=A weight=faint dash}} Split the turning into equal steps. {{brace on=c from=N to=A "first step"}} The first sweeps this stretch, {{line on=c from=T to=B weight=faint dash}} {{brace on=c from=A to=B "same turn" em}} and the same turn later sweeps far more: the beam meets the shore at a slant. Check yourself: if the tower stood twice as far out, would the spot at the nearest point move faster or slower?`,
  },
  {
    title: "the student's guess tested on the slide's own chart: the page's formula drawn on its axes, a readout where the guess fails, brackets for the cause, then the curve shifted with its ghost kept",
    question: "Four people an hour wait 10 minutes. If 8 an hour come, won't they just wait 20?",
    page: 2,
    pages: [2],
    plan: "The student assumes waiting grows in step with arrivals. On the slide's chart. Beats: 1 the guess, then the page's formula drawn far above it at eight; 2 why: the spare room shrinks to a third; 3 a faster counter; 4 check. Scope: narrow.",
    listing: String.raw`PAGE 2 (visible; 16:9 slide; image attached)
t1 60 40–560: Waiting at one counter
t2 170 40–900: One clerk serves 10 people an hour. The average wait is 60 / (10 − a) minutes,
t3 205 40–520: where a is the number arriving each hour.
#c1 chart 520,330 420×560 x "arrivals per hour" 0–10, y "wait (min)" 0–60`,
    script: String.raw`{{point p=2 on=#c1 at=4,10 "now"}} Longer than that: the wait depends on the clerk's spare room, and doubling the crowd uses up most of it. {{point p=2 on=#c1 at=8,20 "your guess"}} Your guess puts eight arrivals at twenty minutes, {{line p=2 on=#c1 from=4,10 to=8,20 dash}} on a straight line from here. {{const service=10 spare=service-4 rest=service-8}} {{plot p=2 on=#c1 id=w fn="60/(service-x)" "the page's rule"}} Let the page's own formula draw the real curve on its chart. {{find id=W of=w x=8}} {{point p=2 on=#c1 at=W "at eight"}} At eight arrivals it reads {{val id=W.y}} minutes, far above your guess. {{brace p=2 on=#c1 from=4,10 to=10,10 "spare"}} Here's why: at four an hour the clerk has room for {{val id=spare}} more, {{brace p=2 on=#c1 from=8,30 to=10,30 "spare" em}} at eight only {{val id=rest}}. {{highlight p=2 "60 / (10 − a)"}} The formula divides by that spare room, so a third of the room means three times the wait. {{beforeafter of=w service=20}} Now let the counter serve twenty an hour: the curve drops on the same axes, its old place stays as a ghost, and eight arrivals wait {{val id=W.y}} minutes. Check yourself: at that faster counter, how many an hour could come before they wait the ten minutes they wait now?`,
  },
];
