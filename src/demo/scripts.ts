// src/demo/scripts.ts
import type { Demo } from './demoScript';

/**
 * Dev-only named scripts for real PDFs: `?script=<name>` (optionally `&src=<pdf url>`) opens the
 * PDF and plays the script. Anchored quotes are written against the PDF's actual text runs.
 * public/dev/ is git-ignored: the lecture PDFs are the user's course files and are never committed.
 */
export const SCRIPTS: Record<string, Demo & { src: string }> = {
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
   * Visual kit v1 check (spec "Visual kit v1"), no API call: six board sections, half of them outside
   * computer science, every number computed by the engine. 1 a window sliding over a patch with an
   * edge (live calc line, output filling); 2 two vectors as bars, a brightness change, a raw distance
   * that grows and a normalized score that doesn't; 3 data with outliers, two candidate lines, a band
   * and a live count; 4 a demand table whose elasticity column fills row by row, with a reference
   * line; 5 a thrown ball: a table filling heights and speeds, points and bars following it; 6 two
   * dice: a 6×6 grid of sums, the cells of one sum counted.
   */
  kit: {
    src: '/fixtures/econ.pdf',
    question: 'Visual kit check',
    script:
      `{{scroll p=1}} Six small lessons, drawn by the engine. ` +
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
      `{{emph id=s where="x==7"}} A seven runs corner to corner: {{calc on=p of=s fn="x==7" reduce=count below=s "P(sum = 7)"}} six cells, the most of any sum.`,
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
};
