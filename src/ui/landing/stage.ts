// src/ui/landing/stage.ts — the app-shaped lesson stage (slide, caption dock, board, connector overlay)
// and the one timeline that plays a lesson on it: the student types, petu marks the page, then speaks
// sentence by sentence with every board cue on its word. A Lesson supplies the slide, the board, the
// words and what each cue does; the hero and the story each run one.
import { Runtime, el, nibDraw, strokeDraw, type Pt } from './ink';

export type Ev = { t: number; f: 'studentCircle' | 'type' | 'submit' | 'cue' | 'sent' | 'word' | 'ask2' | 'submit2'; s?: string; i?: number; j?: number; c?: string; story?: boolean };
export type Seg = 'ask' | 'page' | 'words' | 'board' | 'check';
export type Marks = Record<Seg | 'heroEnd' | 'end', number>;

export interface Ctx {
  rt: Runtime;
  lesson: Lesson;
  host: HTMLElement;
  st: HTMLElement;
  slide: SVGSVGElement;
  marks: SVGGElement;
  board: SVGSVGElement;
  dock: HTMLElement;
  q: HTMLElement;
  cap: HTMLElement;
  input: HTMLElement;
  overlay: SVGSVGElement;
  timers: number[];
  conn: SVGGElement | null;
  story: boolean;
  scale: number;
  onBuild?: () => void;
  tf?: string;
}

export interface Lesson {
  slideSVG(): string;
  boardSVG(): string;
  /** Every spoken sentence (answer, then the check's reply), with [[cue]] markers. */
  all: string[];
  tl: Ev[];
  mark: Marks;
  cue(ctx: Ctx, c: string, instant: boolean): void;
  /** The story's student circle on the slide (the hero starts from the typed question). */
  studentCircle(ctx: Ctx, instant: boolean): void;
  /** The story camera's "page" framing, in slide viewBox units. */
  pageRect: [number, number, number, number];
  /** Redraw the slide-to-board connector at once (after a resize). */
  relink(ctx: Ctx): void;
}

export const tok = (s: string) => s.split(' ').map((x) => { const m = x.match(/^\[\[(\w+)\]\](.*)$/); return m ? { w: m[2], cue: m[1] } : { w: x, cue: undefined }; });
const wdur = (w: string) => 175 + w.length * 17 + (/[,:]$/.test(w) ? 140 : 0) + (/[.?]$/.test(w) ? 300 : 0);

/** The lesson's timeline: ask, page (highlight + ring), the answer's sentences, then the check. */
/** `nWords`: how many opening sentences the story's "words" step covers before its "board" step. */
export function buildTimeline(q: string, sents: string[], checkQ: string, checkA: string, checkS: string, nWords = 1): { tl: Ev[]; mark: Marks; all: string[] } {
  const tl: Ev[] = []; const mark = {} as Marks;
  let t = 300;
  tl.push({ t, f: 'studentCircle', story: true }); t += 900;
  mark.ask = 0;
  for (let i = 1; i <= q.length; i++) tl.push({ t: t + i * 48, f: 'type', s: q.slice(0, i) });
  t += q.length * 48 + 420;
  tl.push({ t, f: 'submit', s: q }); mark.page = t;
  tl.push({ t: t + 350, f: 'cue', c: 'hl' });
  tl.push({ t: t + 900, f: 'cue', c: 'ring' });
  t += 1700;
  const doSent = (s: string, i: number) => {
    tl.push({ t, f: 'sent', i });
    tok(s).forEach((wd, j) => { tl.push({ t, f: 'word', j }); if (wd.cue) tl.push({ t: t + 20, f: 'cue', c: wd.cue, j }); t += wdur(wd.w); });
    t += 520;
  };
  mark.words = t; for (let i = 0; i < nWords; i++) doSent(sents[i], i);
  mark.board = t; for (let i = nWords; i < sents.length; i++) doSent(sents[i], i);
  t += 900; mark.check = t; mark.heroEnd = t;
  tl.push({ t, f: 'cue', c: 'scroll' });
  tl.push({ t, f: 'ask2', s: checkQ }); t += 1400;
  for (let i = 1; i <= checkA.length; i++) tl.push({ t: t + i * 120, f: 'type', s: checkA.slice(0, i) });
  t += checkA.length * 120 + 450; tl.push({ t, f: 'submit2', s: checkA }); t += 500;
  doSent(checkS, sents.length);
  mark.end = t + 400;
  return { tl, mark, all: [...sents, checkS] };
}

export const segOf = (m: Marks): Record<Seg, [number, number]> =>
  ({ ask: [m.ask, m.page], page: [m.page, m.words], words: [m.words, m.board], board: [m.board, m.check], check: [m.check, m.end] });

const $ = <T extends Element>(s: string, r: ParentNode) => r.querySelector(s) as T;

export function buildStage(rt: Runtime, lesson: Lesson, host: HTMLElement, story: boolean, scale = 1): Ctx {
  host.innerHTML = `<div class="pl-stage">
    <div class="pl-slidewrap"><div class="pl-sheet">${lesson.slideSVG()}</div></div>
    <div class="pl-board">${lesson.boardSVG()}</div>
    <div class="pl-dock"><div class="pl-top"><div class="pl-q"></div><p class="pl-cap"></p></div>
      <div class="pl-in"><span class="pl-t pl-ph">Ask about this…</span><kbd>/</kbd></div></div>
    <svg class="pl-overlay" aria-hidden="true"><defs></defs></svg>
  </div>`;
  const st = $<HTMLElement>('.pl-stage', host);
  return {
    rt, lesson, host, st, story, scale,
    slide: $('.pl-slide-svg', st), marks: $('.pl-slide-svg .pl-marks', st), board: $('.pl-board svg', st),
    dock: $('.pl-dock', st), q: $('.pl-dock .pl-q', st), cap: $('.pl-dock .pl-cap', st), input: $('.pl-dock .pl-in .pl-t', st),
    overlay: $('.pl-overlay', st), timers: [], conn: null,
  };
}

