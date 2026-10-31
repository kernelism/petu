// src/ui/landing/staircase.ts — the hero's lesson: "Why is it divided by 2?" on a slide about
// 1 + 2 + … + n. The staircase is stacked, copied, turned and fitted into a 4 × 5 rectangle; the
// check asks for 1 + … + 10.
import { nibDraw, ringPts, sample, strokeDraw } from './ink';
import { buildTimeline, connect, drop, writeEq, type Ctx, type Lesson } from './stage';

const S = 40, X0 = 50, Y0 = 110;
const MATH = "'STIX Two Text Variable', 'STIX Two Text', serif";

function slideSVG() {
  return `<svg viewBox="0 0 540 405" class="pl-slide-svg" aria-hidden="true"><defs></defs>
  <rect class="pl-hl" x="34" y="126" width="406" height="84" rx="2"/>
  <text x="40" y="64" class="pl-s-title">Sum of the first <tspan font-style="italic" font-family="${MATH}" font-weight="400" font-size="27">n</tspan> integers</text>
  <line x1="40" y1="86" x2="500" y2="86" class="pl-s-rule"/>
  <text x="318" y="178" text-anchor="end" class="pl-s-math">1 + 2 + 3 + ⋯ + <tspan font-style="italic">n</tspan> =</text>
  <text x="372" y="161" text-anchor="middle" class="pl-s-math"><tspan font-style="italic">n</tspan>(<tspan font-style="italic">n</tspan> + 1)</text>
  <line x1="329" y1="170" x2="415" y2="170" stroke="#111" stroke-width="1.3"/>
  <text x="372" y="200" text-anchor="middle" class="pl-s-math">2</text>
  <text x="40" y="262" class="pl-s-body">e.g.&#8195;1 + 2 + 3 + 4 = 10</text>
  <text x="40" y="314" class="pl-s-grey">•&#8194;Holds for every whole number <tspan font-style="italic" font-family="${MATH}" font-size="18">n</tspan> ≥ 1</text>
  <text x="40" y="344" class="pl-s-grey">•&#8194;Proof by induction next week</text>
  <text x="500" y="386" text-anchor="end" class="pl-s-grey" font-size="13">7</text>
  <g class="pl-marks"></g></svg>`;
}

