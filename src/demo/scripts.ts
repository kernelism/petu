// src/demo/scripts.ts
import type { Demo } from './demoScript';
import { GATE_SCRIPT } from './gate';
import { EXAMPLES } from '../../server/prompt/examples';

/**
 * The prompt's few-shot examples played on public/fixtures/examples.pdf (`npm run decks -- examples`),
 * so a prompt change can be judged by the board a student would see. The plan is stripped (the
 * server's filter does that for a real answer); the deck spells the counter's minus as "-" (WinAnsi).
 */
function example(title: string): Demo & { src: string; page: number } {
  const ex = EXAMPLES.find((e) => e.title.includes(title));
  if (!ex) throw new Error(`no prompt example titled …${title}…`);
  const script = `{{scroll p=${ex.page}}} ` + ex.script.replace(/<plan>[\s\S]*?<\/plan>/g, '').replace(/−/g, '-');
  return { src: '/fixtures/examples.pdf', page: ex.page, question: ex.question, script };
}
import { LEARNER_SCRIPT, type DevStep } from './learner';
import { SVG_DEMOS } from './svg';
import { LANE_SCRIPTS } from './lane';

/**
 * Dev-only named scripts for real PDFs: `?script=<name>` (optionally `&src=<pdf url>`) opens the
 * PDF and plays the script. Anchored quotes are written against the PDF's actual text runs.
 * public/dev/ is git-ignored: the lecture PDFs are the user's course files and are never committed.
 */
