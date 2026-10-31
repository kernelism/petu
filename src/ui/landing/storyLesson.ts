// src/ui/landing/storyLesson.ts — the lesson the "One question, start to finish." story slows down:
// projectile motion. "Why do they land at the same time?" A dropped ball and one thrown sideways are
// drawn tick by tick at the same drop (1, 4, 9, 16), so they land together; the check throws it twice
// as fast.
import { nibDraw, poly, ringPts, sample, strokeDraw } from './ink';
import { buildTimeline, drop, writeEq, type Ctx, type Lesson } from './stage';

const MATH = "'STIX Two Text Variable', 'STIX Two Text', serif";
const PG = { y0: 80, c: 21, x0: 80, dx: 62, ground: 423 };
const pY = (t: number) => PG.y0 + PG.c * t * t, pX = (t: number) => PG.x0 + PG.dx * t;

function slideSVG() {
  return `<svg viewBox="0 0 540 405" class="pl-slide-svg" aria-hidden="true"><defs></defs>
  <rect class="pl-hl" x="28" y="200" width="196" height="52" rx="2"/>
  <text x="40" y="64" class="pl-s-title">Projectile motion</text>
  <line x1="40" y1="86" x2="500" y2="86" class="pl-s-rule"/>
  <text x="40" y="128" class="pl-s-body">Drop one ball and throw</text>
  <text x="40" y="152" class="pl-s-body">another sideways from</text>
  <text x="40" y="176" class="pl-s-body">the same height.</text>
  <text x="44" y="238" class="pl-s-math" font-size="34"><tspan font-style="italic">y</tspan> = ½ <tspan font-style="italic">g t</tspan>²</text>
  <text x="40" y="294" class="pl-s-grey">where <tspan font-style="italic" font-family="${MATH}" font-size="18">y</tspan> is the drop after time <tspan font-style="italic" font-family="${MATH}" font-size="18">t</tspan>,</text>
  <text x="40" y="318" class="pl-s-grey">for either ball</text>
  <path d="M326 128H392V360" fill="none" stroke="#111" stroke-width="1.3"/>
  <path d="M392 360H512" fill="none" stroke="#111" stroke-width="1.3"/>
  <path d="M398 368l-8 8M418 368l-8 8M438 368l-8 8M458 368l-8 8M478 368l-8 8M498 368l-8 8M512 364l-12 12" stroke="#999" stroke-width="1"/>
  <circle cx="372" cy="121" r="7" fill="#fff" stroke="#111" stroke-width="1.3"/>
  <circle cx="404" cy="121" r="7" fill="#fff" stroke="#111" stroke-width="1.3"/>
  <path d="M360 104h30" stroke="#111" stroke-width="1.2"/><path d="M385 100l6 4-6 4" fill="none" stroke="#111" stroke-width="1.2"/>
  <path d="M404 134V350" stroke="#888" stroke-width="1" stroke-dasharray="3 4"/>
  <path d="M372 121Q470 121 488 352" fill="none" stroke="#888" stroke-width="1" stroke-dasharray="3 4"/>
  <text x="500" y="386" text-anchor="end" class="pl-s-grey" font-size="13">12</text>
  <g class="pl-marks"></g></svg>`;
}

