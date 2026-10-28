// server/prompt/examples.ts
/**
 * Few-shot examples for the system prompt. RULE: never from a deck or page the eval uses, never from
 * the founder's course material. Sources: the committed fixture (public/fixtures/epipolar.pdf p3,
 * with its real grounding listing) and two synthetic pages on everyday topics far from any course
 * deck (shadows, a sum), so the model learns the moves, not the content.
 *
 * Every script is executable: tests/server/examples.test.ts strips the plan, parses, resolves against
 * the example's own listing, lints, and checks the answer shape and the geometry. Writing these by
 * hand, geometry slips are easy (the plan's first drafts had two); the test is the guard.
 */
export type Example = {
  /** `<question type>: <what it shows>`; the type matches the playbook. */
  title: string;
  source: 'fixture' | 'synthetic';
  question: string;
  page: number;
  /** Exactly what the grounding (src/agent/context/format.ts) shows for the visible page. */
  listing: string;
  script: string;
};

export const EXAMPLES: Example[] = [
  {
    title: 'point-at: page marks, and a short quote with near=',
    source: 'fixture',
    question: 'What is C′ here?',
    page: 3,
    listing: String.raw`PAGE 3 (visible; page; image attached)
t1 59 50–352: Epipolar Constraint
t2 152 50–514: - A point x in image 1 back-projects to a ray in 3D
t3 205 50–582: - That ray projects to a line l' in image 2: the epipolar line
t4 259 50–617: - So the match x' must lie on l', and the search becomes 1-D
t5 401 150–208: image 1
t6 401 744–802: image 2
t7 430 316–326: x
t8 837 213–226: C
t9 837 700–717: C'
t10 912 413–534: x'T F x = 0
t11 926 925–934: 3
#d1 dot 238,813 "C"
#d2 dot 713,813 "C'"
#d3 dot 290,473 "x"
#g1 figure 138,348 225×268 "image 1 x"
#g2 figure 588,348 225×268 "image 2"
#s1 line #d1→#d2`,
    script: String.raw`{{scroll p=3}}{{circle p=3 mark=#d2 em}} C′ is the second camera, the one that takes image 2. It looks out through {{box p=3 mark=#g2}} this panel. Its partner, {{circle p=3 mark=#d1}} C, takes image 1. One dot in C's picture becomes a whole line in image 2: {{underline p=3 "l'" near=310,220}} l′.`,
  },
  {
    title: 'what-if: a fitted sketch built from named points',
    source: 'synthetic',
    question: 'What happens to my shadow if I stand twice as far from the lamp?',
    page: 12,
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
    script: String.raw`{{scroll p=12}} Twice as far from the lamp, {{circle p=12 mark=#a1}} your shadow is twice as long. <plan>Side view, ground y=0, up is negative. Given: lamp foot O=0,0, lamp L=0,-400; you at P=200,0 with head H=200,-150. Ground is line O,P. Tip S=meet(L,H,O,P) = 320,0: shadow 120. Twice as far: P2=400,0, H2=400,-150, tip S2=meet(L,H2,O,P) = 640,0: shadow 240. Draw: lamp, you, ray L to S, shadow brace; you again, ray L to S2, brace (em). Braces run right to left so they hang below the ground.</plan>{{sketch id=s near=p12 fit}}{{let on=s O=0,0 L=0,-400 P=200,0 H=200,-150 P2=400,0 H2=400,-150 S=meet(L,H,O,P) S2=meet(L,H2,O,P)}} {{point on=s at=L "lamp" dir=w}} Here's the lamp, seen from the side. {{line on=s from=P to=H}} You stand a few steps away. {{line on=s from=L to=S weight=secondary}} The ray that just clears your head lands here. {{brace on=s from=S to=P "shadow"}} Everything between your feet and that spot is shadow. {{line on=s from=P2 to=H2}} Now step back to twice the distance. {{line on=s from=L to=S2 weight=secondary}} The ray over your head comes in flatter. {{brace on=s from=S2 to=P2 "twice as long" em}} It lands twice as far out, and the shadow doubles. Your shadow is always the same fraction of your distance from the lamp.`,
  },
  {
    title: 'derive: point at the result, then build the proof as a picture',
    source: 'synthetic',
    question: 'Why is 1 + 2 + … + n equal to n(n+1)/2?',
    page: 5,
    listing: String.raw`PAGE 5 (visible; 16:9 slide; image attached)
t1 60 40–450: Adding up 1 to n
t2 210 60–560 math: 1 + 2 + ⋯ + n = n(n+1)/2
t3 400 40–720: Check with n = 4: 1 + 2 + 3 + 4 = 10, and 4 · 5 / 2 = 10.`,
    script: String.raw`{{scroll p=5}}{{highlight p=5 "n(n+1)/2"}} Two copies of this sum fill a rectangle, so the sum is half of it. <plan>n=4 as unit squares 100 wide, ground y=0, up negative. Frame A=0,0 B=400,0 C=400,-500 D=0,-500: n wide, n+1 tall. M=0,140 holds the result under it. Staircase: columns 1,2,3,4 tall. Its copy, flipped, fills the rest of the frame. Braces: C to B on the right (n+1), B to A below (n). Then "2 × sum = n(n+1)" at M; box the page's formula last (em).</plan>{{sketch id=d near=p5 fit}}{{let on=d A=0,0 B=400,0 C=400,-500 D=0,-500 M=0,140}} {{shade on=d pts=A B 400,-400 300,-400 300,-300 200,-300 200,-200 100,-200 100,-100 0,-100 outline}} Stack the sum as columns: one, two, three, up to n. {{shade on=d pts=0,-100 100,-100 100,-200 200,-200 200,-300 300,-300 300,-400 400,-400 C D outline}} A flipped copy fits exactly on top. {{brace on=d from=C to=B "n + 1"}} Now every column is n plus one tall. {{brace on=d from=B to=A "n"}} And there are n columns. {{math on=d at=M "2 \times \text{sum} = n(n+1)" size=m}} So two copies of the sum make n times n plus one. {{box p=5 mark=#t2 em}} Halve it, and you get the formula on the slide.`,
  },
];