function apply(ctx: Ctx, ev: Ev, instant: boolean) {
  switch (ev.f) {
    case 'type': ctx.input.classList.remove('pl-ph'); ctx.input.innerHTML = ev.s + '<span class="pl-caret"></span>'; break;
    case 'submit': ctx.q.textContent = ev.s!; ctx.input.classList.add('pl-ph'); ctx.input.textContent = 'Follow up…'; break;
    case 'ask2': ctx.q.textContent = ''; ctx.cap.innerHTML = ev.s!.split(' ').map((w) => `<span class="pl-on">${w} </span>`).join(''); ctx.input.classList.add('pl-ph'); ctx.input.textContent = 'Your answer…'; break;
    case 'submit2': ctx.q.textContent = 'You: ' + ev.s; ctx.input.classList.add('pl-ph'); ctx.input.textContent = 'Follow up…'; break;
    case 'sent': ctx.cap.innerHTML = tok(ctx.lesson.all[ev.i!]).map((w) => `<span${w.cue ? ' data-cue="' + w.cue + '"' : ''}>${w.w}</span>`).join(' '); break;
    case 'word': ctx.cap.children[ev.j!]?.classList.add('pl-on'); break;
    case 'studentCircle': if (ctx.story) ctx.lesson.studentCircle(ctx, instant); break;
    case 'cue':
      ctx.lesson.cue(ctx, ev.c!, instant);
      if (ev.j != null) ctx.cap.children[ev.j]?.classList.add('pl-lit');
      break;
  }
}

/** A board element lands (cells drop in, balls appear), now or after `delay`. */
export function drop(ctx: Ctx, e: Element, instant: boolean, delay: number) {
  if (instant || ctx.rt.rm || !delay) { e.classList.add('pl-on'); return; }
  ctx.timers.push(ctx.rt.later(() => e.classList.add('pl-on'), delay));
}
/** An equation written glyph by glyph. */
export function writeEq(ctx: Ctx, t: Element, instant: boolean) {
  t.querySelectorAll('tspan').forEach((s, i) => { if (instant || ctx.rt.rm) s.classList.add('pl-on'); else ctx.timers.push(ctx.rt.later(() => s.classList.add('pl-on'), i * 55)); });
}

export function stopCtx(ctx: Ctx) { ctx.timers.forEach((id) => ctx.rt.clear(id)); ctx.timers = []; }

/** Rebuild the stage, land everything before `from` at once, then play [from, to) in real time. */
export function seek(ctx: Ctx, from: number, to: number): Ctx {
  stopCtx(ctx);
  const next = buildStage(ctx.rt, ctx.lesson, ctx.host, ctx.story, ctx.scale);
  next.onBuild = ctx.onBuild; next.tf = ctx.tf;
  Object.assign(ctx, next);
  const { tl } = ctx.lesson, rm = ctx.rt.rm;
  ctx.st.classList.add('pl-instant');
  for (const ev of tl) if (ev.t < from && (!ev.story || ctx.story)) apply(ctx, ev, true);
  ctx.onBuild?.();
  ctx.st.getBoundingClientRect(); ctx.st.classList.remove('pl-instant');
  if (rm) { for (const ev of tl) if (ev.t >= from && ev.t < to && (!ev.story || ctx.story)) apply(ctx, ev, true); return ctx; }
  for (const ev of tl) if (ev.t >= from && ev.t < to && (!ev.story || ctx.story)) ctx.timers.push(ctx.rt.later(() => apply(ctx, ev, false), ev.t - from + 250));
  return ctx;
}

/** A connector from a point on the slide to a point on the board (both in their viewBox units). */
export function connect(ctx: Ctx, from: Pt, to: Pt, instant: boolean) {
  if (ctx.conn) { ctx.conn.remove(); ctx.conn = null; }
  if (innerWidth < 760) return; // stacked: slide and board are far apart, a connector would cross the caption
  const k = ctx.scale || 1, sr = ctx.st.getBoundingClientRect();
  const svgPt = (svg: SVGSVGElement, x: number, y: number) => {
    const m = svg.getScreenCTM?.(); if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(x, y).matrixTransform(m); return { x: (p.x - sr.left) / k, y: (p.y - sr.top) / k };
  };
  const a = svgPt(ctx.slide, from[0], from[1]);
  const b = svgPt(ctx.board, to[0], to[1]);
  const g = el('g', {}, ctx.overlay);
  const mx = (a.x + b.x) / 2;
  const p = el('path', { class: 'pl-conn', d: `M${a.x} ${a.y}C${mx} ${a.y - 10},${mx} ${b.y + 30},${b.x} ${b.y}` }, g);
  el('circle', { class: 'pl-conn-dot', cx: a.x, cy: a.y, r: 2.6 }, g);
  el('circle', { class: 'pl-conn-dot', cx: b.x, cy: b.y, r: 2.6 }, g);
  strokeDraw(ctx.rt, p, instant, 650);
  ctx.conn = g;
}

export { nibDraw, strokeDraw };
