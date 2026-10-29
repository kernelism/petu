// server/prompt/variants/exdemos.ts — E1 (live-vs-demo-boards.md §8.1): the prompt's examples replaced by
// four hand-authored gallery demos, and the three "keep it small" sentences deleted. Nothing else changes.
/**
 * The demos (src/demo/scripts.ts) are chosen so that none shares a topic with the bench questions
 * (tunnel, gravity inside, skater/rotation, price ceiling/rent, sample means, derivative of sine):
 * scene-bio (competitive inhibition, bio.pdf p4), relational (epipolar line, epipolar.pdf p3), and two
 * sections of the kit demo (convolution edge; SSD vs correlation). moving-pendulum (an oscillation, the
 * tunnel's physics) and moving-market (supply and demand, the rent question's graph) are left out.
 * Listings: bio/epipolar are exactly what scripts/ground.ts prints for the fixtures; the kit demo runs
 * on an unrelated fixture page, so its two pages are invented (like the default examples' pages).
 * Scripts are the demos' own, verbatim, except: the kit sections open by pointing at their invented
 * page, and "Now two patches" reads "Take two patches".
 */
import type { Example } from '../examples.ts';
import { edit, type Parts } from './index.ts';

export const DEMO_EXAMPLES: Example[] = [
  {
    title: 'scene-bio: a mechanism as a scene, two cases on one scale, a move, a merge',
    question: 'Why does a competitive inhibitor not change Vmax?',
    page: 4,
    pages: [4],
    plan: 'The student thinks an inhibitor slows the enzyme itself. Picture: substrate and inhibitor taking turns for one pocket, and the rates with and without it. Beats: 1 one pocket, one at a time (4); 2 the rate climbs toward Vmax; 3 with the inhibitor every rate drops, Km doubles; 4 at high substrate the two meet: Vmax unchanged. Scope: narrow.',
    listing: String.raw`PAGE 4 (visible; page; image attached)
t1 59 50–391: Competitive inhibition
t2 153 50–409: The inhibitor competes for the active site
t3 203 50–226: Vmax is unchanged
t4 253 50–247: Km rises by (1 + [I]/Ki)
t5 322 50–291: v = Vmax [S] / (Km + [S])
t6 380 50–290: Vmax = 10, Km = 2, [I]/Ki = 1
t7 576 61–74: S
t8 572 210–225: E
t9 712 50–265: S and I bind the same pocket:
t10 744 50–178: only one at a time
t11 155 493–501: v
t12 290 473–489: 10
t13 320 748–824: no inhibitor
t14 421 760–849: with inhibitor
t15 506 481–489: 5
t16 576 328–333: I
t17 718 923–944 math: [S]
t18 747 536–544: 2
t19 747 576–584: 4
t20 747 692–708: 10
t21 747 792–808: 15
t22 747 892–908: 20
t23 853 500–737: apparent Km = 2 x (1 + 1) = 4
t24 926 938–947: 4
#a1 arrow 305,643→189,606 "E"
#a2 arrow 500,732→910,732 "2 4 10 15 20"
#a3 arrow 500,732→500,201 "v 10 5"
#b1 box 50,568 38×43 "S"
#b2 box 313,568 38×43 "I"
#g1 figure 138,518 113×143 "E"
#g2 figure 500,340 400×392 (2 paths) "with inhibitor"
#d1 dot 540,516
#d2 dot 580,516
#a4 arrow 100,643→125,610
#s1 line 500,301→900,301
#s2 line #d1→540,732
#s3 line #d1→500,516
#s4 line #d2→580,732`,
    script: String.raw`{{scroll p=4}} Here, {{highlight p=4 "The inhibitor competes for the active site"}} the inhibitor never slows the enzyme's work itself: it only takes turns with the substrate for the same pocket. {{scene id=s near=p4}} Take {{const Vmax=10 Km=2}} the {{node on=s id=enz "active site"}} enzyme's active site. {{node on=s id=sub "substrate S" left=enz}} The substrate {{link on=s from=sub to=enz "binds"}} binds there, {{node on=s id=inh "inhibitor I" below=sub}} and the inhibitor {{link on=s from=inh to=enz dash "blocks"}} fits the same pocket. {{pair on=s from=sub to=inh "one at a time"}} Only one of them can sit in it at a time, {{connect from=p4:"only one at a time" to=s:inh}} as the figure says. {{bars on=s id=v0 size=1x5 fn="Vmax*2^(c-1)/(Km+2^(c-1))" labels=1,2,4,8,16 right=enz "rate v at [S] = 1 … 16"}} Without the inhibitor the rate climbs toward Vmax as substrate rises, {{connect from=p4:"v = Vmax [S] / (Km + [S])" to=s:v0}} the slide's curve. {{bars on=s id=v1 size=1x5 fn="Vmax*2^(c-1)/(2*Km+2^(c-1))" labels=1,2,4,8,16 ghost=v0 below=v0 "with inhibitor, [I]/Ki = 1"}} With the inhibitor, {{link on=s from=inh to=v1 "slows"}} every rate drops, {{note on=s "Km doubles: 2 → 4" annotate=v1[2]}} most at low substrate, because Km doubles. {{move id=v1 right=v0}} Side by side, {{emph id=v1[5]}} at high substrate the two nearly meet: S wins the pocket almost every time, {{connect from=p4:"Vmax is unchanged" to=s:v1[5]}} so Vmax is unchanged. {{merge on=s id=es of=sub,enz "ES, nearly always"}} Flood it with substrate and the enzyme is nearly always holding S.`,
  },
  {
    title: 'relational: an exact construction from the page\'s own figure, every part labelled and tied to the page',
    question: 'Why must the match lie on a line?',
    page: 3,
    pages: [3],
    plan: 'x back-projects to a ray; every depth on that ray lands on one line in image 2. Picture: the two cameras from above, the ray through x, a near and a far point on it. Beats: 1 the ray through x; 2 a near and a far point both land on x; 3 camera C′ sees them apart, all on one line; 4 so the search is one-dimensional. Scope: narrow.',
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
    script: String.raw`{{scroll p=3}} This {{circle p=3 mark=#d3 em}} point x could have come from anywhere along one ray, so its match can only be on a line. {{sketch id=s near=p3 size=m fit}} Seen {{let on=s C=0,0 C'=600,0 X=150,-350 X2=along(C,X,2.4) L1=-150,-120 L2=150,-120 R1=380,-120 R2=750,-120}} from above, {{point on=s at=C "C" dir=s}} camera C {{line on=s from=L1 to=L2 weight=secondary}} looks through image 1. {{line on=s from=C through=X dash id=ray}} Its ray through x runs out into the scene, {{point on=s at=meet(C,X,L1,L2) "x" dir=w id=x}} crossing image 1 at x. {{connect from=p3:#d3 to=s:x}} That is the page's x. A near point {{point on=s at=X "X" dir=e}} here and a far one {{point on=s at=X2 "X2" dir=e id=X2}} there both land on x. Now {{point on=s at=C' "C′" dir=s}} camera C′, {{line on=s from=R1 to=R2 weight=secondary}} with image 2, sees them apart: {{line on=s from=C' to=X weight=faint}} the near one {{point on=s at=meet(C',X,R1,R2) "x′" dir=n}} here, {{line on=s from=C' to=X2 weight=faint}} the far one {{point on=s at=meet(C',X2,R1,R2) "x2′" dir=n}} there. {{line on=s from=meet(C',X,R1,R2) to=meet(C',X2,R1,R2) em}} Every depth lands on this one line in image 2: {{circle p=3 mark=#d1}} that is why, {{circle p=3 mark=#d2}} for this pair of cameras, the search is one-dimensional.`,
  },
  {
    title: 'kit (convolution): the input, the operation and the output side by side; the first cells stepped, the rest swept',
    question: 'How does this kernel find the edge?',
    page: 1,
    pages: [1],
    plan: 'The kernel subtracts the left column from the right, so flat brightness gives zero and a change gives a big sum. Picture: a patch with an edge, the kernel, the output filled cell by cell. Beats: 1 patch and kernel; 2 the first window gives zero; 3 one step right the sum jumps; 4 sweep: only the edge lights up. Scope: narrow.',
    listing: String.raw`PAGE 1 (visible; 16:9 slide; image attached)
t1 60 40–560: Finding edges by convolution
t2 170 40–900: Slide a small kernel over the image; at each position, multiply and add.
t3 205 40–820: A kernel that weighs the right column against the left responds to edges.
#g1 figure 520,320 420×380 "image"`,
    script: String.raw`{{highlight p=1 "multiply and add"}} The kernel subtracts the left of each window from the right, so it gives zero on flat brightness and a large sum only where brightness changes. {{sketch id=f near=p1}} Take a patch {{grid on=f id=img vals=10,10,10,90,90,90;10,10,10,90,90,90;10,10,10,90,90,90;10,10,10,90,90,90;10,10,10,90,90,90 shade "image patch"}} with a dark-to-bright edge down its middle. The kernel {{grid on=f id=k vals=-1,0,1;-1,0,1;-1,0,1 right=img op=⊛ "kernel"}} weighs the right column against the left. {{grid on=f id=o over=img slide=k right=k op== "output"}} The output starts empty. {{step id=o[1,1]}} Put the kernel on the first patch and multiply and add: all one brightness, so zero. {{step id=o[1,2]}} Slide one column: now the right column sees the bright side, and the sum jumps. {{sweep id=o dur=5}} Sweep the rest, and the output is large only where the brightness changes. {{emph id=o[1:3,2:3]}} That band is the edge.`,
  },
  {
    title: 'kit (matching): two measures on the same two cases, then one input changed and what follows and what stays put',
    question: 'Why match patches by correlation instead of the sum of squared differences?',
    page: 1,
    pages: [1],
    plan: 'Lighting changes brightness and contrast, not the pattern; correlation removes both, SSD does not. Picture: two patches as bars, their SSD, the normalized bars and their correlation; then brighten one. Beats: 1 two patches, SSD small; 2 normalized, identical, correlation one; 3 brighten v: SSD explodes, the normalized shapes stay. Scope: narrow.',
    listing: String.raw`PAGE 1 (visible; 16:9 slide; image attached)
t1 60 40–560: Matching patches
t2 170 40–900: SSD adds up the squared differences between two patches, pixel by pixel.
t3 205 40–900: Normalized correlation first subtracts each patch's mean and divides by its spread.
t4 240 40–700: Lighting changes brightness and contrast, not the pattern.`,
    script: String.raw`{{highlight p=1 "subtracts each patch's mean and divides by its spread"}} Lighting changes brightness and contrast, and correlation removes both before it compares; the squared differences don't. {{sketch id=b near=p1}} Take two patches as vectors: {{bars on=b id=u vals=2,4,3,5 labels=1,2,3,4}} u, {{bars on=b id=v vals=3,5,4,6 labels=1,2,3,4 right=u}} and v, the same pattern one step brighter. {{calc on=b of=u,v fn="(x-y)^2" reduce=sum "SSD"}} Their sum of squared differences is small. {{bars on=b id=nu map=u fn="(x-mean)/std" below=u "(u − mean) / std"}} Subtract each mean and divide by the spread, {{bars on=b id=nv map=v fn="(x-mean)/std" right=nu "(v − mean) / std"}} and the two shapes are identical, {{calc on=b of=nu,nv reduce=cos "ρ"}} so their correlation is one. {{set id=v fn="2*x+3"}} Now make v brighter and higher in contrast: {{emph id=v}} the bars jump, the squared differences explode, but the normalized shapes do not move.`,
  },
];

/** E1: the demo examples; "Say less…", the beat word budget and "rather than adding beside it" deleted. */
export function exdemos(base: Parts): Parts {
  let s = base.sections;
  s = edit(s, ' rather than adding beside it', '');
  s = edit(s, 'Say less and let the board carry it. ', '');
  s = edit(s, "The PLAN's beats are your budget (the STORYBOARD's, when there is one): take them in order, one paragraph of 40–70 spoken words each. ", '');
  return { ...base, sections: s, examples: DEMO_EXAMPLES };
}