function boardSVG() {
  let o = '', c = '';
  for (let k = 0; k < 4; k++) for (let j = 0; j <= k; j++)
    o += `<rect class="pl-cell pl-o" data-col="${k}" x="${X0 + k * S}" y="${Y0 + 5 * S - (j + 1) * S}" width="${S}" height="${S}"/>`;
  for (let k = 0; k < 4; k++) for (let j = 0; j < 4 - k; j++)
    c += `<rect class="pl-cell pl-c pl-on" x="${X0 + k * S}" y="${Y0 + j * S}" width="${S}" height="${S}"/>`;
  const R = X0 + 4 * S, B = Y0 + 5 * S;
  const tr = `M${X0} ${B}V${B - S}H${X0 + S}V${B - 2 * S}H${X0 + 2 * S}V${B - 3 * S}H${X0 + 3 * S}V${B - 4 * S}H${R}V${B}Z`;
  // the check: 10 x 11 at s=18
  const s2 = 18, cx0 = 130, cy0 = 640; let g2 = '';
  for (let k = 0; k < 10; k++) for (let j = 0; j < 11; j++) {
    const orig = j < k + 1; // bottom-aligned staircase of heights 1..10
    g2 += `<rect class="pl-cell ${orig ? 'pl-o' : 'pl-c'}" data-k="${k}" x="${cx0 + k * s2}" y="${cy0 + 11 * s2 - (j + 1) * s2}" width="${s2}" height="${s2}"/>`;
  }
  const eq = (txt: string, key: number) => [...txt].map((ch, i) => `<tspan class="${i >= key ? 'pl-k' : ''}">${ch === ' ' ? '&#160;' : ch}</tspan>`).join('');
  return `<svg viewBox="0 0 440 560" aria-hidden="true">
  <g class="pl-content">
    <text class="pl-b-title pl-t1" x="220" y="58" text-anchor="middle">A staircase of 1 + 2 + 3 + 4</text>
    <g class="pl-fig">
      <g class="pl-orig">${o}</g>
      <g class="pl-copy">${c}</g>
      <rect class="pl-outl pl-draw" x="${X0}" y="${Y0}" width="${4 * S}" height="${5 * S}" stroke="#17171a" stroke-width="2" style="opacity:0"/>
      <path class="pl-trace" d="${tr}" style="opacity:0"/>
      <path class="pl-dim pl-dimw" d="M${X0} ${B + 16}v8M${X0} ${B + 20}H${R}M${R} ${B + 16}v8" style="opacity:0"/>
      <path class="pl-dim pl-dimh" d="M${R + 16} ${Y0}h8M${R + 20} ${Y0}V${B}M${R + 16} ${B}h8" style="opacity:0"/>
      <text class="pl-b-lab pl-lw" x="${X0 + 2 * S}" y="${B + 46}" text-anchor="middle">4</text>
      <text class="pl-b-lab pl-lh" x="${R + 34}" y="${Y0 + 2.5 * S + 7}">5</text>
    </g>
    <text class="pl-eq pl-e1" x="220" y="452" text-anchor="middle">${eq('4 × 5 ÷ 2 = 10', 11)}</text>
    <text class="pl-b-title pl-t2" x="220" y="604" text-anchor="middle">Test yourself: 1 + 2 + ⋯ + 10</text>
    <g class="pl-g2">${g2}</g>
    <path class="pl-dim pl-d2w" d="M${cx0} ${cy0 + 198 + 14}h180" style="opacity:0"/>
    <path class="pl-dim pl-d2h" d="M${cx0 + 194} ${cy0}v198" style="opacity:0"/>
    <text class="pl-b-lab pl-l2w" x="${cx0 + 90}" y="${cy0 + 198 + 38}" text-anchor="middle">10</text>
    <text class="pl-b-lab pl-l2h" x="${cx0 + 204}" y="${cy0 + 105}">11</text>
    <text class="pl-eq pl-e2" x="220" y="${cy0 + 290}" text-anchor="middle">${eq('10 × 11 ÷ 2 = 55', 13)}</text>
  </g></svg>`;
}

const { tl, mark, all } = buildTimeline(
  'Why is it divided by 2?',
  [
    'Stack the numbers as a [[title]]staircase: [[c1]]1, [[c2]]2, [[c3]]3, [[c4]]4 blocks.',
    '[[copy]]Copy the staircase and turn it [[rot]]upside down.',
    'The two [[fit]]fit together into a [[rect]]rectangle, [[w]]4 wide and [[h]]5 tall.',
    "That's [[n]]n by n + 1 blocks, and your staircase is exactly [[half]]half of it.",
    'So [[eq]]4 × 5 ÷ 2 = 10.',
  ],
  'Test yourself: what is 1 + 2 + ⋯ + 10?',
  '55',
  'Right. A [[g]]10 by 11 rectangle, and you need [[gh]]half: [[ge]]55.',
);

const q = <T extends Element>(s: string, r: ParentNode) => r.querySelector(s) as T;
const qa = <T extends Element>(s: string, r: ParentNode) => Array.from(r.querySelectorAll(s)) as T[];

function swapLabel(ctx: Ctx, t: SVGTextElement, txt: string, instant: boolean) {
  if (instant || ctx.rt.rm) { t.textContent = txt; t.classList.add('pl-i'); return; }
  t.style.transition = 'opacity .25s'; t.style.opacity = '0';
  ctx.rt.later(() => { t.textContent = txt; t.classList.add('pl-i'); t.style.opacity = '1'; }, 260);
}
/** From petu's ring on the slide to the half it explains on the board (first column, after centring). */
export const linkStaircase = (ctx: Ctx, instant: boolean) =>
  connect(ctx, [ctx.story ? 440 : 395, ctx.story ? 168 : 186], [90 + X0 + 0.6 * S, Y0 + 4.4 * S], instant);