export const SCRIPTS: Record<string, Demo & { src: string; page?: number;
  /** Later questions of a simulated session (an aside, a follow-up, a check reply): each plays its canned script. */
  answers?: Record<string, string>;
  /** A simulated student (src/demo/learner.ts): what they do and when, after the first question. */
  steps?: DevStep[];
  /** The fake repair's replacement per stage-2 unit index (`&repair=fake`; src/agent/repair.ts fakeRepair `text`). */
  repairs?: Record<number, string> }> = {
  /** The live commit gate's demo (src/demo/gate.ts): beat 3 names a point nothing carries. */
  gate: GATE_SCRIPT,
  /** The v1 learner UX storyboard as one simulated session on econ.pdf p12 (src/demo/learner.ts). */
  learner: LEARNER_SCRIPT,
  /**
   * Flow across the document (econ.pdf, asked on p9): a lead-in on p9, a journey to p2 (the demand
   * line's equation) and back. Exercises the route chip, the arrival beat, answer parts (three:
   * p9 · The Law of Demand · Back to p9), "Back to p9", and highlight units: "slope is constant"
   * grows to its sentence, "a higher price" to its two-line bullet, "P/Q is not" stays inside its
   * sentence. `page` is where the question is asked; a question asked mid-answer plays as an aside
   * (its script in `answers`).
   */
  flow: {
    src: '/fixtures/econ.pdf',
    page: 9,
    question: 'Why does elasticity change along a straight demand line?',
    answers: { 'what is a percentage change?': 'Take two points on the line. At a price of 10, a one dollar cut is a ten percent cut, and the five extra units are a fifty percent rise on ten. ' +
      'At a price of 2, the same dollar is half the price, and five more units on fifty is only ten percent. Same step, very different percentages.' },
    script:
      `Along a straight demand line {{highlight p=9 "slope is constant"}} the slope never changes, but elasticity is a ratio of percentages, so it keeps changing as you slide down the line. ` +
      `To see why, go back to where this line comes from. {{scroll p=2}} ` +
      `This is the demand curve from the start of the lecture, {{highlight p=2 "Qd = 60 – 5P"}} quantity is sixty minus five times price. ` +
      `{{highlight p=2 "a higher price"}} Every dollar off the price adds the same five units, wherever you are on it. ` +
      `That fixed step is the slope. {{scroll p=9}} ` +
      `Back on this slide, elasticity multiplies that slope by {{underline p=9 "P/Q is not"}} price over quantity. ` +
      `{{highlight p=9 "above M: |Ed| > 1"}} High up the line, price is large and quantity small, so demand is elastic; ` +
      `{{highlight p=9 "below M: |Ed| < 1"}} low down it is the reverse, and demand is inelastic. ` +
      `{{highlight p=9 "at M (Q = 30, P = 6)"}} They balance exactly at the midpoint.`,
  },
  /**
   * lec09 p40 "Depth from disparity" (1920 × 1080; page model coords from pdf.js text runs).
   * The slide already draws the cameras, baseline B, f and image planes, so the sketch draws none of
   * them: it only compares a near point with one twice as far.
   *   "x − x′" inside the disparity equation: x 507–567, y 769–822 → box at (503,760), 68 × 72
   *   the fraction B·f / z: x 598–652, B·f cap top 737, z baseline 856 → circle at (627,800), rx 37 ry 50 (clear of the "=") (page radii
   *     are in the page's x units on both axes)
   *   "Disparity is inversely proportional to depth." is one text run: the highlighted payoff
   * Region `side` (1000 × 700): the two images laid on top of each other, centres lined up (x 500).
   *   depth z  : image row y 200 (150–850) + centre tick; x′ (300,200), x (700,200): offsets of 200
   *              each (B f / 2z); brace 700→300 at y 240 (tip down) "x − x′"
   *   depth 2z : image row y 470 + tick; x′ (400,470), x (600,470): offsets of 100 each; brace
   *              600→400 at y 510, accent, "half": directly under the first, so the lengths compare
   *   row labels z / 2z typeset as math left of each row (one voice: "2z" as a write would set in sans)
   * Elements (6): row z (+ label), its x and x′, its brace; row 2z (+ label), its x and x′, its brace
   * (accent). Page marks: the x − x′ box, then the payoff circles the slide's own B f / z and
   * highlights its last line.
   */
  lec09: {
    src: '/dev/lec09_optical_flow.pdf',
    question: 'Why is disparity inversely proportional to depth?',
    script:
      `{{scroll p=40}} Disparity, {{box p=40 at=503,760 size=68,72}} x minus x-prime, is how far a point shifts between the two images, ` +
      `and a farther point shifts less. ` +
      `{{sketch id=side near=p40 size=m}} Lay the two images on top of each other, ` +
      `{{line on=side from=150,200 to=850,200}} centres {{line on=side from=500,178 to=500,222 weight=secondary}} lined up. ` +
      `A point at depth {{math on=side at=50,200 "z" size=s}} z lands {{point on=side at=700,200 "x" dir=n}} here in the left image ` +
      `{{point on=side at=300,200 "x′" dir=n}} and here in the right, ` +
      `{{brace on=side from=700,240 to=300,240 "x − x′"}} and this gap is its disparity. ` +
      `Now a point {{math on=side at=50,470 "2z" size=s}} twice as far. ` +
      `{{line on=side from=150,470 to=850,470}} Same images, {{line on=side from=500,448 to=500,492 weight=secondary}} same centres. ` +
      `Its rays come in closer to parallel, so it lands {{point on=side at=600,470 "x" dir=n}} nearer ` +
      `{{point on=side at=400,470 "x′" dir=n}} the centre in both: ` +
      `{{brace on=side from=600,510 to=400,510 "half" em}} half the gap. ` +
      `That's the slide's {{circle p=40 at=627,800 rx=37 ry=50}} B f over z: twice the depth, half the disparity. ` +
      `{{highlight p=40 "Disparity is inversely proportional to depth."}} Disparity is inversely proportional to depth.`,
  },
  /**
   * The agent's relational grammar, played without an API call (E1.2): the sample deck's page 3, top
   * view of the two cameras. Geometry is named, never computed by hand: `let` sets the world points
   * once (fitted to the region by `fit`), the image points are `meet`s of rays with the image
   * planes, the far point is `along` the first ray, the ray is drawn `through` x, and the page is
   * pointed at by its own marks (#d3 = x, #d1 = C, #d2 = C′).
   *   world: C 0,0 and C′ 600,0 (baseline), image planes at y −120, X 150,−350, X2 = 2.4 × along C→X
   *   (x′ and x2′ land ~120 apart on image 2, so the epipolar segment reads as a line)
   */
  relational: {
    src: '/fixtures/epipolar.pdf',
    question: 'Why must the match lie on a line?',
    script:
      `{{scroll p=3}} This {{circle p=3 mark=#d3 em}} point x could have come from anywhere along one ray, so its match can only be on a line. ` +
      `{{sketch id=s near=p3 size=m fit}} Seen {{let on=s C=0,0 C'=600,0 X=150,-350 X2=along(C,X,2.4) L1=-150,-120 L2=150,-120 R1=380,-120 R2=750,-120}} ` +
      `from above, {{point on=s at=C "C" dir=s}} camera C {{line on=s from=L1 to=L2 weight=secondary}} looks through image 1. ` +
      `{{line on=s from=C through=X dash id=ray}} Its ray through x runs out into the scene, ` +
      `{{point on=s at=meet(C,X,L1,L2) "x" dir=w id=x}} crossing image 1 at x. ` +
      `{{connect from=p3:#d3 to=s:x}} That is the page's x. ` +
      `A near point {{point on=s at=X "X" dir=e}} here ` +
      `and a far one {{point on=s at=X2 "X2" dir=e id=X2}} there both land on x. ` +
      `Now {{point on=s at=C' "C′" dir=s}} camera C′, {{line on=s from=R1 to=R2 weight=secondary}} with image 2, ` +
      `sees them apart: {{line on=s from=C' to=X weight=faint}} the near one {{point on=s at=meet(C',X,R1,R2) "x′" dir=n}} here, ` +
      `{{line on=s from=C' to=X2 weight=faint}} the far one {{point on=s at=meet(C',X2,R1,R2) "x2′" dir=n}} there. ` +
      `{{line on=s from=meet(C',X,R1,R2) to=meet(C',X2,R1,R2) em}} Every depth lands on this one line in image 2: ` +
      `{{circle p=3 mark=#d1}} that is why, {{circle p=3 mark=#d2}} for this pair of cameras, the search is one-dimensional.`,
  },
  /**
   * A founder live test, verbatim (Opus author, 2026-10-29): a frictionless chord tunnel through the
   * Earth, on the public corpus copy of OpenStax University Physics vol 1 (`.petu/corpus`, served by
   * /api/dev-pdf/ when PETU_PDF_DIRS includes it; the gallery's server does). A fit sketch with no axes:
   * the chord's ends A, B lie on the circle r=400 about O, so they must land on its stroke; the arrows'
   * labels must show; "New York"/"Tokyo" go west/east, outside the circle, off every stroke.
   */
  tunnel: {
    src: '/api/dev-pdf/openstax-university-physics-volume-1.pdf',
    page: 617,
    question: 'If I dug a frictionless tunnel through the Earth from New York to Tokyo, why would the trip take 42 minutes?',
    script:
      `{{sketch id=s near=p617 fit}} {{let on=s O=0,0 A=-300,-265 B=300,-265 M=mid(A,B) P=along(M,B,0.6) G=along(P,O,0.35) F=foot(G,A,B)}} The forty-two minutes comes from one fact about the pull inside the Earth. Let's build it piece by piece, starting with {{circle on=s at=O r=400}} the Earth, {{line on=s from=A to=B}} {{point on=s at=A "New York" dir=w}} {{point on=s at=B "Tokyo" dir=e}} and your chord tunnel. {{point on=s at=M "M" dir=n}} M is its midpoint, the point on the chord closest to the centre, {{point on=s at=O "O" dir=s}} and O is the centre itself. {{line on=s from=O to=M dash}}\n\n` +
      `{{scroll p=620}} {{box p=620 mark=#i1}} First, gravity always points at the centre, like these field lines. {{point on=s at=P "ball" dir=n}} So put the ball partway down the tunnel, {{arrow on=s from=P to=G "gravity"}} and its pull aims at O, slanted across the tunnel. {{arrow on=s from=P to=F em "along tunnel"}} The frictionless walls take care of the sideways part, so only this piece along the tunnel moves the ball.\n\n` +
      `{{scroll p=617}} {{highlight p=617 "We also examine the gravitational effects within spherical bodies."}} Second, inside a uniform Earth the pull is not g everywhere. It shrinks in proportion to your distance from the centre: halfway down you feel half of g, and at the centre you feel nothing. Third, the slant does the same trick to the along-tunnel part. Similar triangles shrink that part so it is proportional to the ball's distance from M. On every chord, then, the push toward the middle is g over R times the distance from M.\n\n` +
      `{{scroll p=724}} {{highlight p=724 "independent of amplitude"}} A pull proportional to distance is exactly a spring, and a spring's period ignores how far out you start. Here the role of k over m is played by g over R. {{const g=9.8 R=6.37e6 half=pi*sqrt(R/g)/60}} The ball goes from New York to Tokyo in half a period, pi times the square root of R over g, which is {{val id=half fmt=1}} minutes. {{line on=s from=O to=B weight=secondary}} A diameter is just a longer swing on the same spring, with a stronger pull at its ends, so it takes the same time.\n\n` +
      `{{scroll p=630}} {{box p=630 mark=#b2}} Now the satellite. Put r equal to R in this period, and use GM equal to g R squared from the Weight section. The orbit's period becomes two pi times the root of R over g, exactly twice the tunnel time. {{scroll p=724}} {{box p=724 mark=#i1}} The match is no accident. The shadow of a uniform circular motion on any straight line moves in simple harmonic motion, and the tunnel ball keeps pace with the shadow of a satellite skimming the surface overhead.\n\n` +
      `One caution: the real Earth has a dense core, so its pull inside doesn't fall off in step with distance, and a real trip would be somewhat faster. Check yourself: on a planet with the same density but half Earth's radius, would the tunnel trip take longer, shorter, or the same?`,
  },
  /**
   * Founder live test, verbatim (Opus author, 2026-10-29): rent ceiling on OpenStax Principles of
   * Economics 3e (corpus). Bars side by side must share one baseline and one value scale.
   */
  'live-econ': {
    src: '/api/dev-pdf/openstax-principles-economics-3e.pdf',
    page: 86,
    question: 'Why does a price ceiling on rent create a shortage, and who actually ends up better or worse off?',
    script:
      `{{scroll p=88}} Here is the textbook's own rent example, where the mechanism shows in the numbers. {{highlight p=88 "the price of a rental unit would rise to $600"}} After demand grows, the market would settle at six hundred dollars, with seventeen thousand units rented. {{scene id=s near=p88}} {{bars on=s id=m vals=17,17;15,19 labels=market $600,ceiling $500 parts=supplied,demanded "thousands of units"}} At six hundred dollars, the units landlords offer and the units renters want match.\n\n` +
      `{{highlight p=88 "the horizontal line at the price of $500"}} Now the law holds rent at five hundred. Two things happen at once. Renters respond to the cheaper price, and the number who want a unit climbs to nineteen thousand. {{highlight p=88 "the quantity supplied remains at the same 15,000 rental units"}} Landlords respond to the lower rent too, and they offer only fifteen thousand. {{calc on=s id=gap of=m[2,2],m[2,1] fn="x-y" below=m "shortage"}} The gap between what is wanted and what is offered is the shortage: {{val id=gap}} thousand households who want a unit at that rent and cannot get one. The ceiling made the gap by keeping price from rising to close it.\n\n` +
      `{{tokens on=s id=h n=19 states=housed,shut out "households wanting a unit" below=gap}} So who comes out ahead? Picture the nineteen thousand households as marks, one per thousand. {{set id=h[16:19] state=shut out}} Only fifteen of them find a unit. {{highlight p=88 "fewer apartments rented out under the price ceiling"}} That is the irony the page points out: fewer people are housed than the seventeen thousand at the market rent.\n\n` +
      `{{highlight p=88 "Those who manage to purchase the product at the lower price given by the price ceiling"}} The households that get a unit gain, because they pay a hundred dollars less. {{highlight p=88 "landlords tend to spend less on maintenance"}} Even part of that gain shrinks, because landlords cut upkeep, so the cheaper apartment is often a worse apartment. Landlords lose the extra rent, and some take units off the rental market altogether. The shut-out households lose the most: a low rent is worth nothing if you cannot find a place.\n\n` +
      `Before you check the table, guess: if the ceiling were set at four hundred dollars instead, would the shortage grow or shrink? {{set id=m[2,1] to=12}} {{set id=m[2,2] to=23}} From the table's four-hundred row, supply falls to twelve thousand and demand rises to twenty-three thousand, and the shortage now reads {{val id=gap}} thousand. Last question: what would a ceiling set at seven hundred dollars do, above the market rent, and would anyone be shut out?`,
  },
  /**
   * Founder live test, verbatim (Opus author, 2026-10-29): d/dx sin x on the unit circle, OpenStax
   * Calculus vol 1 (corpus). Labels at one point (dx, Q, x) must never stack.
   */
  'live-calc': {
    src: '/api/dev-pdf/openstax-calculus-volume-1.pdf',
    page: 249,
    question: 'Why is the derivative of sin x equal to cos x? Show me, don\'t just prove it.',
    script:
      `{{scroll p=250}} Start with the page's own guess. {{box p=250 mark=#i1}} The book computes a tiny difference quotient for sine, and the graph it gets looks like a cosine curve. The circle shows why that happens.\n\n` +
      `{{sketch id=s near=p250 fit}} {{let on=s O=0,0 E=320,0 W=-320,0 N=0,-320 S=0,320 P=247,-169 Q=198,-225 R=198,-169 F=foot(P,O,E)}} {{circle on=s at=O r=300}} {{line on=s from=W to=E weight=faint}} {{line on=s from=S to=N weight=faint}} Take a point on the unit circle, {{point on=s at=P "P" dir=e}} {{line on=s from=O to=P}} at angle x from the horizontal axis. {{line on=s from=P to=F em id=ht}} Its height is sin x. {{label id=ht "sin x" dir=e}} {{angle on=s at=O from=E to=P "x"}} So asking how fast sine changes means asking how fast this point rises as the angle grows.\n\n` +
      `{{point on=s at=Q "Q" dir=n}} Turn the angle a tiny bit more, to Q. Because x is in radians and the radius is one, the arc from P to Q has length equal to the change in angle. {{line on=s from=P to=Q id=arc}} {{label id=arc "dx" dir=ne}} Up close the arc is almost straight, and it points along the tangent, which is perpendicular to the radius.\n\n` +
      `{{line on=s from=Q to=R em id=rise}} {{line on=s from=R to=P dash}} The rise from P to Q is the change in sine. {{label id=rise "rise" dir=w}} Look at the little triangle. Its slanted side is perpendicular to the radius, so the triangle is the big triangle O, F, P turned a quarter turn. {{angle on=s at=Q from=R to=P "x"}} That makes its angle at Q equal to x. The vertical leg is adjacent to that angle, so the rise is the arc times cos x. Divide the rise by the change in angle and you get cos x. That ratio is the derivative.\n\n` +
      `Now move the point around the circle in your head. Near angle zero the arc runs straight up and the rise is as large as the arc: the rate is one, and cos zero is one. At the top the arc runs sideways, so for a moment there is no rise at all: the rate is zero. Past the top the arc tilts downward and the height falls: the rate is negative. Cosine is the point's horizontal position, and it goes through exactly the same values, positive, then zero, then negative.\n\n` +
      `{{scroll p=252}} {{box p=252 mark=#i1}} That is this figure. {{highlight p=252 "has a maximum or a minimum,"}} Sine flattens at its peak just where the cosine curve crosses zero, and it is steepest where cosine reaches one or negative one.\n\n` +
      `{{scroll p=251}} {{box p=251 mark=#e3}} The formal proof says the same thing with limits. Sine h over h going to one says a tiny arc and its rise are the same length near zero. The other limit says the sideways part of a small turn vanishes to first order. Before checking, picture the point at the far left of the circle, at angle pi. Which way is a tiny arc pointing there, and what does that make the slope of sine at pi?`,
  },
  /**
   * Visual kit v1 check (spec "Visual kit v1"), no API call: six board sections, half of them outside
   * computer science, every number computed by the engine. 1 a window sliding over a patch with an
   * edge (live calc line, output filling); 2 two vectors as bars, a brightness change, a raw distance
   * that grows and a normalized score that doesn't; 3 data with outliers, two candidate lines, a band
   * and a live count; 4 a demand table whose elasticity column fills row by row, with a reference
   * line; 5 a thrown ball: a table filling heights and speeds, points and bars following it; 6 two
   * dice: a 6×6 grid of sums, the cells of one sum counted; 7 at scale: a noisy 24×24 image (view=image,
   * seeded noise) smoothed by a 1/9 mean kernel into an output image; 8 a cooling cup: noisy readings as a
   * line, their running average on the same axes, and the law plotted from named constants; 9 amounts as
   * parts: a price split into seller + tax, a bill stacked as room + tax on one scale (a part set, the total
   * follows); 10 the same payment as coins moving to the tax; 11 a histogram of single draws vs of sample
   * means on shared bins (the means narrow).
   */
  kit: {
    src: '/fixtures/econ.pdf',
    question: 'Visual kit check',
    script:
      `{{scroll p=1}} Eight small lessons, drawn by the engine. ` +
      `{{sketch id=f near=p1}} Take a patch {{grid on=f id=img vals=10,10,10,90,90,90;10,10,10,90,90,90;10,10,10,90,90,90;10,10,10,90,90,90;10,10,10,90,90,90 shade "image patch"}} with a dark-to-bright edge down its middle. ` +
      `The kernel {{grid on=f id=k vals=-1,0,1;-1,0,1;-1,0,1 right=img op=⊛ "kernel"}} weighs the right column against the left. ` +
      `{{grid on=f id=o over=img slide=k right=k op== "output"}} The output starts empty. ` +
      `{{step id=o[1,1]}} Put the kernel on the first patch and multiply and add: all one brightness, so zero. ` +
      `{{step id=o[1,2]}} Slide one column: now the right column sees the bright side, and the sum jumps. ` +
      `{{sweep id=o dur=5}} Sweep the rest, and the output is large only where the brightness changes. ` +
      `{{emph id=o[1:3,2:3]}} That band is the edge. ` +
      `{{sketch id=b near=p1}} Now two patches as vectors: {{bars on=b id=u vals=2,4,3,5 labels=1,2,3,4}} u, ` +
      `{{bars on=b id=v vals=3,5,4,6 labels=1,2,3,4 right=u}} and v, the same pattern one step brighter. ` +
      `{{calc on=b of=u,v fn="(x-y)^2" reduce=sum "SSD"}} Their sum of squared differences is small. ` +
      `{{bars on=b id=nu map=u fn="(x-mean)/std" below=u "(u − mean) / std"}} Subtract each mean and divide by the spread, ` +
      `{{bars on=b id=nv map=v fn="(x-mean)/std" right=nu "(v − mean) / std"}} and the two shapes are identical, ` +
      `{{calc on=b of=nu,nv reduce=cos "ρ"}} so their correlation is one. ` +
      `{{set id=v fn="2*x+3"}} Now make v brighter and higher in contrast: ` +
      `{{emph id=v}} the bars jump, the squared differences explode, but the normalized shapes do not move. ` +
      `{{sketch id=r near=p1}} Third, {{scatter on=r id=d pts=1,1.3 2,2.1 3,2.8 4,4.2 5,5.1 6,5.8 7,7.2 8,7.9 2.5,7 6.5,1.5 4.5,8.5 x="x" y="y"}} points along a line, plus three outliers. ` +
      `{{fit on=r id=l1 of=d pick=9,2}} Pick two points at random: this pair includes an outlier, ` +
      `{{band id=l1 w=0.6 "inliers"}} and only a few points fall inside its band. ` +
      `{{fit on=r id=l2 of=d pick=2,7 em}} Another pair, {{band id=l2 w=0.6 "inliers"}} and most of the points agree. ` +
      `{{dist from=d[9] to=l2}} An outlier sits far outside it. ` +
      `{{sketch id=e near=p1}} Fourth, a demand table: {{table on=e id=dm cols=P,Qd,|ε| vals=10,10;8,20;6,30;4,40;2,50}} price and quantity demanded. ` +
      `{{col id=dm.c fn="abs(((b-pb)/((b+pb)/2))/((a-pa)/((a+pa)/2)))" dur=4}} For each price cut, the percentage change in quantity over the percentage change in price. ` +
      `{{level id=dm.c at=1 "|ε| = 1"}} Above this line demand is elastic, below it inelastic. ` +
      `{{sketch id=m near=p1}} Fifth, a ball thrown up at twenty meters per second: {{table on=m id=tb cols=t,y,v vals=0;1;2;3;4}} one row a second. ` +
      `{{col id=tb.b fn="20*a-5*a^2" dur=3}} its height each second, ` +
      `{{scatter on=m id=tr pts=tb.a,tb.b right=tb x="t" y="height"}} traced as it rises and falls. ` +
      `{{col id=tb.c fn="20-10*a" dur=3}} Its speed drops by ten every second, ` +
      `{{bars on=m id=vb vals=tb.c labels=tb.a right=tr "v"}} through zero at the top, then negative on the way down. ` +
      `{{sketch id=p near=p1}} Last, two dice. {{grid on=p id=s size=6x6 fn="r+c" rows=1,2,3,4,5,6 cols=1,2,3,4,5,6 "sum of two dice"}} Each cell is a sum, all thirty-six equally likely. ` +
      `{{emph id=s where="x==4"}} A four is a short diagonal: {{calc on=p of=s fn="x==4" reduce=count right=s "P(sum = 4)"}} three cells. ` +
      `{{emph id=s where="x==7"}} A seven runs corner to corner: {{calc on=p of=s fn="x==7" reduce=count below=s "P(sum = 7)"}} six cells, the most of any sum. ` +
      `{{sketch id=n near=p1}} Now at scale: {{grid on=n id=ni size=24x24 fn="(c>12)*100+30*randn()" view=image "noisy edge"}} a noisy image with an edge down the middle, ` +
      `{{grid on=n id=nk vals=1/9,1/9,1/9;1/9,1/9,1/9;1/9,1/9,1/9 right=ni op=⊛ "mean"}} a three by three mean, ` +
      `{{grid on=n id=no over=ni slide=nk right=nk op== "smoothed"}} and its output as a picture. {{step id=no[1,1]}} One window is just an average, ` +
      `{{sweep id=no dur=4}} and over the whole image the speckle melts while the edge stays. ` +
      `{{sketch id=c near=p1}} Last, a cup of tea cooling: {{const room=20 hot=90 k=0.1}} it starts at ninety degrees, in a room at twenty: ` +
      `{{bars on=c id=temp size=1x40 fn="room+(hot-room)*exp(-k*c)+3*randn()" view=line "thermometer"}} forty noisy readings, a minute apart, ` +
      `{{bars on=c id=avg over=temp win=1x5 reduce=mean axes=temp "5-minute average"}} and their running average on the same axes. ` +
      `{{plot on=c id=law fn="room+(hot-room)*exp(-k*x)" domain=0,40 axes=temp "the law" em}} The cooling law runs right through it. ` +
      `{{sketch id=q near=p1}} Now amounts as parts. {{const t=2}} A buyer paid {{bars on=q id=pay vals=7,8 labels=before,after "price paid"}} seven before a tax and eight after. ` +
      `{{split id=pay[2] vals=t "seller" "tax"}} Split the eight: {{val id=pay[2,2]}} is tax, so the seller keeps {{val id=pay[2,1]}}, less than before. ` +
      `A hotel bill stacks the same way, {{bars on=q id=bill vals=100;90,20 labels=before,after parts=room,tax right=pay "a night's bill"}} room and tax on one scale. ` +
      `{{set id=bill[2,1] to=85}} If the hotel cuts its rate, the room part shrinks and the total follows. ` +
      `{{sketch id=k near=p1}} Count the same payment in coins: {{tokens on=k id=coins n=8 states=seller,tax "coins paid"}} eight of them, ` +
      `{{set id=coins state=tax n=t}} and the tax takes {{val id=coins.tax}}, leaving the seller {{val id=coins.seller}}. ` +
      `{{sketch id=h near=p1}} Last, why an average is steadier than one draw: {{grid on=h id=x size=10x200 fn="randn()" view=image "200 samples of 10 draws"}} two hundred samples of ten noisy draws, ` +
      `{{grid on=h id=mx over=x win=10x1 reduce=mean below=x "each sample's mean"}} and each sample's mean. {{sweep id=mx dur=2}} Every column averages out. ` +
      `{{bars on=h id=h1 hist=x bins=16 below=mx "single draws"}} Single draws spread wide; {{bars on=h id=h2 hist=mx axes=h1 below=h1 "means of 10"}} their means bunch in the middle, on the same scale.`,
  },
  /**
   * Demonstration moves and bound numbers (gated beats, step 2), in two unrelated subjects: a market
   * (two plots, their crossing as a named readout, a tax as beforeafter), a growing colony (computed
   * bars and a contrast copy beside them, one scale) and a falling object with drag (a limit sweep
   * with a live readout). Every number in the narration is a {{val}}: none is typed.
   */
  moves: {
    src: '/fixtures/econ.pdf',
    question: 'Demonstration moves check',
    script:
      `{{scroll p=1}} Three moves, in three small pictures. ` +
      `{{sketch id=m near=p1}} A market first, {{const tax=0}} with no tax yet. ` +
      `{{plot on=m id=demand fn="12-x/5" domain=0,50 xlabel="quantity" ylabel="price" "demand"}} Buyers want less as the price climbs, ` +
      `{{plot on=m id=supply fn="2+tax+x/10" domain=0,50 axes=demand "supply"}} and sellers offer more. ` +
      `They meet {{find id=E of=demand,supply}} at a price of {{val id=E}}, {{point on=m at=E "E"}} with {{val id=E.x fmt=0}} units sold. ` +
      `{{beforeafter of=supply tax=1.5}} Now tax every unit: supply lifts by the tax, its old place stays as a ghost, ` +
      `and buyers now pay {{val id=E}}. ` +
      `{{sketch id=b near=p1}} Next, a colony of cells {{const rate=0.3 start=10}} that grows by {{val id=rate as=percent}} an hour. ` +
      `{{bars on=b id=pop size=1x6 fn="start*(1+rate)^(c-1)" labels=0,1,2,3,4,5 dp=0 "cells after each hour"}} After five hours there are {{val id=pop[6] fmt=0}}. ` +
      `{{contrast of=pop rate=0.1 "at a third of the rate"}} At a third of that rate, the same five hours give only {{val id=pop_2[6] fmt=0}}. ` +
      `{{sketch id=f near=p1}} Last, a falling stone {{const k=1 g=9.8}} with air drag. ` +
      `{{plot on=f id=v fn="g/k*(1-exp(-k*x))" domain=0,6 xlabel="time (s)" ylabel="speed (m/s)" "speed"}} Its speed climbs {{find id=end of=v x=6}} and levels off near {{val id=end}}. ` +
      `{{limit of=v k=0.05 dur=4 show=end}} Let the drag fade toward nothing, and the curve straightens into free fall: {{val id=end}} after six seconds.`,
  },
  /**
   * Live geometry (src/desk/live.ts): a figure whose points are formulas over constants moves when a
   * {{tween}} changes them, every element built from them following each frame. A tunnel through the
   * Earth: the ball in it keeps pace with the shadow of a satellite on a grazing orbit (foot() of the
   * satellite on the tunnel), so the half trip is half an orbit: a readout computes pi*sqrt(R/g).
   */
  'moving-tunnel': {
    src: '/fixtures/mechanics.pdf',
    question: 'How long does a fall through the Earth take?',
    script:
      `{{scroll p=1}} Drop a ball into a tunnel through the Earth and it falls, races through the centre, and climbs to the far side. ` +
      `{{sketch id=t near=p1 fit}} Picture {{const R=260 th=0 Re=6371000 g=9.8 T=pi*sqrt(Re/g)/60}} the Earth ` +
      `{{let on=t O=0,0 A=-R,0 B=R,0 S=R*cos(th),-R*sin(th) F=foot(S,A,B)}} in section, ` +
      `here {{circle on=t at=O r=R}}, with {{line on=t from=A to=B weight=secondary}} a tunnel straight through {{point on=t at=O "centre" dir=s}} its centre. ` +
      `{{point on=t at=F "ball" dir=s em}} Inside, the pull toward the centre grows with the distance from it, ` +
      `the same pull that keeps a satellite circling just above the ground. ` +
      `{{point on=t at=S "satellite" dir=ne}} So start a satellite at the tunnel's mouth, beside the ball, ` +
      `{{line on=t from=S to=F dash}} and watch its shadow on the tunnel. ` +
      `{{tween th=7*pi/3 dur=14 ease=linear}} Let both go. The satellite sweeps round, its shadow slides along the tunnel, ` +
      `and the ball stays exactly on the shadow, all the way across, and all the way back. ` +
      `{{write on=t at=-260,330 "half trip:" value=T fmt=1 unit=min}} So the trip to the far side is half an orbit: ` +
      `{{val id=T fmt=1}} minutes, the same for any straight tunnel.`,
  },
  /**
   * Live geometry: a spinning skater seen from above. One constant (t) drives everything: the arms'
   * reach r(t) pulls in, the moment of inertia I and the spin rate w = L/I follow (formula constants
   * follow the constants they read), the arm angle is the integral of the spin rate, and the bars
   * (angular momentum, spin energy) are computed from the same constants.
   */
  'moving-skater': {
    src: '/fixtures/mechanics.pdf',
    question: 'Why does a skater spin faster when she pulls her arms in?',
    script:
      `{{scroll p=1}} She spins faster because her spin, the angular momentum, cannot change, while pulling in makes her easier to turn. ` +
      `{{sketch id=k near=p1 fit}} Seen {{const t=0 m=2 Ib=3 L=10 Sc=150 r=1.4-0.9/(1+exp(-2.5*(t-3))) I=Ib+2*m*r^2 w=L/I KE=L*w/2 KE0=L^2/(2*(Ib+2*m*1.4^2)) ph=integral(L/(Ib+2*m*(1.4-0.9/(1+exp(-2.5*(u-3))))^2),u,0,t)}} ` +
      `from {{let on=k O=0,0 H1=Sc*r*cos(ph),Sc*r*sin(ph) H2=-Sc*r*cos(ph),-Sc*r*sin(ph)}} above, ` +
      `{{circle on=k at=O r=40}} here is her body, ` +
      `{{circle on=k at=O r=Sc*1.4 dash}} and the reach of her arms held out. ` +
      `{{line on=k from=O to=H1 weight=secondary}} Her arms {{line on=k from=O to=H2 weight=secondary}} stretch out, ` +
      `{{point on=k at=H1 "hand" dir=e trace}} with her hands {{point on=k at=H2}} far from the axis. ` +
      `{{write on=k at=-210,-265 "spin:" value=w fmt=1 unit=rad/s em}} She turns slowly. ` +
      `{{sketch id=q near=p1}} Her {{bars on=q id=am size=1x2 fn="L" labels=start,now "angular momentum"}} angular momentum is fixed; ` +
      `{{bars on=q id=ke size=1x2 fn="if(c==1,KE0,KE)" labels=start,now right=am op=none "spin energy"}} her spin energy is not. ` +
      `{{tween t=6 dur=7 ease=linear}} Now she pulls her hands in. Each hand comes closer to the axis, so she is easier to turn, ` +
      `and with the same angular momentum the spin rate climbs: her hands trace a tightening spiral as they speed up. ` +
      `The angular momentum bar stays level; the energy bar grows, paid for by the work her arms do pulling in. ` +
      `She ends spinning at {{val id=w fmt=1}} radians a second.`,
  },
  /**
   * Live geometry outside physics: a market whose supply line shifts with a tax. The equilibrium is a
   * meet() of the two lines, so it glides down the demand line (leaving a trace) while the old supply
   * stays as a faint ghost; the price readout is a formula constant that follows the tax.
   */
  'moving-market': {
    src: '/fixtures/econ.pdf',
    question: 'Who pays a tax on sellers?',
    script:
      `{{scroll p=1}} A tax on sellers is shared: the price buyers pay rises, but by less than the tax. ` +
      `{{sketch id=e near=p1 fit}} Picture {{const tax=0 q=(10-tax)/0.3 p=12-q/5}} the market ` +
      `{{let on=e O=0,0 X=520,0 Y=0,-460 D1=0,-420 D2=500,-70 S1=0,-35*(2+tax) S2=500,-35*(7+tax) E=meet(D1,D2,S1,S2)}} on ` +
      `{{arrow on=e from=O to=X weight=secondary}} quantity {{label on=e at=440,30 "quantity"}} and ` +
      `{{arrow on=e from=O to=Y weight=secondary}} price {{label on=e at=12,-470 "price"}} axes. ` +
      `{{line on=e from=D1 to=D2}} Buyers {{label on=e at=along(D1,D2,1.02) "demand"}} want less as the price rises; ` +
      `{{line on=e from=0,-70 to=500,-245 weight=faint dash}} sellers {{line on=e from=S1 to=S2 id=supply}} offer {{label on=e at=along(S1,S2,1.02) "supply"}} more. ` +
      `{{point on=e at=E "E" dir=ne trace em}} They meet here, ` +
      `{{line on=e from=E to=foot(E,O,Y) dash}} at {{line on=e from=E to=foot(E,O,X) dash}} one price and one quantity: ` +
      `{{write on=e at=40,90 "buyers pay:" value=p fmt=2}} buyers pay {{val id=p fmt=2}}. ` +
      `{{tween tax=3 dur=6}} Now tax sellers {{val id=tax}} a unit. Their line lifts by the tax, the old one stays as a ghost, ` +
      `and the meeting point slides up the demand line, ` +
      `ending where buyers pay {{val id=p fmt=2}}: two thirds of the tax, because demand is the steeper line; sellers absorb the rest.`,
  },
  /** Live geometry: a pendulum swinging (a yoyo tween is a true oscillation), its bob tracing its arc. */
  'moving-pendulum': {
    src: '/fixtures/mechanics.pdf',
    question: 'How does a pendulum swing?',
    script:
      `{{scroll p=1}} A pendulum trades height for speed and back, every swing. ` +
      `{{sketch id=p near=p1 fit}} Hang {{const Lp=300 a=0.5}} a bob {{let on=p O=0,0 B=Lp*sin(a),Lp*cos(a) R=0,Lp}} from ` +
      `{{line on=p from=-180,0 to=180,0 weight=secondary}} a beam, {{line on=p from=O to=R dash}} above its lowest point. ` +
      `{{line on=p from=O to=B}} Here is the string, {{point on=p at=B "bob" trace em}} and the bob pulled aside ` +
      `{{angle on=p at=O from=R to=B "θ"}} by an angle theta. ` +
      `{{tween a=-0.5 dur=1.4 repeat=3 yoyo}} Let it go: fastest at the bottom, slowing as it climbs, and back, its bob tracing one arc.`,
  },
  /**
   * Toolkit check (not a teaching demo): every v2 element once, in one board section for the sample
   * deck's page 3, for screenshots and the timing audit. Also every look flag: the three weights
   * (primary default, secondary, faint), dash (faint by default), shade plain / outline / em.
   */
  toolkit: {
    src: '/fixtures/epipolar.pdf',
    question: 'Toolkit check',
    script:
      `{{scroll p=3}} Toolkit check. {{sketch id=kit near=p3 size=m}} A point {{point on=kit at=120,120 "A" id=a}} here, ` +
      `a curve {{curve on=kit pts=200,120 300,60 400,140 500,80 dash}} through four points, ` +
      `a plain shade {{shade on=kit at=640,110 rx=70 ry=45}} under the ink, ` +
      `an outlined {{shade on=kit pts=760,60 940,80 940,190 760,170 outline}} sheet, ` +
      `two {{line on=kit from=80,440 to=380,440}} rays {{line on=kit from=80,440 to=290,250 weight=secondary}} and ` +
      `an accent {{shade on=kit pts=80,440 380,440 290,250 em}} wedge, ` +
      `an angle {{angle on=kit at=80,440 from=380,440 to=290,250 r=90 "θ"}} between them, ` +
      `a faint {{line on=kit from=290,250 to=290,440 weight=faint}} drop, ` +
      `a brace {{brace on=kit from=380,520 to=80,520 "B"}} under a span, ` +
      `axes {{axes on=kit at=560,640 size=380,300 x="depth z" y="disparity" id=ax}} with ` +
      `{{plot on=kit fn="1/x" domain=0.5,5 range=0,2.6 em id=pl}} one over x, ` +
      `math {{math on=kit at=80,665 "x - x' = \\frac{B\\,f}{z}"}} typeset, ` +
      `then {{emph id=a}} emphasis, {{move id=a to=160,200}} a move, {{fade id=a}} a fade, ` +
      `{{label id=pl "1/z" dir=n}} and a label.`,
  },
  /**
   * Board v2 (spec "Board v2: one connected scene"), three subjects, one scene each: things placed
   * by relation (no coordinates), linked to each other and to the page's words, grouped and
   * bracketed, transformed rather than redrawn (split, merge, move, set), a chart only where a
   * quantity is the point, and the whole scene shown at the end.
   */
  scene: {
    src: '/fixtures/mechanics.pdf',
    question: 'Where does the work done on the cart go?',
    script:
      `{{scroll p=12}} Here, {{highlight p=12 "A 3 kg cart from rest, pushed"}} every joule the push does on the cart turns into motion. ` +
      `{{scene id=s near=p12}} Take {{const m=3}} the {{node on=s id=push "push, 20 N"}} push {{node on=s id=cart "cart, 3 kg" right=push}} on the cart: {{link on=s from=push to=cart "does work"}} it does work on it, ` +
      `{{connect from=p12:"W = Fd cos θ" to=s:push}} force times distance, ` +
      `{{bars on=s id=w size=1x5 fn="20*(c-1)*1.5" labels=0,1.5,3,4.5,6 below=cart "work done (J) after x metres"}} so the work climbs steadily as the cart rolls. ` +
      `{{note on=s "20 N × 6 m" annotate=w[5]}} After six metres that is the slide's 120 joules. ` +
      `{{node on=s id=ke "motion, ½mv²" right=w}} With nothing to stop it, {{link on=s from=w[5] to=ke strength=1 "all of it"}} all of it becomes motion. ` +
      `{{bars on=s id=v map=w fn="sqrt(2*x/m)" below=ke "speed (m/s)"}} Solve one half m v squared for the speed {{link on=s from=ke to=v "solve for v"}} and it rises fast at first, {{emph id=v[5]}} then levels. ` +
      `{{connect from=p12:"v = 8.9 m/s" to=s:v[5]}} That end value is the page's answer. ` +
      `{{group on=s id=sys of=cart,ke "the cart"}} Draw a line around the cart: the work comes in from outside and stays inside as motion. ` +
      `{{split id=ke "motion" "heat"}} Put a rough floor under it and that energy splits in two, {{pair on=s from=ke[1] to=ke[2] "still 120 J"}} the same 120 joules, {{note on=s "same work, less speed" below=sys}} so the same push buys less speed.`,
  },
  'scene-econ': {
    src: '/fixtures/econ.pdf',
    question: 'Who actually pays the tax?',
    script:
      `{{scroll p=12}} Here, {{highlight p=12 "Buyers and sellers split the tax"}} neither side pays the whole tax: it drives a wedge between the price buyers pay and the price sellers keep. ` +
      `{{scene id=s near=p12}} On {{node on=s id=buyers "buyers"}} one side are the buyers, {{node on=s id=sellers "sellers" right=buyers}} on the other the sellers; {{link on=s from=buyers to=sellers plain dash "trade at 7"}} before the tax they trade at one price, seven. ` +
      `{{table on=s id=tax cols=t vals=2 below=buyers "tax per unit"}} Now put a tax of two on each unit. ` +
      `That is {{connect from=p12:"t = 2" to=s:tax}} the slide's t. ` +
      `{{bars on=s id=pb map=tax fn="(70+5*x)/10" right=tax "buyers pay"}} Solving the slide's two lines, buyers now pay eight {{bars on=s id=ps map=tax fn="(70+5*x)/10-x" right=pb op=none "sellers keep"}} and sellers keep six. ` +
      `{{pair on=s from=pb to=ps "the wedge: t"}} The gap between the two is the tax. ` +
      `Buyers {{link on=s from=buyers to=pb "pay"}} pay one, sellers {{link on=s from=sellers to=ps "keep"}} keep the other. ` +
      `{{connect from=p12:"Pb = 8, Ps = 6, Q = 20" to=s:pb}} The page's numbers agree. ` +
      `{{shares on=s id=burden size=1x2 fn="(2-c)*((70+5*2)/10-7)+(c-1)*(7-((70+5*2)/10-2))" labels=buyers,sellers below=pb "who bears the tax"}} Against the old seven, the burden splits like this. ` +
      `{{note on=s "equal slopes, equal shares" annotate=burden}} Because the two curves are equally steep, each side carries half. ` +
      `{{set id=tax vals=4}} Double the tax and both prices move apart, {{emph id=burden}} but the split stays the same.`,
  },
  /**
   * The slide is part of the canvas (spec "The slide is part of the canvas"), on three slides of
   * public/fixtures/canvas.pdf: 1 drawing on the slide's own chart in its data units (taxed supply and
   * demand traced as engine plots, their crossing a readout; the tax doubled with beforeafter: the curve
   * lifts, its ghost stays, the readout follows and is said by the engine; a bracket for the tax, the
   * grown lost-trade triangle), with a note by
   * its equation; 2 the slide's enzyme, substrate and inhibitor lifted onto the board and moved to
   * act out the competition for the pocket; 3 notes in place beside a slope slide's equations, and a
   * tangent on its chart.
   */
  canvas: {
    src: '/fixtures/canvas.pdf',
    question: 'Show me on the slides themselves',
    script:
      `{{scroll p=1}} On the slide's own graph, {{highlight p=1 "Buyers and sellers split the tax"}} a tax of two drives a wedge between what buyers pay and what sellers keep. ` +
      `{{const t=2}} Trace the taxed supply {{plot p=1 on=#c1 id=sup fn="2+t+x/5"}} and the demand {{plot p=1 on=#c1 id=dem fn="12-x/5"}} it meets: {{find id=E of=sup,dem}} they cross {{point p=1 on=#c1 at=E "Pb"}} where buyers pay {{val id=E.y}}. ` +
      `{{beforeafter of=sup t=4}} Double the tax to {{val id=t}}: the taxed supply lifts on these same axes, its old place stays as a ghost, and buyers now pay {{val id=E.y}} for {{val id=E.x}} units. ` +
      `{{brace p=1 on=#c1 from=15,9 to=15,5 "t"}} Sellers keep five, so the gap between the two prices is the whole tax. ` +
      `{{shade p=1 on=#c1 pts=15,9 25,7 15,5}} The lost trades now run from fifteen to twenty-five, {{note p=1 "now Q = 15 to 25" annotate="Trades between Q = 20 and 25 vanish"}} so twice the tax loses four times as much. ` +
      `{{scroll p=2}} The enzyme slide is the same kind of story: {{note p=2 "one pocket, two keys" annotate=#g1}} one pocket, and two molecules that fit it. ` +
      `{{sketch id=e near=p2}} Take {{lift p=2 mark=#g1 on=e id=enz at=400,90 w=240}} the slide's own enzyme, ` +
      `{{lift p=2 mark=#b1 on=e id=sub at=120,160 w=81}} its substrate {{lift p=2 mark=#b2 on=e id=inh at=760,160 w=81}} and the inhibitor. ` +
      `{{move id=sub to=439,196}} The substrate slides into the pocket and is turned into product. ` +
      `{{move id=sub to=160,192}} Once it leaves, {{move id=inh to=439,196}} the inhibitor can take the pocket instead, {{write on=e at=380,370 "while I sits here: no product" id=blocked}} and nothing is made while it sits there. ` +
      `{{lift p=2 mark=#b1 on=e id=s2 at=60,330 w=81}} Now flood the enzyme with substrate, {{lift p=2 mark=#b1 on=e id=s3 at=170,330 w=81}} more and more of it: ` +
      `{{move id=inh to=800,192}} the moment the inhibitor lets go {{fade id=blocked}} the pocket is free, {{move id=s2 to=439,196}} and a substrate is there first. ` +
      `{{write on=e at=380,430 "enough S always wins: Vmax unchanged" em}} With enough substrate it nearly always wins, so the top speed does not change. ` +
      `{{scroll p=3}} On the slope slide, {{note p=3 "average from second 1 to 3" annotate=#e1}} this is an average over two seconds, ` +
      `{{line p=3 on=#c1 from=2,3 to=4,15}} while the tangent at three seconds {{point p=3 on=#c1 at=3,9 "t = 3" dir=nw}} has slope six: {{note p=3 "the limit of that average" annotate=#e2}} the exact rate is what the average becomes as the interval shrinks.`,
  },
  'scene-bio': {
    src: '/fixtures/bio.pdf',
    question: 'Why does a competitive inhibitor not change Vmax?',
    script:
      `{{scroll p=4}} Here, {{highlight p=4 "The inhibitor competes for the active site"}} the inhibitor never slows the enzyme's work itself: it only takes turns with the substrate for the same pocket. ` +
      `{{scene id=s near=p4}} Take {{const Vmax=10 Km=2}} the {{node on=s id=enz "active site"}} enzyme's active site. {{node on=s id=sub "substrate S" left=enz}} The substrate {{link on=s from=sub to=enz "binds"}} binds there, ` +
      `{{node on=s id=inh "inhibitor I" below=sub}} and the inhibitor {{link on=s from=inh to=enz dash "blocks"}} fits the same pocket. ` +
      `{{pair on=s from=sub to=inh "one at a time"}} Only one of them can sit in it at a time, {{connect from=p4:"only one at a time" to=s:inh}} as the figure says. ` +
      `{{bars on=s id=v0 size=1x5 fn="Vmax*2^(c-1)/(Km+2^(c-1))" labels=1,2,4,8,16 right=enz "rate v at [S] = 1 … 16"}} Without the inhibitor the rate climbs toward Vmax as substrate rises, ` +
      `{{connect from=p4:"v = Vmax [S] / (Km + [S])" to=s:v0}} the slide's curve. ` +
      `{{bars on=s id=v1 size=1x5 fn="Vmax*2^(c-1)/(2*Km+2^(c-1))" labels=1,2,4,8,16 ghost=v0 below=v0 "with inhibitor, [I]/Ki = 1"}} With the inhibitor, {{link on=s from=inh to=v1 "slows"}} every rate drops, ` +
      `{{note on=s "Km doubles: 2 → 4" annotate=v1[2]}} most at low substrate, because Km doubles. ` +
      `{{move id=v1 right=v0}} Side by side, {{emph id=v1[5]}} at high substrate the two nearly meet: S wins the pocket almost every time, ` +
      `{{connect from=p4:"Vmax is unchanged" to=s:v1[5]}} so Vmax is unchanged. ` +
      `{{merge on=s id=es of=sub,enz "ES, nearly always"}} Flood it with substrate and the enzyme is nearly always holding S.`,
  },
  // Founder live test 2026-10-29 (physics, "why does a spinning skater speed up"): two small kit charts in
  // a scene, labels written as ids. The final board must compose them into the board (centred, sized),
  // not park them in a corner, and show "arms out", never "arms_out".
  'scene-small': {
    src: '/fixtures/mechanics.pdf',
    question: 'Why does a spinning skater speed up when she pulls her arms in?',
    script:
      `{{scroll p=12}} Pulling the arms in changes how the mass is spread, not how much spin there is. ` +
      `{{scene id=sk near=p12}} Take {{const I=4 w=2 I2=2 w2=I*w/I2}} her spin: {{bars on=sk id=L vals=I*w,I2*w2 labels=arms_out,arms_in "angular momentum"}} her angular momentum is the same before and after, since nothing outside twists her. ` +
      `Halve how far the mass sits from the axis and the spin rate doubles to keep it. ` +
      `{{bars on=sk id=K vals=0.5*I*w^2,0.5*I2*w2^2 labels=arms_out,arms_in below=L "rotational energy"}} Her energy of rotation, though, doubles. ` +
      `{{split id=K[2] vals=0.5*I2*w2^2-0.5*I*w^2 "start" "muscle work"}} The extra is the work her muscles do, ` +
      `{{connect from=p12:"with 20 N over 6 m:" to=sk:K[2]}} work done over a distance, as on this slide.`,
  },
  // The prompt's examples (server/prompt/examples.ts) on their own slides.
  // The svg board (the default answer format, p6): the prompt's examples and the experiment's answers.
  ...SVG_DEMOS,
  // Layout C, the anchored lane: the founder-approved mockup answer and session (src/demo/lane.ts).
  ...LANE_SCRIPTS,
  'ex-village': example('coins as marks'),
  'ex-lighthouse': example('made to happen'),
  'ex-counter': example("slide's own chart"),
};

/** live-calc with one professor move added: a magnifier on P where the narration turns to the little triangle. */
SCRIPTS['live-calc-zoom'] = {
  ...SCRIPTS['live-calc'],
  script: SCRIPTS['live-calc'].script.replace('Look at the little triangle.', '{{zoom on=s at=P r=90 scale=3}} Look at the little triangle.'),
};