function boardSVG() {
  const ball = (x: number, y: number, cls: string, extra = '') => `<circle class="pl-cell ${cls}" cx="${x}" cy="${y}" r="7" ${extra}/>`;
  let drops = '', thrown = '', lv = '', nums = '';
  const N = ['', '1', '4', '9', '16'];
  for (let t = 0; t <= 4; t++) {
    drops += ball(PG.x0, pY(t), 'pl-bd', `data-t="${t}"`);
    if (t) thrown += ball(pX(t), pY(t), 'pl-bt', `data-t="${t}"`);
    if (t) lv += `<g class="pl-fade pl-lv" data-t="${t}"><path d="M${PG.x0 + 12} ${pY(t)}H${pX(t) - 12}" stroke="#8d8d92" stroke-width="1" stroke-dasharray="3 4"/>
      <text class="pl-b-tick" x="${pX(4) + 30}" y="${pY(t) + 5}">t = ${t}</text></g>`;
    if (t) nums += `<text class="pl-b-lab pl-num" data-t="${t}" x="${PG.x0 - 20}" y="${pY(t) + 6}" text-anchor="end">${N[t]}</text>`;
  }
  let dp = ''; for (let t = 0; t <= 4; t++) dp += `M${pX(t)} ${PG.ground + 22}v10`;
  const dims = `<path class="pl-dim pl-steps-dim" d="${dp}M${pX(0)} ${PG.ground + 27}H${pX(4)}" style="opacity:0"/>`;
  const arc = poly(sample((u) => [pX(4 * u), pY(4 * u)], 60));
  // check: twice as fast, at a smaller scale
  const Q0 = { y0: 570, c: 12, x0: 50, dx: 40, ground: 771 };
  const qY = (t: number) => Q0.y0 + Q0.c * t * t;
  let slow = '', fast = '', lv2 = '';
  for (let t = 0; t <= 4; t++) {
    slow += `<circle class="pl-cell pl-bs" data-t="${t}" cx="${Q0.x0 + Q0.dx * t}" cy="${qY(t)}" r="7"/>`;
    if (t) fast += `<circle class="pl-cell pl-bt" data-t="${t}" cx="${Q0.x0 + 2 * Q0.dx * t}" cy="${qY(t)}" r="7"/>`;
    if (t) lv2 += `<path class="pl-fade pl-lv2" data-t="${t}" d="M${Q0.x0 + Q0.dx * t + 10} ${qY(t)}H${Q0.x0 + 2 * Q0.dx * t - 10}" stroke="#8d8d92" stroke-width="1" stroke-dasharray="3 4"/>`;
  }
  const arcS = poly(sample((u) => [Q0.x0 + Q0.dx * 4 * u, qY(4 * u)], 50));
  const arcF = poly(sample((u) => [Q0.x0 + 2 * Q0.dx * 4 * u, qY(4 * u)], 50));
  const eq = (txt: string, key: number) => [...txt].map((ch, i) => `<tspan class="${i >= key ? 'pl-k' : ''}">${ch === ' ' ? '&#160;' : ch}</tspan>`).join('');
  return `<svg viewBox="0 0 440 560" aria-hidden="true"><defs></defs>
  <g class="pl-content">
    <text class="pl-b-title pl-t1" x="220" y="50" text-anchor="middle">Dropped and thrown, tick by tick</text>
    <g class="pl-fade pl-scene"><path d="M22 ${PG.y0 + 7}H${PG.x0 + 8}" stroke="#17171a" stroke-width="1.4"/>
    <path d="M62 ${PG.ground}H418" stroke="#17171a" stroke-width="1.4"/>
    <path d="${Array.from({ length: 20 }, (_, i) => `M${70 + i * 18} ${PG.ground + 2}l-8 8`).join('')}" stroke="#a5a5a8" stroke-width="1"/></g>
    ${lv}
    <path class="pl-draw pl-arc" d="${arc}" stroke="var(--ink)" stroke-width="1.3" style="opacity:0"/>
    ${dims}
    ${nums}
    <g class="pl-drops">${drops}</g>
    <g class="pl-thrown">${thrown}</g>
    <path class="pl-draw pl-landline" d="M${PG.x0 - 16} ${PG.ground}H${pX(4) + 16}" stroke="var(--ink)" stroke-width="3" style="opacity:0"/>
    <text class="pl-eq pl-e1" x="220" y="500" text-anchor="middle" font-size="25">${eq('both land at tick 4', 13)}</text>
    <text class="pl-b-title pl-t2" x="220" y="536" text-anchor="middle">Twice as fast</text>
    <path d="M22 ${Q0.y0 + 7}H${Q0.x0 + 8}" stroke="#17171a" stroke-width="1.4"/>
    <path d="M22 ${Q0.ground}H418" stroke="#17171a" stroke-width="1.4"/>
    <path d="${Array.from({ length: 20 }, (_, i) => `M${30 + i * 20} ${Q0.ground + 2}l-8 8`).join('')}" stroke="#a5a5a8" stroke-width="1"/>
    ${lv2}
    <path class="pl-draw pl-arcS" d="${arcS}" stroke="#9a9a9e" stroke-width="1.1" style="opacity:0"/>
    <path class="pl-draw pl-arcF" d="${arcF}" stroke="var(--ink)" stroke-width="1.3" style="opacity:0"/>
    <g class="pl-slow">${slow}</g><g class="pl-fast">${fast}</g>
    <path class="pl-draw pl-landline2" d="M${Q0.x0 - 14} ${Q0.ground}H${Q0.x0 + 8 * Q0.dx + 14}" stroke="var(--ink)" stroke-width="3" style="opacity:0"/>
    <text class="pl-eq pl-e2" x="220" y="${Q0.ground + 48}" text-anchor="middle" font-size="25">${eq('same drop, still tick 4', 17)}</text>
  </g></svg>`;
}