function cue(ctx: Ctx, c: string, instant: boolean) {
  const B = ctx.board, rt = ctx.rt;
  const on = (sel: string) => qa(sel, B).forEach((e) => e.classList.add('pl-on-op'));
  const fig = q<SVGGElement>('.pl-fig', B);
  switch (c) {
    case 'hl': q('.pl-hl', ctx.slide).classList.add('pl-on'); break;
    case 'ring':
      if (!ctx.story) nibDraw(rt, ctx.slide, ctx.marks, ringPts(372, 191, 21, 19), { w: 3.6, min: 1 }, instant, 720);
      else nibDraw(rt, ctx.slide, ctx.marks, sample((t) => [44 + t * 396, 214 + Math.sin(t * 3.1) * 1.2 + t * 1.5], 80), { w: 3.2, min: 1.1, ang: .4, tin: .03, tout: .1 }, instant, 750);
      break;
    case 'title': on('.pl-t1'); break;
    case 'c1': case 'c2': case 'c3': case 'c4': {
      const k = +c[1] - 1; qa(`.pl-orig .pl-cell[data-col="${k}"]`, B).forEach((e, i) => drop(ctx, e, instant, i * 95)); break; }
    case 'copy': q('.pl-copy', B).classList.add('pl-show'); break;
    case 'rot': q('.pl-copy', B).classList.add('pl-rot'); break;
    case 'fit': q('.pl-copy', B).classList.add('pl-fit'); fig.classList.add('pl-center'); break;
    case 'rect': strokeDraw(rt, q('.pl-outl', B), instant, 700, 450); break;
    case 'w': strokeDraw(rt, q('.pl-dimw', B), instant, 400); on('.pl-lw'); break;
    case 'h': strokeDraw(rt, q('.pl-dimh', B), instant, 400); on('.pl-lh'); break;
    case 'n': swapLabel(ctx, q('.pl-lw', B), 'n = 4', instant); swapLabel(ctx, q('.pl-lh', B), 'n + 1 = 5', instant); break;
    case 'half': fig.classList.add('pl-half'); strokeDraw(rt, q('.pl-trace', B), instant, 900); linkStaircase(ctx, instant); break;
    case 'eq': writeEq(ctx, q('.pl-e1', B), instant); break;
    case 'scroll': q<SVGGElement>('.pl-content', B).style.transform = 'translateY(-400px)'; on('.pl-t2'); if (ctx.conn) { ctx.conn.remove(); ctx.conn = null; } break;
    case 'g': qa<SVGRectElement>('.pl-g2 .pl-cell', B).forEach((e, i) => drop(ctx, e, instant, (Number(e.dataset.k) * 11 + (i % 11)) * 6 % 600)); break;
    case 'gh': q('.pl-g2', B).classList.add('pl-half');
      strokeDraw(rt, q('.pl-d2w', B), instant, 400); strokeDraw(rt, q('.pl-d2h', B), instant, 400); on('.pl-l2w'); on('.pl-l2h'); break;
    case 'ge': writeEq(ctx, q('.pl-e2', B), instant); break;
  }
}

export const staircase: Lesson = {
  slideSVG, boardSVG, all, tl, mark, cue,
  studentCircle: (ctx, instant) => nibDraw(ctx.rt, ctx.slide, ctx.marks, ringPts(372, 190, 30, 27, -2.2, 1.08, .05), { w: 1.9, min: 1.2, graphite: true }, instant, 650),
  pageRect: [34, 40, 406, 220],
  relink: (ctx) => linkStaircase(ctx, true),
};
