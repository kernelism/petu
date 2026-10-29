// src/demo/scripts.ts
import type { Demo } from './demoScript';

/**
 * Dev-only named scripts for real PDFs: `?script=<name>` (optionally `&src=<pdf url>`) opens the
 * PDF and plays the script. Anchored quotes are written against the PDF's actual text runs.
 * public/dev/ is git-ignored: the lecture PDFs are the user's course files and are never committed.
 */
export const SCRIPTS: Record<string, Demo & { src: string; page?: number; deeper?: string }> = {
  /**
   * Flow across the document (econ.pdf, asked on p9): a lead-in on p9, a journey to p2 (the demand
   * line's equation) and back. Exercises the route chip, the arrival beat, answer parts (three:
   * p9 · The Law of Demand · Back to p9), "Back to p9", and highlight units: "slope is constant"
   * grows to its sentence, "a higher price" to its two-line bullet, "P/Q is not" stays inside its
   * sentence. `page` is where the question is asked; `deeper` plays in the go-deeper inset.
   */
  flow: {
    src: '/fixtures/econ.pdf',
    page: 9,
    question: 'Why does elasticity change along a straight demand line?',
    deeper: 'Take two points on the line. At a price of 10, a one dollar cut is a ten percent cut, and the five extra units are a fifty percent rise on ten. ' +
      'At a price of 2, the same dollar is half the price, and five more units on fifty is only ten percent. Same step, very different percentages.',
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
   * Visual kit v1 check (spec "Visual kit v1"), no API call: six board sections, half of them outside
   * computer science, every number computed by the engine. 1 a window sliding over a patch with an
   * edge (live calc line, output filling); 2 two vectors as bars, a brightness change, a raw distance
   * that grows and a normalized score that doesn't; 3 data with outliers, two candidate lines, a band
   * and a live count; 4 a demand table whose elasticity column fills row by row, with a reference
   * line; 5 a thrown ball: a table filling heights and speeds, points and bars following it; 6 two
   * dice: a 6×6 grid of sums, the cells of one sum counted; 7 at scale: a noisy 24×24 image (view=image,
   * seeded noise) smoothed by a 1/9 mean kernel into an output image; 8 a cooling cup: noisy readings as a
   * line, their running average on the same axes, and the law plotted from named constants.
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
      `{{plot on=c id=law fn="room+(hot-room)*exp(-k*x)" domain=0,40 axes=temp "the law" em}} The cooling law runs right through it.`,
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
};