const q = <T extends Element>(s: string, r: ParentNode) => r.querySelector(s) as T;
const qa = <T extends Element>(s: string, r: ParentNode) => Array.from(r.querySelectorAll(s)) as T[];

function stagger(ctx: Ctx, els: Element[], instant: boolean, gap: number) {
  els.forEach((g, i) => {
    if (instant || ctx.rt.rm) g.classList.add('pl-on-op');
    else ctx.timers.push(ctx.rt.later(() => g.classList.add('pl-on-op'), i * gap));
  });
}

function cue(ctx: Ctx, c: string, instant: boolean) {
  const B = ctx.board, rt = ctx.rt;
  const on = (sel: string) => qa(sel, B).forEach((e) => e.classList.add('pl-on-op'));
  const at = (sel: string, t: number) => q(`${sel}[data-t="${t}"]`, B);
  const ticks = (sel: string) => [1, 2, 3, 4].map((t) => at(sel, t));
  switch (c) {
    case 'hl': q('.pl-hl', ctx.slide).classList.add('pl-on'); break;
    case 'ring': nibDraw(rt, ctx.slide, ctx.marks, sample((t) => [40 + t * 182, 262 + Math.sin(t * 3.1) * 1.1 + t * 1.2], 70), { w: 3.2, min: 1.1, ang: .4, tin: .03, tout: .12 }, instant, 650); break;
    case 'drop': on('.pl-t1'); on('.pl-scene'); drop(ctx, at('.pl-bd', 0), instant, 0); break;
    case 'd1': case 'd2': case 'd3': case 'd4': { const t = +c[1]; drop(ctx, at('.pl-bd', t), instant, 0); on(`.pl-num[data-t="${t}"]`); break; }
    case 'thr': ticks('.pl-bt').forEach((e, i) => drop(ctx, e, instant, i * 140)); break;
    case 'lv': stagger(ctx, ticks('.pl-lv'), instant, 160); break;
    case 'sx': strokeDraw(rt, q('.pl-steps-dim', B), instant, 600); break;
    case 'arc': strokeDraw(rt, q('.pl-arc', B), instant, 900); break;
    case 'land': strokeDraw(rt, q('.pl-landline', B), instant, 500); break;
    case 't4': writeEq(ctx, q('.pl-e1', B), instant); break;
    case 'scroll': q<SVGGElement>('.pl-content', B).style.transform = 'translateY(-460px)'; on('.pl-t2'); break;
    case 'f1':
      qa('.pl-slow .pl-cell', B).forEach((e, i) => drop(ctx, e, instant, i * 70));
      qa('.pl-fast .pl-cell', B).forEach((e, i) => drop(ctx, e, instant, 380 + i * 140));
      strokeDraw(rt, q('.pl-arcS', B), instant, 600); strokeDraw(rt, q('.pl-arcF', B), instant, 900, 300); break;
    case 'f2': stagger(ctx, ticks('.pl-lv2'), instant, 150); break;
    case 'f3': strokeDraw(rt, q('.pl-landline2', B), instant, 500); writeEq(ctx, q('.pl-e2', B), instant); break;
  }
}

const { tl, mark, all } = buildTimeline(
  'Why do they land at the same time?',
  [
    'Tick by tick, the [[drop]]dropped ball has fallen [[d1]]1, [[d2]]4, [[d3]]9 and [[d4]]16.',
    'The [[thr]]thrown ball is at the [[same]]same [[same2]]drop at [[lv]]every tick.',
    'Sideways it moves an [[sx]]even step, which never changes how fast it [[arc]]falls.',
    'So they [[land]]both land at [[t4]]tick [[t4b]]4.',
  ],
  'Test yourself: throw it twice as fast. Which lands first?',
  'Same time',
  'Right. Twice as [[f1]]far each tick, the [[f2]]same [[f2b]]drop, so it still lands at [[f3]]tick [[f3b]]4.',
  2,
);

export const storyLesson: Lesson = {
  slideSVG, boardSVG, all, tl, mark, cue,
  studentCircle: (ctx, instant) => nibDraw(ctx.rt, ctx.slide, ctx.marks, ringPts(126, 226, 104, 34, -2.4, 1.07, .05), { w: 1.9, min: 1.2, graphite: true }, instant, 650),
  pageRect: [24, 186, 300, 140],
  relink: () => {},
};
